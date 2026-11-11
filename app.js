/* MatriQ Academic Tree — dependency-free, source-backed relationship explorer. */
'use strict';
const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const norm = v => String(v || '').normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase().trim();
const truncate = (s,n=24) => [...String(s||'')].length>n ? [...s].slice(0,n-1).join('')+'…' : s||'';
const fmt = n => Number(n).toLocaleString('en-US');
const clean = v => v && !/^(?:\/|none|null|n\/a|-|—)$/i.test(String(v).trim()) ? String(v) : '';
const kindLabel = n => ({person:n.stub?'关系引用':'人物档案',institution:'机构',group:'课题组',publication:'论文'}[n.entityType]||'关联对象');
let data, nodes, adjacency, types, people, institutions;
const state = {focus:null,view:'graph',layout:'tree',depth:1,limit:9,page:0,query:'',institution:'',location:'',types:new Set(),path:null,transform:{x:0,y:0,k:1}};
let graphModel = null, drag = null, toastTimer, graphMobile = null;

function notify(message){ $('#toast').textContent=message;$('#toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('#toast').hidden=true,3000); }
function safeURL(raw){ try{const u=new URL(raw);return /^https?:$/.test(u.protocol)?u.href:null;}catch{return null;} }
function link(raw,label){const url=safeURL(raw);return url?`<a class="pill-link" href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(label)} ↗</a>`:'';}
function searchText(n){ return norm([n.name,n.nameZh,n.affiliation,n.role,n.location,n.research,...(n.publications||[]),...(n.aliases||[])].join(' ')); }
function matches(n,query=state.query){const terms=norm(query).split(/\s+/).filter(Boolean);return (!state.institution||n.affiliation===state.institution)&&(!state.location||n.location===state.location)&&terms.every(t=>n.searchText.includes(t));}
function enabledEdges(id){return (adjacency.get(id)||[]).filter(e=>state.types.has(e.type));}
function other(e,id){return e.source===id?e.target:e.source;}
function eligible(n){return (!state.institution||n.affiliation===state.institution)&&(!state.location||n.location===state.location);}

async function init(){
  try{
    const response=await fetch('data.json.gz');if(!response.ok)throw Error('数据文件未能载入');
    const bytes=new Uint8Array(await response.arrayBuffer());
    if(bytes[0]===0x1f&&bytes[1]===0x8b){
      if(typeof DecompressionStream==='undefined')throw Error('当前浏览器不支持压缩数据，请使用新版 Chrome、Edge、Firefox 或 Safari');
      const stream=new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
      data=await new Response(stream).json();
    }else data=JSON.parse(new TextDecoder().decode(bytes));
    nodes=new Map(data.nodes.map(n=>[n.id,n]));adjacency=new Map(data.nodes.map(n=>[n.id,[]]));
    for(const n of data.nodes)n.searchText=searchText(n);
    for(const e of data.edges){adjacency.get(e.source)?.push(e);adjacency.get(e.target)?.push(e);}
    types=data.edgeTypes||data.meta.edgeTypes;state.types=new Set(types.map(t=>t.id));
    people=data.nodes.filter(n=>n.entityType==='person');institutions=new Map();
    for(const n of people.filter(n=>!n.stub&&n.affiliation)){if(!institutions.has(n.affiliation))institutions.set(n.affiliation,[]);institutions.get(n.affiliation).push(n);}
    $('#people-count').textContent=fmt(data.meta.counts.profilePeople);$('#people-count').nextElementSibling.textContent='人物档案';
    $('#edge-count').textContent=fmt(data.edges.length);$('#institution-count').textContent=fmt(institutions.size);
    $('#type-filters').innerHTML=types.map(t=>`<label class="type-option"><input type="checkbox" value="${esc(t.id)}" checked><span class="color-dot" style="background:${esc(t.color)}"></span><span>${esc(t.label)}</span><small>${fmt(data.edges.filter(e=>e.type===t.id).length)}</small></label>`).join('');
    $('#legend').innerHTML=types.map(t=>`<span><i class="color-dot" style="background:${esc(t.color)}"></i>${esc(t.label)}</span>`).join('');
    $('#institution-filter').innerHTML+=[...institutions].sort((a,b)=>b[1].length-a[1].length).map(([name,arr])=>`<option value="${esc(name)}">${esc(name)} (${arr.length})</option>`).join('');
    const countries=[...new Set(people.map(n=>n.location).filter(Boolean))].sort();
    $('#location-filter').innerHTML+=countries.map(c=>`<option value="${esc(c)}">${esc(c)}</option>`).join('');
    $('#person-options').innerHTML=people.map(n=>`<option value="${esc(pathLabel(n))}"></option>`).join('');
    buildAbout();bindEvents();
    const id=new URLSearchParams(location.hash.slice(1)).get('person');
    selectPerson(nodes.has(id)?id:(data.meta.topNodes?.[0]||people.find(n=>n.degree)?.id||people[0].id),false);
  }catch(error){$('#graph-status').textContent='载入失败';$('#graph-empty').hidden=false;$('#graph-empty').textContent=`${error.message}。请刷新页面重试。`;console.error(error);}
}

function buildAbout(){
  $('#about-content').innerHTML=`<p>以 <a href="https://academictree.org/physics/" target="_blank" rel="noopener noreferrer">Physics Tree</a> 的人物探索方式为参考，依据来源文件 <b>${esc(data.meta.sourceFile)}</b> 中 <b>${esc(data.meta.sheet)}</b> 工作表制作。</p><div class="notice">连线表示原表记录的关联；图的上下位置和连接路径不代表博士师承、学术辈分或因果关系。</div><h3>关系类型</h3><p><b>科研关联</b>：来自 N 列 Research Line，可能包含导师、研究组或论文合作关联。<br><b>后续关联</b>：来自 O 列 Industry Line，原表混合了后续研究和职业关联。<br><b>机构关联</b>：关系字段中可识别的企业或机构。</p><h3>档案与身份</h3><p>${fmt(data.meta.counts.sourceRows)} 条源记录中，${fmt(data.meta.counts.personRows)} 条包含姓名；合并有身份佐证的重复记录后，展示 ${fmt(data.meta.counts.profilePeople)} 个人物档案。另有 ${fmt(data.meta.counts.referencePeople)} 个人物仅在关系字段出现，以虚线边框标记。无姓名的 ${fmt(data.meta.counts.excludedUnnamedRows)} 条占位记录不创建人物。</p><p>同名记录缺少充分佐证时分别保留。相同名字可能对应多个档案；引用身份不明确时，不强行连接到某一档案。机构名称保留原表写法，别名可能分别计数。</p><h3>如何探索</h3><p>搜索姓名、机构或论文；点击人物重新展开其邻域；切换层级或网络布局；用 ⇄ 查找最短关系路径。路径使用当前勾选的关系类型，覆盖全部图谱，不受机构和地区筛选限制。可点击连线查看原文与单元格。</p><p>图谱按需显示局部节点；“展开更多”可逐步增加显示范围。人物名录始终覆盖全部人物，包括没有连线的档案。可用 ↓ 导出当前关系图。</p><h3>数据边界</h3><p>仅使用提供的工作表；未从参考网站导入数据，未对原表履历进行外部核实。公开版仅展示专业履历、研究成果、关系原文及来源行号；联系状态、招聘评估与内部备注不公开。可在人物档案中展开公开字段和原表行号。数据版本：${esc(data.meta.generatedAt)}。</p>`;
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
  $('#depth').addEventListener('change',e=>{state.depth=+e.target.value;state.path=null;renderGraph();});
  $('#type-filters').addEventListener('change',e=>{if(e.target.checked)state.types.add(e.target.value);else state.types.delete(e.target.value);filterChanged();});
  $('#reset-filters').addEventListener('click',()=>{state.institution='';state.location='';state.query='';state.depth=1;state.types=new Set(types.map(t=>t.id));$('#institution-filter').value='';$('#location-filter').value='';$('#search').value='';$('#depth').value='1';$$('#type-filters input').forEach(i=>i.checked=true);filterChanged();});
  for(const id of ['about-button','method-button'])$('#'+id).addEventListener('click',()=>$('#about-modal').showModal());
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
  $('#search-results').hidden=false;$('#search-results').innerHTML=found.slice(0,12).map(n=>`<button class="search-result" data-person="${n.id}"><b>${esc(n.name)} ${n.nameZh&&n.nameZh!==n.name?`<span>${esc(n.nameZh)}</span>`:''}</b><small>${esc(n.affiliation||kindLabel(n))} · ${fmt(n.degree||0)} 条关联${n.stub?'':` · 第 ${n.rows[0]} 行`}</small></button>`).join('')||'<p class="no-results">没有匹配的人物或机构</p>';
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
  const pos=new Map();if(model.path){model.ids.forEach((id,i)=>pos.set(id,{x:i*220,y:(i%2)*95}));return pos;}
  pos.set(state.focus,{x:0,y:0});
  if(state.layout==='radial'){
    let index=0;for(let depth=1;depth<=state.depth;depth++){const group=model.ids.filter(id=>model.dist.get(id)===depth);const rings=Math.ceil(group.length/12);for(let ring=0;ring<rings;ring++){const part=group.slice(ring*12,(ring+1)*12);const rx=310+ring*240+(depth-1)*410,ry=190+ring*155+(depth-1)*255;part.forEach((id,i)=>{const angle=-Math.PI/2+(i/part.length)*Math.PI*2+(depth%2?.1:.3);pos.set(id,{x:Math.cos(angle)*rx,y:Math.sin(angle)*ry});index++;});}}return pos;
  }
  const referenced=new Set(enabledEdges(state.focus).filter(e=>e.target===state.focus).map(e=>e.source));
  const upper=model.ids.filter(id=>model.dist.get(id)===1&&referenced.has(id));
  upper.forEach((id,i)=>pos.set(id,{x:(i-(upper.length-1)/2)*202,y:-110}));
  const columns=innerWidth<=700?2:4;
  let y=110;for(let depth=1;depth<=state.depth;depth++){const group=model.ids.filter(id=>model.dist.get(id)===depth&&!upper.includes(id));group.forEach((id,i)=>{const row=Math.floor(i/columns),count=Math.min(columns,group.length-row*columns);pos.set(id,{x:((i%columns)-(count-1)/2)*202,y:y+row*90});});y+=Math.ceil(group.length/columns)*90+60;}return pos;
}
function renderGraph(){
  if(!state.focus)return;const model=collectGraph();model.positions=layoutGraph(model);graphModel=model;
  const root=nodes.get(state.focus);$('#graph-context').textContent=model.path?'最短关系路径':`${root.name} 的关联网络`;
  $('#graph-status').textContent=model.path?`${model.ids.length-1} 步连接`:`显示 ${model.ids.length} / ${fmt(model.total)} 个对象`;
  $('#graph-empty').hidden=model.path||model.ids.length>1;$('#graph-empty').innerHTML=!model.path&&model.total===1?`<b>暂无符合条件的关联</b><p>${state.institution||state.location||state.types.size<types.length?'调整左侧筛选，或搜索其他人物。':'此人物已收录档案，原表尚未记录其人物关系。'}</p>`:'';
  $('#show-more').hidden=model.path||model.ids.length>=model.total;$('#show-more').textContent=`展开更多 · 还有 ${fmt(model.total-model.ids.length)} 个对象`;
  let svg='';for(const edge of model.edges){const a=model.positions.get(edge.source),b=model.positions.get(edge.target),type=types.find(t=>t.id===edge.type);let d;if(state.layout==='tree'&&!model.path){const low=a.y<=b.y?a:b,high=a.y<=b.y?b:a;d=`M ${low.x} ${low.y+31} C ${low.x} ${(low.y+high.y)/2}, ${high.x} ${(low.y+high.y)/2}, ${high.x} ${high.y-31}`;}else d=`M ${a.x} ${a.y} L ${b.x} ${b.y}`;svg+=`<g class="edge" data-edge="${edge.id}" role="button" tabindex="0" aria-label="${esc(nodes.get(edge.source).name)} 与 ${esc(nodes.get(edge.target).name)} 的${esc(edge.label)}"><title>${esc(edge.label)} · ${edge.evidence.map(e=>`${e.column}${e.row}`).join('、')} · 点击查看原文</title><path d="${d}" fill="none" stroke="${esc(type?.color||'#aaa')}" stroke-width="1.5" stroke-dasharray="${edge.type==='followup'?'6 4':'none'}"/><path d="${d}" fill="none" stroke="transparent" stroke-width="14"/></g>`;}
  for(const id of model.ids){const n=nodes.get(id),p=model.positions.get(id),active=id===state.focus;svg+=`<g class="node ${active?'active':''} ${n.stub?'stub':''}" data-person="${id}" role="button" tabindex="0" aria-label="查看 ${esc(n.name)} 的人物关系" transform="translate(${p.x},${p.y})"><title>${esc(n.name)}${n.nameZh?' / '+esc(n.nameZh):''}\n${esc(n.affiliation||kindLabel(n))}\n${n.degree||0} 条关联${n.stub?' · 仅在关系字段出现':''}</title><g class="node-card"><rect x="-86" y="-31" width="172" height="62" rx="5" fill="${active?'#163e33':'#ffffff'}" stroke="${active?'#163e33':'#ccd6cd'}" stroke-dasharray="${n.stub?'4 3':'none'}"/><circle cx="-73" cy="-12" r="3" fill="${active?'#b9c8ac':n.entityType==='person'?'#749780':'#b28d55'}"/><text class="node-name" x="-62" y="-8" fill="${active?'#ffffff':'#244c3f'}" font-size="12" font-weight="600">${esc(truncate(n.name,21))}</text><text class="node-subtitle" x="-72" y="12" fill="${active?'#d7e4db':'#77857c'}" font-size="10">${esc(truncate(n.affiliation||(n.nameZh&&n.nameZh!==n.name?n.nameZh:kindLabel(n)),26))}</text></g><g class="node-badge"><circle cx="84" cy="-29" r="10" fill="${active?'#c3d2b5':'#edf2e9'}" stroke="#d8e1d4"/><text x="84" y="-25.5" text-anchor="middle" font-size="9" fill="#264d3e">${n.degree||0}</text></g></g>`;}
  $('#graph-world').innerHTML=svg;requestAnimationFrame(fitGraph);
}
function applyTransform(){const t=state.transform;$('#graph-world').setAttribute('transform',`translate(${t.x} ${t.y}) scale(${t.k})`);$('#zoom-label').textContent=Math.round(t.k*100)+'%';}
function fitGraph(){if(!graphModel||!graphModel.ids.length)return;const ps=[...graphModel.positions.values()];const minX=Math.min(...ps.map(p=>p.x))-110,maxX=Math.max(...ps.map(p=>p.x))+110,minY=Math.min(...ps.map(p=>p.y))-66,maxY=Math.max(...ps.map(p=>p.y))+90;const r=$('#graph-stage').getBoundingClientRect();if(!r.width||!r.height)return;const k=Math.min((r.width-56)/(maxX-minX),(r.height-110)/(maxY-minY),1.2);state.transform={k,x:r.width/2-(minX+maxX)/2*k,y:(r.height-32)/2-(minY+maxY)/2*k};applyTransform();}
function zoom(factor,x,y){const r=$('#graph-stage').getBoundingClientRect();x??=r.width/2;y??=r.height/2;const t=state.transform,newK=Math.max(.12,Math.min(3.5,t.k*factor)),ratio=newK/t.k;t.x=x-(x-t.x)*ratio;t.y=y-(y-t.y)*ratio;t.k=newK;applyTransform();}

function renderDetail(){
  const n=nodes.get(state.focus),edges=adjacency.get(n.id)||[],record=n.records?.[0]?.fields||{};
  const field=(name,value)=>value?`<div class="info-row"><dt>${esc(name)}</dt><dd>${esc(value)}</dd></div>`:'';
  const relationRows=edges.slice().sort((a,b)=>nodes.get(other(a,n.id)).name.localeCompare(nodes.get(other(b,n.id)).name));
  const ambiguous=data.meta.ambiguousReferences?.find(r=>r.referenceId===n.id);
  $('#detail').innerHTML=`<div class="profile-top"><p class="profile-kicker">${esc(kindLabel(n))} <span>↗</span></p><div class="avatar" aria-hidden="true">${esc(n.entityType==='person'?n.name.split(' ').filter(Boolean).map(x=>x[0]).slice(0,2).join(''):'⌘')}</div><h2>${esc(n.name)}</h2>${n.nameZh&&n.nameZh!==n.name?`<p class="chinese-name">${esc(n.nameZh)}</p>`:''}<p class="profile-affiliation">${esc(n.affiliation||'机构未记录')}</p><span class="badge">${esc(n.role||kindLabel(n))}</span></div><div class="profile-metrics"><div><b>${fmt(edges.length)}</b><span>直接关联</span></div><div><b>${fmt(n.rows.length)}</b><span>${n.stub?'引用行':'来源记录'}</span></div></div>${n.stub?'<div class="notice compact">此对象仅在关系字段出现，身份与履历尚未与独立档案确认。</div>':''}${ambiguous?`<section class="detail-section"><h3>同名候选档案</h3><p class="source-note">原表有多个同名档案，未自动判定属于哪一位。</p>${ambiguous.candidateIds.map(id=>{const c=nodes.get(id);return`<button class="relation-item" data-person="${id}"><b>${esc(c.name)}</b><small>${esc(c.affiliation||c.phd||'第 '+c.rows[0]+' 行')}</small></button>`}).join('')}</section>`:''}<section class="detail-section"><h3>研究者信息</h3><dl>${field('所在地区',n.location)}${field('学位记录',n.phd)}${field('本科记录',n.bachelor)}${field('研究方向',n.research)}${!n.location&&!n.phd&&!n.bachelor&&!n.research?'<p class="source-note">原表未记录更多履历。</p>':''}</dl><div class="external-links">${link(n.website,'个人主页')}${link(n.scholar,'Scholar')}${link(n.linkedin,'LinkedIn')}${n.orcid?link('https://orcid.org/'+n.orcid.replace(/^.*orcid.org\//,''),'ORCID'):''}</div></section><section class="detail-section"><h3>关联人物与对象 <small>${edges.length}</small></h3><div class="relation-list">${relationRows.length?relationRows.map(e=>{const p=nodes.get(other(e,n.id)),t=types.find(x=>x.id===e.type);return`<div class="relation-row"><button class="relation-item" data-person="${p.id}"><span class="color-dot" style="background:${esc(t?.color||'#789')}"></span><span><b>${esc(p.name)}</b><small>${esc(p.affiliation||e.label)}</small></span><span aria-hidden="true">↗</span></button><button class="source-link" data-edge="${e.id}" title="查看关系原文">${esc(e.label)} · ${e.evidence.map(v=>`${v.column}${v.row}`).join(', ')}</button></div>`}).join(''):'<p class="source-note">原表尚无可展示的关联记录。</p>'}</div></section><section class="detail-section"><h3>原表记录</h3><p class="source-note">Mapping · ${n.rows.slice(0,15).map(r=>'第 '+r+' 行').join('、')}${n.rows.length>15?' 等':''}</p><div class="source-record">${n.records.map(rec=>`<details><summary>${n.stub?'引用来源':'人物记录'} · 第 ${rec.row} 行</summary>${data.meta.columns.filter(c=>clean(rec.fields[c.key])).map(c=>`<div class="source-field"><dt>${esc(c.key)} · ${esc(c.label)}</dt><dd>${esc(rec.fields[c.key])}</dd></div>`).join('')}</details>`).join('')}</div></section>`;
}
function showEdge(id){const e=data.edges.find(e=>e.id===id);if(!e)return;$('#edge-content').innerHTML=`<p class="edge-pair"><b>${esc(nodes.get(e.source).name)}</b> <span>—</span> <b>${esc(nodes.get(e.target).name)}</b></p><span class="badge">${esc(e.label)}</span><div class="notice">本连线仅表示原表关联，不自动推定指导关系或时间方向。</div>${e.evidence.map(v=>`<section class="detail-section"><h3>Mapping!${v.column}${v.row} · ${esc(v.field)}</h3><p class="evidence-value">${esc(v.value)}</p><p class="source-note">该行人物：${esc(data.nodes.find(n=>!n.stub&&n.rows.includes(v.row))?.name||nodes.get(e.target).name)}</p></section>`).join('')}`;$('#edge-modal').showModal();}

function filteredPeople(){return people.filter(n=>matches(n)).sort((a,b)=>(b.degree||0)-(a.degree||0)||a.name.localeCompare(b.name));}
function renderDirectory(){const arr=filteredPeople(),pageSize=40,totalPages=Math.max(1,Math.ceil(arr.length/pageSize));state.page=Math.min(state.page,totalPages-1);$('#graph-context').textContent=`${fmt(arr.length)} 个人物档案及引用`;
  $('#directory').innerHTML=`<div class="directory-header"><h2>人物名录</h2><p>全部档案均可检索，包括尚无关联的研究者。</p></div><div class="table-scroll"><table class="directory-table"><thead><tr><th>研究者</th><th>机构 / 地区</th><th>身份</th><th>关联</th></tr></thead><tbody>${arr.slice(state.page*pageSize,(state.page+1)*pageSize).map(n=>`<tr><td><button class="name-button" data-person="${n.id}">${esc(n.name)}</button><small>${esc(n.nameZh&&n.nameZh!==n.name?n.nameZh:(!n.stub?'Mapping · 第 '+n.rows[0]+' 行':''))}</small></td><td>${esc(n.affiliation||'未记录')}<small>${esc(n.location)}</small></td><td><span class="badge ${n.stub?'muted':''}">${esc(n.role||kindLabel(n))}</span></td><td>${n.degree||0}</td></tr>`).join('')||'<tr><td colspan="4" class="no-results">没有匹配的人物，请调整筛选。</td></tr>'}</tbody></table></div><div class="pagination"><span>第 ${state.page+1} / ${totalPages} 页 · ${fmt(arr.length)} 个对象</span><button id="prev-page" class="secondary-button" ${state.page===0?'disabled':''}>上一页</button><button id="next-page" class="secondary-button" ${state.page+1>=totalPages?'disabled':''}>下一页</button></div>`;
  $('#prev-page').onclick=()=>{state.page--;renderDirectory();};$('#next-page').onclick=()=>{state.page++;renderDirectory();};
}
function renderInstitutions(){const arr=[...institutions].map(([name,ps])=>[name,ps.filter(n=>(!state.location||n.location===state.location)&&(!state.institution||n.affiliation===state.institution)&&(!state.query||searchText(n).includes(norm(state.query))))]).filter(([,ps])=>ps.length).sort((a,b)=>b[1].length-a[1].length);$('#graph-context').textContent=`${fmt(arr.length)} 个机构名称`;
  $('#institutions').innerHTML=`<div class="directory-header"><h2>研究机构</h2><p>按 CurrentAffiliation 原文归类；同一机构的不同写法分别保留。</p></div><div class="institution-grid">${arr.slice(state.page*30,(state.page+1)*30).map(([name,ps])=>`<button class="institution-card" data-institution="${esc(name)}"><span class="institution-icon">⌘</span><h3>${esc(name)}</h3><p>${fmt(ps.length)} 个档案 <span>↗</span></p></button>`).join('')||'<p class="no-results">没有符合筛选条件的机构。</p>'}</div><div class="pagination"><span>第 ${state.page+1} / ${Math.max(1,Math.ceil(arr.length/30))} 页</span><button class="secondary-button" id="inst-prev" ${state.page===0?'disabled':''}>上一页</button><button class="secondary-button" id="inst-next" ${(state.page+1)*30>=arr.length?'disabled':''}>下一页</button></div>`;
  $$('[data-institution]').forEach(b=>b.onclick=()=>{state.institution=b.dataset.institution;$('#institution-filter').value=state.institution;state.view='directory';state.query='';$('#search').value='';state.page=0;updateView();});$('#inst-prev').onclick=()=>{state.page--;renderInstitutions();};$('#inst-next').onclick=()=>{state.page++;renderInstitutions();};
}

function pathLabel(n){return `${n.name}${n.nameZh&&n.nameZh!==n.name?' / '+n.nameZh:''} · ${n.affiliation||kindLabel(n)} [${n.id}]`;}
function resolvePerson(raw){if(!norm(raw))return{error:'请填写起点和终点人物。'};const id=raw.match(/\[([^\]]+)\]$/)?.[1];if(id&&nodes.has(id))return{id};const matches=people.filter(n=>norm(n.name)===norm(raw)||norm(n.nameZh)===norm(raw));return matches.length===1?{id:matches[0].id}:matches.length>1?{error:'该姓名对应多个档案，请从建议列表选择含机构和编号的完整条目。'}:{error:'未找到该人物，请输入姓名并从建议列表选择。'};}
function findPath(){
  const start=resolvePerson($('#path-start').value),end=resolvePerson($('#path-end').value);if(start.error||end.error){$('#path-result').innerHTML=`<div class="notice">${esc(start.error||end.error)}</div>`;return;}
  if(!state.types.size){$('#path-result').innerHTML='<div class="notice">请先在左侧勾选至少一种关系类型。</div>';return;}
  const parents=new Map([[start.id,null]]),queue=[start.id];for(let i=0;i<queue.length&&!parents.has(end.id);i++){for(const edge of enabledEdges(queue[i])){const next=other(edge,queue[i]);if(!parents.has(next)){parents.set(next,{id:queue[i],edge});queue.push(next);}}}
  if(!parents.has(end.id)){$('#path-result').innerHTML='<div class="notice">当前记录与关系类型下没有连通路径。没有连线不代表现实中不存在关系。</div>';return;}
  const ids=[],edges=[];let current=end.id;while(current){ids.unshift(current);const prev=parents.get(current);if(prev)edges.unshift(prev.edge);current=prev?.id;}
  $('#path-result').innerHTML=`<p class="path-summary">找到最短路径 · ${edges.length} 步连接</p><div class="path-steps">${ids.map((id,i)=>`${i?`<div class="path-connector">↓ ${esc(edges[i-1].label)} <button class="source-link" data-edge="${edges[i-1].id}">查看原文</button></div>`:''}<div class="path-step"><b>${esc(nodes.get(id).name)}</b><small>${esc(nodes.get(id).affiliation||kindLabel(nodes.get(id)))}</small></div>`).join('')}</div><button class="primary-button" id="show-path">在图谱中查看</button>`;
  $('#show-path').onclick=()=>{state.focus=start.id;history.replaceState(null,'','#person='+encodeURIComponent(start.id));state.path={nodes:ids,edges};state.view='graph';$('#path-modal').close();updateView();renderDetail();renderGraph();};
}
function exportGraph(){if(!graphModel)return;const ps=[...graphModel.positions.values()],minX=Math.min(...ps.map(p=>p.x))-110,maxX=Math.max(...ps.map(p=>p.x))+110,minY=Math.min(...ps.map(p=>p.y))-70,maxY=Math.max(...ps.map(p=>p.y))+100;const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="${maxX-minX}" height="${maxY-minY+65}" viewBox="${minX} ${minY-65} ${maxX-minX} ${maxY-minY+65}"><rect x="${minX}" y="${minY-65}" width="100%" height="100%" fill="#f7f8f4"/><text x="${minX+20}" y="${minY-30}" fill="#163e33" font-family="sans-serif" font-size="16">MatriQ · ${esc(nodes.get(state.focus).name)} · 关系网络</text><text x="${minX+20}" y="${maxY-12}" fill="#6d7d72" font-family="sans-serif" font-size="11">来源：Mapping · 科研与后续关联，不代表已确认师承</text><g font-family="Arial, sans-serif">${$('#graph-world').innerHTML}</g></svg>`;const a=document.createElement('a'),url=URL.createObjectURL(new Blob([svg],{type:'image/svg+xml;charset=utf-8'}));a.href=url;a.download='MatriQ-'+nodes.get(state.focus).name.replace(/[^\w\u4e00-\u9fff-]/g,'_')+'.svg';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);notify('当前图谱已导出为 SVG');}
init();
