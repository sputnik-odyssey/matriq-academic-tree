import {ROLE_STYLES,isVerifiedMentorship} from './mentorship.mjs?v=20261111';

const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const short=(value,max)=>{const chars=[...String(value||'')];return chars.length>max?chars.slice(0,max-1).join('')+'…':chars.join('');};
const entityLabel=node=>({person:node.stub?'关系引用':'人物档案',institution:'机构',group:'课题组',publication:'论文'}[node.entityType]||'关联对象');

function anchor(from,to){
  const dx=to.x-from.x,dy=to.y-from.y;
  if(dx===0&&dy===0)return {...from};
  const ratio=Math.min(dx===0?Infinity:86/Math.abs(dx),dy===0?Infinity:31/Math.abs(dy));
  return{x:from.x+dx*ratio,y:from.y+dy*ratio};
}

export function renderGraphSVG({model,focus,nodes,types,roles,layout}){
  let svg=`<defs><marker id="arrow-phd" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="8" markerHeight="8" orient="auto" markerUnits="userSpaceOnUse"><path d="M0 0 L8 4 L0 8 Z" fill="#7eb2de"/></marker><marker id="arrow-postdoc" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="8" markerHeight="8" orient="auto" markerUnits="userSpaceOnUse"><path d="M0 0 L8 4 L0 8 Z" fill="#fab041"/></marker></defs>`;
  const pairs=new Map();
  for(const edge of model.edges){const key=[edge.source,edge.target].sort().join('|');if(!pairs.has(key))pairs.set(key,[]);pairs.get(key).push(edge.id);}
  const orderedEdges=[...model.edges].sort((a,b)=>Number(isVerifiedMentorship(a))-Number(isVerifiedMentorship(b)));
  for(const edge of orderedEdges){
    const a=model.positions.get(edge.source),b=model.positions.get(edge.target);
    const start=anchor(a,b),end=anchor(b,a),pair=pairs.get([edge.source,edge.target].sort().join('|'));
    const offset=(pair.indexOf(edge.id)-(pair.length-1)/2)*32;
    const type=types.find(t=>t.id===edge.type),confirmed=isVerifiedMentorship(edge);
    const color=confirmed&&edge.type==='phd'?'#7eb2de':type?.color||'#8ba2b7';
    let d;
    if((layout==='tree'&&!model.path)||pair.length>1){
      const midY=(start.y+end.y)/2;
      d=`M ${start.x} ${start.y} C ${start.x+offset} ${midY}, ${end.x+offset} ${midY}, ${end.x} ${end.y}`;
    }else d=`M ${start.x} ${start.y} L ${end.x} ${end.y}`;
    const dash=edge.type==='postdoc'?'7 4':edge.type==='followup'?'4 5':'none';
    const description=`${nodes.get(edge.source).name} ${confirmed?'→':'与'} ${nodes.get(edge.target).name} · ${edge.relationshipLabel||edge.label}`;
    const marker=confirmed?` marker-end="url(#arrow-${edge.type})"`:'';
    svg+=`<g class="edge edge-${edge.type}" data-edge="${edge.id}" role="button" tabindex="0" aria-label="${esc(description)}"><title>${esc(description)} · ${edge.evidence.map(v=>`${v.column}${v.row}`).join('、')} · 点击查看${confirmed?'公开指导证据与':''}原文</title><path d="${d}" fill="none" stroke="${color}" stroke-width="${confirmed?2.4:1.3}" stroke-dasharray="${dash}"${marker}/><path d="${d}" fill="none" stroke="transparent" stroke-width="14"/>${confirmed?`<text class="edge-label edge-type-label" x="${(start.x+end.x)/2+offset+(offset<0?-10:12)}" y="${(start.y+end.y)/2-5}" text-anchor="${offset<0?'end':'start'}" fill="${color}" font-family="Times New Roman, Times, serif" font-size="12" font-weight="600" stroke="#112333" stroke-width="4" paint-order="stroke">${edge.type==='phd'?'PhD':'Postdoc'}</text>`:''}</g>`;
  }
  for(const id of model.ids){
    const node=nodes.get(id),p=model.positions.get(id),role=id===focus?'focus':roles.get(id)||'other',style=ROLE_STYLES[role];
    const selected=id===focus;
    const subtitle=node.affiliation||(node.nameZh&&node.nameZh!==node.name?node.nameZh:entityLabel(node));
    const tooltip=`${node.name}${node.nameZh?' / '+node.nameZh:''}\n${node.affiliation||entityLabel(node)}\n${style.label}\n${node.degree||0} 条关联${node.stub?' · 仅在关系字段出现':''}`;
    svg+=`<g class="node ${selected?'active':''} ${node.stub?'stub':''} role-${role}" style="--node-border:${style.color};--node-fill:${style.fill}" data-person="${id}" data-relationship-role="${role}" role="button" tabindex="0" aria-label="查看 ${esc(node.name)} 的人物关系 · ${esc(style.label)}" transform="translate(${p.x},${p.y})"><title>${esc(tooltip)}</title><g class="node-card"><rect x="-86" y="-31" width="172" height="62" rx="5" fill="${style.fill}" stroke="${style.color}" stroke-width="${role==='other'?1.5:2.8}" stroke-dasharray="${node.stub?'4 3':'none'}"/><circle cx="-73" cy="-12" r="3" fill="${style.color}"/><text class="node-name" x="-62" y="-8" fill="#1b3348" font-family="Times New Roman, Times, serif" font-size="12" font-weight="600">${esc(short(node.name,21))}</text><text class="node-subtitle" x="-72" y="12" fill="#688094" font-family="Times New Roman, Times, serif" font-size="10">${esc(short(subtitle,26))}</text></g><g class="node-badge"><circle cx="84" cy="-29" r="10" fill="#e5ecf2" stroke="#b9cddb"/><text x="84" y="-25.5" text-anchor="middle" font-family="Times New Roman, Times, serif" font-size="9" fill="#1b3348">${node.degree||0}</text></g>${role==='conflict'?`<text class="node-role-label" x="0" y="46" text-anchor="middle" fill="#b8d3e7" font-family="Times New Roman, Times, serif" font-size="10">关系方向待核</text>`:''}</g>`;
  }
  return svg;
}
