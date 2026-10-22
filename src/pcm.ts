/** WAV chunks written by this plugin are mono PCM16 at 16 kHz. */
export function decodePcmWav(wav:ArrayBuffer):Float32Array{
  const view=new DataView(wav);const ascii=(offset:number,n:number)=>String.fromCharCode(...new Uint8Array(wav,offset,n));
  if(wav.byteLength<44||ascii(0,4)!=='RIFF'||ascii(8,4)!=='WAVE')throw new Error('本地识别需要有效的 WAV 音频。');
  let format=false;
  for(let offset=12;offset+8<=wav.byteLength;){const tag=ascii(offset,4),size=view.getUint32(offset+4,true),start=offset+8;
    if(start+size>wav.byteLength)throw new Error('WAV 音频不完整。');
    if(tag==='fmt '){if(size<16||view.getUint16(start,true)!==1||view.getUint16(start+2,true)!==1||view.getUint32(start+4,true)!==16000||view.getUint16(start+14,true)!==16)throw new Error('音频需要 16 kHz 单声道 PCM16。');format=true;}
    if(tag==='data'&&format){const samples=new Float32Array(Math.floor(size/2));for(let i=0;i<samples.length;i++)samples[i]=view.getInt16(start+i*2,true)/32768;return samples;}
    offset=start+size+(size%2);
  }
  throw new Error('WAV 音频没有可识别的数据。');
}
