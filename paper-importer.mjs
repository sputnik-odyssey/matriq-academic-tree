// Public bibliographic data only. Paper content never supplies executable instructions.
import {normalizeMappingEdges} from './mentorship.mjs?v=author-alias-20261111';
import {sanitizeAcademicHistory,mergeAcademicHistory,serializeAcademicHistory} from './academic-history.mjs?v=author-alias-20261111';
import {nameMatchKind} from './name-matching.mjs?v=author-alias-20261111';
import {sanitizeNameAliases,serializeNameAliases} from './public-aliases.mjs?v=author-alias-20261111';

export const COAUTHOR_EDGE_TYPE=Object.freeze({id:'coauthor',label:'论文合著',color:'#80d8ff'});
const PUBLIC_KEYS=new Set('A B C D E G H I N O P Q R T U V W X AB affiliationType academicStatus jobTitle expectedGraduation academicHistory nameAliases'.split(' '));
const MAX_AUTHORS=100,MAX_DOCUMENT_PAPERS=20,MAX_PAPERS=2000,MAX_PAIRS=100000;
const text=(value,max=40000)=>String(value??'').replace(/\u0000/g,'').trim().slice(0,max);
const norm=value=>text(value).normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
const copy=value=>JSON.parse(JSON.stringify(value));
const hash=value=>{let a=2166136261,b=2246822519;for(let i=0;i<value.length;i++){a=Math.imul(a^value.charCodeAt(i),16777619);b=Math.imul(b^value.charCodeAt(i),3266489917);}return(a>>>0).toString(16).padStart(8,'0')+(b>>>0).toString(16).padStart(8,'0');};
const fileName=value=>text(value,200).split(/[\\/]/).pop()||'paper-import.json';
const person=node=>node?.entityType==='person'&&!node.stub;
const names=node=>[node.name,node.nameZh,...(Array.isArray(node.aliases)?node.aliases:[])].filter(Boolean).map(norm);
function safeURL(value){try{const url=new URL(text(value,3000));return ['http:','https:'].includes(url.protocol)&&!url.username&&!url.password?url.href:'';}catch{return '';}}

export function normalizeORCID(value){
  let id=text(value,300).toLowerCase();
  if(!/^(?:\d{15}[\dx]|\d{4}-\d{4}-\d{4}-\d{3}[\dx])$/.test(id)){
    try{const url=new URL(/^https?:\/\//i.test(id)?id:'https://'+id);if(!['http:','https:'].includes(url.protocol)||!['orcid.org','www.orcid.org'].includes(url.hostname)||url.username||url.password||url.port)return '';id=url.pathname.replace(/^\//,'').replace(/\/$/,'');}catch{return '';}
  }
  id=id.replace(/-/g,'');return /^\d{15}[\dx]$/.test(id)?id.match(/.{4}/g).join('-').toUpperCase():'';
}
function doiValue(value){
  let doi=text(value,1000);if(/^https?:\/\//i.test(doi)){try{const url=new URL(doi);if(!['doi.org','www.doi.org','dx.doi.org'].includes(url.hostname.toLowerCase()))return '';doi=decodeURIComponent(url.pathname.slice(1));}catch{return '';}}
  doi=doi.replace(/^doi:\s*/i,'').toLowerCase();return /^10\.\d{4,9}\/[^\s<>"{}]+$/.test(doi)?doi:'';
}
function arxivValue(value){
  let id=text(value,300);if(/^https?:\/\//i.test(id)){try{const url=new URL(id);if(!['arxiv.org','www.arxiv.org','export.arxiv.org'].includes(url.hostname.toLowerCase()))return '';id=url.pathname.replace(/^\/(?:abs|pdf)\//,'').replace(/\.pdf$/i,'');}catch{return '';}}
  id=id.replace(/^arxiv:\s*/i,'').replace(/v\d+$/i,'');return /^(?:\d{4}\.\d{4,5}|[a-z-]+(?:\.[a-z]{2})?\/\d{7})$/i.test(id)?id.toLowerCase():'';
}
export function sanitizePaper(input,{keepNodeIds=false}={}){
  if(!input||typeof input!=='object'||Array.isArray(input))throw Error('A paper must be a structured object.');
  const title=text(input.title,2000);if(!title)throw Error('The paper needs a title.');
  if(!Array.isArray(input.authors)||!input.authors.length)throw Error('The paper needs a public author list.');
  if(input.authors.length>MAX_AUTHORS)throw Error(`A paper can contain up to ${MAX_AUTHORS} authors in this browser importer.`);
  const authors=input.authors.map((author,index)=>{
    if(typeof author==='string')author={name:author};
    const name=text(author?.name,300);if(!name)throw Error(`Author ${index+1} needs a name.`);
    const out={name},orcid=normalizeORCID(author.orcid),affiliation=text(author.affiliation,1000),externalId=text(author.externalId,300);
    if(orcid)out.orcid=orcid;if(affiliation)out.affiliation=affiliation;if(externalId)out.externalId=externalId;
    if(keepNodeIds&&typeof author.nodeId==='string')out.nodeId=text(author.nodeId,200);
    return out;
  });
  const doi=doiValue(input.doi)||doiValue(input.url),arxivId=arxivValue(input.arxivId)||arxivValue(input.url);
  const year=Number(input.year),url=doi?`https://doi.org/${doi}`:arxivId?`https://arxiv.org/abs/${arxivId}`:safeURL(input.url);
  const suppliedId=text(input.id,1200),validId=doi&&suppliedId===`doi:${doi}`||arxivId&&suppliedId===`arxiv:${arxivId}`||!doi&&!arxivId&&/^paper:[a-f0-9]{16}$/.test(suppliedId);
  const id=validId?suppliedId:doi?`doi:${doi}`:arxivId?`arxiv:${arxivId}`:`paper:${hash(norm(title)+'|'+(Number.isInteger(year)?year:'')+'|'+authors.map(a=>norm(a.name)).join('|'))}`;
  const sources=[];for(const source of Array.isArray(input.sources)?input.sources:[]){const sourceURL=safeURL(source?.url);if(sourceURL&&!sources.some(s=>s.url===sourceURL))sources.push({name:text(source.name||new URL(sourceURL).hostname,200),url:sourceURL});}
  if(url&&!sources.some(s=>s.url===url))sources.push({name:doi?'DOI':arxivId?'arXiv':'Paper',url});
  return{id,title,authors,...(doi?{doi}:{}),...(arxivId?{arxivId}:{}),...(Number.isInteger(year)&&year>=1600&&year<=2200?{year}:{}),url,sources};
}
export function sanitizePaperDocument(document){
  if(!document||!Array.isArray(document.papers)||!document.papers.length)throw Error('Select at least one paper.');
  if(document.papers.length>MAX_DOCUMENT_PAPERS)throw Error(`Import up to ${MAX_DOCUMENT_PAPERS} papers at a time.`);
  const matches={};for(const [key,value]of Object.entries(document.matches||{})){
    if(!/^\d+(?::\d+)?$/.test(key))continue;
    if(typeof value==='string')matches[key]=text(value,200);
    else if(value&&typeof value==='object'&&typeof value.nodeId==='string'){
      const identity={};if(value.identity&&Object.hasOwn(value.identity,'name'))identity.name=text(value.identity.name,300);if(value.identity&&Object.hasOwn(value.identity,'orcid'))identity.orcid=normalizeORCID(value.identity.orcid);
      matches[key]={nodeId:text(value.nodeId,200),...(value.identity?{identity}:{})};
    }
  }
  return{kind:'paper',sourceFile:fileName(document.sourceFile||'paper-import.json'),sheet:'Paper metadata',papers:document.papers.map(p=>sanitizePaper(p)),matches,warnings:[]};
}
function existingORCID(node){return normalizeORCID(node.orcid)||(node.records||[]).map(r=>normalizeORCID(r.fields?.Q)).find(Boolean)||'';}
function isReviewedChoice(selected){return Boolean(selected&&typeof selected==='object'&&selected.identity&&typeof selected.identity.name==='string'&&selected.identity.name&&Object.hasOwn(selected.identity,'orcid'));}
function priorReviewProof(node,author,paper,prior,knownPapers=[]){
  const current=existingORCID(node);
  if(!prior||!samePaper(prior,paper)||!current||author.orcid&&author.orcid!==current)return false;
  const assigned=(prior.authors||[]).find(a=>a.nodeId===node.id&&norm(a.name)===norm(author.name)&&(!a.orcid||normalizeORCID(a.orcid)===current));
  const record=(node.records||[]).find(r=>r.sourceFile===`paper-${hash(prior.id)}.json`&&norm(r.fields?.A)===norm(author.name)&&(!r.fields?.Q||normalizeORCID(r.fields.Q)===current));
  if(!assigned||!record||!names(node).includes(norm(author.name)))return false;
  if(author.orcid)return normalizeORCID(assigned.orcid)===current&&normalizeORCID(record.fields?.Q)===current;
  // An earlier reviewed paper may lack ORCID. Replay it only when a separately
  // resolved paper and its exact source record jointly support the learned ID.
  return knownPapers.some(known=>(known.authors||[]).some(a=>a.nodeId===node.id&&normalizeORCID(a.orcid)===current&&(node.records||[]).some(r=>r.sourceFile===`paper-${hash(known.id)}.json`&&norm(r.fields?.A)===norm(a.name)&&normalizeORCID(r.fields?.Q)===current)));
}
function guardChanged(node,guard,author,paper,prior,knownPapers){
  if(guard.name&&norm(guard.name)!==norm(node.name))return true;
  if(!Object.hasOwn(guard,'orcid')||guard.orcid===existingORCID(node))return false;
  return !(guard.orcid===''&&priorReviewProof(node,author,paper,prior,knownPapers));
}
function orcidConflict(node,author){const old=existingORCID(node);return Boolean(old&&author.orcid&&old!==author.orcid);}
function compatible(node,author){
  if(!person(node)||orcidConflict(node,author))return false;
  return Boolean(existingORCID(node)&&author.orcid&&existingORCID(node)===author.orcid)||names(node).includes(norm(author.name));
}
function candidatesFor(graph,author){
  const profiles=graph.nodes.filter(person),allowed=profiles.filter(n=>!orcidConflict(n,author));
  const strong=author.orcid?allowed.filter(n=>existingORCID(n)===author.orcid):[];
  const byName=allowed.filter(n=>names(n).includes(norm(author.name)));
  const variants=allowed.filter(n=>!byName.includes(n)&&[n.name,n.nameZh,...(n.aliases||[])].some(value=>nameMatchKind(value,author.name)==='variant'));
  return{strong,byName,variants};
}
function candidateReason(node,author){
  if(orcidConflict(node,author))return'ORCID 冲突，不能合并';
  if(author.orcid&&existingORCID(node)===author.orcid)return'ORCID 一致';
  if(norm(node.name)===norm(author.name)||norm(node.nameZh)===norm(author.name))return'姓名一致，请核对';
  if((node.aliases||[]).some(value=>norm(value)===norm(author.name)))return'已确认的姓名别名';
  if([node.name,node.nameZh,...(node.aliases||[])].some(value=>nameMatchKind(value,author.name)==='variant'))return'姓名变体候选，请核对';
  return'手动检索候选，请核对';
}
/** Search exposes candidates for review; it never makes an identity decision. */
export function searchProfilesForAuthor(graph,author={},query,{limit=20}={}){
  author={...author,orcid:normalizeORCID(author.orcid)};
  const input=norm(query),words=text(query,300).normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase().split(/\s+/).filter(Boolean);
  const profiles=(graph?.nodes||[]).filter(person),ranked=[];
  for(const node of profiles){
    const nodeNames=[node.name,node.nameZh,...(node.aliases||[])].filter(Boolean),nameKeys=nodeNames.map(norm),affiliation=norm(node.affiliation),id=norm(node.id),reason=candidateReason(node,author);
    let score=0;
    if(!input){if(reason==='ORCID 一致')score=100;else if(reason==='已确认的姓名别名'||reason==='姓名一致，请核对')score=90;else if(reason==='姓名变体候选，请核对')score=70;}
    else if(nameKeys.includes(input)||id===input)score=100;
    else if(nameKeys.some(value=>value.startsWith(input)))score=90;
    else if(nameKeys.some(value=>value.includes(input)))score=80;
    else if(words.every(word=>norm([node.name,node.nameZh,...(node.aliases||[]),node.affiliation,node.id].join(' ')).includes(norm(word))))score=60;
    else if(affiliation.includes(input))score=30;
    if(score)ranked.push({id:node.id,name:node.name,affiliation:node.affiliation||'',reason,conflict:orcidConflict(node,author),score});
  }
  return ranked.sort((a,b)=>Number(a.conflict)-Number(b.conflict)||b.score-a.score||a.name.localeCompare(b.name)).slice(0,Math.max(1,Math.min(100,Number(limit)||20))).map(({score,...candidate})=>candidate);
}
function samePaper(a,b){return a.id===b.id||Boolean(a.doi&&b.doi&&a.doi===b.doi)||Boolean(a.arxivId&&b.arxivId&&a.arxivId===b.arxivId);}
export function previewAuthorMatches(graph,input){
  const paper=sanitizePaper(input),prior=(graph.papers||[]).find(p=>samePaper(p,paper)),issues=[];
  const authors=paper.authors.map((author,index)=>{
    const {strong,byName,variants}=candidatesFor(graph,author),previous=(prior?.authors||[]).filter(a=>norm(a.name)===norm(author.name)&&(!author.orcid||!a.orcid||author.orcid===normalizeORCID(a.orcid))).map(a=>graph.nodes.find(n=>n.id===a.nodeId)).filter(n=>compatible(n,author));
    const unique=[...new Map(previous.map(n=>[n.id,n])).values()],aliases=byName.filter(n=>norm(n.name)!==norm(author.name)&&(n.aliases||[]).some(value=>norm(value)===norm(author.name)));
    const exact=strong.length===1?strong[0]:!strong.length&&unique.length===1?unique[0]:!strong.length&&!unique.length&&aliases.length===1&&byName.length===1?aliases[0]:null;
    const candidateIds=[...new Set([...strong,...byName,...unique,...variants].map(n=>n.id))],variantCandidateIds=variants.map(n=>n.id),candidateReasons=Object.fromEntries(candidateIds.map(id=>[id,candidateReason(graph.nodes.find(n=>n.id===id),author)]));
    const onlyVariants=!strong.length&&!byName.length&&!unique.length&&variants.length>0;
    return{index,...author,candidateIds,variantCandidateIds,candidateReasons,matchId:exact?.id||null,requiresReview:!exact&&(candidateIds.length>1||onlyVariants),status:exact?'exact':candidateIds.length>1?'ambiguous':onlyVariants?'variant':candidateIds.length?'suggested':'new',reason:exact?(strong.length?'Exact ORCID':unique.length?'Previously reviewed paper author':'Confirmed name alias'):onlyVariants?'Name variant requires review':candidateIds.length?'Name matches require review':'No existing exact identity match'};
  });
  return{paper,authors,warnings:[],issues};
}
function safeNode(node,sourceFile){
  const out={};for(const key of ['id','name','nameZh','kind','entityType','affiliation','role','location','phd','bachelor','research','website','scholar','orcid','linkedin','affiliationType','academicStatus','jobTitle','expectedGraduation','identityNote'])if(typeof node[key]==='string')out[key]=text(node[key]);
  out.stub=Boolean(node.stub);out.degree=0;out.aliases=(node.aliases||[]).filter(v=>typeof v==='string').map(v=>text(v,300));out.publications=(node.publications||[]).filter(v=>typeof v==='string').map(v=>text(v));
  out.records=(node.records||[]).filter(r=>Number.isInteger(r?.row)&&r.row>0).map(r=>({row:r.row,sourceFile:fileName(r.sourceFile||sourceFile||'previous-dataset'),...(r.referenceOnly?{referenceOnly:true}:{}),fields:Object.fromEntries(Object.entries(r.fields||{}).filter(([key,val])=>PUBLIC_KEYS.has(key)&&(['academicHistory','nameAliases'].includes(key)||['string','number','boolean'].includes(typeof val))).map(([key,val])=>[key,key==='academicHistory'?serializeAcademicHistory(val):key==='nameAliases'?serializeNameAliases(val):text(val)]).filter(([,val])=>val))}));
  out.aliases=sanitizeNameAliases([out.name,...out.aliases,...out.records.flatMap(r=>sanitizeNameAliases(r.fields?.nameAliases))]);
  out.academicHistory=mergeAcademicHistory(out.records.flatMap(r=>sanitizeAcademicHistory(r.fields?.academicHistory)),node.academicHistory);
  out.rows=[...new Set(out.records.map(r=>r.row))].sort((a,b)=>a-b);return out;
}
function safeBase(base){
  if(!base||!Array.isArray(base.nodes)||!Array.isArray(base.edges))throw Error('The existing graph is invalid.');
  const graph={meta:copy(base.meta||{}),nodes:base.nodes.map(node=>safeNode(node,base.meta?.sourceFile)),edges:[],edgeTypes:copy(base.edgeTypes||base.meta?.edgeTypes||[])};
  const ids=new Set(graph.nodes.map(n=>n.id));if(ids.size!==graph.nodes.length)throw Error('The existing graph contains duplicate node IDs.');
  graph.edges=normalizeMappingEdges(base.edges.filter(e=>e.type!=='coauthor'&&e.type!=='collaboration'&&ids.has(e.source)&&ids.has(e.target)).map(e=>{
    const out={id:text(e.id,200),source:e.source,target:e.target,type:text(e.type,50),label:text(e.label,200),directed:Boolean(e.directed),rows:(e.rows||[]).filter(Number.isInteger),evidence:(e.evidence||[]).filter(v=>['N','O'].includes(v.column)).map(v=>({row:Number(v.row),column:v.column,field:v.column==='N'?'Research Line':'Industry Line',value:text(v.value),sourceFile:fileName(v.sourceFile||base.meta?.sourceFile)}))};
    for(const key of ['originalType','originalLabel','columnSourceEdgeId'])if(typeof e[key]==='string')out[key]=text(e[key],200);
    if(e.definition?.basis==='mapping_column'&&['N','O'].includes(e.definition.column))out.definition={basis:'mapping_column',column:e.definition.column};return out;
  }));return graph;
}
// Rebuild collaboration edges from resolved paper authors, never from uploaded edges.
export function rebuildPaperGraph(graph,inputPapers=graph.papers||[]){
  if(inputPapers.length>MAX_PAPERS)throw Error('The public graph exceeds the paper limit.');
  const nodes=new Map(graph.nodes.map(n=>[n.id,n])),papers=new Map();
  for(const raw of inputPapers){const paper=sanitizePaper(raw,{keepNodeIds:true});if(paper.authors.some(a=>!compatible(nodes.get(a.nodeId),a)))throw Error(`Paper author identities need review: ${paper.title}`);papers.set(paper.id,paper);}
  graph.papers=[...papers.values()];graph.edges=graph.edges.filter(e=>!['coauthor','collaboration'].includes(e.type));
  for(const node of graph.nodes)delete node.publicationAffiliations;
  for(const paper of graph.papers)for(const author of paper.authors)if(author.affiliation){const node=nodes.get(author.nodeId);node.publicationAffiliations=node.publicationAffiliations||[];node.publicationAffiliations.push({name:author.affiliation,paperId:paper.id,...(paper.year?{year:paper.year}:{}),url:paper.url});}
  const ids=new Set(graph.edges.map(e=>e.id)),pairs=new Map();
  for(const paper of graph.papers){const authors=[...new Set(paper.authors.map(a=>a.nodeId))].sort();for(let i=0;i<authors.length;i++)for(let j=i+1;j<authors.length;j++){
    const source=authors[i],target=authors[j],key=source+'|'+target;let edge=pairs.get(key);
    if(!edge){let id='c'+hash(key);while(ids.has(id))id+='x';edge={id,source,target,type:'coauthor',label:COAUTHOR_EDGE_TYPE.label,directed:false,paperIds:[],evidence:[]};pairs.set(key,edge);ids.add(id);if(pairs.size>MAX_PAIRS)throw Error('The coauthor graph exceeds the browser relationship limit.');}
    edge.paperIds.push(paper.id);edge.evidence.push({paperId:paper.id,title:paper.title,...(paper.doi?{doi:paper.doi}:{}),...(paper.arxivId?{arxivId:paper.arxivId}:{}),...(paper.year?{year:paper.year}:{}),url:paper.url});
  }}
  graph.edges.push(...pairs.values());for(const node of graph.nodes)node.degree=0;for(const edge of graph.edges){if(nodes.has(edge.source))nodes.get(edge.source).degree++;if(nodes.has(edge.target))nodes.get(edge.target).degree++;}
  const profiles=graph.nodes.filter(person),references=graph.nodes.filter(n=>n.entityType==='person'&&n.stub),coordinates=new Set(profiles.flatMap(n=>(n.records||[]).map(r=>r.sourceFile+'|'+r.row)));
  const paperRecordFiles=new Set(graph.papers.map(p=>`paper-${hash(p.id)}.json`)),mappingRecords=profiles.map(n=>(n.records||[]).filter(r=>!paperRecordFiles.has(r.sourceFile)));
  const mappingCoordinates=new Set(mappingRecords.flat().map(r=>r.sourceFile+'|'+r.row)),mappingProfiles=mappingRecords.filter(records=>records.length).length;
  graph.meta=graph.meta||{};graph.meta.counts={...graph.meta.counts,personRows:coordinates.size,people:profiles.length+references.length,profilePeople:profiles.length,referencePeople:references.length,nodes:graph.nodes.length,edges:graph.edges.length,papers:graph.papers.length,coauthorEdges:pairs.size,mergedRows:Math.max(0,mappingCoordinates.size-mappingProfiles),connectedPeople:graph.nodes.filter(n=>n.entityType==='person'&&n.degree>0).length};
  graph.meta.topNodes=[...graph.nodes].sort((a,b)=>b.degree-a.degree).slice(0,15).map(n=>n.id);
  const types=(graph.edgeTypes||graph.meta.edgeTypes||[]).filter(t=>!['coauthor','collaboration'].includes(t.id));if(graph.papers.length)types.push({...COAUTHOR_EDGE_TYPE});graph.edgeTypes=types;graph.meta.edgeTypes=copy(types);return graph;
}
function makeAuthorNode(author,id){return{id,name:author.name,nameZh:'',kind:'person',entityType:'person',affiliation:'',role:'',location:'',phd:'',bachelor:'',research:'',website:'',scholar:'',orcid:author.orcid||'',linkedin:'',affiliationType:'',academicStatus:'',jobTitle:'',expectedGraduation:'',rows:[],records:[],stub:false,aliases:[author.name],identityNote:'Imported from a public paper author list. Listed affiliations describe the publication, not a current position; career status is not inferred.',degree:0,publications:[]};}
function choiceFor(document,paperIndex,authorIndex){const key=`${paperIndex}:${authorIndex}`;return document.matches[key]??(document.papers.length===1?document.matches[String(authorIndex)]:undefined);}
export function previewPaperImport(base,rawDocument){
  const document=sanitizePaperDocument(rawDocument),graph=safeBase(base),oldPapers=(base.papers||[]).map(p=>sanitizePaper(p,{keepNodeIds:true})),paperMap=new Map(oldPapers.map(p=>[p.id,p]));
  const original=new Map(graph.nodes.map(n=>[n.id,JSON.stringify(n)])),nodeMap=new Map(graph.nodes.map(n=>[n.id,n])),changed=new Set(),subjects=new Set(),issues=[],warnings=[];
  let ambiguous=0,excluded=0,papersAdded=0,papersUpdated=0,focusPersonId=null;
  for(let pi=0;pi<document.papers.length;pi++){
    const incoming=document.papers[pi],prior=[...paperMap.values()].find(p=>samePaper(p,incoming));
    const paper=prior?sanitizePaper({...prior,...incoming,id:prior.id,doi:incoming.doi||prior.doi,arxivId:incoming.arxivId||prior.arxivId,year:incoming.year||prior.year,sources:[...(prior.sources||[]),...incoming.sources]}):incoming;
    const review=previewAuthorMatches({...graph,papers:[...paperMap.values()]},paper),resolved=[];let blocked=false;
    // Resolve and validate every reviewed choice before changing any author in this paper.
    const decisions=[],prospectiveORCIDs=new Map(),prospectiveOwners=new Map();
    for(const author of review.authors){
      const selected=choiceFor(document,pi,author.index),choice=typeof selected==='object'?selected.nodeId:selected;
      const strong=author.orcid?graph.nodes.filter(n=>person(n)&&existingORCID(n)===author.orcid):[];
      let node=choice&&choice!=='new'?nodeMap.get(choice):choice==='new'&&strong.length===1?strong[0]:!choice&&author.matchId?nodeMap.get(author.matchId):null;
      const reviewed=isReviewedChoice(selected);let message='';
      if(choice&&choice!=='new'&&(!person(node)||orcidConflict(node,author)||!compatible(node,author)&&!reviewed))message=`Review the identity match for ${author.name}; the selected person is missing or has conflicting identity data.`;
      else if(choice==='new'&&strong.length>1)message=`Multiple profiles carry the ORCID for ${author.name}; select the intended existing profile.`;
      else if(!choice&&!author.matchId&&author.candidateIds.length){ambiguous++;message=`Review ${author.name}: select an existing person or create a separate profile.`;}
      else if(node&&reviewed&&!author.orcid&&!compatible(node,author)&&!sanitizeNameAliases([node.name,...(node.aliases||[]),author.name]).some(value=>norm(value)===norm(author.name)))message=`The reviewed name for ${author.name} cannot be retained as a public alias; check the name or profile alias limit.`;
      else if(node&&selected?.identity&&guardChanged(node,selected.identity,author,paper,prior,[...paperMap.values()]))message=`The reviewed identity for ${author.name} changed. Review it again.`;
      else if(node&&author.orcid&&!existingORCID(node)&&strong.some(n=>n.id!==node.id))message=`The ORCID for ${author.name} already belongs to another profile; review that existing profile.`;
      if(!message&&node&&author.orcid){const previous=prospectiveORCIDs.get(node.id);if(previous&&previous!==author.orcid)message=`Conflicting author ORCIDs were assigned to ${node.name}; review the matches.`;else prospectiveORCIDs.set(node.id,author.orcid);}
      if(!message&&author.orcid){const owner=node?.id||'new:'+author.orcid,previous=prospectiveOwners.get(author.orcid);if(previous&&previous!==owner)message=`The same author ORCID was assigned to different people; review ${author.name}.`;else prospectiveOwners.set(author.orcid,owner);}
      if(message){issues.push({level:'error',paperIndex:pi,authorIndex:author.index,message});blocked=true;}
      decisions.push({author,selected,node,reviewed});
    }
    if(blocked){excluded++;continue;}
    for(const decision of decisions){
      const {author,selected,reviewed}=decision;let node=decision.node;
      if(!node){
        let id='pa'+hash(author.orcid?'orcid:'+author.orcid:paper.id+'|'+author.index+'|'+norm(author.name));
        if(nodeMap.has(id)&&compatible(nodeMap.get(id),author))node=nodeMap.get(id);
        else{while(nodeMap.has(id))id+='x';node=makeAuthorNode(author,id);nodeMap.set(id,node);graph.nodes.push(node);changed.add(id);}
      }
      const before=JSON.stringify(node);
      if(author.orcid&&!existingORCID(node)&&(!original.has(node.id)||reviewed))node.orcid=author.orcid;
      node.aliases=sanitizeNameAliases([node.name,...(node.aliases||[]),author.name]);node.publications=[...new Set([...(node.publications||[]),paper.title])];
      const fields={A:author.name,V:paper.title,...(author.orcid&&existingORCID(node)===author.orcid?{Q:author.orcid}:{}),...(paper.url?{AB:paper.url}:{}),...(node.aliases.length>1?{nameAliases:serializeNameAliases(node.aliases)}:{})};
      const record={row:author.index+1,sourceFile:`paper-${hash(paper.id)}.json`,fields};
      if(!node.records.some(r=>r.row===record.row&&r.sourceFile===record.sourceFile&&JSON.stringify(r.fields)===JSON.stringify(fields)))node.records.push(record);
      node.rows=[...new Set(node.records.map(r=>r.row))].sort((a,b)=>a-b);if(JSON.stringify(node)!==before)changed.add(node.id);subjects.add(node.id);
      resolved.push({name:author.name,...(author.orcid?{orcid:author.orcid}:{}),...(author.affiliation?{affiliation:author.affiliation}:{}),...(author.externalId?{externalId:author.externalId}:{}),nodeId:node.id});
    }
    const resolvedPaper={...paper,authors:resolved},previous=paperMap.get(paper.id);if(!previous)papersAdded++;else if(JSON.stringify(previous)!==JSON.stringify(resolvedPaper))papersUpdated++;
    paperMap.set(paper.id,resolvedPaper);focusPersonId=focusPersonId||resolved[0]?.nodeId||null;
  }
  rebuildPaperGraph(graph,[...paperMap.values()]);
  graph.meta.publicVersion=true;graph.meta.sourceFiles=[...new Set([...(graph.meta.sourceFiles||[]),document.sourceFile])];
  const profiles=graph.nodes.filter(person),added=profiles.filter(n=>!original.has(n.id)).length,updated=profiles.filter(n=>original.has(n.id)&&changed.has(n.id)).length;
  const oldCoauthor=new Set(base.edges.filter(e=>e.type==='coauthor'||e.type==='collaboration').map(e=>[...([e.source,e.target].sort())].join('|')));
  const newRelationships=graph.edges.filter(e=>e.type==='coauthor'&&!oldCoauthor.has(e.source+'|'+e.target)).length;
  return{graph,document,warnings,issues,summary:{added,updated,unchanged:profiles.filter(n=>subjects.has(n.id)&&!changed.has(n.id)).length,newRelationships,retained:profiles.filter(n=>original.has(n.id)&&!subjects.has(n.id)).length,ambiguous,excluded,processedRows:document.papers.reduce((n,p)=>n+p.authors.length,0),totalPeople:profiles.length,totalRelationships:graph.edges.length,totalNodes:graph.nodes.length,papersAdded,papersUpdated,totalPapers:graph.papers.length,changedIds:[...changed],subjectIds:[...subjects],focusPersonId,mode:'merge'}};
}
