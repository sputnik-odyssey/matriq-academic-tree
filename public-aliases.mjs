// Public name variants only; aliases never contain arbitrary profile text or contacts.
export const MAX_NAME_ALIASES=50;
export function sanitizeNameAliases(value){
  if(typeof value==='string'){
    if(value.length>40000)return[];
    try{value=JSON.parse(value);}catch{return[];}
  }
  if(!Array.isArray(value))return[];
  const names=[],seen=new Set();
  for(const raw of value){
    if(typeof raw!=='string'||raw.length>300||/[\u0000-\u001f\u007f]/.test(raw))continue;
    const name=raw.normalize('NFKC').replace(/\s+/g,' ').trim();
    if(!name||!/[\p{L}]/u.test(name)||! /^[\p{L}\p{M}\p{N} .,'’‘\-‐‑·・]+$/u.test(name))continue;
    const key=name.toLowerCase();if(seen.has(key))continue;
    names.push(name);seen.add(key);if(names.length>=MAX_NAME_ALIASES)break;
  }
  return names;
}
export function serializeNameAliases(value){const names=sanitizeNameAliases(value);return names.length?JSON.stringify(names):'';}
