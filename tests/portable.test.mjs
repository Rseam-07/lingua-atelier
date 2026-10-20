import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

// Execute the actual distributed bundle with Node and Buffer unavailable.
// Desktop emulation alone cannot detect top-level Node dependency crashes.
test('发布包在没有 Node、process、Buffer 的移动端完成加载并通过原生网络转写',async()=>{
  const calls=[];
  class Empty{}
  class Plugin{
    constructor(){this.manifest={dir:'.obsidian/plugins/lingua-atelier'};this.app={vault:{adapter:{}},workspace:{onLayoutReady(){}},secretStorage:{getSecret:id=>id==='lingua-atelier-asr'?'test-connection-token':''}};}
    async loadData(){return{qwenUrl:'https://speech.example.test',autoLaunch:true};}
    registerView(){} addRibbonIcon(){} addCommand(){} registerObsidianProtocolHandler(){} addSettingTab(){}
  }
  const obsidian={Plugin,Notice:Empty,PluginSettingTab:Empty,Modal:Empty,ItemView:Empty,SuggestModal:Empty,Component:Empty,FileSystemAdapter:Empty,TFile:Empty,TFolder:Empty,MarkdownView:Empty,normalizePath:v=>v,Platform:{isDesktopApp:false,isMacOS:false},requestUrl:async options=>{calls.push(options);return{status:200,text:JSON.stringify({engine:'qwen3-asr',model_id:'Qwen3-ASR-1.7B',text:'Bonjour. 你好。',languages:['fr','zh']})};}};
  const module={exports:{}};
  const sandbox={module,exports:module.exports,require:id=>{assert.equal(id,'obsidian','Mobile startup must not load Node modules');return obsidian;},TextEncoder,TextDecoder,URL,AbortController,AbortSignal,setTimeout,clearTimeout,performance,crypto,console};
  vm.runInNewContext(await readFile('dist/lingua-atelier/main.js','utf8'),sandbox);
  const plugin=new module.exports.default();await plugin.onload();
  assert.equal(plugin.settings.qwenPython,'');assert.equal(plugin.settings.audioSource,'microphone');
  assert.equal(await plugin.controller.providers.transcribe(Uint8Array.from([0,128,255]).buffer),'Bonjour. 你好。');
  assert.equal(calls.length,1);assert.equal(calls[0].headers.Authorization,'Bearer test-connection-token');
  assert.ok(Buffer.from(calls[0].body).includes(Buffer.from([0,128,255])));
  plugin.controller.providers.dispose();
});

test('manifest、版本和 SecretStorage 最低版本相符；公开包没有开发路径',async()=>{
  const manifest=JSON.parse(await readFile('manifest.json','utf8')),pkg=JSON.parse(await readFile('package.json','utf8'));
  assert.equal(manifest.version,pkg.version);assert.equal(manifest.isDesktopOnly,false);
  assert.equal(manifest.minAppVersion,'1.11.4');
  const bundle=await readFile('dist/lingua-atelier/main.js','utf8');
  assert.doesNotMatch(bundle,/\/Users\/|Documents\/ChatGPT\/Notes|sk-[a-zA-Z0-9]{20,}/);
  assert.match(bundle,/Bundled third-party software/);
});
