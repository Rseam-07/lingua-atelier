import { App, TFile, normalizePath } from 'obsidian';
import type { Session } from './types';
import { canvasData,newMarkdown,updateMarkdown,safeName,srt } from './core';
import {isTestTitle,isTestSession,recordingFolder} from './organize-core';

export class Store {
  private writes=Promise.resolve();
  constructor(private app:App,public folder:string){}
  async mkdir(path:string):Promise<void>{
    let current='';for(const part of normalizePath(path).split('/')){current=current?`${current}/${part}`:part;if(!await this.app.vault.adapter.exists(current))await this.app.vault.createFolder(current);}
  }
  async create(title:string):Promise<Session>{
    const now=new Date(),id=`${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}-${now.toTimeString().slice(0,8).replace(/:/g,'')}-${Math.random().toString(36).slice(2,6)}`;
    const folder=normalizePath(this.folder);if(folder.startsWith('/')||folder.split('/').includes('..'))throw new Error('笔记目录必须是仓库内的相对路径');
    await this.mkdir(`${folder}/会话/${id}/audio`);
    const notes=recordingFolder(folder,title,now);await this.mkdir(notes);
    const s:Session={id,title,kind:isTestTitle(title)?'test':'classroom',created:now.toISOString(),phase:'starting',duration:0,segments:[],audio:[],outline:'',bookmarks:[],notePath:`${notes}/${id} ${safeName(title)}.md`,journalPath:`${folder}/会话/${id}/session.json`,draft:'',errors:[],summaryVersion:0,demo:false};
    await this.app.vault.create(s.notePath,newMarkdown(s));await this.save(s);return s;
  }
  async saveAudio(s:Session,wav:ArrayBuffer,index:number):Promise<string>{
    const path=`${s.journalPath.slice(0,s.journalPath.lastIndexOf('/'))}/audio/${String(index).padStart(5,'0')}.wav`;
    await this.app.vault.createBinary(path,wav);return path;
  }
  save(s:Session):Promise<void>{
    const snapshot=JSON.parse(JSON.stringify(s)) as Session;
    const operation=this.writes.then(async()=>{
      await this.app.vault.adapter.write(snapshot.journalPath,JSON.stringify(snapshot,null,2));
      const note=this.app.vault.getAbstractFileByPath(snapshot.notePath);
      if(note instanceof TFile)await this.app.vault.process(note,data=>updateMarkdown(data,snapshot));
    });
    this.writes=operation.catch(()=>{});return operation;
  }
  flush():Promise<void>{return this.writes;}
  async backup(s:Session):Promise<void>{
    await this.flush();
    const dir=`${s.journalPath.slice(0,s.journalPath.lastIndexOf('/'))}/versions/${new Date().toISOString().replace(/[:.]/g,'-')}`;
    await this.mkdir(dir);
    await this.app.vault.adapter.write(`${dir}/session.json`,JSON.stringify(s,null,2));
    if(await this.app.vault.adapter.exists(s.notePath))await this.app.vault.adapter.write(`${dir}/note.md`,await this.app.vault.adapter.read(s.notePath));
  }
  async exportCanvas(s:Session):Promise<TFile>{return this.exportText(s.notePath.replace(/\.md$/,'.canvas'),JSON.stringify(canvasData(s),null,2));}
  async exportSrt(s:Session):Promise<TFile>{return this.exportText(s.notePath.replace(/\.md$/,'.srt'),srt(s));}
  private async exportText(path:string,data:string):Promise<TFile>{
    const f=this.app.vault.getAbstractFileByPath(path);if(f instanceof TFile){await this.app.vault.modify(f,data);return f;}return this.app.vault.create(path,data);
  }
  async sessions():Promise<Session[]>{
    const result:Session[]=[];
    const walk=async(path:string):Promise<void>=>{
      if(!await this.app.vault.adapter.exists(path))return;
      const list=await this.app.vault.adapter.list(path);
      for(const dir of list.folders){const file=`${dir}/session.json`;if(await this.app.vault.adapter.exists(file)){try{
        const s=JSON.parse(await this.app.vault.adapter.read(file)) as Session;
        if(s.id&&Array.isArray(s.segments)){
          s.kind=isTestSession(s)?'test':'classroom';
          // Recover a WAV saved just before a crash that interrupted the journal update.
          const audioDir=`${dir}/audio`;
          if(await this.app.vault.adapter.exists(audioDir)){
            const audio=(await this.app.vault.adapter.list(audioDir)).files.filter(f=>f.endsWith('.wav')).sort();
            let end=0;
            for(const path of audio){
              const known=s.audio.find(a=>a.path===path);
              if(known){end=known.end;continue;}
              const wav=await this.app.vault.adapter.readBinary(path);const view=new DataView(wav);
              if(wav.byteLength>=44){const duration=view.getUint32(40,true)/(view.getUint32(24,true)*2);s.audio.push({path,start:end,end:end+duration,status:'saved'});end+=duration;}
            }
          }
          result.push(s);
        }
      }catch{}}}
    };
    await walk(`${this.folder}/会话`);return result.sort((a,b)=>b.created.localeCompare(a.created));
  }
  async readAudio(path:string):Promise<ArrayBuffer>{return this.app.vault.adapter.readBinary(path);}
}
