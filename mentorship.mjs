// Only explicitly verified, directed PhD/Postdoc links carry mentorship meaning.
export const ROLE_STYLES = Object.freeze({
  focus: {color:'#111111',fill:'#eef5fb',label:'当前人物'},
  mentor: {color:'#c4473d',fill:'#ffffff',label:'上游指导者 · 已确认'},
  student: {color:'#c87816',fill:'#ffffff',label:'下游受指导者 · 已确认'},
  'phd-supervisor': {color:'#c4473d',fill:'#ffffff',label:'PhD supervisor · confirmed'},
  'postdoc-supervisor': {color:'#c87816',fill:'#ffffff',label:'Postdoc supervisor · confirmed'},
  'dual-supervisor': {color:'#c4473d',secondaryColor:'#c87816',fill:'#ffffff',label:'PhD + Postdoc supervisor · confirmed'},
  other: {color:'#8ba2b7',fill:'#ffffff',label:'普通关联 / 指导关系未确认'},
  conflict: {color:'#8ba2b7',fill:'#ffffff',label:'指导链存在方向冲突 · 待核'}
});

export function isVerifiedMentorship(edge){
  return edge.directed===true && edge.verification?.status==='confirmed' && ['phd','postdoc'].includes(edge.type);
}

// Border color identifies the verified supervision stage, not graph generation.
// Students never inherit an orange border just because they are downstream.
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
