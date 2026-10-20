import {test} from 'node:test';import assert from 'node:assert/strict';
import {selectRecognition,parseLanguageEvidence} from '../src/asr-selection';
import type {RecognitionCandidate,LanguageEvidence} from '../src/types';
const two=(fr:string,zh:string):RecognitionCandidate[]=>[{language:'fr',text:fr},{language:'zh',text:zh}];
const evidence=(fr:number,zh:number):LanguageEvidence=>({method:'unforced-prefix-token',logprobs:{fr,zh},margin:Math.abs(fr-zh),calibrated:false});
test('相同候选省去判断请求；噪声空结果不生成字幕',async()=>{
 const forbidden=async()=>{throw new Error('should not call');};
 const same=await selectRecognition(two('Il fait beau.','Il fait beau!'),'',1,forbidden);assert.equal(same.text,'Il fait beau.');assert.equal(same.comparison.method,'agreement');
 const silent=await selectRecognition(two('',''),'',1,forbidden);assert.equal(silent.text,'');assert.equal(silent.comparison.reviewRequired,false);
});
test('实际原音语言证据优先于较流畅、意思相反的另一候选',async()=>{
 const c=two("Olivier, tu es là, c'est vrai, Olivier.",'嗯，奥利维没来是吧？奥利维。');
 const result=await selectRecognition(c,'',1,async()=>{throw new Error('must not need a text judge');},evidence(-21,-.00002));
 assert.equal(result.text,c[1].text);assert.equal(result.comparison.method,'acoustic');assert.equal(result.comparison.reviewRequired,false);assert.deepEqual(result.comparison.candidates,c);
});
test('混合原句完整包含法语候选时保留中文尾句，不拼接两份冲突内容',async()=>{
 const fr='La France est dix-sept fois moins grande que la Chine.';
 const result=await selectRecognition(two(fr,fr+' 嗯，比中国小十七倍。'),'',1,async()=>'',evidence(-.01,-8));assert.match(result.text,/嗯，比中国小十七倍/);
});
test('文字判断不能改写字幕，判断失败或不确定不会堵住连续字幕',async()=>{
 const c=two('Les Français en boivent beaucoup.','雷芳在昂瓜布谷');
 const chosen=await selectRecognition(c,'老师讨论 en',1,async()=>'{"choice":"fr","text":"invented"}');assert.equal(chosen.text,c[0].text);assert.equal(chosen.comparison.reviewRequired,false);
 for(const response of ['{"choice":"uncertain"}','garbage']){const r=await selectRecognition(c,'',1,async()=>response);assert.equal(r.text,c[0].text);assert.equal(r.comparison.method,'fallback');}
 const fail=await selectRecognition(c,'中文讲解上一句话',1,async()=>{throw new Error('offline');},evidence(-.2,-.5));assert.equal(fail.text,c[0].text);assert.equal(fail.comparison.method,'fallback');
});
test('截断或单路失败采用有效候选；不存在有效候选不编造字幕',async()=>{
 const c=two('Bonjour.','你好。');const r=await selectRecognition([{...c[0],truncated:true},c[1]],'',1,async()=> '');assert.equal(r.text,'你好。');assert.equal(r.comparison.method,'guard');
 const bad=await selectRecognition(c.map(c=>({...c,error:'offline'})),'',1,async()=> '');assert.equal(bad.text,'');assert.equal(bad.comparison.reviewRequired,true);
 assert.equal(parseLanguageEvidence({method:'unforced-prefix-token',logprobs:{fr:NaN,zh:-1},calibrated:false}),undefined);
});
