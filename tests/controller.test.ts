import {test}from'node:test';import assert from'node:assert/strict';
import {Controller}from'../src/controller';import {DEFAULTS,type Chunk,type Session}from'../src/types';import{demoSession}from'../src/demo';import type{Store}from'../src/store';
const chunk=(start:number):Chunk=>({start,end:start+1,samples:new Float32Array(16000).fill(.2)});
function rig(){
  const writes:string[]=[];let emit!:(c:Chunk)=>void;const s={...demoSession(),id:'test',phase:'starting',segments:[],audio:[],outline:'',summaryVersion:0,demo:false} as Session;
  const store={folder:'Lingua',create:async()=>s,saveAudio:async(_:Session,_wav:ArrayBuffer,i:number)=>{writes.push(`audio-${i}`);return`audio-${i}`;},save:async()=>{writes.push('save');},readAudio:async()=>new ArrayBuffer(0)} as unknown as Store;
  const controller=new Controller({...DEFAULTS,summaryEvery:2,dualRecognition:false},store,()=>'',(_s,c)=>{emit=c;return{start:async()=>{},stop:async()=>{emit(chunk(2));},pause:async()=>{},resume:()=>{}};});
  let count=0;Object.assign(controller.providers,{ensure:async()=>{},transcribe:async()=>{const i=count++;await new Promise(r=>setTimeout(r,6));return`Phrase ${i}`;},translate:async(text:string)=>{await new Promise(r=>setTimeout(r,12));return`中文 ${text}`;},summarize:async(_:string,segs:any[])=>'### 主题\n- '+segs.map(x=>x.source).join(',')});
  return{controller,writes,emit:(c:Chunk)=>emit(c)};
}
test('停止会处理积压与最后一个尾块，且翻译按 ID 回填，停止幂等',async()=>{
  const r=rig();await r.controller.start('课堂');r.emit(chunk(0));r.emit(chunk(1));const a=r.controller.stop(),b=r.controller.stop();assert.equal(a,b);await a;
  const s=r.controller.session!;assert.equal(s.phase,'complete');assert.equal(s.audio.length,3);assert.equal(s.segments.length,3);
  assert.deepEqual(s.segments.map(x=>x.translation),['中文 Phrase 0','中文 Phrase 1','中文 Phrase 2']);assert.equal(s.summaryVersion,3);assert.ok(s.outline.includes('Phrase 2'));assert.equal(r.controller.pendingAsr,0);assert.equal(r.controller.pendingTranslation,0);await r.controller.dispose();
});
test('识别失败不影响原始录音持久化，后续片段照常处理',async()=>{
  const r=rig();let n=0;r.controller.providers.transcribe=async()=>{if(!n++)throw new Error('temporary offline');return'Bonjour';};
  await r.controller.start('课堂');r.emit(chunk(0));await r.controller.stop();assert.equal(r.controller.session!.audio.length,2);assert.equal(r.controller.session!.audio[0].status,'error');assert.equal(r.controller.session!.segments.length,1);await r.controller.dispose();
});
test('启动检查期间拒绝重复开始，服务未就绪时不触发麦克风',async()=>{
  const r=rig();let calls=0;r.controller.providers.ensure=async()=>{calls++;await new Promise(r=>setTimeout(r,10));throw new Error('service unavailable');};
  const p=r.controller.start('一');await r.controller.start('二');await assert.rejects(p,/service unavailable/);assert.equal(calls,1);assert.equal(r.controller.session,null);assert.equal(r.controller.busy,false);
});
test('低于停顿阈值的远处人声仍送入识别，语言不确定的片段保留音频且不污染摘要',async()=>{
  const r=rig();let calls=0;r.controller.providers.transcribe=async()=>{if(++calls===1)throw new Error('中法语检测不确定');return'Bonjour';};
  await r.controller.start('远处人声');r.emit({start:0,end:1,samples:new Float32Array(16000).fill(.0005)});await r.controller.stop();
  assert.equal(calls,2);assert.equal(r.controller.session!.audio.length,2);assert.equal(r.controller.session!.audio[0].status,'error');assert.deepEqual(r.controller.session!.segments.map(s=>s.source),['Bonjour']);await r.controller.dispose();
});
test('录音中按音频时长合并笔记更新，停止后补齐，记录真实阶段耗时',async()=>{
  const r=rig();let summaries=0;r.controller.providers.summarize=async()=>{summaries++;return'### 要点\n- 内容';};
  await r.controller.start('字幕优先');r.emit(chunk(0));r.emit(chunk(1));
  await new Promise(r=>setTimeout(r,65));assert.equal(summaries,0);
  await r.controller.stop();assert.equal(summaries,1);
  const metrics=r.controller.session!.metrics!;assert.equal(metrics.filter(m=>m.stage==='asr').length,3);assert.equal(metrics.filter(m=>m.stage==='translation').length,3);
  assert.ok(metrics.every(m=>m.durationMs>=0&&m.waitMs>=0));await r.controller.dispose();
});
test('重新翻译后只整理一次，不会清零版本再把整份笔记重复整理',async()=>{
  const r=rig();await r.controller.start('重整');r.emit(chunk(0));await r.controller.stop();let summaries=0;
  r.controller.providers.summarize=async()=>{summaries++;return'### 要点\n- 更新';};
  await r.controller.retry(true);assert.equal(summaries,1);assert.equal(r.controller.session!.summaryVersion,2);await r.controller.dispose();
});
test('整理期间先排空保存再移动文件，拒绝开始新录音，结束后恢复',async()=>{
  const r=rig();const events:string[]=[];
  (r.controller.store as any).flush=async()=>{events.push('flush');};
  let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;});
  const task=r.controller.maintain(async()=>{events.push('move');await gate;return 7;});
  assert.equal(r.controller.busy,true);await r.controller.start('不应开始');assert.equal(r.controller.session,null);
  release();assert.equal(await task,7);assert.deepEqual(events,['flush','move']);assert.equal(r.controller.busy,false);await r.controller.dispose();
});
test('双路自动稿与两候选保留，整理可使用原文，手动修订后重建',async()=>{
  const r=rig();r.controller.settings.dualRecognition=true;let calls=0;const summarized:string[]=[];
  r.controller.providers.transcribeDual=async()=>{
    const reviewRequired=calls++===0,text=reviewRequired?'Mauvais candidat.':'Bonjour.';
    return{text,comparison:{candidates:[{language:'fr',text},{language:'zh',text:reviewRequired?'中文候选。':text}],selected:'fr',reason:'对照',reviewRequired,method:reviewRequired?'context':'agreement',decodingMs:1,judgingMs:1}};
  };
  r.controller.providers.summarize=async(outline,segs)=>{summarized.push(...segs.map(s=>s.source));return outline+'\n'+segs.map(s=>s.source).join('\n');};
  await r.controller.start('双路实测');r.emit(chunk(0));await r.controller.stop();
  const s=r.controller.session!;assert.equal(s.audio.length,2);assert.equal(s.audio[0].recognition!.candidates[1].text,'中文候选。');
  assert.equal(s.segments[0].reviewRequired,true);assert.deepEqual(summarized,['Mauvais candidat.','Bonjour.']);assert.match(s.outline,/Mauvais/);
  await r.controller.acceptCandidate(s.audio[0].path,'zh');
  assert.equal(s.segments[0].source,'中文候选。');assert.equal(s.segments[0].reviewRequired,false);assert.match(s.outline,/中文候选/);assert.doesNotMatch(s.outline,/Mauvais/);await r.controller.dispose();
});
test('双路无法判断的片段不制造字幕，仍可从原音和候选恢复',async()=>{
  const r=rig();r.controller.settings.dualRecognition=true;
  r.controller.providers.transcribeDual=async()=>({text:'',comparison:{candidates:[{language:'fr',text:'Un, deux.'},{language:'zh',text:'安德。'}],selected:null,reason:'两路分歧',reviewRequired:true,method:'uncertain',decodingMs:1,judgingMs:1}});
  await r.controller.start('不确定');r.emit(chunk(0));await r.controller.stop();
  const s=r.controller.session!;assert.equal(s.audio.length,2);assert.equal(s.audio[0].status,'review');assert.equal(s.segments.length,0);assert.equal(s.outline,'');
  await r.controller.acceptCandidate(s.audio[0].path,'fr');assert.equal(s.segments[0].source,'Un, deux.');assert.equal(s.audio[0].status,'done');assert.equal(s.summaryVersion,1);await r.controller.dispose();
});
