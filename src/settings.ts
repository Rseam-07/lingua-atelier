import {App,Modal,PluginSettingTab,Setting,Platform} from 'obsidian';
import type AtelierPlugin from './main';
import type {Settings} from './types';
import {localModel} from './model-catalog';

function populate(el:HTMLElement,plugin:AtelierPlugin,refresh:()=>void):void{
  const s=plugin.settings,mobile=!Platform.isDesktopApp,mac=Platform.isMacOS;el.empty();el.addClass('la-settings');
  el.createEl('h2',{text:'录音与模型'});
  el.createEl('p',{cls:'la-muted',text:'第一次使用先打开快速设置：选择本地或在线模式，下载模型，检查通过后就能录音。下载与安装只在你点击按钮后开始。'});
  new Setting(el).setName('快速开始').setDesc('模型选择、下载进度、在线密钥与首次检查都在这里。').addButton(b=>b.setButtonText('快速设置').setCta().onClick(()=>plugin.openSetup())).addButton(b=>b.setButtonText('使用提示').onClick(()=>plugin.openHelp()));
  const status=el.createDiv({cls:'la-health-detail',text:'尚未检测连接。'});
  new Setting(el).setName('就绪检查').addButton(b=>b.setButtonText('检测模型 / 连接').onClick(async()=>{b.setDisabled(true);try{const h=await plugin.controller.providers.health();status.setText(`语音识别：${h.asr?'就绪':'未就绪'} · 文字服务：${h.llm&&h.model?'就绪':'未就绪'} · ${h.message}`);}catch{status.setText('检测失败，请打开快速设置检查。');}finally{b.setDisabled(false);}})).addButton(b=>b.setButtonText('加载并检查').onClick(async()=>{b.setDisabled(true);try{await plugin.controller.providers.ensure(t=>status.setText(t));status.setText('识别、翻译与整理已就绪。');}catch(e){status.setText(e instanceof Error?e.message:String(e));}finally{b.setDisabled(false);}}));
  const basic=el.createDiv();basic.createEl('h3',{text:'日常使用'});
  new Setting(basic).setName('课堂语言').setDesc(s.asrEngine==='qwen'?'自动模式针对中法切换；英语课程请选择英语。':'已知主要语言时优先指定；自动模式仍可能误判。').addDropdown(d=>d.addOptions({fr:'法语',en:'英语',zh:'中文',auto:s.asrEngine==='qwen'?'中法自动识别':'自动识别'}).setValue(s.language).onChange(async v=>{s.language=v;if(v!=='auto')s.dualRecognition=false;await plugin.saveSettings();}));
  new Setting(basic).setName('音频来源').setDesc(mac?'默认使用麦克风；系统音频需要可选 Mac 组件和系统权限。':'默认使用麦克风，也可导入系统录音文件。').addDropdown(d=>{d.addOption('microphone','麦克风 / 外部输入');if(mac&&!mobile)d.addOption('system','系统音频（Mac 组件）');d.setValue(s.audioSource).onChange(async v=>{s.audioSource=v as Settings['audioSource'];await plugin.saveSettings();});});
  new Setting(basic).setName('麦克风').setDesc('授权后显示设备名称。').addDropdown(d=>{d.addOption('default','系统默认输入').setValue(s.deviceId);void navigator.mediaDevices?.enumerateDevices().then(devices=>{for(const dev of devices.filter(d=>d.kind==='audioinput'&&d.deviceId!=='default'))d.addOption(dev.deviceId,dev.label||'音频输入');d.setValue(s.deviceId);}).catch(()=>{});d.onChange(async v=>{s.deviceId=v;await plugin.saveSettings();});});
  new Setting(basic).setName('字幕分段').setDesc('自然停顿时提前提交。分段越短不一定越准，建议先试用默认值。').addDropdown(d=>d.addOptions({'4':'4 秒','6':'6 秒','8':'8 秒（默认）','10':'10 秒'}).setValue(String(s.chunkSeconds)).onChange(async v=>{s.chunkSeconds=Number(v);await plugin.saveSettings();}));
  new Setting(basic).setName('要点更新间隔').addDropdown(d=>d.addOptions({'20':'约 20 秒','30':'约 30 秒','60':'约 60 秒'}).setValue(String(s.summarySeconds)).onChange(async v=>{s.summarySeconds=Number(v);await plugin.saveSettings();}));
  new Setting(basic).setName('课堂术语表').setDesc('每行“外语 = 中文”，供翻译与整理参考。').addTextArea(t=>t.setValue(s.glossary).onChange(async v=>{s.glossary=v;await plugin.saveSettings();}));
  new Setting(basic).setName('笔记保存目录').setDesc('相对于当前仓库，默认 Lingua。').addText(t=>t.setValue(s.folder).onChange(async v=>{s.folder=v;await plugin.saveSettings();}));
  new Setting(basic).setName('启动时打开工作台').addToggle(t=>t.setValue(s.openOnStartup).onChange(async v=>{s.openOnStartup=v;await plugin.saveSettings();}));
  const details=el.createEl('details',{cls:'la-advanced'});details.createEl('summary',{text:'高级设置：服务、路径与现有环境'});const advanced=details.createDiv();
  const text=(name:string,desc:string,key:keyof Settings)=>new Setting(advanced).setName(name).setDesc(desc).addText(t=>t.setValue(String(s[key])).onChange(async v=>{(s as any)[key]=v;await plugin.saveSettings();}));
  new Setting(advanced).setName('识别引擎').addDropdown(d=>{d.addOptions({ondevice:'当前设备 · 内置本地模型',cloud:'在线 · 阿里云百炼',qwen:'桌面 / 远程 Qwen3-ASR',whisper:'已有 Whisper 服务'}).setValue(s.asrEngine).onChange(async v=>{s.asrEngine=v as Settings['asrEngine'];if(v==='ondevice'||v==='cloud')s.dualRecognition=false;await plugin.saveSettings();refresh();});});
  if(s.asrEngine==='ondevice')advanced.createEl('p',{cls:'la-model-info',text:`当前本地语音模型：${localModel(s.localSpeechModel).name}。切换与下载请打开快速设置。`});
  else if(s.asrEngine==='cloud')advanced.createEl('p',{cls:'la-model-info',text:'在线识别的地域、密钥和录音发送确认，请在快速设置中配置。'});
  else{
    const qwen=s.asrEngine==='qwen';text('识别服务地址',mobile?'仅连接已有服务时填写电脑 / HTTPS 地址；手机的 localhost 是自身。':'默认连接本机。',qwen?'qwenUrl':'asrUrl');
    new Setting(advanced).setName('中法双路识别').setDesc('同一音频按中文和法语解码，保留两路供回听；仅已有桌面服务支持。').addToggle(t=>t.setValue(s.dualRecognition).onChange(async v=>{s.dualRecognition=v;if(v)s.language='auto';await plugin.saveSettings();refresh();}));
    if(!mobile){if(qwen){text('Qwen Python','已有环境的 Python 路径。','qwenPython');text('Qwen 模型目录','已有 Qwen3-ASR 1.7B 目录。','qwenModel');}else{text('Whisper 程序','已有 whisper-server 路径。','whisperBinary');text('Whisper 模型','已有 ggml 模型。','whisperModel');}}
    new Setting(advanced).setName('识别服务连接密钥').setDesc('仅连接自有共享服务时使用；和在线百炼密钥不同。').addText(t=>{t.inputEl.type='password';t.setPlaceholder('输入新密钥以更新').onChange(v=>plugin.app.secretStorage?.setSecret(s.asrSecretName,v));});
    if(qwen)new Setting(advanced).setName('识别使用课件热词（实验）').setDesc('默认关闭；噪声可能诱导模型复述词表。').addToggle(t=>t.setValue(s.asrUseGlossary).onChange(async v=>{s.asrUseGlossary=v;await plugin.saveSettings();}));
    else new Setting(advanced).setName('保留较弱人声').addToggle(t=>t.setValue(s.preserveWeakSpeech).onChange(async v=>{s.preserveWeakSpeech=v;await plugin.saveSettings();}));
  }
  new Setting(advanced).setName('文字处理方式').addDropdown(d=>d.addOptions({ondevice:'当前设备 · 内置本地文字模型',ollama:'已有本地 Ollama',compatible:'在线 / 自定义兼容 API'}).setValue(s.llmMode).onChange(async v=>{s.llmMode=v as Settings['llmMode'];if(v==='ollama'){s.llmUrl='http://127.0.0.1:11434';s.llmModel='qwen2.5:3b';s.llmUseCloudKey=false;}else if(v==='compatible'){s.llmUrl='https://api.deepseek.com';s.llmModel='deepseek-flash';s.llmUseCloudKey=false;}await plugin.saveSettings();refresh();}));
  if(s.llmMode==='ondevice')advanced.createEl('p',{cls:'la-model-info',text:`当前文字模型：${localModel(s.localTextModel).name}。切换与下载请打开快速设置。`});
  else{
    text('文字服务地址','填写兼容 API 基础地址，或已有 Ollama 服务。','llmUrl');text('文字模型','填写服务支持的模型名。','llmModel');
    if(s.llmMode==='compatible')new Setting(advanced).setName('API Key').setDesc(s.llmUseCloudKey?'当前与百炼识别共用密钥，请在快速设置更新。':'保存在 Obsidian 密钥库；在线服务会收到转写文字和提纲。').addText(t=>{t.inputEl.type='password';t.setDisabled(s.llmUseCloudKey).setPlaceholder('输入新密钥以更新').onChange(v=>plugin.app.secretStorage?.setSecret(s.secretName,v));});
    if(s.llmMode==='ollama'&&!mobile)text('Ollama 程序','已有 Ollama 的可执行路径。','llmBinary');
  }
  if(!mobile)new Setting(advanced).setName('自动启动已有本地服务').setDesc('只启动已安装环境，不会在后台下载模型。').addToggle(t=>t.setValue(s.autoLaunch).onChange(async v=>{s.autoLaunch=v;await plugin.saveSettings();}));
  if(plugin.controller.busy){el.createEl('p',{text:'当前录音 / 整理中，请结束并保存后再修改配置。',cls:'la-muted'});for(const control of el.querySelectorAll<HTMLInputElement|HTMLSelectElement|HTMLTextAreaElement>('input,select,textarea'))control.disabled=true;}
}
export class SettingsModal extends Modal{
  constructor(app:App,private plugin:AtelierPlugin){super(app);}
  onOpen():void{this.modalEl.addClass('la-settings-modal');populate(this.contentEl,this.plugin,()=>this.onOpen());}
}
export class AtelierSettingsTab extends PluginSettingTab{
  constructor(app:App,private plugin:AtelierPlugin){super(app,plugin);}
  display():void{populate(this.containerEl,this.plugin,()=>this.display());}
}
