import{test}from'node:test';import assert from'node:assert/strict';import{Controller}from'../src/controller';import{demoSession}from'../src/demo';import{DEFAULTS}from'../src/types';import type{Store}from'../src/store';
test('历史会话翻译未完成或提纲中断时，提示恢复而非静默当作完成',async()=>{
  const c=new Controller({...DEFAULTS},{save:async()=>{}}as unknown as Store,()=>'',()=>({start:async()=>{},stop:async()=>{},pause:async()=>{},resume:()=>{}}));
  const s=demoSession();s.demo=false;s.segments[0].status='pending';s.segments[0].translation='';c.load(s);assert.match(c.status,/未完成/);
  s.segments[0].status='done';s.summaryVersion=0;c.load(s);assert.match(c.status,/未完成/);await c.dispose();
});
