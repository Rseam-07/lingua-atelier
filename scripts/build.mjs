import { build } from 'esbuild';
import { mkdir, copyFile,readFile,writeFile,readdir } from 'node:fs/promises';
import {dirname,join} from 'node:path';
import {execFileSync} from 'node:child_process';
await mkdir('dist/lingua-atelier', { recursive: true });
const output=await build({ entryPoints: ['src/main.ts'], bundle: true, platform: 'node', format: 'cjs', target: 'es2022', external: ['obsidian','electron'], outfile: 'dist/lingua-atelier/main.js', sourcemap: false,metafile:true });
const packages=new Set(Object.keys(output.metafile.inputs).filter(p=>p.startsWith('node_modules/')).map(p=>p.split('/').slice(0,p.split('/')[1].startsWith('@')?3:2).join('/')));
let notices='# Bundled third-party software\n\nMarkmap renders the local Markdown mind map. DOMPurify sanitizes node HTML. No remote assets are loaded.\n';
for(const dir of [...packages].sort()){
  const pkg=JSON.parse(await readFile(join(dir,'package.json'),'utf8'));notices+=`\n## ${pkg.name} ${pkg.version}\n\nLicense: ${pkg.license||'See below'}\n\n`;
  for(const f of (await readdir(dir)).filter(f=>/^(?:license|copying|notice)(?:[.-]|$)/i.test(f))){try{notices+=`\n### ${f}\n\n${await readFile(join(dir,f),'utf8')}\n`;}catch{}}
}
await writeFile('dist/lingua-atelier/THIRD_PARTY_NOTICES.md',notices);
// Community/BRAT installations download only three files. Keep attribution
// inside main.js as well as the readable notice supplied with the ZIP.
await writeFile('dist/lingua-atelier/main.js',(await readFile('dist/lingua-atelier/main.js','utf8'))+`\n/*!\n${notices.replace(/\*\//g,'* /')}\n*/\n`);
for (const f of ['manifest.json', 'styles.css']) await copyFile(f, `dist/lingua-atelier/${f}`);
await copyFile('native/qwen_asr_server.py','dist/lingua-atelier/qwen-asr-server.py');
await copyFile('native/qwen_dual.py','dist/lingua-atelier/qwen_dual.py');
await copyFile('native/qwen_transformers.py','dist/lingua-atelier/qwen_transformers.py');
if(process.platform==='darwin'){
  const frameworks=['-framework','ScreenCaptureKit','-framework','CoreMedia','-framework','CoreAudio','-framework','CoreGraphics'];
  const binaries=[];
  for(const arch of ['arm64','x86_64']){
    const binary=`dist/lingua-atelier/system-audio-${arch}`;binaries.push(binary);
    execFileSync('/usr/bin/swiftc',['-O','-swift-version','5','-parse-as-library','-target',`${arch}-apple-macos13.0`,'-module-cache-path','/private/tmp/lingua-swift-native','native/SystemAudio.swift','-o',binary,...frameworks],{stdio:'inherit',env:{...process.env,CLANG_MODULE_CACHE_PATH:'/private/tmp/lingua-clang-native'}});
  }
  execFileSync('/usr/bin/lipo',['-create',...binaries,'-output','dist/lingua-atelier/system-audio']);
}
console.log('Built dist/lingua-atelier');
