import path from './vault-path';
import type {Session} from './types';

export interface Move {from:string;to:string;reason:string;title?:string;beforeTitle?:string;}
export interface TextFile {path:string;text:string;}
const managed=['课程','课堂记录','测试','收件箱','会话'];
export const isTestTitle=(title:string):boolean=>/^(?:测试|test(?:ing)?(?:\s|$)|french-test(?:\s|$)|性能验证|(?:中法)?双路(?:核对|识别)测试|麦克风.*测试|课堂录音实测[（(]节选[）)]|课堂片段-地理与学科-16秒$)/i.test(title);
export function isTestSession(session:Pick<Session,'title'|'duration'|'phase'>):boolean{
  if(['starting','recording','paused','finishing'].includes(session.phase))return false;
  // A real lesson can inherit the previous imported sample's title. Duration
  // contradicting that short-sample title takes priority over the filename.
  if(/16秒/.test(session.title)&&session.duration>60)return false;
  return isTestTitle(session.title);
}
export function recordingFolder(root:string,title:string,date=new Date(),test=isTestTitle(title)):string{
  return test?`${root}/测试/录音测试`:`${root}/课堂记录/${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}`;
}
export const indexPaths=(root:string)=>[`${root}/首页.md`,`${root}/测试/测试索引.md`,`${root}/收件箱/收件箱索引.md`];
export function planOrganization(files:string[],root:string,sessions:Session[]):Move[]{
  const result:Move[]=[],known=new Map(sessions.map(s=>[s.notePath,s]));
  const occupied=new Set(files.map(p=>p.normalize('NFC').toLocaleLowerCase()));
  const indexes=new Set(indexPaths(root));
  const move=(from:string,to:string,reason:string)=>{
    if(from===to)return;
    const ext=path.extname(to),stem=to.slice(0,-ext.length);let suffix=2,target=to;
    while(occupied.has(target.normalize('NFC').toLocaleLowerCase()))target=`${stem} (${suffix++})${ext}`;
    occupied.add(target.normalize('NFC').toLocaleLowerCase());result.push({from,to:target,reason});
  };
  for(const file of [...files].sort()){
    if(!/\.(md|canvas|srt)$/i.test(file)||indexes.has(file))continue;
    if(/\.(canvas|srt)$/.test(file)&&files.includes(file.replace(/\.(canvas|srt)$/,'.md')))continue;
    const relative=file.startsWith(`${root}/`)?file.slice(root.length+1):'';
    const session=known.get(file);
    // Preserve manually organized folders. Correct explicitly named test
    // sessions previously saved in our own monthly recording directory.
    if(relative&&managed.includes(relative.split('/')[0])&&!(session&&isTestSession(session)&&/^课堂记录\/\d{4}-\d{2}\//.test(relative)))continue;
    if(session){
      if(['starting','recording','paused','finishing'].includes(session.phase))continue;
      const created=new Date(session.created);
      const date=Number.isNaN(created.getTime())?new Date():created;
      const inheritedSample=/16秒/.test(session.title)&&session.duration>60;
      const title=inheritedSample?`法语课堂${session.reviewRequired?'（待校订）':''}`:undefined;
      const name=title?`${session.id} ${title}${path.extname(file)}`:path.basename(file);
      move(file,`${recordingFolder(root,session.title,date,isTestSession(session))}/${name}`,isTestSession(session)?'录音测试':'课堂录音');
      if(title){const item=result.find(m=>m.from===file);if(item){item.title=title;item.beforeTitle=session.title;}}
    }else if(/^LiveScribe\/课程笔记 2026-10-19 (07-26|11-37)\.md$/.test(file)){
      move(file,`${root}/测试/早期插件测试/${path.basename(file)}`,'早期插件测试');
    }else if(!file.includes('/')||relative){
      move(file,`${root}/收件箱/${relative||path.basename(file)}`,'散落笔记');
    }
  }
  // Keep exports beside their recording note, without overwriting namesakes.
  for(const note of [...result].filter(m=>m.from.endsWith('.md'))){
    for(const ext of ['.canvas','.srt']){
      const from=note.from.slice(0,-3)+ext;
      const existing=result.find(m=>m.from===from);
      if(existing)result.splice(result.indexOf(existing),1);
      if(files.includes(from))move(from,note.to.slice(0,-3)+ext,note.reason);
    }
  }
  return result;
}

export function mappedPath(value:string,moves:Move[]):string{return moves.find(m=>m.from===value)?.to||value;}
type Resolver=(target:string,source:string)=>string|undefined;
export function linkResolver(files:string[],external?:Resolver):Resolver{
  const set=new Set(files);
  return(target,source)=>{
    let raw:string;try{raw=decodeURIComponent(target);}catch{raw=target;}
    if(!raw||/^(?:[a-z][a-z\d+.-]*:|#)/i.test(raw))return;
    const cached=external?.(raw,source);if(cached&&set.has(cached))return cached;
    const candidates=[path.normalize(path.join(path.dirname(source),raw)),raw.replace(/^\//,'')];
    for(const candidate of candidates)for(const ext of ['', '.md','.canvas'])if(set.has(candidate+ext))return candidate+ext;
    const candidatesByName=files.filter(f=>path.basename(f)===raw||path.basename(f,'.md')===raw);
    return candidatesByName.length===1?candidatesByName[0]:undefined;
  };
}
export function rewriteMarkdown(text:string,source:string,moves:Move[],resolve:Resolver):string{
  const destination=mappedPath(source,moves);
  const wiki=(raw:string):string=>{
    const split=raw.indexOf('|'),target=split<0?raw:raw.slice(0,split),alias=split<0?'':raw.slice(split);
    const hash=target.indexOf('#'),file=hash<0?target:target.slice(0,hash),anchor=hash<0?'':target.slice(hash);
    const original=resolve(file,source);if(!original)return raw;
    const next=mappedPath(original,moves);
    if(original===next&&source===destination)return raw;
    const name=next.endsWith('.md')&&!file.endsWith('.md')?next.slice(0,-3):next;
    return `${name}${anchor}${alias}`;
  };
  const rewriteUrl=(url:string):string=>{
      const angle=url.startsWith('<'),raw=angle?url.slice(1,-1):url;
      const hash=raw.indexOf('#'),target=hash<0?raw:raw.slice(0,hash),anchor=hash<0?'':raw.slice(hash);
      const original=resolve(target,source);if(!original)return url;
      const next=mappedPath(original,moves);if(next===original&&destination===source)return url;
      const relative=path.relative(path.dirname(destination),next)||path.basename(next);
      return angle?`<${relative}${anchor}>`:encodeURI(relative).replace(/#/g,'%23')+anchor;
  };
  const inline=(s:string)=>s.replace(/\[\[([^\]\n]+)\]\]/g,(_,link:string)=>`[[${wiki(link)}]]`)
    .replace(/(!?\[[^\]\n]*\]\()(<[^>\n]+>|[^\s)]+)([^\n)]*\))/g,(_,prefix:string,url:string,suffix:string)=>prefix+rewriteUrl(url)+suffix)
    .replace(/^(\s{0,3}\[[^\]\n]+\]:\s*)(<[^>\n]+>|\S+)(.*)$/,(_,prefix:string,url:string,suffix:string)=>prefix+rewriteUrl(url)+suffix);
  let fence='';
  return text.split(/(\r?\n)/).map(line=>{
    const marker=line.match(/^\s{0,3}(`{3,}|~{3,})/);
    if(marker){if(!fence)fence=marker[1];else if(marker[1][0]===fence[0]&&marker[1].length>=fence.length)fence='';return line;}
    if(fence)return line;
    return line.split(/(`+[^`\n]*`+)/g).map((part,i)=>i%2?part:inline(part)).join('');
  }).join('');
}

export function rewriteText(file:TextFile,moves:Move[],resolve:Resolver):string{
  if(file.path.endsWith('.md')){
    let text=rewriteMarkdown(file.text,file.path,moves,resolve);const rename=moves.find(m=>m.from===file.path);
    if(rename?.title&&rename.beforeTitle){
      let heading=false,frontmatter=text.startsWith('---\n');
      text=text.split('\n').map((line,i)=>{
        if(i>0&&frontmatter&&line==='---')frontmatter=false;
        if(frontmatter&&line===`title: ${JSON.stringify(rename.beforeTitle)}`)return`title: ${JSON.stringify(rename.title)}`;
        if(!heading&&line===`# ${rename.beforeTitle}`){heading=true;return`# ${rename.title}`;}return line;
      }).join('\n');
    }
    return text;
  }
  if(file.path.endsWith('/session.json')){
    const session=JSON.parse(file.text) as Session;
    const rename=moves.find(m=>m.from===session.notePath);
    const next={...session,title:rename?.title&&session.title===rename.beforeTitle?rename.title:session.title,notePath:mappedPath(session.notePath,moves),journalPath:mappedPath(session.journalPath,moves),
      audio:session.audio.map(a=>({...a,path:mappedPath(a.path,moves)})),
      outline:rewriteMarkdown(session.outline,session.notePath,moves,resolve),
      draft:rewriteMarkdown(session.draft||'',session.notePath,moves,resolve)};
    return JSON.stringify(next)===JSON.stringify(session)?file.text:JSON.stringify(next,null,2);
  }
  if(file.path.endsWith('.canvas')){
    const canvas=JSON.parse(file.text),before=JSON.stringify(canvas);
    for(const node of canvas.nodes||[]){if(typeof node.file==='string')node.file=mappedPath(node.file,moves);if(typeof node.text==='string')node.text=rewriteMarkdown(node.text,file.path,moves,resolve);}
    return JSON.stringify(canvas)===before?file.text:JSON.stringify(canvas,null,2);
  }
  return file.text;
}

export const INDEX_START='<!-- lingua:index:start -->',INDEX_END='<!-- lingua:index:end -->';
export function updateIndex(existing:string,content:string):string{
  const a=existing.indexOf(INDEX_START),b=existing.indexOf(INDEX_END);
  const generated=`${INDEX_START}\n${content}\n${INDEX_END}`;
  if(a>=0&&b>a)return existing.slice(0,a)+generated+existing.slice(b+INDEX_END.length);
  if(existing.trim())throw new Error('导航文件已有手写内容且没有自动区域标记；已保留该文件。');
  return generated+'\n';
}
export function indexContents(files:string[],root:string):Record<string,string>{
  const [home,tests,inbox]=indexPaths(root),indexes=new Set([home,tests,inbox]);
  const notes=files.filter(f=>/\.(md|canvas)$/.test(f)&&!indexes.has(f)&&!f.includes('/资料/')&&!f.includes('/会话/')).sort();
  const course=notes.filter(f=>f.startsWith(`${root}/课程/`));
  const records=notes.filter(f=>f.startsWith(`${root}/课堂记录/`));
  const experiments=notes.filter(f=>f.startsWith(`${root}/测试/`));
  const incoming=notes.filter(f=>f.startsWith(`${root}/收件箱/`));
  const other=notes.filter(f=>![...course,...records,...experiments,...incoming].includes(f));
  const link=(p:string)=>`[[${p.replace(/\.md$/,'')}|${path.basename(p).replace(/\.(md|canvas)$/,'')}]]`;
  const list=(items:string[],empty:string)=>items.length?items.map(p=>`- ${link(p)}`).join('\n'):`_${empty}_`;
  const testReports=experiments.filter(p=>!p.includes('/录音测试/')&&!p.includes('/早期插件测试/'));
  const testRecordings=experiments.filter(p=>!testReports.includes(p));
  return{
    [home]:`# 笔记首页\n\n课程、课堂记录和测试已分开。工作台右上角可一键整理；命令面板可撤销最近一次整理。\n\n## 课程与复习\n\n${list(course,'课程资料会放在这里。')}\n\n## 课堂记录\n\n${list(records,'下一次正式录音会自动保存在课堂记录中。')}\n\n## 收件箱\n\n${link(inbox)} · ${incoming.length} 份待归类笔记\n\n## 测试归档\n\n${link(tests)} · ${experiments.length} 份测试记录与报告\n\n${other.length?`## 其他笔记\n\n${list(other,'')}\n\n`:''}原始录音与会话恢复数据保存在 \`${root}/会话\`；课程资料保留在各课程的“资料”目录。`,
    [tests]:`# 测试归档\n\n测试结果供调试核对，不作为正式课程结论。\n\n## 对照报告\n\n${list(testReports,'暂无测试报告。')}\n\n## 录音与早期插件测试\n\n${list(testRecordings,'暂无录音测试。')}\n\n返回 ${link(home)}`,
    [inbox]:`# 收件箱\n\n这些笔记已保留，待你决定归属。\n\n${list(incoming,'目前没有散落笔记。')}\n\n返回 ${link(home)}`
  };
}
