import type { Session, Segment } from './types';

export function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}
export function safeName(s: string): string {
  return s.normalize('NFC').replace(/[\\/:*?"<>|\x00-\x1f]/g, ' ').replace(/^\.+/, '').trim().slice(0, 90) || '未命名笔记';
}
export function yamlString(s: string): string { return JSON.stringify(s); }
export function normalizeText(s: string): string { return s.toLocaleLowerCase('fr').normalize('NFC').replace(/[\p{P}\p{S}]/gu, '').replace(/\s+/g, ' ').trim(); }
/** Deduplicate only an explicit overlap. Ordinary repeated sentences remain valid speech. */
export function stripOverlap(previous: string, current: string): string {
  const a = previous.trim().split(/\s+/), b = current.trim().split(/\s+/);
  for (let n = Math.min(a.length, b.length, 24); n >= 3; n--) {
    if (normalizeText(a.slice(-n).join(' ')) === normalizeText(b.slice(0, n).join(' '))) return b.slice(n).join(' ');
  }
  return current.trim();
}
export function cleanModelText(s: string): string {
  return s.replace(/<think>[\s\S]*?<\/think>/g, '').replace(/^```(?:markdown|md)?\s*\n([\s\S]*?)\n```\s*$/, '$1').trim();
}
export function isNonSpeech(text:string):boolean{
  return !text.trim() || /^\s*([\[(（【][^\])）】]{1,90}[\])）】][\s.,…]*)+$/u.test(text)
    || /^\s*[♪♫♬\s]+\s*$/.test(text);
}
/** Language confidence is a rejection signal, never proof of word accuracy. */
export function uncertainClassroomLanguage(result:any):boolean{
  const probabilities=result.language_probabilities;
  if(!probabilities||typeof probabilities!=='object')return false;
  const selected=String(result.language||result.detected_language||'').toLowerCase();
  return !['french','chinese','fr','zh'].includes(selected)
    || Math.max(Number(probabilities.fr)||0,Number(probabilities.zh)||0)<0.65;
}
export function relevantGlossary(glossary:string,text:string):string{
  const normal=(s:string)=>s.normalize('NFD').replace(/\p{M}/gu,'').toLocaleLowerCase('fr').replace(/[^\p{L}\p{N}]+/gu,' ').trim().split(/\s+/).map(w=>w.length>3?w.replace(/s$/,''):w).join(' ');
  const body=` ${normal(text)} `;
  return glossary.split(/\r?\n/).filter(line=>{
    const separator=line.search(/[=＝]/);if(separator<1)return false;
    return line.slice(0,separator).split('/').some(term=>{const key=normal(term);return key&&body.includes(` ${key} `);});
  }).join('\n');
}
export function transcript(segments: Segment[]): string {
  return segments.map(s => `[${clock(s.start)}] ${s.source}${s.translation ? `\n中文：${s.translation}` : ''}`).join('\n\n');
}
export const AUTO_START = '<!-- lingua:generated:start -->';
export const AUTO_END = '<!-- lingua:generated:end -->';
export function generatedMarkdown(s: Session): string {
  const parts = s.audio.map(a => `- [${clock(a.start)}–${clock(a.end)}] ![[${a.path}]]${a.status === 'error' ? ' · 待重新识别' : ''}`).join('\n');
  const marks = s.bookmarks.map(b => `- **${clock(b.time)}** ${b.text}`).join('\n');
  const rows = s.segments.map(p => `### ${clock(p.start)}${p.reviewRequired?' · 双路分歧，待回听':''}\n\n${p.source}\n\n> ${p.translation || (p.status === 'error' ? '翻译暂时失败，可在工作台重试。' : '正在翻译…')}`).join('\n\n');
  const comparisons=s.audio.filter(a=>a.recognition?.reviewRequired).map(a=>{
    const c=a.recognition!;
    const quote=(text:string)=>text.replace(/\r/g,'').split('\n').map(line=>`> ${line}`).join('\n');
    return `### ${clock(a.start)}–${clock(a.end)}\n\n${c.reason}\n\n${c.candidates.map(candidate=>`**${candidate.language==='fr'?'法语':'中文'}模式候选**${c.selected===candidate.language?'（暂选）':''}\n\n${quote(candidate.text||candidate.error||'未识别出文字')}`).join('\n\n')}\n\n原音：![[${a.path}]]`;
  }).join('\n\n');
  const review=s.reviewRequired?'> [!warning] 自动转写待核对\n> 本节存在中法语混淆，自动字幕及由其生成的要点可能有误，请回听原音核对。\n\n':'';
  return `${AUTO_START}\n${review}## 课堂笔记\n\n${s.outline || '_内容积累后会在这里实时整理。_'}\n\n## 重点标记\n\n${marks || '_尚未添加标记。_'}\n\n## 双语逐字稿\n\n${rows || '_等待语音。_'}\n\n${comparisons?`## 中法双路待核对\n\n以下候选尚未确认，不作为课堂结论。可在工作台回听后采用其中一版。\n\n${comparisons}\n\n`:''}## 原始录音\n\n${parts || '_尚无录音。_'}\n${AUTO_END}`;
}
export function newMarkdown(s: Session): string {
  return `---\ntitle: ${yamlString(s.title)}\ncreated: ${yamlString(s.created)}\ntags: [lingua, french]\nlingua_session: ${yamlString(s.id)}\n---\n\n# ${s.title.replace(/\n/g, ' ')}\n\n## 我的笔记\n\n<!-- 在这里自由编辑，录音更新会保留你的内容。 -->\n\n${generatedMarkdown(s)}\n`;
}
/** Refuse to overwrite a note whose markers were deliberately removed. */
export function updateMarkdown(existing: string, s: Session): string {
  const a = existing.indexOf(AUTO_START), b = existing.indexOf(AUTO_END, a);
  if (a < 0 || b < a) throw new Error('笔记的自动整理区域标记已移除；原始录音和会话已保存，现有笔记未覆盖。');
  return existing.slice(0, a) + generatedMarkdown(s) + existing.slice(b + AUTO_END.length);
}
export interface Branch { label: string; children: string[]; }
export function outlineTree(outline: string): Branch[] {
  const branches: Branch[] = [];
  for (const line of outline.split('\n')) {
    const heading = line.match(/^#{1,4}\s+(.+)/);
    const bullet = line.match(/^\s*[-*+]\s+(.+)/);
    if (heading) branches.push({ label: heading[1].replace(/\*\*/g,''), children: [] });
    else if (bullet) {
      if (!branches.length) branches.push({ label: '课堂要点', children: [] });
      branches[branches.length - 1].children.push(bullet[1].replace(/\*\*/g,''));
    }
  }
  return branches;
}
export function canvasData(s: Session): object {
  const branches = outlineTree(s.outline);
  const nodes: object[] = [{ id: 'root', type: 'text', text: `# ${s.title}`, x: 0, y: Math.max(0,(branches.length-1)*170/2), width: 270, height: 110, color:'4' }];
  const edges: object[] = [];
  let y = 0;
  branches.forEach((b,i) => {
    const id=`topic-${i}`, height=Math.max(140,b.children.length*46+70);
    nodes.push({ id, type: 'text', text: `## ${b.label}\n\n${b.children.map(x=>`- ${x}`).join('\n')}`, x: 420, y, width: 420, height, color: String(i%6+1) });
    edges.push({ id:`edge-${i}`, fromNode:'root', fromSide:'right', toNode:id, toSide:'left' });
    y += height+40;
  });
  return { nodes, edges };
}
export function srt(s: Session): string {
  const stamp=(x:number)=>new Date(Math.max(0,x)*1000).toISOString().slice(11,23).replace('.',',');
  return s.segments.map((p,i)=>`${i+1}\n${stamp(p.start)} --> ${stamp(p.end)}\n${p.reviewRequired?'[双路分歧，待回听] ':''}${p.source}\n${p.translation}\n`).join('\n');
}
