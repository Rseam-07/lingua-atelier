import {test}from'node:test';import assert from'node:assert/strict';
import {LanguageQueue}from'../src/language-queue';
const gate=()=>{let resolve!:()=>void;const promise=new Promise<void>(r=>resolve=r);return{promise,resolve};};
test('积压字幕先于已排队的笔记整理，drain 等待全部工作完成',async()=>{
  const q=new LanguageQueue(),first=gate(),events:string[]=[];
  q.translate(async()=>{await first.promise;events.push('caption-1');});
  q.summarize(async()=>{events.push('notes');});
  q.translate(async()=>{events.push('caption-2');});
  let drained=false;const idle=q.drain().then(()=>{drained=true;});assert.equal(drained,false);
  first.resolve();await idle;assert.deepEqual(events,['caption-1','caption-2','notes']);
});
test('新字幕中断正在进行的低优先级整理，字幕无需等整理生成完毕',async()=>{
  const q=new LanguageQueue(),events:string[]=[];
  q.summarize(async signal=>{events.push('notes-start');await new Promise<void>(r=>signal.addEventListener('abort',()=>{events.push('notes-cancel');r();},{once:true}));});
  q.translate(async()=>{events.push('caption');});await q.drain();
  assert.deepEqual(events,['notes-start','notes-cancel','caption']);
});
test('远程整理不被连续字幕取消，也不阻塞字幕，drain 等待两者',async()=>{
 const q=new LanguageQueue(()=>true),notes=gate(),events:string[]=[];
 q.summarize(async signal=>{events.push('notes-start');await notes.promise;assert.equal(signal.aborted,false);events.push('notes-done');});
 for(let i=0;i<5;i++){q.interruptSummary();q.translate(async()=>{events.push(`caption-${i}`);});}
 let done=false;const drained=q.drain().then(()=>{done=true;});await new Promise(r=>setTimeout(r,1));assert.equal(done,false);assert.equal(events.length,6);
 notes.resolve();await drained;assert.equal(events.at(-1),'notes-done');
});
