import {Modal,Notice,Platform,Setting} from 'obsidian';
import type AtelierPlugin from './main';
import {LOCAL_MODELS,localModel,modelSize,type LocalModelKind} from './model-catalog';
import {cloudBase} from './cloud';
import type {Settings} from './types';

export class QuickSetupModal extends Modal {
  private draft:Settings;private cloudKey='';private textKey='';private task:AbortController|null=null;private running=false;
  private pickedText:boolean;
  private pickedTextModel:boolean;
  private status!:HTMLElement;private meter!:HTMLProgressElement;private complete!:HTMLButtonElement;
  constructor(private plugin:AtelierPlugin){super(plugin.app);this.draft={...plugin.settings};this.pickedText=this.draft.setupCompleted;this.pickedTextModel=this.draft.setupCompleted;if(!this.draft.setupCompleted){this.draft.asrEngine=Platform.isDesktopApp?'qwen':'ondevice';this.draft.llmMode='ondevice';this.draft.dualRecognition=Platform.isDesktopApp;}}
  onOpen():void{
    this.modalEl.addClass('la-setup-modal');this.render();
  }
  private render():void{
    const el=this.contentEl;el.empty();el.addClass('la-setup');
    el.createDiv({cls:'la-setup-eyebrow',text:'LINGUA ATELIER · 开始之前'});
    el.createEl('h2',{text:'选好模型，就可以开始听课。'});
    el.createEl('p',{cls:'la-muted',text:'只在你点击下载时联网安装。以后打开 Obsidian，直接开始录音；本地模式不需要另一台电脑。'});
    if(this.plugin.controller.busy){el.createEl('p',{text:'当前正在录音或整理，请结束并保存后再配置模型。'});return;}
    const s=this.draft,mobile=!Platform.isDesktopApp;
    const speech=el.createDiv({cls:'la-setup-section'});speech.createEl('h3',{text:'1 · 录音识别'});
    new Setting(speech).setName('声音在哪里处理').addDropdown(d=>{
      d.addOption('ondevice','本地 · 直接在当前设备运行').addOption('cloud','在线 · 无需下载语音模型');
      if(!mobile)d.addOption('qwen','本地 · Qwen3-ASR 桌面增强版');
      if(s.asrEngine==='whisper')d.addOption('whisper','保留现有 Whisper 服务');
      d.setValue(s.asrEngine).onChange(v=>{s.asrEngine=v as Settings['asrEngine'];s.dualRecognition=v==='qwen'&&s.language==='auto';this.redraw();});
    });
    if(s.asrEngine==='ondevice')this.modelChoice(speech,'speech');
    if(s.asrEngine==='qwen'){
      speech.createEl('p',{cls:'la-model-info',text:'Qwen3-ASR 1.7B：Apple Silicon 模型约 2.5 GB，Windows / Intel 约 4.7 GB，另需运行环境空间。首次点击会安装到独立组件目录，不需要你打开终端。Windows 无显卡时可能很慢。'});
      new Setting(speech).setName('桌面识别环境').addButton(b=>b.setButtonText('下载 / 修复 Qwen 环境').onClick(()=>void this.perform(async signal=>{Object.assign(s,await this.plugin.desktopSetup.install(p=>this.progress(p.message,p.loaded,p.total),signal));})));
    }
    if(s.asrEngine==='cloud')speech.createEl('p',{cls:'la-model-info',text:'Qwen 在线识别：手机直接连接阿里云百炼，不需要开电脑；按服务商规则计费。下方填写百炼密钥并确认后才会发送录音。'});
    new Setting(speech).setName('课堂语言').setDesc('知道主要语言时优先指定；中法切换课堂可选自动。').addDropdown(d=>d.addOptions({auto:s.asrEngine==='qwen'?'中文 / 法语自动':'自动识别（中 / 英 / 法）',fr:'法语',en:'英语',zh:'中文'}).setValue(s.language).onChange(v=>{s.language=v;s.dualRecognition=s.asrEngine==='qwen'&&v==='auto';}));
    const text=el.createDiv({cls:'la-setup-section'});text.createEl('h3',{text:'2 · 翻译、笔记与思维导图'});
    new Setting(text).setName('文字处理方式').addDropdown(d=>{
      if(!this.pickedText)d.addOption('','请选择本地或在线');
      d.addOption('ondevice','本地 · 下载文字模型').addOption('compatible','在线 · 使用自己的 API');if(!mobile)d.addOption('ollama','保留已有 Ollama');
      d.setValue(this.pickedText?s.llmMode:'').onChange(v=>{if(!v)return;this.pickedText=true;s.llmMode=v as Settings['llmMode'];if(v==='compatible'&&s.llmUrl.includes('127.0.0.1')){s.llmUrl='https://api.deepseek.com';s.llmModel='deepseek-flash';s.llmUseCloudKey=false;}this.redraw();});
    });
    if(!this.pickedText)text.createEl('p',{cls:'la-muted',text:'本地：自己选择并下载文字模型，之后可离线用。在线：使用自己的 API，通常更适合复杂翻译和课堂整理。'});
    if(this.pickedText&&s.llmMode==='ondevice')this.modelChoice(text,'text');
    if(this.pickedText&&s.llmMode==='compatible'){
      new Setting(text).setName('在线文字服务').addDropdown(d=>d.addOptions({deepseek:'DeepSeek',dashscope:'阿里云百炼（可与在线识别共用密钥）',custom:'保留自定义 API'}).setValue(s.llmUseCloudKey?'dashscope':s.llmUrl.includes('api.deepseek.com')?'deepseek':'custom').onChange(v=>{s.llmUseCloudKey=v==='dashscope';if(v==='dashscope'){s.llmUrl=cloudBase(s.cloudRegion);s.llmModel='qwen-turbo';}else if(v==='deepseek'){s.llmUrl='https://api.deepseek.com';s.llmModel='deepseek-flash';}this.redraw();}));
      if(!s.llmUseCloudKey){
        new Setting(text).setName('文字服务 API Key').setDesc('保存在 Obsidian 密钥库；已有密钥可留空。DeepSeek 只处理文字。').addText(t=>{t.inputEl.type='password';t.setPlaceholder('输入自己的密钥').setValue(this.textKey).onChange(v=>this.textKey=v.trim());});
        if(!s.llmUrl.includes('api.deepseek.com')){
          new Setting(text).setName('API 基础地址').addText(t=>t.setValue(s.llmUrl).onChange(v=>s.llmUrl=v.trim()));
          new Setting(text).setName('模型名').addText(t=>t.setValue(s.llmModel).onChange(v=>s.llmModel=v.trim()));
        }
      }
      text.createEl('p',{cls:'la-muted',text:'在线文字服务会接收转写文字与提纲，可能收费。原始录音只有选择在线识别时才会发送给识别服务。'});
    }
    if(s.llmMode==='ollama')text.createEl('p',{cls:'la-muted',text:`继续使用已有 Ollama 模型：${s.llmModel}。未安装 Ollama 时可选上方的“下载文字模型”，不需要另装软件。`});
    if(s.asrEngine==='cloud'||s.llmUseCloudKey&&s.llmMode==='compatible'){
      const cloud=el.createDiv({cls:'la-setup-section'});cloud.createEl('h3',{text:'在线服务连接'});
      new Setting(cloud).setName('百炼地域').setDesc('密钥必须属于选择的地域。').addDropdown(d=>d.addOptions({cn:'中国内地 · 北京',intl:'国际 · 新加坡'}).setValue(s.cloudRegion).onChange(v=>{s.cloudRegion=v as Settings['cloudRegion'];if(s.llmUseCloudKey)s.llmUrl=cloudBase(s.cloudRegion);}));
      new Setting(cloud).setName('百炼 API Key').setDesc('仅保存在本机 Obsidian 密钥库，不写入笔记或分享包。').addText(t=>{t.inputEl.type='password';t.setPlaceholder('已有密钥可留空').setValue(this.cloudKey).onChange(v=>this.cloudKey=v.trim());});
      const link=cloud.createEl('a',{text:'如何创建自己的百炼密钥',href:'https://help.aliyun.com/zh/model-studio/get-api-key'});link.setAttribute('target','_blank');link.setAttribute('rel','noopener noreferrer');
      if(s.asrEngine==='cloud')new Setting(cloud).setName('允许发送录音到上述百炼地域').setDesc('仅在开始录音或导入音频后发送，服务商可能按用量收费。').addToggle(t=>t.setValue(s.cloudConsent).onChange(v=>s.cloudConsent=v));
    }
    const finish=el.createDiv({cls:'la-setup-section'});finish.createEl('h3',{text:'3 · 检查并开始'});
    this.status=finish.createDiv({cls:'la-setup-status',attr:{role:'status','aria-live':'polite'},text:'先下载所选本地模型，或填写在线配置，然后点击“检查并完成”。'});
    this.meter=finish.createEl('progress',{attr:{max:'1',value:'0','aria-label':'模型准备进度'}});
    const actions=finish.createDiv({cls:'la-setup-actions'});
    this.complete=actions.createEl('button',{text:'检查并完成',cls:'mod-cta'});this.complete.onclick=()=>void this.perform(signal=>this.finish(signal));
    const cancel=actions.createEl('button',{text:'取消当前下载'});cancel.onclick=()=>this.task?.abort();
    const help=actions.createEl('button',{text:'使用说明'});help.onclick=()=>this.plugin.openHelp();
    if(mobile)finish.createEl('p',{cls:'la-muted',text:'iOS / 安卓本地推理仍是测试功能：先用一分钟短录音验证速度和内存，再用于长课。录音时保持 Obsidian 前台，锁屏录音不作保证。'});
    else finish.createEl('p',{cls:'la-muted',text:'现有配置会保留；模型下载与安装只在你点击按钮后开始。更详细的设备、路径与术语配置可在高级设置中调整。'});
  }
  // Keep draft choices while rebuilding a conditional section.
  private redraw():void{this.render();}
  private modelChoice(parent:HTMLElement,kind:LocalModelKind):void{
    const key=kind==='speech'?'localSpeechModel':'localTextModel',s=this.draft;
    const list=LOCAL_MODELS.filter(m=>m.kind===kind);
    new Setting(parent).setName(kind==='speech'?'语音模型':'文字模型').addDropdown(d=>{if(kind==='text'&&!this.pickedTextModel)d.addOption('','请选择文字模型');for(const model of list)d.addOption(model.id,`${model.name} · 约 ${modelSize(model)}`);d.setValue(kind==='text'&&!this.pickedTextModel?'':s[key]).onChange(v=>{if(!v)return;s[key]=v;if(kind==='text')this.pickedTextModel=true;this.redraw();});});
    if(kind==='text'&&!this.pickedTextModel){parent.createEl('p',{cls:'la-model-info',text:'请比较下载量与内存要求后自行选择。0.5B 只适合轻量体验，法语翻译可能有明显错误；1.5B 更占内存。正式课程也可选择在线文字服务。'});return;}
    const model=localModel(s[key]);parent.createEl('p',{cls:'la-model-info',text:`${model.description} ${model.memory}。`});
    const state=parent.createDiv({cls:'la-muted',text:'正在检查下载状态…'});
    void this.plugin.localModels.ready(model.id).then(ready=>state.setText(ready?'已下载 · 可离线加载':'尚未下载 · 来源 Hugging Face；建议 Wi-Fi，保留足够空间'));
    new Setting(parent).setName('模型文件').addButton(b=>b.setButtonText('下载 / 修复').onClick(()=>void this.perform(async signal=>{await this.plugin.localModels.install(model.id,p=>this.progress(p.message,p.loaded,p.total),signal);state.setText('已下载并通过首次加载检查');}))).addButton(b=>b.setButtonText('检查加载').onClick(()=>void this.perform(async signal=>{this.progress('正在检查模型加载…',0,0);await this.plugin.localModels.warm(model.id,signal);this.progress('模型加载成功。',1,1);})));
  }
  private progress(message:string,loaded:number,total:number):void{this.status.setText(message);if(total>0)this.meter.value=Math.min(1,loaded/total);else this.meter.removeAttribute('value');}
  private async perform(action:(signal:AbortSignal)=>Promise<void>):Promise<void>{
    if(this.running)return;this.running=true;this.task=new AbortController();
    const controls=Array.from(this.contentEl.querySelectorAll<HTMLInputElement|HTMLSelectElement|HTMLButtonElement>('input,select,button'));for(const c of controls)if(c.textContent!=='取消当前下载')c.disabled=true;
    try{await action(this.task.signal);}catch(e){this.progress(e instanceof Error?e.message:String(e),0,1);}finally{this.running=false;this.task=null;for(const c of controls)c.disabled=false;}
  }
  private async finish(signal:AbortSignal):Promise<void>{
    const s=this.draft;if(this.plugin.controller.busy)throw new Error('请先结束并保存录音。');
    if(!this.pickedText)throw new Error('请先选择本地或在线文字处理方式。');
    if(s.llmMode==='ondevice'&&!this.pickedTextModel)throw new Error('请选择本地文字模型，或切换在线服务。');
    if((this.cloudKey||this.textKey)&&!this.app.secretStorage)throw new Error('请先升级 Obsidian 至支持密钥库的版本。');
    if(s.asrEngine==='ondevice'&&!await this.plugin.localModels.ready(s.localSpeechModel))throw new Error('语音模型还未下载，请点击“下载 / 修复”。');
    if(s.llmMode==='ondevice'&&!await this.plugin.localModels.ready(s.localTextModel))throw new Error('文字模型还未下载，请点击“下载 / 修复”，或选择在线服务。');
    if(s.llmMode==='ondevice'){this.progress('正在检查本地文字模型加载…',0,0);await this.plugin.localModels.warm(s.localTextModel,signal);}
    if(this.cloudKey)this.app.secretStorage.setSecret(s.cloudSecretName,this.cloudKey);
    if(this.textKey)this.app.secretStorage.setSecret(s.secretName,this.textKey);
    Object.assign(this.plugin.settings,s,{setupCompleted:false,dualRecognition:s.asrEngine==='qwen'&&s.language==='auto',audioSource:'microphone'});await this.plugin.saveSettings();signal.throwIfAborted();
    await this.plugin.controller.providers.ensure(message=>this.progress(message,0,0));signal.throwIfAborted();
    this.plugin.settings.setupCompleted=true;await this.plugin.saveSettings();this.close();await this.plugin.open();this.plugin.openHelp(true);new Notice('模型与服务已就绪，可以开始录音。');
  }
  onClose():void{this.task?.abort();this.cloudKey='';this.textKey='';}
}

export class UsageModal extends Modal {
  constructor(private plugin:AtelierPlugin,private first=false){super(plugin.app);}
  onOpen():void{
    this.modalEl.addClass('la-setup-modal');const el=this.contentEl;el.empty();el.addClass('la-setup');
    el.createDiv({cls:'la-setup-eyebrow',text:'LINGUA ATELIER · 使用提示'});el.createEl('h2',{text:this.first?'准备好了，先试一分钟。':'录音、整理与回听，都在这里。'});
    const steps=[['先配置一次','点击“快速设置”，分别选择语音与文字模型。本地模型点击下载并检查加载；在线服务填写自己的密钥。以后通常无需重复设置。'],['开始录音','填课堂名称、选择主要语言，再点“开始录音”并允许麦克风。字幕按音频分段到达，不是逐字同步。先用一分钟已知内容检查收音与速度。'],['查看内容','“双语字幕”看原文和中文译文；“课堂笔记”随内容更新；“思维导图”可缩放、折叠。积累约 30 秒内容后开始整理。'],['结束并保存','点击“结束录音”，等待剩余识别与整理完成。原始录音、字幕与 Markdown 保存在当前仓库的 Lingua 文件夹。'],['错字或失败','点击字幕时间旁的回听按钮；失败片段可用“重试”恢复。模型不会因为文字通顺就一定听对，噪声中的内容需要回听。'],['已有录音与笔记','“导入音频”处理已有文件；“历史笔记”找旧课程；“归档笔记”整理文件位置；“重新整理”更新当前课程的内容与导图。'],['手机使用','本地模式下载完成后不需要电脑或联网；在线模式需要网络。保持 Obsidian 前台，先验证设备的麦克风、内存与处理速度；后台和锁屏持续录音暂不保证。']];
    for(const[title,body]of steps){const section=el.createDiv({cls:'la-help-step'});section.createEl('h3',{text:title});section.createEl('p',{text:body});}
    el.createEl('p',{cls:'la-provider-notice',text:'本地模式处理速度取决于设备；远处、嘈杂课堂建议尽量靠近老师或使用外接麦克风。在线模式会向所选服务发送音频或文字，费用由自己的账户承担。本插件不附带共享密钥。'});
    new Setting(el).addButton(b=>b.setButtonText('快速设置').onClick(()=>{this.close();this.plugin.openSetup();})).addButton(b=>b.setButtonText('开始使用').setCta().onClick(()=>this.close()));
  }
}
