import {test} from 'node:test';
import assert from 'node:assert/strict';
import {LOCAL_MODELS,localModel,modelRequest} from '../src/model-catalog';
import {LocalModels,type ModelStorage} from '../src/local-models';
import {encodeWav} from '../src/audio';
import {decodePcmWav} from '../src/pcm';
import {Providers} from '../src/providers';
import {DEFAULTS} from '../src/types';
import {configureDesktop} from '../src/runtime';
import {configureMobileTransport} from '../src/http';
import {base64,cloudTranscribe} from '../src/cloud';

test('本地录音保留原始 PCM 电平、样本数与语言模型输入格式；无效 WAV 被拒绝',()=>{
  const source=Float32Array.from([-.8,0,.4,.99]);const decoded=decodePcmWav(encodeWav(source));
  assert.equal(decoded.length,source.length);source.forEach((value,i)=>assert.ok(Math.abs(value-decoded[i])<2/32768));
  assert.throws(()=>decodePcmWav(new ArrayBuffer(5)),/WAV/);
  assert.throws(()=>decodePcmWav(encodeWav(source,48000)),/16 kHz/);
});
test('模型地址只允许固定仓库、版本和文件；不能从模型请求读取笔记或任意网址',()=>{
  for(const model of LOCAL_MODELS){assert.match(model.revision,/^[a-f0-9]{40}$/);for(const file of model.files){if(file.path.endsWith('.onnx'))assert.match(file.sha256!,/^[a-f0-9]{64}$/);assert.equal(modelRequest(`https://huggingface.co/${model.repo}/resolve/${model.revision}/${file.path}`)?.model.id,model.id);}}
  for(const url of ['https://example.com/secret','file:///private/note','https://huggingface.co/Xenova/whisper-tiny/resolve/main/config.json','https://huggingface.co/Xenova/whisper-tiny/resolve/5332fcc35e32a33b86612b9a57a89be7906102b1/../../note.md'])assert.equal(modelRequest(url),null);
});
function memory(){const files=new Map<string,string|ArrayBuffer>();const storage:ModelStorage={exists:async path=>files.has(path),mkdir:async path=>{files.set(path,'');},read:async path=>{const value=files.get(path);if(typeof value!=='string')throw Error('missing');return value;},write:async(path,value)=>{files.set(path,value);},readBinary:async path=>{const value=files.get(path);if(!(value instanceof ArrayBuffer))throw Error('missing');return value.slice(0);},writeBinary:async(path,value)=>{files.set(path,value);},remove:async path=>{files.delete(path);}};return{storage,files};}
test('中断与校验失败不标记模型完成，重试复用已完成的配置文件',async()=>{
  const m=memory(),calls:string[]=[];
  const models=new LocalModels(m.storage,'.plugin/models',async url=>{calls.push(url);return new TextEncoder().encode(url.endsWith('.json')?'{}':'wrong weight').buffer;});
  assert.equal(await models.ready('whisper-tiny'),false);assert.equal(calls.length,0);
  await assert.rejects(models.install('whisper-tiny',()=>{},new AbortController().signal),/校验失败/);
  assert.equal(await models.ready('whisper-tiny'),false);assert.ok(![...m.files.keys()].some(p=>p.endsWith('/ready.json')));
  const count=calls.length;await assert.rejects(models.install('whisper-tiny',()=>{},new AbortController().signal),/校验失败/);
  assert.equal(calls.length-count,1,'Retry must keep the verified JSON assets');
});
test('纯本地模式检查与识别不访问网络；启动前要求模型已经下载',async()=>{
  configureDesktop(false);const traffic:string[]=[];configureMobileTransport(async url=>{traffic.push(url);throw Error('network forbidden');});
  const calls:string[]=[],local={ready:async(id:string)=>id==='whisper-base'||id==='qwen-text-0.5b',warm:async(id:string)=>{calls.push('load:'+id);},transcribe:async()=> 'Bonjour.',chat:async()=> '你好。'};
  const p=new Providers({...DEFAULTS,asrEngine:'ondevice',llmMode:'ondevice'},()=>'',()=>'',local);
  await p.ensure(()=>{});assert.equal(await p.transcribe(encodeWav(new Float32Array(1600))),'Bonjour.');assert.equal(await p.translate('Bonjour.',''),'你好。');assert.equal(traffic.length,0);assert.deepEqual(calls,['load:whisper-base']);p.dispose();
});
test('在线识别先检查明确选择与密钥，再发出正确的 WAV 请求，不上传未同意的录音',async()=>{
  configureDesktop(false);const calls:{url:string;body:any}[]=[];
  configureMobileTransport(async(url,options)=>{calls.push({url,body:JSON.parse(options.body as string)});return{status:200,text:JSON.stringify({choices:[{finish_reason:'stop',message:{content:'Bonjour. 你好。'}}]})};});
  const wav=encodeWav(new Float32Array(16)),options={region:'cn' as const,key:'synthetic-key',language:'auto',consent:false,signal:new AbortController().signal};
  await assert.rejects(cloudTranscribe(wav,options),/确认/);assert.equal(calls.length,0);
  await assert.rejects(cloudTranscribe(wav,{...options,consent:true,key:''}),/API Key/);assert.equal(calls.length,0);
  assert.equal(await cloudTranscribe(wav,{...options,consent:true}),'Bonjour. 你好。');
  assert.equal(calls[0].body.model,'qwen3-asr-flash');assert.ok(!('language'in calls[0].body.asr_options));
  const encoded=calls[0].body.messages[0].content[0].input_audio.data;assert.ok(Buffer.from(encoded.split(',')[1],'base64').equals(Buffer.from(wav)));
  assert.equal(base64(Uint8Array.from([0,128,255,4]).buffer),'AID/BA==');
});
