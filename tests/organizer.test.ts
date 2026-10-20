import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Organizer,type OrganizerHost} from '../src/organizer';
import {isTestTitle,isTestSession,planOrganization,recordingFolder,linkResolver,rewriteMarkdown,updateIndex,INDEX_START,INDEX_END} from '../src/organize-core';
import {demoSession} from '../src/demo';

function fixture(){
  const note='Lingua/20261019-160315 french-test.md';
  const s={...demoSession(),id:'t',title:'french-test',notePath:note,journalPath:'Lingua/会话/t/session.json',audio:[{path:'Lingua/会话/t/audio/00000.wav',start:0,end:8,status:'done'}],outline:`### 要点\n- 已有译文 · [[${note.slice(0,-3)}#00:00|00:00]]`};
  const data=new Map<string,string>([
    [note,`# 测试\n\n[[${note.slice(0,-3)}#00:00|来源]]\n![[Lingua/会话/t/audio/00000.wav]]`],
    ['Lingua/会话/t/session.json',JSON.stringify(s)],['Lingua/会话/t/audio/00000.wav','BINARY'],
    ['欢迎.md','[[创建链接]]\n![图片](asset.png)\n[录音](<Lingua/20261019-160315 french-test.md#00:00>)'],
    ['创建链接.md','手写内容'],['asset.png','IMAGE'],
    ['Lingua/课程/旅游/00 课程笔记.md','# 正式课程\n原有手写内容'],
    ['链接.canvas',JSON.stringify({nodes:[{type:'file',file:note}],edges:[]})]
  ]);
  const host:OrganizerHost={files:()=>[...data.keys()].filter(p=>!p.startsWith('.')),exists:async p=>data.has(p),read:async p=>{if(!data.has(p))throw new Error(`Missing ${p}`);return data.get(p)!;},write:async(p,t)=>{data.set(p,t);},mkdir:async()=>{},move:async(from,to)=>{assert.ok(data.has(from));assert.ok(!data.has(to));data.set(to,data.get(from)!);data.delete(from);},remove:async p=>{data.delete(p);}};
  return{data,host,note,organizer:new Organizer(host,'Lingua','.history')};
}
test('强规则区分录音测试；正式课程与已有手工目录保留，同名文件不覆盖',()=>{
  assert.equal(isTestTitle('课堂录音实测（节选）'),true);
  assert.equal(isTestTitle('旅游景点分析'),false);
  assert.equal(isTestTitle('中法双路核对测试-48秒'),true);
  assert.equal(isTestTitle('双路教学课堂'),false);
  assert.equal(recordingFolder('Lingua','旅游课程',new Date(2026,9,20)),'Lingua/课堂记录/2026-10');
  const from='Lingua/测试录音.md',target='Lingua/测试/录音测试/测试录音.md';
  const files=[from,target,'Lingua/课程/课程.md','个人资料/文章.md'];
  const s={...demoSession(),title:'测试录音',notePath:from};
  const plan=planOrganization(files,'Lingua',[s]);assert.equal(plan.length,1);assert.equal(plan[0].to,'Lingua/测试/录音测试/测试录音 (2).md');
});
test('明确命名的双路测试从自动课堂目录归档，正式月度记录保留',()=>{
  const from='Lingua/课堂记录/2026-10/测试音轨.md',formal='Lingua/课堂记录/2026-10/法语课堂.md';
  const test={...demoSession(),phase:'complete' as const,title:'中法双路核对测试-48秒',duration:48,notePath:from};
  const lesson={...test,title:'法语课堂',notePath:formal};
  const plan=planOrganization([from,formal],'Lingua',[test,lesson]);
  assert.equal(plan.length,1);assert.equal(plan[0].from,from);assert.match(plan[0].to,/测试\/录音测试/);
});
test('录音中的文件不移动；实际长课堂沿用短测试标题也不会被当成测试归档',()=>{
  const file='Lingua/课堂片段-地理与学科-16秒.md';
  const session={...demoSession(),title:'课堂片段-地理与学科-16秒',notePath:file,duration:600,phase:'recording' as const};
  assert.equal(isTestSession(session),false);assert.deepEqual(planOrganization([file],'Lingua',[session]),[]);
  const completed={...session,phase:'complete' as const};const moves=planOrganization([file],'Lingua',[completed]);
  assert.match(moves[0].to,/课堂记录/);assert.match(moves[0].to,/法语课堂\.md$/);assert.equal(moves[0].beforeTitle,session.title);assert.equal(isTestSession({...completed,duration:16}),true);
  assert.equal(isTestSession({...completed,title:'课堂录音实测（节选）',duration:240}),true);
});
test('Wiki、图片、Markdown 引用链接更新，代码示例和外链保留',()=>{
  const moves=[{from:'原稿.md',to:'Lingua/收件箱/原稿.md',reason:'test'},{from:'目标.md',to:'Lingua/课堂记录/目标.md',reason:'test'}];
  const input='[[目标#标题|显示名]]\n![图片](asset.png)\n[链接](目标.md#标题)\n[ref]: 目标.md "标题"\n[外部](https://example.com/a)\n`[[目标]]`\n```md\n[[目标]]\n```';
  const output=rewriteMarkdown(input,'原稿.md',moves,linkResolver(['原稿.md','目标.md','asset.png']));
  assert.match(output,/\[\[Lingua\/课堂记录\/目标#标题\|显示名\]\]/);
  assert.ok(output.includes('![图片](../../asset.png)'));assert.ok(output.includes('[链接](../%E8%AF%BE%E5%A0%82%E8%AE%B0%E5%BD%95/%E7%9B%AE%E6%A0%87.md#标题)'));
  assert.ok(output.includes('[ref]: ../%E8%AF%BE%E5%A0%82%E8%AE%B0%E5%BD%95/%E7%9B%AE%E6%A0%87.md "标题"'));
  assert.ok(output.includes('[外部](https://example.com/a)'));assert.ok(output.includes('`[[目标]]`'));assert.ok(output.includes('```md\n[[目标]]\n```'));
});
test('整理同步更新会话、Canvas、原音链接；重复整理不移动文件，撤销保留新增编辑',async()=>{
  const f=fixture(),before=new Map(f.data);const result=await f.organizer.organize();assert.equal(result.moved,4);
  const target='Lingua/测试/录音测试/20261019-160315 french-test.md';
  const session=JSON.parse(f.data.get('Lingua/会话/t/session.json')!);assert.equal(session.notePath,target);assert.match(session.outline,/测试\/录音测试/);assert.equal(session.audio[0].path,'Lingua/会话/t/audio/00000.wav');
  assert.equal(JSON.parse(f.data.get('Lingua/收件箱/链接.canvas')!).nodes[0].file,target);
  assert.equal(f.data.get('Lingua/课程/旅游/00 课程笔记.md'),before.get('Lingua/课程/旅游/00 课程笔记.md'));
  assert.equal((await f.organizer.organize()).moved,0);
  f.data.set(target,f.data.get(target)+'\n整理后新增的手写笔记');
  await f.organizer.undo();assert.ok(f.data.get(f.note)!.includes('整理后新增的手写笔记'));
  assert.equal(JSON.parse(f.data.get('Lingua/会话/t/session.json')!).notePath,f.note);
  assert.equal(JSON.parse(f.data.get('链接.canvas')!).nodes[0].file,f.note);
  assert.equal(f.data.get('创建链接.md'),before.get('创建链接.md'));
  assert.equal((await f.organizer.organize()).moved,4);
});
test('中途写入失败会回退文件位置和链接，原内容保持，备份记录可查',async()=>{
  const f=fixture(),before=new Map(f.data),write=f.host.write;let failed=false;
  f.host.write=async(p,t)=>{if(p.endsWith('/session.json')&&!failed){failed=true;throw new Error('simulated disk failure');}await write(p,t);};
  await assert.rejects(f.organizer.organize(),/simulated disk failure/);
  for(const [p,text]of before)assert.equal(f.data.get(p),text,p);
  assert.ok([...f.data.keys()].some(p=>p.startsWith('.history/')));
});
test('撤销发现原位置新增同名文件时完整保留双方，不执行部分覆盖',async()=>{
  const f=fixture();await f.organizer.organize();f.data.set(f.note,'后来新建的内容');
  await assert.rejects(f.organizer.undo(),/同名文件/);assert.equal(f.data.get(f.note),'后来新建的内容');assert.ok(f.data.has('Lingua/测试/录音测试/20261019-160315 french-test.md'));
});
test('首页只更新自动区域，不覆盖手写正文；无标记的已有文件拒绝覆盖',()=>{
  const original=`手写前言\n${INDEX_START}\n旧索引\n${INDEX_END}\n手写补充`;
  const result=updateIndex(original,'新索引');assert.ok(result.startsWith('手写前言\n'));assert.ok(result.endsWith('\n手写补充'));assert.ok(result.includes('新索引'));
  assert.throws(()=>updateIndex('用户自己的首页','新索引'),/已有手写内容/);
});
test('正式长课堂修正沿用的短测试标题，撤销恢复原题并保留后来编辑',async()=>{
  const f=fixture(),journal='Lingua/会话/t/session.json';const s=JSON.parse(f.data.get(journal)!);
  Object.assign(s,{title:'课堂片段-地理与学科-16秒',duration:839,phase:'complete',reviewRequired:true});f.data.set(journal,JSON.stringify(s));
  f.data.set(f.note,`---\ntitle: ${JSON.stringify(s.title)}\n---\n\n# ${s.title}\n\n手写原文`);
  await f.organizer.organize();const saved=JSON.parse(f.data.get(journal)!);
  assert.equal(saved.title,'法语课堂（待校订）');assert.equal(saved.reviewRequired,true);assert.match(saved.notePath,/课堂记录/);assert.match(f.data.get(saved.notePath)!,/# 法语课堂（待校订）/);
  f.data.set(saved.notePath,f.data.get(saved.notePath)+'\n新增手写内容');
  await f.organizer.undo();const restored=JSON.parse(f.data.get(journal)!);
  assert.equal(restored.title,s.title);assert.equal(restored.notePath,f.note);assert.match(f.data.get(f.note)!,/# 课堂片段-地理与学科-16秒/);assert.ok(f.data.get(f.note)!.includes('新增手写内容'));
});
test('课程内容备份不能覆盖当前会话分类，也不会被归档改写',async()=>{
 const f=fixture(),snapshot='Lingua/会话/t/versions/old/session.json',note='Lingua/会话/t/versions/old/note.md';
 const old=JSON.parse(f.data.get('Lingua/会话/t/session.json')!);old.title='旧正式课题';
 const original=JSON.stringify(old);f.data.set(snapshot,original);f.data.set(note,`旧备份 [[${f.note}]]`);const before=f.data.get(note);
 await f.organizer.organize();
 assert.match(JSON.parse(f.data.get('Lingua/会话/t/session.json')!).notePath,/测试\/录音测试/);
 assert.equal(f.data.get(snapshot),original);assert.equal(f.data.get(note),before);
});
