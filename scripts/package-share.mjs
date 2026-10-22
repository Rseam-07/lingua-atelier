import {mkdir,copyFile,readFile,writeFile,readdir,lstat,rm,chmod} from 'node:fs/promises';
import {join,resolve,dirname} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';

// A positive allowlist prevents a new private course or local config from being
// accidentally published just because somebody added it to the working folder.
const manifest=JSON.parse(await readFile('manifest.json','utf8'));
const version=manifest.version,root=resolve('releases'),source=join(root,'public-source'),kit=join(root,`Lingua-Atelier-${version}-beta`);
const copy=async(from,to)=>{await mkdir(dirname(to),{recursive:true});await copyFile(from,to);};
const clearGenerated=async directory=>{if(!directory.startsWith(root+'/'))throw new Error('Invalid generated output');await rm(directory,{recursive:true,force:true});await mkdir(directory,{recursive:true});};
await mkdir(root,{recursive:true});await clearGenerated(source);await clearGenerated(kit);
const files=['README.md','LICENSE','manifest.json','versions.json','package.json','package-lock.json','tsconfig.json','styles.css','lingua-paper.css','.gitignore'];
for(const directory of ['src','installers','docs','.github/workflows']){
  for(const file of await readdir(directory))if(/\.(?:ts|py|txt|md|command|ps1|yml)$/.test(file))files.push(`${directory}/${file}`);
}
for(const file of await readdir('tests'))if(file.endsWith('.test.ts')||['portable.test.mjs','qwen_server_test.py','qwen_dual_test.py','portable_runtime_test.py'].includes(file))files.push(`tests/${file}`);
for(const file of ['build.mjs','install-public.mjs','check-local.mjs','package-share.mjs','smoke-local-inference.mts'])files.push(`scripts/${file}`);
for(const file of ['SystemAudio.swift','qwen_asr_server.py','qwen_dual.py','qwen_transformers.py'])files.push(`native/${file}`);
for(const file of files){if(!(await lstat(file)).isFile())throw new Error('Unexpected source entry');await copy(file,join(source,file));}
await copy('dist/lingua-atelier/THIRD_PARTY_NOTICES.md',join(source,'THIRD_PARTY_NOTICES.md'));
await copy('dist/lingua-atelier/THIRD_PARTY_NOTICES.md',join(kit,'THIRD_PARTY_NOTICES.md'));
for(const file of ['main.js','manifest.json','styles.css'])await copy(`dist/lingua-atelier/${file}`,join(kit,'lingua-atelier',file));
for(const file of ['README.md','LICENSE'])await copy(file,join(kit,file));
for(const file of ['Install-Mac.command','Install-Windows.ps1'])await copy(`installers/${file}`,join(kit,file));
for(const file of ['setup_runtime.py','start_service.py','requirements-mac.txt','requirements-windows.txt','Setup-Mac.command','Setup-Windows.ps1','Share-to-phone-Mac.command','Share-to-phone-Windows.ps1'])await copy(`installers/${file}`,join(kit,'desktop-service',file));
for(const [from,to]of [['native/qwen_asr_server.py','qwen-asr-server.py'],['native/qwen_dual.py','qwen_dual.py'],['native/qwen_transformers.py','qwen_transformers.py'],['native/SystemAudio.swift','SystemAudio.swift']])await copy(from,join(kit,'desktop-service',to));
try{await copy('dist/lingua-atelier/system-audio',join(kit,'desktop-service','system-audio'));await chmod(join(kit,'desktop-service','system-audio'),0o755);}catch(e){if(e.code!=='ENOENT')throw e;}
for(const file of ['QUICKSTART.md','PUBLISHING.md'])await copy(`docs/${file}`,join(kit,'docs',file));
await copy('lingua-paper.css',join(kit,'appearance','lingua-paper.css'));
const walk=async(dir,prefix='')=>{const result=[];for(const file of await readdir(dir)){const relative=prefix?`${prefix}/${file}`:file,absolute=join(dir,file);if((await lstat(absolute)).isDirectory())result.push(...await walk(absolute,relative));else result.push(relative);}return result.sort();};
for(const dir of [source,kit])for(const relative of await walk(dir)){
  if(/(?:^|\/)(?:data\.json|connection-token\.txt|session\.json|\.env[^/]*|\.obsidian)(?:\/|$)|\.(?:wav|m4a|mp3|mp4|pdf|safetensors|bin)$/i.test(relative))throw new Error(`Private/runtime file in package: ${relative}`);
  const content=(await readFile(join(dir,relative))).toString('utf8');
  if(/\/Users\/[^/\s]+|Documents\/ChatGPT\/Notes|sk-[A-Za-z0-9]{20,}|-----BEGIN (?:RSA |OPENSSH )?PRIVATE KEY/.test(content))throw new Error(`Private path or credential in package: ${relative}`);
}
await writeFile(join(root,'public-files.json'),JSON.stringify(await walk(source),null,2)+'\n');
// Python's ZIP writer works on macOS, Windows and CI and preserves executable bits.
const python=process.env.PYTHON||(process.platform==='win32'?'python':'python3');
const zipScript=`import os,sys,zipfile\nfrom pathlib import Path\nroot=Path(sys.argv[1]); target=Path(sys.argv[2])\nwith zipfile.ZipFile(target,'w',compression=zipfile.ZIP_DEFLATED,compresslevel=9) as z:\n for f in sorted(root.rglob('*')):\n  if f.is_file(): z.write(f,Path(root.name)/f.relative_to(root))\n`;
const archives=[{dir:kit,name:`Lingua-Atelier-${version}-beta.zip`},{dir:source,name:`Lingua-Atelier-${version}-source.zip`}];
for(const {dir,name}of archives)execFileSync(python,['-c',zipScript,dir,join(root,name)],{stdio:'inherit'});
const sums=[];for(const {name}of archives){const data=await readFile(join(root,name));sums.push(`${createHash('sha256').update(data).digest('hex')}  ${name}`);console.log(`${name}: ${(data.length/1024).toFixed(0)} KiB`);}
await writeFile(join(root,'SHA256SUMS.txt'),sums.join('\n')+'\n');
console.log(`Public allowlist audit passed. ${files.length} source files; no notes, recordings, credentials or model weights.`);
