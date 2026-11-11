// One-profile Apify client. Tokens stay in request memory and never enter URLs or data.
import {normalizeLinkedInURL} from './linkedin-parser.mjs?v=linkedin-history-20261111';
import {sanitizeAcademicHistory,normalizeAcademicDate} from './academic-history.mjs?v=linkedin-history-20261111';

const API='https://api.apify.com/v2';
export const APIFY_ACTOR=Object.freeze({
  id:'harvestapi~linkedin-profile-scraper',actorId:'LpVuK3Zozwuipa5bp',
  name:'HarvestAPI · LinkedIn Profile Scraper',
  url:'https://apify.com/harvestapi/linkedin-profile-scraper',
  tokenURL:'https://console.apify.com/settings/integrations',
  build:'0.0.141',maxChargeUsd:0.10
});
const MODE='Profile details no email ($4 per 1k)'; // Verified Actor input enum, not displayed pricing.
const MONTHS={jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,oct:10,nov:11,dec:12};
const PHD=/(?:\bph\s*\.?\s*d\.?\b|\bd\.?\s*phil\.?\b|doctor of philosophy|\bdoctorate\b|博士(?![后後]))/i;
const POSTDOC=/(?:\bpost[\s-]?doc(?:toral)?\b|博士[后後])/i;
const PRESENT=/^(?:present|current|now|至今|现在|現在|目前|迄今)$/i;
const clean=(v,n=400)=>typeof v==='string'?v.replace(/[\u0000-\u001f\u007f]/g,' ').replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi,'').replace(/\s+/g,' ').trim().slice(0,n):'';
const key=url=>normalizeLinkedInURL(url).toLowerCase();
const safeId=value=>typeof value==='string'&&/^[A-Za-z0-9]{8,64}$/.test(value)?value:'';
const abortError=()=>new DOMException('已停止等待；Apify 远端任务可能仍在运行，可继续读取同一次任务。','AbortError');
function error(message,code,runId=''){const e=new Error(message);e.code=code;if(runId)e.runId=runId;return e;}
function notify(onProgress,message,runId='',status=''){if(typeof onProgress==='function')onProgress({message,runId,status});}
function date(value){
  if(value&&typeof value==='object'&&!Array.isArray(value)){
    const y=normalizeAcademicDate(value.year);if(!y||y.length!==4)return date(value.text);
    const raw=typeof value.month==='string'?value.month.trim():value.month;
    const m=Number(raw)||MONTHS[String(raw||'').slice(0,3).toLowerCase()];
    return normalizeAcademicDate(y+(m>=1&&m<=12?'-'+String(m).padStart(2,'0'):''));
  }
  const raw=clean(value,60),iso=raw.match(/^(\d{4})(?:-(\d{2})(?:-\d{2})?)?$/);
  if(iso)return normalizeAcademicDate(iso[1]+(iso[2]?'-'+iso[2]:''));
  const word=raw.match(/^([A-Za-z]+)\.?\s+(\d{4})$/),month=word&&MONTHS[word[1].slice(0,3).toLowerCase()];
  if(month)return normalizeAcademicDate(word[2]+'-'+String(month).padStart(2,'0'));
  const zh=raw.match(/^(\d{4})年(?:\s*(\d{1,2})月)?$/);
  return zh?normalizeAcademicDate(zh[1]+(zh[2]?'-'+zh[2].padStart(2,'0'):'')):'';
}
function ongoing(record){
  const end=record.endDate;
  return record.isCurrent===true||record.current===true||PRESENT.test(clean(typeof end==='object'?end?.text:end,60));
}
function academicEntry(record,type,section,linkedin,retrievedAt){
  const startDate=date(record.startDate),rawEnd=date(record.endDate),future=rawEnd&&(rawEnd.length===4?rawEnd>retrievedAt.slice(0,4):rawEnd>retrievedAt.slice(0,7)),isOngoing=ongoing(record)&&!future,endDate=isOngoing?'':rawEnd;
  const title=clean(section==='Education'?record.degree:record.position||record.title,300);
  const institution=clean(section==='Education'?record.schoolName:record.companyName,300);
  return{type,title,institution,startDate,endDate,ongoing:isOngoing,endDateType:isOngoing?'ongoing':future?'expected':'unspecified',sourceSection:section,sourceUrl:linkedin,retrievedAt};
}

/** Strict adapter for the documented HarvestAPI response. Never returns raw profile data. */
export function adaptLinkedInProfile(profile,requestedURL,{asOf=new Date().toISOString().slice(0,10)}={}){
  const linkedin=normalizeLinkedInURL(requestedURL);
  if(!linkedin)throw error('请输入有效的 LinkedIn 人物主页链接。','INVALID_URL');
  if(!profile||typeof profile!=='object'||Array.isArray(profile))throw error('API 没有返回有效的人物履历。','INVALID_PROFILE');
  if(profile.error||['error','failed','not_found'].includes(String(profile.status||'').toLowerCase()))throw error('服务未能读取此人物的公开履历，请核对链接或在 Apify 控制台检查本次任务。','PROFILE_UNAVAILABLE');
  const supplied=profile.linkedinUrl||profile.profileUrl||(clean(profile.publicIdentifier,200)?'https://www.linkedin.com/in/'+clean(profile.publicIdentifier,200):'');
  const canonical=supplied?normalizeLinkedInURL(supplied):'';
  if(supplied&&(!canonical||key(canonical)!==key(linkedin)))throw error('API 返回的人物链接与输入链接不同，已停止导入。请核对人物身份。','PROFILE_MISMATCH');
  const name=clean(profile.fullName||profile.name||[clean(profile.firstName,150),clean(profile.lastName,150)].filter(Boolean).join(' '),300);
  if(!name)throw error('服务未返回人物姓名，无法核对身份。','MISSING_NAME');
  const warnings=[],entries=[];
  if(!supplied)warnings.push('返回数据未包含人物链接，请核对姓名与原始页面。');
  if(!Array.isArray(profile.education))warnings.push('服务未提供 Education 列表；不表示此人没有博士经历。');
  if(!Array.isArray(profile.experience))warnings.push('服务未提供 Experience 列表；不表示此人没有博后经历。');
  for(const r of (Array.isArray(profile.education)?profile.education:[]).slice(0,100)){
    if(!r||typeof r!=='object')continue;
    const degree=clean(r.degree,300),type=POSTDOC.test(degree)?'postdoc':PHD.test(degree)?'phd':'';
    if(type)entries.push(academicEntry(r,type,'Education',linkedin,asOf));
  }
  for(const r of (Array.isArray(profile.experience)?profile.experience:[]).slice(0,200)){
    if(!r||typeof r!=='object'||!POSTDOC.test(clean(r.position||r.title,300)))continue;
    entries.push(academicEntry(r,'postdoc','Experience',linkedin,asOf));
  }
  for(const r of entries){
    if(r.startDate&&r.endDate&&(r.startDate.slice(0,4)>r.endDate.slice(0,4)||(r.startDate.length===7&&r.endDate.length===7&&r.startDate>r.endDate))){r.startDate='';r.endDate='';r.endDateType='unspecified';warnings.push('一条履历的起止日期顺序异常，已清空日期，请手动核对。');}
    if(!r.institution)warnings.push('一条博士或博后履历未提供机构，请核对后补充。');
    if(!r.startDate||!r.endDate&&!r.ongoing)warnings.push('部分履历日期缺失；未根据任职时长推算。');
  }
  const safe=sanitizeAcademicHistory(entries);
  if(!safe.length)warnings.push('未识别到明确的 PhD 学位或 Postdoc 职位，可核对原始页面后补充。');
  return{name,linkedin,entries:safe,warnings:[...new Set(warnings)],source:'apify'};
}

/** Starts once, then reads only this run. Supplying runId never starts a paid run. */
export async function fetchLinkedInProfile(url,{token,signal,onProgress,runId=''}={}){
  const linkedin=normalizeLinkedInURL(url),credential=typeof token==='string'?token.trim():'';
  if(!linkedin)throw error('请输入有效的 LinkedIn 人物主页链接。','INVALID_URL');
  if(!credential||credential.length>500||/\s/.test(credential))throw error('请输入有效的 Apify API Token。','INVALID_TOKEN');
  if(runId&&!safeId(runId))throw error('Apify 任务编号无效，请核对。','INVALID_RUN');
  if(signal?.aborted)throw abortError();
  let activeRun=safeId(runId);
  async function request(path,{method='GET',body}={}){
    if(signal?.aborted)throw abortError();
    const controller=new AbortController(),abort=()=>controller.abort(),timer=setTimeout(abort,45000);
    signal?.addEventListener('abort',abort,{once:true});
    try{
      const response=await fetch(API+path,{method,headers:{Authorization:'Bearer '+credential,Accept:'application/json',...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined,credentials:'omit',redirect:'error',cache:'no-store',signal:controller.signal});
      if(!response.ok){
        const messages={401:'Apify 未接受此令牌，请检查 API Token。',402:'Apify 账户余额或服务订阅不足，请在其控制台检查。',403:'Apify 未授权此任务，请检查令牌权限和 Actor 访问权限。',404:'Apify 任务或服务不存在，请在控制台检查。',429:'Apify 请求频率受限，请稍后继续读取本次任务。'};
        throw error(messages[response.status]||'Apify 请求未完成（HTTP '+response.status+'），请在控制台检查本次任务。','HTTP_'+response.status,activeRun);
      }
      try{return await response.json();}catch{throw error(method==='POST'?'任务创建响应不完整，远端任务可能已经开始。请先在 Apify 控制台检查任务编号，避免重复收费。':'Apify 响应格式不可读取，请稍后继续读取本次任务。',method==='POST'?'START_UNCERTAIN':'INVALID_RESPONSE',activeRun);}
    }catch(e){
      if(signal?.aborted)throw abortError();
      if(typeof e?.code==='string')throw e;
      throw error(method==='POST'?'任务创建响应未收到，远端任务可能已经开始。请先在 Apify 控制台确认，不要立即重复抓取。':'读取 Apify 暂时失败，可继续读取同一次任务；不会自动重新创建收费任务。',method==='POST'?'START_UNCERTAIN':'NETWORK',activeRun);
    }finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);}
  }
  let run;
  if(activeRun){notify(onProgress,'正在读取已有 Apify 任务…',activeRun,'RESUMING');run=(await request('/actor-runs/'+activeRun+'?waitForFinish=20')).data;}
  else{
    notify(onProgress,'正在创建单个人物的履历读取任务…','','STARTING');
    const params=new URLSearchParams({build:APIFY_ACTOR.build,timeout:'180',maxItems:'1',maxTotalChargeUsd:String(APIFY_ACTOR.maxChargeUsd),restartOnError:'false',waitForFinish:'0'});
    const result=await request('/acts/'+APIFY_ACTOR.id+'/runs?'+params,{method:'POST',body:{queries:[linkedin],profileScraperMode:MODE}});
    run=result?.data;activeRun=safeId(run?.id);
    if(!activeRun)throw error('Apify 未返回任务编号，任务可能已创建。请在控制台确认后继续读取，避免重复收费。','START_UNCERTAIN');
  }
  const startedAt=Date.now();let checks=0;
  while(true){
    if(signal?.aborted)throw abortError();
    if(!run||typeof run!=='object'||safeId(run.id)!==activeRun)throw error('Apify 返回了不一致的任务编号，已停止读取。','INVALID_RUN',activeRun);
    if(run.actId&&run.actId!==APIFY_ACTOR.actorId)throw error('此任务不属于已配置的履历读取服务，已停止读取。','WRONG_ACTOR',activeRun);
    const state=String(run.status||'');
    notify(onProgress,state==='SUCCEEDED'?'履历读取完成，正在提取博士和博后记录…':'Apify 任务进行中（'+(state||'等待')+'）…',activeRun,state);
    if(state==='SUCCEEDED')break;
    if(['FAILED','ABORTED','TIMED-OUT'].includes(state))throw error('Apify 任务未成功完成（'+state+'）。请在控制台检查；网站不会自动重新创建收费任务。','RUN_'+state,activeRun);
    if(!['READY','RUNNING','TIMING-OUT','ABORTING'].includes(state))throw error('Apify 返回了未知任务状态，请在控制台检查。','INVALID_STATUS',activeRun);
    if(Date.now()-startedAt>240000||checks++>=20)throw error('本次等待已结束，远端任务可能仍在运行。可点击继续读取本次任务，无需再次抓取。','WAIT_TIMEOUT',activeRun);
    run=(await request('/actor-runs/'+activeRun+'?waitForFinish=20')).data;
  }
  const dataset=safeId(run.defaultDatasetId);if(!dataset)throw error('Apify 未提供结果数据集。','MISSING_DATASET',activeRun);
  const fields='firstName,lastName,name,fullName,linkedinUrl,profileUrl,publicIdentifier,education,experience,error,status';
  const params=new URLSearchParams({clean:'true',format:'json',limit:'2',fields});
  const items=await request('/datasets/'+dataset+'/items?'+params);
  if(!Array.isArray(items)||items.length!==1)throw error(items?.length?'此任务返回了多个人物，已停止自动导入。':'没有返回人物履历。请核对链接或在 Apify 控制台检查任务。','DATASET_PROFILE_COUNT',activeRun);
  return{...adaptLinkedInProfile(items[0],linkedin),runId:activeRun};
}
