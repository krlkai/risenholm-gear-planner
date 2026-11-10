/* Rules are based on the Risenholm Equipment and Itemization wiki.
 * This is a target-item planner, not an item generator or character simulator. */
export const MAX_POWER = 50;
export const SLOT_DEFINITIONS = [
  {id:'head',slot:'head',label:'Helm'},
  {id:'arms',slot:'arms',label:'Bracers'},
  {id:'cloak',slot:'cloak',label:'Cloak'},
  {id:'ring-1',slot:'ring',label:'Ring I'},
  {id:'ring-2',slot:'ring',label:'Ring II'},
  {id:'belt',slot:'belt',label:'Belt'},
  {id:'neck',slot:'neck',label:'Amulet'},
  {id:'boots',slot:'boots',label:'Boots'},
  {id:'chest',slot:'chest',label:'Armor'},
  {id:'weapon',slot:'weapon',label:'Weapon'}
];
export const ABILITIES = ['Strength','Dexterity','Constitution','Intelligence','Wisdom','Charisma'];
export const AC_TYPES = {head:'armor',chest:'armor',neck:'natural',ring:'natural',arms:'deflection',belt:'deflection',boots:'dodge',cloak:'dodge'};
const AC_LABELS = {armor:'Armor enchantment AC',natural:'Natural AC',deflection:'Deflection AC',dodge:'Dodge AC'};
const signed = n => `${n >= 0 ? '+' : ''}${Number.isInteger(n) ? n : Number(n.toFixed(3))}`;
const normal = v => String(v ?? '').toLowerCase().replace(/[^a-z0-9]/g,'');
const number = (v,fallback=0) => Number.isFinite(Number(v)) ? Number(v) : fallback;
const clampInteger = (v,min=0) => Math.max(min, Math.floor(number(v)));

export function rankIdentity(label) {
  return String(label ?? '').toLowerCase()
    .replace(/[−–]/g, '-')
    .replace(/\b(\d+)(?:\s*½|\s+1\s*[/⁄]\s*2)\s*hd\b/g, (_,whole)=>`${whole}.5 hd`)
    .replace(/(?:½|\b1\s*[/⁄]\s*2)\s*hd\b/g, '0.5 hd')
    .replace(/\s+/g, '')
    .replace(/lbs$/, 'lb');
}

export function createItem(slot, id) {
  const def = SLOT_DEFINITIONS.find(d=>d.id===id) || SLOT_DEFINITIONS.find(d=>d.id===slot) || SLOT_DEFINITIONS.find(d=>d.slot===slot) || {id:slot,slot,label:slot};
  return {id:id || def.id,slot:def.slot,label:def.label,power:30,disruption:10,
    core:def.slot==='weapon'?'Enhancement':'',baseExtrinsics:3,extraExtrinsics:0,
    intrinsics:[null,null],extrinsics:[null,null,null],disrupted:[null,null],
    armorType:def.slot==='chest'?'Leather Armor':undefined,
    weaponType:def.slot==='weapon'?'Rapier':undefined,notes:''};
}
export function createBuild() {
  return {version:1,name:'My loadout',notes:'',items:SLOT_DEFINITIONS.map(d=>createItem(d.slot,d.id))};
}

function positives(catalog) { return catalog.properties || catalog.positive || []; }
function negatives(catalog) { return catalog.disrupted || catalog.disruptions || []; }
function families(catalog, group) { return group==='disrupted'?negatives(catalog):positives(catalog); }
function itemWeaponKind(item,catalog) {
  const weapon=(catalog.weapons || []).find(w=>w.id===item.weaponType || w.name===item.weaponType || w.label===item.weaponType);
  return weapon?.mystic || weapon?.kind==='mystic' || /casting gauntlet|tome|mystic staff/i.test(item.weaponType||'')?'mystic':'melee';
}
export function propertyAllowed(property,item,catalog={}) {
  if (!property || (property.slots && !property.slots.includes(item.slot) && !property.slots.includes('all'))) return false;
  if (item.slot==='weapon' && property.weaponKinds && !property.weaponKinds.includes(itemWeaponKind(item,catalog))) return false;
  return true;
}
export function propertyOptions(item,catalog,group='extrinsics') {
  return families(catalog,group).filter(p=>propertyAllowed(p,item,catalog));
}
function subtypeOptions(property,item) {
  return (property.subtypes || []).filter(s=>!s.slots || s.slots.includes(item.slot) || s.slots.includes('all'));
}
function rankPower(rank,selection) {
  // Paladin/Ranger bonus slots have a special power progression.
  if (/paladin|ranger/i.test(String(selection?.subtype||'')) && ['spellslot','bonusspellslot'].includes(normal(selection?.propertyId))) {
    const level=number(rank.value, number(String(rank.label).replace(/\D/g,'')));
    return {1:1,2:20,3:40}[level] ?? Infinity;
  }
  return number(rank.minPower);
}
function resolveSelection(selection,group,item,catalog,errors,index) {
  if (!selection) return null;
  if (selection.custom) {
    const custom=selection.custom;
    if(!String(custom.label||'').trim()) errors.push('Enter a name for the unlisted property.');
    const missingCost=custom.capacity===undefined || custom.capacity===null || custom.capacity==='';
    const rawCost=Number(custom.capacity);
    const invalidCost=group==='extrinsics' && !missingCost && (!Number.isFinite(rawCost) || rawCost<0);
    if(invalidCost) errors.push('Unlisted extrinsic Capacity cost must be finite and nonnegative.');
    return {propertyId:'custom',propertyLabel:custom.label||'Unlisted property',label:`${custom.label||'Unlisted property'}${custom.detail?`: ${custom.detail}`:''}`,
      custom:true,capacity:group==='extrinsics' && !missingCost && !invalidCost?rawCost:0,
      unknownCapacity:group==='extrinsics' && (missingCost || invalidCost),group};
  }
  const property=families(catalog,group).find(p=>p.id===selection.propertyId);
  const prefix=`${group==='intrinsics'?'Intrinsic':group==='disrupted'?'Disrupted':'Extrinsic'} ${index+1}`;
  let rankIndex=clampInteger(selection.rankIndex);
  const useRankIdentity=group==='extrinsics' && (selection.rankId!==undefined || !!catalog.legacyRankIds);
  const legacyRanks=Object.hasOwn(catalog.legacyRankIds || {},selection.propertyId)
    ? catalog.legacyRankIds[selection.propertyId]
    : [];
  const rankId=useRankIdentity ? selection.rankId ?? legacyRanks[rankIndex] : undefined;
  const unavailableRow=(propertyLabel)=>({
    propertyId:selection.propertyId,propertyLabel,
    label:`${propertyLabel}${rankId? ` ${rankId}`:''}`,
    subtype:selection.subtype||'',rankIndex:-1,rank:null,capacity:0,group,invalid:true
  });
  if (!property) {
    if (!catalog.legacyRankIds && selection.rankId===undefined) {
      errors.push(`${prefix}: unknown property.`);
      return null;
    }
    errors.push(`${prefix}: ${selection.propertyId} is unavailable in the property library.`);
    return unavailableRow(selection.propertyId);
  }
  if (!propertyAllowed(property,item,catalog)) errors.push(`${prefix}: ${property.label} is not available on this item type.`);
  const ranks=property.ranks || [];
  if (group==='intrinsics') {
    rankIndex=-1;
    ranks.forEach((r,i)=>{if(rankPower(r,selection)<=Math.min(MAX_POWER,number(item.power))) rankIndex=i;});
  } else if (group==='disrupted') {
    rankIndex=-1;
    ranks.forEach((r,i)=>{if(number(r.minDisruption)<=number(item.disruption)) rankIndex=i;});
  } else if (useRankIdentity) {
    rankIndex=rankId ? ranks.findIndex(r=>rankIdentity(r.label)===rankId) : -1;
  }
  const rank=ranks[rankIndex];
  if(!rank) {
    errors.push(group==='extrinsics'
      ? useRankIdentity
        ? `${prefix}: the saved rank${rankId? ` ${rankId}`:''} for ${property.label} is unavailable in the current property library.`
        : `${prefix}: selected rank for ${property.label} is unavailable under the Power ${MAX_POWER} cap.`
      : `${prefix}: ${group==='disrupted'?'Disruption':'Power'} is too low for ${property.label}.`);
    return unavailableRow(property.label);
  }
  if(group!=='disrupted') {
    const requiredPower=rankPower(rank,selection);
    if(requiredPower>MAX_POWER) errors.push(`${prefix}: ${property.label} ${rank.label} is unavailable under the Power ${MAX_POWER} cap.`);
    else if(number(item.power)<requiredPower) errors.push(`${prefix}: ${property.label} ${rank.label} needs Power ${requiredPower}.`);
  }
  const subtype=String(selection.subtype || '').trim();
  const subOptions=subtypeOptions(property,item);
  const selectedSubtype=subOptions.find(s=>s.id===subtype || s.label===subtype);
  if(property.subtypes?.length && !selectedSubtype) errors.push(`${prefix}: choose a valid subtype for ${property.label}.`);
  if(property.freeSubtype && !subtype) errors.push(`${prefix}: enter a subtype for ${property.label}.`);
  const subtypeLabel=selectedSubtype?.label || subtype;
  const label=`${property.label}${subtypeLabel?`: ${subtypeLabel}`:''} ${rank.label}`;
  return {propertyId:property.id,propertyLabel:property.label,subtype,subtypeLabel,rankIndex,rank,label,value:rank.value,
    capacity:group==='extrinsics'?number(rank.capacity):0,minPower:rankPower(rank,selection),minDisruption:rank.minDisruption,
    rarity:number(rank.rarity,number(property.rarity,1)),kind:property.kind,unit:property.unit,group,property};
}
function repeatRule(property) {
  const rule=normal(property.repeat);
  if(rule==='unspecified') return 'yes';
  if (rule.includes('rank')) return 'rank';
  if (rule.includes('subtype') || rule.includes('skill') || rule.includes('damage') || rule.includes('resource') || rule.includes('per') || rule.includes('save') || rule.includes('spell')) return 'subtype';
  return rule==='true' || rule==='yes' || rule==='repeatable'?'yes':'no';
}
function validateRepeats(rows,errors) {
  const seen=new Set();
  for(const row of rows.filter(Boolean)) {
    if(!row.property) continue;
    const rule=repeatRule(row.property);
    if(rule==='yes') continue;
    const key=`${row.propertyId}${rule!=='no'?`:${normal(row.subtype)}`:''}${rule==='rank'?`:${row.rankIndex}`:''}`;
    if(seen.has(key)) errors.push(`${row.propertyLabel}${row.subtypeLabel?`: ${row.subtypeLabel}`:''} is repeated on this item.`);
    seen.add(key);
  }
}
function hasCastSpell(rows) {return rows.some(r=>r?.rank && /castspell/.test(normal(r.propertyId+' '+r.propertyLabel)));}

export function evaluateItem(item,catalog) {
  const errors=[],warnings=[];
  const power=number(item.power),disruption=number(item.disruption);
  if(!Number.isInteger(power)||power<0) errors.push('Power must be a nonnegative whole number.');
  if(power>MAX_POWER) errors.push(`Power cannot exceed ${MAX_POWER}. This saved item needs to be revised.`);
  if(!Number.isInteger(disruption)||disruption<0) errors.push('Disruption must be a nonnegative whole number.');
  const base=number(item.baseExtrinsics),extra=number(item.extraExtrinsics);
  if(!Number.isInteger(base)||base<1||base>4) errors.push('Original extrinsic slot count must be 1–4.');
  if(!Number.isInteger(extra)||extra<0) errors.push('Added extrinsic slot count must be a nonnegative whole number.');
  if((item.intrinsics||[]).length<1||(item.intrinsics||[]).length>3) errors.push('An item must have 1–3 intrinsic slots.');
  if((item.extrinsics||[]).length!==base+extra) errors.push('Extrinsic slot count does not match original plus added slots.');
  const disruptedCount=disruption>0?Math.floor(1+disruption/10):0;
  if((item.disrupted||[]).length!==disruptedCount) errors.push(`Disruption ${disruption} requires ${disruptedCount} disrupted slots.`);
  const coreValue=Math.min(5,Math.floor(Math.max(0,power)/10));
  if(item.slot==='weapon' && item.core!=='Enhancement') errors.push('A weapon’s core is always Enhancement.');
  if(item.slot!=='weapon' && item.core && !['AC',...ABILITIES].includes(item.core)) errors.push('Choose AC or an ability score as the core.');
  if(item.slot!=='weapon' && !item.core) warnings.push('Core is not selected; gear totals are incomplete.');
  const rows={};
  for(const group of ['intrinsics','extrinsics','disrupted']) rows[group]=(item[group]||[]).map((s,i)=>resolveSelection(s,group,item,catalog,errors,i));
  const unfilled=Object.values(rows).flat().filter(r=>!r).length;
  if(unfilled) warnings.push(`${unfilled} property slot${unfilled===1?' is':'s are'} unfilled; gear totals are partial.`);
  const positiveRows=[...rows.intrinsics,...rows.extrinsics];
  validateRepeats(positiveRows,errors);
  validateRepeats(rows.disrupted,errors);
  if(!hasCastSpell(positiveRows)) {
    for(const row of [...positiveRows,...rows.disrupted].filter(Boolean)) {
      if(/increasedcharges|reducedcharges/.test(normal(row.propertyId+' '+row.propertyLabel))) errors.push(`${row.propertyLabel} requires a Cast Spell property on this item.`);
    }
  }
  if(positiveRows.some(r=>r?.property?.freeSubtype && /castspell/.test(normal(r.propertyId)))) warnings.push('Spell name and item-slot eligibility need in-game verification; the wiki does not list the spell catalog.');
  if(positiveRows.some(r=>r?.property?.freeSubtype && !/castspell/.test(normal(r.propertyId)))) warnings.push('Custom subtype names are recorded as entered; verify them in game.');
  if([...positiveRows,...rows.disrupted].some(r=>r?.custom)) warnings.push('Unlisted property: verify in game; excluded from stat totals.');
  if(positiveRows.some(r=>r?.unknownCapacity)) warnings.push('An unlisted extrinsic has unknown Capacity cost; the remaining Capacity is provisional.');
  if(positiveRows.some(r=>r?.property?.repeat==='unspecified')) warnings.push('The wiki does not specify repeat rules for percentage damage bonuses; repeated families need in-game verification.');
  const usedCapacity=rows.extrinsics.reduce((sum,r)=>sum+(r?.capacity||0),0);
  const capacity=power-disruption-10*extra;
  const remainingCapacity=capacity-usedCapacity;
  if(remainingCapacity<0) errors.push(`Over Capacity by ${-remainingCapacity}. Increase Power, lower Disruption, or reduce extrinsics.`);
  const charges=hasCastSpell(positiveRows)?Math.max(0,[...positiveRows,...rows.disrupted].reduce((total,r)=>{
    if(!r?.rank) return total;
    if(r.propertyId==='cast_spell') return total+number(r.value);
    if(r.propertyId==='charges'||r.propertyId==='reduced_charges') return total+number(r.value);
    return total;
  },0)):0;
  return {itemId:item.id,coreValue,capacity,usedCapacity,remainingCapacity,disruptedCount,charges,errors:[...new Set(errors)],warnings:[...new Set(warnings)],rows,valid:errors.length===0};
}

function statIdentity(row) {
  let id=normal(row.propertyId+' '+row.propertyLabel);
  const negative=row.group==='disrupted';
  if(/generalsave/.test(id)) return {key:`save:${normal(row.subtypeLabel)}`,label:`${row.subtypeLabel||'General'} save`,unit:'',sign:negative?-1:1};
  if(/savesvsspecific|specificsave/.test(id)) return {key:`specificsave:${normal(row.subtypeLabel)}`,label:`Save vs ${row.subtypeLabel}`,unit:'',sign:negative?-1:1};
  if(/skill/.test(id)) return {key:`skill:${normal(row.subtypeLabel)}`,label:`${row.subtypeLabel||'Skill'} skill`,unit:'',sign:negative?-1:1};
  if(/damageimmunity|damagevulnerability|vulnerability/.test(id)) return {key:`immunity:${normal(row.subtypeLabel)}`,label:`${row.subtypeLabel||'Damage'} immunity`,unit:'%',sign:negative?-1:1};
  if(/bonushp|reducedhp/.test(id)) return {key:'hp',label:'Bonus HP',unit:' × HD',sign:negative?-1:1};
  if(/stability/.test(id)) return {key:'stability',label:'Stability',unit:'',sign:negative?-1:1};
  if(/maneuverdc/.test(id)) return {key:'maneuverdc',label:'Maneuver DC',unit:'',sign:negative?-1:1,cap:5};
  if(/spelldc/.test(id)) return {key:'spelldc',label:'Spell DC',unit:'',sign:negative?-1:1,cap:5};
  if(/gadgetdc/.test(id)) return {key:'gadgetdc',label:'Gadget DC',unit:'',sign:negative?-1:1,cap:5};
  if(/extramaneuvers|reducedmaneuvers/.test(id)) return {key:'maneuvers',label:'Extra maneuvers',unit:'',sign:negative?-1:1};
  if(/extrametamagic|reducedmetamagic/.test(id)) return {key:'metamagic',label:'Extra metamagic',unit:'',sign:negative?-1:1};
  if(/increasedcharges|reducedcharges/.test(id)) return {key:'charges',label:'Item charges adjustment',unit:'',sign:negative?-1:1,local:true};
  if(/weightreduction|increaseweight/.test(id)) return {key:`weight:${row.propertyId}`,label:row.propertyLabel,unit:/increase/.test(id)?' lb':'%',sign:1,local:true};
  if(/runedamage|oildamage|massivecriticals|sneakattack/.test(id)) return {key:row.propertyId,label:row.propertyLabel,unit:'',sign:1,text:true};
  if(/castspell/.test(id)) return {key:`spell:${normal(row.subtypeLabel)}`,label:`Cast ${row.subtypeLabel||'spell'}`,unit:'',sign:1,text:true,local:true};
  if(/bonusspellslot/.test(id)) return {key:`spellslot:${normal(row.subtypeLabel)}:${row.rankIndex}`,label:`${row.subtypeLabel||'Class'} bonus spell slots (${row.rank.label})`,unit:'',sign:1,count:true};
  if(/abilityscore/.test(id)) return {key:`ability:${row.subtypeLabel}`,label:row.subtypeLabel,unit:'',sign:1,ability:true};
  let label=row.propertyLabel+(row.subtypeLabel?`: ${row.subtypeLabel}`:'');
  return {key:`${row.propertyId}:${normal(row.subtypeLabel)}`,label,unit:row.unit || (/%/.test(row.rank.label)?'%':''),sign:negative?-1:1};
}
function numericValue(row) {
  if(row.kind==='dice') return null;
  if(/\d+d\d+/i.test(String(row.value))) return null;
  if(/\d+d\d+/i.test(row.rank?.label||'')) return null;
  if(typeof row.value==='number') return Math.abs(row.value);
  if(/1\s*1\/2/.test(String(row.value)+' '+row.rank?.label)) return 1.5;
  if(/1\/2/.test(String(row.value)+' '+row.rank?.label)) return 0.5;
  const m=String(row.value ?? row.rank?.label).match(/-?\d+(?:\.\d+)?/);
  return m?Math.abs(Number(m[0])):null;
}

export function summarizeBuild(build,catalog) {
  const items=(build.items||[]).map(item=>evaluateItem(item,catalog));
  const attributes=Object.fromEntries(ABILITIES.map(a=>[a,0]));
  const ac={armor:0,natural:0,deflection:0,dodge:0,total:0};
  const statMap=new Map(),issues=[];
  let filledSlots=0,totalSlots=0,plannedItems=0;
  const addStat=(info,value,source,textValue)=>{
    if(!statMap.has(info.key)) statMap.set(info.key,{...info,value:0,sources:[],parts:[]});
    const stat=statMap.get(info.key);
    if(typeof value==='number') stat.value+=value;
    if(textValue) stat.parts.push(textValue);
    stat.sources.push(source);
  };
  (build.items||[]).forEach((item,i)=>{
    const evaluation=items[i];
    const sources={itemId:item.id,itemLabel:item.label};
    const selected=[...(item.intrinsics||[]),...(item.extrinsics||[]),...(item.disrupted||[])];
    filledSlots+=selected.filter(Boolean).length; totalSlots+=selected.length;
    if(selected.some(Boolean)) plannedItems++;
    evaluation.errors.forEach(message=>issues.push({itemId:item.id,label:item.label,message}));
    if(item.core==='AC' && AC_TYPES[item.slot]) ac[AC_TYPES[item.slot]]=Math.max(ac[AC_TYPES[item.slot]],evaluation.coreValue);
    else if(ABILITIES.includes(item.core)) attributes[item.core]+=evaluation.coreValue;
    else if(item.slot==='weapon') addStat({key:'enhancement',label:'Weapon enhancement',unit:''},evaluation.coreValue,{...sources,label:'Core'});
    for(const row of [...evaluation.rows.intrinsics,...evaluation.rows.extrinsics,...evaluation.rows.disrupted].filter(Boolean)) {
      if(!row.rank) continue;
      const info=statIdentity(row),val=info.count?1:numericValue(row);
      const source={...sources,label:row.label,group:row.group,value:val===null?undefined:val*info.sign};
      if(info.ability) {
        const ability=ABILITIES.find(a=>normal(a)===normal(row.subtypeLabel));
        if(ability) attributes[ability]+=val||0;
        continue;
      }
      if(info.text || info.local || val===null) addStat({...info,text:true},0,source,`${item.label}: ${row.rank.label}${row.subtypeLabel?` (${row.subtypeLabel})`:''}`);
      else addStat(info,val*info.sign,source);
    }
  });
  ac.total=ac.armor+ac.natural+ac.deflection+ac.dodge;
  const capstone=Math.min(5,(build.items||[]).filter(i=>number(i.power)>=50).length);
  const stats=[...statMap.values()].map(s=>{
    if(s.cap) {s.rawValue=s.value;s.value=Math.min(s.cap,s.value);s.capped=s.value!==s.rawValue;}
    s.display=s.text?[...new Set(s.parts)].join('; '):`${signed(s.value)}${s.unit||''}`;
    return s;
  });
  for(const ability of ABILITIES) if(attributes[ability]) stats.unshift({key:`attribute:${ability}`,label:ability,value:attributes[ability],display:signed(attributes[ability]),sources:[],unit:''});
  for(const [type,label] of Object.entries(AC_LABELS)) if(ac[type]) stats.push({key:`ac:${type}`,label,value:ac[type],display:signed(ac[type]),sources:[],unit:''});
  if(capstone) stats.push({key:'capstone',label:'Capstone attack bonus',value:capstone,display:signed(capstone),sources:[],unit:''});
  return {items,stats,attributes,ac,capstone,issues,filledSlots,totalSlots,plannedItems,valid:issues.length===0};
}
