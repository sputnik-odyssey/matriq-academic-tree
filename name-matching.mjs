// Name variants are discovery hints; they never establish identity by themselves.
export function normalizedName(value){
  return String(value??'').normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase()
    .replace(/['’‘ʼ]/g,'').replace(/\.(?=\p{L})/gu,' ').replace(/\./g,'')
    .replace(/[^\p{L}\p{N}]+/gu,' ').trim().replace(/\s+/g,' ');
}
const initial=value=>/^\p{L}$/u.test(value);
const tokenCompatible=(a,b)=>a===b||initial(a)&&b.startsWith(a)||initial(b)&&a.startsWith(b);
function middleCompatible(a,b){
  if(a.length===b.length)return a.every((value,index)=>tokenCompatible(value,b[index]));
  const shorter=a.length<b.length?a:b,longer=a.length<b.length?b:a;
  // Only initials may be omitted. Do not discard an explicit full middle name.
  const memo=new Map();
  function match(i,j){
    const key=i+':'+j;if(memo.has(key))return memo.get(key);
    let result;
    if(i===shorter.length)result=longer.slice(j).every(initial);
    else if(j===longer.length)result=false;
    else result=tokenCompatible(shorter[i],longer[j])&&match(i+1,j+1)||initial(longer[j])&&match(i,j+1);
    memo.set(key,result);return result;
  }
  return match(0,0);
}
export function nameMatchKind(first,second){
  const a=normalizedName(first),b=normalizedName(second);
  if(!a||!b)return'';
  if(a===b)return'exact';
  // Positional initial expansion applies only to Latin-script names. We never
  // reverse first/last names or infer transliterations for other writing systems.
  if(!/^[\p{Script=Latin} ]+$/u.test(a)||!/^[\p{Script=Latin} ]+$/u.test(b))return'';
  const x=a.split(' '),y=b.split(' ');
  if(x.length<2||y.length<2||x.length>12||y.length>12)return'';
  if(x.at(-1)!==y.at(-1)||x.at(-1).length<2||!tokenCompatible(x[0],y[0]))return'';
  return middleCompatible(x.slice(1,-1),y.slice(1,-1))?'variant':'';
}
