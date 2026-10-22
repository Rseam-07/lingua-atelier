import {localModel,modelRequest,type LocalModel,type ModelFile} from './model-catalog';
import {decodePcmWav} from './pcm';

declare const __LOCAL_WORKER__:string;
export interface ModelStorage {
  exists(path:string):Promise<boolean>;mkdir(path:string):Promise<void>;
  read(path:string):Promise<string>;write(path:string,data:string):Promise<void>;
  readBinary(path:string):Promise<ArrayBuffer>;writeBinary(path:string,data:ArrayBuffer):Promise<void>;
  remove(path:string):Promise<void>;
}
export interface DownloadProgress {message:string;loaded:number;total:number;}
export type ModelDownload=(url:string,onBytes:(loaded:number,total:number)=>void,signal:AbortSignal)=>Promise<ArrayBuffer>;
export interface LocalInference {
  ready(id:string):Promise<boolean>;warm(id:string,signal?:AbortSignal):Promise<void>;
  transcribe(id:string,wav:ArrayBuffer,language:string,signal?:AbortSignal):Promise<string>;
  chat(id:string,system:string,user:string,maxTokens:number,signal?:AbortSignal):Promise<string>;
}
const hash=async(bytes:ArrayBuffer):Promise<string>=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
export class LocalModels implements LocalInference {
  private worker:Worker|null=null;private workerUrl='';private active='';private sequence=0;
  private pending=new Map<number,{resolve:(value:string)=>void;reject:(error:Error)=>void}>();
  private queue:Promise<unknown>=Promise.resolve();private downloading=false;
  private loadingStatus:((message:string)=>void)|undefined;
  constructor(private storage:ModelStorage,public directory:string,private download:ModelDownload){}
  private root(model:LocalModel):string{return`${this.directory}/${model.id}/${model.revision}`;}
  private async mkdir(path:string):Promise<void>{let cursor='';for(const p of path.split('/')){cursor=cursor?`${cursor}/${p}`:p;if(!await this.storage.exists(cursor))await this.storage.mkdir(cursor);}}
  async ready(id:string):Promise<boolean>{
    const model=localModel(id),root=this.root(model);
    try{const mark=JSON.parse(await this.storage.read(`${root}/ready.json`));if(mark.revision!==model.revision)return false;return(await Promise.all(model.files.map(f=>this.storage.exists(`${root}/${f.path}`)))).every(Boolean);}catch{return false;}
  }
  async install(id:string,progress:(p:DownloadProgress)=>void,signal:AbortSignal):Promise<void>{
    if(this.downloading)throw new Error('已有模型正在下载，请等待或取消后再试。');
    this.downloading=true;const model=localModel(id),root=this.root(model),total=model.files.reduce((n,f)=>n+f.bytes,0);let loaded=0;
    try{
      await this.mkdir(root);
      for(const file of model.files){
        signal.throwIfAborted();const dest=`${root}/${file.path}`,ok=`${dest}.verified`;
        if(await this.storage.exists(dest)&&await this.storage.exists(ok)){loaded+=file.bytes;progress({message:`已下载 ${file.path}`,loaded,total});continue;}
        progress({message:`正在下载 ${file.path}`,loaded,total});
        const bytes=await this.download(`https://huggingface.co/${model.repo}/resolve/${model.revision}/${file.path}`,(n,size)=>progress({message:`正在下载 ${file.path}`,loaded:loaded+n,total:Math.max(total,loaded+(size||file.bytes))}),signal);
        signal.throwIfAborted();
        if(file.sha256&&await hash(bytes)!==file.sha256)throw new Error(`${file.path} 校验失败，请重新下载。`);
        if(!file.sha256){try{JSON.parse(new TextDecoder().decode(bytes));}catch{throw new Error('下载的模型配置不是有效 JSON，请检查网络后重试。');}}
        await this.mkdir(dest.slice(0,dest.lastIndexOf('/')));await this.storage.writeBinary(dest,bytes);await this.storage.write(ok,file.sha256||model.revision);
        loaded+=file.bytes;progress({message:`已保存 ${file.path}`,loaded,total});
      }
      signal.throwIfAborted();await this.storage.write(`${root}/ready.json`,JSON.stringify({revision:model.revision,downloadedAt:new Date().toISOString()}));
      progress({message:'下载完成，正在进行首次加载检查…',loaded:total,total});
      this.loadingStatus=message=>progress({message,loaded:total,total});
      await this.warm(id,signal);progress({message:'模型已就绪；以后可离线加载。',loaded:total,total});
    }finally{this.downloading=false;this.loadingStatus=undefined;}
  }
  private startWorker():Worker{
    if(this.worker)return this.worker;
    this.workerUrl=URL.createObjectURL(new Blob([__LOCAL_WORKER__],{type:'text/javascript'}));
    const worker=new Worker(this.workerUrl);this.worker=worker;
    worker.onmessage=event=>{const m=event.data;
      if(m.type==='file'){void this.serveFile(worker,m.id,m.url);return;}
      if(m.type==='progress'){this.loadingStatus?.(String(m.message));return;}
      const pending=this.pending.get(m.id);if(!pending)return;this.pending.delete(m.id);
      if(m.error)pending.reject(new Error(m.error));else pending.resolve(m.result||'');
    };
    worker.onerror=()=>this.reset('设备无法加载本地推理组件。可选更小模型，或使用在线模式。');
    worker.onmessageerror=()=>this.reset('本地模型通信失败，请重新加载模型。');
    return worker;
  }
  private async serveFile(worker:Worker,id:number,url:string):Promise<void>{
    try{
      const target=modelRequest(url);if(!target){worker.postMessage({type:'file',id,status:404});return;}
      const path=`${this.root(target.model)}/${target.file.path}`;
      if(!await this.ready(target.model.id)||!await this.storage.exists(path))throw new Error('本地模型文件不完整，请在快速设置中点击下载／修复。');
      const bytes=await this.storage.readBinary(path);worker.postMessage({type:'file',id,status:200,bytes},[bytes]);
    }catch(e){worker.postMessage({type:'file',id,error:e instanceof Error?e.message:'读取本地模型失败'});}
  }
  private reset(message:string):void{
    this.worker?.terminate();this.worker=null;this.active='';
    if(this.workerUrl)URL.revokeObjectURL(this.workerUrl);this.workerUrl='';
    for(const request of this.pending.values())request.reject(new Error(message));this.pending.clear();
  }
  private request(payload:Record<string,unknown>,signal?:AbortSignal):Promise<string>{
    signal?.throwIfAborted();const worker=this.startWorker(),id=++this.sequence;
    return new Promise((resolve,reject)=>{
      const abort=()=>this.reset('本地处理已取消，录音和已下载模型保留。');
      const timer=setTimeout(()=>this.reset('本地模型处理超时，文件已保留。可尝试更小的模型或在线服务。'),payload.type==='text'?600000:180000);
      signal?.addEventListener('abort',abort,{once:true});
      const finish=(fn:(value:any)=>void)=>(value:any)=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);fn(value);};
      this.pending.set(id,{resolve:finish(resolve),reject:finish(reject)});
      worker.postMessage({id,...payload});
    });
  }
  private serial<T>(action:()=>Promise<T>):Promise<T>{const task=this.queue.then(action,action);this.queue=task.catch(()=>{});return task;}
  private async load(id:string,signal?:AbortSignal):Promise<void>{
    if(this.active===id)return;if(!await this.ready(id))throw new Error('请先在快速设置中选择并下载本地模型。');
    const model=localModel(id);await this.request({type:'load',model:{id,repo:model.repo,revision:model.revision,kind:model.kind}},signal);this.active=id;
  }
  warm(id:string,signal?:AbortSignal):Promise<void>{return this.serial(()=>this.load(id,signal));}
  transcribe(id:string,wav:ArrayBuffer,language:string,signal?:AbortSignal):Promise<string>{return this.serial(async()=>{await this.load(id,signal);return this.request({type:'speech',samples:decodePcmWav(wav),language},signal);});}
  chat(id:string,system:string,user:string,maxTokens:number,signal?:AbortSignal):Promise<string>{return this.serial(async()=>{await this.load(id,signal);return this.request({type:'text',system,user,maxTokens:Math.min(maxTokens,1800)},signal);});}
  dispose():void{this.reset('插件已关闭，本地模型已释放。');}
}
