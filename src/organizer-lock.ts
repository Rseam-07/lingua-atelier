import {desktop} from './runtime';

/** Shared by the Obsidian button and the Finder launcher. */
export async function lockOrganizer(directory:string):Promise<()=>Promise<void>>{
  const {fs:{promises:{mkdir,open,readFile,unlink}},path:{join}}=desktop();
  await mkdir(directory,{recursive:true});const file=join(directory,'lock.json'),token=crypto.randomUUID();
  for(let attempt=0;attempt<2;attempt++){
    try{
      const handle=await open(file,'wx');try{await handle.writeFile(JSON.stringify({pid:process.pid,token}));}finally{await handle.close();}
      return async()=>{try{if(JSON.parse(await readFile(file,'utf8')).token===token)await unlink(file);}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}};
    }catch(error){
      if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;
      try{
        const owner=JSON.parse(await readFile(file,'utf8'));
        if(!Number.isInteger(owner.pid)||owner.pid<1)throw new Error('invalid lock');
        try{process.kill(owner.pid,0);}catch(e){if((e as NodeJS.ErrnoException).code==='ESRCH'){await unlink(file);continue;}}
      }catch{}
      throw new Error('另一个笔记整理任务正在运行，请稍后再试。');
    }
  }
  throw new Error('暂时无法开始笔记整理。');
}
