// Only explicitly verified, directed PhD/Postdoc links carry mentorship meaning.
export const MENTORSHIP_COLORS=Object.freeze({phd:'#ff8a80',postdoc:'#ffb74d'});

// Person frames are neutral. Supervision type is encoded on its verified edge.
export const ROLE_STYLES = Object.freeze({
  focus: {color:'#111111',fill:'#eef5fb',label:'当前人物'},
  mentor: {color:'#8ba2b7',fill:'#ffffff',label:'人物档案'},
  student: {color:'#8ba2b7',fill:'#ffffff',label:'人物档案'},
  'phd-supervisor': {color:'#8ba2b7',fill:'#ffffff',label:'人物档案'},
  'postdoc-supervisor': {color:'#8ba2b7',fill:'#ffffff',label:'人物档案'},
  'dual-supervisor': {color:'#8ba2b7',fill:'#ffffff',label:'人物档案'},
  other: {color:'#8ba2b7',fill:'#ffffff',label:'人物档案'},
  conflict: {color:'#8ba2b7',fill:'#ffffff',label:'人物档案'}
});

export function isVerifiedMentorship(edge){
  return Boolean(edge&&edge.directed===true&&edge.source&&edge.target&&edge.source!==edge.target&&
    edge.verification?.status==='confirmed'&&['phd','postdoc'].includes(edge.type)&&
    Array.isArray(edge.verification.sources)&&edge.verification.sources.some(source=>/^https:\/\/[^\s/]+/i.test(source?.url||'')));
}

// Legacy role queries remain available for nonvisual data analysis only.
// renderGraphSVG deliberately ignores these maps when drawing person frames.
export function classifySupervisors(edges){
  const stages=new Map();
  for(const edge of edges){
    if(!isVerifiedMentorship(edge)||!edge.source||edge.source===edge.target)continue;
    if(!stages.has(edge.source))stages.set(edge.source,new Set());
    stages.get(edge.source).add(edge.type);
  }
  return new Map([...stages].map(([id,types])=>[id,types.size>1?'dual-supervisor':types.has('phd')?'phd-supervisor':'postdoc-supervisor']));
}

export function applyVerifiedMentorships(data,records){
  const nodes=new Map(data.nodes.map(n=>[n.id,n]));
  const edges=new Map(data.edges.map(e=>[e.id,e]));
  let applied=0;
  for(const record of records){
    const edge=edges.get(record.edgeId);
    if(!edge || !['phd','postdoc'].includes(record.stage) || record.verification?.status!=='confirmed' ||
      !record.verification.sources?.some(s=>/^https:\/\//.test(s.url||'')) ||
      edge.source!==record.mentorId || edge.target!==record.studentId ||
      nodes.get(record.mentorId)?.entityType!=='person' || nodes.get(record.studentId)?.entityType!=='person')continue;
    edge.originalType=edge.type;edge.originalLabel=edge.label;
    edge.type=record.stage;edge.label=record.stage==='phd'?'PhD 指导':'Postdoc 指导';
    edge.relationshipLabel=record.label||edge.label;
    edge.directed=true;edge.verification=record.verification;applied++;
  }
  return applied;
}

export function classifyMentorship(focus,edges){
  const incoming=new Map(),outgoing=new Map();
  for(const edge of edges.filter(isVerifiedMentorship)){
    if(!incoming.has(edge.target))incoming.set(edge.target,[]);
    if(!outgoing.has(edge.source))outgoing.set(edge.source,[]);
    incoming.get(edge.target).push(edge.source);outgoing.get(edge.source).push(edge.target);
  }
  const walk=map=>{const seen=new Set([focus]),queue=[focus];for(let i=0;i<queue.length;i++)for(const id of map.get(queue[i])||[])if(!seen.has(id)){seen.add(id);queue.push(id);}seen.delete(focus);return seen;};
  const up=walk(incoming),down=walk(outgoing),roles=new Map([[focus,'focus']]);
  for(const id of new Set([...up,...down]))roles.set(id,up.has(id)&&down.has(id)?'conflict':up.has(id)?'mentor':'student');
  return roles;
}
