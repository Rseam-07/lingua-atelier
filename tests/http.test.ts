import{test}from'node:test';import assert from'node:assert/strict';import{createServer}from'node:http';import{jsonRequest,multipart}from'../src/http';
test('HTTP 接口处理失败与真实取消超时，不把无效响应当作成功',async()=>{
  const server=createServer((req,res)=>{if(req.url==='/slow')return;if(req.url==='/fail'){res.writeHead(401);res.end('secret details must not be shown');return;}res.setHeader('Content-Type','application/json');res.end(JSON.stringify({ok:true}));});
  await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const address=server.address()as any;const url=`http://127.0.0.1:${address.port}`;
  try{assert.deepEqual(await jsonRequest(url),{ok:true});await assert.rejects(jsonRequest(url+'/fail'),/HTTP 401/);await assert.rejects(jsonRequest(url+'/slow',{timeout:25}),/超时/);}finally{server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));}
});
test('Whisper multipart 带完整 WAV 二进制和法语语言锁定',()=>{const p=multipart({language:'fr'},Uint8Array.from([0,128,255]).buffer);const body=Buffer.from(p.body);assert.match(body.toString(),/name="language"\r\n\r\nfr/);assert.ok(body.includes(Buffer.from([0,128,255])));assert.match(p.contentType,/multipart\/form-data; boundary=/);});
