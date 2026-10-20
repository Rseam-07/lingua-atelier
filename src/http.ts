import {hasDesktop} from './runtime';
export interface HttpOptions {method?:string;body?:ArrayBuffer|string;headers?:Record<string,string>;timeout?:number;signal?:AbortSignal;}
type MobileTransport=(url:string,options:HttpOptions)=>Promise<{status:number;text:string}>;
let mobileTransport:MobileTransport|undefined;
export function configureMobileTransport(transport:MobileTransport):void{mobileTransport=transport;}
const parse=(status:number,text:string):unknown=>{
  if(status>=400)throw new Error(`服务返回 HTTP ${status}；请检查地址、模型和授权配置。`);
  if(text.length>8*1024*1024)throw new Error('服务返回过大');
  try{return text?JSON.parse(text):{};}catch{throw new Error('服务返回的不是 JSON；请检查端口和接口地址。');}
};
export async function jsonRequest(url:string,options:HttpOptions={}):Promise<any>{
  const u=new URL(url);if(!['http:','https:'].includes(u.protocol))throw new Error('服务地址必须使用 http 或 https');
  options.signal?.throwIfAborted();
  if(!hasDesktop()){
    if(!mobileTransport)throw new Error('移动端网络组件尚未就绪。');
    // requestUrl bypasses WebView CORS. Its native request cannot be aborted;
    // discard late results instead of applying them to a stopped session.
    return new Promise((resolve,reject)=>{
      const finish=(error?:unknown,result?:unknown)=>{clearTimeout(timer);options.signal?.removeEventListener('abort',abort);error?reject(error):resolve(result);};
      const abort=()=>finish(options.signal?.reason||new Error('请求已取消'));
      const timer=setTimeout(()=>finish(new Error('请求超时；原始录音已保留，可稍后重试。')),options.timeout||60000);
      options.signal?.addEventListener('abort',abort,{once:true});
      mobileTransport!(url,options).then(r=>{try{finish(undefined,parse(r.status,r.text));}catch(e){finish(e);}},e=>finish(e));
    });
  }
  const {request}=require(u.protocol==='https:'?'node:https':'node:http') as typeof import('node:http');
  return new Promise((resolve,reject)=>{
    const body=typeof options.body==='string'?options.body:options.body?Buffer.from(options.body):undefined;
    const req=request(u,{method:options.method||'GET',headers:{...options.headers,...(body?{'Content-Length':Buffer.byteLength(body).toString()}:{})},signal:options.signal},res=>{
      const chunks:Buffer[]=[];let size=0;
      res.on('data',(chunk:Buffer)=>{size+=chunk.length;if(size>8*1024*1024)req.destroy(new Error('服务返回过大'));else chunks.push(chunk);});
      res.on('error',reject);res.on('end',()=>{try{resolve(parse(res.statusCode||500,Buffer.concat(chunks).toString('utf8')));}catch(e){reject(e);}});
    });
    const timer=setTimeout(()=>req.destroy(new Error('请求超时；原始录音已保留，可稍后重试。')),options.timeout||60000);
    req.on('close',()=>clearTimeout(timer));req.on('error',reject);if(body)req.write(body);req.end();
  });
}
export function multipart(fields:Record<string,string>,wav:ArrayBuffer):{body:ArrayBuffer;contentType:string}{
  const boundary=`----lingua${Date.now().toString(16)}${Math.random().toString(16).slice(2)}`,encoder=new TextEncoder();
  const chunks=Object.entries(fields).map(([key,value])=>encoder.encode(`--${boundary}\r\nContent-Disposition: form-data; name="${key}"\r\n\r\n${value}\r\n`));
  chunks.push(encoder.encode(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="audio.wav"\r\nContent-Type: audio/wav\r\n\r\n`),new Uint8Array(wav),encoder.encode(`\r\n--${boundary}--\r\n`));
  const joined=new Uint8Array(chunks.reduce((sum,c)=>sum+c.length,0));let offset=0;for(const chunk of chunks){joined.set(chunk,offset);offset+=chunk.length;}
  return{body:joined.buffer,contentType:`multipart/form-data; boundary=${boundary}`};
}
