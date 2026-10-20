/** Display a clause in the map; full Markdown and tooltip remain intact. */
export function mapLabel(text:string):string{
  const clean=text.replace(/[（(]([^）)]+)[）)]/g,(all,body:string)=>/[A-Za-zÀ-ÿ]/.test(body)?all:'').trim();
  let clause=clean.split(/[，,；;。]/)[0].trim();
  if(clause.length<8)clause=clean;
  const chars=[...clause];if(chars.length<=40)return clause;
  return chars.slice(0,39).join('')+'…';
}
