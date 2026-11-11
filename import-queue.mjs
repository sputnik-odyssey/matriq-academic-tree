import {previewImport} from './importer.mjs?v=profiles-upload-20261111';

export function queueUpload(parsed,staged=[]){
  const current={sourceFile:parsed.sourceFile,sheet:parsed.sheet,rows:structuredClone(parsed.rows),warnings:[],...(parsed.sourceIdentity?{sourceIdentity:parsed.sourceIdentity}:{})};
  const queue=structuredClone(staged);
  if(!queue.some(item=>JSON.stringify(item)===JSON.stringify(current)))queue.push(current);
  return queue;
}

export async function mergePendingDocuments(base,documents){
  let graph=base;const changed=new Set(),subjects=new Set(),warnings=[],issues=[];
  let ambiguous=0,excluded=0,processedRows=0;
  for(const document of documents){
    const result=await previewImport(graph,document,{mode:'merge'});graph=result.graph;
    for(const id of result.summary.changedIds||[])changed.add(id);
    for(const id of result.summary.subjectIds||[])subjects.add(id);
    warnings.push(...(result.warnings||[]).map(message=>`${document.sourceFile}: ${message}`));issues.push(...(result.issues||[]));
    ambiguous+=result.summary.ambiguous||0;excluded+=result.summary.excluded||0;processedRows+=result.summary.processedRows||0;
  }
  const profiles=graph.nodes.filter(n=>n.entityType==='person'&&!n.stub),original=new Set(base.nodes.filter(n=>n.entityType==='person'&&!n.stub).map(n=>n.id));
  const added=profiles.filter(n=>!original.has(n.id)).length,updated=profiles.filter(n=>original.has(n.id)&&changed.has(n.id)).length;
  return{graph,warnings,issues,summary:{added,updated,unchanged:Math.max(0,profiles.length-added-updated),newRelationships:Math.max(0,graph.edges.length-base.edges.length),retained:Math.max(0,original.size-updated),ambiguous,excluded,processedRows,totalPeople:profiles.length,totalRelationships:graph.edges.length,totalNodes:graph.nodes.length,changedIds:[...changed],subjectIds:[...subjects],mode:'merge'}};
}
