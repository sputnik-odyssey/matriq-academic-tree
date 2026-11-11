/* Local-only structured-file import. Uploaded text is data, never executable instructions. */
import {normalizeMappingEdges} from './mentorship.mjs?v=paper-collaboration-20261111';
import {sanitizePaper,sanitizePaperDocument,previewPaperImport,rebuildPaperGraph} from './paper-importer.mjs?v=paper-collaboration-20261111';
export const PUBLIC_COLUMNS=Object.freeze([
  {key:'A',label:'Legal Name'},{key:'B',label:'中文名'},{key:'C',label:'PhD'},
  {key:'D',label:'Bachelor location'},{key:'E',label:'Bachelor'},
  {key:'G',label:'CurrentAffiliation'},{key:'H',label:'AffiliationType'},{key:'I',label:'Location'},
  {key:'N',label:'Research Line'},{key:'O',label:'Industry Line'},
  {key:'P',label:'Website'},{key:'Q',label:'ORCID'},{key:'R',label:'LinkedIn'},
  {key:'T',label:'Scholar'},{key:'U',label:'Citation Count'},{key:'V',label:'Paper'},
  {key:'W',label:'Paper Citation Count'},{key:'X',label:'Year Cited'},{key:'AB',label:'Source'},
  {key:'affiliationType',label:'Affiliation Type'},{key:'academicStatus',label:'Academic Status'},
  {key:'jobTitle',label:'Job Title'},{key:'expectedGraduation',label:'Expected Graduation'}
]);
const PUBLIC_KEYS=new Set(PUBLIC_COLUMNS.map(c=>c.key));
const MAX_FILE=20*1024*1024,MAX_XML=64*1024*1024,MAX_ROWS=100000,MAX_COLUMNS=512,MAX_CELL=40000;
const MISSING=new Set(['','/','-','—','none','null','n/a','na','pending','connected','unknown','待确认','待核']);
const EDGE_TYPES=[{id:'phd',label:'PhD 指导',color:'#ff8a80'},{id:'postdoc',label:'Postdoc 指导',color:'#ffb74d'},{id:'institution',label:'未分类机构关联',color:'#7196b4'}];
const norm=value=>String(value??'').normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
const useful=value=>!MISSING.has(String(value??'').trim().toLowerCase());
const text=value=>String(value??'').replace(/\u0000/g,'').trim().slice(0,MAX_CELL);
const basename=value=>text(value).split(/[\\/]/).pop().slice(0,200)||'uploaded-document';
const clone=value=>JSON.parse(JSON.stringify(value));
const columnName=index=>{let value=index+1,name='';while(value){value--;name=String.fromCharCode(65+value%26)+name;value=Math.floor(value/26);}return name;};
const colIndex=value=>{let index=0;for(const c of value)index=index*26+c.charCodeAt(0)-64;return index-1;};
const nameOf=fields=>useful(fields.A)?fields.A:useful(fields.B)?fields.B:'';

function hash(value){let a=2166136261,b=2246822519;for(let i=0;i<value.length;i++){a=Math.imul(a^value.charCodeAt(i),16777619);b=Math.imul(b^value.charCodeAt(i),3266489917);}return(a>>>0).toString(16).padStart(8,'0')+(b>>>0).toString(16).padStart(8,'0');}
function stableJSON(value){return JSON.stringify(Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b))));}
function cleanedFields(fields){return Object.fromEntries(Object.entries(fields||{}).filter(([key,value])=>PUBLIC_KEYS.has(key)&&useful(value)).map(([key,value])=>[key,text(value)]));}
function sanitiseFields(fields){
  const result={};
  for(const [key,value] of Object.entries(fields||{}))if(PUBLIC_KEYS.has(key)&&value!==null&&value!==undefined){
    const str=text(value);if(str&&!((key==='N'||key==='O')&&!useful(str)))result[key]=str;
  }
  return result;
}

const HEADER_ALIASES=new Map();
for(const c of PUBLIC_COLUMNS)HEADER_ALIASES.set(norm(c.label),c.key);
for(const [key,names] of Object.entries({
  A:['Name','Full Name','Person Name','LegalName','英文名','姓名'],B:['Chinese Name','ChineseName'],
  C:['PhD Education','Doctoral Degree','Doctorate'],D:['Bachelor Country'],E:['Undergraduate','Bachelor Degree'],
  G:['Current Affiliation','Affiliation','Institution','Company','Current Institution'],
  H:['AffiliationType','Role','Current Role'],I:['Country','Country Region','Country/Region'],
  N:['ResearchLine','Research Relations'],O:['IndustryLine','Subsequent Relations'],P:['Homepage','Personal Website'],
  Q:['ORCID ID'],R:['Linkedin URL'],T:['Google Scholar','Scholar URL'],V:['Publication','Paper Title'],
  W:['Paper Citations','Publication Citation Count'],X:['Publication Year'],AB:['Data Source'],
  affiliationType:['Institution Type','Organization Type','Organisation Type','Public Affiliation Type'],
  academicStatus:['AcademicStatus','Student Status','PhD Status','Career Status'],
  jobTitle:['JobTitle','Employment Title','Current Job Title','Actual Job Title'],
  expectedGraduation:['ExpectedGraduation','Expected Graduation Date','Expected Graduation Year','Anticipated Graduation','预计毕业时间','预计毕业日期','预计毕业年份']
}))for(const name of names)HEADER_ALIASES.set(norm(name),key);

function headerKeys(headers){
  const seen=new Map();return headers.map((header,index)=>{
    const raw=text(header),n=norm(raw);if(!n)return null;
    if(/^affiliation\s+type$/i.test(raw))return'affiliationType';
    if(['citationcount','引用数','引用次数'].includes(n)){const times=seen.get('citationcount')||0;seen.set('citationcount',times+1);return times===0?'U':times===1?'W':null;}
    // Letter keys are supported in JSON field objects; spreadsheet headers must be named.
    return HEADER_ALIASES.get(n)||null;
  });
}

function rowsFromMatrix(matrix,{sourceFile,sheet,warnings=[],date1904=false}){
  if(!matrix.length)throw Error('The document is empty.');
  const headerAt=matrix.findIndex(r=>r.values.some(v=>['legalname','fullname','personname','name','英文名','姓名','中文名'].includes(norm(v))));
  if(headerAt<0||headerAt>25)throw Error('A named header row is required (for example Legal Name, CurrentAffiliation and PhD).');
  const keys=headerKeys(matrix[headerAt].values);
  if(!keys.includes('A')&&!keys.includes('B'))throw Error('The document must include a Legal Name or Chinese Name column.');
  const ignored=matrix[headerAt].values.filter((value,i)=>text(value)&&!keys[i]).length;
  if(ignored)warnings.push(`${ignored} unrecognised or non-public columns were excluded.`);
  const duplicateKeys=keys.filter((key,i)=>key&&keys.indexOf(key)!==i);
  if(duplicateKeys.length)warnings.push('Duplicate public headers were found; the first populated value in each row is used.');
  const rows=[];
  for(const source of matrix.slice(headerAt+1)){
    const fields={};
    source.values.forEach((value,index)=>{const key=keys[index];if(key&&text(value)&&!useful(fields[key])){
      let str=text(value);
      if(key==='expectedGraduation'&&/^\d+(?:\.\d+)?$/.test(str)&&Number(str)>9999){
        if(source.numericColumns?.has(index)&&Number(str)>=20000&&Number(str)<=100000)str=new Date((date1904?Date.UTC(1904,0,1):Date.UTC(1899,11,30))+Math.floor(Number(str))*86400000).toISOString().slice(0,10);
        else{warnings.push(`Row ${source.row}: an invalid numeric expected-graduation value was excluded. Use a four-digit year or an ISO date.`);str='';}
      }
      fields[key]=str;
    }});
    if(Object.keys(fields).length)rows.push({row:source.row,fields:sanitiseFields(fields)});
    if(rows.length>MAX_ROWS)throw Error(`The document exceeds the ${MAX_ROWS.toLocaleString()} row limit.`);
  }
  return{sourceFile,sheet,rows,warnings};
}

export function parseDelimited(value,delimiter){
  value=String(value).replace(/^\uFEFF/,'');
  if(!delimiter){const line=value.split(/\r?\n/,1)[0]||'';delimiter=(line.match(/\t/g)||[]).length>(line.match(/,/g)||[]).length?'\t':',';}
  const rows=[],row=[];let cell='',quoted=false,atStart=true;
  for(let i=0;i<value.length;i++){
    const c=value[i];
    if(quoted){if(c==='"'){if(value[i+1]==='"'){cell+='"';i++;}else quoted=false;}else cell+=c;}
    else if(c==='"'&&atStart){quoted=true;atStart=false;}
    else if(c===delimiter){row.push(cell);cell='';atStart=true;if(row.length>MAX_COLUMNS)throw Error('Too many columns.');}
    else if(c==='\n'||c==='\r'){if(c==='\r'&&value[i+1]==='\n')i++;row.push(cell);rows.push(row.splice(0));cell='';atStart=true;if(rows.length>MAX_ROWS+26)throw Error('Too many rows.');}
    else{cell+=c;atStart=false;}
    if(cell.length>MAX_CELL)throw Error(`A cell exceeds the ${MAX_CELL.toLocaleString()} character limit.`);
  }
  if(quoted)throw Error('CSV contains an unclosed quoted field.');
  if(cell||row.length){row.push(cell);rows.push(row);}
  return rows;
}

function xml(textValue){
  if(/<!DOCTYPE|<!ENTITY/i.test(textValue))throw Error('XML entities and document types are not supported.');
  if(typeof DOMParser==='undefined')throw Error('This browser cannot read Excel XML. Please use CSV or JSON.');
  const doc=new DOMParser().parseFromString(textValue,'application/xml');
  if(doc.getElementsByTagName('parsererror').length)throw Error('The Excel document contains invalid XML.');
  return doc;
}
const elements=(node,name)=>[...node.getElementsByTagNameNS('*',name)];
const firstText=(node,name)=>elements(node,name)[0]?.textContent||'';

async function readZip(buffer){
  const bytes=new Uint8Array(buffer),view=new DataView(buffer);let eocd=-1;
  for(let i=bytes.length-22;i>=Math.max(0,bytes.length-65557);i--)if(view.getUint32(i,true)===0x06054b50){eocd=i;break;}
  if(eocd<0)throw Error('This is not a supported .xlsx ZIP file.');
  const disks=view.getUint16(eocd+4,true),entries=view.getUint16(eocd+10,true),centralSize=view.getUint32(eocd+12,true),centralOffset=view.getUint32(eocd+16,true);
  if(disks||entries===65535||entries>2000||centralOffset+centralSize>bytes.length)throw Error('Multi-volume, ZIP64 or oversized Excel archives are not supported.');
  const files=new Map();let p=centralOffset,totalSize=0;
  for(let i=0;i<entries;i++){
    if(p+46>bytes.length||view.getUint32(p,true)!==0x02014b50)throw Error('Invalid ZIP directory.');
    const flags=view.getUint16(p+8,true),method=view.getUint16(p+10,true),size=view.getUint32(p+24,true),compressed=view.getUint32(p+20,true),nameLength=view.getUint16(p+28,true),extra=view.getUint16(p+30,true),comment=view.getUint16(p+32,true),offset=view.getUint32(p+42,true);
    if(p+46+nameLength+extra+comment>bytes.length)throw Error('Invalid ZIP entry bounds.');
    const name=new TextDecoder().decode(bytes.subarray(p+46,p+46+nameLength));
    if(flags&1)throw Error('Password-protected Excel files are not supported.');
    if(!name.includes('..')&&!name.startsWith('/')&&(name.endsWith('.xml')||name.endsWith('.rels')))files.set(name,{method,size,compressed,offset});
    totalSize+=size;if(totalSize>128*1024*1024||size>MAX_XML)throw Error('The uncompressed workbook is too large.');
    p+=46+nameLength+extra+comment;
  }
  return async name=>{
    const entry=files.get(name);if(!entry)return null;
    const o=entry.offset;if(o+30>bytes.length||view.getUint32(o,true)!==0x04034b50)throw Error('Invalid ZIP entry.');
    const start=o+30+view.getUint16(o+26,true)+view.getUint16(o+28,true),end=start+entry.compressed;
    if(end>bytes.length)throw Error('Invalid ZIP data bounds.');
    let raw=bytes.subarray(start,end);
    if(entry.method===8){
      if(typeof DecompressionStream==='undefined')throw Error('This browser cannot unpack Excel files. Please use CSV or JSON.');
      let stream;try{stream=new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw'));}catch{throw Error('This browser does not support Excel decompression. Please use CSV or JSON.');}
      const reader=stream.getReader(),parts=[];let size=0;
      while(true){const next=await reader.read();if(next.done)break;size+=next.value.length;if(size>MAX_XML||size>entry.size+1024){await reader.cancel();throw Error('The Excel entry exceeds its declared size.');}parts.push(next.value);}
      raw=new Uint8Array(size);let at=0;for(const part of parts){raw.set(part,at);at+=part.length;}
    }else if(entry.method!==0)throw Error('Unsupported ZIP compression.');
    if(raw.length!==entry.size)throw Error('Excel ZIP size check failed.');
    return new TextDecoder('utf-8',{fatal:true}).decode(raw);
  };
}

function resolveZipPath(base,target){
  if(target.startsWith('/'))target=target.slice(1);else target=base.slice(0,base.lastIndexOf('/')+1)+target;
  const result=[];for(const part of target.split('/')){if(part==='..'){if(!result.length)throw Error('Invalid workbook relation path.');result.pop();}else if(part&&part!=='.')result.push(part);}
  return result.join('/');
}

async function parseXlsx(file){
  const read=await readZip(await file.arrayBuffer()),workbookText=await read('xl/workbook.xml'),relsText=await read('xl/_rels/workbook.xml.rels');
  if(!workbookText||!relsText)throw Error('The Excel workbook metadata is missing.');
  const workbook=xml(workbookText),rels=xml(relsText),sheets=elements(workbook,'sheet');
  const sheet=sheets.find(s=>['mapping','mappingsheet'].includes(norm(s.getAttribute('name'))));
  if(!sheet)throw Error('The Excel file must contain a Mapping or Mapping Sheet worksheet.');
  const relationshipId=sheet.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships','id')||sheet.getAttribute('r:id');
  const relationship=elements(rels,'Relationship').find(r=>r.getAttribute('Id')===relationshipId);
  if(!relationship||relationship.getAttribute('TargetMode')==='External')throw Error('The Mapping worksheet relation is invalid.');
  const sheetPath=resolveZipPath('xl/workbook.xml',relationship.getAttribute('Target')||'');
  if(!sheetPath.startsWith('xl/worksheets/'))throw Error('The Mapping worksheet path is invalid.');
  const sharedText=await read('xl/sharedStrings.xml');let strings=[];
  if(sharedText){const shared=xml(sharedText);strings=elements(shared,'si').map(si=>elements(si,'t').map(t=>t.textContent).join(''));if(strings.length>1000000)throw Error('Too many shared strings.');}
  const sheetText=await read(sheetPath);if(!sheetText)throw Error('The Mapping worksheet is missing.');
  const document=xml(sheetText),sheetRows=elements(document,'row'),matrix=[],warnings=[];let formulas=0;
  if(sheetRows.length>MAX_ROWS+26)throw Error('The Mapping worksheet has too many rows.');
  for(const row of sheetRows){
    const values=[],numericColumns=new Set(),rowNumber=Number(row.getAttribute('r'))||matrix.length+1;
    if(!Number.isInteger(rowNumber)||rowNumber<1||rowNumber>1048576)throw Error('Invalid worksheet row number.');
    for(const cell of elements(row,'c')){
      const ref=cell.getAttribute('r')||'',column=ref.match(/^([A-Z]+)\d+$/)?.[1];if(!column)continue;
      const index=colIndex(column);if(index>=MAX_COLUMNS)throw Error('The Mapping worksheet has too many columns.');
      const type=cell.getAttribute('t'),value=firstText(cell,'v');let str='';
      if(elements(cell,'f').length)formulas++;
      if(type==='s'){const i=Number(value);if(!Number.isInteger(i)||i<0||i>=strings.length)throw Error('Invalid shared string reference.');str=strings[i];}
      else if(type==='inlineStr')str=elements(cell,'t').map(t=>t.textContent).join('');
      else if(type==='b')str=value==='1'?'TRUE':'FALSE';
      else if(type==='e')str='';
      else{str=value;if(type!=='str'&&/^[-+]?\d+(\.\d+)?$/.test(value))numericColumns.add(index);}
      values[index]=text(str);
    }
    if(values.some(v=>text(v)))matrix.push({row:rowNumber,values,numericColumns});
  }
  if(formulas)warnings.push(`${formulas} formula cells were read from their saved values; no formulas were executed.`);
  const date1904=['1','true'].includes(elements(workbook,'workbookPr')[0]?.getAttribute('date1904')||'');
  return rowsFromMatrix(matrix,{sourceFile:basename(file.name),sheet:sheet.getAttribute('name')||'Mapping',warnings,date1904});
}

function objectFields(value){
  const result={};
  for(const [key,val] of Object.entries(value||{})){
    const mapped=PUBLIC_KEYS.has(key)?key:/^affiliation\s+type$/i.test(key)?'affiliationType':HEADER_ALIASES.get(norm(key));
    if(mapped&&val!==null&&val!==undefined&&['string','number','boolean'].includes(typeof val))result[mapped]=text(val);
  }
  return sanitiseFields(result);
}

function parseJSONUpload(value,file){
  if(!value||typeof value!=='object')throw Error('JSON must contain structured people rows.');
  if(Array.isArray(value.papers)&&value.papers.length>2000)throw Error('The public graph exceeds the 2,000 paper limit.');
  if(Array.isArray(value.papers)&&!Array.isArray(value.nodes)&&!Array.isArray(value.rows))return sanitizePaperDocument({...value,sourceFile:basename(file.name)});
  let records=Array.isArray(value)?value:Array.isArray(value.rows)?value.rows:null;
  const warnings=[];
  const graphExport=!records&&Array.isArray(value.nodes);
  if(graphExport){
    warnings.push('Imported graph edges and verification flags were ignored. Relations are rebuilt from public row fields.');
    records=[];
    for(const node of value.nodes){
      if(node?.stub||node?.entityType&&node.entityType!=='person')continue;
      if(Array.isArray(node.records)&&node.records.length){
        const sourceRecords=node.records.filter(r=>r&&typeof r==='object'&&!Array.isArray(r));
        const mapped=sourceRecords.map(r=>({...r,fields:objectFields(r.fields||r.cells||{}),sourceFile:basename(r.sourceFile||value.meta?.sourceFile||file.name),personKey:text(node.id).slice(0,200)}));
        // Career fields may be explicitly supplied on a public graph node. A recorded
        // value always wins; only absent extras are filled, once, on its first row.
        if(mapped.length)for(const key of ['affiliationType','academicStatus','jobTitle','expectedGraduation']){
          const supplied=node[key];
          if(['string','number','boolean'].includes(typeof supplied)&&useful(supplied)&&!mapped.some(r=>useful(r.fields[key])))mapped[0].fields[key]=text(supplied);
        }
        records.push(...mapped);
      }
      else records.push({personKey:text(node.id).slice(0,200),fields:{A:node.name,B:node.nameZh,C:node.phd,E:node.bachelor,G:node.affiliation,H:node.role,I:node.location,P:node.website,Q:node.orcid,R:node.linkedin,T:node.scholar,affiliationType:node.affiliationType,academicStatus:node.academicStatus,jobTitle:node.jobTitle,expectedGraduation:node.expectedGraduation}});
    }
  }
  if(!records)throw Error('JSON must contain an array of named people rows or an exported graph.');
  if(records.length>MAX_ROWS)throw Error('Too many JSON rows.');
  const rows=[];
  records.forEach((record,index)=>{
    if(!record||typeof record!=='object'||Array.isArray(record))return;
    const fields=objectFields(record.fields||record.cells||record);
    if(/^\d{5,}(?:\.\d+)?$/.test(fields.expectedGraduation||'')){delete fields.expectedGraduation;warnings.push(`Row ${index+2}: an invalid numeric expected-graduation value was excluded. Use a four-digit year or an ISO date.`);}
    if(['legalname','name','fullname'].includes(norm(fields.A))&&norm(fields.G)==='currentaffiliation')return;
    if(Object.keys(fields).length)rows.push({row:Number.isInteger(record.row)&&record.row>0&&record.row<=1048576?record.row:index+2,fields,...(graphExport?{sourceFile:basename(record.sourceFile||value.meta?.sourceFile||file.name),personKey:text(record.personKey).slice(0,200)}:{})});
  });
  return{sourceFile:basename(file.name),...(graphExport?{sourceIdentity:basename(value.meta?.sourceFile||file.name)}:{}),sheet:text(value.sheet||value.meta?.sheet||'Mapping'),rows,warnings,...(Array.isArray(value.papers)?{papers:value.papers.map(p=>sanitizePaper(p,{keepNodeIds:true}))}:{})};
}

export async function parseUpload(file){
  if(!file||typeof file.arrayBuffer!=='function')throw Error('Please select a file.');
  if(file.size>MAX_FILE)throw Error('The upload must be 20 MB or smaller.');
  const name=basename(file.name),ext=name.toLowerCase().split('.').pop();
  if(ext==='xlsx')return parseXlsx(file);
  if(!['csv','tsv','json'].includes(ext))throw Error('Supported formats: .xlsx (Mapping worksheet), .csv, .tsv and .json.');
  const bytes=await file.arrayBuffer();if(bytes.byteLength>MAX_FILE)throw Error('The upload must be 20 MB or smaller.');
  let value;try{value=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{throw Error('Please save the document as UTF-8.');}
  if(ext==='json'){try{return parseJSONUpload(JSON.parse(value.replace(/^\uFEFF/,'')),file);}catch(error){throw Error(`Unable to read JSON: ${error.message}`);}}
  return rowsFromMatrix(parseDelimited(value,ext==='tsv'?'\t':undefined).map((values,i)=>({row:i+1,values})),{sourceFile:name,sheet:'Mapping',warnings:[]});
}

function urlIdentity(value,type){
  value=text(value);if(!useful(value))return '';
  if(type==='Q'){
    let id=value.toLowerCase();
    if(!/^\d{4}-?\d{4}-?\d{4}-?\d{3}[\dx]$/.test(id)){
      try{
        const url=new URL(/^https?:\/\//i.test(value)?value:'https://'+value);
        if(!['http:','https:'].includes(url.protocol)||!['orcid.org','www.orcid.org'].includes(url.hostname.toLowerCase())||url.username||url.password||url.port)return '';
        id=url.pathname.replace(/^\//,'').replace(/\/$/,'').toLowerCase();
      }catch{return '';}
    }
    return /^\d{4}-?\d{4}-?\d{4}-?\d{3}[\dx]$/.test(id)?id.replace(/-/g,''):'';
  }
  try{const url=new URL(/^https?:\/\//i.test(value)?value:'https://'+value);if(!['http:','https:'].includes(url.protocol))return '';
    if(type==='T'){const id=url.searchParams.get('user');return url.hostname.toLowerCase()==='scholar.google.com'&&!url.username&&!url.password&&!url.port&&/^[A-Za-z0-9_-]{3,64}$/.test(id||'')?'scholar:'+id:'';}
    if(type==='R'&&(!/(^|\.)linkedin\.com$/i.test(url.hostname)||!/^\/(?:in|pub)\/[^/]+/i.test(url.pathname)))return '';
    return url.hostname.toLowerCase().replace(/^www\./,'')+decodeURIComponent(url.pathname).replace(/\/+$/,'').toLowerCase();
  }catch{return '';}
}

function nodeFields(node){
  const result={A:node.name,B:node.nameZh,C:node.phd,E:node.bachelor,G:node.affiliation,H:node.role,I:node.location,P:node.website,Q:node.orcid,R:node.linkedin,T:node.scholar,affiliationType:node.affiliationType,academicStatus:node.academicStatus,jobTitle:node.jobTitle,expectedGraduation:node.expectedGraduation};
  for(const record of node.records||[])for(const [key,value] of Object.entries(record.fields||{}))if(PUBLIC_KEYS.has(key)&&useful(value)&&!useful(result[key]))result[key]=value;
  return sanitiseFields(result);
}
function identityConflict(a,b){return['Q','R','T'].some(key=>urlIdentity(a[key],key)&&urlIdentity(b[key],key)&&urlIdentity(a[key],key)!==urlIdentity(b[key],key));}
function sameName(a,b){const namesA=[a.A,a.B].filter(useful).map(norm),namesB=[b.A,b.B].filter(useful).map(norm);return namesA.some(n=>namesB.includes(n));}
function provenanceMatch(node,fields,record,sourceFile){
  return!identityConflict(nodeFields(node),fields)&&(node.records||[]).some(r=>r.row===record.row&&(r.sourceFile||sourceFile)===sourceFile&&stableJSON(cleanedFields(r.fields))===stableJSON(cleanedFields(fields)));
}
function identityMatch(node,fields,record,sourceFile){
  const existing=nodeFields(node);if(identityConflict(existing,fields))return false;
  if(['Q','R','T'].some(key=>urlIdentity(fields[key],key)&&urlIdentity(fields[key],key)===urlIdentity(existing[key],key)))return true;
  if(!sameName(existing,fields))return false;
  if(urlIdentity(fields.P,'P')&&urlIdentity(fields.P,'P')===urlIdentity(existing.P,'P'))return true;
  const educationConflict=['C','E'].some(key=>useful(fields[key])&&useful(existing[key])&&norm(fields[key])!==norm(existing[key]));
  if(!educationConflict&&['C','E'].some(key=>useful(fields[key])&&norm(fields[key])===norm(existing[key])))return true;
  if(!educationConflict&&useful(fields.B)&&norm(fields.B)!==norm(fields.A)&&norm(fields.B)===norm(existing.B)&&norm(fields.A)===norm(existing.A))return true;
  return provenanceMatch(node,fields,record,sourceFile);
}

function makePerson(fields,id){
  const name=nameOf(fields),nameZh=useful(fields.B)&&norm(fields.B)!==norm(name)?fields.B:'';
  return{id,name,nameZh,kind:'person',entityType:'person',affiliation:useful(fields.G)?fields.G:'',role:useful(fields.H)?fields.H:'',location:useful(fields.I)?fields.I:'',phd:useful(fields.C)?fields.C:'',bachelor:useful(fields.E)?fields.E:'',research:'',website:useful(fields.P)?fields.P:'',scholar:useful(fields.T)?fields.T:'',orcid:useful(fields.Q)?fields.Q:'',linkedin:useful(fields.R)?fields.R:'',affiliationType:useful(fields.affiliationType)?fields.affiliationType:'',academicStatus:useful(fields.academicStatus)?fields.academicStatus:'',jobTitle:useful(fields.jobTitle)?fields.jobTitle:'',expectedGraduation:useful(fields.expectedGraduation)?fields.expectedGraduation:'',rows:[],records:[],stub:false,aliases:[name],identityNote:'',degree:0,publications:useful(fields.V)?[fields.V]:[]};
}

function sanitiseNode(node,sourceFile){
  const out=makePerson(nodeFields(node),text(node.id));
  out.entityType=['person','institution','group','publication'].includes(node.entityType)?node.entityType:'person';out.kind=out.entityType==='institution'?'organization':out.entityType;
  out.stub=Boolean(node.stub);out.aliases=[...new Set([node.name,...(Array.isArray(node.aliases)?node.aliases:[])].filter(v=>typeof v==='string').map(text))];
  out.records=(node.records||[]).filter(r=>Number.isInteger(r.row)&&r.row>0).map(r=>({row:r.row,fields:sanitiseFields(r.fields),sourceFile:basename(r.sourceFile||sourceFile),...(r.referenceOnly?{referenceOnly:true}:{})}));
  out.rows=[...new Set(out.records.map(r=>r.row))].sort((a,b)=>a-b);
  out.publications=[...new Set([...(Array.isArray(node.publications)?node.publications:[]),...out.records.map(r=>r.fields.V)].filter(useful).map(text))];
  out.identityNote=out.stub?'Named relationship reference; identity not independently resolved.':'';
  return out;
}

function kindOf(name,knownInstitutions){
  if(/\bgroup\b|课题组|研究组/i.test(name)||['HQI','JILA','Optimization / computing systems'].includes(name))return'group';
  if(knownInstitutions?.has(norm(name))||['QuEra','Google','planqc','Oratomic','Atom Computing','Infleqtion','Microchip','HyperLight','Qualcomm','Cubist Systematic Strategies','Princeton'].some(value=>norm(value)===norm(name))||/\b(?:inc\.?|llc|corp\.?|company|technologies|university)\b|有限公司|研究院|大学/i.test(name))return'institution';
  if(name==='Continuous operation of a coherent 3,000-qubit system')return'publication';
  return'person';
}

function relationshipParts(value,knownInstitutions){
  const unqualified=text(value).replace(/（[^）]*）|\([^)]*\)/g,'').trim();
  if(kindOf(unqualified,knownInstitutions)!=='person')return[unqualified];
  return unqualified.split(/\s*[/、;；]\s*/).map(text).filter(useful);
}

function updatePerson(node,fields,record,sourceFile,{preserveName=false}={}){
  if(node.records.some(r=>r.row===record.row&&r.sourceFile===sourceFile&&stableJSON(cleanedFields(r.fields))===stableJSON(cleanedFields(fields))))return false;
  const before=stableJSON({fields:nodeFields(node),records:node.records,publications:node.publications});
  const patch=makePerson(fields,node.id);
  const mapping={A:'name',B:'nameZh',C:'phd',E:'bachelor',G:'affiliation',H:'role',I:'location',P:'website',Q:'orcid',R:'linkedin',T:'scholar',affiliationType:'affiliationType',academicStatus:'academicStatus',jobTitle:'jobTitle',expectedGraduation:'expectedGraduation'};
  for(const [key,property] of Object.entries(mapping))if(useful(fields[key])&&!(preserveName&&key==='A'))node[property]=key==='B'&&norm(fields.B)===norm(node.name)?'':patch[property];
  node.aliases=[...new Set([...node.aliases,nameOf(fields)].filter(useful))];
  if(useful(fields.V))node.publications=[...new Set([...node.publications,fields.V])];
  const safeRecord={row:record.row,fields:sanitiseFields(fields),sourceFile};
  if(!node.records.some(r=>r.row===safeRecord.row&&r.sourceFile===sourceFile&&stableJSON(r.fields)===stableJSON(safeRecord.fields)))node.records.push(safeRecord);
  node.rows=[...new Set(node.records.map(r=>r.row))].sort((a,b)=>a-b);
  return before!==stableJSON({fields:nodeFields(node),records:node.records,publications:node.publications});
}

export function previewImport(baseGraph,upload,{mode='merge',asOf}={}){
  if(upload?.kind==='paper')return previewPaperImport(baseGraph,upload);
  if(!['merge','replace'].includes(mode))throw Error('Choose merge or replace.');
  if(!baseGraph||!Array.isArray(baseGraph.nodes)||!Array.isArray(baseGraph.edges))throw Error('The existing graph is invalid.');
  if(!upload||!Array.isArray(upload.rows)||upload.rows.length>MAX_ROWS)throw Error('The uploaded rows are invalid.');
  const sourceFile=basename(upload.sourceIdentity||upload.sourceFile),baseSource=basename(baseGraph.meta?.sourceFile||'previous-dataset');
  const warnings=[...(upload.warnings||[])].map(text),issues=[];
  const nodes=mode==='merge'?baseGraph.nodes.map(n=>sanitiseNode(n,baseSource)):[];
  const nodeMap=new Map(nodes.map(n=>[n.id,n])),oldIDs=new Set(nodes.map(n=>n.id)),usedIDs=new Set(oldIDs);
  if(nodeMap.size!==nodes.length)throw Error('The existing graph contains duplicate node IDs.');
  const profileNodes=nodes.filter(n=>n.entityType==='person'&&!n.stub);
  const byName=new Map(),byIdentifier=new Map();
  function indexNode(node){
    for(const name of new Set([node.name,node.nameZh,...node.aliases].filter(useful).map(norm))){if(!byName.has(name))byName.set(name,new Set());byName.get(name).add(node.id);}
    const f=nodeFields(node);for(const key of ['Q','R','T']){const value=urlIdentity(f[key],key);if(value){const id=key+':'+value;if(!byIdentifier.has(id))byIdentifier.set(id,new Set());byIdentifier.get(id).add(node.id);}}
  }
  profileNodes.forEach(indexNode);
  const affected=new Map(),rowTargets=[],sourceGroups=new Map(),inputRows=upload.rows.filter(r=>r&&typeof r==='object');let excluded=0,ambiguous=0,sourceRecordRows=0;
  for(const record of inputRows){
    const fields=sanitiseFields(record.fields),row=Number(record.row);
    const rowSource=basename(record.sourceFile||sourceFile);
    if(!Number.isInteger(row)||row<1||row>1048576){issues.push({level:'error',row:record.row,message:'Invalid source row number; excluded.'});excluded++;continue;}
    const name=nameOf(fields);if(!useful(name)){excluded++;continue;}sourceRecordRows++;
    const candidateIDs=new Set();for(const alias of [fields.A,fields.B].filter(useful))for(const id of byName.get(norm(alias))||[])candidateIDs.add(id);
    for(const key of ['Q','R','T']){const value=urlIdentity(fields[key],key);for(const id of byIdentifier.get(key+':'+value)||[])candidateIDs.add(id);}
    const personKey=text(record.personKey).slice(0,200);
    const grouped=[...(sourceGroups.get(personKey)||[])].map(id=>nodeMap.get(id)).filter(n=>!identityConflict(nodeFields(n),fields));
    const candidates=[...candidateIDs].map(id=>nodeMap.get(id));
    const exactProvenance=candidates.filter(n=>provenanceMatch(n,fields,{row},rowSource));
    const exactIdentifiers=candidates.filter(n=>!identityConflict(nodeFields(n),fields)&&['Q','R','T'].some(key=>urlIdentity(fields[key],key)&&urlIdentity(fields[key],key)===urlIdentity(nodeFields(n)[key],key)));
    const matched=exactProvenance.length?exactProvenance:exactIdentifiers.length?exactIdentifiers:grouped.length?grouped:candidates.filter(n=>identityMatch(n,fields,{row},rowSource));
    let node;
    if(matched.length===1)node=matched[0];
    else{
      if(matched.length>1){ambiguous++;issues.push({level:'warning',row,name,message:'Multiple identity matches; a separate profile was retained.'});}
      const signature=rowSource+'|'+row+'|'+stableJSON(cleanedFields(fields));let id='i'+hash(signature),suffix=1;
      while(usedIDs.has(id))id='i'+hash(signature)+'_'+suffix++;
      node=makePerson(fields,id);nodes.push(node);nodeMap.set(id,node);usedIDs.add(id);profileNodes.push(node);affected.set(id,'added');
    }
    const changed=updatePerson(node,fields,{row},rowSource,{preserveName:grouped.some(n=>n.id===node.id)&&!sameName(nodeFields(node),fields)});indexNode(node);
    if(personKey){if(!sourceGroups.has(personKey))sourceGroups.set(personKey,new Set());sourceGroups.get(personKey).add(node.id);}
    if(affected.get(node.id)!=='added')affected.set(node.id,changed?'updated':affected.get(node.id)||'unchanged');
    rowTargets.push({row,fields,target:node.id,sourceFile:rowSource,personKey:text(record.personKey).slice(0,200)});
  }
  if(!rowTargets.length)throw Error('The document contains no usable named people. No update was applied.');

  let edges=mode==='merge'?normalizeMappingEdges(baseGraph.edges.filter(e=>!['coauthor','collaboration'].includes(e.type)&&nodeMap.has(e.source)&&nodeMap.has(e.target)).map(e=>{
    const type=['research','followup','institution','phd','postdoc'].includes(e.type)?e.type:'institution';
    const column=e.definition?.basis==='mapping_column'&&['N','O'].includes(e.definition.column)?e.definition.column:null;
    return{id:text(e.id),source:e.source,target:e.target,type,directed:['phd','postdoc'].includes(type),
      ...(column?{definition:{basis:'mapping_column',column}}:{}),
      ...(e.columnSourceEdgeId?{columnSourceEdgeId:text(e.columnSourceEdgeId)}:{}),
      ...(e.originalType?{originalType:text(e.originalType)}:{}),
      evidence:(e.evidence||[]).filter(v=>['N','O'].includes(v.column)).map(v=>({row:Number(v.row),column:v.column,field:v.column==='N'?'Research Line':'Industry Line',value:text(v.value),sourceFile:basename(v.sourceFile||baseSource)})),rows:[...new Set((e.rows||[]).filter(Number.isInteger))]};
  })):[];
  const edgeIndex=new Map(edges.map(e=>[[e.source,e.target,e.type].join('|'),e])),edgeIDs=new Set(edges.map(e=>e.id)),refs=new Map();
  for(const node of nodes.filter(n=>n.stub))refs.set(node.entityType+':'+norm(node.name),node);
  const ambiguousReferences=mode==='merge'&&Array.isArray(baseGraph.meta?.ambiguousReferences)?clone(baseGraph.meta.ambiguousReferences):[];
  const knownInstitutions=new Set(nodes.filter(n=>n.entityType==='institution').map(n=>norm(n.name)));
  for(const node of profileNodes)if(/company|industry|industrial|corporate|企业|公司/i.test(node.affiliationType+' '+node.role)&&useful(node.affiliation))knownInstitutions.add(norm(node.affiliation));
  let newRelationships=mode==='merge'?Math.max(0,edges.length-baseGraph.edges.length):0;
  for(const {row,fields,target,sourceFile:rowSource} of rowTargets){
    for(const column of ['N','O']){
      const value=fields[column];if(!useful(value))continue;
      for(const name of relationshipParts(value,knownInstitutions)){
        if(!useful(name))continue;const kind=kindOf(name,knownInstitutions);
        const candidates=kind==='person'?[...(byName.get(norm(name))||[])].map(id=>nodeMap.get(id)).filter(n=>!n.stub&&n.entityType==='person'):[];
        let source;
        if(candidates.length===1)source=candidates[0].id;
        else{
          const key=kind+':'+norm(name);let ref=refs.get(key);
          if(!ref){let id='r'+hash(key);while(usedIDs.has(id))id+='x';ref=makePerson({A:name},id);ref.entityType=kind;ref.kind=kind==='institution'?'organization':kind;ref.stub=true;ref.identityNote=candidates.length?'Ambiguous name; no individual identity was selected.':'Named relationship reference; identity not independently resolved.';nodes.push(ref);nodeMap.set(id,ref);usedIDs.add(id);refs.set(key,ref);}
          source=ref.id;const refRecord={row,sourceFile:rowSource,referenceOnly:true,fields:{[column]:value}};
          if(!ref.records.some(r=>r.row===row&&r.sourceFile===rowSource&&stableJSON(r.fields)===stableJSON(refRecord.fields)))ref.records.push(refRecord);
          ref.rows=[...new Set(ref.records.map(r=>r.row))].sort((a,b)=>a-b);
          if(candidates.length>1&&!ambiguousReferences.some(r=>r.referenceId===ref.id)){ambiguousReferences.push({name,candidateIds:candidates.map(n=>n.id),referenceId:ref.id});ambiguous++;}
        }
        if(source===target)continue;
        const type=column==='N'?'phd':'postdoc',key=[source,target,type].join('|');let edge=edgeIndex.get(key);
        if(!edge){let id='e'+hash(key);while(edgeIDs.has(id))id+='x';edge={id,source,target,type,label:EDGE_TYPES.find(t=>t.id===type).label,directed:true,definition:{basis:'mapping_column',column},evidence:[],rows:[]};edges.push(edge);edgeIndex.set(key,edge);edgeIDs.add(id);newRelationships++;}
        const evidence={row,column,field:column==='N'?'Research Line':'Industry Line',value,sourceFile:rowSource};
        if(!edge.evidence.some(v=>v.row===row&&v.column===column&&v.value===value&&v.sourceFile===rowSource))edge.evidence.push(evidence);
        if(!edge.rows.includes(row))edge.rows.push(row);
      }
    }
  }
  edges=normalizeMappingEdges(edges);
  for(const node of nodes)node.degree=0;
  for(const edge of edges){nodeMap.get(edge.source).degree++;nodeMap.get(edge.target).degree++;}
  const profiles=nodes.filter(n=>!n.stub&&n.entityType==='person'),references=nodes.filter(n=>n.stub&&n.entityType==='person');
  const sources=[...new Set([...nodes.flatMap(n=>n.records.map(r=>r.sourceFile)),sourceFile])];
  const recordCoordinates=new Set(profiles.flatMap(n=>n.records.map(r=>r.sourceFile+'|'+r.row)));
  const previousSourceRows=mode==='merge'?Number(baseGraph.meta?.counts?.sourceRows)||0:0;
  const sameSource=mode==='merge'&&(baseSource===sourceFile||(baseGraph.meta?.sourceFiles||[]).includes(sourceFile));
  const sourceRows=Math.max(recordCoordinates.size,sameSource?Math.max(previousSourceRows,inputRows.length):previousSourceRows+inputRows.length);
  const added=[...affected.values()].filter(v=>v==='added').length,updated=[...affected.values()].filter(v=>v==='updated').length,unchanged=[...affected.values()].filter(v=>v==='unchanged').length;
  const meta={sourceFile,sheet:text(upload.sheet||'Mapping'),sourceFiles:sources,generatedAt:asOf||new Date().toISOString().slice(0,10),publicVersion:true,
    counts:{sourceRows,personRows:recordCoordinates.size,people:profiles.length+references.length,profilePeople:profiles.length,referencePeople:references.length,nodes:nodes.length,edges:edges.length,mergedRows:Math.max(0,recordCoordinates.size-profiles.length),excludedUnnamedRows:mode==='merge'?Math.max(Number(baseGraph.meta?.counts?.excludedUnnamedRows)||0,excluded):excluded,connectedPeople:nodes.filter(n=>n.entityType==='person'&&n.degree>0).length},
    columns:PUBLIC_COLUMNS.map(c=>({...c})),edgeTypes:EDGE_TYPES.map(t=>({...t})),topNodes:[...nodes].sort((a,b)=>b.degree-a.degree).slice(0,15).map(n=>n.id),ambiguousReferences,
    notes:['Public professional fields only; recruitment evaluations, contact status and internal notes are excluded.','Mapping column definitions: Research Line (N) lists PhD supervisors and Industry Line (O) lists Postdoc supervisors. Directed links run from supervisor to student; this classification uses the user-defined column meaning, without claiming independent external verification.','Names alone do not establish identity. Ambiguous people remain separate and keep source records.','Merge mode retains existing profiles and links; non-empty supplied public fields update matched profiles.']};
  if(ambiguous)warnings.push(`${ambiguous} ambiguous identities or relationship references were retained separately.`);
  if(excluded)warnings.push(`${excluded} rows without a usable name or valid row number were excluded.`);
  let graph={meta,nodes,edges,edgeTypes:EDGE_TYPES.map(t=>({...t}))};
  if(mode==='merge'&&baseGraph.papers?.length)graph=rebuildPaperGraph(graph,baseGraph.papers);
  const summary={added,updated,unchanged,newRelationships,retained:mode==='merge'?profiles.filter(n=>oldIDs.has(n.id)&&!affected.has(n.id)).length:0,ambiguous,excluded,processedRows:sourceRecordRows,totalPeople:profiles.length,totalRelationships:graph.edges.length,totalNodes:nodes.length,changedIds:[...affected].filter(([,kind])=>kind!=='unchanged').map(([id])=>id),subjectIds:[...affected.keys()],mode,papersAdded:0,papersUpdated:0,totalPapers:graph.papers?.length||0};
  if(upload.papers?.length){
    const bindings=new Map();for(const r of rowTargets)if(r.personKey){if(!bindings.has(r.personKey))bindings.set(r.personKey,new Set());bindings.get(r.personKey).add(r.target);}
    const changed=new Set(summary.changedIds),subjects=new Set(summary.subjectIds);
    for(let offset=0;offset<upload.papers.length;offset+=20){
      const papers=upload.papers.slice(offset,offset+20),matches={};
      papers.forEach((paper,pi)=>paper.authors.forEach((author,ai)=>{const bound=bindings.get(author.nodeId);if(bound?.size===1)matches[`${pi}:${ai}`]=[...bound][0];}));
      const result=previewPaperImport(graph,{kind:'paper',sourceFile:basename(upload.sourceFile),papers,matches});graph=result.graph;
      warnings.push(...result.warnings);issues.push(...result.issues);for(const id of result.summary.changedIds)changed.add(id);for(const id of result.summary.subjectIds)subjects.add(id);
      summary.newRelationships+=result.summary.newRelationships;summary.papersAdded+=result.summary.papersAdded;summary.papersUpdated+=result.summary.papersUpdated;summary.ambiguous+=result.summary.ambiguous;summary.excluded+=result.summary.excluded;summary.focusPersonId=summary.focusPersonId||result.summary.focusPersonId;
    }
    const finalProfiles=graph.nodes.filter(n=>n.entityType==='person'&&!n.stub);
    Object.assign(summary,{added:finalProfiles.filter(n=>!oldIDs.has(n.id)).length,updated:finalProfiles.filter(n=>oldIDs.has(n.id)&&changed.has(n.id)).length,unchanged:finalProfiles.filter(n=>subjects.has(n.id)&&!changed.has(n.id)).length,totalPeople:finalProfiles.length,totalRelationships:graph.edges.length,totalNodes:graph.nodes.length,totalPapers:graph.papers?.length||0,changedIds:[...changed],subjectIds:[...subjects]});
  }
  return{graph,summary,warnings,issues};
}
