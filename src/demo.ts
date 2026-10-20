import type { Session } from './types';
export function demoSession():Session{
  const lines=[
    ['Aujourd’hui, nous allons comparer le passé composé et l’imparfait.','今天我们来比较复合过去时与未完成过去时。'],
    ['Le passé composé présente une action terminée, un événement précis.','复合过去时表示已经完成的动作，或某个明确发生的事件。'],
    ['L’imparfait décrit le contexte, les habitudes et les actions en cours.','未完成过去时用于描述背景、习惯，以及当时正在进行的动作。'],
    ['Par exemple : quand j’étais petit, je jouais au piano tous les jours.','例如：我小时候，每天都弹钢琴。这里用未完成过去时描述过去的习惯。'],
    ['Hier, j’ai joué du piano pendant deux heures. Ici, l’action est délimitée.','昨天我弹了两个小时钢琴。这里的动作有明确的时间界限。'],
    ['Retenez cette idée : le décor à l’imparfait, l’événement au passé composé.','记住这个思路：背景用未完成过去时，事件用复合过去时。']
  ];
  return {id:'demo',title:'Le passé composé & l’imparfait',created:new Date().toISOString(),phase:'demo',duration:162,segments:lines.map(([source,translation],i)=>({id:i,start:i*24,end:i*24+22,source,translation,status:'done'})),audio:[],outline:'### Deux façons de raconter le passé\n- **Passé composé · 复合过去时**：已完成、有边界的动作或事件\n- **Imparfait · 未完成过去时**：背景、习惯与正在进行的动作\n\n### 放进句子里理解\n- *Quand j’étais petit, je jouais au piano tous les jours.*\n  小时候每天弹琴 → 描述过去的习惯\n- *Hier, j’ai joué du piano pendant deux heures.*\n  昨天弹了两小时 → 描述有明确界限的事件\n\n### Un petit repère · 记忆线索\n- 背景（le décor）→ **imparfait**\n- 事件（l’événement）→ **passé composé**',bookmarks:[{time:120,text:'这组例句值得再听一遍'}],notePath:'',journalPath:'',draft:'',errors:[],summaryVersion:6,demo:true};
}
