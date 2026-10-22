import { Plugin,Notice,FileSystemAdapter,MarkdownView,TFile,TFolder,normalizePath,Platform,requestUrl } from 'obsidian';
import {configureDesktop,desktop,desktopDefaults} from './runtime';
import {configureMobileTransport} from './http';
import {LocalModels} from './local-models';
import {DesktopSetup} from './desktop-setup';
import {downloadBytes} from './download';
import {QuickSetupModal,UsageModal} from './onboarding';
import { DEFAULTS,type Settings } from './types';
import { Controller } from './controller';
import { Store } from './store';
import { VIEW,AtelierView,SessionPicker } from './view';
import { AtelierSettingsTab,SettingsModal } from './settings';
import {Organizer,type OrganizerHost} from './organizer';
import {isTestSession} from './organize-core';
import {lockOrganizer} from './organizer-lock';
import type {Session} from './types';
export default class AtelierPlugin extends Plugin{
  declare settings:Settings;controller!:Controller;localModels!:LocalModels;desktopSetup!:DesktopSetup;
  private setupModal:QuickSetupModal|null=null;
  async onload():Promise<void>{
    configureDesktop(Platform.isDesktopApp);
    if(!Platform.isDesktopApp)configureMobileTransport(async(url,options)=>requestUrl({url,method:options.method,headers:options.headers,body:options.body,throw:false}));
    const loaded=await this.loadData();
    this.settings={...DEFAULTS,...desktopDefaults(),...loaded};
    // An existing working installation keeps its engine, paths and secrets.
    if(loaded&&Object.keys(loaded).length&&!Object.hasOwn(loaded,'setupCompleted'))this.settings.setupCompleted=true;
    this.localModels=new LocalModels(this.app.vault.adapter,`${this.manifest.dir||`${this.app.vault.configDir||'.obsidian'}/plugins/lingua-atelier`}/local-models`,downloadBytes);
    this.desktopSetup=new DesktopSetup(downloadBytes);this.makeController();
    this.controller.onChange(()=>{if(!this.controller.busy){Object.assign(this.controller.settings,this.settings);this.controller.store.folder=this.settings.folder;}});
    this.registerView(VIEW,leaf=>new AtelierView(leaf,this));
    this.addRibbonIcon('audio-lines','打开 Lingua Atelier',()=>void this.open());
    this.addCommand({id:'open',name:'打开录音工作台',callback:()=>void this.open()});
    this.addCommand({id:'stop',name:'结束录音并保存',callback:()=>void this.controller.stop()});
    this.addCommand({id:'pause',name:'暂停 / 继续录音',callback:()=>void this.controller.pause()});
    this.addCommand({id:'mark',name:'标记当前重点',callback:()=>this.controller.mark()});
    this.addCommand({id:'history',name:'打开历史会话 / 恢复未完成转写',callback:()=>void this.controller.store.sessions().then(s=>new SessionPicker(this,s).open())});
    this.addCommand({id:'settings',name:'识别与翻译设置',callback:()=>new SettingsModal(this.app,this).open()});
    this.addCommand({id:'quick-setup',name:'快速设置：选择并下载模型',callback:()=>this.openSetup()});
    this.addCommand({id:'usage-help',name:'查看使用提示',callback:()=>this.openHelp()});
    this.addCommand({id:'reorganize-all-content',name:'一键重整全部历史课堂内容与导图',callback:()=>void this.controller.reorganizeAll().catch(e=>new Notice(String(e)))});
    this.addCommand({id:'reorganize-content',name:'重新整理当前课程内容与导图',callback:()=>void this.controller.reorganize().catch(e=>new Notice(String(e)))});
    this.addCommand({id:'organize-notes',name:'一键整理笔记',callback:()=>void this.organizeNotes()});
    this.addCommand({id:'undo-organize-notes',name:'撤销最近一次笔记整理',callback:()=>void this.organizeNotes(true)});
    this.addCommand({id:'notebook-home',name:'打开笔记首页',callback:()=>void this.openNotebookHome()});
    this.addCommand({id:'mark-review',name:'标记当前转写待核对',callback:()=>{const c=this.controller;if(c.busy||!c.session||c.session.demo)return;c.session.reviewRequired=true;void c.store.save(c.session).then(()=>c.emit());}});
    this.registerObsidianProtocolHandler('lingua',()=>void this.open());
    this.addSettingTab(new AtelierSettingsTab(this.app,this));
    this.app.workspace.onLayoutReady(()=>{void(async()=>{
      const sessions=(await this.controller.store.sessions()).filter(s=>s.kind!=='test');if(!this.controller.session&&sessions[0])this.controller.load(sessions[0]);
      if(this.settings.openOnStartup)await this.open();
      if(!loaded||!Object.keys(loaded).length)this.openSetup();
    })().catch(e=>new Notice(String(e)));});
  }
  private makeController():void{
    if(Platform.isDesktopApp&&this.app.vault.adapter instanceof FileSystemAdapter){
      const {path:{join},fs:{existsSync}}=desktop();
      const dir=join(this.app.vault.adapter.getBasePath(),this.manifest.dir||'.obsidian/plugins/lingua-atelier');
      if(existsSync(join(dir,'system-audio')))this.settings.systemAudioHelper=join(dir,'system-audio');
      if(existsSync(join(dir,'qwen-asr-server.py')))this.settings.qwenServer=join(dir,'qwen-asr-server.py');
    }
    if(!Platform.isDesktopApp)this.settings.audioSource='microphone';
    this.controller=new Controller({...this.settings},new Store(this.app,this.settings.folder),()=>this.app.secretStorage?.getSecret(this.settings.llmUseCloudKey?this.settings.cloudSecretName:this.settings.secretName)||'',undefined,()=>this.app.secretStorage?.getSecret(this.settings.asrSecretName)||'',this.localModels,()=>this.app.secretStorage?.getSecret(this.settings.cloudSecretName)||'');
  }
  async saveSettings():Promise<void>{
    await this.saveData(this.settings);
    if(!this.controller.busy){Object.assign(this.controller.settings,this.settings);this.controller.providers.settings=this.controller.settings;this.controller.store.folder=this.settings.folder;}
    this.controller.emit();
  }
  async open():Promise<void>{let leaf=this.app.workspace.getLeavesOfType(VIEW)[0];if(!leaf){leaf=this.app.workspace.getLeaf('tab');await leaf.setViewState({type:VIEW,active:true});}await this.app.workspace.revealLeaf(leaf);}
  openSetup():void{this.setupModal?.close();this.setupModal=new QuickSetupModal(this);this.setupModal.open();}
  openHelp(first=false):void{new UsageModal(this,first).open();}
  async openNotebookHome():Promise<void>{
    const file=this.app.vault.getAbstractFileByPath(`${this.settings.folder}/首页.md`);
    if(!(file instanceof TFile)){await this.organizeNotes();return;}
    const leaf=this.app.workspace.getLeavesOfType('markdown').find(l=>l.view instanceof MarkdownView&&l.view.file?.path===file.path)||this.app.workspace.getLeaf('tab');
    await leaf.openFile(file);await this.app.workspace.revealLeaf(leaf);
  }
  async organizeNotes(undo=false):Promise<void>{
    try{
      const c=this.controller;
      const result=await c.maintain(async()=>{
        const root=normalizePath(this.settings.folder);
        if(!root||root.startsWith('/')||root.split('/').some(p=>p==='..'||p.startsWith('.')))throw new Error('笔记目录必须是仓库内的普通文件夹。');
        c.status=undo?'正在撤销笔记整理…':'正在归档测试、整理课堂记录…';c.emit();
        const vault=this.app.vault;
        // Include session JSON and exports even when the file explorer hides
        // unsupported extensions. Never traverse Obsidian's config or trash.
        const tracked=new Set<string>();
        const scan=async(dir:string):Promise<void>=>{const list=await vault.adapter.list(dir);for(const f of list.files)if(!f.split('/').some(p=>p.startsWith('.')))tracked.add(f);for(const child of list.folders)if(!child.split('/').some(p=>p.startsWith('.')))await scan(child);};
        await scan('');
        const host:OrganizerHost={
          files:()=>[...tracked],
          exists:p=>vault.adapter.exists(p),read:p=>vault.adapter.read(p),
          mkdir:async p=>{let current='';for(const part of p.split('/')){current=current?`${current}/${part}`:part;if(!await vault.adapter.exists(current)){if(current.startsWith('.'))await vault.adapter.mkdir(current);else await vault.createFolder(current);}}},
          write:async(p,text)=>{const f=vault.getAbstractFileByPath(p);if(f instanceof TFile)await vault.modify(f,text);else if(p.startsWith('.')||await vault.adapter.exists(p))await vault.adapter.write(p,text);else await vault.create(p,text);if(!p.startsWith('.'))tracked.add(p);},
          // Links are resolved before moves and explicitly rewritten, independent
          // of the vault's interactive "update links" preference.
          move:async(from,to)=>{const f=vault.getAbstractFileByPath(from);if(f)await vault.rename(f,to);else await vault.adapter.rename(from,to);tracked.delete(from);tracked.add(to);},
          remove:async p=>{const f=vault.getAbstractFileByPath(p);if(f)await vault.trash(f,true);tracked.delete(p);},
          resolve:(target,source)=>this.app.metadataCache.getFirstLinkpathDest(target,source)?.path,
          cleanupEmpty:async paths=>{for(const p of [...new Set(paths)].filter(Boolean).sort((a,b)=>b.length-a.length)){const f=vault.getAbstractFileByPath(p);if(f instanceof TFolder&&!f.children.length)await vault.trash(f,true);}}
        };
        const history=`${this.manifest.dir||'.obsidian/plugins/lingua-atelier'}/organizer-history`;
        const unlock=Platform.isDesktopApp&&vault.adapter instanceof FileSystemAdapter?await lockOrganizer(desktop().path.join(vault.adapter.getBasePath(),history)):async()=>{};
        let outcome;try{const organizer=new Organizer(host,root,history);outcome=undo?await organizer.undo():await organizer.organize();}finally{await unlock();}
        if(c.session&&!c.session.demo){
          const saved=JSON.parse(await vault.adapter.read(c.session.journalPath))as Session;
          if(isTestSession(saved))c.session=null;
          else Object.assign(c.session,saved);
        }
        c.status=undo?`已撤销 ${outcome.moved} 个文件的移动，保留现有编辑`:`已整理 ${outcome.moved} 个文件 · 笔记首页已更新`;
        return outcome;
      });
      new Notice(this.controller.status,7000);await this.openNotebookHome();
    }catch(e){const message=e instanceof Error?e.message:String(e);if(!this.controller.busy){this.controller.status=message;this.controller.emit();}new Notice(message,10000);}
  }
  onunload():void{this.setupModal?.close();void this.controller.dispose().finally(()=>this.localModels.dispose());}
}
