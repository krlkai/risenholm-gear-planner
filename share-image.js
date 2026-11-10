import {evaluateItem} from './engine.js';
import {validatePortrait} from './portrait.js';

const WIDTH = 1120;
const MAX_HEIGHT = 4096;
const MARGIN = 42;
const GAP = 18;
const CARD_WIDTH = (WIDTH - 2 * MARGIN - GAP) / 2;
const PAD = 20;
const LABEL_WIDTH = 95;
const LINE_HEIGHT = 25;
const GROUP_GAP = 8;
const EMBLEM_SIZE = 44;
const PORTRAIT_WIDTH = 90;
const PORTRAIT_HEIGHT = 120;
const PORTRAIT_GAP = 24;
const FONT = {
  wordmark: '700 16px system-ui, sans-serif',
  title: '46px Georgia, serif',
  slot: '27px Georgia, serif',
  body: '18px system-ui, sans-serif',
  caption: '16px system-ui, sans-serif',
  meta: '600 16px system-ui, sans-serif',
  label: '700 13px system-ui, sans-serif'
};
const COLOR = {
  canvas: '#0b0e19',
  glow: '#233458',
  card: '#151b2a',
  line: '#35425e',
  text: '#f2ede2',
  muted: '#aab5ce',
  silver: '#d0d9ed',
  cobalt: '#8caaff',
  positive: '#a4c3ff',
  intrinsic: '#c5c6ff',
  negative: '#f4a0a7'
};

function compactText(value, limit) {
  const text = String(value ?? '').slice(0, limit * 4)
    .replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/gu, ' ')
    .replace(/\s+/gu, ' ').trim();
  const characters = Array.from(text);
  return characters.length > limit ? characters.slice(0, limit - 1).join('') + '…' : text;
}

function fittingPrefix(context, characters, width) {
  let low = 0;
  let high = characters.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (context.measureText(characters.slice(0, middle).join('')).width <= width) low = middle;
    else high = middle - 1;
  }
  return low;
}

function wrap(context, text, font, width, maxLines) {
  context.font = font;
  const lines = [];
  let remaining = Array.from(text);
  while (remaining.length && lines.length < maxLines) {
    const count = fittingPrefix(context, remaining, width);
    if (count === remaining.length) {
      lines.push(remaining.join(''));
      break;
    }
    if (lines.length === maxLines - 1) {
      const shortened = fittingPrefix(context, remaining, width - context.measureText('…').width);
      lines.push(remaining.slice(0, shortened).join('').trimEnd() + '…');
      break;
    }
    const wordBreak = remaining.lastIndexOf(' ', count);
    const end = wordBreak > 0 ? wordBreak : Math.max(1, count);
    lines.push(remaining.slice(0, end).join(''));
    remaining = Array.from(remaining.slice(end).join('').trimStart());
  }
  return lines;
}

function propertyText(rows) {
  const filled = rows.filter(Boolean);
  const labels = filled.slice(0, 8).map(row => compactText(row.label, 100));
  if (filled.length > labels.length) labels.push(`+${filled.length - labels.length} more`);
  return labels.join(' · ') || '—';
}

function baseName(item, catalog) {
  const armor = item.slot === 'chest';
  const value = armor ? item.armorType : item.weaponType;
  const list = armor ? catalog.armor : catalog.weapons;
  return list?.find(entry => entry.id === value || entry.name === value)?.name || value;
}

function layoutCard(context, item, catalog) {
  const evaluation = evaluateItem(item, catalog);
  const title = compactText(item.label, 36) || 'Gear slot';
  const power = `P${compactText(item.power, 7)} / D${compactText(item.disruption, 7)}`;
  const name = compactText(item.itemName, 85);
  const base = ['chest', 'weapon'].includes(item.slot) ? compactText(baseName(item, catalog), 60) : '';
  const details = wrap(context, [...new Set([name, base].filter(Boolean))].join(' · '), FONT.caption, CARD_WIDTH - 2 * PAD, 2);
  const width = CARD_WIDTH - 2 * PAD - LABEL_WIDTH;
  const groups = [
    ['CORE', item.core ? `+${evaluation.coreValue} ${compactText(item.core, 38)}` : '—', COLOR.silver, 2],
    ['INTRINSIC', propertyText(evaluation.rows.intrinsics), COLOR.intrinsic, 4],
    ['EXTRINSIC', propertyText(evaluation.rows.extrinsics), COLOR.positive, 5]
  ];
  if (evaluation.disruptedCount || evaluation.rows.disrupted.some(Boolean)) {
    groups.push(['DISRUPTED', propertyText(evaluation.rows.disrupted), COLOR.negative, 4]);
  }
  const sections = groups.map(([label, value, color, maxLines]) => ({
    label, color, lines: wrap(context, value, FONT.body, width, maxLines)
  }));
  const sectionsHeight = sections.reduce((total, section) => total + section.lines.length * LINE_HEIGHT + GROUP_GAP, 0);
  const detailsHeight = details.length ? details.length * 22 + 3 : 0;
  const height = PAD + 33 + detailsHeight + 18 + sectionsHeight + 12 + 20 + PAD;
  return {title, power, details, sections, height, evaluation};
}

function drawText(context, text, x, y, font, color, align = 'left') {
  context.font = font;
  context.fillStyle = color;
  context.textAlign = align;
  context.fillText(text, x, y);
}

function drawLines(context, lines, x, y, font, color, step) {
  lines.forEach((line, index) => drawText(context, line, x, y + index * step, font, color));
}

function divider(context, left, right, y) {
  context.fillStyle = COLOR.line;
  context.fillRect(left, y, right - left, 1);
}

function roundedPath(context, x, y, width, height, radius) {
  context.beginPath();
  if (typeof context.roundRect === 'function') context.roundRect(x, y, width, height, radius);
  else context.rect(x, y, width, height);
}

function drawPortrait(context, portrait, top) {
  roundedPath(context, MARGIN, top, PORTRAIT_WIDTH, PORTRAIT_HEIGHT, 10);
  context.save();
  context.clip();
  context.drawImage(portrait, MARGIN, top, PORTRAIT_WIDTH, PORTRAIT_HEIGHT);
  context.restore();
  context.strokeStyle = COLOR.cobalt;
  context.stroke();
}

function drawCard(context, card, x, top, height) {
  roundedPath(context, x, top, CARD_WIDTH, height, 12);
  context.fillStyle = COLOR.card;
  context.fill();
  context.strokeStyle = COLOR.line;
  context.stroke();

  const left = x + PAD;
  const right = x + CARD_WIDTH - PAD;
  let y = top + PAD;
  context.font = FONT.meta;
  const titleWidth = right - left - context.measureText(card.power).width - 16;
  drawText(context, wrap(context, card.title, FONT.slot, titleWidth, 1)[0], left, y, FONT.slot, COLOR.text);
  drawText(context, card.power, right, y + 5, FONT.meta, COLOR.positive, 'right');
  y += 33;
  drawLines(context, card.details, left, y, FONT.caption, COLOR.muted, 22);
  if (card.details.length) y += card.details.length * 22 + 3;
  divider(context, left, right, y + 3);
  y += 18;

  for (const section of card.sections) {
    drawText(context, section.label, left, y + 3, FONT.label, section.color);
    drawLines(context, section.lines, left + LABEL_WIDTH, y, FONT.body, COLOR.text, LINE_HEIGHT);
    y += section.lines.length * LINE_HEIGHT + GROUP_GAP;
  }

  const {usedCapacity, capacity, remainingCapacity, valid} = card.evaluation;
  const bottom = top + height - PAD - 20;
  divider(context, left, right, bottom - 12);
  drawText(context, valid ? 'Capacity used' : 'Capacity used · Rule issues', left, bottom, FONT.caption, valid ? COLOR.muted : COLOR.negative);
  const usage = `${compactText(usedCapacity, 10)} / ${compactText(capacity, 10)}`;
  drawText(context, usage, right, bottom, FONT.meta, remainingCapacity < 0 ? COLOR.negative : COLOR.silver, 'right');
}

async function loadImage(source) {
  try {
    const image = new Image();
    if (source.startsWith('data:')) image.src = source;
    else {
      image.crossOrigin = 'anonymous';
      image.src = new URL(source, import.meta.url).href;
    }
    await image.decode();
    return image;
  } catch {
    return null;
  }
}

export async function renderLoadoutImage(build, catalog) {
  if (!Array.isArray(build?.items) || !build.items.length || build.items.length > 10) throw new Error('Choose a loadout with up to ten gear slots.');

  const canvas = document.createElement('canvas');
  canvas.width = WIDTH;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('This browser could not render the loadout image.');

  const [emblem, portrait] = await Promise.all([
    loadImage('./risenholm-icon.svg'),
    validatePortrait(build.portrait) ? loadImage(build.portrait) : null
  ]);
  const title = compactText(build.name, 105) || 'My loadout';
  const titleLeft = MARGIN + (portrait ? PORTRAIT_WIDTH + PORTRAIT_GAP : 0);
  const titleWidth = WIDTH - MARGIN - titleLeft;
  const titleLines = wrap(context, title, FONT.title, titleWidth, 2);
  const cards = build.items.map(item => layoutCard(context, item, catalog));
  const headerTop = 86;
  const titleHeight = titleLines.length * 54;
  const titleBlockHeight = titleHeight + 25;
  const titleOffset = portrait ? Math.max(0, Math.floor((PORTRAIT_HEIGHT - titleBlockHeight) / 2)) : 0;
  const titleTop = headerTop + titleOffset;
  const metaTop = titleTop + titleHeight + 3;
  let top = Math.max(metaTop + 40, portrait ? headerTop + PORTRAIT_HEIGHT + 20 : 0);
  const positions = cards.map((card, index) => {
    const column = index % 2;
    const other = cards[index + (column ? -1 : 1)];
    const height = Math.max(card.height, other?.height || 0);
    const position = {x: MARGIN + column * (CARD_WIDTH + GAP), top, height};
    if (column || index === cards.length - 1) top += height + GAP;
    return position;
  });
  const height = top + 50;
  if (height > MAX_HEIGHT) throw new Error('The loadout image is too large to export.');

  canvas.height = height;
  context.textBaseline = 'top';
  const background = context.createLinearGradient(0, 0, 0, Math.min(400, height));
  background.addColorStop(0, COLOR.glow);
  background.addColorStop(1, COLOR.canvas);
  context.fillStyle = background;
  context.fillRect(0, 0, WIDTH, height);

  if (emblem) context.drawImage(emblem, MARGIN, 26, EMBLEM_SIZE, EMBLEM_SIZE);
  else {
    context.fillStyle = COLOR.cobalt;
    context.fillRect(MARGIN, 39, 5, 17);
  }
  const wordmarkLeft = MARGIN + (emblem ? EMBLEM_SIZE + 12 : 16);
  drawText(context, 'SCARS OF RISENHOLM', wordmarkLeft, 39, FONT.wordmark, COLOR.silver);
  drawText(context, 'GEAR PLANNER', WIDTH - MARGIN, 39, FONT.label, COLOR.muted, 'right');
  if (portrait) drawPortrait(context, portrait, headerTop);
  drawLines(context, titleLines, titleLeft, titleTop, FONT.title, COLOR.text, 54);
  const issues = cards.filter(card => !card.evaluation.valid).length;
  const meta = `${cards.length} gear slots${issues ? ` · ${issues} with rule issues` : ''}`;
  drawText(context, meta, titleLeft, metaTop, FONT.caption, issues ? COLOR.negative : COLOR.muted);

  cards.forEach((card, index) => {
    const position = positions[index];
    drawCard(context, card, position.x, position.top, position.height);
  });
  const revision = compactText(catalog.source?.revision, 36);
  const footer = revision ? `Risenholm wiki catalog · Revision ${revision}` : 'Risenholm gear plan';
  divider(context, MARGIN, WIDTH - MARGIN, top + 1);
  drawText(context, footer, MARGIN, top + 16, FONT.caption, COLOR.muted);

  return new Promise((resolve, reject) => canvas.toBlob(blob => {
    if (blob) resolve(blob);
    else reject(new Error('This browser could not encode the loadout PNG.'));
  }, 'image/png'));
}
