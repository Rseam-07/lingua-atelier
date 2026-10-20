const get=async(url)=>{try{const r=await fetch(url,{signal:AbortSignal.timeout(2500)});return await r.json();}catch(e){return {error:e.message};}};
const [qwen,asr,llm]=await Promise.all([get('http://127.0.0.1:8182/health'),get('http://127.0.0.1:8180/health'),get('http://127.0.0.1:11434/api/tags')]);
console.log(JSON.stringify({qwen,whisper:asr,languageModels:llm.models?.map(m=>({name:m.name,size:m.size}))||llm},null,2));
