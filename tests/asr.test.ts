import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer,type IncomingMessage} from 'node:http';
import {Providers} from '../src/providers';
import {DEFAULTS} from '../src/types';

async function service(reply:(request:IncomingMessage,body:Buffer)=>any,run:(url:string)=>Promise<void>){
  const server=createServer(async(req,res)=>{
    const parts:Buffer[]=[];for await(const chunk of req)parts.push(chunk);
    res.setHeader('Content-Type','application/json');res.end(JSON.stringify(await reply(req,Buffer.concat(parts))));
  });
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  try{await run(`http://127.0.0.1:${(server.address()as any).port}`);}
  finally{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
}
const qwen=(text:string,languages=['fr'])=>({engine:'qwen3-asr',model_id:'Qwen3-ASR-1.7B',text,languages});
test('Qwen 请求走独立服务，整段音频保留；不误用 Whisper 的置信度字段',async()=>{
  await service((req,body)=>{
    assert.equal(req.url,'/inference');assert.match(body.toString(),/name="language"\r\n\r\nauto/);
    assert.doesNotMatch(body.toString(),/name="vad"|no_language_probabilities/);
    assert.ok(body.includes(Buffer.from([1,128,255])));
    return{...qwen('Je suis géographe. 这是中文。',['fr','zh']),segments:[{text:'wrong',avg_logprob:-5}]};
  },async url=>{
    const p=new Providers({...DEFAULTS,asrEngine:'qwen',qwenUrl:url,asrUrl:'http://127.0.0.1:1'},()=> '');
    assert.equal(await p.transcribe(Uint8Array.from([1,128,255]).buffer),'Je suis géographe. 这是中文。');p.dispose();
  });
});
test('Qwen 自动模式暂缓其他语言和缺失语言结果，保留显式英语识别能力',async()=>{
  for(const languages of [['en'],[]])await service(()=>qwen('Hello.',languages),async url=>{
    const p=new Providers({...DEFAULTS,asrEngine:'qwen',qwenUrl:url},()=> '');
    await assert.rejects(p.transcribe(new ArrayBuffer(0)),/未识别为法语或中文/);
    p.settings.language='en';assert.equal(await p.transcribe(new ArrayBuffer(0)),'Hello.');p.dispose();
  });
});
test('Qwen 拒绝把错误服务当成所选模型；数字静音空结果可通过',async()=>{
  let reply:any={text:'Bonjour.',status:'ok'};
  await service(()=>reply,async url=>{
    const p=new Providers({...DEFAULTS,asrEngine:'qwen',qwenUrl:url,llmUrl:url},()=> '');
    assert.equal((await p.health()).asr,false);
    await assert.rejects(p.transcribe(new ArrayBuffer(0)),/未返回 Qwen3-ASR/);
    reply={...qwen('',[]),status:'ok'};assert.equal((await p.health()).asr,true);
    assert.equal(await p.transcribe(new ArrayBuffer(0)),'');p.dispose();
  });
});
test('Whisper 回退保持弱人声开关和原来的语言概率保护',async()=>{
  await service((_req,body)=>{
    assert.match(body.toString(),/name="vad"\r\n\r\nfalse/);
    return{text:'wrong language',language:'english',language_probabilities:{fr:.1,en:.9}};
  },async url=>{
    const p=new Providers({...DEFAULTS,asrEngine:'whisper',asrUrl:url,preserveWeakSpeech:true},()=> '');
    await assert.rejects(p.transcribe(new ArrayBuffer(0)),/中法语检测不确定/);p.dispose();
  });
});
test('Qwen 双路一次上传；保留候选与真实分数，判断器只能选原文',async()=>{
  let requests=0;
  await service((_req,body)=>{
    requests++;assert.match(body.toString(),/name="mode"\r\n\r\ndual/);
    assert.ok(body.includes(Buffer.from([1,128,255])));
    return{engine:'qwen3-asr',model_id:'Qwen3-ASR-1.7B',mode:'dual',candidates:[{language:'fr',text:'Je parle français.',avg_logprob:-.2},{language:'zh',text:'车帕弗朗赛。',avg_logprob:-.4}]};
  },async url=>{
    const p=new Providers({...DEFAULTS,asrEngine:'qwen',qwenUrl:url},()=> '');
    p.chat=async()=>'{"choice":"fr"}';
    const r=await p.transcribeDual(Uint8Array.from([1,128,255]).buffer,'法语课堂');
    assert.equal(requests,1);assert.equal(r.text,'Je parle français.');assert.equal(r.comparison.reviewRequired,false);
    assert.equal(r.comparison.candidates[0].avgLogprob,-.2);assert.equal(r.comparison.candidates[1].text,'车帕弗朗赛。');p.dispose();
  });
});
test('Whisper 两路发出独立法语、中文请求；全程不改动用户语言设置',async()=>{
  const langs:string[]=[];let active=0,maxActive=0;
  await service(async(_req,body)=>{
    const language=body.toString().match(/name="language"\r\n\r\n(fr|zh)/)?.[1];assert.ok(language);langs.push(language);
    active++;maxActive=Math.max(maxActive,active);await new Promise(r=>setTimeout(r,20));active--;
    return{text:'Bonjour.',segments:[{text:'Bonjour.',avg_logprob:-.2,no_speech_prob:0}]};
  },async url=>{
    const p=new Providers({...DEFAULTS,asrEngine:'whisper',asrUrl:url},()=> '');
    p.chat=async()=>{throw new Error('agreement should skip judge');};
    const r=await p.transcribeDual(new ArrayBuffer(1),'');assert.equal(r.text,'Bonjour.');
    assert.deepEqual(langs.sort(),['fr','zh']);assert.equal(maxActive,2);assert.equal(p.settings.language,'auto');p.dispose();
  });
});
test('原音语言明确时不需要额外文字请求；旧 Qwen 服务不能悄悄退回单路',async()=>{
  let dual=true;
  await service(()=>dual?{engine:'qwen3-asr',model_id:'Qwen3-ASR-1.7B',mode:'dual',language_evidence:{method:'unforced-prefix-token',logprobs:{fr:-.1,zh:-8},margin:7.9,calibrated:false},candidates:[{language:'fr',text:'Bonjour.'},{language:'zh',text:'你好。'}]}:qwen('Bonjour.'),async url=>{
    const p=new Providers({...DEFAULTS,asrEngine:'qwen',qwenUrl:url,llmMode:'compatible'},()=> '');
    let calls=0;p.chat=async()=>{calls++;return'{"choice":"fr"}';};
    const r=await p.transcribeDual(new ArrayBuffer(0),'');assert.equal(calls,0);assert.equal(r.text,'Bonjour.');assert.equal(r.comparison.reviewRequired,false);
    dual=false;await assert.rejects(p.transcribeDual(new ArrayBuffer(0),''),/尚不支持/);p.dispose();
  });
});
test('课件词表默认只供翻译整理，避免短噪声复述词表；识别热词需显式开启',async()=>{
 const contexts:string[]=[];
 await service((_req,body)=>{contexts.push(body.toString().match(/name="context"\r\n\r\n([^\r]*)/)?.[1]||'');return qwen('Bonjour.');},async url=>{
  const p=new Providers({...DEFAULTS,asrEngine:'qwen',qwenUrl:url,glossary:'tourisme = 旅游业'},()=> '');
  await p.transcribe(new ArrayBuffer(1));p.settings.asrUseGlossary=true;await p.transcribe(new ArrayBuffer(1));
  assert.deepEqual(contexts,['','Chinese and French classroom vocabulary: tourisme']);p.dispose();
 });
});
