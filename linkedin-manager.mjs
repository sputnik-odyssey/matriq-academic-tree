import {normalizeLinkedInURL,parseLinkedInText} from './linkedin-parser.mjs?v=linkedin-history-20261111';
import {APIFY_ACTOR,fetchLinkedInProfile} from './linkedin-api.mjs?v=career-refresh-20261125';
import {sanitizeAcademicHistory,normalizeAcademicDate,statesForType} from './academic-history.mjs?v=career-refresh-20261125';

const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const norm=value=>String(value||'').normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
const linkedURL=node=>normalizeLinkedInURL(node?.linkedin||(node?.records||[]).map(r=>r.fields?.R).find(Boolean)||'');
export function setupLinkedInManager({getBaseGraph,dataManager}){
  const $=s=>document.querySelector(s),dialog=$('#linkedin-modal');
  let review=null,busy=false,controller=null,runId='',runURL='',startUncertain=false,targetId='';
  const status=(message,error=false)=>{const el=$('#linkedin-status');el.textContent=message;el.className=error?'notice import-error':'sync-status';if(error&&dialog.open)el.scrollIntoView({block:'nearest'});};
  const hint=()=>{$('#preview-linkedin').disabled=busy||!review;$('#fetch-linkedin').disabled=busy||startUncertain&&!/^[A-Za-z0-9]{8,64}$/.test($('#linkedin-run-id').value.trim());$('#new-linkedin-run').hidden=busy||!runId&&!startUncertain&&!$('#linkedin-run-id').value;$('#linkedin-next-hint').textContent=busy?'正在获取履历。停止等待不会保证取消远端已启动的计费任务。':review?'核对姓名、人物档案及履历条目，再点击下一步。':'抓取完成后可修改机构及起止日期，再确认导入。';};
  function setBusy(value){busy=value;dialog.dataset.busy=String(value);dialog.querySelectorAll('input,select,textarea,button').forEach(el=>{el.disabled=value;});$('#stop-linkedin').hidden=!value;$('#stop-linkedin').disabled=false;$('#fetch-linkedin').textContent=runId?'继续读取本次任务':'抓取 LinkedIn 履历';hint();}
  function open(url='',preserve=false,personId=''){
    if($('#data-modal').open)$('#data-modal').close();
    if(!preserve&&(personId!==targetId||(personId||url)&&url!==$('#linkedin-url').value)){
      targetId=personId;
      $('#linkedin-url').value=url;
      invalidate();
    }
    const target=getBaseGraph().nodes.find(n=>n.id===targetId);
    $('#manual-linkedin-entry').hidden=!target;
    $('#linkedin-title').textContent=target?'刷新人物状态 · '+target.name:'导入 LinkedIn 履历';
    if(!preserve&&review&&normalizeLinkedInURL($('#linkedin-url').value)!==review.linkedin)invalidate();
    dialog.showModal();$('#linkedin-url').focus();
  }
  document.addEventListener('click',event=>{const button=event.target.closest('[data-open-linkedin]');if(button){const target=getBaseGraph().nodes.find(n=>n.id===button.dataset.refreshPerson);open(target?linkedURL(target):button.dataset.linkedinUrl||'',false,target?.id||'');}});
  $('#back-linkedin').addEventListener('click',()=>open('',true));
  dialog.addEventListener('close',()=>{$('#linkedin-api-token').value='';});
  dialog.addEventListener('cancel',event=>{if(busy)event.preventDefault();});
  function invalidate(){review=null;const current=normalizeLinkedInURL($('#linkedin-url').value);if(runId&&runURL!==current){runId='';runURL='';$('#linkedin-run-id').value='';}$('#linkedin-review').hidden=true;$('#fetch-linkedin').textContent=runId?'继续读取本次任务':'抓取 LinkedIn 履历';hint();}
  $('#linkedin-url').addEventListener('input',invalidate);
  $('#stop-linkedin').addEventListener('click',()=>controller?.abort());
  $('#linkedin-run-id').addEventListener('input',()=>{$('#fetch-linkedin').textContent=$('#linkedin-run-id').value.trim()||runId?'继续读取本次任务':'抓取 LinkedIn 履历';hint();});
  $('#new-linkedin-run').addEventListener('click',()=>{runId='';runURL='';startUncertain=false;$('#linkedin-run-id').value='';$('#fetch-linkedin').textContent='抓取 LinkedIn 履历';status('已切换到新任务。再次点击“抓取 LinkedIn 履历”会创建新的计费任务，请先在 Apify 控制台检查是否已有结果。');hint();});
  const providerURL=typeof APIFY_ACTOR==='object'?(APIFY_ACTOR.url||APIFY_ACTOR.pageURL||APIFY_ACTOR.storeUrl):'';
  $('#linkedin-provider-link').href=providerURL||'https://apify.com/harvestapi/linkedin-profile-scraper';
  if(APIFY_ACTOR.tokenURL)dialog.querySelector('a[href="https://console.apify.com/settings/integrations"]').href=APIFY_ACTOR.tokenURL;
  function renderMatches(){
    const name=$('#linkedin-name').value,profiles=getBaseGraph().nodes.filter(n=>n.entityType==='person'&&!n.stub);
    const byURL=profiles.filter(n=>linkedURL(n)===review.linkedin),byName=profiles.filter(n=>[n.name,n.nameZh,...(n.aliases||[])].some(a=>norm(a)&&norm(a)===norm(name)));
    if(targetId){
      const target=profiles.find(n=>n.id===targetId),known=linkedURL(target);
      const valid=target&&(known?known.toLowerCase()===review.linkedin.toLowerCase():byName.includes(target))&&!byURL.some(n=>n.id!==targetId);
      $('#linkedin-match').innerHTML=valid?'<option value="'+esc(targetId)+'">'+esc(target.name)+'</option>':'<option value="">无法确认对应人物</option>';
      $('#linkedin-match-note').textContent=valid?'更新此档案。要刷新表格中的状态，请在一个条目内选择当前状态。':'请核对 LinkedIn 链接和姓名。已有链接须一致。';
      return;
    }
    const candidates=byURL.length?byURL:byName;
    const choice=byURL.length===1?byURL[0].id:candidates.length?'':'new';
    $('#linkedin-match').innerHTML=(candidates.length&&byURL.length!==1?'<option value="">请选择已有档案或新建</option>':'')+(!byURL.length?'<option value="new" '+(choice==='new'?'selected':'')+'>新建人物档案</option>':'')+candidates.map(n=>'<option value="'+esc(n.id)+'" '+(choice===n.id?'selected':'')+'>'+esc(n.name)+' · '+esc(n.affiliation||'机构未提供')+' · '+esc(n.id)+'</option>').join('');
    $('#linkedin-match-note').textContent=byURL.length?'已有档案的 LinkedIn 链接一致，请核对身份。':byName.length?'发现同名档案，请手动核对；姓名相同不代表同一个人。':'未找到匹配档案，将新建人物。';
  }
  $('#linkedin-name').addEventListener('input',()=>{if(review)renderMatches();});
  function statusOptions(type){
    const labels={phd_student:'博士生',phd_candidate:'博士候选人',postdoc:'博士后',faculty:'教职',industry:'企业任职',other:'其他任职'};
    return '<option value="">仅保存为履历</option>'+statesForType(type).map(value=>'<option value="'+value+'">'+labels[value]+'</option>').join('');
  }
  function entryHTML(entry,index){
    const type=entry.type||'phd',endType=entry.ongoing?'ongoing':entry.endDateType||'unspecified';
    return '<article class="linkedin-history-card" data-history-index="'+index+'"><div class="history-card-head"><label><input type="checkbox" data-history-include checked> 导入此条目</label><select data-history-field="type" aria-label="条目 '+(index+1)+' 类型"><option value="phd" '+(type==='phd'?'selected':'')+'>PhD · 博士</option><option value="postdoc" '+(type==='postdoc'?'selected':'')+'>Postdoc · 博后</option><option value="employment" '+(type==='employment'?'selected':'')+'>任职</option></select></div><div class="history-fields"><div class="form-field"><label>机构<input data-history-field="institution" maxlength="1000" value="'+esc(entry.institution||'')+'" placeholder="来源未提供，请补充或取消此条"></label></div><div class="form-field"><label>学位 / 职位<input data-history-field="title" maxlength="500" value="'+esc(entry.title||'')+'"></label></div><div class="form-field"><label>开始日期<input data-history-field="startDate" maxlength="7" value="'+esc(entry.startDate||'')+'" placeholder="YYYY 或 YYYY-MM"></label></div><div class="form-field"><label>结束日期<input data-history-field="endDate" maxlength="7" value="'+esc(entry.endDate||'')+'" placeholder="未提供则留空"></label></div><div class="form-field"><label>结束日期含义<select data-history-field="endDateType"><option value="unspecified" '+(endType==='unspecified'?'selected':'')+'>履历所列结束 / 毕业时间</option><option value="expected" '+(endType==='expected'?'selected':'')+'>预计结束 / 毕业</option><option value="actual" '+(endType==='actual'?'selected':'')+'>已毕业 / 已结束</option><option value="ongoing" '+(endType==='ongoing'?'selected':'')+'>至今 / 在读或在职</option></select></label></div><div class="form-field"><label>来源栏目<select data-history-field="sourceSection"><option value="Education" '+(entry.sourceSection!=='Experience'?'selected':'')+'>Education</option><option value="Experience" '+(entry.sourceSection==='Experience'?'selected':'')+'>Experience</option></select></label></div>'+(targetId?'<div class="form-field"><label>更新为当前状态<select data-history-field="currentStatus">'+statusOptions(type)+'</select></label></div>':'')+'</div></article>';
  }
  function renderReview(result){
    review={...result,linkedin:normalizeLinkedInURL(result.linkedin||$('#linkedin-url').value)};
    if(!review.linkedin)throw Error('未能确认返回数据对应的 LinkedIn 链接。');
    $('#linkedin-name').value=result.name||'';renderMatches();
    $('#linkedin-history-entries').innerHTML=(result.entries||[]).map(entryHTML).join('');
    $('#linkedin-review').hidden=false;hint();
    status((result.entries?.length?'识别到 '+result.entries.length+' 条履历，请核对。':'未识别到明确的履历条目；可补充公开履历中的条目。')+(result.warnings?.length?' '+result.warnings.join(' '):''));
  }
  $('#add-linkedin-entry').addEventListener('click',()=>{const index=$('#linkedin-history-entries').children.length;if(index>=40)return status('单次最多核对 40 条履历。',true);$('#linkedin-history-entries').insertAdjacentHTML('beforeend',entryHTML({type:'phd',title:'',sourceSection:'Education'},index));});
  $('#linkedin-history-entries').addEventListener('change',event=>{
    const field=event.target.dataset.historyField,card=event.target.closest('[data-history-index]');
    if(!card)return;
    if(field==='endDateType'&&event.target.value==='ongoing')card.querySelector('[data-history-field="endDate"]').value='';
    if(field==='type'){
      const current=card.querySelector('[data-history-field="currentStatus"]');
      if(current)current.innerHTML=statusOptions(event.target.value);
      card.querySelector('[data-history-field="sourceSection"]').value=event.target.value==='phd'?'Education':'Experience';
    }
    if(field==='currentStatus'&&event.target.value){
      for(const select of dialog.querySelectorAll('[data-history-field="currentStatus"]'))if(select!==event.target)select.value='';
    }
  });
  $('#linkedin-fetch-form').addEventListener('submit',async event=>{
    event.preventDefault();if(busy)return;
    const url=normalizeLinkedInURL($('#linkedin-url').value),token=$('#linkedin-api-token').value.trim();
    if(!url)return status('请输入有效的 LinkedIn 人物链接（/in/…）。',true);
    if(!token)return status('请输入 Apify API Token。密钥只发送给 Apify，不保存到数据库。',true);
    const suppliedRun=$('#linkedin-run-id').value.trim();if(suppliedRun){runId=suppliedRun;runURL=url;}
    controller=new AbortController();setBusy(true);status(runId?'正在读取已启动的任务，不会重复发起抓取…':'正在向 Apify 提交一位人物的抓取任务…');
    try{
      const result=await fetchLinkedInProfile(url,{token,signal:controller.signal,...(runId&&runURL===url?{runId}:{}),onProgress:progress=>{if(progress?.runId){runId=progress.runId;runURL=url;$('#linkedin-run-id').value=runId;}status(typeof progress==='string'?progress:progress?.message||'正在获取履历…');}});
      startUncertain=false;renderReview(result);
    }catch(error){if(error.code==='START_UNCERTAIN'||error.name==='AbortError'&&!runId)startUncertain=true;if(error.runId){runId=error.runId;runURL=url;$('#linkedin-run-id').value=runId;}status(error.name==='AbortError'?'已停止等待。远端任务可能继续运行；请在 Apify 控制台检查，或继续读取本次任务。':error.message||'获取失败，请检查服务配置后重试。',true);}
    finally{setBusy(false);controller=null;}
  });
  $('#manual-linkedin-entry').addEventListener('click',()=>{
    try{
      const target=getBaseGraph().nodes.find(n=>n.id===targetId),url=normalizeLinkedInURL($('#linkedin-url').value);
      if(!target||!url)throw Error('请先提供并核对该人物的 LinkedIn 链接。');
      renderReview({name:target.name,linkedin:url,entries:[{type:'phd',sourceSection:'Education'}]});
      status('根据对应人物的 LinkedIn 页面填写履历。');
    }catch(error){status(error.message,true);}
  });
  $('#parse-linkedin-text').addEventListener('click',()=>{
    try{const url=normalizeLinkedInURL($('#linkedin-url').value);if(!url)throw Error('请先提供对应人物的 LinkedIn 链接。');const text=$('#linkedin-text').value.trim();if(!text)throw Error('请粘贴 Education 和 Experience 履历文字。');runId='';runURL='';renderReview(parseLinkedInText(text,{url}));}
    catch(error){status(error.message,true);}
  });
  $('#preview-linkedin').addEventListener('click',async()=>{
    if(!review||busy)return;
    try{
      const name=$('#linkedin-name').value.trim(),choice=$('#linkedin-match').value;if(!name)throw Error('请核对并填写人物姓名。');if(!choice)throw Error('请选择已有档案或新建人物。');
      const entries=[];
      for(const card of dialog.querySelectorAll('[data-history-index]')){
        if(!card.querySelector('[data-history-include]').checked)continue;
        const entry=Object.fromEntries([...card.querySelectorAll('[data-history-field]')].map(el=>[el.dataset.historyField,el.value.trim()]));
        if(!entry.institution)throw Error('请填写每个已选条目的机构，或取消导入该条目。');
        for(const key of ['startDate','endDate'])if(entry[key]&&!normalizeAcademicDate(entry[key]))throw Error('日期请使用 YYYY 或 YYYY-MM；未知日期请留空。');
        if(entry.endDateType==='ongoing'&&entry.endDate)throw Error('至今条目请清空结束日期，或修改结束日期含义。');
        if(entry.startDate&&entry.endDate&&(entry.startDate.slice(0,4)>entry.endDate.slice(0,4)||entry.startDate.length===7&&entry.endDate.length===7&&entry.startDate>entry.endDate))throw Error('结束日期不能早于开始日期。');
        if(entry.currentStatus&&entry.endDateType!=='ongoing'&&!(entry.type==='phd'&&entry.endDateType==='expected'&&entry.endDate))throw Error('请选择“至今”，或为在读博士填写预计毕业日期。');
        entries.push({...entry,ongoing:entry.endDateType==='ongoing',sourceUrl:review.linkedin,retrievedAt:new Date().toISOString().slice(0,10)});
      }
      if(!entries.length)throw Error('请至少选择一条履历。');
      const node=getBaseGraph().nodes.find(n=>n.id===choice);
      const profileMatch=choice==='new'?'new':{nodeId:choice,identity:{name:node?.name||'',linkedin:linkedURL(node)}};
      const parsed={kind:'linkedin',sourceFile:'linkedin-history.json',sheet:'LinkedIn academic history',profileMatch,rows:[{row:2,fields:{A:targetId&&node?node.name:name,R:review.linkedin,academicHistory:JSON.stringify(sanitizeAcademicHistory(entries))}}],warnings:[]};
      dialog.close();await dataManager.openParsed(parsed,{canReturnToLinkedIn:true});
    }catch(error){status(error.message||'请检查履历内容。',true);}
  });
  return{open};
}
