import { App,Modal,PluginSettingTab,Setting,Platform } from 'obsidian';
import type AtelierPlugin from './main';
import type { Settings } from './types';

function populate(el:HTMLElement,plugin:AtelierPlugin,refresh:()=>void):void{
  const s=plugin.settings;el.empty();el.addClass('la-settings');
  const mobile=!Platform.isDesktopApp,mac=Platform.isMacOS;
  el.createEl('h2',{text:'让工具安静地工作'});el.createEl('p',{cls:'la-muted',text:mobile?'移动端测试版：连接电脑上的识别服务，笔记与录音保存在当前仓库。实时录音请保持应用在前台；也可导入已有录音。':'首次使用请先运行下载包中的桌面识别组件安装器。Mac 使用 MLX，Windows 使用 Transformers；也可连接自有服务。'});
  if(mobile)el.createEl('p',{cls:'la-provider-notice',text:'移动端录音与后台行为仍需真机验证。服务器地址请填写电脑的局域网或 VPN 地址；localhost 是手机自身。'});
  const text=(name:string,desc:string,key:keyof Settings)=>new Setting(el).setName(name).setDesc(desc).addText(t=>t.setValue(String(s[key])).onChange(async v=>{(s as any)[key]=v;await plugin.saveSettings();}));
  const status=el.createDiv({cls:'la-health-detail',text:'点击检测，检查识别服务与翻译模型。'});
  new Setting(el).setName('本地服务').addButton(b=>b.setButtonText('检测连接').onClick(async()=>{b.setDisabled(true);try{const h=await plugin.controller.providers.health();status.setText(`语音识别：${h.asr?'已连接':'未连接'} · 翻译服务：${h.llm?'已连接':'未连接'} · 模型：${h.model?'可用':'未就绪'}`);}finally{b.setDisabled(false);}})).addButton(b=>b.setButtonText('启动服务').onClick(async()=>{b.setDisabled(true);try{await plugin.controller.providers.ensure(t=>status.setText(t));status.setText('识别、翻译与整理均已就绪。');}catch(e){status.setText(String(e));}finally{b.setDisabled(false);}}));
  el.createEl('h3',{text:'录音与识别'});
  new Setting(el).setName('音频来源').setDesc(mac?'系统声音需要安装 Mac 桌面组件，并在系统隐私设置中允许录制。':'选择麦克风或外部输入；Windows 可选择已安装的回环音频设备。').addDropdown(d=>{d.addOption('microphone','麦克风 / 外部音频输入');if(mac&&!mobile)d.addOption('system','系统音频（macOS 原生）');d.setValue(s.audioSource).onChange(async v=>{s.audioSource=v as Settings['audioSource'];await plugin.saveSettings();});});
  new Setting(el).setName('麦克风').setDesc('允许录音后可列出全部输入设备。').addDropdown(d=>{d.addOption('default','系统默认输入').setValue(s.deviceId);void navigator.mediaDevices?.enumerateDevices().then(devices=>{for(const dev of devices.filter(d=>d.kind==='audioinput'&&d.deviceId!=='default'))d.addOption(dev.deviceId,dev.label||'音频输入');d.setValue(s.deviceId);}).catch(()=>{});d.onChange(async v=>{s.deviceId=v;await plugin.saveSettings();});});
  new Setting(el).setName('语音识别引擎').setDesc('均在本机处理。切换后从下一次录音开始使用；已有笔记保留。').addDropdown(d=>d.addOptions({qwen:'Qwen3-ASR 1.7B',whisper:'Whisper · large-v3-turbo'}).setValue(s.asrEngine).onChange(async v=>{s.asrEngine=v as Settings['asrEngine'];await plugin.saveSettings();refresh();}));
  const qwen=s.asrEngine==='qwen';
  new Setting(el).setName('原文语言').setDesc(qwen?'中法自动识别会暂缓识别为其他语言的片段。Qwen 不提供逐句可信度，听不清的内容仍需回听核对。':'中法自动识别会暂缓语言检测不确定的片段，保留录音供回听；英语课程请选择英语。').addDropdown(d=>d.addOptions({fr:'法语',auto:'中法自动识别',en:'英语',zh:'中文'}).setValue(s.language).onChange(async v=>{s.language=v;await plugin.saveSettings();}));
  new Setting(el).setName('中法双路识别').setDesc('同一段按中、法两路解码，Qwen 优先根据原音的语言证据选择，弱证据再参考上下文。自动稿连续显示，两路详情可展开；仍可能误听。打开时自动启用中法语言切换。').addToggle(t=>t.setValue(s.dualRecognition).onChange(async v=>{s.dualRecognition=v;if(v)s.language='auto';await plugin.saveSettings();refresh();}));
  if(qwen){
    text('Qwen 服务地址',mobile?'填写电脑或 HTTPS 识别服务器的地址。':'本机默认 http://127.0.0.1:8182；也可使用你自己的识别服务。','qwenUrl');
    if(!mobile){text('Qwen Python','桌面识别组件的 Python 环境。','qwenPython');text('Qwen 模型目录','桌面识别组件下载的 Qwen3-ASR 1.7B 模型目录。','qwenModel');}
  }else{
  text('Whisper 服务地址','仅本机默认地址；也可连接你自己的 whisper.cpp 服务。','asrUrl');
  if(!mobile){text('Whisper 程序','本地 whisper-server 的绝对路径。','whisperBinary');text('语音模型','large-v3-turbo 或 large-v3 的本地模型路径。','whisperModel');}
  new Setting(el).setName('保留较弱人声（课堂）').setDesc('适合后排和远距离录音，避免提前滤掉老师较轻的声音。关闭后先筛选语音；不确定的字幕仍会暂缓。').addToggle(t=>t.setValue(s.preserveWeakSpeech).onChange(async v=>{s.preserveWeakSpeech=v;await plugin.saveSettings();refresh();}));
  if(!s.preserveWeakSpeech)text('语音检测模型','筛选可能的语音；嘈杂教室中可能漏掉较弱的讲话。','vadModel');
  }
  new Setting(el).setName('识别服务连接密钥').setDesc('连接共享电脑时填写服务生成的密钥。保存在 SecretStorage，本机未设鉴权时可留空。').addText(t=>{t.inputEl.type='password';t.setPlaceholder('仅更新，不回显').onChange(v=>plugin.app.secretStorage?.setSecret(s.asrSecretName,v));});
  new Setting(el).setName('字幕分段长度').setDesc('在自然停顿时提前提交；较短片段更快，较长片段更连贯。').addDropdown(d=>d.addOptions({'4':'4 秒','6':'6 秒','8':'8 秒','10':'10 秒'}).setValue(String(s.chunkSeconds)).onChange(async v=>{s.chunkSeconds=Number(v);await plugin.saveSettings();}));
  el.createEl('h3',{text:'翻译与实时整理'});
  new Setting(el).setName('处理方式').addDropdown(d=>d.addOptions({ollama:'本地 Ollama',compatible:'自定义兼容 API'}).setValue(s.llmMode).onChange(async v=>{s.llmMode=v as Settings['llmMode'];s.llmUrl=v==='ollama'?'http://127.0.0.1:11434':'https://api.deepseek.com';s.llmModel=v==='ollama'?'qwen2.5:3b':'deepseek-flash';await plugin.saveSettings();refresh();}));
  if(s.llmMode==='compatible')el.createEl('p',{cls:'la-provider-notice',text:'使用远程接口时，中法转写与现有提纲会发送到你配置的服务；原始音频仍使用上方的语音识别服务。'});
  text('模型服务地址',s.llmMode==='ollama'?'Ollama 地址，无需 API Key。':'填写接口基础地址，例如 https://api.deepseek.com。','llmUrl');
  text('语言模型',s.llmMode==='ollama'?'填写 Ollama 中已安装的模型名。':'填写接口支持的模型名；DeepSeek 当前可用 deepseek-flash。','llmModel');
  new Setting(el).setName('课堂术语表').setDesc('每行“法语 = 中文”。翻译与整理会参考实际出现的词条，适合从本课讲义补充。').addTextArea(t=>t.setValue(s.glossary).onChange(async v=>{s.glossary=v;await plugin.saveSettings();}));
  if(qwen)new Setting(el).setName('识别时使用课件热词（实验）').setDesc('默认关闭。实测短噪声可能诱导模型复述词表；只在本课录音对照有效后开启，不影响翻译术语表。').addToggle(t=>t.setValue(s.asrUseGlossary).onChange(async v=>{s.asrUseGlossary=v;await plugin.saveSettings();}));
  if(s.llmMode==='ollama'&&!mobile)text('Ollama 程序','自动启动使用的绝对路径。','llmBinary');
  else new Setting(el).setName('API Key').setDesc('保存在 Obsidian SecretStorage；不写入笔记与插件配置。').addText(t=>{t.inputEl.type='password';t.setPlaceholder(plugin.app.secretStorage?'输入新密钥以更新':'请更新 Obsidian 至支持 SecretStorage 的版本');t.setDisabled(!plugin.app.secretStorage);t.onChange(v=>{plugin.app.secretStorage?.setSecret(s.secretName,v);});});
  new Setting(el).setName('课堂要点更新间隔').setDesc('默认积累约30秒内容更新一次主题与要点。远程整理与字幕并行；本地模型优先处理字幕。').addDropdown(d=>d.addOptions({'20':'约 20 秒','30':'约 30 秒','60':'约 60 秒'}).setValue(String(s.summarySeconds)).onChange(async v=>{s.summarySeconds=Number(v);await plugin.saveSettings();}));
  el.createEl('h3',{text:'笔记'});
  text('保存目录','相对于当前 Obsidian 仓库；课堂记录、测试、录音与恢复数据分目录保存在这里。','folder');
  if(!mobile)new Setting(el).setName('自动启动本地服务').addToggle(t=>t.setValue(s.autoLaunch).onChange(async v=>{s.autoLaunch=v;await plugin.saveSettings();}));
  new Setting(el).setName('启动时打开工作台').addToggle(t=>t.setValue(s.openOnStartup).onChange(async v=>{s.openOnStartup=v;await plugin.saveSettings();}));
  if(plugin.controller.busy)el.createEl('p',{text:'设置变更将在本次录音结束后生效。',cls:'la-muted'});
}
export class SettingsModal extends Modal{
  constructor(app:App,private plugin:AtelierPlugin){super(app);}
  onOpen():void{this.modalEl.addClass('la-settings-modal');populate(this.contentEl,this.plugin,()=>this.onOpen());}
}
export class AtelierSettingsTab extends PluginSettingTab{
  constructor(app:App,private plugin:AtelierPlugin){super(app,plugin);}
  display():void{populate(this.containerEl,this.plugin,()=>this.display());}
}
