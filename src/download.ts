import {requestUrl} from 'obsidian';
/** Streaming where WebView networking permits it, native transport for CORS.
 * Callers supply only allowlisted model/runtime URLs, never recording data. */
export async function downloadBytes(url:string,onBytes:(loaded:number,total:number)=>void,signal:AbortSignal):Promise<ArrayBuffer>{
  signal.throwIfAborted();
  try{
    const response=await fetch(url,{signal,credentials:'omit'});
    if(!response.ok)throw new Error(`下载失败（HTTP ${response.status}），请稍后重试或检查网络。`);
    const total=Number(response.headers.get('Content-Length'))||0;
    if(!response.body){const bytes=await response.arrayBuffer();signal.throwIfAborted();onBytes(bytes.byteLength,total);return bytes;}
    const reader=response.body.getReader(),chunks:Uint8Array[]=[];let loaded=0;
    while(true){const{value,done}=await reader.read();if(done)break;signal.throwIfAborted();chunks.push(value);loaded+=value.byteLength;onBytes(loaded,total);}
    const bytes=new Uint8Array(loaded);let cursor=0;for(const chunk of chunks){bytes.set(chunk,cursor);cursor+=chunk.byteLength;}return bytes.buffer;
  }catch(error){
    signal.throwIfAborted();if(!(error instanceof TypeError))throw error;
    // WKWebView/Electron may reject a cross-origin fetch while Obsidian's native
    // request works. Never interpret an HTTP failure as a reason to switch host.
    const response=await requestUrl({url,method:'GET',throw:false});signal.throwIfAborted();
    if(response.status!==200)throw new Error(`下载失败（HTTP ${response.status}），请检查网络后重试。`);
    const bytes=response.arrayBuffer;onBytes(bytes.byteLength,bytes.byteLength);return bytes;
  }
}
