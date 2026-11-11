import {ROLE_STYLES,MENTORSHIP_COLORS,isVerifiedMentorship} from './mentorship.mjs?v=edge-colors-20261111';

export const NODE_WIDTH=196;
export const NODE_HEIGHT=70;
export const GRAPH_BACKGROUND='#496275';
const EDGE_OUTLINE='#213848';

const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const short=(value,max)=>{const chars=[...String(value||'')];return chars.length>max?chars.slice(0,max-1).join('')+'…':chars.join('');};
const entityLabel=node=>({person:node.stub?'关系引用':'人物档案',institution:'机构',group:'课题组',publication:'论文'}[node.entityType]||'关联对象');

function anchor(from,to){
  const dx=to.x-from.x,dy=to.y-from.y;
  if(dx===0&&dy===0)return {...from};
  const ratio=Math.min(dx===0?Infinity:(NODE_WIDTH/2)/Math.abs(dx),dy===0?Infinity:(NODE_HEIGHT/2)/Math.abs(dy));
  return{x:from.x+dx*ratio,y:from.y+dy*ratio};
}

export function renderGraphSVG({model,focus,nodes,layout}){
  let svg=`<defs>${Object.entries(MENTORSHIP_COLORS).map(([type,color])=>`<marker id="arrow-${type}" viewBox="-1 -1 10 10" refX="7" refY="4" markerWidth="9" markerHeight="9" orient="auto" markerUnits="userSpaceOnUse"><path d="M0 0 L8 4 L0 8 Z" fill="${color}" stroke="${EDGE_OUTLINE}" stroke-width=".6" paint-order="stroke"/></marker>`).join('')}</defs>`;
  const pairs=new Map();
  for(const edge of model.edges){const key=[edge.source,edge.target].sort().join('|');if(!pairs.has(key))pairs.set(key,[]);pairs.get(key).push(edge.id);}
  const orderedEdges=[...model.edges].sort((a,b)=>Number(isVerifiedMentorship(a))-Number(isVerifiedMentorship(b)));
  for(const edge of orderedEdges){
    const a=model.positions.get(edge.source),b=model.positions.get(edge.target);
    const start=anchor(a,b),end=anchor(b,a),pair=pairs.get([edge.source,edge.target].sort().join('|'));
    const offset=(pair.indexOf(edge.id)-(pair.length-1)/2)*32;
    const confirmed=isVerifiedMentorship(edge);
    const color=confirmed?MENTORSHIP_COLORS[edge.type]:'#b2c2cf';
    const displayType=confirmed?edge.type:['research','followup','institution'].includes(edge.type)?edge.type:'unverified';
    let d;
    if((layout==='tree'&&!model.path)||pair.length>1){
      const midY=(start.y+end.y)/2;
      d=`M ${start.x} ${start.y} C ${start.x+offset} ${midY}, ${end.x+offset} ${midY}, ${end.x} ${end.y}`;
    }else d=`M ${start.x} ${start.y} L ${end.x} ${end.y}`;
    const dash=confirmed?(edge.type==='postdoc'?'7 4':'none'):edge.type==='followup'?'4 5':'none';
    const description=`${nodes.get(edge.source).name} ${confirmed?'→':'与'} ${nodes.get(edge.target).name} · ${edge.relationshipLabel||edge.label}`;
    const marker=confirmed?` marker-end="url(#arrow-${edge.type})"`:'';
    svg+=`<g class="edge edge-${displayType}" data-edge="${edge.id}" data-relationship-type="${confirmed?edge.type:'unverified'}" role="button" tabindex="0" aria-label="${esc(description)}"><title>${esc(description)} · ${(edge.evidence||[]).map(v=>`${v.column}${v.row}`).join('、')} · 点击查看${confirmed?'公开指导证据与':''}原文</title>${confirmed?`<path class="edge-underlay" d="${d}" fill="none" stroke="${EDGE_OUTLINE}" stroke-width="5.2" stroke-dasharray="${dash}" pointer-events="none"/>`:''}<path class="edge-line" d="${d}" fill="none" stroke="${color}" stroke-width="${confirmed?2.7:1.3}" stroke-dasharray="${dash}"${marker}/><path class="edge-hit" d="${d}" fill="none" stroke="transparent" stroke-width="14"/>${confirmed?`<text class="edge-label edge-type-label" x="${(start.x+end.x)/2+offset+(offset<0?-10:12)}" y="${(start.y+end.y)/2-5}" text-anchor="${offset<0?'end':'start'}" fill="${color}" font-family="Times New Roman, Times, serif" font-size="12" font-weight="600" stroke="${EDGE_OUTLINE}" stroke-width="4" paint-order="stroke">${edge.type==='phd'?'PhD':'Postdoc'}</text>`:''}</g>`;
  }
  for(const id of model.ids){
    const selected=id===focus;
    const node=nodes.get(id),p=model.positions.get(id),role=selected?'focus':'other',style=ROLE_STYLES[role];
    const fill=selected?'#eef5fb':style.fill;
    const affiliation=node.displayAffiliation||node.affiliation||(node.nameZh&&node.nameZh!==node.name?node.nameZh:entityLabel(node));
    const career=node.displayRole||node.statusLabel||node.role||'';
    const graduation=['phd_student','phd_candidate'].includes(node.academicStatus)?node.expectedGraduationLabel||'':'';
    const compactGraduation=graduation?(node.expectedGraduation?`Expected ${node.expectedGraduation}`:/^not provided$/i.test(graduation)?'Graduation not provided':graduation.replace(/^expected\s+graduation\s*[:：]?\s*/i,'Expected ')):'';
    const roleLine=[career,compactGraduation].filter(Boolean).join(' · ');
    const personLabel=selected?'当前人物':entityLabel(node);
    const tooltip=[`${node.name}${node.nameZh?' / '+node.nameZh:''}`,affiliation,node.affiliationType?`Affiliation type: ${node.affiliationType}`:'',career,node.jobTitle?`Job title: ${node.jobTitle}`:'',graduation,personLabel,`${node.degree||0} 条关联${node.stub?' · 仅在关系字段出现':''}`].filter(Boolean).join('\n');
    svg+=`<g class="node ${selected?'active':''} ${node.stub?'stub':''} role-${role}" style="--node-border:${style.color};--node-fill:${fill}" data-person="${id}" data-relationship-role="${role}" role="button" tabindex="0" aria-label="查看 ${esc(node.name)} 的人物关系 · ${esc(personLabel)}" transform="translate(${p.x},${p.y})"><title>${esc(tooltip)}</title><g class="node-card"><rect class="node-frame" x="-98" y="-35" width="196" height="70" rx="5" fill="${fill}" stroke="${style.color}" stroke-width="${role==='other'?1.5:2.8}" stroke-dasharray="${node.stub?'4 3':'none'}"/><circle cx="-85" cy="-18" r="3" fill="${style.color}"/><text class="node-name" x="-74" y="-15" fill="#1b3348" font-family="Times New Roman, Times, serif" font-size="12" font-weight="600">${esc(short(node.name,25))}</text><text class="node-subtitle" x="-85" y="2" fill="#688094" font-family="Times New Roman, Times, serif" font-size="10">${esc(short(affiliation,32))}</text><text class="node-career" x="-85" y="20" fill="#526f87" font-family="Times New Roman, Times, serif" font-size="10">${esc(short(roleLine,36))}</text></g><g class="node-badge"><circle cx="96" cy="-33" r="10" fill="#e5ecf2" stroke="#b9cddb"/><text x="96" y="-29.5" text-anchor="middle" font-family="Times New Roman, Times, serif" font-size="9" fill="#1b3348">${node.degree||0}</text></g></g>`;
  }
  return svg;
}
