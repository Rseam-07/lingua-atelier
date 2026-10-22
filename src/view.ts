import { Component,ItemView,MarkdownRenderer,Notice,SuggestModal,TFile,WorkspaceLeaf,setIcon,Platform } from 'obsidian';
import {localModel} from './model-catalog';
import type AtelierPlugin from './main';
import { clock } from './core';
import { demoSession } from './demo';
import { drawMap,type MapHandle } from './mindmap';
import { SettingsModal } from './settings';
import type { Session,Segment,AudioPart } from './types';
import { Resampler } from './audio';
import path from './vault-path';
import {isTestTitle} from './organize-core';

export const VIEW='lingua-atelier-view';
const button=(parent:HTMLElement,text:string,icon:string,action:()=>void,cls='')=>{const b=parent.createEl('button',{cls:`la-button ${cls}`,attr:{'aria-label':text}});if(icon){const i=b.createSpan();setIcon(i,icon);}b.createSpan({text});b.onclick=action;return b;};
export class SessionPicker extends SuggestModal<Session>{
  constructor(private plugin:AtelierPlugin,private items:Session[]){super(plugin.app);this.setPlaceholder('搜索课堂记录；输入“测试”查看测试归档…');}
  getSuggestions(query:string):Session[]{const tests=query.startsWith('测试');const term=(tests?query.slice(2):query).trim().toLowerCase();return this.items.filter(s=>(tests?s.kind==='test':s.kind!=='test')&&s.title.toLowerCase().includes(term));}
  renderSuggestion(s:Session,el:HTMLElement):void{el.createDiv({text:s.title});el.createEl('small',{text:`${new Date(s.created).toLocaleString()} · ${s.segments.length} 段字幕`});}
  onChooseSuggestion(s:Session):void{this.plugin.controller.load(s);}
}
export class AtelierView extends ItemView{
  private unsubscribe:(()=>void)|null=null;private content!:HTMLElement;private title!:HTMLInputElement;
  private status!:HTMLElement;private badge!:HTMLElement;private timer!:HTMLElement;private meter!:HTMLElement;
  private note!:HTMLElement;private subtitles!:HTMLElement;private map!:HTMLElement;private caption!:HTMLElement;
  private mainButton!:HTMLButtonElement;private pauseButton!:HTMLButtonElement;private markButton!:HTMLButtonElement;
  private stopButton!:HTMLButtonElement;private tabs:HTMLButtonElement[]=[];private selected='notes';
  private key='';private renderedOutline='';private lastId='';private lastRender=0;private renderTimer:ReturnType<typeof setTimeout>|null=null;
  private mapHandle:MapHandle|null=null;private shownTab='';
  private markdownComponent:Component|null=null;private operation=false;
  constructor(leaf:WorkspaceLeaf,private plugin:AtelierPlugin){super(leaf);}
  getViewType():string{return VIEW;}
  getDisplayText():string{return 'Lingua Atelier';}
  getIcon():string{return 'audio-lines';}
  async onOpen():Promise<void>{
    const el=this.contentEl;el.empty();el.addClass('la-root');
    const top=el.createDiv({cls:'la-top'}),brand=top.createDiv({cls:'la-brand'});
    const logo=brand.createSpan({cls:'la-logo'});setIcon(logo,'audio-lines');brand.createSpan({text:'lingua',cls:'la-wordmark'});brand.createSpan({text:'ATELIER',cls:'la-brand-tag'});
    const tools=top.createDiv({cls:'la-top-tools'});
    button(tools,'笔记首页','house',()=>void this.run(()=>this.plugin.openNotebookHome()),'la-quiet');
    button(tools,'归档笔记','folder-tree',()=>void this.run(()=>this.plugin.organizeNotes()),'la-quiet');
    button(tools,'导入音频','file-audio',()=>this.importFile(),'la-quiet');
    button(tools,'历史笔记','history',()=>void this.run(async()=>{const items=await this.plugin.controller.store.sessions();new SessionPicker(this.plugin,items).open();}),'la-quiet');
    button(tools,'快速设置','wand-sparkles',()=>this.plugin.openSetup(),'la-quiet');
    button(tools,'使用提示','circle-help',()=>this.plugin.openHelp(),'la-icon-only la-quiet');
    button(tools,'设置','sliders-horizontal',()=>new SettingsModal(this.app,this.plugin).open(),'la-icon-only la-quiet');
    const heading=el.createDiv({cls:'la-heading'});
    const meta=heading.createDiv({cls:'la-meta'});meta.createSpan({text:new Date().toLocaleDateString('zh-CN',{month:'long',day:'numeric',weekday:'long'}).toUpperCase()});meta.createSpan({text:'·'});meta.createSpan({text:'外语学习 · 中 / 英 / 法'});this.badge=meta.createSpan({cls:'la-local-badge',text:'本地优先'});
    this.title=heading.createEl('input',{cls:'la-title',attr:{'aria-label':'笔记标题',placeholder:'给这一段灵感，起个名字。'},value:'外语课堂'});
    this.caption=heading.createDiv({cls:'la-caption',text:'专心听，剩下的交给这里。'});
    const tips=heading.createEl('details',{cls:'la-usage-tips'});tips.createEl('summary',{text:'使用小提示'});
    tips.createEl('p',{text:'首次使用点右上角“快速设置”，选模型并下载。开始录音后按分段显示字幕，约 30 秒起整理要点；结束录音时等待保存完成。字幕可回听，失败可重试。'+(!Platform.isDesktopApp?' 手机录音请保持 Obsidian 前台，先试录一分钟。':'')});
    const nav=el.createDiv({cls:'la-nav'}),tabWrap=nav.createDiv({cls:'la-tabs'});
    for(const [id,label,icon]of [['notes','课堂笔记','notebook-pen'],['transcript','双语字幕','captions'],['map','思维导图','git-fork']]){const b=button(tabWrap,label,icon,()=>{this.selected=id;this.switchTab();});b.dataset.tab=id;this.tabs.push(b);}
    const actions=nav.createDiv({cls:'la-nav-actions'});
    button(actions,'重新整理','sparkles',()=>void this.run(async()=>{const c=this.plugin.controller;if(!c.session||c.session.demo)return;await c.reorganize();}), 'la-quiet');
    button(actions,'编辑 Markdown','file-pen-line',()=>void this.run(()=>this.openNote()),'la-quiet');
    button(actions,'导出','download',()=>void this.run(async()=>{
      const s=this.plugin.controller.session;if(!s||s.demo){new Notice('录音完成后可导出双语字幕与思维导图。');return;}
      await this.plugin.controller.store.exportSrt(s);const file=await this.plugin.controller.store.exportCanvas(s);await this.app.workspace.getLeaf('tab').openFile(file);new Notice('已导出 .srt 双语字幕与 .canvas 思维导图');
    }),'la-quiet');
    this.content=el.createDiv({cls:'la-content'});
    const noteWrap=this.content.createDiv({cls:'la-note-panel'});const noteHead=noteWrap.createDiv({cls:'la-section-head'});noteHead.createSpan({text:'L E S  N O T E S'});noteHead.createSpan({text:'主题与要点 · 点击时间回听',cls:'la-section-hint'});this.note=noteWrap.createDiv({cls:'la-note markdown-rendered'});
    this.registerDomEvent(this.note,'click',event=>{
      const link=event.target instanceof Element?event.target.closest<HTMLAnchorElement>('a.internal-link'):null;
      const href=link?.getAttribute('data-href');if(!href)return;
      event.preventDefault();event.stopPropagation();void this.run(()=>this.app.workspace.openLinkText(href,this.plugin.controller.session?.notePath||'','tab'));
    });
    const aside=this.content.createDiv({cls:'la-transcript-panel'}),subHead=aside.createDiv({cls:'la-section-head'});subHead.createSpan({text:'双语字幕'});subHead.createSpan({text:'原文 / 中文',cls:'la-section-hint'});this.subtitles=aside.createDiv({cls:'la-subtitles'});
    this.map=this.content.createDiv({cls:'la-map-panel'});
    const footer=el.createDiv({cls:'la-footer'}),left=footer.createDiv({cls:'la-record-status'});
    const recording=left.createDiv({cls:'la-record-indicator'});this.meter=recording.createSpan({cls:'la-wave'});for(let i=0;i<9;i++)this.meter.createSpan();
    const state=left.createDiv();this.status=state.createDiv({cls:'la-status',text:'准备好，开始认真聆听。'});this.timer=state.createDiv({cls:'la-time',text:'00:00 · 音频保存在本机'});
    const controls=footer.createDiv({cls:'la-controls'});
    this.markButton=button(controls,'标记重点','bookmark-plus',()=>this.plugin.controller.mark(),'la-quiet');
    this.pauseButton=button(controls,'暂停','pause',()=>void this.run(()=>this.plugin.controller.pause()),'la-icon-only');
    this.stopButton=button(controls,'结束录音','square',()=>void this.run(()=>this.plugin.controller.stop()),'la-stop');
    this.mainButton=button(controls,'开始录音','mic',()=>void this.run(()=>{if(!this.plugin.settings.setupCompleted){this.plugin.openSetup();return;}const c=this.plugin.controller,title=this.title.value.trim();return c.start(c.session&&title===c.session.title&&isTestTitle(title)?'外语课堂':title);}), 'la-primary');
    this.unsubscribe=this.plugin.controller.onChange(()=>this.scheduleRender());this.render();
  }
  private async run(fn:()=>void|Promise<void>):Promise<void>{if(this.operation)return;this.operation=true;try{await fn();}catch(e){new Notice(e instanceof Error?e.message:String(e),9000);}finally{this.operation=false;this.render();}}
  private scheduleRender():void{const elapsed=Date.now()-this.lastRender;if(elapsed>180)this.render();else if(!this.renderTimer)this.renderTimer=setTimeout(()=>{this.renderTimer=null;this.render();},180-elapsed);}
  private switchTab():void{this.content.dataset.tab=this.selected;if(this.shownTab!==this.selected){this.shownTab=this.selected;if(this.selected==='map')requestAnimationFrame(()=>this.mapHandle?.fit());}for(const t of this.tabs){t.toggleClass('is-active',t.dataset.tab===this.selected);t.setAttribute('aria-pressed',String(t.dataset.tab===this.selected));}}
  private render():void{
    if(!this.content)return;this.lastRender=Date.now();const c=this.plugin.controller,s=c.session,p=s?.phase,active=p==='recording'||p==='paused',busy=c.busy;
    this.contentEl.toggleClass('is-recording',p==='recording');this.contentEl.toggleClass('is-busy',busy);
    this.status.setText(c.status);
    const waiting=[c.pendingAsr?`${c.pendingAsr} 段待识别`:'',c.pendingTranslation?`${c.pendingTranslation} 段待翻译`:''].filter(Boolean).join(' · ');
    const recent=s?.metrics?.slice().reverse();
    const lastAsr=recent?.find(m=>m.stage==='asr'),lastTranslation=recent?.find(m=>m.stage==='translation');
    this.timer.setText(`${clock(s?.duration||0)} · ${waiting||(lastAsr?`最近识别 ${(lastAsr.durationMs/1000).toFixed(1)} 秒${lastTranslation?` · 翻译 ${(lastTranslation.durationMs/1000).toFixed(1)} 秒`:''}`:'音频保存在本机')}`);
    const asr=c.settings.asrEngine==='ondevice'?localModel(c.settings.localSpeechModel).name.split(' · ')[0]:c.settings.asrEngine==='cloud'?'Qwen 在线识别':c.settings.asrEngine==='qwen'?'Qwen3-ASR 1.7B':path.basename(c.settings.whisperModel).replace(/^ggml-|\.bin$/g,'')||'Whisper';
    this.badge.setText(s?.demo?'示例 · 非真实录音':`${c.settings.asrEngine==='cloud'?'在线识别':'本地识别'} · ${asr}${c.settings.dualRecognition&&c.settings.language==='auto'&&['qwen','whisper'].includes(c.settings.asrEngine)?' · 中法双路':''}`);this.badge.toggleClass('is-demo',!!s?.demo);
    const level=p==='recording'?Math.min(1,c.level*14):0;this.meter.style.setProperty('--level',String(level));
    this.mainButton.hidden=active||p==='finishing'||p==='starting';this.mainButton.disabled=busy||this.operation;
    this.pauseButton.hidden=!active;this.pauseButton.disabled=this.operation;this.pauseButton.setAttribute('aria-label',p==='paused'?'继续':'暂停');setIcon(this.pauseButton.firstElementChild as HTMLElement,p==='paused'?'play':'pause');
    this.stopButton.hidden=!active&&p!=='finishing';this.stopButton.disabled=p==='finishing'||this.operation;this.markButton.hidden=!active;this.title.disabled=busy;
    const id=s?.id||'';if(this.lastId!==id){this.lastId=id;this.key='';this.renderedOutline='';this.mapHandle?.destroy();this.mapHandle=null;this.title.value=s?.title||'外语课堂';}
    this.caption.setText(s?.demo?'这里是一份示例课堂。开始录音后，你的内容会出现在这里。':s?.reviewRequired?'自动转写 · 点击时间可回听，原始录音已保存':p==='complete'?`${s?.segments.length||0} 段双语字幕，已收进你的 Markdown 笔记。`:active?'声音成为文字，想法渐渐清晰。':'专心听，剩下的交给这里。');
    const key=`${id}|${s?.segments.map(x=>`${x.id}:${x.source}:${x.translation}:${x.status}:${x.reviewRequired}`).join('|')}|${s?.audio.map(a=>`${a.path}:${a.status}:${a.recognition?.selected}:${a.recognition?.reviewRequired}`).join('|')}|${s?.errors.length}|${p}`;
    if(this.key!==key){this.key=key;this.renderSubtitles(s);}
    const outline=s?.outline||'';
    if(this.renderedOutline!==`${id}|${outline}`){this.renderedOutline=`${id}|${outline}`;this.renderNote(s);if(this.mapHandle)this.mapHandle.update(s?.title||'课堂笔记',outline);else this.mapHandle=drawMap(this.map,s?.title||'课堂笔记',outline);}
    this.switchTab();
  }
  private renderNote(s:Session|null):void{
    if(this.markdownComponent){this.removeChild(this.markdownComponent);this.markdownComponent=null;}
    this.note.empty();
    if(s?.outline){this.markdownComponent=new Component();this.addChild(this.markdownComponent);void MarkdownRenderer.render(this.app,s.outline,this.note,s.notePath,this.markdownComponent);return;}
    const empty=this.note.createDiv({cls:'la-note-empty'});const motif=empty.createDiv({cls:'la-motif'});setIcon(motif,'sprout');
    empty.createEl('h2',{text:s?.segments.length?'一点一点，理清思路。':'每一次倾听，都有所得。'});empty.createEl('p',{text:s?.segments.length?'双语字幕正在生成。积累几个片段后，主题、例句与要点会自动整理到这里。':'录下外语课堂或会议，获得原文与中文译文。当前支持中文、英语和法语。要点与思维导图随内容逐渐展开，最后留下一份可自由编辑的 Markdown 笔记。'});
    if(!s){const hints=empty.createDiv({cls:'la-feature-row'});for(const [icon,label]of [['captions','双语字幕'],['git-fork','思维导图'],['file-text','原生 Markdown']]){const span=hints.createSpan();setIcon(span.createSpan(),icon);span.createSpan({text:label});}
      button(empty,'看看一堂课的样子','arrow-up-right',()=>{this.plugin.controller.session=demoSession();this.plugin.controller.status='示例内容 · 点击开始录音创建你的课堂';this.plugin.controller.emit();},'la-demo-button');
    }
  }
  private renderSubtitles(s:Session|null):void{
    const atBottom=this.subtitles.scrollHeight-this.subtitles.scrollTop-this.subtitles.clientHeight<90;
    this.subtitles.empty();
    const needsRetry=!!s&&(s.errors.length>0||s.audio.some(a=>a.status==='error'||a.status==='saved')||s.segments.some(a=>a.status!=='done')||s.summaryVersion<s.segments.length);
    const entries:{segment?:Segment;part?:AudioPart;start:number}[]=(s?.segments||[]).map(segment=>({segment,start:segment.start,part:s!.audio.find(a=>a.start===segment.start&&a.end===segment.end)}));
    for(const part of s?.audio||[])if(part.recognition&&!entries.some(e=>e.part===part))entries.push({part,start:part.start});
    entries.sort((a,b)=>a.start-b.start);
    if(!s||!entries.length){const empty=this.subtitles.createDiv({cls:'la-subtitle-empty'});setIcon(empty.createDiv(),'audio-lines');empty.createEl('p',{text:'等待第一句话'});empty.createEl('small',{text:'原文在上，中文在下。\n一句一句，跟上你的节奏。'});if(needsRetry&&!this.plugin.controller.busy&&!s?.demo)button(empty,'恢复未完成转写','rotate-cw',()=>void this.run(()=>this.plugin.controller.retry()),'la-retry');return;}
    // Keep the live DOM bounded in long lectures. The complete transcript is in Markdown.
    if(entries.length>180)this.subtitles.createDiv({cls:'la-muted',text:'显示最近 180 段；完整逐字稿已保存在 Markdown。'});
    for(const {segment,part,start} of entries.slice(-180)){
      const row=this.subtitles.createDiv({cls:`la-subtitle ${segment?.status==='error'?'has-error':''}`});
      const time=row.createDiv({cls:'la-subtitle-time'});time.createSpan({text:clock(start)});
      if(!s.demo){const play=time.createEl('button',{text:'↗',attr:{'aria-label':`回听 ${clock(start)} 的录音`}});play.onclick=()=>void this.run(async()=>{const audio=part||s.audio.find(p=>p.start<=start&&p.end>start);if(audio){const f=this.app.vault.getAbstractFileByPath(audio.path);if(f instanceof TFile)await this.app.workspace.getLeaf('split').openFile(f);}});}
      if(segment){
        
        const chinese=/[\u3400-\u9fff]/.test(segment.source)&&!/[A-Za-zÀ-ÿ]/.test(segment.source);
        row.createDiv({cls:'la-fr',text:segment.source,attr:{lang:chinese?'zh-CN':this.plugin.settings.language==='auto'?'':this.plugin.settings.language}});
        if(segment.translation!==segment.source)row.createDiv({cls:'la-zh',text:segment.translation||(segment.status==='error'?'翻译失败，可点击下方重试。':'正在翻译…'),attr:{lang:'zh-CN'}});
      }else row.createDiv({cls:'la-muted',text:part?.recognition?.reviewRequired?'这段尚未识别出有效文字，原音已保存':'未检测到可用文字'});
      const comparison=part?.recognition;
      if(comparison){
        const details=row.createEl('details',{cls:'la-recognition-candidates'});
        details.createEl('summary',{text:`识别详情 · ${comparison.reason}`});
        for(const candidate of comparison.candidates){
          const box=details.createDiv({cls:'la-recognition-candidate'});
          const label=candidate.language==='fr'?'法语模式候选':'中文模式候选';
          box.createEl('small',{text:`${label}${comparison.selected===candidate.language?' · 已选':''}`});
          box.createDiv({text:candidate.text||candidate.error||'未识别出文字'});
          if(!this.plugin.controller.busy&&candidate.text&&!candidate.error&&!candidate.truncated&&(comparison.reviewRequired||comparison.selected!==candidate.language))button(box,'采用此候选','check',()=>void this.run(()=>this.plugin.controller.acceptCandidate(part!.path,candidate.language)),'la-quiet');
        }
      }
    }
    if(needsRetry&&!this.plugin.controller.busy&&!s.demo)button(this.subtitles,'重试未完成内容','rotate-cw',()=>void this.run(()=>this.plugin.controller.retry()),'la-retry');
    if(atBottom)requestAnimationFrame(()=>{this.subtitles.scrollTop=this.subtitles.scrollHeight;});
  }
  private async openNote():Promise<void>{const s=this.plugin.controller.session;if(!s||s.demo){new Notice('开始录音后会自动创建可编辑的 Markdown 笔记。');return;}const f=this.app.vault.getAbstractFileByPath(s.notePath);if(f instanceof TFile)await this.app.workspace.getLeaf('split').openFile(f);}
  private importFile():void{
    if(this.plugin.controller.busy)return;const input=document.createElement('input');input.type='file';input.accept='audio/*,video/mp4';
    input.onchange=()=>void this.run(async()=>{
      const file=input.files?.[0];if(!file)return;if(file.size>200*1024*1024)throw new Error('请选择小于 200 MB 的音频文件。');
      const ctx=new AudioContext({sampleRate:16000});try{
        const decoded=await ctx.decodeAudioData(await file.arrayBuffer());const mono=new Float32Array(decoded.length);
        for(let c=0;c<decoded.numberOfChannels;c++){const channel=decoded.getChannelData(c);for(let i=0;i<mono.length;i++)mono[i]+=channel[i]/decoded.numberOfChannels;}
        const samples=new Resampler(decoded.sampleRate).push(mono);await this.plugin.controller.importAudio(file.name.replace(/\.[^.]+$/,''),samples);
      }finally{await ctx.close();}
    });input.click();
  }
  async onClose():Promise<void>{this.mapHandle?.destroy();this.unsubscribe?.();if(this.renderTimer)clearTimeout(this.renderTimer);}
}
