// Bundled with the plugin. Neither executable JS nor WASM is fetched from a CDN.
import {pipeline,env} from '@huggingface/transformers';
declare const __ORT_WASM__:string;
declare const __ORT_LOADER__:string;
const scope=globalThis as any;
let pipe:any=null,kind='',fileId=0;
const files=new Map<number,{resolve:(r:Response)=>void;reject:(e:Error)=>void}>();
env.allowLocalModels=false;env.useBrowserCache=false;env.useFSCache=false;
const wasm=env.backends.onnx.wasm!;
wasm.numThreads=1;wasm.proxy=false;
wasm.wasmBinary=Uint8Array.from(atob(__ORT_WASM__),c=>c.charCodeAt(0));
const loaderUrl=URL.createObjectURL(new Blob([__ORT_LOADER__],{type:'text/javascript'}));
wasm.wasmPaths={mjs:loaderUrl};
scope.fetch=(input:RequestInfo|URL):Promise<Response>=>new Promise((resolve,reject)=>{
  const url=typeof input==='string'?input:input instanceof URL?input.href:input.url;
  const id=++fileId;files.set(id,{resolve,reject});scope.postMessage({type:'file',id,url});
});
scope.onmessage=async(event:MessageEvent)=>{
  const m=event.data;
  if(m.type==='file'){
    const pending=files.get(m.id);if(!pending)return;files.delete(m.id);
    if(m.error)pending.reject(new Error(m.error));else pending.resolve(new Response(m.bytes||null,{status:m.status,headers:m.status===200?{'Content-Length':String(m.bytes.byteLength)}:{}}));return;
  }
  try{
    let result='';
    if(m.type==='load'){
      await pipe?.dispose();pipe=null;kind=m.model.kind;
      scope.postMessage({type:'progress',message:'正在初始化本地推理组件…'});
      pipe=await pipeline(kind==='speech'?'automatic-speech-recognition':'text-generation',m.model.repo,{revision:m.model.revision,device:'wasm',dtype:'q8',progress_callback:(p:any)=>{if(p.status==='initiate'||p.status==='done')scope.postMessage({type:'progress',message:`正在加载本地文件：${p.file||'模型'}`});}});
    }else if(m.type==='speech'){
      if(!pipe||kind!=='speech')throw new Error('语音模型尚未加载。');
      const out=await pipe(m.samples,{task:'transcribe',...(m.language==='auto'?{}:{language:{fr:'french',en:'english',zh:'chinese'}[m.language as string]||m.language}),return_timestamps:false,max_new_tokens:256});
      result=String(out?.text||'').trim();
    }else if(m.type==='text'){
      if(!pipe||kind!=='text')throw new Error('文字模型尚未加载。');
      const messages=[{role:'system',content:m.system},{role:'user',content:m.user}];
      const prompt=pipe.tokenizer.apply_chat_template(messages,{tokenize:false,add_generation_prompt:true});
      const length=pipe.tokenizer.encode(prompt).length;
      if(length>4096)throw new Error('这批内容超过轻量文字模型的处理范围，请分批整理或选择在线文字服务。');
      const out=await pipe(prompt,{max_new_tokens:m.maxTokens,do_sample:false,return_full_text:false});
      result=String(out?.[0]?.generated_text||'').trim();
    }else throw new Error('未知的本地处理操作。');
    scope.postMessage({id:m.id,result});
  }catch(e){scope.postMessage({id:m.id,error:e instanceof Error?e.message:'本地模型运行失败，请选择更小的模型或在线服务。'});}
};
