/** Node is optional: Obsidian Mobile has neither Node nor Electron. */
let desktopEnabled = typeof process !== 'undefined' && !!process.versions?.node;
export function configureDesktop(enabled:boolean):void { desktopEnabled=enabled; }
export function hasDesktop():boolean { return desktopEnabled; }
export function desktop(){
  if(!desktopEnabled)throw new Error('移动端请连接电脑或服务器上的识别服务。');
  return {
    fs:require('node:fs') as typeof import('node:fs'),
    path:require('node:path') as typeof import('node:path'),
    os:require('node:os') as typeof import('node:os'),
    child:require('node:child_process') as typeof import('node:child_process'),
  };
}
export function desktopDefaults():Record<string,string>{
  if(!desktopEnabled)return {};
  const {path,os}=desktop(),home=os.homedir();
  const root=process.platform==='win32'?path.join(process.env.LOCALAPPDATA||path.join(home,'AppData','Local'),'Lingua Atelier'):path.join(home,'Library','Application Support','Lingua Atelier');
  return {
    qwenPython:path.join(root,'asr-venv',process.platform==='win32'?'Scripts':'bin',process.platform==='win32'?'python.exe':'python'),
    qwenModel:path.join(root,'models','qwen3-asr-1.7b'),
    qwenServer:path.join(root,'qwen-asr-server.py'),
    systemAudioHelper:process.platform==='darwin'?path.join(root,'system-audio'):'',
  };
}
