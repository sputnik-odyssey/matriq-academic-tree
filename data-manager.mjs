import {parseUpload} from './importer.mjs?v=paper-collaboration-20261111';
import {queueUpload,mergePendingDocuments} from './import-queue.mjs?v=paper-collaboration-20261111';
import {enrichPerson} from './people.mjs?v=paper-collaboration-20261111';
import {saveLocalGraph,clearLocalGraph,graphFingerprint,loadGitHubGraph,verifyRepositoryOwner,publishGitHubGraph} from './data-sync.mjs?v=paper-collaboration-20261111';

const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const format=value=>Number(value||0).toLocaleString('en-US');
const issueText=issue=>typeof issue==='string'?issue:issue?.message||String(issue);

export function setupDataManager({getBaseGraph,getPublishedGraph,getActiveInfo,onActivateGraph}){
  const $=selector=>document.querySelector(selector),dialog=$('#data-modal');
  let upload=null,preview=null,previewDocuments=[],previewBaseFingerprint='',busy=false,previewGeneration=0;
  const status=(message,error=false)=>{const element=$('#import-status');element.textContent=message;element.className=error?'notice import-error':'sync-status';};
  function setBusy(value){busy=value;const errors=preview?.issues?.some(issue=>typeof issue==='object'&&issue.level==='error');for(const id of ['preview-pasted','apply-import','download-import','publish-import','restore-published']){const button=$('#'+id);if(button)button.disabled=value||((!preview||errors)&&['apply-import','download-import','publish-import'].includes(id));}$('#data-file').disabled=value;dialog.querySelectorAll('[data-open-paper]').forEach(button=>button.disabled=value);}
  function closeCredentials(){ $('#owner-token').value='';$('#publish-reviewed').checked=false; }
  dialog.addEventListener('close',closeCredentials);
  $('#upload-data').addEventListener('click',()=>dialog.showModal());
  function changedPeople(base,graph){
    const changed=new Set(preview.summary.changedIds||[]);
    return graph.nodes.filter(n=>n.entityType==='person'&&changed.has(n.id)).slice(0,15);
  }
  function renderPreview(base){
    const summary=preview.summary;
    const cells=[['New profiles',summary.added],['Updated profiles',summary.updated],['Unchanged',summary.unchanged],['New links',summary.newRelationships],['Ambiguous',summary.ambiguous],['Excluded rows',summary.excluded]];
    const sample=changedPeople(base,preview.graph).map(n=>enrichPerson(n));
    const messages=[...(preview.warnings||[]),...(preview.issues||[]).map(issueText)];
    $('#import-preview').hidden=false;
    $('#import-preview').innerHTML=`<div class="import-summary">${cells.map(([label,count])=>`<div><b>${format(count)}</b><span>${esc(label)}</span></div>`).join('')}</div><p class="source-note">${format(summary.totalPeople)} person profiles · ${format(summary.totalRelationships)} links after merge. Existing records are retained. Empty upload cells do not erase known values.</p>
    ${sample.length?`<div class="table-scroll import-table"><table class="directory-table"><thead><tr><th>Changed person</th><th>Affiliation</th><th>Status / job title</th><th>Graduation</th></tr></thead><tbody>${sample.map(n=>`<tr><td>${esc(n.name)}</td><td>${esc(n.displayAffiliation)}</td><td>${esc(n.displayRole)}</td><td>${esc(n.expectedGraduationLabel||'—')}</td></tr>`).join('')}</tbody></table></div><p class="source-note">Showing up to 15 changed profiles. Apply a local preview to inspect the full result in the directory and graph.</p>`:'<p class="source-note">No changed person profiles in this preview.</p>'}
    ${messages.length?`<details class="import-warnings"><summary>${format(messages.length)} import notes</summary><ul>${messages.slice(0,30).map(message=>`<li>${esc(message)}</li>`).join('')}</ul>${messages.length>30?'<p>Additional notes are included in the import summary.</p>':''}</details>`:''}`;
    const errors=(preview.issues||[]).filter(issue=>typeof issue==='object'&&issue.level==='error');
    $('#apply-import').disabled=busy||errors.length>0;
    $('#download-import').disabled=busy||errors.length>0;
    $('#publish-import').disabled=busy||errors.length>0;
    $('#publish-reviewed').checked=false;
    renderPaperSummary();
  }
  async function makePreview(parsed,base,documents=null){
    const generation=++previewGeneration;
    const queued=documents||queueUpload(parsed,getActiveInfo()?.pendingUploads||[]);
    const next=await mergePendingDocuments(base,queued);
    next.warnings=[...(parsed.warnings||[]),...(next.warnings||[])];
    const fingerprint=await graphFingerprint(base);
    if(generation!==previewGeneration)return;
    upload=parsed;preview=next;previewDocuments=queued;previewBaseFingerprint=fingerprint;renderPreview(base);
    const count=parsed.kind==='paper'?format(parsed.papers.length)+' papers':format(parsed.rows?.length||0)+' source rows';
    status('Ready to review: '+parsed.sourceFile+' · '+(parsed.sheet||'data')+' · '+count+'. Nothing has been published.');
  }
  function renderPaperSummary(){
    if(!(upload?.papers?.length)||!preview)return;
    const section=document.createElement('section');section.className='paper-import-list';
    const heading=document.createElement('h3');heading.textContent='论文与共同作者';section.append(heading);
    const counts=document.createElement('p');counts.className='source-note';
    counts.textContent='新增论文 '+format(preview.summary.papersAdded)+' · 更新论文 '+format(preview.summary.papersUpdated)+' · 合作关系为青色无向连线。';section.append(counts);
    for(const paper of upload.papers){
      const p=document.createElement('p');p.textContent=paper.title+' · '+paper.authors.map(author=>author.name).join(', ');section.append(p);
    }
    $('#import-preview').append(section);
  }
  async function openParsed(parsed){
    if(busy)return;
    if(!dialog.open)dialog.showModal();
    setBusy(true);status('Preparing the reviewed merge…');
    try{await makePreview(parsed,getBaseGraph());return preview;}
    catch(error){preview=null;$('#import-preview').hidden=true;status(error.message||'This update could not be prepared.',true);return null;}
    finally{setBusy(false);}
  }
  async function readFile(file){
    if(!file||busy)return;
    setBusy(true);status('Reading the document and preparing a public-field-only merge…');
    try{const parsed=await parseUpload(file);await makePreview(parsed,getBaseGraph());}
    catch(error){preview=null;$('#import-preview').hidden=true;status(error.message||'This document could not be imported.',true);}
    finally{$('#data-file').value='';setBusy(false);}
  }
  $('#data-file').addEventListener('change',event=>readFile(event.target.files?.[0]));
  $('#preview-pasted').addEventListener('click',()=>{
    const text=$('#import-text').value.trim();if(!text)return status('Choose a file or paste CSV / JSON first.',true);
    const json=/^[\[{]/.test(text);readFile(new File([text],json?'pasted-data.json':'pasted-data.csv',{type:json?'application/json':'text/csv'}));
  });
  $('#apply-import').addEventListener('click',async()=>{
    if(!preview||busy)return;setBusy(true);
    try{
      const info={source:'local',sourceFile:upload.sourceFile,baseFingerprint:previewBaseFingerprint,pendingUploads:previewDocuments,focusPersonId:preview.summary.focusPersonId||null};
      await saveLocalGraph(preview.graph,info);await onActivateGraph(preview.graph,info);
      status('Local database updated. This browser will keep the sanitized preview after reload. Other visitors still see the published database.');
    }catch(error){status(error.message,true);}finally{setBusy(false);}
  });
  $('#restore-published').addEventListener('click',async()=>{
    if(busy)return;setBusy(true);
    try{await clearLocalGraph();await onActivateGraph(getPublishedGraph(),{source:'published'});preview=null;upload=null;$('#import-preview').hidden=true;status('Using the published database again. The local preview has been cleared.');}
    catch(error){status(error.message,true);}finally{setBusy(false);}
  });
  $('#download-import').addEventListener('click',()=>{
    if(!preview)return;
    const link=document.createElement('a'),url=URL.createObjectURL(new Blob([JSON.stringify(preview.graph,null,2)],{type:'application/json'}));
    link.href=url;link.download='matriq-public-graph.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
    status('Public JSON prepared. It contains the reviewed public fields, not the original uploaded workbook.');
  });
  $('#publish-import').addEventListener('click',async()=>{
    if(!preview||!upload||busy)return;
    if(!$('#publish-reviewed').checked)return status('Review the preview and tick the publishing confirmation first.',true);
    const token=$('#owner-token').value.trim();if(!token)return status('Enter a repository-scoped GitHub token to publish.',true);
    setBusy(true);status('Checking the owner account and latest shared database…');
    try{
      await verifyRepositoryOwner(token);
      const latest=await loadGitHubGraph(token),fingerprint=await graphFingerprint(latest.graph);
      if(fingerprint!==previewBaseFingerprint){
        await makePreview(upload,latest.graph,previewDocuments);
        status('The shared database differs from this preview. The merge has been refreshed against the latest shared data. Review it, tick the confirmation and publish again.');
        return;
      }
      if(!(Number(preview.summary.added)+Number(preview.summary.updated)+Number(preview.summary.newRelationships)+Number(preview.summary.papersAdded||0)+Number(preview.summary.papersUpdated||0))){status('This document does not change the shared database. Nothing was published.');return;}
      status('Publishing the reviewed public data to GitHub…');
      const result=await publishGitHubGraph(preview.graph,token,latest.sha);
      const info={source:'published_pending',sourceFile:upload.sourceFile,commit:result.commit,baseFingerprint:await graphFingerprint(preview.graph),pendingUploads:[],focusPersonId:preview.summary.focusPersonId||null};
      await saveLocalGraph(preview.graph,info);await onActivateGraph(preview.graph,info);
      closeCredentials();
      status('Shared database updated. GitHub Pages is publishing the new version; other visitors receive it after deployment completes.');
      if(result.url){const link=document.createElement('a');link.className='evidence-link';link.href=result.url;link.textContent='View data update on GitHub ↗';link.target='_blank';link.rel='noopener noreferrer';$('#import-status').append(document.createElement('br'),link);}
    }catch(error){status(error.message||'The update was not published.',true);}
    finally{setBusy(false);}
  });
  return{openParsed};
}
