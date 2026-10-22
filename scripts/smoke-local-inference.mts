// Optional real-weight smoke check. Downloads are separate and user initiated.
// Runs the shipped WASM backend without process or a network transport. Node's
// Blob/Response implementations still require their host Buffer infrastructure.
import {Worker} from 'node:worker_threads';
import {readFile,writeFile} from 'node:fs/promises';
import {LOCAL_MODELS,modelRequest} from '../src/model-catalog.ts';
const base=new URL('../artifacts/local-inference/',import.meta.url);
const wrapper=`const {parentPort,workerData}=require('node:worker_threads');
const NativeBlob=Blob,NodeBuffer=Buffer;
class TestBlob extends NativeBlob{constructor(parts,options){super(parts,options);this.parts=parts;}}
globalThis.Blob=TestBlob;
URL.createObjectURL=blob=>'data:text/javascript;base64,'+NodeBuffer.from(blob.parts.join('')).toString('base64');
URL.revokeObjectURL=()=>{};
globalThis.self={constructor:{name:'DedicatedWorkerGlobalScope'}};
globalThis.location={href:'http://localhost/local-worker.js',origin:'http://localhost'};
globalThis.self.location=globalThis.location;
globalThis.postMessage=message=>parentPort.postMessage(message);
globalThis.navigator={hardwareConcurrency:1};
globalThis.process=undefined;
parentPort.on('message',message=>globalThis.onmessage({data:message}));
eval(workerData);`;
const worker=new Worker(wrapper,{eval:true,workerData:await readFile(new URL('../dist/local-worker.js',import.meta.url),'utf8')});
let id=0;const pending=new Map<number,{resolve:(value:string)=>void;reject:(error:Error)=>void}>();
worker.on('message',async m=>{
  if(m.type==='file'){
    const target=modelRequest(m.url);
    if(!target){worker.postMessage({type:'file',id:m.id,status:404});return;}
    try{const data=await readFile(new URL(`models/${target.model.id}/${target.file.path}`,base));const bytes=data.buffer.slice(data.byteOffset,data.byteOffset+data.byteLength);worker.postMessage({type:'file',id:m.id,status:200,bytes},[bytes]);}catch{worker.postMessage({type:'file',id:m.id,status:404});}return;
  }
  const p=pending.get(m.id);if(!p)return;pending.delete(m.id);if(m.error)p.reject(Error(m.error));else p.resolve(m.result);
});
worker.on('error',error=>{console.error(String(error.stack).split('\n').map(line=>line.slice(0,320)).join('\n'));for(const p of pending.values())p.reject(Error(error.message.slice(0,800)));pending.clear();});
const request=(payload:object):Promise<string>=>new Promise((resolve,reject)=>{const seq=++id;pending.set(seq,{resolve,reject});worker.postMessage({id:seq,...payload});});
const results:object[]=[];
try{
  for(const name of ['whisper-tiny','qwen-text-0.5b']){
    const model=LOCAL_MODELS.find(m=>m.id===name)!;const started=performance.now();
    await request({type:'load',model});const loaded=performance.now()-started;
    let result:string;
    if(model.kind==='speech'){
      let samples=new Float32Array(16000*2);
      try{const pcm=await readFile(new URL('sample.pcm',base));samples=new Float32Array(pcm.byteLength/4);new Uint8Array(samples.buffer).set(pcm);}catch{}
      result=await request({type:'speech',samples,language:'fr'});
    }else result=await request({type:'text',system:'将法语忠实译成简体中文，只输出译文。',user:"Bonjour, je suis étudiant. J'apprends le français.",maxTokens:80});
    const entry={model:name,loadMs:Math.round(loaded),inferenceMs:Math.round(performance.now()-started-loaded),result};results.push(entry);console.log(JSON.stringify(entry));
  }
  await writeFile(new URL('smoke-result.json',base),JSON.stringify({noNetwork:true,webWasmBackend:true,results},null,2));
}finally{await worker.terminate();}
