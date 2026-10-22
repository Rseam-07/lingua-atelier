import { Recorder,Chunker,encodeWav,rms } from './audio';
import { Providers } from './providers';
import { SystemRecorder } from './audio-native';
import { LanguageQueue } from './language-queue';
import {usefulForNotes} from './notes';
import type {LocalInference} from './local-models';
import type { Store } from './store';
import { type Settings,type Session,type Segment,type Chunk,type AudioPart,type ProcessingMetric,type RecognitionLanguage } from './types';

interface Capture {start():Promise<void>;stop():Promise<void>;pause():Promise<void>;resume():void;}
type CaptureFactory=(settings:Settings,chunk:(c:Chunk)=>void,meter:(level:number,time:number)=>void,ended:()=>void)=>Capture;

export class Controller {
  session:Session|null=null;status='准备好，开始认真聆听。';level=0;pendingAsr=0;pendingTranslation=0;
  private recorder:Capture|null=null;private asrQueue=Promise.resolve();private llmQueue:LanguageQueue;private starting=false;
  private listeners=new Set<()=>void>();private saveTimer:ReturnType<typeof setTimeout>|null=null;
  private nextPart=0;private summaryRequested=false;private forceSummary=false;private stopping:Promise<void>|null=null;
  private maintaining=false;private maintenanceTask:Promise<unknown>|null=null;
  providers:Providers;
  constructor(public settings:Settings,public store:Store,key:()=>string,private captureFactory:CaptureFactory=(s,c,m,e)=>s.audioSource==='system'?new SystemRecorder(s,c,m,e):new Recorder(s,c,m,e),asrKey:()=>string=()=>'',local?:LocalInference,cloudKey:()=>string=()=>''){this.providers=new Providers(settings,key,asrKey,local,cloudKey);this.llmQueue=this.newLanguageQueue();}
  private newLanguageQueue():LanguageQueue{return new LanguageQueue(()=>this.settings.llmMode==='compatible');}
  onChange(fn:()=>void):()=>void{this.listeners.add(fn);return()=>{this.listeners.delete(fn);};}
  emit():void{for(const fn of this.listeners)fn();}
  get busy():boolean{return this.maintaining||this.starting||(!!this.session&&['starting','recording','paused','finishing'].includes(this.session.phase));}
  async maintain<T>(action:()=>Promise<T>):Promise<T>{
    if(this.busy)throw new Error('录音或转写结束后再整理笔记，原始录音会继续保存。');
    this.maintaining=true;this.emit();
    const task=(async()=>{
      if(this.saveTimer){clearTimeout(this.saveTimer);this.saveTimer=null;}
      if(this.session&&!this.session.demo)await this.store.save(this.session);
      await this.store.flush();return action();
    })();this.maintenanceTask=task;
    try{return await task;}finally{this.maintenanceTask=null;this.maintaining=false;this.emit();}
  }
  private error(e:unknown):void{const text=e instanceof Error?e.message:String(e);this.status=text;if(this.session){this.session.errors.push(text);this.session.errors=this.session.errors.slice(-20);}this.emit();}
  private persist():void{
    if(!this.session||this.session.demo)return;
    if(this.saveTimer)clearTimeout(this.saveTimer);
    const s=this.session;this.saveTimer=setTimeout(()=>{this.saveTimer=null;void this.store.save(s).catch(e=>this.error(e));},300);
  }
  private measure(s:Session,metric:ProcessingMetric):void{(s.metrics||=[]).push(metric);if(s.metrics.length>300)s.metrics.splice(0,s.metrics.length-300);}
  private async recognize(s:Session,part:AudioPart,wav:ArrayBuffer):Promise<string>{
    if(!this.settings.dualRecognition||this.settings.language!=='auto'||['ondevice','cloud'].includes(this.settings.asrEngine))return this.providers.transcribe(wav);
    const context=s.segments.filter(x=>x.end<=part.start&&x.end>=part.start-40).map(x=>`${x.reviewRequired?'[暂选未核对] ':''}${x.source}`).join('\n');
    const result=await this.providers.transcribeDual(wav,context);part.recognition=result.comparison;
    if(result.comparison.reviewRequired){s.reviewRequired=true;if(!result.text)part.status='review';}
    return result.text;
  }
  async start(title:string):Promise<void>{
    if(this.busy)return;
    this.starting=true;this.status='正在检查模型与录音设置…';this.emit();
    try{
    // Do not create an empty note, start a microphone, or claim to record if prerequisites fail.
    await this.providers.ensure(text=>{this.status=text;this.emit();});
    this.session=await this.store.create(title||'外语课堂');this.nextPart=0;this.summaryRequested=false;
    this.asrQueue=Promise.resolve();this.llmQueue=this.newLanguageQueue();
    this.recorder=this.captureFactory(this.settings,c=>this.enqueue(c),(level,time)=>{this.level=level;if(this.session)this.session.duration=time;this.emit();},()=>void this.stop());
    try{await this.recorder.start();this.session.phase='recording';this.status='正在聆听 · 原始录音会持续保存';this.persist();this.emit();}
    catch(e){this.session.phase='complete';this.recorder=null;this.error(e);await this.store.save(this.session);throw e;}
    }catch(e){this.error(e);throw e;}finally{this.starting=false;this.emit();}
  }
  private enqueue(c:Chunk):void{
    const s=this.session;if(!s)return;const index=this.nextPart++;const wav=encodeWav(c.samples),queuedAt=performance.now();
    // Release the shared GPU promptly when a new speech block arrives.
    this.llmQueue.interruptSummary();
    // Start writing immediately; recognition never controls whether audio is retained.
    const saved=this.store.saveAudio(s,wav,index).then(async path=>{const part:AudioPart={path,start:c.start,end:c.end,status:'saved'};s.audio.push(part);await this.store.save(s);return part;});
    void saved.catch(()=>{});
    this.pendingAsr++;this.emit();
    this.asrQueue=this.asrQueue.then(async()=>{
      let part:AudioPart|undefined;
      try{
        part=await saved;
        // Far-field teachers can be quiet. Preserve the full speech block;
        // this fast path is only for practically zero-valued digital silence.
        if(rms(c.samples)<0.00001){part.status='silent';return;}
        this.status=this.settings.dualRecognition&&this.settings.language==='auto'&&['qwen','whisper'].includes(this.settings.asrEngine)?'正在核对法语、中文两路识别…':'正在识别课堂语音…';this.emit();
        const began=performance.now();const source=await this.recognize(s,part,wav);
        this.measure(s,{stage:'asr',durationMs:performance.now()-began,waitMs:began-queuedAt,audioEnd:c.end});
        if(!source){if(part.status!=='review')part.status='done';return;}
        const segment:Segment={id:s.segments.length,start:c.start,end:c.end,source,translation:'',status:'pending',...(part.recognition?.reviewRequired?{reviewRequired:true}:{})};
        s.segments.push(segment);part.status='done';this.persist();this.emit();this.enqueueTranslation(s,segment);
      }catch(e){if(part){part.status='error';part.error=e instanceof Error?e.message:String(e);}this.error(e);}
      finally{this.pendingAsr--;if(!this.pendingAsr)this.queueSummary(s);this.persist();this.emit();}
    }).catch(e=>this.error(e));
  }
  private enqueueTranslation(s:Session,segment:Segment):void{
    const queuedAt=performance.now();this.pendingTranslation++;this.emit();
    this.llmQueue.translate(async()=>{
      const began=performance.now();
      try{this.status='正在翻译字幕…';this.emit();segment.translation=await this.providers.translate(segment.source,s.segments.filter(x=>x.id<segment.id).slice(-2).map(x=>x.source).join(' '));segment.status='done';delete segment.error;}
      catch(e){segment.status='error';segment.error=e instanceof Error?e.message:String(e);this.error(e);}
      finally{this.measure(s,{stage:'translation',durationMs:performance.now()-began,waitMs:began-queuedAt,audioEnd:segment.end});this.pendingTranslation--;this.queueSummary(s);this.persist();this.emit();}
    });
  }
  private queueSummary(s:Session):void{
    if(this.summaryRequested||this.pendingAsr||s.summaryVersion>=s.segments.length)return;
    const live=['recording','paused'].includes(s.phase);
    const covered=s.summaryVersion?s.segments[s.summaryVersion-1]?.end||0:0;
    if(live&&!this.forceSummary&&(s.segments.length-s.summaryVersion<this.settings.summaryEvery||s.segments.at(-1)!.end-covered<this.settings.summarySeconds))return;
    this.summaryRequested=true;this.forceSummary=false;const queuedAt=performance.now();
    this.llmQueue.summarize(async signal=>{
      if(this.pendingAsr&&this.settings.llmMode!=='compatible'){this.summaryRequested=false;return;}
      // Coalesce all text available at execution time; do not queue stale outline rewrites.
      const fresh:Segment[]=[];let chars=0;
      for(const segment of s.segments.slice(s.summaryVersion)){
        const size=segment.source.length+segment.translation.length;
        if(fresh.length&&chars+size>(this.settings.llmMode==='compatible'?10000:3500))break;fresh.push(segment);chars+=size;
      }
      const version=s.summaryVersion+fresh.length,began=performance.now();let success=false;
      const checked=fresh.filter(usefulForNotes);
      try{if(fresh.length){this.status=live?'正在补充课堂要点 · 字幕优先':'正在完成课堂笔记…';this.emit();const result=checked.length?await this.providers.summarize(s.outline,checked,{signal,live,notePath:s.notePath}):s.outline;if(!signal.aborted){s.outline=result;s.summaryVersion=version;success=true;}}}
      catch(e){if(!signal.aborted)this.error(e);}
      finally{this.measure(s,{stage:'summary',durationMs:performance.now()-began,waitMs:began-queuedAt,audioEnd:fresh.at(-1)?.end||0,cancelled:signal.aborted});this.summaryRequested=false;this.persist();this.emit();if(success)this.queueSummary(s);}
    });
  }
  private async drainLlm():Promise<void>{await this.llmQueue.drain();}
  async pause():Promise<void>{
    const s=this.session;if(!s||!this.recorder)return;
    if(s.phase==='recording'){await this.recorder.pause();s.phase='paused';this.level=0;this.status='已暂停';}
    else if(s.phase==='paused'){this.recorder.resume();s.phase='recording';this.status='继续聆听';}
    this.persist();this.emit();
  }
  async importAudio(title:string,samples:Float32Array):Promise<void>{
    if(this.busy)return;this.starting=true;this.status='正在准备音频转写…';this.emit();
    try{
      await this.providers.ensure(t=>{this.status=t;this.emit();});
      this.session=await this.store.create(title);this.nextPart=0;this.summaryRequested=false;
      this.asrQueue=Promise.resolve();this.llmQueue=this.newLanguageQueue();
      const chunks=new Chunker(this.settings.chunkSeconds,c=>this.enqueue(c),this.settings.silenceRms);
      chunks.push(samples);chunks.flush();this.session.duration=samples.length/16000;
      await this.finish();
    }finally{this.starting=false;this.emit();}
  }
  stop():Promise<void>{
    if(this.stopping)return this.stopping;
    if(!this.session||!['recording','paused'].includes(this.session.phase))return Promise.resolve();
    this.stopping=this.finish().finally(()=>{this.stopping=null;});return this.stopping;
  }
  private async finish():Promise<void>{
    const s=this.session!;s.phase='finishing';this.status='正在保存尾音并完成整理…';this.emit();
    try{
      // Recorder flushes final samples into the same queue before we drain it.
      await this.recorder?.stop();this.recorder=null;this.level=0;
      await this.asrQueue;await this.drainLlm();
      while(s.summaryVersion<s.segments.length){const before=s.summaryVersion;this.queueSummary(s);await this.drainLlm();if(s.summaryVersion===before)break;}
      s.phase='complete';this.status=s.errors.length?'录音已保存 · 部分内容可重试':s.audio.some(a=>a.recognition?.reviewRequired)?'已保存 · 自动转写可回听修订':'已完成，笔记已保存';
      if(this.saveTimer){clearTimeout(this.saveTimer);this.saveTimer=null;}
      await this.store.save(s);
    }catch(e){s.phase='complete';this.error(e);}finally{this.emit();}
  }
  mark(text='重点回顾'):void{const s=this.session;if(!s||s.demo)return;s.bookmarks.push({time:s.duration,text});this.persist();this.emit();}
  async retry(retranslate=false):Promise<void>{
    const s=this.session;if(!s||this.busy||s.demo)return;
    s.phase='finishing';s.errors=[];this.emit();
    try{
      await this.providers.ensure(t=>{this.status=t;this.emit();});
      let recovered=false;
      for(const part of s.audio.filter(a=>a.status==='error'||a.status==='saved')){
        try{const source=await this.recognize(s,part,await this.store.readAudio(part.path));if(source){const seg:Segment={id:s.segments.length,start:part.start,end:part.end,source,translation:'',status:'pending',...(part.recognition?.reviewRequired?{reviewRequired:true}:{})};s.segments.push(seg);recovered=true;}if(part.status!=='review')part.status='done';delete part.error;}catch(e){part.status='error';part.error=e instanceof Error?e.message:String(e);this.error(e);}
      }
      s.segments.sort((a,b)=>a.start-b.start);s.segments.forEach((x,i)=>x.id=i);
      if(retranslate){s.summaryVersion=0;s.outline='';}
      else if(recovered)s.summaryVersion=0;
      for(const seg of s.segments.filter(x=>retranslate||x.status!=='done'))this.enqueueTranslation(s,seg);
      await this.drainLlm();
      while(s.summaryVersion<s.segments.length){const before=s.summaryVersion;this.queueSummary(s);await this.drainLlm();if(before===s.summaryVersion)break;}
    }finally{s.phase='complete';this.status=s.errors.length?'已保存 · 部分内容仍可重试':'已更新，笔记已保存';await this.store.save(s);this.emit();}
  }
  async reorganize():Promise<void>{
    const s=this.session;if(!s||s.demo)return;
    if(this.busy){
      if(['recording','paused'].includes(s.phase)){this.forceSummary=true;this.status='已请求更新课堂要点 · 录音继续';this.queueSummary(s);this.emit();return;}
      throw new Error('正在处理内容，请稍后重试。');
    }
    const oldOutline=s.outline,oldVersion=s.summaryVersion;
    await this.maintain(async()=>{
      await this.store.backup(s);
      let outline='',count=0;
      const useful=s.segments.filter(usefulForNotes);
      if(!useful.length)throw new Error('尚无足够的课程文字，录音与原笔记已保留。');
      for(let start=0;start<useful.length;){
        const batch:Segment[]=[];let chars=0;
        while(start<useful.length){const segment=useful[start],size=segment.source.length+segment.translation.length;if(batch.length&&chars+size>(this.settings.llmMode==='compatible'?60000:6000))break;batch.push(segment);chars+=size;start++;}
        this.status=`正在重整课程内容 · ${start}/${useful.length} 段`;this.emit();
        outline=await this.providers.summarize(outline,batch,{notePath:s.notePath});count=start;
      }
      if(!outline.trim())throw new Error('这些片段暂时无法提炼课程要点，原笔记已保留。');
      s.outline=outline;s.summaryVersion=s.segments.length;
      try{await this.store.save(s);await this.store.exportCanvas(s);}
      catch(e){s.outline=oldOutline;s.summaryVersion=oldVersion;throw e;}
      this.status=`课程已重新整理 · ${count} 段原文 · Markdown 与导图已保存`;this.emit();
    });
  }
  async reorganizeAll():Promise<void>{
    if(this.busy)throw new Error('当前录音仍在进行；结束后可一键重整全部历史内容。');
    const original=this.session?.id;
    const items=(await this.store.sessions()).filter(s=>s.kind!=='test'&&s.segments.length>0);
    const errors:string[]=[];let completed=0;
    for(const s of items){
      this.load(s);
      try{await this.reorganize();completed++;}catch(e){errors.push(`${s.title}: ${e instanceof Error?e.message:String(e)}`);}
    }
    const saved=(await this.store.sessions()).find(s=>s.id===original);if(saved)this.load(saved);
    this.status=`已重新整理 ${completed}/${items.length} 份课堂笔记${errors.length?' · 部分失败，可重试':''}`;
    if(this.session)this.session.errors.push(...errors.slice(-5));this.emit();
  }
  async acceptCandidate(path:string,language:RecognitionLanguage):Promise<void>{
    const s=this.session;if(!s||this.busy||s.demo)return;
    const part=s.audio.find(a=>a.path===path),comparison=part?.recognition;
    const chosen=comparison?.candidates.find(c=>c.language===language);
    if(!part||!comparison||!chosen?.text||chosen.error||chosen.truncated)return;
    s.phase='finishing';this.emit();
    try{
      const prior=s.segments.find(x=>x.start===part.start&&x.end===part.end);
      if(prior){prior.source=chosen.text;prior.translation='';prior.status='pending';prior.reviewRequired=false;delete prior.error;}
      else s.segments.push({id:s.segments.length,start:part.start,end:part.end,source:chosen.text,translation:'',status:'pending'});
      comparison.selected=language;comparison.method='manual';comparison.reviewRequired=false;comparison.reason='已手动采用此版';part.status='done';delete part.error;
      s.segments.sort((a,b)=>a.start-b.start);s.segments.forEach((x,i)=>x.id=i);
      // Rebuild only the generated outline; handwritten Markdown is preserved.
      s.outline='';s.summaryVersion=0;
      await this.store.save(s);
      for(const seg of s.segments.filter(x=>x.status==='pending'))this.enqueueTranslation(s,seg);
      await this.drainLlm();
      while(s.summaryVersion<s.segments.length){const before=s.summaryVersion;this.queueSummary(s);await this.drainLlm();if(before===s.summaryVersion)break;}
    }finally{s.phase='complete';this.status='已采用候选并保存笔记';await this.store.save(s);this.emit();}
  }
  load(s:Session):void{if(this.busy)return;this.session=s;s.phase='complete';this.status=s.audio.some(a=>a.status==='saved'||a.status==='error')||s.segments.some(a=>a.status!=='done')||s.summaryVersion<s.segments.length?'发现未完成内容 · 可在字幕区点击恢复':'已打开保存的会话';this.emit();}
  async dispose():Promise<void>{
    await this.maintenanceTask;
    if(this.saveTimer)clearTimeout(this.saveTimer);
    if(this.recorder)await this.recorder.stop();
    // Raw WAV and journal writes already started remain recoverable after reload.
    await this.asrQueue;await this.drainLlm();
    if(this.session&&!this.session.demo){this.session.phase='complete';await this.store.save(this.session).catch(()=>{});}
    this.providers.dispose();this.listeners.clear();
  }
}
