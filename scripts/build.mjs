import { build } from 'esbuild';
import { mkdir, copyFile,readFile,writeFile,readdir } from 'node:fs/promises';
import {dirname,join,resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
await mkdir('dist/lingua-atelier', { recursive: true });
const ort='node_modules/onnxruntime-web/dist/';
let ortLoader=await readFile(ort+'ort-wasm-simd-threaded.mjs','utf8');
if(!ortLoader.includes('export default ortWasmThreaded;'))throw new Error('Unexpected ONNX loader version');
// Emscripten otherwise resolves a relative URL against a blob URL even when
// wasmBinary is provided. The inlined binary is used; no network fetch occurs.
ortLoader=ortLoader.replace('export default ortWasmThreaded;','export default options => ortWasmThreaded({...options, locateFile: () => "data:application/wasm;base64,"});');
const worker=await build({entryPoints:['src/local-worker.ts'],bundle:true,platform:'browser',format:'iife',target:'es2022',write:false,minify:true,metafile:true,conditions:['onnxruntime-web-use-extern-wasm'],alias:{'@huggingface/transformers':resolve('node_modules/@huggingface/transformers/src/transformers.js'),'onnxruntime-web':'onnxruntime-web/wasm','onnxruntime-node':resolve('src/browser-empty.ts'),'node:fs':resolve('src/browser-empty.ts'),'node:path':resolve('src/browser-empty.ts'),'node:url':resolve('src/browser-empty.ts'),'sharp':resolve('src/browser-empty.ts')},define:{__ORT_WASM__:JSON.stringify((await readFile(ort+'ort-wasm-simd-threaded.wasm')).toString('base64')),__ORT_LOADER__:JSON.stringify(ortLoader)}});
await writeFile('dist/local-worker.js',worker.outputFiles[0].text);
const desktopAssets={};
for(const name of ['setup_runtime.py','requirements-mac.txt','requirements-windows.txt','start_service.py'])desktopAssets[name]=await readFile(`installers/${name}`,'utf8');
for(const[from,to]of [['qwen_asr_server.py','qwen-asr-server.py'],['qwen_dual.py','qwen_dual.py'],['qwen_transformers.py','qwen_transformers.py']])desktopAssets[to]=await readFile(`native/${from}`,'utf8');
const output=await build({ entryPoints: ['src/main.ts'], bundle: true, platform: 'node', format: 'cjs', target: 'es2022', external: ['obsidian','electron'], outfile: 'dist/lingua-atelier/main.js', sourcemap: false,metafile:true,define:{__LOCAL_WORKER__:JSON.stringify(worker.outputFiles[0].text),__DESKTOP_ASSETS__:JSON.stringify(desktopAssets)} });
const packages=new Set([...Object.keys(output.metafile.inputs),...Object.keys(worker.metafile.inputs)].filter(p=>p.startsWith('node_modules/')).map(p=>p.split('/').slice(0,p.split('/')[1].startsWith('@')?3:2).join('/')));
let notices='# Bundled third-party software\n\nMarkmap renders Markdown mind maps. DOMPurify sanitizes node HTML. Transformers.js and ONNX Runtime Web run local models in a worker. Executable JS and WASM are bundled; only selected model data is downloaded after the user clicks Download.\n';
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
