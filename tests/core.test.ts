import {test} from 'node:test';
import assert from 'node:assert/strict';
import {newMarkdown,updateMarkdown,canvasData,srt,stripOverlap,safeName,outlineTree,isNonSpeech} from '../src/core';
import {demoSession} from '../src/demo';
import {Chunker,Resampler,encodeWav} from '../src/audio';
test('自动整理更新保留前后手写内容，标记被移除后拒绝覆盖',()=>{
  const s=demoSession();let note=newMarkdown(s).replace('## 我的笔记','我的手写内容：重要！\n\n## 我的笔记')+'\n手写补充：复习例句。';
  s.outline='### 更新后的主题\n- 新知识';const updated=updateMarkdown(note,s);
  assert.match(updated,/我的手写内容：重要/);assert.match(updated,/手写补充：复习例句/);assert.match(updated,/更新后的主题/);
  assert.throws(()=>updateMarkdown('用户主动移除了自动区',s),/未覆盖/);
});
test('停止时不足一秒的尾音仍生成有效 WAV，连续音频不重叠不丢样',()=>{
  const chunks:any[]=[];const c=new Chunker(6,x=>chunks.push(x));const input=Float32Array.from({length:16000*13+123},(_,i)=>Math.sin(i/20)*0.3);
  for(let i=0;i<input.length;i+=2048)c.push(input.slice(i,i+2048));c.flush();
  assert.equal(chunks.reduce((n,c)=>n+c.samples.length,0),input.length);
  assert.equal(chunks[0].start,0);for(let i=1;i<chunks.length;i++)assert.equal(chunks[i].start,chunks[i-1].end);
  assert.equal(chunks.at(-1).end,input.length/16000);
  const wav=encodeWav(chunks.at(-1).samples);assert.equal(new DataView(wav).getUint32(40,true),chunks.at(-1).samples.length*2);
});
test('48kHz worklet 小块跨帧重采样一整分钟的时间漂移小于一个采样',()=>{
  const resampler=new Resampler(48000);let output=0;
  for(let i=0;i<48000*60;i+=128)output+=resampler.push(new Float32Array(Math.min(128,48000*60-i))).length;
  assert.ok(Math.abs(output-16000*60)<=1,`received ${output}`);
});
test('自然停顿提前提交，重复语句保留，Canvas 和 SRT 可独立读取',()=>{
  const list:any[]=[];const c=new Chunker(6,x=>list.push(x));c.push(new Float32Array(16000*2).fill(.2));c.push(new Float32Array(16000));c.flush();assert.ok(list.length>=1);assert.ok(list[0].end<=3);
  assert.equal(stripOverlap('Bonjour.','Bonjour.'),'Bonjour.');
  const s=demoSession();const canvas=canvasData(s) as any;assert.ok(canvas.nodes.length>2);assert.equal(canvas.edges.length,canvas.nodes.length-1);
  assert.match(srt(s),/00:00:00,000 --> 00:00:22,000/);assert.match(srt(s),/今天/);assert.equal(safeName('../bad:name'), 'bad name');
  assert.equal(outlineTree('### Sujet\n- idée')[0].label,'Sujet');
});
test('音乐与噪声标签不进入笔记，正常中法语句不被过滤',()=>{
  for(const text of ['[Musique]','(Bourdonnement)','[Propos inaudibles]','♪ ♫'])assert.equal(isNonSpeech(text),true,text);
  for(const text of ['La France accueille des touristes.','这是中文讲解。','Le tourisme représente environ 8 %.'])assert.equal(isNonSpeech(text),false,text);
});
