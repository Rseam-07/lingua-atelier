import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {pathToFileURL} from 'node:url';

test('共享本地服务在启动者退出后仍可写日志，不因重载关闭管道而退出',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'lingua-service-')),marker=join(dir,'alive'),fixture=join(dir,'parent.mts');
  const child=`import sys,time\nfrom pathlib import Path\ntime.sleep(.3)\nsys.stderr.write('lifetime probe\\n')\nsys.stderr.flush()\ntime.sleep(.1)\nPath(${JSON.stringify(marker)}).write_text('alive')`;
  await writeFile(fixture,`import {Providers} from ${JSON.stringify(pathToFileURL(resolve('src/providers.ts')).href)};\nimport {DEFAULTS} from ${JSON.stringify(pathToFileURL(resolve('src/types.ts')).href)};\nconst p=new Providers(DEFAULTS,()=> '');\n(p as any).launch(${JSON.stringify(process.env.PYTHON||(process.platform==='win32'?'python':'python3'))},['-c',${JSON.stringify(child)}]);\nprocess.exit(0);`);
  try{
    await promisify(execFile)(process.execPath,['--import',pathToFileURL(resolve('node_modules/tsx/dist/loader.mjs')).href,fixture]);
    // The daemon writes only after its parent has exited and closed all pipes.
    const until=Date.now()+3000;let found='';
    while(Date.now()<until){try{found=await readFile(marker,'utf8');break;}catch{await new Promise(r=>setTimeout(r,50));}}
    assert.equal(found,'alive');
  }finally{await rm(dir,{recursive:true,force:true});}
});
