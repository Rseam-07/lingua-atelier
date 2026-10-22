import {jsonRequest} from './http';
import {isNonSpeech} from './core';
export const cloudBase=(region:'cn'|'intl'):string=>region==='intl'?'https://dashscope-intl.aliyuncs.com/compatible-mode/v1':'https://dashscope.aliyuncs.com/compatible-mode/v1';
export function base64(bytes:ArrayBuffer):string{
  // No Buffer/btoa dependency: the same encoder is used by iOS and Android.
  const input=new Uint8Array(bytes),alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';let result='';
  for(let i=0;i<input.length;i+=3){const n=input[i]<<16|(input[i+1]||0)<<8|(input[i+2]||0);result+=alphabet[n>>>18&63]+alphabet[n>>>12&63]+(i+1<input.length?alphabet[n>>>6&63]:'=')+(i+2<input.length?alphabet[n&63]:'=');}
  return result;
}
export async function cloudTranscribe(wav:ArrayBuffer,options:{region:'cn'|'intl';key:string;language:string;consent:boolean;signal:AbortSignal}):Promise<string>{
  if(!options.consent)throw new Error('请先在快速设置中确认使用在线识别，录音才会发送到所选服务。');
  if(!options.key.trim())throw new Error('请在快速设置中填写所选地域的阿里云百炼 API Key。DeepSeek 密钥仅用于文字处理。');
  if(wav.byteLength>10*1024*1024)throw new Error('单段音频过大，请缩短字幕分段长度。');
  const d=await jsonRequest(`${cloudBase(options.region)}/chat/completions`,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${options.key}`},signal:options.signal,timeout:90000,body:JSON.stringify({model:'qwen3-asr-flash',stream:false,messages:[{role:'user',content:[{type:'input_audio',input_audio:{data:`data:audio/wav;base64,${base64(wav)}`}}]}],asr_options:{enable_itn:false,...(options.language==='auto'?{}:{language:options.language})}})});
  const text=d.choices?.[0]?.message?.content;
  if(typeof text!=='string')throw new Error('在线识别没有返回有效文字，原音已保存，可稍后重试。');
  if(d.choices[0].finish_reason==='length')throw new Error('在线识别结果不完整，原音已保存，请缩短分段后重试。');
  return isNonSpeech(text)?'':text.trim();
}
