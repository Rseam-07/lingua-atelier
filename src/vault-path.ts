/** Vault paths always use POSIX separators, including on Windows and phones. */
function normalize(value:string):string{
  const absolute=value.startsWith('/'),parts:string[]=[];
  for(const part of value.split('/')){
    if(!part||part==='.')continue;
    if(part==='..'&&parts.length&&parts[parts.length-1]!=='..')parts.pop();
    else if(part!=='..'||!absolute)parts.push(part);
  }
  return (absolute?'/':'')+parts.join('/')||(absolute?'/':'.');
}
function basename(value:string,suffix=''):string{const name=value.replace(/\/+$/,'').split('/').pop()||'';return suffix&&name.endsWith(suffix)?name.slice(0,-suffix.length):name;}
function dirname(value:string):string{const index=value.replace(/\/+$/,'').lastIndexOf('/');return index<0?'.':index===0?'/':value.slice(0,index);}
function extname(value:string):string{const name=basename(value),index=name.lastIndexOf('.');return index<=0?'':name.slice(index);}
function join(...values:string[]):string{return normalize(values.filter(Boolean).join('/'));}
function relative(from:string,to:string):string{const a=normalize(from).split('/').filter(p=>p&&p!=='.'),b=normalize(to).split('/').filter(p=>p&&p!=='.');let i=0;while(i<a.length&&i<b.length&&a[i]===b[i])i++;return [...a.slice(i).map(()=>'..'),...b.slice(i)].join('/');}
export default {normalize,basename,dirname,extname,join,relative};
