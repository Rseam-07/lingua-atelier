import path from './vault-path';
import {indexContents,linkResolver,mappedPath,planOrganization,rewriteText,updateIndex,type Move,type TextFile} from './organize-core';
import type {Session} from './types';

export interface OrganizerHost {
  files():string[];
  exists(path:string):Promise<boolean>;
  read(path:string):Promise<string>;
  write(path:string,text:string):Promise<void>;
  mkdir(path:string):Promise<void>;
  move(from:string,to:string):Promise<void>;
  remove(path:string):Promise<void>;
  resolve?(target:string,source:string):string|undefined;
  cleanupEmpty?(paths:string[]):Promise<void>;
  protectedFiles?():Set<string>;
}
interface Snapshot extends TextFile {after:string;}
interface History {version:1;id:string;created:string;status:'running'|'complete'|'failed'|'undone';moves:Move[];completed:Move[];snapshots:Snapshot[];}
export class Organizer {
  constructor(private host:OrganizerHost,public root:string,private historyDir:string){}
  private files():string[]{return this.host.files().filter(f=>!f.startsWith(`${this.root}/会话/`)||!f.includes('/versions/'));}
  async plan():Promise<Move[]>{
    const files=this.files(),sessions:Session[]=[];
    for(const file of files.filter(f=>f.endsWith('/session.json'))){
      const s=JSON.parse(await this.host.read(file));if(s.id&&s.notePath&&Array.isArray(s.segments))sessions.push(s);
    }
    const protectedFiles=this.host.protectedFiles?.()||new Set<string>();
    return planOrganization(files,this.root,sessions).filter(m=>!protectedFiles.has(m.from));
  }
  async organize():Promise<{moved:number;home:string}>{return this.apply(await this.plan(),true);}
  async undo():Promise<{moved:number;home:string}>{
    const pointer=`${this.historyDir}/latest.json`;
    if(!await this.host.exists(pointer))throw new Error('还没有可撤销的笔记整理。');
    const {id}=JSON.parse(await this.host.read(pointer));
    if(typeof id!=='string'||!/^[\w-]+$/.test(id))throw new Error('整理记录无效。');
    const file=`${this.historyDir}/${id}.json`,history:History=JSON.parse(await this.host.read(file));
    if(history.status==='undone')throw new Error('最近一次整理已经撤销。');
    // Inspect actual paths too, so an interrupted run can be reversed.
    const performed:Move[]=[];
    for(const move of history.moves){
      if(await this.host.exists(move.to)&&!await this.host.exists(move.from))performed.push(move);
      else if(await this.host.exists(move.to)&&await this.host.exists(move.from))throw new Error(`撤销位置已有同名文件：${move.from}。现有内容已保留，可查看整理备份。`);
    }
    if(!performed.length)throw new Error('没有需要撤销的文件移动。');
    const result=await this.apply(performed.reverse().map(m=>({...m,from:m.to,to:m.from,title:m.beforeTitle,beforeTitle:m.title,reason:'撤销整理'})),false);
    history.status='undone';await this.host.write(file,JSON.stringify(history,null,2));return result;
  }
  private async apply(moves:Move[],remember:boolean):Promise<{moved:number;home:string}>{
    const protectedFiles=this.host.protectedFiles?.()||new Set<string>();
    for(const m of moves){
      if(protectedFiles.has(m.from))throw new Error('正在使用的录音笔记已保留，结束后再整理。');
      if(!await this.host.exists(m.from))throw new Error(`文件已改变位置，请重新整理：${m.from}`);
      if(await this.host.exists(m.to))throw new Error(`目标已有同名文件，已保留原文件：${m.to}`);
    }
    const files=this.files(),resolve=linkResolver(files,this.host.resolve?.bind(this.host));
    const snapshots:Snapshot[]=[];
    for(const file of files.filter(f=>!protectedFiles.has(f)&&(/\.(md|canvas)$/.test(f)||f.endsWith('/session.json')))){
      const text=await this.host.read(file);snapshots.push({path:file,text,after:rewriteText({path:file,text},moves,resolve)});
    }
    const history:History={version:1,id:`${Date.now()}-${crypto.randomUUID().slice(0,8)}`,created:new Date().toISOString(),status:'running',moves,completed:[],snapshots};
    const journal=`${this.historyDir}/${history.id}.json`;
    const checkpoint=()=>this.host.write(journal,JSON.stringify(history,null,2));
    // Save recovery data before the first mutation. A no-op keeps the last undo.
    if(moves.length){await this.host.mkdir(this.historyDir);await checkpoint();if(remember)await this.host.write(`${this.historyDir}/latest.json`,JSON.stringify({id:history.id}));}
    const changed:Snapshot[]=[],created:{path:string;text:string}[]=[];
    try{
      for(const move of moves){
        await this.host.mkdir(path.dirname(move.to));await this.host.move(move.from,move.to);
        history.completed.push(move);await checkpoint();
      }
      for(const snapshot of snapshots.filter(s=>s.text!==s.after)){
        const target=mappedPath(snapshot.path,moves);
        if(await this.host.read(target)!==snapshot.text)throw new Error(`整理期间笔记已被编辑，已停止并回退：${target}`);
        await this.host.write(target,snapshot.after);changed.push(snapshot);
      }
      const contents=indexContents(this.files(),this.root);
      for(const [file,content]of Object.entries(contents)){
        const existed=await this.host.exists(file),before=existed?await this.host.read(file):'';
        const after=updateIndex(before,content);if(after===before)continue;
        await this.host.mkdir(path.dirname(file));await this.host.write(file,after);
        if(existed)changed.push({path:file,text:before,after});else created.push({path:file,text:after});
      }
      history.status='complete';if(moves.length)await checkpoint();
      await this.host.cleanupEmpty?.(moves.map(m=>path.dirname(m.from)));
      return{moved:moves.length,home:`${this.root}/首页.md`};
    }catch(error){
      // Roll back our writes only when no one has edited them since.
      for(const file of [...created].reverse())if(await this.host.exists(file.path)&&await this.host.read(file.path)===file.text)await this.host.remove(file.path);
      for(const s of [...changed].reverse()){
        const target=mappedPath(s.path,moves);
        if(await this.host.exists(target)&&await this.host.read(target)===s.after)await this.host.write(target,s.text);
      }
      for(const m of [...history.completed].reverse())if(await this.host.exists(m.to)&&!await this.host.exists(m.from)){await this.host.mkdir(path.dirname(m.from));await this.host.move(m.to,m.from);}
      history.status='failed';if(moves.length)await checkpoint();throw error;
    }
  }
}
