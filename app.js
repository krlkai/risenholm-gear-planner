import {createBuild,createItem,evaluateItem,summarizeBuild,propertyOptions,rankIdentity,SLOT_DEFINITIONS,ABILITIES,MAX_POWER} from './engine.js';
import {loadWikiCatalog} from './wiki-catalog.js';
import {renderLoadoutImage} from './share-image.js';
import {embedLoadoutInPng, readLoadoutFromPng} from './png-loadout.js';
import {normalizePortrait, validatePortrait} from './portrait.js';

const bundledCatalog = await fetch('./catalog.json').then(r=>{if(!r.ok)throw Error('Could not load the property library.');return r.json();});
const wiki = loadWikiCatalog(bundledCatalog);
let {catalog, status:catalogStatus} = wiki;
let pendingCatalog = null;
const portraitUploads = new WeakMap();
const $ = s=>document.querySelector(s), app=$('#app'), picker=$('#picker'), manage=$('#manage');
const escape = v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const signed = v=>`${v>=0?'+':''}${v}`;
const uid=()=>globalThis.crypto?.randomUUID?.()||`plan-${Date.now()}-${Math.random().toString(36).slice(2)}`;
const STORE=`risenholm.gear-planner.web.v1:${new URL('.', import.meta.url).pathname}`;
let storageOK=true, libraryQuery='', librarySlot='', libraryKind='positive', view='planner', activeItem='head', history=[], pick=null, numericEdit=null;
const now = () => new Date().toISOString();
const fresh = () => ({...createBuild(), id:uid(), modifiedAt:now()});
const modifiedFormat = new Intl.DateTimeFormat(undefined, {dateStyle:'medium', timeStyle:'short'});
function modifiedDate(value) {
  const timestamp = typeof value === 'string' ? Date.parse(value) : NaN;
  return Number.isFinite(timestamp) ? new Date(timestamp) : null;
}
let state;
try{state=JSON.parse(localStorage.getItem(STORE));}catch{storageOK=false;}
if(!state?.builds?.length){const b=fresh();state={version:1,activeId:b.id,builds:[b]};}
if(!state.builds.some(b=>b.id===state.activeId))state.activeId=state.builds[0].id;
const build=()=>state.builds.find(b=>b.id===state.activeId);
const item=()=>build().items.find(i=>i.id===activeItem)||build().items[0];
const clone=v=>JSON.parse(JSON.stringify(v));
const slotName=s=>({head:'Helm',arms:'Bracers',chest:'Armor',neck:'Amulet',ring:'Ring',cloak:'Cloak',boots:'Boots',belt:'Belt',weapon:'Weapon'}[s]||s);
const acName=s=>({head:'Armor enchantment',chest:'Armor enchantment',ring:'Natural',neck:'Natural',belt:'Deflection',arms:'Deflection',boots:'Dodge',cloak:'Dodge'}[s]||'');
function toast(message){$('#toast').textContent=message;$('#toast').classList.add('show');clearTimeout(toast.timer);toast.timer=setTimeout(()=>$('#toast').classList.remove('show'),3000);}
function save(){try{localStorage.setItem(STORE,JSON.stringify(state));storageOK=true;}catch{storageOK=false;}}
function remember(snapshot=clone(state)){history.push(snapshot);if(history.length>35)history.shift();}
function mutate(fn, editedLoadout = build()) {
  numericEdit = null;
  const snapshot = clone(state);
  remember(snapshot);
  fn();
  const previous = snapshot.builds.find(loadout => loadout.id === editedLoadout.id);
  if (previous && JSON.stringify(previous) !== JSON.stringify(editedLoadout)) {
    editedLoadout.modifiedAt = now();
  }
  save();
  render();
}
function resize(arr,n){return Array.from({length:n},(_,i)=>arr?.[i]??null);}
function normalizeCounts(it){it.extrinsics=resize(it.extrinsics,it.baseExtrinsics+it.extraExtrinsics);it.disrupted=resize(it.disrupted,it.disruption>0?Math.floor(1+it.disruption/10):0);}
// Keep the numeric input mounted so typing and held arrow controls keep focus.
function refreshNumericOutputs(){
  const it=item(), ev=evaluateItem(it,catalog), editor=app.querySelector('.editor');
  if(!editor)return;
  const next=document.createElement('div');next.innerHTML=renderItem(it,ev);
  for(const selector of ['.power-tag','.capacity'])editor.querySelector(selector).replaceWith(next.querySelector(selector));
  const notesOpen=!editor.querySelector('.notes-body').hidden;
  for(const child of [...editor.children].slice(1))child.remove();
  for(const child of [...next.children].slice(1))editor.append(child);
  if(notesOpen)editor.querySelector('.notes-body').hidden=false;
  for(const button of app.querySelectorAll('.slot-button')){
    const piece=build().items.find(i=>i.id===button.dataset.id),c=completeness(piece),e=evaluateItem(piece,catalog);
    button.querySelector('.slot-meta').textContent=`${c.filled}/${c.count} properties · P${piece.power}`;
    button.querySelector('.dot').className=`dot ${e.errors.length?'error':c.filled?'filled':''}`;
  }
  app.querySelector('.summary').outerHTML=renderSummary(summarizeBuild(build(),catalog));
  app.querySelector('[data-action="undo"]').disabled=!history.length;
  app.querySelector('.saved-indicator').textContent=storageOK?'Saved locally':'Export to save';
}
function updateNumericInput(el,commit=false){
  const field=el.dataset.field;
  if(!['power','disruption'].includes(field))return;
  // Blank or partly typed numbers do not overwrite the last valid value.
  const raw=Number(el.value);
  if(el.value===''||!Number.isFinite(raw)){
    if(commit){el.value=String(item()[field]);numericEdit=null;}
    return;
  }
  if(!commit&&(!Number.isInteger(raw)||raw<0||(field==='disruption'&&raw>999)))return;
  let value=Math.max(0,Math.floor(raw));if(field==='disruption')value=Math.min(999,value);else value=Math.min(MAX_POWER,value);
  if(value!==raw)el.value=String(value);
  if(value!==item()[field]){
    if(numericEdit?.element!==el){numericEdit={element:el};remember();}
    item()[field]=value;normalizeCounts(item());build().modifiedAt=now();save();refreshNumericOutputs();
  }
  if(commit){if(el.value!==String(item()[field]))el.value=String(item()[field]);numericEdit=null;}
}
function icon(slot){const paths={head:'M5 22V12a7 7 0 0 1 14 0v10M5 15l5 3v5h4v-5l5-3M12 5v9M3 22h4m10 0h4',arms:'M7 5l12 3-3 17-12-3zM6 11l12 3M5 17l12 3M9 6l-2 16',cloak:'M8 4h8l6 21H2zM8 4l4 8 4-8M12 12v12',ring:'M7 14a7 7 0 1 0 10 0M8 7l4-4 4 4-4 5z',belt:'M2 11h20v9H2zM9 10h7v11H9zM12 15h5',neck:'M5 4c-3 12 2 17 7 19 5-2 10-7 7-19M8 20l4-4 4 4-4 6z',boots:'M7 3h8v14l7 3v5H5l-2-5 4-4zM8 7h6M8 11h6',chest:'M7 4l5 3 5-3 6 6-5 4v12H6V14l-5-4zM8 4l4 8 4-8',weapon:'M20 3l3 1-3 5-11 12-4-4L16 5zM4 14l9 8M3 25l5-6'};return `<svg class="gear-icon" viewBox="0 0 26 29" aria-hidden="true"><path d="${paths[slot]||paths.ring}"/></svg>`;}
function option(value,label,current){return `<option value="${escape(value)}"${String(current)===String(value)?' selected':''}>${escape(label)}</option>`;}
function field(label,control,wide=false){return `<label${wide?' class="field-wide"':''}><span class="field-label">${label}</span>${control}</label>`;}
function heading(){
  const loadout = build();
  const portrait = validatePortrait(loadout.portrait) ? loadout.portrait : '';
  return `<div class="page-heading">
    <div class="loadout-heading">
      ${portrait ? `<div class="portrait-control">
        <button type="button" class="portrait-trigger" data-action="portrait-options" aria-label="Portrait options" aria-controls="portrait-menu" aria-expanded="false">
          <img class="loadout-portrait" src="${escape(portrait)}" width="54" height="72" alt="">
          <span class="portrait-fallback" aria-hidden="true">Portrait</span>
        </button>
        <div id="portrait-menu" class="portrait-menu" hidden>
          <button type="button" data-action="choose-portrait">Replace portrait</button>
          <button type="button" class="danger" data-action="remove-portrait">Remove portrait</button>
        </div>
      </div>` : ''}
      <div class="loadout-title">
        <input class="build-name" aria-label="Loadout name" data-field="build-name" value="${escape(loadout.name)}" maxlength="100">
      </div>
    </div>
    <div class="toolbar"><span class="saved-indicator">${storageOK?'Saved locally':'Export to save'}</span><button data-action="undo" title="Undo last change" ${history.length?'':'disabled'}>↶ Undo</button><button data-action="loadouts">Loadouts ▾</button>
      ${portrait ? '' : `<button type="button" class="portrait-add" data-action="choose-portrait" aria-label="Add portrait" title="Add portrait">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="13" height="18" rx="2"/><circle cx="9.5" cy="9" r="2.5"/><path d="M5 17a4.5 4.5 0 0 1 9 0m6-8v6m-3-3h6"/></svg>
        <span>Add portrait</span>
      </button>`}
      <button data-action="exports" class="primary">Export plan ↗</button></div>
  </div>`;
}
function completeness(it){const arrays=[it.intrinsics,it.extrinsics,it.disrupted];const filled=arrays.flat().filter(Boolean).length;const count=arrays.reduce((n,a)=>n+a.length,0);return {filled,count,done:filled===count&&!!it.core};}
function render(){
  if (pendingCatalog && !picker.open && !manage.open) {
    ({catalog, status:catalogStatus} = pendingCatalog);
    pendingCatalog = null;
  }
  document.querySelectorAll('[data-view]').forEach(b=>b.classList.toggle('active',b.dataset.view===view));const b=build();const sum=summarizeBuild(b,catalog);app.innerHTML=heading()+(view==='planner'?renderPlanner(sum):view==='overview'?renderOverview():view==='catalog'?renderLibrary():renderRules());}
function renderPlanner(sum){const it=item(), ev=evaluateItem(it,catalog);return `<div class="workbench"><aside class="panel loadout"><div class="panel-head"><div class="slot-title">YOUR LOADOUT <span>10</span></div></div><div class="loadout-list">${build().items.map(i=>{const c=completeness(i),e=evaluateItem(i,catalog);return `<button class="slot-button ${i.id===activeItem?'selected':''}" data-action="slot" data-id="${escape(i.id)}" aria-pressed="${i.id===activeItem}">${icon(i.slot)}<span><span class="slot-label">${escape(i.label)}</span><span class="slot-meta">${c.filled}/${c.count} properties · P${i.power}</span></span><span class="dot ${e.errors.length?'error':c.filled?'filled':''}"></span></button>`;}).join('')}</div><div class="build-switch"><button class="subtle small" style="width:100%" data-view="overview">View whole loadout →</button></div></aside><section class="panel editor" aria-label="${escape(it.label)} editor">${renderItem(it,ev)}</section>${renderSummary(sum)}</div>`;}
function renderItem(it,ev){const warnings=ev.warnings.filter(w=>!w.includes('unfilled')&&!w.startsWith('Core is not selected'));const armor=catalog.armor.find(a=>a.id===it.armorType||a.name===it.armorType),weapon=catalog.weapons.find(w=>w.id===it.weaponType||w.name===it.weaponType);return `<div class="panel-body"><div class="item-heading"><div class="item-icon">${icon(it.slot)}</div><div><h2>${escape(it.label)}</h2><div class="small">${it.slot==='weapon'?'Main-hand weapon':`${acName(it.slot)} AC family`}</div></div><div class="power-tag">+${it.power}<span> / −${it.disruption}</span></div></div><div class="item-fields">${field('Item name · optional',`<input data-field="item-name" value="${escape(it.itemName||'')}" placeholder="Your target ${it.label.toLowerCase()}" maxlength="120">`,true)}${field('Power',`<input type="number" min="0" max="${MAX_POWER}" step="1" data-field="power" value="${it.power}">`)}${field('Disruption',`<input type="number" min="0" max="999" step="1" data-field="disruption" value="${it.disruption}">`)}${it.slot==='chest'?field('Armor base',`<select data-field="armorType">${catalog.armor.map(a=>option(a.name,a.name,it.armorType)).join('')}</select>`,true):''}${it.slot==='weapon'?field('Weapon base',`<select data-field="weaponType">${catalog.weapons.map(w=>option(w.name,w.name,it.weaponType)).join('')}</select>`,true):''}</div>${armor&&it.slot==='chest'?`<div class="small muted">Base AC ${armor.baseAC} · Max DEX +${armor.maxDex} · Check penalty ${armor.checkPenalty} · ${armor.weight} lb</div>`:''}${weapon&&it.slot==='weapon'?`<div class="small muted">${weapon.damage} ${weapon.damageType} · ${weapon.critical}${weapon.finesse?' · Finesse':''}${weapon.notes?` · ${escape(weapon.notes)}`:''}</div>`:''}<div class="capacity"><div class="capacity-line"><span>Extrinsic Capacity</span><strong class="${ev.remainingCapacity<0?'negative':''}">${ev.usedCapacity} / ${ev.capacity} used · ${ev.remainingCapacity} left</strong></div><div class="track"><span style="width:${Math.max(0,Math.min(100,ev.usedCapacity/Math.max(ev.capacity,1)*100))}%;${ev.remainingCapacity<0?'background:var(--negative)':''}"></span></div><div class="capacity-equation">${it.power} Power − ${it.disruption} Disruption − ${it.extraExtrinsics*10} for added slots = ${ev.capacity} Capacity</div></div></div>${ev.errors.length?`<div style="padding:0 20px"><div class="issues">${ev.errors.map(e=>`<p>! ${escape(e)}</p>`).join('')}</div></div>`:''}<div class="section core-section"><div class="section-heading"><h3>CORE BONUS</h3><span class="chip silver">No slot · no Capacity cost</span></div><div class="core-row"><div class="core-gem"><span>+${ev.coreValue}</span></div>${it.slot==='weapon'?`<div class="small">Enhancement Bonus<div class="muted small">Fixed on all weapons</div></div>`:`<select data-field="core" aria-label="Core bonus type">${option('','Choose a core stat…',it.core)}${catalog.core.other.map(c=>option(c,c==='AC'?`AC · ${acName(it.slot)}`:c,it.core)).join('')}</select>`}</div></div>${renderPropertySection(it,ev,'intrinsics','INTRINSIC','Fixed on the item','gold')}${renderPropertySection(it,ev,'extrinsics','EXTRINSIC','Mutable with orbs','green')}${renderPropertySection(it,ev,'disrupted','DISRUPTED','Negative properties','red')}<button class="notes-toggle" data-action="notes">${it.notes?'▾':'+'} Item notes</button><div class="notes-body" ${it.notes?'':'hidden'}><textarea data-field="notes" aria-label="Item notes" placeholder="Current rolls or changes to make…">${escape(it.notes)}</textarea></div>${warnings.length?`<div class="section small muted">${warnings.map(e=>`<p>${escape(e)}</p>`).join('')}</div>`:''}`;}
function scalingHint(it,row,group){
  if(!row?.property)return '';
  const key=group==='disrupted'?'minDisruption':'minPower',value=group==='disrupted'?it.disruption:it.power;
  const threshold=rank=>row.propertyId==='spell_slot'&&/^(paladin|ranger)$/i.test(row.subtype)?({1:1,2:20,3:40}[rank.value]??Infinity):rank[key];
  const next=row.property.ranks.find(rank=>Number.isFinite(threshold(rank))&&threshold(rank)>value);
  return next?`Next ${next.label} at ${group==='disrupted'?'D':'P'}${threshold(next)}`:'Max rank';
}
function renderPropertySection(it,ev,group,title,badge,color){const rows=it[group],resolved=ev.rows[group];let controls='';if(group==='intrinsics')controls=`<div class="count-controls">Slots <select class="count-select" aria-label="Intrinsic slots" data-field="intrinsicCount">${[1,2,3].map(n=>option(n,n,rows.length)).join('')}</select></div>`;if(group==='extrinsics')controls=`<div class="count-controls">Original <select class="count-select" aria-label="Original extrinsic slots" data-field="baseExtrinsics">${[1,2,3,4].map(n=>option(n,n,it.baseExtrinsics)).join('')}</select> + <input class="count-select" style="width:46px" aria-label="Added extrinsic slots" type="number" min="0" max="50" value="${it.extraExtrinsics}" data-field="extraExtrinsics"></div>`;return `<div class="section" data-property-section="${group}"><div class="section-heading"><h3>${title}<span class="count">${rows.filter(Boolean).length}/${rows.length}</span></h3>${controls}</div><div class="property-list">${rows.map((s,i)=>{const r=resolved[i];return `<div class="property-row ${s?'filled':''} ${group==='disrupted'?'disrupted':''}"><button class="prop-main" data-action="pick" data-group="${group}" data-index="${i}" aria-label="${s?'Edit':'Choose'} ${title.toLowerCase()} ${i+1}"><span class="prop-symbol">${s?(group==='disrupted'?'−':'◆'):'+'}</span>${s?`<span class="prop-copy"><span class="prop-name">${escape(r?.propertyLabel||s.custom?.label||'Unknown property')}${r?.subtypeLabel?` · ${escape(r.subtypeLabel)}`:''}</span><span class="prop-detail">${r?.custom?'Unlisted · verify in game':group==='extrinsics'?`${r?.capacity??0} Capacity · requires P${r?.minPower??'?'} · R${r?.rarity??1}`:escape(scalingHint(it,r,group))}</span></span><span class="prop-value">${escape(r?.custom?s.custom?.detail||'Manual':r?.rank?.label||'Unavailable')}</span>`:`<span class="prop-empty">Choose ${title.toLowerCase()} ${i+1}</span>`}</button>${s?`<button class="remove-prop" aria-label="Clear ${title.toLowerCase()} ${i+1}" data-action="clear" data-group="${group}" data-index="${i}">×</button>`:''}</div>`;}).join('')}${!rows.length?'<div class="empty-disruption">No disruption. No negative slots.</div>':''}</div>${group==='extrinsics'?'<div class="blank-hint">10 Capacity per added slot.</div>':''}</div>`;}
function renderSummary(sum){const issues=sum.issues||[], attrs=sum.attributes||{};const stats=(sum.stats||[]).filter(s=>!/^ac:|^ability:|^capstone$/.test(s.key)&&!ABILITIES.some(a=>s.label===a));const complete=build().items.filter(i=>completeness(i).done).length;return `<aside class="panel summary" aria-label="Gear modifier summary"><div class="panel-head"><div class="summary-title"><h2>Gear modifiers</h2><span class="chip ${issues.length?'red':'green'}">${complete}/10 filled</span></div></div><div class="summary-block"><div class="summary-label">ABILITY SCORES</div><div class="attribute-grid">${ABILITIES.map(a=>`<div class="attribute"><span>${a.slice(0,3).toUpperCase()}</span><strong>${signed(attrs[a]||0)}</strong></div>`).join('')}</div></div><div class="summary-block"><div class="summary-label">DEFENSE & ATTACK</div><div class="stat-line"><span>Equipment AC bonus</span><strong>+${sum.ac?.total||0}</strong></div><div class="stat-source">Highest of each AC family</div>${['armor','natural','deflection','dodge'].map(k=>`<div class="stat-line"><span class="muted">${k==='armor'?'Armor enchantment':k[0].toUpperCase()+k.slice(1)}</span><span>+${sum.ac?.[k]||0}</span></div>`).join('')}<div class="stat-line"><span>Capstone attack bonus</span><strong>+${sum.capstone||0}<span class="muted small"> / +5</span></strong></div></div><div class="summary-block summary-more"><div class="summary-label">OTHER EFFECTS <span class="muted">· click for sources</span></div>${stats.length?stats.map(s=>`<details class="stat-detail"><summary><div class="stat-line"><span>${escape(s.label)}</span><strong class="${typeof s.value==='number'&&s.value<0?'negative':''}">${escape(s.display??signed(s.value||0))}</strong></div></summary><div class="stat-source">${(s.sources||[]).map(src=>escape(typeof src==='string'?src:`${src.itemLabel||''}${src.itemLabel?' · ':''}${src.label||''}`)).join('<br>')}${s.capped?`<br>Raw net ${signed(s.rawValue)}; equipment cap +5.`:''}</div></details>`).join(''):'<div class="summary-empty">No effects selected.</div>'}</div>${issues.length?`<div class="summary-block"><div class="summary-label">NEEDS ATTENTION · ${issues.length}</div>${issues.slice(0,7).map(i=>`<p class="warning-text"><button class="text-link" data-action="slot" data-id="${escape(i.itemId)}">${escape(i.label)}</button><br>${escape(i.message)}</p>`).join('')}${issues.length>7?'<p class="small muted">Open individual items for all details.</p>':''}</div>`:''}</aside>`;}
function rowText(it,ev,g){return ev.rows[g].filter(Boolean).map(r=>escape(r.label)).join('<br>')||'<span class="muted">Unplanned</span>';}
function renderOverview(){return `<div class="overview-grid">${build().items.map(it=>{const ev=evaluateItem(it,catalog);return `<article class="panel overview-card"><div class="overview-top">${icon(it.slot)}<div><h2>${escape(it.label)}</h2><span class="small muted">${escape(it.itemName||'Target item')} · P${it.power} / D${it.disruption}</span></div><button data-action="slot" data-id="${it.id}">Edit →</button></div><div class="mini-props"><div class="mini-row"><span class="label">Core</span><span class="value">${it.core?`+${ev.coreValue} ${escape(it.core)}`:'<span class="muted">Unplanned</span>'}</span></div>${[['intrinsics','Intrinsic'],['extrinsics','Extrinsic'],['disrupted','Disrupted']].map(([g,l])=>`<div class="mini-row"><span class="label">${l}</span><span class="value">${rowText(it,ev,g)}</span></div>`).join('')}</div><div class="capacity-line" style="margin:18px 0 0"><span class="muted">Capacity remaining</span><strong class="${ev.remainingCapacity<0?'negative':''}">${ev.remainingCapacity} / ${ev.capacity}</strong></div>${ev.errors.length?`<div class="warning-text" style="margin-top:10px">${ev.errors.length} rule issue${ev.errors.length>1?'s':''}</div>`:''}</article>`;}).join('')}</div>`;}
function renderLibrary(){return `<div class="library-tools"><input id="library-search" aria-label="Search property library" placeholder="Find a stat, skill, save, or damage bonus…" value="${escape(libraryQuery)}"><select id="library-slot" aria-label="Filter by gear slot">${option('','Every gear slot',librarySlot)}${['head','chest','arms','cloak','ring','belt','neck','boots','weapon'].map(s=>option(s,slotName(s),librarySlot)).join('')}</select><select id="library-kind" aria-label="Property category">${option('positive','Positive properties',libraryKind)}${option('negative','Disrupted properties',libraryKind)}</select></div><div id="library-results">${libraryResults()}</div>`;}
function libraryResults(){const families=(libraryKind==='negative'?catalog.disrupted:catalog.properties).filter(p=>(!librarySlot||p.slots.includes(librarySlot))&&`${p.label} ${(p.subtypes||[]).filter(s=>!librarySlot||!s.slots||s.slots.includes(librarySlot)).map(s=>s.label).join(' ')}`.toLowerCase().includes(libraryQuery.toLowerCase()));return `<div class="library">${families.map(p=>`<article class="panel library-card"><h3>${escape(p.label)}</h3><div class="slot-tags">${p.slots.map(s=>`<button data-action="library-to-slot" data-slot="${s}" title="Open ${slotName(s)}">${slotName(s)} →</button>`).join('')}</div>${p.subtypes?.length?`<p>${p.subtypes.map(s=>`${escape(s.label)}${s.slots?` (${s.slots.map(slotName).join(', ')})`:''}`).join(' · ')}</p>`:''}${p.weaponKinds?`<p>Weapon types: ${p.weaponKinds.map(escape).join(', ')}</p>`:''}<table class="rank-table"><thead><tr><th>Rank</th>${libraryKind==='negative'?'<th>Min disruption</th>':'<th>Capacity</th><th>Min Power</th><th>Rarity</th>'}</tr></thead><tbody>${p.ranks.map(r=>`<tr><td>${escape(r.label)}</td>${libraryKind==='negative'?`<td>${r.minDisruption}</td>`:`<td>${r.capacity}</td><td>${r.minPower}</td><td>${r.rarity||1}</td>`}</tr>`).join('')}</tbody></table><p>Repeat: ${escape({none:'once per item',subtype:'once per subtype per item',subtype_rank:'once per subtype and rank',unspecified:'not documented; verify in game'}[p.repeat]||p.repeat)}.${p.notes?` ${escape(p.notes)}`:''}</p></article>`).join('')}</div>${!families.length?'<div class="no-results">No matching properties. Try another stat or slot.</div>':''}`;}
function renderRules(){return `<div class="rules-layout"><article class="panel rule-card"><h2 style="margin-top:12px">Core and Capacity</h2><p>Core bonuses scale at +1 for every 10 Power, up to +5. Weapons always receive Enhancement; other gear can use AC or one of six abilities.</p><p>Items have 1–3 intrinsics and 1–4 original extrinsic slots. New plans start with two intrinsic slots and three original extrinsic slots per item. Intrinsics are fixed on the item and automatically rank up with Power. Extrinsics can be changed with orbs.</p><div class="formula">Capacity = Power − Disruption<br>− (10 × added extrinsic slots)</div><p>Extrinsic ranks spend that budget. Core bonuses and intrinsics use no Capacity.</p></article><article class="panel rule-card"><h2 style="margin-top:12px">Disruption</h2><p>At zero Disruption there are no negative slots. Otherwise, the slot count is floor(1 + Disruption ÷ 10): D1–9 gives one, D10–19 gives two, D20–29 gives three.</p><p>Negative ranks automatically use the highest documented bracket at the item’s Disruption. Most reach their highest bracket at D15. Fill each negative slot to account for its cost in your loadout.</p><p>The two-thirds-of-Power Disruption limit applies to newly generated gear. Upgraded target plans are allowed to go beyond it. Power is capped at 50 on this server.</p><p>Only extrinsic slots beyond the original generated count reserve 10 Capacity each. Intrinsic and disrupted slots are separate.</p></article><article class="panel rule-card"><h2 style="margin-top:12px">Stacking</h2><table class="rules-table"><tbody><tr><td>Armor enchantment AC</td><td>Armor + helm</td></tr><tr><td>Natural AC</td><td>Amulet + both rings</td></tr><tr><td>Deflection AC</td><td>Belt + bracers</td></tr><tr><td>Dodge AC</td><td>Boots + cloak</td></tr></tbody></table><p style="margin-top:15px">Only the highest bonus in each AC family applies, including competition with spell AC. The planner compares equipment only. Base armor AC is separate; armor plus the usable Dexterity modifier cannot exceed 10.</p><p>Maneuver, Spell, and Gadget DC bonuses each cap at a net +5 after penalties. Each equipped Power 50+ item also adds +1 capstone attack bonus, up to +5.</p><p>Duplicate rules apply per item. Different skills can coexist; two ranks of Rune Damage cannot. Ability Score is nonrepeatable on an item even when the abilities differ.</p></article><article class="panel rule-card"><h2 style="margin-top:12px">Using the planner</h2><p>Pick a gear slot, enter its target Power and Disruption, choose a core, then fill the property slots. Search a family and choose its subtype and extrinsic rank. Only ranks attainable by Power 50 are listed.</p><p>Intrinsic choices describe the loot you need to find. An Orb of Coring lets you select a nonweapon core; an Orb of Extrinsics lets you select valid extrinsics up to the orb’s rarity. Potential rolls extrinsics randomly.</p><p>Use the Property library to find which pieces can carry a stat before committing. All gear gives you a compact loadout view. Make multiple plans under Loadouts and export JSON backups or a readable shopping list.</p><p>The summary shows gear modifiers only. Character base stats, buffs, and feats are excluded.</p></article><article class="panel rule-card rule-wide"><h2 style="margin-top:12px">Sources</h2><p>Catalog: ${catalog.properties.length} positive families, ${catalog.disrupted.length} disruption families, ${catalog.weapons.length} non-ranged weapons, and ${catalog.armor.length} armor bases. Based on <a target="_blank" rel="noreferrer" href="${catalog.source.url}">Equipment and Itemization ↗</a> (revision ${escape(catalog.source.revision)}, modified ${escape(catalog.source.lastModified)}) and the <a target="_blank" rel="noreferrer" href="${catalog.source.skillsUrl}">Skills reference ↗</a> (revision ${escape(catalog.source.skillsRevision)}). ${catalogStatus==='checking'?'Checking the wiki for updates.':catalogStatus==='fallback'?'Using the last available catalog. The wiki refresh did not complete.':'Wiki checked '+escape(catalog.checkedAt)+'.'} The server Power cap is 50; higher-Power ranks shown in the wiki are excluded here.</p><p>The itemization page does not enumerate item feats, class resource names, or spell-to-slot compatibility. Use an unlisted property for a feat like Improved Sneak Attack I, or a manual spell/resource subtype. These entries are marked for in-game verification. Unlisted properties do not enter stat totals. Custom extrinsic costs use your entered value; an unknown cost makes the budget incomplete. Damage-bonus repeat rules and vulnerability subtype coverage also need in-game verification.</p><p>Weight Reduction uses the wiki’s rank labels. Rune, oil, sneak, cleave, spell, and critical effects remain distinct conditions. Damage dice are not converted into a misleading total damage value.</p></article></div>`;}

function openPicker(group,index){
  const it=item(), selection=it[group][index];
  const resolved=evaluateItem(it,catalog).rows[group][index];
  pick={
    group,index,query:'',available:false,
    propertyId:selection?.custom?'custom':selection?.propertyId||'',
    rankIndex:resolved?.rankIndex??-1,
    savedLabel:resolved?.label||'',
    subtype:selection?.subtype||'',
    custom:selection?.custom?clone(selection.custom):{label:'',detail:'',capacity:''}
  };
  renderPicker();
  picker.showModal();
  setTimeout(()=>$('#picker-search')?.focus(),20);
}
function pickFamilies(){return propertyOptions(item(),catalog,pick.group).filter(p=>(!pick.available||p.ranks.some(r=>(pick.group==='disrupted'?r.minDisruption:r.minPower)<=(pick.group==='disrupted'?item().disruption:item().power)))&&`${p.label} ${(p.subtypes||[]).filter(s=>!s.slots||s.slots.includes(item().slot)).map(s=>s.label).join(' ')}`.toLowerCase().includes(pick.query.toLowerCase()));}
function effectivePower(p,r){if(p.id==='spell_slot'&&/^(paladin|ranger)$/i.test(pick.subtype)){return {1:1,2:20,3:40}[r.value]??Infinity;}return r.minPower;}
function autoRank(p){let idx=-1;p.ranks.forEach((r,i)=>{if((pick.group==='disrupted'?r.minDisruption:effectivePower(p,r))<=(pick.group==='disrupted'?item().disruption:item().power))idx=i;});return idx;}
function chooseFamily(id){pick.propertyId=id;pick.subtype='';pick.savedLabel='';const p=propertyOptions(item(),catalog,pick.group).find(p=>p.id===id);if(p){const subs=(p.subtypes||[]).filter(s=>!s.slots||s.slots.includes(item().slot));pick.subtype=subs[0]?.id||'';const ev=evaluateItem(item(),catalog);let idx=0;p.ranks.forEach((r,i)=>{if(effectivePower(p,r)<=item().power&&(r.capacity||0)<=ev.remainingCapacity+(pick.group==='extrinsics'?(ev.rows.extrinsics[pick.index]?.capacity||0):0))idx=i;});pick.rankIndex=idx;}renderPickerBody();}
function renderPicker(){picker.innerHTML=`<div class="dialog-head"><div><div class="eyebrow" style="margin-bottom:8px">${escape(item().label)} · ${pick.group==='disrupted'?'DISRUPTION':'POWER'} ${pick.group==='disrupted'?item().disruption:item().power}</div><h2 id="picker-title">Choose ${pick.group==='intrinsics'?'intrinsic':pick.group==='disrupted'?'disrupted':'extrinsic'} ${pick.index+1}</h2></div><button class="close-dialog" data-action="close-picker" aria-label="Close property picker">×</button></div><div class="picker-tools"><input id="picker-search" placeholder="Search properties or subtypes…" aria-label="Search properties" value="${escape(pick.query)}"><label class="checkbox"><input type="checkbox" id="picker-available"${pick.available?' checked':''}> Available at this ${pick.group==='disrupted'?'Disruption':'Power'}</label></div><div class="picker-body"><div class="picker-list" id="picker-list"></div><div class="picker-details" id="picker-details"></div></div>`;renderPickerBody();}
function renderPickerBody(){const families=pickFamilies();$('#picker-list').innerHTML=families.map(p=>`<button class="picker-option ${pick.propertyId===p.id?'active':''}" data-action="choose-family" data-property="${p.id}"><strong>${escape(p.label)}</strong><span>${pick.group==='disrupted'?`D${p.ranks[0].minDisruption}+`:pick.group==='intrinsics'?`P${p.ranks[0].minPower}+ · Scales with Power`:`P${p.ranks[0].minPower}+ · ${p.ranks[0].capacity}–${p.ranks.at(-1).capacity} Capacity`}${p.unverifiedSlots?' · verify slot':''}</span></button>`).join('')+`<button class="picker-option ${pick.propertyId==='custom'?'active':''}" data-action="choose-family" data-property="custom"><strong>＋ Unlisted / legacy property</strong><span>Manual entry · verify in game</span></button>`;renderPickerDetails();}
function renderPickerDetails(){if(pick.propertyId==='custom'){$('#picker-details').innerHTML=`<h3>Unlisted property</h3><p>Track a feat or legacy property the wiki does not document. It stays outside calculated stat totals.</p><label>Property name<input id="custom-label" value="${escape(pick.custom.label)}" placeholder="Improved Sneak Attack I" maxlength="120"></label><label>Value / detail<input id="custom-detail" value="${escape(pick.custom.detail)}" placeholder="Optional effect or rank" maxlength="120"></label>${pick.group==='extrinsics'?`<label>Capacity cost · if known<input id="custom-capacity" type="number" min="0" value="${escape(pick.custom.capacity)}" placeholder="Leave blank if unknown"></label>`:''}<div class="chip silver">Unverified · manual tracking</div><button class="primary" data-action="apply-property">Use unlisted property</button>`;return;}const p=propertyOptions(item(),catalog,pick.group).find(p=>p.id===pick.propertyId);if(!p){
  $('#picker-details').innerHTML=pick.savedLabel
    ? `<div class="no-results">${escape(pick.savedLabel)} is unavailable for this slot. Choose another property to replace it.</div>`
    : '<div class="no-results">Choose a property on the left to see its ranks, cost, and subtypes.</div>';
  return;
}
const subs=(p.subtypes||[]).filter(s=>!s.slots||s.slots.includes(item().slot));
if(subs.length)pick.subtype=(subs.find(s=>s.id===pick.subtype||s.label===pick.subtype)||subs[0]).id;
const automatic=pick.group!=='extrinsics';
const selectedRank=p.ranks[pick.rankIndex];
const idx=automatic?autoRank(p):selectedRank&&Number.isFinite(effectivePower(p,selectedRank))?pick.rankIndex:-1;
const rank=p.ranks[idx];$('#picker-details').innerHTML=`<h3>${escape(p.label)}</h3><span class="chip ${pick.group==='disrupted'?'red':'green'}">${automatic?'Rank follows '+(pick.group==='disrupted'?'Disruption':'Power'):'Choose an extrinsic rank'}</span>${subs.length?`<label>Subtype<select id="pick-subtype">${subs.map(s=>option(s.id,s.label,pick.subtype)).join('')}</select></label>`:p.freeSubtype?`<label>${p.id==='cast_spell'?'Spell name':'Resource name'}<input id="pick-subtype" placeholder="Enter the in-game name" value="${escape(pick.subtype)}" maxlength="120"></label>`:''}${automatic?`<div class="rank-preview ${pick.group==='disrupted'?'disrupt-preview':''}">${escape(rank?.label||'Unavailable')}</div>`:`<label>Rank<select id="pick-rank">${idx<0?'<option value="-1" selected disabled>Choose a rank…</option>':''}${p.ranks.map((r,i)=>Number.isFinite(effectivePower(p,r))?option(i,`${r.label} · ${r.capacity} Capacity · P${effectivePower(p,r)}+ · R${r.rarity||1}`,idx):'').join('')}</select></label>`}${!automatic&&idx<0&&pick.savedLabel?`<p class="warning-text">Saved selection: ${escape(pick.savedLabel)}. Choose an available rank to replace it.</p>`:''}${rank?`<p>${pick.group==='extrinsics'?`${rank.capacity} Capacity · requires Power ${effectivePower(p,rank)} · rarity ${rank.rarity||1}`:pick.group==='intrinsics'?'Intrinsic ranks scale automatically. The planner reserves no Capacity for them.':`Requires Disruption ${rank.minDisruption}. The highest eligible bracket is used.`}</p>`:''}${p.notes?`<p>${escape(p.notes)}</p>`:''}${p.unverifiedSlots?'<p class="warning-text">Spell-to-slot compatibility is not documented. Verify this combination in game.</p>':''}${p.id==='spell_slot'?'<p>Paladin/Ranger: L1 at P1, L2 at P20, L3 at P40; no L4/L5.</p>':''}${rank&&pick.group==='extrinsics'&&effectivePower(p,rank)>item().power?'<p class="warning-text">This rank needs more Power. You can keep it as a target; the item will show a rule issue.</p>':''}<button class="primary" data-action="apply-property" ${rank?'':'disabled'}>Use ${pick.group==='intrinsics'?'intrinsic':pick.group==='disrupted'?'disrupted property':'extrinsic'}</button>`;}
function applyProperty(){
  const {group,index}=pick;
  let selection;
  if(pick.propertyId==='custom'){
    if(!pick.custom.label.trim()){toast('Enter a property name first.');return;}
    selection={custom:clone(pick.custom)};
    if(selection.custom.capacity==='')delete selection.custom.capacity;
  }else{
    const property=propertyOptions(item(),catalog,group).find(p=>p.id===pick.propertyId);
    if(!property)return;
    if(property.freeSubtype&&!pick.subtype.trim()){toast('Enter the in-game subtype name first.');return;}
    const rankIndex=group==='extrinsics'?pick.rankIndex:autoRank(property);
    const rank=property.ranks[rankIndex];
    if(!rank || (group==='extrinsics'&&!Number.isFinite(effectivePower(property,rank))))return;
    selection={propertyId:property.id,rankIndex,subtype:pick.subtype};
    if(group==='extrinsics'){
      selection.rankId=rankIdentity(rank.label);
      const legacyRanks=catalog.legacyRankIds?.[property.id];
      if(legacyRanks){
        const legacyIndex=legacyRanks.indexOf(selection.rankId);
        // Legacy readers must flag an unknown rank instead of selecting a different one.
        selection.rankIndex=legacyIndex<0?legacyRanks.length:legacyIndex;
      }
    }
  }
  picker.close();
  mutate(()=>item()[group][index]=selection);
}

function showLoadouts(){
  const rows = state.builds.map((loadout, index) => {
    const name = String(loadout.name ?? '').trim() || 'Untitled loadout';
    const id = escape(loadout.id);
    const active = loadout.id === state.activeId;
    const modified = modifiedDate(loadout.modifiedAt);
    const modifiedId = `loadout-modified-${index}`;
    const portrait = validatePortrait(loadout.portrait)
      ? `<img class="loadout-thumbnail" src="${escape(loadout.portrait)}" width="27" height="36" alt="">`
      : '';
    return `<div class="manage-row">
      <button type="button" class="loadout-open" data-action="load-build" data-id="${id}" aria-label="Open ${escape(name)}" aria-describedby="${modifiedId}"${active ? ' aria-current="true"' : ''}>
        ${portrait}<span class="loadout-label">
          <span>${escape(name)}</span>
          <span class="loadout-modified" id="${modifiedId}">${modified
            ? `Modified <time datetime="${modified.toISOString()}">${escape(modifiedFormat.format(modified))}</time>`
            : 'Date unavailable'}</span>
        </span>
        ${active ? '<span class="chip green">Active</span>' : ''}
      </button>
      <button type="button" class="danger subtle" data-action="delete-build" data-id="${id}" aria-label="Delete ${escape(name)}">×</button>
    </div>`;
  }).join('');
  manage.innerHTML = `<div class="dialog-head"><h2 id="manage-title">Your loadouts</h2><button class="close-dialog" data-action="close-manage" aria-label="Close loadouts">×</button></div>
    <div class="manage-body"><p class="small muted">Saved in this browser.</p>${rows}
      <div class="manage-actions"><button class="primary" data-action="new-build">＋ New blank plan</button><button data-action="duplicate-build">Duplicate current</button><button data-action="import">Import JSON or PNG</button></div>
    </div>`;
  if (!manage.open) manage.showModal();
}
function exportText(){const b=build();return `${b.name}\nRisenholm gear plan · ${new Date().toLocaleDateString()}\nSource: ${catalog.source.url}\n\n`+b.items.map(it=>{const ev=evaluateItem(it,catalog);return `${it.label}${it.itemName?` — ${it.itemName}`:''} [P${it.power}/D${it.disruption}]\n${it.slot==='chest'?`Armor: ${it.armorType}\n`:it.slot==='weapon'?`Weapon: ${it.weaponType}\n`:''}Core: ${it.core?`+${ev.coreValue} ${it.core}`:'unplanned'}\nIntrinsic: ${ev.rows.intrinsics.map(r=>r?.label||'(empty)').join('; ')}\nExtrinsic: ${ev.rows.extrinsics.map(r=>r?.label||'(empty)').join('; ')}\nDisrupted: ${ev.rows.disrupted.map(r=>r?.label||'(empty)').join('; ')||'none'}\nCapacity: ${ev.usedCapacity}/${ev.capacity} (${it.baseExtrinsics} original + ${it.extraExtrinsics} added extrinsic slots)${ev.errors.length?'\nIssues: '+ev.errors.join('; '):''}${it.notes?'\nNotes: '+it.notes:''}`;}).join('\n\n')+'\n\nGear contributions only; partial plans omit unknown effects. Unlisted entries require in-game verification.';}
function showExports(){manage.innerHTML=`<div class="dialog-head"><h2 id="manage-title">Export loadout</h2><button class="close-dialog" data-action="close-manage" aria-label="Close export">×</button></div><div class="manage-body"><p class="small muted">The PNG includes the loadout and its notes for import.${validatePortrait(build().portrait) ? ' It also includes the portrait.' : ''}</p><div class="manage-actions" style="margin:0 0 18px"><button class="primary" data-action="download-png">Download PNG</button><button data-action="download-json">Download JSON</button><button data-action="download-text">Download list</button><button data-action="copy-text">Copy list</button></div><textarea class="text-export" id="text-export" aria-label="Readable gear plan" readonly>${escape(exportText())}</textarea></div>`;manage.showModal();}
function exportPayload(loadout = build()) {
  return {format:'risenholm-gear-plan',version:1,source:catalog.source,exportedAt:new Date().toISOString(),build:loadout};
}

function download(blob, extension, name = build().name) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${name.replace(/[^a-z0-9]+/gi,'-').replace(/^-|-$/g,'') || 'risenholm-plan'}.${extension}`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function downloadPng(button) {
  button.disabled = true;
  try {
    const loadout = clone(build());
    const payload = exportPayload(loadout);
    const image = await renderLoadoutImage(loadout, catalog);
    download(await embedLoadoutInPng(image, payload), 'png', loadout.name);
    toast('Loadout image downloaded.');
  } catch (error) {
    toast(`Image export failed: ${error.message}`);
  } finally {
    button.disabled = false;
  }
}
function importBuild(raw){const value=raw.build||raw;if(!value||!Array.isArray(value.items)||value.items.length!==10)throw Error('A plan must have exactly ten equipment items.');const b=fresh();const modified=modifiedDate(value.modifiedAt);
if(modified)b.modifiedAt=modified.toISOString();else delete b.modifiedAt;
b.name=String(value.name||'Imported loadout').slice(0,100);b.notes=String(value.notes||'');if(value.portrait!=null){if(!validatePortrait(value.portrait))throw Error('Invalid character portrait.');b.portrait=value.portrait;}b.items=SLOT_DEFINITIONS.map(def=>{const src=value.items.find(i=>i.id===def.id);if(!src||src.slot!==def.slot)throw Error(`Missing or invalid ${def.label}.`);const it={...createItem(def.slot,def.id),...src,id:def.id,slot:def.slot,label:def.label};for(const k of ['power','disruption','baseExtrinsics','extraExtrinsics']){if(!Number.isInteger(it[k])||it[k]<0||it[k]>100000)throw Error(`Invalid ${k} on ${def.label}.`);}if(it.power>MAX_POWER)throw Error(`Power is capped at ${MAX_POWER}: ${def.label} has Power ${it.power}.`);if(it.disruption>999||it.extraExtrinsics>50||it.baseExtrinsics<1||it.baseExtrinsics>4)throw Error(`Unsupported slot counts on ${def.label}.`);if(!Array.isArray(it.intrinsics)||it.intrinsics.length<1||it.intrinsics.length>3)throw Error('Intrinsic slots must be 1–3.');for(const k of ['intrinsics','extrinsics','disrupted']){if(!Array.isArray(it[k])||it[k].length>1000)throw Error(`Invalid ${k}.`);for(const selection of it[k]){if(selection===null)continue;if(typeof selection!=='object'||Array.isArray(selection))throw Error(`Invalid ${k} property.`);if(selection.custom){const c=selection.custom;if(typeof c!=='object'||typeof c.label!=='string'||!c.label.trim()||(c.detail!==undefined&&typeof c.detail!=='string'))throw Error('Invalid unlisted property.');if(c.capacity!==undefined&&c.capacity!==''&&(!Number.isFinite(Number(c.capacity))||Number(c.capacity)<0))throw Error('Custom Capacity must be nonnegative.');}else if(typeof selection.propertyId!=='string'||(selection.subtype!==undefined&&typeof selection.subtype!=='string')||(selection.rankIndex!==undefined&&(!Number.isInteger(selection.rankIndex)||selection.rankIndex<0))||(selection.rankId!==undefined&&(typeof selection.rankId!=='string'||!selection.rankId||selection.rankId.length>120)))throw Error(`Invalid ${k} selection.`);}}if(it.extrinsics.length!==it.baseExtrinsics+it.extraExtrinsics||it.disrupted.length!==(it.disruption>0?Math.floor(1+it.disruption/10):0))throw Error('Property slots do not match the plan’s counts.');normalizeCounts(it);return it;});return b;}

function setPortraitMenu(control, open) {
  const trigger = control.querySelector('.portrait-trigger');
  trigger.setAttribute('aria-expanded', String(open));
  control.querySelector('.portrait-menu').hidden = !open;
  return trigger;
}

app.addEventListener('pointerover', event => {
  const control = event.target.closest('.portrait-control');
  if (event.pointerType === 'mouse' && control && !control.contains(event.relatedTarget)) {
    setPortraitMenu(control, true);
  }
});
app.addEventListener('pointerout', event => {
  const control = event.target.closest('.portrait-control');
  if (event.pointerType === 'mouse' && control && !control.contains(event.relatedTarget) &&
      !control.querySelector('.portrait-menu').contains(document.activeElement)) {
    setPortraitMenu(control, false);
  }
});
app.addEventListener('focusout', event => {
  const control = event.target.closest('.portrait-control');
  if (control && !control.contains(event.relatedTarget) && !control.matches(':hover')) {
    setPortraitMenu(control, false);
  }
});
document.addEventListener('keydown', event => {
  if (event.key !== 'Escape' || picker.open || manage.open) return;
  const trigger = app.querySelector('.portrait-trigger[aria-expanded="true"]');
  if (!trigger) return;
  const control = trigger.closest('.portrait-control');
  const focusWasInside = control.contains(document.activeElement);
  event.preventDefault();
  setPortraitMenu(control, false);
  if (focusWasInside) trigger.focus();
});

document.addEventListener('click',async event=>{
  const portraitControl = app.querySelector('.portrait-control');
  if (portraitControl && !portraitControl.contains(event.target)) setPortraitMenu(portraitControl, false);
  const el=event.target.closest('[data-action],[data-view]');if(!el)return;if(el.dataset.view){event.preventDefault();view=el.dataset.view;render();return;}const a=el.dataset.action;switch(a){case 'slot':activeItem=el.dataset.id;view='planner';render();if(innerWidth<681)app.querySelector('.editor')?.scrollIntoView({behavior:'smooth',block:'start'});break;case 'pick':openPicker(el.dataset.group,Number(el.dataset.index));break;case 'clear':mutate(()=>item()[el.dataset.group][Number(el.dataset.index)]=null);break;case 'notes':{const n=app.querySelector('.notes-body');n.hidden=!n.hidden;break;}case 'undo':if(history.length){numericEdit=null;state=history.pop();save();render();toast('Last change undone.');}break;case 'close-picker':picker.close();break;case 'choose-family':chooseFamily(el.dataset.property);break;case 'apply-property':applyProperty();break;case 'portrait-options': {
    const isMouse = event.pointerType === 'mouse' || (!event.pointerType && event.detail > 0);
    setPortraitMenu(portraitControl, isMouse || el.getAttribute('aria-expanded') === 'false');
    break;
  }
  case 'choose-portrait':
    if (portraitControl) setPortraitMenu(portraitControl, false).focus();
    $('#portrait-file').click();
    break;
  case 'remove-portrait': {
    const loadout = build();
    portraitUploads.delete(loadout);
    mutate(() => delete loadout.portrait);
    app.querySelector('[data-action="choose-portrait"]')?.focus();
    break;
  }
  case 'loadouts':showLoadouts();break;case 'close-manage':manage.close();break;case 'exports':showExports();break;case 'new-build':mutate(()=>{const b=fresh();b.name=`Loadout ${state.builds.length+1}`;state.builds.push(b);state.activeId=b.id;});manage.close();view='planner';render();break;case 'duplicate-build':mutate(()=>{const b=clone(build());b.id=uid();b.name=`${b.name} · copy`;b.modifiedAt=now();state.builds.push(b);state.activeId=b.id;});showLoadouts();break;case 'load-build':state.activeId=el.dataset.id;save();manage.close();render();break;case 'delete-build':mutate(()=>{state.builds=state.builds.filter(b=>b.id!==el.dataset.id);if(!state.builds.length)state.builds=[fresh()];if(!state.builds.some(b=>b.id===state.activeId))state.activeId=state.builds[0].id;});showLoadouts();toast('Loadout removed. Undo can restore it.');break;case 'import':$('#import-file').click();break;case 'download-png':await downloadPng(el);break;case 'download-json':download(new Blob([JSON.stringify(exportPayload(),null,2)],{type:'application/json'}),'json');toast('JSON backup downloaded.');break;case 'download-text':download(new Blob([exportText()],{type:'text/plain'}),'txt');toast('Shopping list downloaded.');break;case 'copy-text':try{await navigator.clipboard.writeText(exportText());toast('Shopping list copied.');}catch{$('#text-export').select();toast('Select and copy the list from the text box.');}break;case 'library-to-slot':activeItem=build().items.find(i=>i.slot===el.dataset.slot).id;view='planner';render();break;}});
document.addEventListener('input',event=>{const el=event.target;if(['power','disruption'].includes(el.dataset.field)){updateNumericInput(el);return;}if(el.id==='picker-search'){pick.query=el.value;renderPickerBody();}else if(el.id==='library-search'){libraryQuery=el.value;$('#library-results').innerHTML=libraryResults();}else if(el.dataset.field==='build-name'){const loadout=build();if(loadout.name!==el.value){loadout.name=el.value;loadout.modifiedAt=now();save();}}else if(el.id==='custom-label')pick.custom.label=el.value;else if(el.id==='custom-detail')pick.custom.detail=el.value;else if(el.id==='custom-capacity')pick.custom.capacity=el.value===''?'':Math.max(0,Number(el.value));else if(el.id==='pick-subtype'&&el.tagName==='INPUT')pick.subtype=el.value;});
document.addEventListener('change',event=>{const el=event.target;if(['power','disruption'].includes(el.dataset.field)){updateNumericInput(el,true);return;}if(el.id==='picker-available'){pick.available=el.checked;renderPickerBody();return;}if(el.id==='pick-subtype'){pick.subtype=el.value;if(el.tagName==='SELECT')renderPickerDetails();return;}if(el.id==='pick-rank'){pick.rankIndex=Number(el.value);renderPickerDetails();return;}if(el.id==='library-slot'){librarySlot=el.value;$('#library-results').innerHTML=libraryResults();return;}if(el.id==='library-kind'){libraryKind=el.value;$('#library-results').innerHTML=libraryResults();return;}const f=el.dataset.field;if(!f||f==='build-name')return;mutate(()=>{const it=item();if(['extraExtrinsics','baseExtrinsics'].includes(f)){let n=Math.max(0,Math.floor(Number(el.value)||0));if(f==='extraExtrinsics')n=Math.min(50,n);it[f]=n;normalizeCounts(it);}else if(f==='intrinsicCount')it.intrinsics=resize(it.intrinsics,Number(el.value));else if(f==='item-name')it.itemName=el.value;else it[f]=el.value;});});
$('#portrait-file').addEventListener('change', async event => {
  const file = event.target.files[0];
  if (!file) return;
  event.target.value = '';
  const loadout = build();
  const request = Symbol();
  portraitUploads.set(loadout, request);
  try {
    const portrait = await normalizePortrait(file);
    if (portraitUploads.get(loadout) !== request || !state.builds.includes(loadout)) return;
    mutate(() => { loadout.portrait = portrait; }, loadout);
  } catch (error) {
    if (portraitUploads.get(loadout) === request && state.builds.includes(loadout)) toast(error.message);
  } finally {
    if (portraitUploads.get(loadout) === request) portraitUploads.delete(loadout);
  }
});

document.addEventListener('error', event => {
  if (event.target.matches?.('.loadout-portrait, .loadout-thumbnail')) event.target.hidden = true;
}, true);

$('#import-file').addEventListener('change', async event => {
  const file = event.target.files[0];
  if (!file) return;
  try {
    const png = file.type === 'image/png' || /\.png$/i.test(file.name);
    if (!png && file.size > 1000000) throw Error('Plan file is too large.');
    const payload = png ? await readLoadoutFromPng(file) : JSON.parse(await file.text());
    const imported = importBuild(payload);
    view = 'planner';
    manage.close();
    mutate(() => {
      state.builds.push(imported);
      state.activeId = imported.id;
    });
    toast('Loadout imported.');
  } catch (error) {
    toast(`Import failed: ${error.message}`);
  } finally {
    event.target.value = '';
  }
});

function showRefreshedCatalog() {
  if (pendingCatalog && !picker.open && !manage.open &&
      !app.querySelector('.portrait-trigger[aria-expanded="true"]') &&
      !document.activeElement?.matches('#app input, #app textarea, #app select')) render();
}
for (const dialog of [picker, manage]) dialog.addEventListener('close', showRefreshedCatalog);
wiki.refresh?.then(result => {
  pendingCatalog = result;
  showRefreshedCatalog();
});
for(const dialog of [picker,manage])dialog.addEventListener('click',e=>{if(e.target===dialog){const r=dialog.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)dialog.close();}});
save();render();
