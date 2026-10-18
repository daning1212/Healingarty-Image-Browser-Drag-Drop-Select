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
    this.tree=new Map();this.treeRoots=[];this.expanded=new Set();this.treeLoading=new Set();this.node=node; this.path=''; this.parent=''; this.history=[]; this.next=null; this.generation=0; this.urls=new Set(); this.queue=[]; this.active=0;
    this.root=el('div','ha-browser');
    const tools=el('div','ha-tools'); this.input=el('input'); this.input.placeholder='D:\\이미지 또는 /home/user/pictures';
    this.input.onkeydown=e=>{if(e.key==='Enter')this.navigate(this.input.value);};
    tools.append(button('←',()=>this.back()),button('↑',()=>this.navigate(this.parent)),button('⟳',()=>this.navigate(this.path,false)),this.input,button('이동',()=>this.navigate(this.input.value)));
    const actions=el('div','ha-tools');
    actions.append(el('span','ha-version','v0.1.3'),button('현재 경로 열기',()=>this.open()),button('경로 지정',()=>{this.picker.hidden=!this.picker.hidden;}),button('☆ 즐겨찾기',()=>this.favorite()));
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
    for(const event of ['pointerdown','mousedown','pointerup','mouseup','click','dblclick','wheel','keydown'])this.root.addEventListener(event,e=>e.stopPropagation());
    this.observer=new IntersectionObserver(entries=>{for(const entry of entries)if(entry.isIntersecting){this.observer.unobserve(entry.target);this.queue.push({card:entry.target,generation:this.generation});}this.pump();},{root:this.scroller,rootMargin:'120px'});
    request('roots',{}).then(data=>{for(const path of data.roots){this.roots.append(button(path,()=>this.navigate(path)));this.treeEntry(path,path);if(!this.treeRoots.includes(path))this.treeRoots.push(path);}this.renderTree();}).catch(e=>this.error(e));
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
      for(const url of this.urls)URL.revokeObjectURL(url);this.urls.clear();this.grid.replaceChildren();this.scroller.scrollTop=0;
      this.append(data);this.loadTree(this.path);this.renderTree();this.status.textContent=`${data.total}개 · 이미지를 Load Image 위로 드래그`;
    }catch(e){this.error(e);}finally{if(generation===this.generation)this.more.disabled=false;}
  }
  append(data){this.next=data.next;this.more.hidden=this.next===null;for(const item of data.items){
    if(item.directory)continue;
    const card=el('div','ha-card');card.item=item;card.draggable=true;
    const img=el('img');img.draggable=false;img.alt=item.name;const name=el('div','ha-name',item.name);name.title=item.name;const info=el('div','ha-info','… · '+item.name.split('.').pop().toUpperCase());
    card.append(img,name,info);card.ondragstart=e=>{e.dataTransfer.setData(MIME,item.path);e.dataTransfer.effectAllowed='copy';};this.grid.append(card);this.observer.observe(card);
  }}
  treeEntry(path,name){if(!this.tree.has(path))this.tree.set(path,{path,name,children:[],loaded:false,next:null});return this.tree.get(path);}
  async loadTree(path,offset=0){
    if(this.treeLoading.has(path))return;this.treeLoading.add(path);
    try{
      const data=await request('folders',{path,offset});
      const chain=data.ancestors;
      for(let i=0;i<chain.length;i++){
        const item=this.treeEntry(chain[i].path,chain[i].name);
        if(i===0&&!this.treeRoots.includes(item.path))this.treeRoots.push(item.path);
        if(i+1<chain.length){const child=chain[i+1].path;if(!item.children.includes(child))item.children.push(child);this.expanded.add(item.path);}
      }
      const item=this.treeEntry(data.path,data.path);
      const retained=item.children.filter(p=>this.expanded.has(p)||p===this.path);
      if(offset===0)item.children=retained;
      for(const child of data.children){this.treeEntry(child.path,child.name);if(!item.children.includes(child.path))item.children.push(child.path);}
      item.loaded=true;item.next=data.next;this.expanded.add(data.path);this.renderTree();
    }catch(e){this.error(e);}finally{this.treeLoading.delete(path);}
  }
  renderTree(){
    if(!this.folders)return;const scroll=this.folders.scrollTop;this.folders.replaceChildren();
    const visited=new Set();
    const draw=(path,depth)=>{
      if(visited.has(path))return;visited.add(path);const item=this.tree.get(path);if(!item)return;
      const row=el('div','ha-tree-row'+(path===this.path?' ha-current':''));row.style.paddingLeft=(depth*14)+'px';
      const arrow=button(this.expanded.has(path)?'▾':'▸',()=>{if(this.expanded.has(path)){this.expanded.delete(path);this.renderTree();}else if(item.loaded){this.expanded.add(path);this.renderTree();}else this.loadTree(path);});arrow.className='ha-tree-arrow';
      const label=button('📁 '+item.name,()=>this.navigate(path));label.className='ha-tree-label';label.title=path;if(path===this.path)label.setAttribute('aria-current','location');
      row.append(arrow,label);this.folders.append(row);
      if(this.expanded.has(path)){for(const child of item.children)draw(child,depth+1);if(item.next!==null){const more=button('하위 폴더 더 보기…',()=>this.loadTree(path,item.next));more.style.marginLeft=((depth+1)*14)+'px';this.folders.append(more);}}
    };
    // Render ancestors before shortcut roots so the current location stays in its tree.
    for(const path of this.treeRoots.filter(p=>p==='/'||/^[A-Za-z]:[\\/]$/.test(p)))draw(path,0);
    for(const path of this.treeRoots)draw(path,0);
    this.folders.scrollTop=scroll;
  }
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
    const style=el('link');style.rel='stylesheet';style.href=new URL('./browser.css?v=0.1.2',import.meta.url).href;document.head.append(style);
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
      constructor(){super('Healingarty Image Browser');this.isVirtualNode=true;this.serialize_widgets=false;this.size=[720,550];this.resizable=true;this.panel=new BrowserPanel(this);
        this.addDOMWidget('browser','healingarty-browser',this.panel.root,{serialize:false,hideOnZoom:false,selectOn:[],getMinHeight:()=>280,getHeight:()=> '100%',onDraw:()=>this.syncPanelSize(),afterResize:()=>this.syncPanelSize()});
        this.setSize([720,550]);this.syncPanelSize();
      }
      syncPanelSize(){
        if(!this.panel)return;
        const width=Math.max(320,this.size[0]-20)+'px';
        const height=Math.max(280,this.size[1]-35)+'px';
        const style=this.panel.root.style;
        if(style.width!==width)style.width=width;
        if(style.height!==height)style.height=height;
      }
      onRemoved(){this.panel?.destroy();}
    }
    ImageBrowser.title='Healingarty Image Browser';ImageBrowser.category='Healingarty';LiteGraph.registerNodeType(TYPE,ImageBrowser);
  }
});
