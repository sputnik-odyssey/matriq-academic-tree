import {resolvePaper,parsePaperInput} from './paper-resolver.mjs?v=author-alias-20261111';
import {previewAuthorMatches,normalizeORCID,searchProfilesForAuthor} from './paper-importer.mjs?v=author-alias-20261111';

const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const safeURL=value=>{try{const u=new URL(value);return /^https?:$/.test(u.protocol)?u.href:'';}catch{return'';}};
const EXAMPLE_TITLE='Hardware-Aware Compilation and Execution of Bivariate Bicycle Codes on Neutral-Atom Systems';
const EXAMPLE_URL='https://scholar.google.com/citations?view_op=view_citation&hl=en&user=rPCT_loAAAAJ&sortby=pubdate&citation_for_view=rPCT_loAAAAJ:eQOLeE2rZwMC';

export function setupPaperManager({getBaseGraph,dataManager}){
  const $=s=>document.querySelector(s),dialog=$('#paper-modal');
  let candidates=[],selected=null,review=null,busy=false,request=null,inputInfo=null;
  const status=(message,error=false)=>{const element=$('#paper-status');element.textContent=message;element.className=error?'notice import-error':'sync-status';};
  function updateNext(){
    const count=review?.authors?.length||0,unresolved=[...document.querySelectorAll('[data-author-index]')].some(select=>!select.value);
    $('#preview-paper').disabled=busy||!count||count>100||unresolved;
    $('#paper-next-hint').textContent=busy?'正在识别论文，请稍候…':!count?'识别论文后，核对作者并进入确认导入。':unresolved?'请选择每位作者对应的档案，或选择新建人物。':count>100?'单篇论文最多支持 100 位作者。':'已识别 '+count+' 位作者。核对后点击下一步，确认新增人物与合作关系。';
  }
  function setBusy(value){busy=value;$('#find-paper').disabled=value;$('#paper-example').disabled=value;$('#paper-query').disabled=value;$('#paper-title-hint').disabled=value;updateNext();}
  function open(preserveReview=false){
    if($('#data-modal').open)$('#data-modal').close();
    if(selected&&!preserveReview)renderAuthors(selected);
    dialog.showModal();
    $('#paper-query').focus();
  }
  document.querySelectorAll('[data-open-paper]').forEach(button=>button.addEventListener('click',()=>open()));
  $('#back-paper').addEventListener('click',()=>open(true));
  $('#paper-query').addEventListener('input',()=>{$('#paper-title-hint').value='';selected=null;review=null;$('#paper-candidates').hidden=true;$('#paper-authors').hidden=true;updateNext();});
  $('#paper-title-hint').addEventListener('input',()=>{selected=null;review=null;$('#paper-candidates').hidden=true;$('#paper-authors').hidden=true;updateNext();});
  dialog.addEventListener('close',()=>{if(busy&&request)request.abort();});
  $('#paper-example').addEventListener('click',()=>{$('#paper-query').value=EXAMPLE_URL;$('#paper-title-hint').value='';lookup();});
  $('#paper-lookup').addEventListener('submit',event=>{event.preventDefault();lookup();});
  $('#paper-candidates').addEventListener('change',event=>{
    const index=event.target.dataset.paperIndex;
    if(index!==undefined){try{renderAuthors(candidates[Number(index)]);}catch(error){status(error.message||'此记录的作者信息不可导入，请选择另一条。',true);}}
  });
  $('#paper-authors').addEventListener('change',event=>{
    const select=event.target.closest('[data-author-index]');
    if(select&&review){
      const author=review.authors.find(a=>String(a.index)===select.dataset.authorIndex),note=select.closest('td').querySelector('[data-match-note]');
      if(note&&author)note.textContent=select.value==='new'?'将新建独立人物档案。':(author.variantCandidateIds||[]).includes(select.value)?'姓名变体候选；确认后记住论文署名，保留已有主姓名。':'已选择已有档案；确认后保留论文署名作为别名。';
    }
    updateNext();
  });
  $('#paper-authors').addEventListener('input',event=>{
    const input=event.target.closest('[data-author-search]');if(!input||!review)return;
    const author=review.authors.find(a=>String(a.index)===input.dataset.authorSearch),results=input.closest('details').querySelector('[data-author-results]'),query=input.value.trim();
    if(!query){results.textContent='输入姓名、机构或档案编号。';return;}
    const matches=searchProfilesForAuthor(getBaseGraph(),author,query,{limit:12});
    results.innerHTML=matches.length?matches.map(n=>'<button type="button" class="author-search-result" data-pick-author="'+esc(author.index)+'" data-pick-node="'+esc(n.id)+'" '+(n.conflict?'disabled':'')+'><b>'+esc(n.name)+'</b><small>'+esc(n.affiliation||'机构未提供')+' · '+esc(n.id)+(n.conflict?' · ORCID 冲突':'')+'</small></button>').join(''):'<p class="source-note">未找到匹配档案，可修改检索词或选择新建。</p>';
  });
  $('#paper-authors').addEventListener('click',event=>{
    const button=event.target.closest('[data-pick-author]');if(!button||button.disabled)return;
    const select=$('#paper-authors').querySelector('[data-author-index="'+button.dataset.pickAuthor+'"]'),node=getBaseGraph().nodes.find(n=>n.id===button.dataset.pickNode);if(!select||!node)return;
    let option=[...select.options].find(o=>o.value===node.id);if(!option){option=document.createElement('option');option.value=node.id;option.textContent=node.name+' · '+(node.affiliation||'机构未提供')+' · '+node.id;select.append(option);}
    select.value=node.id;const note=select.closest('td').querySelector('[data-match-note]');if(note)note.textContent='已手动选择 '+node.name+'；确认后将论文署名记为此人的别名。';
    button.closest('details').open=false;updateNext();
  });
  function renderCandidates(){
    $('#paper-candidates').hidden=false;
    $('#paper-candidates').innerHTML='<fieldset class="paper-result-list"><legend>选择论文记录</legend>'+candidates.map((paper,index)=>
      '<label class="paper-result"><input type="radio" name="paper-result" data-paper-index="'+index+'" '+(index===0?'checked':'')+'><span><b>'+esc(paper.title)+'</b><small>'+esc(paper.year||'')+' · '+esc(paper.authors.map(a=>a.name).join(', '))+'</small><small>'+esc(paper.doi||paper.arxivId||paper.url||'')+'</small></span></label>'
    ).join('')+'</fieldset>';
  }
  function renderAuthors(paper){
    selected=null;review=null;$('#paper-authors').hidden=true;$('#preview-paper').disabled=true;
    const checked=previewAuthorMatches(getBaseGraph(),paper);selected=paper;review=checked;
    const nodeMap=new Map(getBaseGraph().nodes.map(n=>[n.id,n]));
    const authors=review.authors||[],pairs=authors.length*(authors.length-1)/2;
    $('#paper-authors').hidden=false;
    $('#paper-authors').innerHTML='<h3>'+esc(paper.title)+'</h3><p class="source-note">'+authors.length+' 位作者 · 将记录 '+pairs+' 组共同作者关系。核对后点击窗口底部的“下一步：确认导入”。</p>'+
      '<div class="table-scroll"><table class="directory-table paper-author-table"><thead><tr><th>作者</th><th>论文所列机构</th><th>匹配人物档案</th></tr></thead><tbody>'+
      authors.map(author=>{
        const ids=author.candidateIds||[];
        const choice=author.matchId||(author.requiresReview?'':ids.length===1?ids[0]:ids.length>1?'':'new');
        const options=(ids.length>1||author.requiresReview?'<option value="">请选择候选档案或新建</option>':'')+'<option value="new" '+(choice==='new'?'selected':'')+'>新建人物档案</option>'+ids.map(id=>{
          const n=nodeMap.get(id);return '<option value="'+esc(id)+'" '+(choice===id?'selected':'')+'>'+esc(n?.name||id)+' · '+esc(n?.affiliation||'机构未提供')+' · '+esc(id)+'</option>';
        }).join('');
        const note=author.status==='variant'?'发现姓名变体，请选择已有档案或新建':author.status==='new'?'未找到精确匹配，可搜索已有档案':author.status==='exact'?(author.reason==='Exact ORCID'?'ORCID 一致':'已核对的姓名或论文作者'):author.status==='ambiguous'?'有多个候选档案，请选择':'发现同名档案，请核对';
        const search='<details class="author-match-search"><summary>搜索其他已有档案</summary><input type="search" data-author-search="'+author.index+'" aria-label="搜索 '+esc(author.name)+' 的已有档案" placeholder="姓名、机构或档案编号" autocomplete="off"><div data-author-results aria-live="polite"></div></details>';
        return '<tr><td data-label="作者"><b>'+esc(author.name)+'</b>'+(author.orcid?'<small>ORCID '+esc(author.orcid)+'</small>':'')+'</td><td data-label="论文所列机构">'+esc(author.affiliation||'未提供')+'</td><td data-label="匹配人物档案"><select data-author-index="'+author.index+'" aria-label="'+esc(author.name)+' 的人物档案">'+options+'</select><small data-match-note>'+esc(note)+'</small>'+search+'</td></tr>';
      }).join('')+'</tbody></table></div>'+
      '<p class="source-note">机构按论文发表时的信息显示；确认匹配后保留已有主姓名，记住论文署名及无冲突的 ORCID。当前职位和导师关系沿用已有档案。</p>'+
      '<div class="paper-source-links">'+(paper.sources||[]).filter(source=>safeURL(source.url)).map(source=>'<a class="evidence-link" href="'+esc(safeURL(source.url))+'" target="_blank" rel="noopener noreferrer">'+esc(source.name||source.title||'论文来源')+' ↗</a>').join(' · ')+'</div>';
    const notes=[...(review.warnings||[]),...(review.issues||[]).map(issue=>issue.message||String(issue))];
    if(notes.length){const p=document.createElement('p');p.className='source-note';p.textContent=notes.join(' ');$('#paper-authors').append(p);}
    updateNext();
  }
  async function lookup(){
    const input=$('#paper-query').value.trim();if(!input)return status('请输入论文标题或链接。',true);
    if(request)request.abort();request=new AbortController();setBusy(true);review=null;selected=null;
    $('#paper-candidates').hidden=true;$('#paper-authors').hidden=true;
    status('正在检索论文与作者…');
    try{
      const parsedInput=parsePaperInput(input),titleHint=['scholar','unsupported-url'].includes(parsedInput.kind)?$('#paper-title-hint').value.trim():'';
      inputInfo=parsedInput;
      const known=parsedInput.kind==='scholar'&&parsedInput.citationId?(getBaseGraph().papers||[]).filter(paper=>(paper.sources||[]).some(source=>{const alias=parsePaperInput(source.url);return alias.kind==='scholar'&&alias.citationId===parsedInput.citationId;})):[];
      const result=known.length?{candidates:known,warnings:['已从已导入论文中定位该 Scholar 条目。']}:await resolvePaper(input,{titleHint,signal:request.signal});
      candidates=(result.candidates||[]).slice(0,8);
      if(!candidates.length){status((result.warnings||[]).join(' ')||'未找到可导入的论文。请补充完整标题或 DOI。',true);$('#paper-fallback').open=true;return;}
      renderCandidates();renderAuthors(candidates[0]);
      const warning=(result.warnings||[]).join(' ');
      status('找到 '+candidates.length+' 条论文记录。请核对题目及作者。'+(warning?' '+warning:''));
    }catch(error){if(error.name!=='AbortError')status(error.message||'论文检索暂不可用，请稍后重试或补充标题。',true);else status('已取消检索，可重新查询。');}
    finally{setBusy(false);if(review)$('#paper-authors').dispatchEvent(new Event('change',{bubbles:true}));}
  }
  $('#preview-paper').addEventListener('click',async()=>{
    if(!selected||!review||busy)return;
    const matches={};
    for(const select of document.querySelectorAll('[data-author-index]')){
      if(!select.value)return status('请先选择每位作者对应的档案，或选择新建。',true);
      const node=getBaseGraph().nodes.find(n=>n.id===select.value);
      const orcid=node?(normalizeORCID(node.orcid)||(node.records||[]).map(r=>normalizeORCID(r.fields?.Q)).find(Boolean)||''):'';
      matches['0:'+select.dataset.authorIndex]=select.value==='new'?'new':{nodeId:select.value,identity:{name:node?.name||'',orcid}};
    }
    const paper={...selected,sources:[...(selected.sources||[])]};
    const aliasURL=inputInfo?.kind==='scholar'?safeURL(inputInfo.inputUrl):'';
    if(aliasURL&&!paper.sources.some(source=>source.url===aliasURL))paper.sources.push({name:'Google Scholar · 用户提供条目',url:aliasURL});
    const parsed={kind:'paper',sourceFile:'paper-import.json',sheet:'Papers',papers:[paper],matches,warnings:[]};
    dialog.close();
    await dataManager.openParsed(parsed,{canReturnToPaper:true});
  });
  return{open,exampleTitle:EXAMPLE_TITLE};
}
