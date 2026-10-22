import {desktop,hasDesktop,desktopDefaults} from './runtime';
import {unzipSync} from 'fflate/browser';
import type {DownloadProgress,ModelDownload} from './local-models';
declare const __DESKTOP_ASSETS__:Record<string,string>;
const UV:{[platform:string]:{url:string;sha256:string;binary:string}}={
  'darwin-arm64':{url:'https://files.pythonhosted.org/packages/ee/a6/abad398b7b051685ac952e97f00b5b96080644559d554246e9011f7f262f/uv-0.13.3-py3-none-macosx_11_0_arm64.whl',sha256:'6f679430085523fd98fe795ff6545e2bf62fc48478746f6ca1c4dff5cae3daa0',binary:'uv-0.13.3.data/scripts/uv'},
  'darwin-x64':{url:'https://files.pythonhosted.org/packages/4c/9c/c62c4b48b31955dbeaa497ef0594925ef7ca61534b00c3495970c081d47a/uv-0.13.3-py3-none-macosx_10_12_x86_64.whl',sha256:'4e5bd40e3e95b4dc3832639bf0c05244a37c4b1e0b4342a379347f4d9231a8df',binary:'uv-0.13.3.data/scripts/uv'},
  'win32-x64':{url:'https://files.pythonhosted.org/packages/8b/f0/bf4274a0d2121d013a01e4e1c2550a0d307055d9524bead3c51bf424569d/uv-0.13.3-py3-none-win_amd64.whl',sha256:'62d1d071693d0e2c92ba86266e2c83d885b8d1930e368b6b9704a443e55a190d',binary:'uv-0.13.3.data/scripts/uv.exe'},
};
export class DesktopSetup {
  busy=false;
  constructor(private download:ModelDownload){}
  async install(progress:(p:DownloadProgress)=>void,signal:AbortSignal):Promise<Record<string,string>>{
    if(this.busy)throw new Error('桌面环境正在安装，请等待完成。');
    if(!hasDesktop())throw new Error('手机请选择设备本地模型，无需 Python。');
    const spec=UV[`${process.platform}-${process.arch}`];if(!spec)throw new Error('此设备不支持桌面 Qwen 安装器，请选择设备本地 Whisper 或在线识别。');
    this.busy=true;
    try{
      const {fs,path,child}=desktop(),defaults=desktopDefaults(),root=path.dirname(defaults.qwenServer),setup=path.join(root,'setup');
      fs.mkdirSync(setup,{recursive:true});for(const[name,body]of Object.entries(__DESKTOP_ASSETS__))fs.writeFileSync(path.join(setup,name),body,'utf8');
      const uv=path.join(setup,process.platform==='win32'?'uv.exe':'uv');
      if(!fs.existsSync(uv)){
        progress({message:'正在下载独立运行环境…',loaded:0,total:0});
        const archive=await this.download(spec.url,(loaded,total)=>progress({message:'正在下载独立运行环境…',loaded,total}),signal);
        const {createHash}=require('node:crypto') as typeof import('node:crypto');
        if(createHash('sha256').update(new Uint8Array(archive)).digest('hex')!==spec.sha256)throw new Error('运行环境校验失败，请重试。');
        const binary=unzipSync(new Uint8Array(archive),{filter:file=>file.name===spec.binary})[spec.binary];
        if(!binary)throw new Error('下载包缺少运行环境，请重试。');fs.writeFileSync(uv,binary);if(process.platform!=='win32')fs.chmodSync(uv,0o755);
      }
      signal.throwIfAborted();progress({message:'正在安装 Python、推理组件并下载 Qwen。首次可能需要较长时间…',loaded:0,total:0});
      await new Promise<void>((resolve,reject)=>{
        const p=child.spawn(uv,['run','--python','3.12','--no-project','--no-config','--with','huggingface-hub==0.36.0',path.join(setup,'setup_runtime.py'),'--uv',uv,'--root',root,'--yes'],{stdio:['ignore','pipe','pipe'],windowsHide:true,detached:process.platform!=='win32',env:{...process.env,PYTHONUNBUFFERED:'1',HF_HUB_DISABLE_TELEMETRY:'1',UV_CACHE_DIR:path.join(root,'uv-cache')}});
        const abort=()=>{if(p.pid){if(process.platform==='win32')child.spawn('taskkill',['/pid',String(p.pid),'/T','/F'],{windowsHide:true});else try{process.kill(-p.pid,'SIGTERM');}catch{p.kill();}}};
        signal.addEventListener('abort',abort,{once:true});
        const report=(data:Buffer)=>{const last=data.toString('utf8').replace(/\x1b\[[0-9;]*m/g,'').split(/[\r\n]/).filter(Boolean).at(-1);if(last)progress({message:last.slice(0,240),loaded:0,total:0});};
        p.stdout.on('data',report);p.stderr.on('data',report);p.on('error',error=>{signal.removeEventListener('abort',abort);reject(error);});
        p.on('close',code=>{signal.removeEventListener('abort',abort);if(signal.aborted)reject(new Error('安装已取消，已完成的下载保留，可再次继续。'));else if(code===0)resolve();else reject(new Error('安装未完成。请检查网络和磁盘空间后重试；已完成的下载会复用。'));});
      });
      progress({message:'Qwen 桌面环境已安装。',loaded:1,total:1});return defaults;
    }finally{this.busy=false;}
  }
}
