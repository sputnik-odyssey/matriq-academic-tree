// Public, source-based career display. Recruitment Position/Notes/Progress fields are never read.
const EMPTY=/^(?:\s*|\/|none|null|n\/?a|not\s+(?:provided|available|specified)|unknown|undefined|-|—|待确认|未知|不详)$/i;
const text=value=>value==null?'':String(value).trim();
const clean=value=>EMPTY.test(text(value))?'':text(value);
const normal=value=>clean(value).normalize('NFKC').toLowerCase().replace(/[._–—−]/g,' ').replace(/\s+/g,' ').trim();
const labels={university:'University',research_institute:'Research institute',company:'Company',unknown:'Not provided'};
const statusLabels={phd_student:'PhD Student',phd_candidate:'PhD Candidate',faculty:'Faculty',postdoc:'Postdoc',industry:'Industry',other:'Other',unknown:'Not provided'};

const UNIVERSITY_ALIASES=new Set([
  'mit','massachusetts institute of technology','caltech','cal tech','california institute of technology','harvard','stanford','princeton','columbia','yale','berkeley','uc berkeley','u chicago','uchicago','rice','rice u','duke','oxford','cambridge','tum','tu munich','tu berlin','tu vienna','eth','eth zurich','epfl','epfl lausanne','pku','thu','ustc','hkust','hku','cuhk','sjtu','nus','ntu','ucas','ucla','ucsb','uc sb','ucsd','uci','umd','uiuc','jhu','nyu','cmu','rpi','gatech','git','sust','zju','bjtu','uoft','uw madison','uw seattle','uw stlouis','u michigan','u washington','u minnesota','uminnesota','u north texas','usydney','shanxiu','polyu','rochester','edinburgh','waterloo','innsbruck','heidelberg','tübingen','tubingen','boston university'
]);
const COMPANY_PATTERNS=[
  /\b(?:incorporated|inc|corp(?:oration)?|ltd|limited|llc|gmbh|oy|sarl)\b/i,
  /\b(?:quera|atom computing|oratomic|google(?: quantum ai)?|alphabet|apple|microsoft|amazon|aws|nvidia|meta(?: reality labs)?|facebook|deepmind|openai|ibm|ionq|quantinuum|psiquantum|pasqal|planqc|infleqtion|nanoq?t|nanofiber quantum technologies|atomqubic|pexmachina|cavilinq|logiqal|q[ -]?ctrl|q[ -]?cat|qtek laser|imra optics|imra america|applied materials|amat|hyperlight|leap photonics|unitary foundation|vescent|asml|tera(?:diode)?|aosense|ao sense|keysight|quantum machines|q magnetics|quantumbay|mesa quantum|qubitcore|lightelligence|intel|kla|samsung semiconductor|cisco|huawei|bytedance|deloitte|humana|aeva|merco?r|keyrus|pixocial|periodic labs|jancsitech|undermind|lighteningagi|bASF|continental|nokia|toptica|imra|sd t|sdt)\b/i,
  /\b(?:jane street|citadel|radix trading|cubist systematic strategies|jump(?: trading)?|deshaw|d e shaw|millennium|ruitian investment|m[ck]\s*kinsey|fintech)\b/i,
  /(?:华大基因|中金公司|巨擎科技|知跃空间智能|树莓工作室|英伟达|字节跳动|华为|腾讯|阿里巴巴)/u
];
const RESEARCH_PATTERN=/(?:研究所|实验室|研究院|研究中心|Academ(?:ia|ic) Sinica|Argonne|Brookhaven|Sandia|Fermilab|Perimeter Institute|Max[ -]Planck|National (?:Metrology|Research)|Danish National Metrology|Chinese Academy of Sciences|Kavli Institute|Quantum (?:Science Center|Innovation Center|Academy)|International Quantum Academy|Quantum Information Sciences|Institute of (?:Physics|Theoretical Physics)|^JILA$|^MPQ$|^NIST(?:\/|$)|^JQI(?:\/|$)|^QuICS$|^IQOQI\b|^CQT\b|^QSC@|^A[ *-]?STAR\b|^KEK\b|NASA|Naval Research|Army Research|Lincoln Laborator|Tyndall National Institute|Institut d.Optique|^CNRS\b|^Flatiron$|Waterloo Perimeter|中科院)/i;
const GENERIC_AFFILIATION=/^(?:ph\.?d\.?\s*(?:student|candidate)?|doctoral\s*(?:student|candidate)|graduate student|faculty|postdoc|industry|company|corporation|fintech|finance|quant|government)$/i;
const JOB_TITLE_PATTERN=/(?:\b(?:engineer|scientist|researcher|physicist|developer|architect|manager|director|president|founder|co[ -]?founder|cto|ceo|cso|chief|lead|consultant|technical staff|technical owner|technology owner|product owner|staff|syndicate|quantitative|quant)\b|工程师|科学家|研究员|总监|经理|创始人|首席|技术负责人)/i;
const GENERIC_ROLE=/^(?:company|corporation|industry|industrial|fintech|finance|government|quant|student|graduate student|phd|ph d|faculty|other|research|academic)$/i;

function sourceValue(node,field){
  for(const record of node.records||[]){const value=clean(record?.fields?.[field]);if(value)return{value,source:`Mapping!${field}${record.row??''}`};}
  return{value:'',source:''};
}

function explicitStatus(value){
  const valueNorm=normal(value).replace(/[-/]/g,' ').replace(/_/g,' ');
  if(/^(?:phd|ph d|doctoral|doctorate) candidate$/.test(valueNorm)||/博士候选人|博士候選人|博士候选生|博士候選生/.test(valueNorm))return'phd_candidate';
  if(/^(?:phd|ph d|doctoral|doctorate) student$/.test(valueNorm)||/^(?:博士生|博士研究生|在读博士|在讀博士)$/.test(valueNorm))return'phd_student';
  if(/^(?:postdoc|post doc|postdoctoral|postdoctoral fellow|postdoctoral researcher|postdoctoral research associate|post doctoral fellow)$/.test(valueNorm)||/博士后|博士後/.test(valueNorm))return'postdoc';
  if(/^(?:faculty|academic staff|professor|assistant professor|associate professor|full professor|emeritus professor|professor emeritus|lecturer|senior lecturer|reader|instructor)$/.test(valueNorm)||/^(?:教授|副教授|助理教授|讲师|講師|教员|教員)$/.test(valueNorm))return'faculty';
  if(/^(?:industry|industrial|company|corporation|corporate|fintech|finance)$/.test(valueNorm))return'industry';
  if(valueNorm==='other')return'other';
  if(valueNorm==='unknown')return'unknown';
  return'';
}

function explicitAffiliationType(value){
  const type=normal(value).replace(/[_-]/g,' ');
  if(/^(?:university|college|higher education|higher education institution|academic institution|高校|大学|大學)$/.test(type))return'university';
  if(/^(?:research institute|research institution|research center|research centre|national lab|national laboratory|laboratory|institute|研究所|研究院|科研机构|科研機構)$/.test(type))return'research_institute';
  if(/^(?:company|corporation|corporate|industry|industrial|business|企业|企業|公司)$/.test(type))return'company';
  if(type==='unknown')return'unknown';
  return'';
}

function inferAffiliationType(affiliation){
  if(!affiliation||GENERIC_AFFILIATION.test(affiliation))return'unknown';
  const n=normal(affiliation).replace(/[,，].*$/,'').replace(/\(.*\)$/,'').trim();
  if(UNIVERSITY_ALIASES.has(n)||/\b(?:university|universität|universitaet|université|universita|college|polytechnic|school of|institute of technology)\b/i.test(affiliation)||/(?:大学|大學|学院|學院)/u.test(affiliation))return'university';
  if(RESEARCH_PATTERN.test(affiliation))return'research_institute';
  if(COMPANY_PATTERNS.some(pattern=>pattern.test(affiliation)))return'company';
  return'unknown';
}

function normaliseExpected(raw){
  if(raw instanceof Date)return Number.isNaN(raw.valueOf())?'':raw.toISOString().slice(0,10);
  let value=clean(raw);if(!value)return'';
  const chinese=value.match(/^((?:19|20)\d{2})年(?:(\d{1,2})月)?(?:(\d{1,2})日)?$/);
  if(chinese)value=[chinese[1],chinese[2]?.padStart(2,'0'),chinese[3]?.padStart(2,'0')].filter(Boolean).join('-');
  const iso=value.match(/^((?:19|20)\d{2})(?:[-/.](\d{1,2})(?:[-/.](\d{1,2}))?)?$/);
  if(iso){
    const year=Number(iso[1]),month=Number(iso[2]||1),day=Number(iso[3]||1),date=new Date(Date.UTC(year,month-1,day));
    if(date.getUTCFullYear()!==year||date.getUTCMonth()!==month-1||date.getUTCDate()!==day)return'';
    return[iso[1],iso[2]?.padStart(2,'0'),iso[3]?.padStart(2,'0')].filter(Boolean).join('-');
  }
  // Preserve explicitly supplied precision such as "Spring 2028"; do not invent a month or day.
  return /\b(?:19|20)\d{2}\b/.test(value)?value:'';
}

function degreeExpected(phd){
  if(!/(?:\bph\.?\s*d\.?\b|\bdphil\b|\bdoctoral\b|\bdoctorate\b|博士)/i.test(phd))return'';
  const range=phd.match(/((?:19|20)\d{2}(?:[-/.]\d{1,2}(?:[-/.]\d{1,2})?)?)\s*(?:[–—−]|-(?=\s*(?:19|20)\d{2})|\bto\b|至)\s*((?:19|20)\d{2}(?:[-/.]\d{1,2}(?:[-/.]\d{1,2})?)?)/i);
  if(!range)return'';
  const start=normaliseExpected(range[1]),end=normaliseExpected(range[2]);
  return start&&end&&Number(end.slice(0,4))>=Number(start.slice(0,4))?end:'';
}

function degreeInstitution(phd){
  const parts=phd.split(/[,，]/).map(part=>part.trim());
  return parts.length>=3&&degreeExpected(parts.slice(0,2).join(', '))?parts.slice(2).join(', '):'';
}

function expectedIsPast(value,asOf){
  const iso=value.match(/^((?:19|20)\d{2})(?:-(\d{2})(?:-(\d{2}))?)?$/);
  if(iso){
    const year=Number(iso[1]),month=Number(iso[2]||12);
    const end=iso[3]?Date.UTC(year,month-1,Number(iso[3]),23,59,59):Date.UTC(year,month,0,23,59,59);
    const current=Date.parse(`${String(asOf).slice(0,10)}T00:00:00Z`);
    return Number.isFinite(current)&&end<current;
  }
  const year=value.match(/\b((?:19|20)\d{2})\b/);
  return year?Number(year[1])<Number(String(asOf).slice(0,4)):false;
}

function expectedValue(node){
  for(const key of ['expectedGraduation','expectedGraduationDate','expectedGraduationYear'])if(clean(node[key]))return{raw:node[key],source:`node.${key}`};
  for(const key of ['Expected Graduation','ExpectedGraduation','expected_graduation','Expected Graduation Date','预计毕业时间','预计毕业日期','预计毕业年份']){
    const found=sourceValue(node,key);if(found.value)return{raw:found.value,source:found.source};
  }
  return{raw:'',source:''};
}

export function enrichPerson(node,{asOf='2026-11-11'}={}){
  const profileNotes=[];
  const affiliationRecord=sourceValue(node,'G'),roleRecord=sourceValue(node,'H'),phdRecord=sourceValue(node,'C');
  const affiliation=clean(node.affiliation)||clean(node.currentAffiliation)||affiliationRecord.value;
  const role=clean(node.role)||roleRecord.value;
  const phd=clean(node.phd)||phdRecord.value;
  const person=node.entityType==='person'||(!node.entityType&&(!node.kind||node.kind==='person'));
  const suppliedAffiliationType=explicitAffiliationType(node.affiliationType||node.affiliation_type||node.organizationType);
  const roleAffiliationType=explicitAffiliationType(role);
  const inferredAffiliationType=inferAffiliationType(affiliation);
  let affiliationType=suppliedAffiliationType||roleAffiliationType||inferredAffiliationType;
  const directStatus=explicitStatus(node.academicStatus||node.academic_status||node.careerStatus);
  let academicStatus=directStatus||explicitStatus(role);
  const roleNorm=normal(role);
  if(!academicStatus&&/^(?:graduate student|grad student|doctoral researcher|doctoral research student)$/.test(roleNorm)){
    academicStatus=degreeExpected(phd)||/\b(?:phd|ph d|doctoral|doctorate)\b|博士/i.test(role)?'phd_student':'other';
  }
  if(!academicStatus&&affiliationType==='company')academicStatus='industry';
  if(!academicStatus)academicStatus=role?'other':'unknown';
  if(academicStatus==='industry'&&affiliationType==='unknown'&&!suppliedAffiliationType)affiliationType='company';
  if(!person)academicStatus='other';

  let jobTitle=clean(node.jobTitle)||clean(node.job_title)||clean(node.currentJobTitle);
  let jobTitleSource=jobTitle?'explicit':'';
  if(!jobTitle&&role&&JOB_TITLE_PATTERN.test(role)&&!GENERIC_ROLE.test(role)&&!['phd_student','phd_candidate','postdoc'].includes(academicStatus)){
    jobTitle=role;jobTitleSource='affiliation_type_record';
  }
  // Faculty is the display classification, while an explicit rank remains available as a title.
  if(!jobTitle&&academicStatus==='faculty'&&role&&!/^faculty$/i.test(role)){jobTitle=role;jobTitleSource='affiliation_type_record';}
  const isDoctoral=person&&['phd_student','phd_candidate'].includes(academicStatus);
  let expectedGraduation='',expectedGraduationSource='',expectedGraduationSourceDetail='';
  const explicitExpected=expectedValue(node);
  if(isDoctoral){
    if(explicitExpected.raw){
      expectedGraduation=normaliseExpected(explicitExpected.raw);
      if(expectedGraduation){expectedGraduationSource='explicit';expectedGraduationSourceDetail=explicitExpected.source;}
      else profileNotes.push('The supplied expected graduation value does not specify a valid date or year.');
    }
    if(!expectedGraduation){
      expectedGraduation=degreeExpected(phd);
      if(expectedGraduation){expectedGraduationSource='degree_range';expectedGraduationSourceDetail=clean(node.phd)?'node.phd':phdRecord.source;}
    }
  }
  const graduationNeedsUpdate=Boolean(expectedGraduation&&expectedIsPast(expectedGraduation,asOf));
  if(graduationNeedsUpdate)profileNotes.push('The recorded expected graduation date is in the past; current status needs confirmation.');
  const expectedGraduationLabel=expectedGraduation?`Expected graduation: ${expectedGraduation}${expectedGraduationSource==='degree_range'?' (from PhD record)':''}${graduationNeedsUpdate?' · update needed':''}`:'Not provided';
  let displayAffiliation=affiliation||'Not provided';
  let displayAffiliationSource=affiliation?(clean(node.affiliation)||clean(node.currentAffiliation)?'explicit':affiliationRecord.source):'';
  if(affiliation&&GENERIC_AFFILIATION.test(affiliation)){
    displayAffiliation='Not provided';profileNotes.push('The source affiliation field contains a role or industry category rather than an institution name.');
  }
  if(isDoctoral&&displayAffiliation==='Not provided'){
    const degreeAffiliation=degreeInstitution(phd);
    if(degreeAffiliation){displayAffiliation=degreeAffiliation;displayAffiliationSource='degree_record';if(affiliationType==='unknown')affiliationType=inferAffiliationType(degreeAffiliation);}
  }
  let statusLabel=statusLabels[academicStatus];
  if(academicStatus==='other'&&role)statusLabel=role;
  if(!person)statusLabel=node.entityType==='institution'||node.kind==='organization'?'Organization':node.entityType==='group'||node.kind==='group'?'Research group':node.entityType==='publication'||node.kind==='publication'?'Publication':'Other';
  const displayRole=academicStatus==='industry'?(jobTitle||'Job title not provided'):academicStatus==='faculty'?'Faculty':statusLabel==='Not provided'?'Role not provided':statusLabel;
  return{
    ...node,
    affiliationType:affiliationType||'unknown',
    affiliationTypeLabel:labels[affiliationType]||labels.unknown,
    affiliationTypeSource:suppliedAffiliationType?'explicit':roleAffiliationType?'source_role':inferredAffiliationType!=='unknown'?'affiliation_name':displayAffiliationSource==='degree_record'&&affiliationType!=='unknown'?'degree_record':academicStatus==='industry'?'source_role':'unknown',
    academicStatus,statusLabel,jobTitle,jobTitleSource,
    expectedGraduation,expectedGraduationLabel,expectedGraduationSource,expectedGraduationSourceDetail,
    expectedGraduationRelevant:isDoctoral,graduationNeedsUpdate,
    displayAffiliation,displayAffiliationSource,displayRole,profileNotes
  };
}

export function enrichPeople(nodes,options){return nodes.map(node=>enrichPerson(node,options));}
