// User-defined Mapping columns: N = PhD supervisor, O = Postdoc supervisor.
export const MENTORSHIP_COLORS=Object.freeze({phd:'#ff8a80',postdoc:'#ffb74d'});
const COLUMN_STAGES=Object.freeze({N:'phd',O:'postdoc'});
const STAGE_COLUMNS=Object.freeze({phd:'N',postdoc:'O'});
const clone=value=>JSON.parse(JSON.stringify(value));
const validEndpoints=edge=>Boolean(edge&&edge.directed===true&&edge.source&&edge.target&&edge.source!==edge.target&&STAGE_COLUMNS[edge.type]);
const hasCertificate=verification=>Boolean(verification?.status==='confirmed'&&Array.isArray(verification.sources)&&verification.sources.some(source=>/^https:\/\/[^\s/]+/i.test(source?.url||'')));

function evidenceColumn(evidence){
  const column=String(evidence?.column||'').trim().toUpperCase();
  if(COLUMN_STAGES[column])return column;
  const field=String(evidence?.field||'').trim().toLowerCase();
  return field==='research line'?'N':field==='industry line'?'O':null;
}

function mappingColumns(edge,legacy=false){
  const columns=new Set((edge.evidence||[]).map(evidenceColumn).filter(Boolean));
  if(!columns.size&&edge.definition?.basis==='mapping_column'&&COLUMN_STAGES[edge.definition.column])columns.add(edge.definition.column);
  if(!columns.size&&legacy){
    const type=['research','followup'].includes(edge.originalType)?edge.originalType:edge.type;
    if(type==='research')columns.add('N');
    if(type==='followup')columns.add('O');
  }
  return ['N','O'].filter(column=>columns.has(column));
}

// Person frames are neutral. Supervision type is encoded on the relationship.
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
  if(!validEndpoints(edge)||!hasCertificate(edge.verification))return false;
  const columns=mappingColumns(edge),certificateStage=edge.verificationStage||edge.verification.stage||edge.type;
  return certificateStage===edge.type&&(!columns.length||(columns.length===1&&COLUMN_STAGES[columns[0]]===edge.type));
}

export function isMentorship(edge){
  if(!validEndpoints(edge))return false;
  const columns=mappingColumns(edge);
  return columns.length?columns.length===1&&COLUMN_STAGES[columns[0]]===edge.type:isVerifiedMentorship(edge);
}

// Pure projection shared by the source migration and document importer. Evidence
// takes priority over a prior external stage or an older association type.
export function normalizeMappingEdges(edges){
  const input=(edges||[]).map(clone),reserved=new Set(input.map(edge=>edge.id)),result=[];
  for(const edge of input){
    const columns=mappingColumns(edge,true);
    if(!columns.length){result.push(edge);continue;}
    for(let index=0;index<columns.length;index++){
      const column=columns[index],stage=COLUMN_STAGES[column],normalized=clone(edge);
      if(index){
        const base=`${edge.id}__${column}`;let id=base,suffix=2;
        while(reserved.has(id))id=`${base}_${suffix++}`;
        normalized.id=id;reserved.add(id);
      }
      if(columns.length>1)normalized.columnSourceEdgeId=edge.columnSourceEdgeId||edge.id;
      normalized.originalType=edge.originalType||(STAGE_COLUMNS[edge.type]?(edge.type==='phd'?'research':'followup'):edge.type);
      normalized.originalLabel=edge.originalLabel||edge.label||(stage==='phd'?'PhD 指导':'Postdoc 指导');
      normalized.type=stage;normalized.label=stage==='phd'?'PhD 指导':'Postdoc 指导';normalized.directed=true;
      normalized.definition={basis:'mapping_column',column};
      normalized.evidence=(edge.evidence||[]).filter(item=>!evidenceColumn(item)||evidenceColumn(item)===column);
      if(columns.length>1)normalized.rows=[...new Set(normalized.evidence.map(item=>item.row).filter(Number.isInteger))];
      const certificateStage=edge.verificationStage||edge.verification?.stage||edge.type;
      if(hasCertificate(edge.verification)&&certificateStage===stage){
        normalized.verificationStage=stage;
      }else{
        delete normalized.verification;delete normalized.verificationStage;
        delete normalized.relationshipLabel;
      }
      result.push(normalized);
    }
  }
  return result;
}

export function applyColumnMentorships(data,records=[]){
  data.edges=normalizeMappingEdges(data.edges);
  const nodes=new Map((data.nodes||[]).map(node=>[node.id,node]));
  for(const record of records||[]){
    if(!STAGE_COLUMNS[record.stage]||!hasCertificate(record.verification))continue;
    for(const edge of data.edges){
      if((edge.id!==record.edgeId&&edge.columnSourceEdgeId!==record.edgeId)||edge.type!==record.stage||
        edge.source!==record.mentorId||edge.target!==record.studentId||!isMentorship(edge)||
        nodes.get(edge.source)?.entityType!=='person'||nodes.get(edge.target)?.entityType!=='person')continue;
      edge.verification=clone(record.verification);edge.verificationStage=record.stage;
      edge.relationshipLabel=record.label||edge.label;
    }
  }
  return data.edges.filter(isMentorship).length;
}

// Legacy role queries remain available for nonvisual data analysis only.
// renderGraphSVG deliberately ignores these maps when drawing person frames.
export function classifySupervisors(edges){
  const stages=new Map();
  for(const edge of edges){
    if(!isMentorship(edge)||!edge.source||edge.source===edge.target)continue;
    if(!stages.has(edge.source))stages.set(edge.source,new Set());
    stages.get(edge.source).add(edge.type);
  }
  return new Map([...stages].map(([id,types])=>[id,types.size>1?'dual-supervisor':types.has('phd')?'phd-supervisor':'postdoc-supervisor']));
}

export function applyVerifiedMentorships(data,records=[]){
  applyColumnMentorships(data,records);
  return data.edges.filter(isVerifiedMentorship).length;
}

export function classifyMentorship(focus,edges){
  const incoming=new Map(),outgoing=new Map();
  for(const edge of edges.filter(isMentorship)){
    if(!incoming.has(edge.target))incoming.set(edge.target,[]);
    if(!outgoing.has(edge.source))outgoing.set(edge.source,[]);
    incoming.get(edge.target).push(edge.source);outgoing.get(edge.source).push(edge.target);
  }
  const walk=map=>{const seen=new Set([focus]),queue=[focus];for(let i=0;i<queue.length;i++)for(const id of map.get(queue[i])||[])if(!seen.has(id)){seen.add(id);queue.push(id);}seen.delete(focus);return seen;};
  const up=walk(incoming),down=walk(outgoing),roles=new Map([[focus,'focus']]);
  for(const id of new Set([...up,...down]))roles.set(id,up.has(id)&&down.has(id)?'conflict':up.has(id)?'mentor':'student');
  return roles;
}
