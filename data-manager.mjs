import {parseUpload} from './importer.mjs?v=paper-confirm-20261111';
import {queueUpload,mergePendingDocuments} from './import-queue.mjs?v=paper-confirm-20261111';
import {enrichPerson} from './people.mjs?v=paper-confirm-20261111';
import {saveLocalGraph,clearLocalGraph,graphFingerprint,loadGitHubGraph,verifyRepositoryOwner,publishGitHubGraph} from './data-sync.mjs?v=paper-confirm-20261111';

const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const format=value=>Number(value||0).toLocaleString('en-US');
const issueText=issue=>typeof issue==='string'?issue:issue?.message||String(issue);

export function setupDataManager({getBaseGraph,getPublishedGraph,getActiveInfo,onActivateGraph}){
  const $=selector=>document.querySelector(selector),dialog=$('#data-modal');
  let upload=null,preview=null,previewDocuments=[],previewBaseFingerprint='',busy=false,previewGeneration=0,previewCommitted=false,canReturnToPaper=false;
  const status=(message,error=false)=>{const element=$('#import-status');element.textContent=message;element.className=error?'notice import-error':'sync-status';if(error&&dialog.open)element.scrollIntoView({block:'nearest'});};
  function setBusy(value){busy=value;dialog.dataset.busy=String(value);const errors=preview?.issues?.some(issue=>typeof issue==='object'&&issue.level==='error');for(const id of ['preview-pasted','apply-import','download-import','publish-import','show-publish','restore-published','back-paper']){const button=$('#'+id);if(button)button.disabled=value||((!preview||errors)&&['apply-import','download-import','publish-import','show-publish'].includes(id));}$('#data-file').disabled=value;dialog.querySelectorAll('[data-open-paper],[data-close]').forEach(button=>button.disabled=value);}
  function closeCredentials(){ $('#owner-token').value='';$('#publish-reviewed').checked=false; }
  dialog.addEventListener('close',closeCredentials);
  dialog.addEventListener('cancel',event=>{if(busy)event.preventDefault();});
  $('#upload-data').addEventListener('click',()=>{$('#data-source-controls').hidden=false;if(!preview)$('#data-source-controls').open=true;dialog.showModal();});
  function showLocalResult(info,message){
    const local=info?.source==='local'&&info.pendingUploads?.length;
    $('#import-result').hidden=!local;
    $('#review-local-publish').hidden=!local;
    if(local)$('#import-result-text').textContent=message||'本地更新已保存，尚未共享发布。其他访客仍使用已发布数据库。';
  }
  function revealPublish(){
    if(!preview||busy)return;
    $('#owner-controls').open=true;
    $('#owner-token').focus();
    $('#owner-controls').scrollIntoView({block:'start',behavior:'smooth'});
  }
  $('#show-publish').addEventListener('click',revealPublish);
  $('#dismiss-import-result').addEventListener('click',()=>{$('#import-result').hidden=true;});
  $('#review-local-publish').addEventListener('click',async()=>{
    if(busy)return;
    const pending=getActiveInfo()?.pendingUploads||[];if(!pending.length)return;
    dialog.showModal();setBusy(true);status('正在准备待发布更新…');
    try{canReturnToPaper=false;await makePreview(pending.at(-1),getPublishedGraph(),pending);}
    catch(error){preview=null;$('#import-preview').hidden=true;status(error.message,true);}
    finally{setBusy(false);if(preview)revealPublish();}
  });
  showLocalResult(getActiveInfo());
  function changedPeople(base,graph){
    const changed=new Set(preview.summary.changedIds||[]);
    return graph.nodes.filter(n=>n.entityType==='person'&&changed.has(n.id)).slice(0,15);
  }
  function renderPreview(base){
    previewCommitted=false;$('#apply-import').textContent='确认导入并查看图谱';
    const summary=preview.summary;
    const cells=[['新增人物',summary.added],['更新人物',summary.updated],['未变更人物',summary.unchanged],['新增关系',summary.newRelationships],['身份待核对',summary.ambiguous],['排除记录',summary.excluded]];
    const sample=changedPeople(base,preview.graph).map(n=>enrichPerson(n));
    const messages=[...(preview.warnings||[]),...(preview.issues||[]).map(issueText)];
    $('#import-preview').hidden=false;
    $('#import-preview').innerHTML=`<div class="import-summary">${cells.map(([label,count])=>`<div><b>${format(count)}</b><span>${esc(label)}</span></div>`).join('')}</div><p class="source-note">合并后共 ${format(summary.totalPeople)} 位人物、${format(summary.totalRelationships)} 条关系。原有记录保留，空值不会清除已知信息。</p>
    ${sample.length?`<div class="table-scroll import-table"><table class="directory-table"><thead><tr><th>变更人物</th><th>机构</th><th>身份 / 职位</th><th>毕业日期</th></tr></thead><tbody>${sample.map(n=>`<tr><td>${esc(n.name)}</td><td>${esc(n.displayAffiliation)}</td><td>${esc(n.displayRole)}</td><td>${esc(n.expectedGraduationLabel||'—')}</td></tr>`).join('')}</tbody></table></div><p class="source-note">最多显示 15 位变更人物；确认导入后可在图谱和名录中查看完整结果。</p>`:'<p class="source-note">本次没有变更人物档案。</p>'}
    ${messages.length?`<details class="import-warnings"><summary>${format(messages.length)} import notes</summary><ul>${messages.slice(0,30).map(message=>`<li>${esc(message)}</li>`).join('')}</ul>${messages.length>30?'<p>Additional notes are included in the import summary.</p>':''}</details>`:''}`;
    const errors=(preview.issues||[]).filter(issue=>typeof issue==='object'&&issue.level==='error');
    $('#apply-import').disabled=busy||errors.length>0;
    $('#download-import').disabled=busy||errors.length>0;
    $('#publish-import').disabled=busy||errors.length>0;
    $('#publish-reviewed').checked=false;
    $('#data-title').textContent='确认导入';
    $('#import-step').textContent=upload?.kind==='paper'?'1 论文与作者已核对 → 2 确认导入':'选择来源 → 合并已预览 → 确认导入';
    $('#data-source-controls').hidden=upload?.kind==='paper';
    $('#data-source-controls').open=false;
    $('#back-paper').hidden=!canReturnToPaper||upload?.kind!=='paper';
    $('#import-action-hint').textContent='确认导入会保存到当前浏览器并显示图谱；共享发布后其他访客才能看到更新。';
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
    const count=parsed.kind==='paper'?format(parsed.papers.length)+' 篇论文':format(parsed.rows?.length||0)+' 条来源记录';
    status('合并预览已生成：'+count+'。请核对下方变更，然后在窗口底部确认导入或选择共享发布。');
    dialog.querySelector('.modal-body').scrollTop=0;
    $('#apply-import').focus({preventScroll:true});
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
  async function openParsed(parsed,options={}){
    if(busy)return;
    canReturnToPaper=Boolean(options.canReturnToPaper);
    if(!dialog.open)dialog.showModal();
    setBusy(true);status('正在生成合并预览…');
    try{await makePreview(parsed,getBaseGraph());return preview;}
    catch(error){preview=null;$('#import-preview').hidden=true;status(error.message||'This update could not be prepared.',true);return null;}
    finally{setBusy(false);}
  }
  async function readFile(file){
    if(!file||busy)return;
    canReturnToPaper=false;
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
    if(previewCommitted&&!busy){dialog.close();return;}
    if(!preview||busy)return;setBusy(true);
    try{
      const info={source:'local',sourceFile:upload.sourceFile,baseFingerprint:previewBaseFingerprint,pendingUploads:previewDocuments,focusPersonId:preview.summary.focusPersonId||null};
      await saveLocalGraph(preview.graph,info);await onActivateGraph(preview.graph,info);
      showLocalResult(info,'已确认导入并更新图谱，刷新后仍保留。此更新仅保存在当前浏览器，可继续发布到共享数据库。');
      dialog.close();
    }catch(error){status(error.message,true);}finally{setBusy(false);}
  });
  $('#restore-published').addEventListener('click',async()=>{
    if(busy)return;setBusy(true);
    try{await clearLocalGraph();await onActivateGraph(getPublishedGraph(),{source:'published'});preview=null;upload=null;$('#import-preview').hidden=true;$('#data-title').textContent='上传与更新数据库';$('#data-source-controls').hidden=false;$('#data-source-controls').open=true;$('#back-paper').hidden=true;$('#owner-controls').open=false;showLocalResult({source:'published'});status('已恢复已发布数据库，并清除本地未发布更新。');$('#import-action-hint').textContent='生成预览后，在此确认导入。';}
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
    if(!$('#publish-reviewed').checked)return status('请核对合并预览，并勾选共享发布确认。',true);
    const token=$('#owner-token').value.trim();if(!token)return status('请输入仅授权此仓库的 GitHub 令牌以发布。',true);
    setBusy(true);status('正在验证所有者身份，并读取最新共享数据库…');
    try{
      await verifyRepositoryOwner(token);
      const latest=await loadGitHubGraph(token),fingerprint=await graphFingerprint(latest.graph);
      if(fingerprint!==previewBaseFingerprint){
        await makePreview(upload,latest.graph,previewDocuments);
        status('共享数据库与本次预览不同，已按最新共享数据重新合并。请核对刷新后的预览，重新勾选确认后发布。');
        return;
      }
      if(!(Number(preview.summary.added)+Number(preview.summary.updated)+Number(preview.summary.newRelationships)+Number(preview.summary.papersAdded||0)+Number(preview.summary.papersUpdated||0))){status('本次导入没有改变共享数据库，无需重复发布。');return;}
      status('正在将已核对的公开数据发布到 GitHub…');
      const result=await publishGitHubGraph(preview.graph,token,latest.sha);
      const info={source:'published_pending',sourceFile:upload.sourceFile,commit:result.commit,baseFingerprint:await graphFingerprint(preview.graph),pendingUploads:[],focusPersonId:preview.summary.focusPersonId||null};
      await saveLocalGraph(preview.graph,info);await onActivateGraph(preview.graph,info);
      closeCredentials();
      previewCommitted=true;
      showLocalResult(info);
      $('#import-action-hint').textContent='共享数据已提交。部署完成后，其他访客即可读取更新。';
      $('#apply-import').textContent='查看已更新图谱';
      status('共享数据库已更新。GitHub Pages 正在部署新版本，完成后所有访客即可读取更新。');
      if(result.url){const link=document.createElement('a');link.className='evidence-link';link.href=result.url;link.textContent='查看 GitHub 数据提交 ↗';link.target='_blank';link.rel='noopener noreferrer';$('#import-status').append(document.createElement('br'),link);}
    }catch(error){status(error.message||'The update was not published.',true);}
    finally{setBusy(false);}
  });
  return{openParsed};
}
