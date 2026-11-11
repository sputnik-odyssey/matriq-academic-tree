/* MatriQ Academic Tree — dependency-free, source-backed relationship explorer. */
import {applyVerifiedMentorships,isVerifiedMentorship,MENTORSHIP_COLORS} from './mentorship.mjs?v=edge-colors-20261111';
import {renderGraphSVG,GRAPH_BACKGROUND} from './graph-render.mjs?v=edge-colors-20261111';
import {enrichPeople} from './people.mjs?v=profiles-upload-20261111';
import {loadLocalGraph,clearLocalGraph,graphFingerprint,decodeGraphBytes} from './data-sync.mjs?v=profiles-upload-20261111';
import {setupDataManager} from './data-manager.mjs?v=profiles-upload-20261111';
'use strict';
const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const norm = v => String(v || '').normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase().trim();
const truncate = (s,n=24) => [...String(s||'')].length>n ? [...s].slice(0,n-1).join('')+'…' : s||'';
const fmt = n => Number(n).toLocaleString('en-US');
const clean = v => v && !/^(?:\/|none|null|n\/a|-|—)$/i.test(String(v).trim()) ? String(v) : '';
const kindLabel = n => ({person:n.stub?'关系引用':'人物档案',institution:'机构',group:'课题组',publication:'论文'}[n.entityType]||'关联对象');
let data, rawGraph, publishedGraph, activeInfo={source:'published'}, evidenceRecords=[], nodes, adjacency, types, people, institutions, verificationCount=0;
const state = {focus:null,view:'graph',layout:'tree',depth:1,limit:9,page:0,query:'',institution:'',location:'',career:'',affiliationType:'',types:new Set(),path:null,transform:{x:0,y:0,k:1}};
let graphModel = null, drag = null, toastTimer, graphMobile = null;

function notify(message){ $('#toast').textContent=message;$('#toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('#toast').hidden=true,3000); }
function safeURL(raw){ try{const u=new URL(raw);return /^https?:$/.test(u.protocol)?u.href:null;}catch{return null;} }
function link(raw,label){const url=safeURL(raw);return url?`<a class="pill-link" href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(label)} ↗</a>`:'';}
function searchText(n){ return norm([n.name,n.nameZh,n.affiliation,n.displayAffiliation,n.affiliationTypeLabel,n.role,n.statusLabel,n.jobTitle,n.expectedGraduation,n.location,n.research,...(n.publications||[]),...(n.aliases||[])].join(' ')); }
function eligible(n){return (!state.institution||n.displayAffiliation===state.institution)&&(!state.location||n.location===state.location)&&(!state.career||n.academicStatus===state.career)&&(!state.affiliationType||n.affiliationType===state.affiliationType);}
function matches(n,query=state.query){const terms=norm(query).split(/\s+/).filter(Boolean);return eligible(n)&&terms.every(t=>n.searchText.includes(t));}
function enabledEdges(id){return (adjacency.get(id)||[]).filter(e=>state.types.has(e.type));}
function other(e,id){return e.source===id?e.target:e.source;}

async function init(){
  try{
    const response=await fetch('data.json.gz',{cache:'no-cache'});
    if(!response.ok)throw Error('数据文件未能载入');
    publishedGraph=await decodeGraphBytes(await response.arrayBuffer());
    try{const evidenceResponse=await fetch('mentorships.json?v=guidance-coverage-20261111',{cache:'no-cache'});if(evidenceResponse.ok)evidenceRecords=(await evidenceResponse.json()).relationships||[];}catch(error){console.warn('Guidance evidence could not be loaded.');}
    let active=publishedGraph,info={source:'published'};
    try{
      const local=await loadLocalGraph();
      if(local?.graph?.nodes&&local.graph.edges){
        if(await graphFingerprint(local.graph)===await graphFingerprint(publishedGraph))await clearLocalGraph();
        else{active=local.graph;info=local.info||{source:'local'};}
      }
    }catch(error){console.warn('Local preview storage is unavailable.');}
    activateGraph(active,info);
    bindEvents();
    setupDataManager({getBaseGraph:()=>rawGraph,getPublishedGraph:()=>publishedGraph,getActiveInfo:()=>activeInfo,onActivateGraph:(graph,nextInfo)=>{
      if(nextInfo.source==='published_pending')publishedGraph=structuredClone(graph);
      activateGraph(graph,nextInfo);
    }});
  }catch(error){$('#graph-status').textContent='载入失败';$('#graph-empty').hidden=false;$('#graph-empty').textContent=`${error.message}。请刷新页面重试。`;console.error(error);}
}

function activateGraph(graph,info={source:'published'}){
  const previous=state.focus;
  activeInfo=structuredClone(info);rawGraph=structuredClone(graph);data=structuredClone(rawGraph);
  const today=new Date(),asOf=`${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;
  data.nodes=enrichPeople(data.nodes,{asOf});verificationCount=applyVerifiedMentorships(data,evidenceRecords);
  nodes=new Map(data.nodes.map(n=>[n.id,n]));adjacency=new Map(data.nodes.map(n=>[n.id,[]]));
  for(const n of data.nodes)n.searchText=searchText(n);
  for(const edge of data.edges){adjacency.get(edge.source)?.push(edge);adjacency.get(edge.target)?.push(edge);}
  const baseColors={research:'#b2c5d3',followup:'#a6b8c9',institution:'#a6c2d8'};
  types=(data.edgeTypes||data.meta.edgeTypes||[]).filter(t=>!['phd','postdoc'].includes(t.id)).map(t=>({...t,color:baseColors[t.id]||'#a6b8c9'}));
  types.push({id:'phd',label:'已确认 PhD 指导',color:'#c4473d'},{id:'postdoc',label:'已确认 Postdoc 指导',color:'#c87816'});
  state.types=new Set(types.map(t=>t.id));state.institution='';state.location='';state.career='';state.affiliationType='';state.query='';state.depth=1;state.page=0;
  for(const id of ['search','career-filter','affiliationtype-filter'])$('#'+id).value='';$('#depth').value='1';
  people=data.nodes.filter(n=>n.entityType==='person');institutions=new Map();
  for(const n of people.filter(n=>!n.stub&&n.displayAffiliation&&n.displayAffiliation!=='Not provided')){if(!institutions.has(n.displayAffiliation))institutions.set(n.displayAffiliation,[]);institutions.get(n.displayAffiliation).push(n);}
  $('#people-count').textContent=fmt(data.meta.counts.profilePeople);$('#people-count').nextElementSibling.textContent='人物档案';
  $('#edge-count').textContent=fmt(data.edges.length);$('#institution-count').textContent=fmt(institutions.size);
  $('#type-filters').innerHTML=types.map(t=>`<label class="type-option"><input type="checkbox" value="${esc(t.id)}" checked><span class="color-dot" style="background:${esc(t.color)}"></span><span>${esc(t.label)}</span><small>${fmt(data.edges.filter(e=>e.type===t.id).length)}</small></label>`).join('');
  $('#legend').innerHTML=types.map(t=>`<span><i class="line-swatch ${t.id==='postdoc'||t.id==='followup'?'dashed':''} ${['phd','postdoc'].includes(t.id)?'directed':''}" style="color:${esc(t.color)}"></i>${esc(t.label)}</span>`).join('');
  $('#institution-filter').innerHTML='<option value="">全部机构</option>'+[...institutions].sort((a,b)=>b[1].length-a[1].length).map(([name,arr])=>`<option value="${esc(name)}">${esc(name)} (${arr.length})</option>`).join('');
  $('#location-filter').innerHTML='<option value="">全部国家 / 地区</option>'+[...new Set(people.map(n=>n.location).filter(Boolean))].sort().map(c=>`<option value="${esc(c)}">${esc(c)}</option>`).join('');
  $('#person-options').innerHTML=people.map(n=>`<option value="${esc(pathLabel(n))}"></option>`).join('');
  $('#mentorship-example').hidden=verificationCount===0;
  $('#source-sheet').textContent=data.meta.sheet||'Mapping';$('#source-filename').textContent=data.meta.sourceFile||'Imported public data';
  $('#database-state').textContent=info.source==='local'?'Local preview':info.source==='published_pending'?'Published update · deploying':'Published database';
  buildAbout();
  const hashId=new URLSearchParams(location.hash.slice(1)).get('person');
  const focus=nodes.has(previous)?previous:nodes.has(hashId)?hashId:(data.meta.topNodes?.find(id=>nodes.has(id))||people[0]?.id||data.nodes[0]?.id);
  if(focus)selectPerson(focus,false);
}

function buildAbout(){
  const phd=data.edges.filter(e=>e.type==='phd'&&isVerifiedMentorship(e)).length;
  const postdoc=data.edges.filter(e=>e.type==='postdoc'&&isVerifiedMentorship(e)).length;
  $('#about-content').innerHTML=`<p>MatriQ Academic Tree uses source-backed profiles and relationships from <b>${esc(data.meta.sourceFile)}</b>. The visual style follows <a href="https://sputnik-odyssey.github.io/matriq-atom-lab/" target="_blank" rel="noopener noreferrer">MatriQ Atom Lab</a>.</p>
  <h3>指导关系连线</h3><p>红色实线表示已确认的 PhD 指导关系，橙色虚线表示已确认的 Postdoc 指导关系。箭头由导师指向受指导者。颜色属于每条关系，在一至三度关联及网络视图中保持相同含义。</p><p>人物框不表示辈分或指导类型；黑框仅标记当前选中人物。目前有 ${phd} 条已确认 PhD 指导关系、${postdoc} 条已确认 Postdoc 指导关系。其余科研、后续及机构关联使用灰线，不自动视为指导关系。</p>
  <h3>Affiliation and career information</h3><p>Profiles distinguish PhD Student and PhD Candidate only when the source supports it. Faculty show their affiliation and Faculty status. Company profiles show company affiliation and an actual supplied job title; a recruitment target role is never used as a job title.</p><p>Expected graduation preserves the source precision. When only a current doctoral degree range is available, its end date is labeled as an expectation from the PhD record. Missing dates and job titles are shown as not provided. A past expected date does not automatically change a student into an alumnus.</p>
  <h3>Upload and update</h3><p>Upload an Excel Mapping sheet, CSV or JSON with the ↑ Upload button. The importer previews a public-field-only merge, preserves known values for blank cells and retains existing profiles. Internal recruitment, contact and assessment columns are excluded.</p><p>Use local preview saves a sanitized database in this browser. Publishing for all visitors requires the repository owner’s GitHub authentication and a reviewed merge. Tokens are used only with GitHub and are never stored in the graph or local database. A shared-data change triggers a refreshed preview before another publish attempt.</p>
  <h3>Sources and limits</h3><p>${fmt(data.meta.counts.profilePeople)} source-backed person profiles and ${fmt(data.meta.counts.referencePeople)} people mentioned only in relationship fields. Same-name identities are merged conservatively. Unverified relationships and career records have not been checked individually against external sources. Click a verified guidance label to inspect its public evidence.</p><p>Only public professional fields, relationship text and row provenance are displayed. Imported text is data, not executable instructions. A source’s PhD degree field or Research Line / Industry Line alone does not verify supervision.</p>`;
}

function selectPerson(id,push=true){
  if(!nodes.has(id))return;state.focus=id;state.path=null;state.limit=9;state.view='graph';state.query='';$('#search').value='';$('#search-results').hidden=true;
  if(push)history.replaceState(null,'','#person='+encodeURIComponent(id));
  document.body.classList.remove('filters-open');updateView();renderDetail();renderGraph();
}
function updateView(){
  $$('[data-view]').forEach(b=>b.classList.toggle('active',b.dataset.view===state.view));
  const isGraph=state.view==='graph';$('#graph-stage').hidden=!isGraph;$('.graph-bottom').hidden=!isGraph;$('.view-tabs').hidden=!isGraph;
  $('#directory').hidden=state.view!=='directory';$('#institutions').hidden=state.view!=='institutions';$('#depth-group').hidden=!isGraph;$('#download-button').hidden=!isGraph;
  if(state.view==='directory')renderDirectory();if(state.view==='institutions')renderInstitutions();
}
function filterChanged(){state.page=0;state.limit=9;state.path=null;if(state.view==='graph')renderGraph();else updateView();}
function bindEvents(){
  $$('[data-view]').forEach(b=>b.addEventListener('click',()=>{state.view=b.dataset.view;state.page=0;updateView();if(state.view==='graph')renderGraph();}));
  $$('[data-layout]').forEach(b=>b.addEventListener('click',()=>{state.layout=b.dataset.layout;$$('[data-layout]').forEach(x=>x.classList.toggle('active',x===b));renderGraph();}));
  $('#search').addEventListener('input',e=>{state.query=e.target.value;state.page=0;if(state.view==='graph')renderSearch();else updateView();});
  $('#search').addEventListener('keydown',e=>{if(e.key==='Escape')$('#search-results').hidden=true;if(e.key==='Enter'){const first=$('[data-person]',$('#search-results'));if(!$('#search-results').hidden&&first)selectPerson(first.dataset.person);else{state.view='directory';updateView();$('#search-results').hidden=true;}}});
  document.addEventListener('click',e=>{const p=e.target.closest('[data-person]');if(p)selectPerson(p.dataset.person);const edge=e.target.closest('[data-edge]');if(edge)showEdge(edge.dataset.edge);if(!e.target.closest('.search-wrap'))$('#search-results').hidden=true;});
  $('#institution-filter').addEventListener('change',e=>{state.institution=e.target.value;filterChanged();});
  $('#location-filter').addEventListener('change',e=>{state.location=e.target.value;filterChanged();});
  $('#career-filter').addEventListener('change',e=>{state.career=e.target.value;filterChanged();});
  $('#affiliationtype-filter').addEventListener('change',e=>{state.affiliationType=e.target.value;filterChanged();});
  $('#depth').addEventListener('change',e=>{state.depth=+e.target.value;state.path=null;renderGraph();});
  $('#type-filters').addEventListener('change',e=>{if(e.target.checked)state.types.add(e.target.value);else state.types.delete(e.target.value);filterChanged();});
  $('#reset-filters').addEventListener('click',()=>{state.institution='';state.location='';state.career='';state.affiliationType='';state.query='';state.depth=1;state.types=new Set(types.map(t=>t.id));$('#institution-filter').value='';$('#location-filter').value='';$('#career-filter').value='';$('#affiliationtype-filter').value='';$('#search').value='';$('#depth').value='1';$$('#type-filters input').forEach(i=>i.checked=true);filterChanged();});
  for(const id of ['about-button','method-button','colors-button'])$('#'+id).addEventListener('click',()=>$('#about-modal').showModal());
  $('#mentorship-example').addEventListener('click',()=>{const example=data.edges.find(isVerifiedMentorship);if(example){$('#reset-filters').click();selectPerson(example.target);}});
  $$('[data-close]').forEach(b=>b.addEventListener('click',()=>b.closest('dialog').close()));
  $$('dialog').forEach(d=>d.addEventListener('click',e=>{if(e.target===d){const r=d.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)d.close();}}));
  $('#wander').addEventListener('click',()=>{const choices=people.filter(n=>eligible(n)&&enabledEdges(n.id).length>0);if(!choices.length)return notify('当前筛选下没有相连人物，请调整筛选。');selectPerson(choices[Math.floor(Math.random()*choices.length)].id);});
  $('#path-button').addEventListener('click',()=>{$('#path-start').value=pathLabel(nodes.get(state.focus));$('#path-result').innerHTML='';$('#path-modal').showModal();});
  $('#find-path').addEventListener('click',findPath);
  $('#show-more').addEventListener('click',()=>{state.limit+=24;renderGraph();});
  $('#zoom-in').addEventListener('click',()=>zoom(1.25));$('#zoom-out').addEventListener('click',()=>zoom(.8));$('#fit').addEventListener('click',fitGraph);
  $('#download-button').addEventListener('click',exportGraph);
  $('#mobile-filter').addEventListener('click',()=>document.body.classList.toggle('filters-open'));
  $('.brand').addEventListener('click',e=>{e.preventDefault();$('#reset-filters').click();selectPerson(data.meta.topNodes[0]);});
  document.addEventListener('keydown',e=>{if(e.key==='/'&&!/INPUT|TEXTAREA|SELECT/.test(e.target.tagName)&&!$('dialog[open]')){e.preventDefault();$('#search').focus();}if(e.key==='Escape')document.body.classList.remove('filters-open');});
  const svg=$('#graph');
  svg.addEventListener('wheel',e=>{e.preventDefault();const r=svg.getBoundingClientRect();zoom(e.deltaY>0?.9:1.1,e.clientX-r.left,e.clientY-r.top);},{passive:false});
  svg.addEventListener('pointerdown',e=>{if(e.target.closest('.node,.edge'))return;drag={x:e.clientX,y:e.clientY,tx:state.transform.x,ty:state.transform.y};svg.setPointerCapture(e.pointerId);svg.style.cursor='grabbing';});
  svg.addEventListener('pointermove',e=>{if(!drag)return;state.transform.x=drag.tx+e.clientX-drag.x;state.transform.y=drag.ty+e.clientY-drag.y;applyTransform();});
  const endDrag=()=>{drag=null;svg.style.cursor='grab';};svg.addEventListener('pointerup',endDrag);svg.addEventListener('pointercancel',endDrag);
  svg.addEventListener('keydown',e=>{const target=e.target.closest('[data-person],[data-edge]');if(target&&(e.key==='Enter'||e.key===' ')){e.preventDefault();if(target.dataset.person)selectPerson(target.dataset.person);else showEdge(target.dataset.edge);}});
  new ResizeObserver(()=>{if(state.view==='graph'&&graphModel){const mobile=innerWidth<=700;if(graphMobile!==mobile){graphMobile=mobile;renderGraph();}else fitGraph();}}).observe($('#graph-stage'));
}

function renderSearch(){
  const q=norm(state.query);if(!q){$('#search-results').hidden=true;return;}
  const found=data.nodes.filter(n=>matches(n)).sort((a,b)=>(norm(b.name)===q)-(norm(a.name)===q)||(b.degree||0)-(a.degree||0));
  $('#search-results').hidden=false;$('#search-results').innerHTML=found.slice(0,12).map(n=>`<button class="search-result" data-person="${n.id}"><b>${esc(n.name)} ${n.nameZh&&n.nameZh!==n.name?`<span>${esc(n.nameZh)}</span>`:''}</b><small>${esc(n.displayAffiliation||kindLabel(n))} · ${fmt(n.degree||0)} 条关联${n.stub?'':` · 第 ${n.rows[0]} 行`}</small></button>`).join('')||'<p class="no-results">没有匹配的人物或机构</p>';
  if(found.length>12)$('#search-results').insertAdjacentHTML('beforeend',`<p class="search-summary">找到 ${fmt(found.length)} 个对象 · 按 Enter 选择首项</p>`);
}

function collectGraph(){
  if(state.path){const selected=new Set(state.path.nodes);return{ids:state.path.nodes,edges:state.path.edges,dist:new Map(state.path.nodes.map((id,i)=>[id,i])),total:selected.size,path:true};}
  const dist=new Map([[state.focus,0]]), queue=[state.focus],parent=new Map();
  for(let i=0;i<queue.length;i++){const id=queue[i],level=dist.get(id);if(level>=state.depth)continue;const edges=enabledEdges(id).sort((a,b)=>(b.target===id)-(a.target===id)||(nodes.get(other(b,id)).degree||0)-(nodes.get(other(a,id)).degree||0));for(const edge of edges){const next=other(edge,id);if(dist.has(next)||!eligible(nodes.get(next)))continue;dist.set(next,level+1);parent.set(next,id);queue.push(next);}}
  // Reserve room for a second-degree branch instead of letting a large hub consume every slot.
  const limit=innerWidth<=700&&state.limit===9?5:state.limit;
  let chosen=[state.focus];if(state.depth>1&&queue.length>limit){const first=queue.filter(id=>dist.get(id)===1),second=queue.filter(id=>dist.get(id)>1);const firstCount=Math.min(first.length,second.length?Math.max(3,Math.floor(limit*.65)):limit-1);chosen.push(...first.slice(0,firstCount));const allowed=new Set(chosen);for(const id of second){if(chosen.length>=limit)break;if(allowed.has(parent.get(id))){chosen.push(id);allowed.add(id);}}for(const id of first){if(chosen.length>=limit)break;if(!allowed.has(id)){chosen.push(id);allowed.add(id);}}}else chosen=queue.slice(0,limit);
  const visible=new Set(chosen);return{ids:chosen,edges:data.edges.filter(e=>state.types.has(e.type)&&visible.has(e.source)&&visible.has(e.target)),dist,total:queue.length,path:false};
}
function layoutGraph(model){
  const pos=new Map();if(model.path){model.ids.forEach((id,i)=>pos.set(id,{x:i*242,y:(i%2)*95}));return pos;}
  pos.set(state.focus,{x:0,y:0});
  if(state.layout==='radial'){
    let index=0;for(let depth=1;depth<=state.depth;depth++){const group=model.ids.filter(id=>model.dist.get(id)===depth);const rings=Math.ceil(group.length/12);for(let ring=0;ring<rings;ring++){const part=group.slice(ring*12,(ring+1)*12);const rx=310+ring*240+(depth-1)*410,ry=190+ring*155+(depth-1)*255;part.forEach((id,i)=>{const angle=-Math.PI/2+(i/part.length)*Math.PI*2+(depth%2?.1:.3);pos.set(id,{x:Math.cos(angle)*rx,y:Math.sin(angle)*ry});index++;});}}return pos;
  }
  const referenced=new Set(enabledEdges(state.focus).filter(e=>e.target===state.focus).map(e=>e.source));
  const upper=model.ids.filter(id=>model.dist.get(id)===1&&referenced.has(id));
  upper.forEach((id,i)=>pos.set(id,{x:(i-(upper.length-1)/2)*226,y:-110}));
  const columns=innerWidth<=700?2:4;
  let y=110;for(let depth=1;depth<=state.depth;depth++){const group=model.ids.filter(id=>model.dist.get(id)===depth&&!upper.includes(id));group.forEach((id,i)=>{const row=Math.floor(i/columns),count=Math.min(columns,group.length-row*columns);pos.set(id,{x:((i%columns)-(count-1)/2)*226,y:y+row*90});});y+=Math.ceil(group.length/columns)*90+60;}return pos;
}
function renderGraph(){
  if(!state.focus)return;const model=collectGraph();model.positions=layoutGraph(model);graphModel=model;
  const root=nodes.get(state.focus);$('#graph-context').textContent=model.path?'最短关系路径':`${root.name} 的关联网络`;
  const visiblePhd=model.edges.filter(edge=>edge.type==='phd'&&isVerifiedMentorship(edge)).length;
  const visiblePostdoc=model.edges.filter(edge=>edge.type==='postdoc'&&isVerifiedMentorship(edge)).length;
  const graphStatus=model.path?`${model.ids.length-1} 步连接`:`显示 ${model.ids.length} / ${fmt(model.total)} 个对象`;
  $('#graph-status').textContent=`${graphStatus} · PhD ${visiblePhd} · Postdoc ${visiblePostdoc}`;
  $('#graph-empty').hidden=model.path||model.ids.length>1;$('#graph-empty').innerHTML=!model.path&&model.total===1?`<b>暂无符合条件的关联</b><p>${state.institution||state.location||state.types.size<types.length?'调整左侧筛选，或搜索其他人物。':'此人物已收录档案，原表尚未记录其人物关系。'}</p>`:'';
  $('#show-more').hidden=model.path||model.ids.length>=model.total;$('#show-more').textContent=`展开更多 · 还有 ${fmt(model.total-model.ids.length)} 个对象`;
  $('#graph-world').innerHTML=renderGraphSVG({model,focus:state.focus,nodes,types,layout:state.layout});
  requestAnimationFrame(fitGraph);
}
function applyTransform(){const t=state.transform;$('#graph-world').setAttribute('transform',`translate(${t.x} ${t.y}) scale(${t.k})`);$('#zoom-label').textContent=Math.round(t.k*100)+'%';}
function fitGraph(){if(!graphModel||!graphModel.ids.length)return;const ps=[...graphModel.positions.values()];const minX=Math.min(...ps.map(p=>p.x))-110,maxX=Math.max(...ps.map(p=>p.x))+110,minY=Math.min(...ps.map(p=>p.y))-66,maxY=Math.max(...ps.map(p=>p.y))+90;const r=$('#graph-stage').getBoundingClientRect();if(!r.width||!r.height)return;const k=Math.min((r.width-56)/(maxX-minX),(r.height-110)/(maxY-minY),1.2);state.transform={k,x:r.width/2-(minX+maxX)/2*k,y:(r.height-32)/2-(minY+maxY)/2*k};applyTransform();}
function zoom(factor,x,y){const r=$('#graph-stage').getBoundingClientRect();x??=r.width/2;y??=r.height/2;const t=state.transform,newK=Math.max(.12,Math.min(3.5,t.k*factor)),ratio=newK/t.k;t.x=x-(x-t.x)*ratio;t.y=y-(y-t.y)*ratio;t.k=newK;applyTransform();}

function renderDetail(){
  const n=nodes.get(state.focus),edges=adjacency.get(n.id)||[];
  const field=(name,value)=>value?`<div class="info-row"><dt>${esc(name)}</dt><dd>${esc(value)}</dd></div>`:'';
  const relationRows=edges.slice().sort((a,b)=>nodes.get(other(a,n.id)).name.localeCompare(nodes.get(other(b,n.id)).name));
  const ambiguous=data.meta.ambiguousReferences?.find(r=>r.referenceId===n.id);
  const expected=n.expectedGraduationRelevant?`<p class="graduation-label">${esc(n.expectedGraduationLabel==='Not provided'?'Expected graduation: Not provided':n.expectedGraduationLabel)}</p>`:'';
  const notes=(n.profileNotes||[]).map(note=>`<p class="source-note">${esc(note)}</p>`).join('');
  $('#detail').innerHTML=`<div class="profile-top"><p class="profile-kicker">${esc(kindLabel(n))} <span>↗</span></p><div class="avatar" aria-hidden="true">${esc(n.entityType==='person'?n.name.split(' ').filter(Boolean).map(x=>x[0]).slice(0,2).join(''):'⌘')}</div><h2>${esc(n.name)}</h2>${n.nameZh&&n.nameZh!==n.name?`<p class="chinese-name">${esc(n.nameZh)}</p>`:''}<p class="profile-affiliation">${esc(n.displayAffiliation)}</p><span class="career-badge">${esc(n.displayRole)}</span><span class="badge">${esc(n.affiliationTypeLabel)}</span>${expected}</div>
  <div class="profile-metrics"><div><b>${fmt(edges.length)}</b><span>直接关联</span></div><div><b>${fmt(n.rows.length)}</b><span>${n.stub?'引用行':'来源记录'}</span></div></div>
  ${n.stub?'<div class="notice compact">此对象仅在关系字段出现；未记录的机构和履历不会自动补全。</div>':''}
  ${ambiguous?`<section class="detail-section"><h3>同名候选档案</h3><p class="source-note">Multiple same-name profiles remain separate.</p>${ambiguous.candidateIds.filter(id=>nodes.has(id)).map(id=>{const c=nodes.get(id);return`<button class="relation-item" data-person="${id}"><b>${esc(c.name)}</b><small>${esc(c.displayAffiliation||c.phd||'第 '+c.rows[0]+' 行')}</small></button>`}).join('')}</section>`:''}
  <section class="detail-section"><h3>Affiliation & career</h3><dl>${field('Affiliation',n.displayAffiliation)}${field('Affiliation type',n.affiliationTypeLabel)}${field('Career status',n.statusLabel)}${n.academicStatus==='industry'||n.jobTitle?field('Job title',n.jobTitle||'Not provided'):''}${n.expectedGraduationRelevant?field('Expected graduation',n.expectedGraduation||'Not provided'):''}${n.expectedGraduationSource==='degree_range'?field('Graduation date source','End of recorded current PhD range; expected, not confirmed completion'):''}${n.displayAffiliationSource==='degree_record'?field('Affiliation source','Current doctoral degree record'):''}${field('Country / region',n.location)}${field('PhD record',n.phd)}${field('Bachelor record',n.bachelor)}</dl>${notes}<div class="external-links">${link(n.website,'个人主页')}${link(n.scholar,'Scholar')}${link(n.linkedin,'LinkedIn')}${n.orcid?link('https://orcid.org/'+n.orcid.replace(/^.*orcid.org\//,''),'ORCID'):''}</div></section>
  <section class="detail-section"><h3>关联人物与对象 <small>${edges.length}</small></h3><div class="relation-list">${relationRows.length?relationRows.map(e=>{const person=nodes.get(other(e,n.id)),type=types.find(x=>x.id===e.type);return`<div class="relation-row"><button class="relation-item" data-person="${person.id}"><span class="color-dot" style="background:${esc(type?.color||'#789')}"></span><span><b>${esc(person.name)}</b><small>${esc(person.displayAffiliation)} · ${esc(person.displayRole)}</small></span><span aria-hidden="true">↗</span></button><button class="source-link" data-edge="${e.id}">${esc(e.label)} · ${e.evidence.map(v=>`${v.column}${v.row}`).join(', ')}</button></div>`}).join(''):'<p class="source-note">原表尚无可展示的关联记录。</p>'}</div></section>
  <section class="detail-section"><h3>Source records</h3><div class="source-record">${(n.records||[]).map(rec=>`<details><summary>${esc(rec.sourceFile||data.meta.sourceFile||'Mapping')} · row ${rec.row}</summary>${(data.meta.columns||[]).filter(c=>clean(rec.fields[c.key])).map(c=>`<div class="source-field"><dt>${esc(c.key)} · ${esc(c.label)}</dt><dd>${esc(rec.fields[c.key])}</dd></div>`).join('')}</details>`).join('')}</div></section>`;
}

function showEdge(id){
  const edge=data.edges.find(e=>e.id===id);if(!edge)return;
  const confirmed=isVerifiedMentorship(edge);
  const sources=confirmed?edge.verification.sources||[]:[];
  $('#edge-content').innerHTML=`<p class="edge-pair"><b>${esc(nodes.get(edge.source).name)}</b><span>${confirmed?'→':'—'}</span><b>${esc(nodes.get(edge.target).name)}</b></p><span class="badge mentorship-tag">${esc(edge.relationshipLabel||edge.label)}</span>
  <div class="notice">${confirmed?'已依据公开来源核验。箭头由导师指向受指导者；共同指导关系仅展示原表已记录的导师。':'本连线仅表示原表关联，不自动推定指导关系或时间方向。'}</div>
  ${confirmed?`<section class="detail-section"><h3>公开指导证据</h3><p>${esc(edge.verification.note||'')}</p>${sources.map(s=>`<p><a class="evidence-link" href="${esc(safeURL(s.url)||'#')}" target="_blank" rel="noopener noreferrer">${esc(s.title)} ↗</a><br>${esc(s.summary||'')}</p>`).join('')}<p class="source-note">核验日期：${esc(edge.verification.checkedAt||'')}</p></section>`:''}
  ${edge.evidence.map(v=>`<section class="detail-section"><h3>Mapping!${v.column}${v.row} · ${esc(v.field)}</h3><p class="evidence-value">${esc(v.value)}</p><p class="source-note">该行人物：${esc(data.nodes.find(n=>!n.stub&&n.rows.includes(v.row))?.name||nodes.get(edge.target).name)}</p></section>`).join('')}`;
  $('#edge-modal').showModal();
}

function filteredPeople(){return people.filter(n=>matches(n)).sort((a,b)=>(b.degree||0)-(a.degree||0)||a.name.localeCompare(b.name));}
function renderDirectory(){
  const arr=filteredPeople(),pageSize=40,totalPages=Math.max(1,Math.ceil(arr.length/pageSize));state.page=Math.min(state.page,totalPages-1);$('#graph-context').textContent=`${fmt(arr.length)} person profiles / references`;
  $('#directory').innerHTML=`<div class="directory-header"><h2>人物名录</h2><p>Affiliation, career stage and expected graduation are source-based.</p></div><div class="table-scroll"><table class="directory-table"><thead><tr><th>Person</th><th>Affiliation / type</th><th>Career / job title</th><th>Expected graduation</th><th>Links</th></tr></thead><tbody>${arr.slice(state.page*pageSize,(state.page+1)*pageSize).map(n=>`<tr><td><button class="name-button" data-person="${n.id}">${esc(n.name)}</button><small>${esc(n.nameZh&&n.nameZh!==n.name?n.nameZh:(!n.stub?'Source row '+n.rows[0]:''))}</small></td><td>${esc(n.displayAffiliation)}<small>${esc(n.affiliationTypeLabel)}${n.location?' · '+esc(n.location):''}</small></td><td><span class="career-badge">${esc(n.displayRole)}</span>${n.academicStatus==='faculty'&&n.jobTitle?`<small>${esc(n.jobTitle)}</small>`:''}</td><td>${n.expectedGraduationRelevant?`${esc(n.expectedGraduation||'Not provided')}${n.expectedGraduationSource==='degree_range'?'<small>From PhD record</small>':''}${n.graduationNeedsUpdate?'<small>Needs status update</small>':''}`:'—'}</td><td>${n.degree||0}</td></tr>`).join('')||'<tr><td colspan="5" class="no-results">No matching profiles.</td></tr>'}</tbody></table></div><div class="pagination"><span>Page ${state.page+1} / ${totalPages} · ${fmt(arr.length)} people / references</span><button id="prev-page" class="secondary-button" ${state.page===0?'disabled':''}>Previous</button><button id="next-page" class="secondary-button" ${state.page+1>=totalPages?'disabled':''}>Next</button></div>`;
  $('#prev-page').onclick=()=>{state.page--;renderDirectory();};$('#next-page').onclick=()=>{state.page++;renderDirectory();};
}

function renderInstitutions(){const arr=[...institutions].map(([name,ps])=>[name,ps.filter(n=>(!state.location||n.location===state.location)&&(!state.institution||n.displayAffiliation===state.institution)&&(!state.query||searchText(n).includes(norm(state.query))))]).filter(([,ps])=>ps.length).sort((a,b)=>b[1].length-a[1].length);$('#graph-context').textContent=`${fmt(arr.length)} 个机构名称`;
  $('#institutions').innerHTML=`<div class="directory-header"><h2>研究机构</h2><p>按 CurrentAffiliation 原文归类；同一机构的不同写法分别保留。</p></div><div class="institution-grid">${arr.slice(state.page*30,(state.page+1)*30).map(([name,ps])=>`<button class="institution-card" data-institution="${esc(name)}"><span class="institution-icon">⌘</span><h3>${esc(name)}</h3><p>${fmt(ps.length)} 个档案 <span>↗</span></p></button>`).join('')||'<p class="no-results">没有符合筛选条件的机构。</p>'}</div><div class="pagination"><span>第 ${state.page+1} / ${Math.max(1,Math.ceil(arr.length/30))} 页</span><button class="secondary-button" id="inst-prev" ${state.page===0?'disabled':''}>上一页</button><button class="secondary-button" id="inst-next" ${(state.page+1)*30>=arr.length?'disabled':''}>下一页</button></div>`;
  $$('[data-institution]').forEach(b=>b.onclick=()=>{state.institution=b.dataset.institution;$('#institution-filter').value=state.institution;state.view='directory';state.query='';$('#search').value='';state.page=0;updateView();});$('#inst-prev').onclick=()=>{state.page--;renderInstitutions();};$('#inst-next').onclick=()=>{state.page++;renderInstitutions();};
}

function pathLabel(n){return `${n.name}${n.nameZh&&n.nameZh!==n.name?' / '+n.nameZh:''} · ${n.displayAffiliation||kindLabel(n)} [${n.id}]`;}
function pathRelationLabel(edge,from){return isVerifiedMentorship(edge)?`${edge.type==='phd'?'PhD':'Postdoc'} · ${edge.source===from?'导师 → 受指导者':'受指导者 → 导师'}`:edge.label;}
function resolvePerson(raw){if(!norm(raw))return{error:'请填写起点和终点人物。'};const id=raw.match(/\[([^\]]+)\]$/)?.[1];if(id&&nodes.has(id))return{id};const matches=people.filter(n=>norm(n.name)===norm(raw)||norm(n.nameZh)===norm(raw));return matches.length===1?{id:matches[0].id}:matches.length>1?{error:'该姓名对应多个档案，请从建议列表选择含机构和编号的完整条目。'}:{error:'未找到该人物，请输入姓名并从建议列表选择。'};}
function findPath(){
  const start=resolvePerson($('#path-start').value),end=resolvePerson($('#path-end').value);if(start.error||end.error){$('#path-result').innerHTML=`<div class="notice">${esc(start.error||end.error)}</div>`;return;}
  if(!state.types.size){$('#path-result').innerHTML='<div class="notice">请先在左侧勾选至少一种关系类型。</div>';return;}
  const parents=new Map([[start.id,null]]),queue=[start.id];for(let i=0;i<queue.length&&!parents.has(end.id);i++){for(const edge of enabledEdges(queue[i])){const next=other(edge,queue[i]);if(!parents.has(next)){parents.set(next,{id:queue[i],edge});queue.push(next);}}}
  if(!parents.has(end.id)){$('#path-result').innerHTML='<div class="notice">当前记录与关系类型下没有连通路径。没有连线不代表现实中不存在关系。</div>';return;}
  const ids=[],edges=[];let current=end.id;while(current){ids.unshift(current);const prev=parents.get(current);if(prev)edges.unshift(prev.edge);current=prev?.id;}
  $('#path-result').innerHTML=`<p class="path-summary">找到最短路径 · ${edges.length} 步连接</p><div class="path-steps">${ids.map((id,i)=>`${i?`<div class="path-connector">↓ ${esc(pathRelationLabel(edges[i-1],ids[i-1]))} <button class="source-link" data-edge="${edges[i-1].id}">查看原文</button></div>`:''}<div class="path-step"><b>${esc(nodes.get(id).name)}</b><small>${esc(nodes.get(id).affiliation||kindLabel(nodes.get(id)))}</small></div>`).join('')}</div><button class="primary-button" id="show-path">在图谱中查看</button>`;
  $('#show-path').onclick=()=>{state.focus=start.id;history.replaceState(null,'','#person='+encodeURIComponent(start.id));state.path={nodes:ids,edges};state.view='graph';$('#path-modal').close();updateView();renderDetail();renderGraph();};
}
function exportGraph(){
  if(!graphModel)return;
  const ps=[...graphModel.positions.values()],left=Math.min(...ps.map(p=>p.x))-110,right=Math.max(...ps.map(p=>p.x))+110;
  const width=Math.max(880,right-left),minX=(left+right-width)/2;
  const minY=Math.min(...ps.map(p=>p.y))-70,maxY=Math.max(...ps.map(p=>p.y))+100,height=maxY-minY+110;
  const family='Times New Roman, Times, Songti SC, serif';
  const swatches=[['phd',MENTORSHIP_COLORS.phd,'PhD supervision'],['postdoc',MENTORSHIP_COLORS.postdoc,'Postdoc supervision'],['other','#b2c5d3','Other / unverified']];
  const legend=swatches.map(([stage,color,label],i)=>{
    const x=minX+20+i*200,d=`M ${x} ${maxY+13} h 26`,dash=stage==='postdoc'?' stroke-dasharray="7 4"':'';
    return `${stage!=='other'?`<path d="${d}" fill="none" stroke="#213848" stroke-width="5.2"${dash}/>`:''}<path d="${d}" fill="none" stroke="${color}" stroke-width="2.7"${dash}${stage!=='other'?` marker-end="url(#arrow-${stage})"`:''}/><text x="${x+35}" y="${maxY+17}" fill="#e5edf4" font-family="${family}" font-size="11">${label}</text>`;
  }).join('');
  const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="${minX} ${minY-65} ${width} ${height}"><rect x="${minX}" y="${minY-65}" width="100%" height="100%" fill="${GRAPH_BACKGROUND}"/><text x="${minX+20}" y="${minY-30}" fill="#e5edf4" font-family="${family}" font-size="16">MatriQ · ${esc(nodes.get(state.focus).name)} · 关系网络</text><text x="${minX+20}" y="${maxY-12}" fill="#aec7d9" font-family="${family}" font-size="11">来源：Mapping · 红线：PhD 指导 · 橙色虚线：Postdoc 指导 · 箭头由导师指向受指导者</text><g font-family="${family}">${$('#graph-world').innerHTML}</g>${legend}</svg>`;
  const a=document.createElement('a'),url=URL.createObjectURL(new Blob([svg],{type:'image/svg+xml;charset=utf-8'}));
  a.href=url;a.download='MatriQ-'+nodes.get(state.focus).name.replace(/[^\w\u4e00-\u9fff-]/g,'_')+'.svg';a.click();
  setTimeout(()=>URL.revokeObjectURL(url),1000);notify('当前图谱已导出为 SVG');
}
init();
