/* Local extraction only: supplied profile text is data, never instructions. */
const MAX_TEXT=200000, MAX_ENTRIES=30;
const clean=value=>String(value??'').replace(/\u0000/g,'').replace(/[\u00a0\u200b]/g,' ').trim();
const norm=value=>clean(value).normalize('NFKC').toLowerCase().replace(/\s+/g,' ');
const institutionPattern=/(?:\b(?:universit(?:y|ies|ät|é)|institut(?:e|ion|o)?|college|polytechnic|school|laborator(?:y|ies)|research cent(?:er|re)|harvard|stanford|princeton|yale|caltech|oxford|cambridge|mit|eth|epfl|jila|mpq|nus|ntu|cnrs|riken)\b|大学|大學|学院|學院|研究所|研究院|实验室|實驗室|研究中心)/i;
const postdocPattern=/(?:\bpost[\s-]?doc(?:toral)?\b|博士[后後])/i;
const phdPattern=/(?:\bph\s*\.?\s*d\.?\b|\bd\.?\s*phil\.?\b|doctor of philosophy|doctorate|博士(?![后後]))/i;
const otherDegreePattern=/(?:\b(?:bachelor|master|b\.?sc|m\.?sc|b\.?s\.?|m\.?s\.?|b\.?eng|m\.?eng|mba|undergraduate)\b|学士|學士|硕士|碩士|本科)/i;
const otherRolePattern=/^(?:assistant|associate|full|visiting)?\s*(?:professor|research scientist|research assistant|research engineer|software engineer|scientist|engineer|intern|lecturer|senior lecturer|faculty|teaching assistant|graduate research assistant|research fellow|research associate|researcher)\b|^(?:教授|副教授|助理教授|讲师|講師|研究助理|研究员|研究員|工程师|工程師)/i;
const narrativePattern=/(?:\b(?:supervis(?:ed|ing|or)|mentor(?:ed|ing)?|advisor|adviser|collaborat(?:ed|ing)|worked with|work with|during my|my phd|his phd|her phd|their phd|our phd)\b|指导|指導|导师|導師|指导博士|指導博士)/i;
const sectionMap=new Map([
  ['education','Education'],['education and training','Education'],['教育经历','Education'],['教育經歷','Education'],['教育背景','Education'],['学历','Education'],['學歷','Education'],['教育','Education'],
  ['experience','Experience'],['work experience','Experience'],['professional experience','Experience'],['工作经历','Experience'],['工作經歷','Experience'],['工作经验','Experience'],['工作經驗','Experience'],['职业经历','Experience'],['職業經歷','Experience'],['经历','Experience'],['經歷','Experience']
]);
const otherSection=/^(?:about|summary|skills|top skills|publications|projects|licenses? (?:&|and) certifications?|certifications?|honors? (?:&|and) awards?|languages|recommendations|interests|volunteering|contact|contact info|个人简介|個人簡介|关于|關於|技能|论文|論文|项目|項目|语言|語言|荣誉|榮譽|联系方式|聯絡資料)$/i;
const navigation=/^(?:home|my network|jobs|messaging|notifications?|me|for business|try premium|linkedin|join now|join linkedin|sign in|sign up|connect|follow|message|more|resources|show all.*|see more|see less|people also viewed|contact info|top skills|page \d+ of \d+|首页|首頁|人脉|人脈|职位|職位|消息|訊息|通知|关注|關注|添加人脉|新增人脈|发消息|發送訊息|更多|联系信息|聯絡資料|显示全部.*|顯示全部.*|展开|展開|收起|登录|登入|注册|註冊)$/i;
const MONTHS={jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,oct:10,nov:11,dec:12};
const monthWord='(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)';
const yearWord='(?:18|19|20|21)\\d{2}';
const dateWord='(?:'+monthWord+'\\.?\\s+'+yearWord+'|'+yearWord+'(?:年\\s*(?:1[0-2]|0?[1-9])月|年|[-/.](?:1[0-2]|0?[1-9])(?=$|[^0-9]))?)';
const ongoingWord='(?:Present|Current|Now|至今|现在|現在|目前|迄今)';
const rangePattern=new RegExp('('+dateWord+')\\s*(?:[–—−~～]|-|\\bto\\b|至|到)\\s*('+dateWord+'|'+ongoingWord+')','i');
const dateOnlyPattern=new RegExp('^\\s*(?:'+dateWord+'|'+ongoingWord+')(?:\\s*[·|()]|\\s*$)','i');

/** Return a canonical public member URL, or an empty string for other URLs. */
export function normalizeLinkedInURL(value){
  const raw=clean(value);if(!raw)return'';
  try{
    const url=new URL(/^https?:\/\//i.test(raw)?raw:'https://'+raw);
    if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.port)return'';
    if(!/^(?:www\.|[a-z]{2,3}\.)?linkedin\.com$/i.test(url.hostname))return'';
    const path=url.pathname.replace(/\/+$/,'');
    if(/^\/in\/[^/?#\s]+$/i.test(path)){
      const slug=path.slice(4);if(!slug||slug.length>200||/%(?:2f|5c|00)/i.test(slug)||slug.includes('\\'))return'';
      return'https://www.linkedin.com/in/'+slug;
    }
    if(/^\/pub\/[^/?#\s]+\/[a-z0-9-]+\/[a-z0-9-]+\/[a-z0-9-]+$/i.test(path)&&!/%(?:2f|5c|00)/i.test(path))return'https://www.linkedin.com'+path;
    return'';
  }catch{return'';}
}
function normalDate(value){
  const raw=clean(value),year=raw.match(/\b((?:18|19|20|21)\d{2})\b/);if(!year)return'';
  const word=raw.match(new RegExp('^('+monthWord+')','i'));
  const numeric=raw.match(/(?:18|19|20|21)\d{2}(?:年\s*|[-/.])(1[0-2]|0?[1-9])(?:月|$)/);
  const month=word?MONTHS[word[1].slice(0,3).toLowerCase()]:numeric?Number(numeric[1]):0;
  return year[1]+(month?'-'+String(month).padStart(2,'0'):'');
}
function datesIn(value){
  const raw=clean(value),range=raw.match(rangePattern);
  if(range){
    const ongoing=new RegExp('^'+ongoingWord+'$','i').test(range[2]);
    const startDate=normalDate(range[1]),endDate=ongoing?'':normalDate(range[2]);
    if(endDate&&(startDate.slice(0,4)>endDate.slice(0,4)||(startDate.length===7&&endDate.length===7&&startDate>endDate)))return{invalid:true};
    const expected=/\bexpected|anticipated|预计|預計|预期|預期/i.test(raw);
    return{startDate,endDate,ongoing,endDateType:ongoing?'ongoing':expected?'expected':'unspecified'};
  }
  const graduated=raw.match(new RegExp('(?:graduat(?:ed|ion)|completed|毕业|畢業)\\s*(?:in|:|：)?\\s*('+dateWord+')','i'));
  if(graduated&&!/expected|anticipated|预计|預計|预期|預期/i.test(raw))return{startDate:'',endDate:normalDate(graduated[1]),ongoing:false,endDateType:'actual'};
  const expected=raw.match(new RegExp('(?:expected|anticipated|预计|預計|预期|預期)(?:\\s+graduation)?\\s*(?:in|:|：)?\\s*('+dateWord+')','i'));
  if(expected)return{startDate:'',endDate:normalDate(expected[1]),ongoing:false,endDateType:'expected'};
  return null;
}
function sectionHeader(value){return sectionMap.get(norm(value).replace(/[:：]$/,''))||null;}
function kindOfTitle(value,section,hasEducation){
  const raw=clean(value);
  if(raw.length>220||narrativePattern.test(raw))return'';
  if(postdocPattern.test(raw)&&!/[.!?。！？]\s+\S/.test(raw))return'postdoc';
  if(phdPattern.test(raw)&&!postdocPattern.test(raw)&&!['Experience','Other'].includes(section)){
    if(/\b(?:seeking|hiring|recruiting|students? wanted|position|opportunit|requirement)\b|招聘|招收|岗位|崗位/i.test(raw))return'';
    if(section==='Education'||!hasEducation)return'phd';
  }
  return'';
}
function isBoundary(value){
  return otherDegreePattern.test(value)||otherRolePattern.test(value)||Boolean(sectionHeader(value))||otherSection.test(value);
}
function isInstitution(value){return institutionPattern.test(value)&&!phdPattern.test(value)&&!postdocPattern.test(value)&&!narrativePattern.test(value);}
function institutionText(value){
  return clean(value).replace(/\s*[·|]\s*(?:Full[- ]time|Part[- ]time|Contract|Internship|Temporary|Freelance|Self[- ]employed|全职|全職|兼职|兼職)(?:\s*[·|].*)?$/i,'').replace(/\s+logo$/i,'').slice(0,250);
}
function isNoise(value){
  return !value||navigation.test(value)||dateOnlyPattern.test(value)||rangePattern.test(value)||/^\d+\s*(?:yrs?|years?|mos?|months?|年|个月|個月)(?:\s+\d+\s*(?:mos?|months?|个月|個月))?$/i.test(value)||/^\d*(?:st|nd|rd|th)?\s*(?:degree connection|connections?|followers?)|^[·•]/i.test(value)||/^(?:Activities and societies|Grade|Skills|技能|成绩|成績|社团活动|社團活動)\s*[:：]/i.test(value)||/@|https?:\/\//i.test(value);
}
function extractName(lines,supplied){
  const explicit=clean(supplied).slice(0,120);if(explicit&&!/@|https?:\/\//i.test(explicit))return explicit;
  for(const item of lines.slice(0,45)){
    const value=item.text.replace(/\s*\|\s*LinkedIn\s*$/i,'').replace(/,?\s+(?:Ph\.?\s*D\.?|博士)\s*$/i,'').trim();
    if(sectionHeader(value)||otherSection.test(value))break;
    if(value.length<2||value.length>85||isNoise(value)||institutionPattern.test(value)||phdPattern.test(value)||postdocPattern.test(value)||otherRolePattern.test(value)||/\b(?:research|engineer|scientist|professor|student|candidate|fellow|premium|search|notifications|connection|subscribe|sign in|join linkedin)\b|研究|博士|通知|搜索|登入|登录|加入领英|加入領英/i.test(value)||/[0-9@<>:：/\\]/.test(value))continue;
    if(/^[\p{L}\p{M}.'’\- ]+$/u.test(value)&&value.split(/\s+/).length<=8)return value;
  }
  return'';
}
function evidenceText(institution,title,dateLine){
  return[institution,title,dateLine].filter(Boolean).map(value=>clean(value).replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi,'[excluded]')).join(' · ').slice(0,1000);
}

/** Extract PhD education and postdoctoral appointments from supplied visible text. */
export function parseLinkedInText(value,{url='',name=''}={}){
  const raw=String(value??'');if(raw.length>MAX_TEXT)throw Error('履历文字超过 200,000 字符，请只粘贴 Education 和 Experience 相关内容。');
  const linkedin=normalizeLinkedInURL(url);if(clean(url)&&!linkedin)throw Error('请输入有效的 LinkedIn 人物主页链接（/in/ 或 /pub/）。');
  let section='';const lines=[];
  for(const source of raw.replace(/\r\n?/g,'\n').split('\n')){
    const text=clean(source).replace(/[\t ]+/g,' ');if(!text)continue;
    const heading=sectionHeader(text);if(heading)section=heading;else if(otherSection.test(text))section='Other';
    // LinkedIn's accessible page text often repeats each visible field twice.
    if(lines.at(-1)?.text===text&&lines.at(-1)?.section===section)continue;
    lines.push({text,section,heading:Boolean(heading)||otherSection.test(text)});
  }
  const hasEducation=lines.some(line=>line.section==='Education'),warnings=[],entries=[],seen=new Set();
  const anchors=lines.map((line,index)=>({index,type:kindOfTitle(line.text,line.section,hasEducation)})).filter(a=>a.type);
  for(const anchor of anchors){
    const at=anchor.index,line=lines[at],sourceSection=line.section==='Education'?'Education':anchor.type==='postdoc'?'Experience':'Education';
    if(line.section==='Other')continue;
    let previous=at-1,next=at+1;
    while(previous>=0&&at-previous<=6&&!lines[previous].heading&&!kindOfTitle(lines[previous].text,lines[previous].section,hasEducation)&&!isBoundary(lines[previous].text))previous--;
    previous++;
    while(next<lines.length&&next-at<=8&&!lines[next].heading&&!kindOfTitle(lines[next].text,lines[next].section,hasEducation)&&!isBoundary(lines[next].text))next++;
    const before=lines.slice(previous,at).map((l,i)=>({text:l.text,index:previous+i})).reverse();
    const after=lines.slice(at+1,next).map((l,i)=>({text:l.text,index:at+1+i}));
    const beforeCurrentBlock=[];
    for(const candidate of before){if(datesIn(candidate.text)||dateOnlyPattern.test(candidate.text))break;beforeCurrentBlock.push(candidate);}
    const strongBefore=beforeCurrentBlock.find(x=>isInstitution(x.text));
    const strongAfter=after.find(x=>isInstitution(x.text));
    const institutionCandidate=strongBefore||strongAfter;
    // Require an explicit organization; generic field-of-study lines are not schools.
    const institution=institutionCandidate?institutionText(institutionCandidate.text):'';
    if(!institution)warnings.push('“'+line.text.slice(0,90)+'”未能定位明确机构，请在核对时补填。');
    let date=null,dateLine='';
    const own=datesIn(line.text);if(own){date=own;dateLine=line.text;}
    if(!date){
      for(const candidate of after){
        if(isInstitution(candidate.text)&&candidate.index!==institutionCandidate?.index)break;
        const found=datesIn(candidate.text);if(found){date=found;dateLine=candidate.text;break;}
      }
    }
    if(date?.invalid){warnings.push('“'+line.text.slice(0,90)+'”的起止日期顺序无效，日期已留空待核对。');date=null;}
    if(!date)warnings.push('“'+line.text.slice(0,90)+'”缺少明确起止日期，未推测日期。');
    const entry={type:anchor.type,institution,title:line.text.slice(0,250),startDate:date?.startDate||'',endDate:date?.endDate||'',ongoing:Boolean(date?.ongoing),endDateType:date?.endDateType||'unspecified',sourceSection,evidence:evidenceText(institution,line.text,dateLine===line.text?'':dateLine)};
    const key=JSON.stringify([entry.type,norm(entry.institution),norm(entry.title),entry.startDate,entry.endDate,entry.ongoing]);
    if(!seen.has(key)){seen.add(key);entries.push(entry);}
    if(entries.length>=MAX_ENTRIES){warnings.push('最多提取 30 段经历，后续内容未纳入。');break;}
  }
  if(!entries.length)warnings.push('未识别到明确的博士学位或博后任职。请粘贴 Education 和 Experience 的完整条目。');
  const resolvedName=extractName(lines,name);if(!resolvedName)warnings.push('未能可靠识别姓名，请手动补填。');
  return{name:resolvedName,linkedin,entries,warnings:[...new Set(warnings)]};
}
