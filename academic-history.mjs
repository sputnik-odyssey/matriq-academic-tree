// Public academic chronology only. Raw profile text and contact details are not retained.
export const MAX_ACADEMIC_HISTORY=40;
const MAX_JSON=40000;
const text=(value,max=400)=>typeof value==='string'?value.replace(/[\u0000-\u001f\u007f]/g,' ').replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi,'').replace(/\s+/g,' ').trim().slice(0,max):'';
const norm=value=>text(value).normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
export function normalizeAcademicDate(value){
  const date=String(value??'').trim();
  return /^(?:1[6-9]\d{2}|20\d{2}|21\d{2}|2200)(?:-(?:0[1-9]|1[0-2]))?$/.test(date)?date:'';
}
function day(value){
  const date=text(value,40).slice(0,10);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date))return'';
  const parsed=new Date(date+'T00:00:00Z');return Number.isFinite(parsed.getTime())&&parsed.toISOString().slice(0,10)===date?date:'';
}
function sourceURL(value){
  try{const url=new URL(text(value,2000));if(!['https:','http:'].includes(url.protocol)||url.username||url.password)return'';url.search='';url.hash='';return url.href;}catch{return'';}
}
function section(value){const v=norm(value);return['education','教育','教育经历','教育經歷'].includes(v)?'Education':['experience','工作经历','工作經歷','经历','經歷'].includes(v)?'Experience':'';}
function entry(input){
  if(!input||typeof input!=='object'||Array.isArray(input)||!['phd','postdoc'].includes(input.type))return null;
  const institution=text(input.institution,300),title=text(input.title,300),startDate=normalizeAcademicDate(input.startDate),ongoing=input.ongoing===true||input.endDateType==='ongoing',endDate=ongoing?'':normalizeAcademicDate(input.endDate);
  if(!institution&&!title&&!startDate&&!endDate&&!ongoing)return null;
  const endDateType=ongoing?'ongoing':['expected','unspecified'].includes(input.endDateType)?input.endDateType:'unspecified';
  return{type:input.type,institution,title,startDate,endDate,ongoing,endDateType,sourceSection:section(input.sourceSection),sourceUrl:sourceURL(input.sourceUrl),retrievedAt:day(input.retrievedAt)};
}
function identity(a,b){
  if(a.type!==b.type||norm(a.institution)!==norm(b.institution))return false;
  if(a.startDate&&b.startDate)return a.startDate===b.startDate||a.startDate.slice(0,4)===b.startDate.slice(0,4)&&(a.startDate.length===4||b.startDate.length===4);
  if(a.endDate&&b.endDate&&a.endDate.slice(0,4)!==b.endDate.slice(0,4))return false;
  return true;
}
function refinedDate(previous,incoming){return previous&&incoming&&previous.startsWith(incoming)&&previous.length>incoming.length?previous:incoming||previous;}
function mergeEntry(previous,incoming){
  const out={...previous};
  for(const key of ['institution','title','sourceSection','sourceUrl','retrievedAt'])if(incoming[key])out[key]=incoming[key];
  out.startDate=refinedDate(previous.startDate,incoming.startDate);
  if(incoming.ongoing){out.ongoing=true;out.endDate='';out.endDateType='ongoing';}
  else if(incoming.endDate){out.ongoing=false;out.endDate=refinedDate(previous.endDate,incoming.endDate);out.endDateType=incoming.endDateType==='expected'?'expected':previous.endDateType==='expected'&&incoming.endDate===previous.endDate?'expected':'unspecified';}
  return out;
}
function read(value){
  if(typeof value==='string'){if(value.length>MAX_JSON)return[];try{value=JSON.parse(value);}catch{return[];}}
  return Array.isArray(value)?value:[];
}
export function mergeAcademicHistory(existing,incoming){
  const result=[];
  for(const raw of [...read(existing),...read(incoming)]){
    const next=entry(raw);if(!next)continue;
    const candidates=result.map((old,index)=>identity(old,next)?index:-1).filter(index=>index>=0);
    if(candidates.length===1)result[candidates[0]]=mergeEntry(result[candidates[0]],next);
    else if(!result.some(old=>JSON.stringify(old)===JSON.stringify(next))&&result.length<MAX_ACADEMIC_HISTORY)result.push(next);
  }
  return result;
}
export const sanitizeAcademicHistory=value=>mergeAcademicHistory([],value);
export function serializeAcademicHistory(value){
  const entries=sanitizeAcademicHistory(value);while(entries.length&&JSON.stringify(entries).length>MAX_JSON)entries.pop();return entries.length?JSON.stringify(entries):'';
}
export function formatAcademicDate(value,{present=false}={}){return present?'至今':normalizeAcademicDate(value)||'未提供';}
export function sanitizeLinkedInProfileMatch(value){
  if(value==='new')return'new';
  if(!value||typeof value!=='object'||Array.isArray(value)||typeof value.nodeId!=='string'||!value.identity||typeof value.identity.name!=='string'||typeof value.identity.linkedin!=='string')return null;
  return{nodeId:text(value.nodeId,200),identity:{name:text(value.identity.name,300),linkedin:text(value.identity.linkedin,2000)}};
}
