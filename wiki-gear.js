const ARMOR_COLUMNS=['Name','Base AC','Max Dex Modifier','Armor Check Penalty','Arcane Spell Failure','Weight'];
const WEAPON_COLUMNS=['Name','Damage','Critical Range','Critical Multiplier','Damage Type','Size','Other'];
const SKILL_COLUMNS=['Skill Name','Description','Base Attribute','General Mechanical Effects'];
const ARMOR_TABLES=['Light Armor','Medium Armor','Heavy Armor'];
const WEAPON_TABLES=[
  {title:'Simple Melee',kind:'melee',proficiency:'simple'},
  {title:'Gauntlets',kind:'melee',proficiency:'unarmed'},
  {title:'Martial Melee',kind:'melee',proficiency:'martial'},
  {title:'Mystic',kind:'mystic',proficiency:'mystic'}
];

const clean=value=>value.replace(/\s+/gu,' ').trim();
const key=value=>clean(value).normalize('NFKC').toLowerCase().replace(/[^a-z0-9]+/g,'');
const slug=value=>clean(value).normalize('NFKC').toLowerCase().replace(/[^a-z0-9]+/g,'_').replace(/^_+|_+$/g,'');
const cells=row=>Array.from(row?.cells||[],cell=>clean(cell.textContent));

function tableRows(doc,columns,title=''){
  const label=title||'Skills';
  const matches=[];
  for(const table of doc.querySelectorAll('table')){
    const rows=Array.from(table.rows);
    const heading=cells(rows[0]);
    const titledRow=title&&heading.length===1&&key(heading[0])===key(title);
    const caption=clean(table.caption?.textContent||'');
    if(title&&!titledRow&&key(caption)!==key(title)) continue;
    const offset=titledRow?1:0;
    const headers=cells(rows[offset]);
    if(headers.length===columns.length&&headers.every((cell,index)=>key(cell)===key(columns[index]))) matches.push(rows.slice(offset+1));
  }
  if(matches.length!==1||!matches[0].length) throw new Error(`Missing, duplicate, or empty ${label} table.`);
  return matches[0].map(row=>{
    if(row.cells.length!==columns.length||Array.from(row.cells).some(cell=>cell.colSpan!==1||cell.rowSpan!==1)) throw new Error(`Unexpected row layout in ${label} table.`);
    return cells(row);
  });
}

function text(value,label,allowEmpty=false){
  if((!value&&!allowEmpty)||/[<>]/.test(value)||value.length>240) throw new Error(`Invalid ${label} in the wiki table.`);
  return value;
}

function wholeNumber(value,label){
  const signed=value.replace(/−/g,'-');
  const number=Number(signed);
  if(!/^[+-]?\d+$/.test(signed)||!Number.isSafeInteger(number)) throw new Error(`Invalid ${label} in the wiki table.`);
  return number;
}

function compatibleEntries(previous,entries,label,nameOf){
  const known=new Map(previous.map(entry=>[key(nameOf(entry)),entry]));
  const seen=new Set();
  const updated=entries.map(entry=>{
    const name=nameOf(entry);
    const old=known.get(key(name));
    const id=old?.id||slug(name);
    if(!id||seen.has(id)) throw new Error(`Invalid or duplicate ${label}: ${name}.`);
    seen.add(id);
    const merged={...old,...entry,id};
    if(old){
      // Saved loadouts may refer to a display name as well as an ID.
      if('name' in entry) merged.name=old.name;
      else merged.label=old.label;
    }
    return merged;
  });
  if(previous.some(entry=>!seen.has(entry.id))) throw new Error(`Wiki revision removed a known ${label}. Review is required to keep saved loadouts compatible.`);
  return updated;
}

function armorRow([label,base,dex,penalty,failure,weightText]){
  const name=text(key(label)==='none'?'Unarmored':label,'armor name');
  const baseAC=wholeNumber(base,`${name} base AC`);
  const maxDex=wholeNumber(dex,`${name} max Dexterity`);
  const checkPenalty=wholeNumber(penalty,`${name} check penalty`);
  const weight=Number(weightText.match(/^(\d+(?:\.\d+)?)\s*lbs?\.?$/i)?.[1]);
  if(baseAC<0||maxDex<0||checkPenalty>0||!Number.isFinite(weight)||!/^\d+(?:\.\d+)?%$/.test(failure)||Number(failure.slice(0,-1))>100) throw new Error(`Invalid armor stats for ${name}.`);
  return {name,baseAC,maxDex,checkPenalty,weight};
}

function weaponRow([label,damage,range,multiplier,damageType,size,other],{kind,proficiency}){
  const name=text(label,'weapon name');
  const criticalRange=range.replace(/[–—−]/g,'-').replace(/\s+/g,'');
  const criticalMultiplier=multiplier.replace('×','x').toLowerCase();
  const threat=criticalRange.split('-').map(Number);
  if(!/^[1-9]\d*d[1-9]\d*$/i.test(damage)||!/^\d{1,2}(?:-\d{1,2})?$/.test(criticalRange)||threat.some(n=>n<1||n>20)||(threat.length===2&&threat[0]>=threat[1])||!/^x[1-9]\d*$/.test(criticalMultiplier)) throw new Error(`Invalid weapon dice or critical stats for ${name}.`);
  const attributes=text(other,`${name} notes`,true).split(',').map(clean).filter(Boolean);
  const finesse=attributes.some(value=>key(value)==='finesse');
  const notes=attributes.filter(value=>key(value)!=='finesse'&&key(value)!=='cannotbeusedinoffhand').join(', ');
  return {name,damage,damageType:text(damageType,`${name} damage type`),size:text(size,`${name} size`),finesse,kind,proficiency,critical:`${criticalRange}/${criticalMultiplier}`,notes};
}

export function parseBaseGear(equipmentDoc,baseline){
  const armor=ARMOR_TABLES.flatMap(title=>tableRows(equipmentDoc,ARMOR_COLUMNS,title).map(armorRow));
  const weapons=WEAPON_TABLES.flatMap(group=>tableRows(equipmentDoc,WEAPON_COLUMNS,group.title).map(row=>weaponRow(row,group)));
  return {
    armor:compatibleEntries(baseline.armor,armor,'armor base',entry=>entry.name),
    weapons:compatibleEntries(baseline.weapons,weapons,'weapon base',entry=>entry.name)
  };
}

export function parseSkills(skillsDoc,baseline){
  const previous=baseline.properties.find(property=>property.id==='skill').subtypes;
  const entries=tableRows(skillsDoc,SKILL_COLUMNS).map(([label])=>({label:text(label,'skill name')}));
  return compatibleEntries(previous,entries,'skill',entry=>entry.label);
}
