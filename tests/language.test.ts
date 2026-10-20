import{test}from'node:test';import assert from'node:assert/strict';
import{uncertainClassroomLanguage,relevantGlossary}from'../src/core';
test('实际课堂误检为英语或中法语概率不足时，不将猜测发送给翻译和摘要',()=>{
  assert.equal(uncertainClassroomLanguage({language:'english',language_probabilities:{en:.4512,zh:.4201,fr:.0074}}),true);
  assert.equal(uncertainClassroomLanguage({language:'french',language_probabilities:{fr:.42,zh:.15}}),true);
  assert.equal(uncertainClassroomLanguage({language:'french',language_probabilities:{fr:.989}}),false);
  assert.equal(uncertainClassroomLanguage({language:'chinese',language_probabilities:{zh:.9453}}),false);
  // Older compatible servers may omit this optional metadata.
  assert.equal(uncertainClassroomLanguage({text:'Bonjour.'}),false);
});
test('只传入本段实际出现的词表条目，防止无关课程主题或国家名污染翻译',()=>{
  const glossary='site touristique / site de visite = 参观游览场所\npoids économique = 经济重要性\nla France = 法国\nimparfait = 未完成过去时';
  assert.equal(relevantGlossary(glossary,'Le poids économique.'),'poids économique = 经济重要性');
  assert.equal(relevantGlossary(glossary,'Ces sites de visite.'),'site touristique / site de visite = 参观游览场所');
  assert.equal(relevantGlossary(glossary,'Bonjour.'),'');
});
