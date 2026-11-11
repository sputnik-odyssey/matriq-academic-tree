// Public graph storage and owner-authenticated publishing. Credentials never enter storage.
const OWNER='sputnik-odyssey',REPOSITORY='matriq-academic-tree',BRANCH='main';
export const PUBLISH_REPOSITORY=Object.freeze({owner:OWNER,repository:REPOSITORY,branch:BRANCH});
const API=`https://api.github.com/repos/${OWNER}/${REPOSITORY}`;
const DATABASE_NAME='matriq-academic-tree-local',STORE='snapshots';

function openDatabase(){
  return new Promise((resolve,reject)=>{
    const request=indexedDB.open(DATABASE_NAME,1);
    request.onupgradeneeded=()=>request.result.createObjectStore(STORE);
    request.onsuccess=()=>resolve(request.result);
    request.onerror=()=>reject(Error('This browser could not open local database storage.'));
  });
}
async function databaseOperation(mode,operation){
  const db=await openDatabase();
  try{return await new Promise((resolve,reject)=>{
    const tx=db.transaction(STORE,mode),request=operation(tx.objectStore(STORE));let result;
    request.onsuccess=()=>{result=request.result;};
    request.onerror=()=>reject(Error('The local database operation failed.'));
    tx.oncomplete=()=>resolve(result);
    tx.onerror=()=>reject(Error('The local database could not save this update.'));
    tx.onabort=()=>reject(Error('The local database update was cancelled.'));
  });}finally{db.close();}
}
export const loadLocalGraph=()=>databaseOperation('readonly',store=>store.get('active'));
export const saveLocalGraph=(graph,info={})=>databaseOperation('readwrite',store=>store.put({graph,info,savedAt:new Date().toISOString()},'active'));
export const clearLocalGraph=()=>databaseOperation('readwrite',store=>store.delete('active'));

export async function decodeGraphBytes(input){
  const bytes=input instanceof Uint8Array?input:new Uint8Array(input);
  const gzip=bytes[0]===0x1f&&bytes[1]===0x8b;
  let value;
  if(gzip){
    if(typeof DecompressionStream==='undefined')throw Error('Use a current Chrome, Edge, Firefox or Safari to load compressed graph data.');
    value=await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).json();
  }else value=JSON.parse(new TextDecoder().decode(bytes));
  if(!Array.isArray(value.nodes)||!Array.isArray(value.edges)||!value.meta)throw Error('The graph database has an invalid format.');
  return value;
}
export async function encodeGraphGzip(graph){
  const json=JSON.stringify(graph);
  if(json.length>50_000_000)throw Error('The merged graph is too large to publish from the browser.');
  if(typeof CompressionStream==='undefined')throw Error('This browser cannot prepare a compressed update. Use a current browser or download the public JSON.');
  return new Uint8Array(await new Response(new Blob([json]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer());
}
export async function graphFingerprint(graph){
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(graph)));
  return [...new Uint8Array(digest)].map(b=>b.toString(16).padStart(2,'0')).join('');
}
function base64Bytes(bytes){
  let binary='';for(let i=0;i<bytes.length;i+=32768)binary+=String.fromCharCode(...bytes.subarray(i,i+32768));
  return btoa(binary);
}
function bytesBase64(content){const binary=atob(content.replace(/\s/g,''));return Uint8Array.from(binary,c=>c.charCodeAt(0));}

async function requestGitHub(path,token,{method='GET',body,raw=false}={}){
  const url=path==='/user'?'https://api.github.com/user':`${API}${path}`;
  const headers={Accept:raw?'application/vnd.github.raw+json':'application/vnd.github+json','X-GitHub-Api-Version':'2026-03-10'};
  if(token)headers.Authorization=`Bearer ${token}`;
  if(body)headers['Content-Type']='application/json';
  const response=await fetch(url,{method,headers,body:body?JSON.stringify(body):undefined,cache:'no-store',credentials:'omit',redirect:'error'});
  if(!response.ok){
    if(response.status===401)throw Error('GitHub did not accept this token.');
    if(response.status===403)throw Error('The token needs Contents read and write permission for this repository.');
    if(response.status===409||response.status===422)throw Error('The shared database changed or GitHub rejected this update. Reload the shared data and preview the merge again.');
    throw Error(`GitHub could not complete this operation (${response.status}).`);
  }
  return raw?new Uint8Array(await response.arrayBuffer()):response.json();
}
export async function loadGitHubGraph(token=''){
  const metadata=await requestGitHub(`/contents/data.json.gz?ref=${BRANCH}`,token);
  if(metadata.type!=='file'||!metadata.sha)throw Error('The shared graph file could not be identified.');
  const bytes=metadata.encoding==='base64'&&metadata.content?bytesBase64(metadata.content):await requestGitHub(`/contents/data.json.gz?ref=${BRANCH}`,token,{raw:true});
  return{graph:await decodeGraphBytes(bytes),sha:metadata.sha};
}
export async function verifyRepositoryOwner(token){
  if(!String(token||'').trim())throw Error('Enter a repository-scoped GitHub token to publish.');
  const user=await requestGitHub('/user',token);
  if(String(user.login).toLowerCase()!==OWNER)throw Error(`Only the ${OWNER} account can publish shared database updates here.`);
  const repo=await requestGitHub('',token);
  if(repo.full_name?.toLowerCase()!==`${OWNER}/${REPOSITORY}`||repo.private||repo.permissions?.push!==true)throw Error('GitHub did not confirm write access to the expected public repository.');
  return{login:user.login};
}
export async function publishGitHubGraph(graph,token,expectedSha){
  await verifyRepositoryOwner(token);
  if(!/^[a-f0-9]{40}$/.test(expectedSha||''))throw Error('Reload the latest shared database before publishing.');
  const bytes=await encodeGraphGzip(graph);
  if(bytes.byteLength>20_000_000)throw Error('The compressed update exceeds the browser publishing size limit.');
  const result=await requestGitHub('/contents/data.json.gz',token,{method:'PUT',body:{message:'Update public academic graph from reviewed document import',content:base64Bytes(bytes),sha:expectedSha,branch:BRANCH}});
  return{commit:result.commit?.sha,url:result.commit?.html_url,contentSha:result.content?.sha};
}
