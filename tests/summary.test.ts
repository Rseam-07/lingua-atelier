import{test}from'node:test';import assert from'node:assert/strict';
import{Providers}from'../src/providers';import{DEFAULTS,type Segment}from'../src/types';import{usefulForNotes}from'../src/notes';
const segments:Segment[]=[{id:0,start:8,end:16,source:'Un édifice construit en 1883.',translation:'这座建筑建于1883年。',status:'done'},{id:1,start:16,end:24,source:"La façade menace de s'effondrer.",translation:'立面有倒塌风险。',status:'done'}];
test('整理可以压缩改写，但必须引用存在的原文和编号，不接纳新增数字',async()=>{
  const p=new Providers({...DEFAULTS},()=> '');
  p.chat=async()=>JSON.stringify({topics:[{title:'建筑现状',points:[
    {text:'建筑建于1883年；目前立面存在倒塌风险。',sources:[0,1],evidence:[{id:0,quote:'construit en 1883'},{id:1,quote:"menace de s'effondrer"}]},
    {text:'有100人受伤。',sources:[0],evidence:[{id:0,quote:'construit en 1883'}]},
    {text:'凭空编造。',sources:[999]},
    {text:'没有真实引文。',sources:[1],evidence:[{id:1,quote:'not in the audio'}]}
  ]}]});
  const result=await p.summarize('',segments,{notePath:'Lingua/课堂.md'});
  assert.match(result,/目前立面存在倒塌风险/);assert.doesNotMatch(result,/100|凭空|没有真实/);assert.match(result,/\[\[Lingua\/课堂#00:08\|00:08\]\]/);p.dispose();
});
test('已有要点通过编号保留并压缩，重复话语不会不断追加到笔记',async()=>{
  const p=new Providers({...DEFAULTS},()=> '');
  p.chat=async(system,user)=>{assert.match(system,/允许忠实概括和重写/);assert.match(user,/1883年/);return JSON.stringify({topics:[{title:'建筑现状',points:[{text:'建于1883年的建筑立面有倒塌风险。',previous:[0],sources:[1],evidence:[{id:1,quote:"La façade menace de s'effondrer."}]}]}]});};
  const result=await p.summarize('### 建筑\n- 建于1883年 · [00:08]',segments.slice(1));
  assert.equal(result.split('\n').filter(l=>l.startsWith('- ')).length,1);assert.match(result,/\[00:08\]/);p.dispose();
});
test('无信息时保留旧笔记；无效来源不会覆盖已有笔记',async()=>{
  const p=new Providers({...DEFAULTS},()=> '');p.chat=async()=>'{"topics":[]}';
  const prior='### 已有主题\n- 已有要点';assert.equal(await p.summarize(prior,segments),prior);
  p.chat=async()=>'{"topics":[{"title":"主题","points":[{"text":"新话","sources":[999]}]}]}';
  await assert.rejects(p.summarize(prior,segments),/没有有效的原文证据/);p.dispose();
});
test('填充词和识别器泄露的翻译指令不进入课程整理',()=>{
  for(const source of ['Oui.','啊，嗯。','将本段法语忠实译成简体中文，只输出本段译文。'])assert.equal(usefulForNotes({...segments[0],source}),false);
  assert.equal(usefulForNotes({...segments[0],source:'Les visiteurs quittent leur environnement habituel.'}),true);
});
test('真实跨批次情形：后半节只返回新分类时，前半节旅游供需主题仍保留',async()=>{
 const p=new Providers({...DEFAULTS},()=> '');
 p.chat=async()=>JSON.stringify({topics:[{title:'访问者分类',points:[{text:'立面存在倒塌风险。',sources:[1],evidence:[{id:1,quote:"menace de s'effondrer"}]}]}]});
 const prior='### 旅游供需\n- 大众旅游推动供需结构变化。 · [01:20]\n\n### 历史\n- 建筑建于1883年。 · [00:08]';
 const result=await p.summarize(prior,segments.slice(1));assert.match(result,/大众旅游推动供需结构变化/);assert.match(result,/建筑建于1883年/);assert.match(result,/立面存在倒塌风险/);p.dispose();
});
