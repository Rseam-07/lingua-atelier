import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import {desktop,hasDesktop} from './runtime';
import { Chunker,Resampler,rms } from './audio';
import type {Settings,Chunk} from './types';

export class SystemRecorder {
  private child:ChildProcessWithoutNullStreams|null=null;private chunker:Chunker;
  private pending='';private paused=false;private closing=false;private resampler:Resampler|null=null;
  constructor(private settings:Settings,onChunk:(c:Chunk)=>void,private onMeter:(level:number,time:number)=>void,private onEnded:()=>void){this.chunker=new Chunker(settings.chunkSeconds,onChunk,settings.silenceRms);}
  async start():Promise<void>{
    if(!hasDesktop()||process.platform!=='darwin')throw new Error('当前平台请使用麦克风或导入音频；系统声音采集组件适用于 macOS。');
    const {child:{spawn},fs:{existsSync}}=desktop();
    if(!existsSync(this.settings.systemAudioHelper))throw new Error('请先安装 Mac 桌面识别组件，或切换到麦克风。');
    await new Promise<void>((resolve,reject)=>{
      let ready=false;const child=spawn(this.settings.systemAudioHelper,[],{stdio:'pipe'});this.child=child;
      const timeout=setTimeout(()=>{child.kill();reject(new Error('系统音频启动超时，请检查 macOS 屏幕与系统音频录制权限。'));},20000);
      child.stdout.setEncoding('utf8');child.stderr.on('data',()=>{});
      child.on('error',e=>{clearTimeout(timeout);reject(e);});
      child.on('close',()=>{clearTimeout(timeout);this.child=null;if(!ready)reject(new Error('系统音频组件未能启动，请检查系统权限。'));else if(!this.closing)this.onEnded();});
      child.stdout.on('data',(text:string)=>{
        this.pending+=text;if(this.pending.length>2*1024*1024){child.kill();reject(new Error('系统音频组件返回了无效数据。'));return;}
        let newline;
        while((newline=this.pending.indexOf('\n'))>=0){const line=this.pending.slice(0,newline);this.pending=this.pending.slice(newline+1);
          let msg;try{msg=JSON.parse(line);}catch{continue;}
          if(msg.type==='ready'){ready=true;clearTimeout(timeout);resolve();}
          else if(msg.type==='error'){clearTimeout(timeout);if(!ready)reject(new Error(String(msg.message)));else this.onEnded();child.kill();}
          else if(msg.type==='audio'&&!this.paused){
            const raw=Buffer.from(msg.pcm,'base64');const samples=new Float32Array(Math.floor(raw.length/4));for(let i=0;i<samples.length;i++)samples[i]=raw.readFloatLE(i*4);
            this.resampler ||= new Resampler(Number(msg.rate)||16000);const pcm=this.resampler.push(samples);this.chunker.push(pcm);this.onMeter(rms(pcm),this.chunker.seconds);
          }
        }
      });
    });
  }
  async pause():Promise<void>{this.paused=true;this.chunker.flush();}
  resume():void{this.paused=false;}
  async stop():Promise<void>{
    if(this.closing)return;this.closing=true;const child=this.child;
    if(child)await new Promise<void>(r=>{const timer=setTimeout(()=>{child.kill('SIGKILL');r();},2000);child.once('close',()=>{clearTimeout(timer);r();});child.kill('SIGTERM');});
    this.chunker.flush();this.child=null;
  }
}
