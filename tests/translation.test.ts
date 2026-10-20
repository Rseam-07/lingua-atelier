import{test}from'node:test';import assert from'node:assert/strict';import{Providers}from'../src/providers';import{DEFAULTS}from'../src/types';
test('中文原样保留，翻译请求不夹带默认语法主题或无关前文',async()=>{
  const p=new Providers({...DEFAULTS},()=> '');let called=0;p.chat=async(system,user)=>{called++;assert.doesNotMatch(system,/passé composé|imparfait/);assert.equal(user,"Une autre particularité, c'est le cas de la France.");return'另一个特点是法国的情况。';};
  assert.equal(await p.translate('这是中文讲解。','ancienne phrase'),'这是中文讲解。');assert.equal(called,0);
  await p.translate("Une autre particularité, c'est le cas de la France.",'le passé composé');assert.equal(called,1);
});
test('中文讲解中的短法语术语原样保留，完整法语片段单独翻译，不改写中文',async()=>{
  const p=new Providers({...DEFAULTS},()=> '');const calls:string[]=[];
  p.chat=async(_system,user)=>{calls.push(user);return'法国人喝得很多';};
  const chinese='老师说 en、y 和 de 的区别，接下来继续讲解。';
  assert.equal(await p.translate(chinese,''),chinese);assert.equal(calls.length,0);
  assert.equal(await p.translate('老师举例：les Français boivent beaucoup，接下来讲代词 en。',''),'老师举例：法国人喝得很多，接下来讲代词 en。');
  assert.deepEqual(calls,['les Français boivent beaucoup']);
});
