import {previewImport} from './importer.mjs?v=paper-collaboration-20261111';
import {previewPaperImport,sanitizePaper,sanitizePaperDocument} from './paper-importer.mjs?v=paper-collaboration-20261111';

export function queueUpload(parsed,staged=[]){
  const current=parsed.kind==='paper'?sanitizePaperDocument(parsed):{sourceFile:parsed.sourceFile,sheet:parsed.sheet,rows:structuredClone(parsed.rows),warnings:[],...(parsed.sourceIdentity?{sourceIdentity:parsed.sourceIdentity}:{}),...(parsed.papers?.length?{papers:parsed.papers.map(p=>sanitizePaper(p,{keepNodeIds:true}))}:{})};
  const queue=structuredClone(staged);
  if(!queue.some(item=>JSON.stringify(item)===JSON.stringify(current)))queue.push(current);
  return queue;
}

export async function mergePendingDocuments(base,documents){
  let graph=base;const changed=new Set(),subjects=new Set(),warnings=[],issues=[];
  let ambiguous=0,excluded=0,processedRows=0,focusPersonId=null;
  for(const document of documents){
    const result=document.kind==='paper'?previewPaperImport(graph,document):previewImport(graph,document,{mode:'merge'});graph=result.graph;
    for(const id of result.summary.changedIds||[])changed.add(id);
    for(const id of result.summary.subjectIds||[])subjects.add(id);
    warnings.push(...(result.warnings||[]).map(message=>`${document.sourceFile}: ${message}`));issues.push(...(result.issues||[]));
    ambiguous+=result.summary.ambiguous||0;excluded+=result.summary.excluded||0;processedRows+=result.summary.processedRows||0;focusPersonId=result.summary.focusPersonId||focusPersonId;
  }
  const profiles=graph.nodes.filter(n=>n.entityType==='person'&&!n.stub),original=new Set(base.nodes.filter(n=>n.entityType==='person'&&!n.stub).map(n=>n.id));
  const added=profiles.filter(n=>!original.has(n.id)).length,updated=profiles.filter(n=>original.has(n.id)&&changed.has(n.id)).length;
  const originalPapers=new Map((base.papers||[]).map(p=>{const safe=sanitizePaper(p,{keepNodeIds:true});return[safe.id,JSON.stringify(safe)];}));
  const papersAdded=(graph.papers||[]).filter(p=>!originalPapers.has(p.id)).length,papersUpdated=(graph.papers||[]).filter(p=>originalPapers.has(p.id)&&originalPapers.get(p.id)!==JSON.stringify(p)).length;
  const originalEdges=new Set(base.edges.map(e=>e.id)),newRelationships=graph.edges.filter(e=>!originalEdges.has(e.id)).length;
  return{graph,warnings,issues,summary:{added,updated,unchanged:Math.max(0,profiles.length-added-updated),newRelationships,retained:Math.max(0,original.size-updated),ambiguous,excluded,processedRows,totalPeople:profiles.length,totalRelationships:graph.edges.length,totalNodes:graph.nodes.length,papersAdded,papersUpdated,totalPapers:graph.papers?.length||0,focusPersonId,changedIds:[...changed],subjectIds:[...subjects],mode:'merge'}};
}
