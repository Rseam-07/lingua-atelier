import { RATE, type Chunk, type Settings } from './types';

export function encodeWav(samples:Float32Array, rate=RATE):ArrayBuffer {
  const buffer=new ArrayBuffer(44+samples.length*2),v=new DataView(buffer);
  const str=(o:number,s:string)=>[...s].forEach((c,i)=>v.setUint8(o+i,c.charCodeAt(0)));
  str(0,'RIFF');v.setUint32(4,36+samples.length*2,true);str(8,'WAVE');str(12,'fmt ');
  v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,1,true);v.setUint32(24,rate,true);
  v.setUint32(28,rate*2,true);v.setUint16(32,2,true);v.setUint16(34,16,true);str(36,'data');v.setUint32(40,samples.length*2,true);
  for(let i=0;i<samples.length;i++){const x=Math.max(-1,Math.min(1,samples[i]));v.setInt16(44+i*2,Math.round(x*(x<0?32768:32767)),true);}
  return buffer;
}
export function rms(samples:Float32Array):number {let n=0;for(const x of samples)n+=x*x;return Math.sqrt(n/Math.max(1,samples.length));}

/** Stateful resampling keeps fractional phase across worklet messages. */
export class Resampler {
  private pending=new Float32Array(); private position=0;
  constructor(private from:number,private to=RATE){}
  push(data:Float32Array):Float32Array {
    if(this.from===this.to)return data;
    const b=new Float32Array(this.pending.length+data.length);b.set(this.pending);b.set(data,this.pending.length);
    const step=this.from/this.to, values:number[]=[];
    while(this.position+1<b.length){const i=Math.floor(this.position),f=this.position-i;values.push(b[i]+(b[i+1]-b[i])*f);this.position+=step;}
    const used=Math.min(Math.floor(this.position),b.length);this.pending=b.slice(used);this.position-=used;
    return Float32Array.from(values);
  }
}
export class Chunker {
  private pieces:Float32Array[]=[]; private length=0; private count=0;private quiet=0;
  constructor(private maxSeconds:number,private onChunk:(c:Chunk)=>void,private threshold=0.004){}
  get seconds():number{return(this.count+this.length)/RATE;}
  push(samples:Float32Array):void{
    // A worklet packet is <= 2048 samples; split further so the duration bound is exact.
    let offset=0;
    while(offset<samples.length){
      const size=Math.min(samples.length-offset,Math.round(this.maxSeconds*RATE)-this.length,512);
      const block=samples.slice(offset,offset+size);this.pieces.push(block);this.length+=size;offset+=size;
      this.quiet=rms(block)<this.threshold?this.quiet+size:0;
      if(this.length>=this.maxSeconds*RATE||(this.length>=RATE*2&&this.quiet>=RATE*0.3))this.flush();
    }
  }
  flush():void{
    if(!this.length)return;
    const samples=new Float32Array(this.length);let o=0;for(const p of this.pieces){samples.set(p,o);o+=p.length;}
    const start=this.count/RATE;this.count+=this.length;this.pieces=[];this.length=0;this.quiet=0;
    this.onChunk({samples,start,end:this.count/RATE});
  }
}
const WORKLET=`class LinguaCapture extends AudioWorkletProcessor {
 constructor(){super();this.b=new Float32Array(2048);this.n=0;this.port.onmessage=e=>{if(e.data==='flush'){this.send();this.port.postMessage('flushed');}};}
 send(){if(this.n){const b=this.b.slice(0,this.n);this.port.postMessage(b,[b.buffer]);this.n=0;}}
 process(inputs,outputs){const channels=inputs[0];if(channels&&channels.length){for(let i=0;i<channels[0].length;i++){let v=0;for(const c of channels)v+=c[i];this.b[this.n++]=v/channels.length;if(this.n===this.b.length)this.send();}}for(const output of outputs)for(const c of output)c.fill(0);return true;}
} registerProcessor('lingua-capture',LinguaCapture);`;

export class Recorder {
  private streams:MediaStream[]=[];private ctx:AudioContext|null=null;private node:AudioWorkletNode|null=null;
  private sources:MediaStreamAudioSourceNode[]=[];private paused=false;private stopped=false;private ended=false;
  private chunker:Chunker;private flushed:(()=>void)|null=null;
  constructor(private settings:Settings,onChunk:(c:Chunk)=>void,private onMeter:(level:number,time:number)=>void,private onEnded:()=>void){this.chunker=new Chunker(settings.chunkSeconds,onChunk,settings.silenceRms);}
  async start():Promise<void>{
    try{
      if(!navigator.mediaDevices?.getUserMedia)throw new Error('当前设备未开放麦克风接口，请使用“导入音频”，或检查 Obsidian 的麦克风权限。');
      // Preserve far-field teachers: call-oriented echo/noise processing may erase
      // distant speech. Keep the raw capture for later reprocessing as well.
      this.streams.push(await navigator.mediaDevices.getUserMedia({audio:{deviceId:this.settings.deviceId!=='default'?{exact:this.settings.deviceId}:undefined,channelCount:1,echoCancellation:false,noiseSuppression:false,autoGainControl:false},video:false}));
      // Let Chromium resample with its antialiasing filter before the worklet.
      try{this.ctx=new AudioContext({sampleRate:RATE});}catch{this.ctx=new AudioContext();}
      if(!this.ctx.audioWorklet)throw new Error('当前设备不支持实时音频处理，请先使用“导入音频”。');
      const resampler=new Resampler(this.ctx.sampleRate);
      const url=URL.createObjectURL(new Blob([WORKLET],{type:'application/javascript'}));
      try{await this.ctx.audioWorklet.addModule(url);}finally{URL.revokeObjectURL(url);}
      this.node=new AudioWorkletNode(this.ctx,'lingua-capture');
      this.node.port.onmessage=e=>{
        if(e.data==='flushed'){this.flushed?.();return;}
        if(this.paused||this.stopped)return;
        const samples=resampler.push(e.data);this.chunker.push(samples);this.onMeter(rms(samples),this.chunker.seconds);
      };
      for(const stream of this.streams){
        const audio=new MediaStream(stream.getAudioTracks());const source=this.ctx.createMediaStreamSource(audio);source.connect(this.node);this.sources.push(source);
        for(const track of stream.getTracks())track.addEventListener('ended',()=>{if(!this.stopped&&!this.ended){this.ended=true;this.onEnded();}},{once:true});
      }
      this.node.connect(this.ctx.destination);await this.ctx.resume();
    }catch(e){await this.dispose();throw e;}
  }
  private async drain():Promise<void>{
    if(!this.node)return;
    await new Promise<void>(r=>{const t=setTimeout(()=>{this.flushed=null;r();},500);this.flushed=()=>{clearTimeout(t);this.flushed=null;r();};this.node!.port.postMessage('flush');});
  }
  async pause():Promise<void>{await this.drain();this.paused=true;this.chunker.flush();}
  resume():void{this.paused=false;}
  async stop():Promise<void>{await this.drain();this.stopped=true;this.chunker.flush();await this.dispose();}
  async dispose():Promise<void>{
    this.stopped=true;this.streams.forEach(s=>s.getTracks().forEach(t=>t.stop()));this.streams=[];
    this.sources.forEach(s=>s.disconnect());this.sources=[];
    if(this.node){this.node.port.onmessage=null;this.node.disconnect();this.node=null;}
    const c=this.ctx;this.ctx=null;if(c&&c.state!=='closed')await c.close();
  }
}
