import {MAX_POWER, rankIdentity} from './engine.js';
import {parseBaseGear, parseSkills} from './wiki-gear.js';

const api = 'https://wiki.risenholm.com/api.php';
const equipmentTitle = 'Equipment and Itemization';
const skillsTitle = 'Skills';
const checkInterval = 60 * 60 * 1000;
const retryInterval = 10 * 60 * 1000;
const slots = ['head', 'chest', 'boots', 'arms', 'cloak', 'ring', 'neck', 'belt', 'weapon'];
const text = value => value.trim().replace(/\s+/g, ' ');
const key = value => value.toLowerCase().replace(/[^a-z0-9]+/g, '');

function requireData(condition, message) {
  if (!condition) throw new Error(message);
}

function unique(values) {
  return [...new Set(values)];
}

function readTable(doc, headers) {
  const tables = [...doc.querySelectorAll('table')].filter(table =>
    [...(table.rows[0]?.cells || [])].map(cell => text(cell.textContent)).join('|') === headers.join('|'));
  requireData(tables.length === 1, `Missing or ambiguous wiki table: ${headers.join(', ')}`);
  const rows = [...tables[0].rows].slice(1);
  requireData(rows.length > 0 && rows.length <= 1000, 'Unexpected wiki table size');
  const expanded = rows.map(() => []);
  rows.forEach((row, index) => {
    let column = 0;
    for (const cell of row.cells) {
      while (expanded[index][column] !== undefined) column++;
      requireData(cell.colSpan === 1 && column < headers.length &&
        cell.rowSpan > 0 && index + cell.rowSpan <= rows.length, 'Unexpected wiki table cell');
      for (let offset = 0; offset < cell.rowSpan; offset++) {
        requireData(expanded[index + offset][column] === undefined, 'Overlapping wiki table cells');
        expanded[index + offset][column] = text(cell.textContent);
      }
      column++;
    }
  });
  requireData(expanded.every(row => headers.every((_, column) => row[column] !== undefined)),
    'Incomplete wiki table row');
  return expanded;
}

function whole(value, label) {
  requireData(/^\d{1,5}$/.test(value), `Invalid wiki ${label}`);
  return Number(value);
}

function supportedSlot(value) {
  const slot = key(value);
  requireData(slots.includes(slot) && slot !== 'weapon', `Unrecognized equipment slot: ${value}`);
  return slot;
}

function slotRules(value) {
  if (value === 'All') return {slots: [...slots]};
  if (value.startsWith('All except ')) {
    const excluded = value.slice(11).split(',').map(part => key(part));
    requireData(excluded.every(part => [...slots, 'offhand', 'rangedweapon'].includes(part)),
      `Unrecognized slot restriction: ${value}`);
    return {slots: slots.filter(slot => !excluded.includes(slot))};
  }
  const allowed = [];
  const weaponKinds = [];
  for (const part of value.replace(/Melee, Ranged, Mystic Weapon/g, 'Melee Weapon, Ranged Weapon, Mystic Weapon')
    .replace(/Melee, Ranged Weapon/g, 'Melee Weapon, Ranged Weapon').split(',')) {
    const slot = key(part);
    if (slot === 'rangedweapon' || slot === 'offhand') continue;
    if (slot === 'mysticweapon' || slot === 'meleeweapon' || slot === 'weapon') {
      allowed.push('weapon');
      if (slot !== 'mysticweapon') weaponKinds.push('melee');
      if (slot !== 'meleeweapon') weaponKinds.push('mystic');
    } else {
      allowed.push(supportedSlot(part));
    }
  }
  return {slots: unique(allowed), ...(weaponKinds.length ? {weaponKinds: unique(weaponKinds)} : {})};
}

function referenceSubtypes(rows, column, prior = []) {
  const byLabel = new Map();
  for (const row of rows) {
    const slot = supportedSlot(row[0]);
    if (row[column] === '.' || row[column] === '—' || row[column] === '') continue;
    for (const label of row[column].split(',').map(text)) {
      requireData(label.length > 0 && label.length <= 80 && key(label), 'Invalid subtype name');
      const id = prior.find(subtype => key(subtype.label) === key(label))?.id ||
        label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
      if (!byLabel.has(id)) byLabel.set(id, {id, label, slots: []});
      const subtype = byLabel.get(id);
      requireData(subtype.label === label && !subtype.slots.includes(slot), 'Duplicate wiki subtype');
      subtype.slots.push(slot);
    }
  }
  requireData(byLabel.size > 0, 'Missing wiki reference subtypes');
  return [...byLabel.values()];
}

function parseEffect(raw, negative) {
  const source = raw.replace(/[−–]/g, '-').replace(/½/g, ' 1/2');
  const compact = source.replace(/\s/g, '');
  const sign = negative ? -1 : 1;
  let match = compact.match(/^([+-]?\d+(?:\.\d+)?)(%|lbs?)?$/i);
  if (match) {
    const kind = match[2] === '%' ? 'percent' : match[2] ? 'weight' : 'flat';
    const value = Math.abs(Number(match[1])) * (kind === 'weight' ? 1 : sign);
    return {value, kind};
  }
  match = compact.match(/^([+\-]?)L(\d+)$/i);
  if (match) return {value: Number(match[2]) * sign, kind: 'level'};
  match = compact.match(/^([+\-]?)(\d+)d(\d+)$/i);
  if (match) return {value: Number(match[2]) * sign, kind: 'dice'};
  match = source.trim().match(/^(?:[+\-])?(?:(\d+)\s*)?(?:(1\/2)\s*)?HD$/i);
  if (match && (match[1] || match[2])) {
    // A half die by itself starts with "1/", so it has no whole-die match.
    return {value: (Number(match[1] || 0) + (match[2] ? .5 : 0)) * sign, kind: 'hp_hd'};
  }
  throw new Error(`Unknown wiki rank: ${raw}`);
}

function repeatType(value) {
  if (value === '') return 'unspecified';
  if (/^No(?:$|, and requires an existing spell$|, capped at \+5 net$)/i.test(value)) return 'none';
  if (/^Once per class and level$/i.test(value)) return 'subtype_rank';
  if (/^Once per (?:skill|save(?: type)?|damage type|resource|spell)$/i.test(value)) return 'subtype';
  if (/^(?:Yes|Repeatable)$/i.test(value)) return 'yes';
  throw new Error(`Unknown repeat rule: ${value}`);
}

function groupRows(rows) {
  const groups = new Map();
  for (const row of rows) {
    const name = key(row[0]);
    requireData(name && row[0].length <= 120, 'Invalid property name');
    if (!groups.has(name)) groups.set(name, []);
    groups.get(name).push(row);
  }
  return groups;
}

function readFamilies(rows, baseline, type, reference) {
  const negative = type === 'disrupted';
  const damage = type === 'damage';
  const known = new Map(baseline.map(family => [key(family.label.replace(/^Damage: /, '')), family]));
  const families = [];
  for (const [name, entries] of groupRows(rows)) {
    const prior = known.get(name);
    const first = entries[0];
    const repeatCell = damage ? '' : first[negative ? 3 : 4];
    const slotCell = damage ? '' : first[negative ? 4 : 5];
    const repeat = repeatType(repeatCell);
    requireData(prior || (repeat !== 'subtype' && repeat !== 'subtype_rank'),
      `New subtype family requires review: ${first[0]}`);
    requireData(prior || !/requires an existing spell|capped at/i.test(repeatCell),
      `New special property requires review: ${first[0]}`);

    let eligibility;
    let subtypes = prior?.subtypes;
    if (damage) {
      const weaponKinds = prior?.weaponKinds ||
        (/^spells\b|^all$|^associates$/i.test(first[0]) ? ['melee', 'mystic'] : ['melee']);
      eligibility = {slots: ['arms', 'ring', 'weapon'], weaponKinds};
    } else if (prior?.id === 'cast_spell' && slotCell === 'Varies by spell') {
      eligibility = {slots: prior.slots};
    } else if (prior?.id === 'specific_save' && slotCell === 'Varies by save, see reference') {
      subtypes = reference.specific;
      eligibility = {slots: unique(subtypes.flatMap(subtype => subtype.slots))};
    } else if (prior?.id === 'general_save' && /^\w+: \w+\./.test(slotCell)) {
      subtypes = reference.general;
      eligibility = {slots: unique(subtypes.flatMap(subtype => subtype.slots))};
    } else if (prior?.id === 'immunity' && slotCell === 'Varies by type, see reference') {
      subtypes = reference.immunity;
      eligibility = {slots: unique(subtypes.flatMap(subtype => subtype.slots))};
    } else {
      eligibility = slotRules(slotCell);
    }
    if (!eligibility.slots.length) continue;

    const threshold = negative ? 'minDisruption' : 'minPower';
    const byRank = new Map((prior?.ranks || []).map(rank => [rankIdentity(rank.label), rank]));
    let effectKind;
    const ranks = entries.map(row => {
      requireData(row[0] === first[0] && row[1].length <= 50, 'Inconsistent rank label');
      if (!damage) requireData(row[negative ? 3 : 4] === repeatCell && row[negative ? 4 : 5] === slotCell,
        'Rank-specific slot or repeat rules need review');
      const effect = parseEffect(row[1], negative);
      requireData(!effectKind || effectKind === effect.kind, 'Mixed rank units need review');
      effectKind = effect.kind;
      const previous = byRank.get(rankIdentity(row[1]));
      const label = previous?.label || row[1];
      const value = previous?.value ?? effect.value;
      return negative
        ? {label, value, [threshold]: whole(row[2], 'Disruption')}
        : {label, value, capacity: whole(row[2], 'Capacity'), [threshold]: whole(row[3], 'Power'),
          rarity: damage ? whole(row[4], 'rarity') : 1};
    });
    requireData(new Set(ranks.map(rank => rankIdentity(rank.label))).size === ranks.length, 'Duplicate rank');
    requireData(ranks.every((rank, index) => index === 0 || rank[threshold] >= ranks[index - 1][threshold]),
      'Unexpected rank order');
    if (prior) {
      const baselineKind = parseEffect(prior.ranks[0].label, negative).kind;
      requireData(baselineKind === effectKind, `Rank units changed for ${first[0]}`);
    }
    const available = negative ? ranks : ranks.filter(rank => rank.minPower <= MAX_POWER);
    if (!available.length) continue;
    const id = prior?.id || `wiki_${type}_${name}`;
    const family = {...prior, id, label: prior?.label || (damage ? `Damage: ${first[0]}` : first[0]),
      ...eligibility, repeat, ranks: available, kind: prior?.kind || effectKind};
    if (!eligibility.weaponKinds) delete family.weaponKinds;
    if (subtypes) family.subtypes = subtypes;
    families.push(family);
  }
  requireData(families.length >= Math.ceil(baseline.length / 2), 'Incomplete wiki property table');
  return families;
}

export function parseEquipment(doc, baseline) {
  const existing = id => baseline.properties.find(family => family.id === id)?.subtypes;
  const saves = readTable(doc, ['Slot', 'Specific Saves', 'General Saves']);
  const immunity = readTable(doc, ['Slot', 'Damage Immunity']);
  const reference = {
    specific: referenceSubtypes(saves, 1, existing('specific_save')),
    general: referenceSubtypes(saves, 2, existing('general_save')),
    immunity: referenceSubtypes(immunity, 1, existing('immunity')),
  };
  const properties = readFamilies(
    readTable(doc, ['Property', 'Rank', 'Capacity', 'Min Power', 'Repeat', 'Item Slots']),
    baseline.properties.filter(family => family.group !== 'damage_bonus'), 'property', reference);
  const damage = readFamilies(
    readTable(doc, ['Applies to', 'Bonus', 'Capacity', 'Min Power', 'Rarity']),
    baseline.properties.filter(family => family.group === 'damage_bonus'), 'damage');
  for (const family of damage) family.group = 'damage_bonus';
  const disrupted = readFamilies(
    readTable(doc, ['Property', 'Rank', 'Min Disruption', 'Repeat', 'Item Slots']),
    baseline.disrupted, 'disrupted');
  const penalties = disrupted.find(family => family.id === 'specific_save_penalty');
  if (penalties) penalties.subtypes = reference.specific.map(({id, label}) => ({id, label}));
  return {...parseBaseGear(doc, baseline), properties: [...properties, ...damage], disrupted};
}

async function wikiRequest(params, signal) {
  const url = new URL(api);
  url.search = new URLSearchParams({...params, format: 'json', formatversion: '2', origin: '*', maxage: '300', smaxage: '300'});
  const response = await fetch(url, {credentials: 'omit', referrerPolicy: 'no-referrer', signal});
  requireData(response.ok, 'Wiki request failed');
  const result = await response.json();
  requireData(!result.error && !result.errors, 'Wiki returned an API error');
  return result;
}

function revisionFor(result, title) {
  const revision = result.query?.pages?.find(page => page.title === title)?.revisions?.[0];
  requireData(Number.isSafeInteger(revision?.revid) && revision.revid > 0 &&
    Number.isFinite(Date.parse(revision.timestamp)), `Wiki revision unavailable for ${title}`);
  return revision;
}

async function pageAt(title, revision, signal) {
  const result = await wikiRequest({action: 'parse', oldid: String(revision.revid), prop: 'text|revid'}, signal);
  const page = result.parse;
  requireData(page?.title === title && page.revid === revision.revid &&
    typeof page.text === 'string' && page.text.length > 0 && page.text.length <= 1000000, 'Unexpected wiki response');
  // Parse in an inert template and read plain text. Never attach wiki HTML to the page.
  const template = document.createElement('template');
  template.innerHTML = page.text;
  return template.content;
}

function catalogWithSkills(catalog, subtypes) {
  const update = family => family.id === 'skill' || family.id === 'skill_penalty' ? {...family, subtypes} : family;
  return {...catalog, properties: catalog.properties.map(update), disrupted: catalog.disrupted.map(update)};
}

export function loadWikiCatalog(bundled) {
  const legacyRankIds = Object.fromEntries(bundled.properties.map(family =>
    [family.id, family.ranks.map(rank => rankIdentity(rank.label))]));
  const baseline = {...bundled, legacyRankIds};
  const cacheKey = `risenholm.gear-catalog.v1:${new URL('.', import.meta.url).pathname}`;
  let cache;
  try {
    const saved = JSON.parse(localStorage.getItem(cacheKey));
    if (saved?.base === bundled.source.revision && saved.catalog?.source &&
        ['properties', 'disrupted', 'armor', 'weapons'].every(name => Array.isArray(saved.catalog[name]))) cache = saved;
  } catch {
    // The planner also works when browser storage is unavailable.
  }
  const current = cache ? {...cache.catalog, legacyRankIds} : baseline;
  const now = Date.now();
  const cacheResult = (catalog, status) => {
    try {
      localStorage.setItem(cacheKey, JSON.stringify({base: bundled.source.revision, checked: now, status, catalog}));
    } catch {
      // Use the refreshed catalog for this visit even if the cache cannot be saved.
    }
    return {catalog, status};
  };
  const interval = cache?.status === 'current' ? checkInterval : retryInterval;
  if (cache && now >= cache.checked && now - cache.checked < interval) {
    return {catalog: current, status: cache.status};
  }

  return {catalog: current, status: 'checking', refresh: refreshCatalog(baseline, current, now, cacheResult)};
}

async function refreshCatalog(baseline, current, now, cacheResult) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const metadata = await wikiRequest({
      action: 'query', titles: `${equipmentTitle}|${skillsTitle}`, prop: 'revisions', rvprop: 'ids|timestamp',
    }, controller.signal);
    const equipment = revisionFor(metadata, equipmentTitle);
    const skills = revisionFor(metadata, skillsTitle);
    requireData(equipment.revid >= Number(current.source.revision) &&
      skills.revid >= Number(current.source.skillsRevision), 'Wiki returned an older revision');

    const [equipmentPage, skillsPage] = await Promise.all([
      equipment.revid > Number(current.source.revision) ? pageAt(equipmentTitle, equipment, controller.signal) : null,
      skills.revid > Number(current.source.skillsRevision) ? pageAt(skillsTitle, skills, controller.signal) : null,
    ]);
    let catalog = equipmentPage ? {...current, ...parseEquipment(equipmentPage, baseline)} : current;
    const savedSkills = current.properties.find(family => family.id === 'skill')?.subtypes;
    if (skillsPage || (equipmentPage && savedSkills)) {
      catalog = catalogWithSkills(catalog, skillsPage ? parseSkills(skillsPage, baseline) : savedSkills);
    }
    catalog = {...catalog, source: {...baseline.source, revision: String(equipment.revid),
      lastModified: equipment.timestamp.slice(0, 10), skillsRevision: String(skills.revid)},
    checkedAt: new Date(now).toLocaleDateString('en-CA')};
    return cacheResult(catalog, 'current');
  } catch (error) {
    console.warn('Risenholm wiki catalog refresh failed:', error.message);
    return cacheResult(current, 'fallback');
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}
