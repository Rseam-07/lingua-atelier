/** Local generation shares a GPU; remote notes and translations run independently. */
export class LanguageQueue {
  private translations:(()=>Promise<void>)[]=[];
  private summaries:((signal:AbortSignal)=>Promise<void>)[]=[];
  private activeSummary:AbortController|null=null;
  private running=false;private notesRunning=false;
  private waiters:(()=>void)[]=[];
  constructor(private independentNotes:()=>boolean=()=>false){}
  translate(task:()=>Promise<void>):void{this.translations.push(task);this.interruptSummary();void this.run();}
  summarize(task:(signal:AbortSignal)=>Promise<void>):void{this.summaries.push(task);if(this.independentNotes())void this.runNotes();else void this.run();}
  interruptSummary():void{if(!this.independentNotes())this.activeSummary?.abort();}
  private settled():void{if(!this.running&&!this.notesRunning&&!this.translations.length&&!this.summaries.length)for(const resolve of this.waiters.splice(0))resolve();}
  private async note():Promise<void>{const aborter=new AbortController();this.activeSummary=aborter;try{await this.summaries.shift()!(aborter.signal);}finally{this.activeSummary=null;}}
  private async runNotes():Promise<void>{
    if(this.notesRunning)return;this.notesRunning=true;
    try{while(this.summaries.length)await this.note();}finally{this.notesRunning=false;this.settled();}
  }
  private async run():Promise<void>{
    if(this.running)return;this.running=true;
    try{while(this.translations.length||(!this.independentNotes()&&this.summaries.length)){
      if(this.translations.length)await this.translations.shift()!();else await this.note();
    }}finally{this.running=false;this.settled();}
  }
  drain():Promise<void>{return this.running||this.notesRunning||this.translations.length||this.summaries.length?new Promise(resolve=>this.waiters.push(resolve)):Promise.resolve();}
}
