import { app } from '../../scripts/app.js';
import { api } from '../../scripts/api.js';

const TYPE = 'Healingarty/ImageBrowser';
const MIME = 'application/x-healingarty-image';
const KEY = 'healingarty.browser.';
const read = (k, fallback) => { try { return JSON.parse(localStorage.getItem(KEY+k)) ?? fallback; } catch { return fallback; } };
const save = (k,v) => { try { localStorage.setItem(KEY+k,JSON.stringify(v)); } catch {} };
async function request(route, params, post=false, signal) {
  const response = await api.fetchApi('/healingarty/browser/'+route+(post?'':'?'+new URLSearchParams(params)),
    post ? {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(params),signal} : {signal});
  if(!response.ok) throw new Error(await response.text());
  return response.json();
}
function el(tag, cls, text) { const e=document.createElement(tag); if(cls)e.className=cls; if(text)e.textContent=text; return e; }
function button(text, action) { const b=el('button','',text); b.type='button'; b.onclick=action; return b; }

class BrowserPanel {
  constructor(node) {
    this.node=node; this.path=''; this.parent=''; this.history=[]; this.next=null; this.generation=0; this.urls=new Set(); this.queue=[]; this.active=0;
    this.root=el('div','ha-browser');
    const tools=el('div','ha-tools'); this.input=el('input'); this.input.placeholder='D:\\이미지 또는 /home/user/pictures';
    this.input.onkeydown=e=>{if(e.key==='Enter')this.navigate(this.input.value);};
    tools.append(button('←',()=>this.back()),button('↑',()=>this.navigate(this.parent)),button('⟳',()=>this.navigate(this.path,false)),this.input,button('이동',()=>this.navigate(this.input.value)));
    const actions=el('div','ha-tools');
    actions.append(button('현재 경로 열기',()=>this.open()),button('경로 지정',()=>{this.picker.hidden=!this.picker.hidden;}),button('☆ 즐겨찾기',()=>this.favorite()));
    this.search=el('input'); this.search.placeholder='파일명 검색'; let timer;
    this.search.oninput=()=>{clearTimeout(timer);timer=setTimeout(()=>this.navigate(this.path,false),250);};
    const size=el('input');size.type='range';size.min=80;size.max=220;size.value=read('size',120);size.title='썸네일 크기';
    size.oninput=()=>{this.root.style.setProperty('--ha-size',size.value+'px');save('size',Number(size.value));};size.oninput();actions.append(this.search,size);
    this.picker=el('div','ha-picker');this.picker.hidden=true;
    this.picker.append(el('div','','ComfyUI 실행 컴퓨터의 드라이브 / 폴더'));
    this.roots=el('div','ha-tools');this.picker.append(this.roots,button('이 폴더 선택',()=>{this.picker.hidden=true;this.input.value=this.path;}));
    this.favorites=el('div','ha-tools');this.renderFavorites();
    const body=el('div','ha-body');this.folders=el('div','ha-folders');this.scroller=el('div','ha-scroll');this.grid=el('div','ha-grid');this.more=button('더 불러오기',()=>this.loadMore());this.scroller.append(this.grid,this.more);body.append(this.folders,this.scroller);
    this.status=el('div','ha-status','이미지를 기존 Load Image 노드로 드래그하세요.');
    this.root.append(tools,actions,this.picker,this.favorites,body,this.status);
    for(const event of ['pointerdown','mousedown','wheel','keydown'])this.root.addEventListener(event,e=>e.stopPropagation());
    this.observer=new IntersectionObserver(entries=>{for(const entry of entries)if(entry.isIntersecting){this.observer.unobserve(entry.target);this.queue.push({card:entry.target,generation:this.generation});}this.pump();},{root:this.scroller,rootMargin:'120px'});
    request('roots',{}).then(data=>{for(const path of data.roots)this.roots.append(button(path,()=>this.navigate(path)));}).catch(e=>this.error(e));
    this.navigate(read('path',''));
  }
  error(e){if(e.name!=='AbortError')this.status.textContent=e.message;}
  favorite(){if(!this.path)return;const values=read('favorites',[]);if(!values.includes(this.path))values.push(this.path);save('favorites',values);this.renderFavorites();}
  renderFavorites(){this.favorites.replaceChildren();for(const path of read('favorites',[])){const b=button('★ '+path,()=>this.navigate(path));b.title='클릭: 이동 / 우클릭: 즐겨찾기 해제';b.oncontextmenu=e=>{e.preventDefault();save('favorites',read('favorites',[]).filter(p=>p!==path));this.renderFavorites();};this.favorites.append(b);}}
  async open(){if(!this.path)return;try{await request('open',{path:this.path},true);this.status.textContent='ComfyUI 실행 컴퓨터에서 폴더를 열었습니다.';}catch(e){this.error(e);}}
  back(){const path=this.history.pop();if(path!==undefined)this.navigate(path,false);}
  async navigate(path, remember=true){
    const generation=++this.generation;this.controller?.abort();this.controller=new AbortController();this.queue=[];this.observer.disconnect();
    this.status.textContent='폴더 읽는 중…';this.more.disabled=true;
    try{
      const data=await request('list',{path,q:this.search.value},false,this.controller.signal);if(generation!==this.generation)return;
      if(remember&&this.path&&data.path!==this.path)this.history.push(this.path);
      this.path=data.path;this.parent=data.parent;this.input.value=data.path;save('path',data.path);
      for(const url of this.urls)URL.revokeObjectURL(url);this.urls.clear();this.grid.replaceChildren();this.folders.replaceChildren();this.scroller.scrollTop=0;
      this.append(data);this.status.textContent=`${data.total}개 · 이미지를 Load Image 위로 드래그`;
    }catch(e){this.error(e);}finally{if(generation===this.generation)this.more.disabled=false;}
  }
  append(data){this.next=data.next;this.more.hidden=this.next===null;for(const item of data.items){
    if(item.directory){this.folders.append(button('📁 '+item.name,()=>this.navigate(item.path)));continue;}
    const card=el('div','ha-card');card.item=item;card.draggable=true;
    const img=el('img');img.draggable=false;img.alt=item.name;const name=el('div','ha-name',item.name);name.title=item.name;const info=el('div','ha-info','… · '+item.name.split('.').pop().toUpperCase());
    card.append(img,name,info);card.ondragstart=e=>{e.dataTransfer.setData(MIME,item.path);e.dataTransfer.effectAllowed='copy';};this.grid.append(card);this.observer.observe(card);
  }}
  async loadMore(){if(this.next===null||this.more.disabled)return;const generation=this.generation;this.more.disabled=true;try{const data=await request('list',{path:this.path,offset:this.next,q:this.search.value},false,this.controller.signal);if(generation===this.generation)this.append(data);}catch(e){this.error(e);}finally{if(generation===this.generation)this.more.disabled=false;}}
  pump(){while(this.active<4&&this.queue.length){const job=this.queue.shift();if(job.generation!==this.generation)continue;this.active++;this.thumbnail(job).finally(()=>{this.active--;this.pump();});}}
  async thumbnail({card,generation}){try{
    const response=await api.fetchApi('/healingarty/browser/thumbnail?'+new URLSearchParams({path:card.item.path}),{signal:this.controller.signal});if(!response.ok)throw new Error('이미지 읽기 실패');
    const blob=await response.blob();if(generation!==this.generation||!card.isConnected)return;const url=URL.createObjectURL(blob);this.urls.add(url);card.querySelector('img').src=url;
    card.querySelector('.ha-info').textContent=`${response.headers.get('X-Image-Width')} × ${response.headers.get('X-Image-Height')} · ${card.item.name.split('.').pop().toUpperCase()}`;
  }catch(e){if(generation===this.generation&&e.name!=='AbortError')card.querySelector('.ha-info').textContent='읽기 실패';}}
  destroy(){this.generation++;this.controller?.abort();this.observer.disconnect();this.queue=[];for(const url of this.urls)URL.revokeObjectURL(url);}
}

app.registerExtension({
  name:'Healingarty.ImageBrowser',
  async setup(){
    const style=el('link');style.rel='stylesheet';style.href=new URL('./browser.css',import.meta.url).href;document.head.append(style);
    // Capture only our private MIME: never invoke ComfyUI's PNG workflow loader.
    const own=e=>Array.from(e.dataTransfer?.types??[]).includes(MIME);
    document.addEventListener('dragover',e=>{if(own(e)){e.preventDefault();e.stopImmediatePropagation();e.dataTransfer.dropEffect='copy';}},true);
    document.addEventListener('drop',async e=>{
      if(!own(e))return;e.preventDefault();e.stopImmediatePropagation();
      const path=e.dataTransfer.getData(MIME);const canvas=app.canvas;const pos=canvas.convertEventToCanvasOffset(e);
      const node=app.graph.getNodeOnPos(pos[0],pos[1]);
      if(!node||!(node.comfyClass==='LoadImage'||node.type==='LoadImage'))return;
      const widget=node.widgets?.find(w=>w.name==='image');if(!widget)return;
      node._haDropToken=(node._haDropToken??0)+1;const token=node._haDropToken;
      try{
        const {value}=await request('import',{path},true);if(token!==node._haDropToken||!node.graph)return;
        const old=widget.value;const values=widget.options?.values;if(Array.isArray(values)&&!values.includes(value))values.push(value);
        widget.value=value;widget.callback?.(value);node.onWidgetChanged?.('image',value,old,widget);
        node.graph?.change?.();app.canvas.setDirty(true,true);
      }catch(error){console.error('[Healingarty browser]',error);window.alert('이미지 적용 실패: '+error.message);}
    },true);
  },
  registerCustomNodes(){
    class ImageBrowser extends LiteGraph.LGraphNode {
      constructor(){super('Healingarty Image Browser');this.serialize_widgets=false;this.size=[720,550];this.resizable=true;this.panel=new BrowserPanel(this);
        this.addDOMWidget('browser','healingarty-browser',this.panel.root,{serialize:false,hideOnZoom:false,getMinHeight:()=>280,getHeight:()=>Math.max(280,this.size[1]-35)});
      }
      onRemoved(){this.panel?.destroy();}
    }
    ImageBrowser.title='Healingarty Image Browser';ImageBrowser.category='Healingarty';LiteGraph.registerNodeType(TYPE,ImageBrowser);
  }
});
