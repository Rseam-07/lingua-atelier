import {Transformer} from 'markmap-lib/no-plugins';
import {Markmap} from 'markmap-view';
import DOMPurify from 'dompurify';
import {mapLabel} from './map-label';
export interface MapHandle {fit():void;update(title:string,outline:string):void;destroy():void}
/** Bundled Markmap renders Markdown locally; no CDN, scripts or remote images. */
export function drawMap(container:HTMLElement,title:string,outline:string):MapHandle{
  container.empty();let instance:Markmap|undefined,disposed=false;
  const transformer=new Transformer([]);transformer.md.set({html:false});
  let data:ReturnType<Transformer['transform']>['root']|undefined;
  const toolbar=container.createDiv({cls:'la-map-tools'});
  toolbar.createSpan({text:'拖动平移 · 滚轮缩放 · 点击节点折叠',cls:'la-muted'});
  const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.classList.add('la-map-svg');container.appendChild(svg);
  const empty=container.createDiv({cls:'la-map-empty',text:'整理后的主题与要点会在这里展开。'});
  const fit=()=>{
    if(disposed||!data||container.clientWidth<20||container.clientHeight<20)return;
    if(!instance)instance=Markmap.create(svg,{autoFit:false,duration:200,initialExpandLevel:3,maxWidth:260,spacingHorizontal:55,spacingVertical:10,paddingX:12,fitRatio:.92,maxInitialScale:1},data);
    void instance.fit();
  };
  const update=(title:string,outline:string)=>{
    svg.setAttribute('aria-label',`${title} 思维导图`);empty.hidden=!!outline.trim();toolbar.hidden=!outline.trim();svg.style.display=outline.trim()?'block':'none';
    if(!outline.trim()){data=undefined;return;}
    const markdown=outline.replace(/\s*·\s*\[\[[^\]\n]+\]\](?:\s*\[\[[^\]\n]+\]\])*/g,'').replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g,'$2');
    const {root}=transformer.transform(`# ${title.replace(/[\r\n#]/g,' ')}\n\n${markdown}`);
    const sanitize=(node:typeof root,depth=0):void=>{
      node.content=DOMPurify.sanitize(node.content,{ALLOWED_TAGS:['em','strong','b','i','code','del','br','sup','sub','span'],ALLOWED_ATTR:[]});
      if(depth>=2&&!node.children?.length){
        const holder=document.createElement('span');holder.innerHTML=node.content;
        const full=holder.textContent||'';const label=document.createElement('span');label.title=full;label.textContent=mapLabel(full);node.content=label.outerHTML;
      }
      node.children?.forEach(child=>sanitize(child,depth+1));
    };sanitize(root);data=root;
    // setData retains the user's viewport; arriving notes must not reset zoom.
    if(instance)void instance.setData(root);else requestAnimationFrame(fit);
  };
  for(const [label,action]of [['适合窗口',fit],['放大',()=>{if(instance)void instance.rescale(1.25);}],['缩小',()=>{if(instance)void instance.rescale(.8);}]] as const){const b=toolbar.createEl('button',{text:label,attr:{'aria-label':label}});b.onclick=action;}
  const observer=new ResizeObserver(()=>fit());observer.observe(container);update(title,outline);
  return{fit,update,destroy(){disposed=true;observer.disconnect();instance?.destroy();}};
}
