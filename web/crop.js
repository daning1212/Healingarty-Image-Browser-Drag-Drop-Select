import { app } from '../../scripts/app.js';
import { api } from '../../scripts/api.js';

const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
export function outputSize(box,limit=0){
  const w=box[2]-box[0],h=box[3]-box[1],scale=limit>0?Math.min(1,limit/Math.max(w,h)):1;
  return [Math.max(1,Math.round(w*scale)),Math.max(1,Math.round(h*scale))];
}
export function validState(s){
  return !!s&&typeof s.path==='string'&&!!s.path&&Array.isArray(s.size)&&s.size.length===2&&s.size.every(v=>Number.isInteger(v)&&v>0)&&Array.isArray(s.box)&&s.box.length===4&&s.box.every(Number.isInteger)&&s.box[0]>=0&&s.box[1]>=0&&s.box[2]>s.box[0]&&s.box[3]>s.box[1]&&s.box[2]<=s.size[0]&&s.box[3]<=s.size[1]&&Number.isInteger(s.max_edge??0)&&(s.max_edge??0)>=0&&(s.max_edge??0)<=32768;
}
export function dragBox(start,point,mode,origin,size){
  const [w,h]=size,[x,y,r,b]=origin,dx=point[0]-start[0],dy=point[1]-start[1];
  if(mode==='move'){const nx=clamp(x+dx,0,w-(r-x)),ny=clamp(y+dy,0,h-(b-y));return [nx,ny,nx+r-x,ny+b-y];}
  if(mode==='draw')return [Math.min(start[0],point[0]),Math.min(start[1],point[1]),Math.max(start[0],point[0])+Number(point[0]===start[0]),Math.max(start[1],point[1])+Number(point[1]===start[1])].map((v,i)=>clamp(v,0,i%2?h:w));
  return [mode.includes('w')?clamp(x+dx,0,r-1):x,mode.includes('n')?clamp(y+dy,0,b-1):y,mode.includes('e')?clamp(r+dx,x+1,w):r,mode.includes('s')?clamp(b+dy,y+1,h):b];
}
function el(tag,cls,text){const e=document.createElement(tag);if(cls)e.className=cls;if(text)e.textContent=text;return e;}
function button(text,fn){const e=el('button','',text);e.type='button';e.onclick=fn;return e;}

export class CropEditor {
  constructor(panel){
    this.panel=panel;this.node=panel.node;this.root=el('section','ha-crop');
    const header=el('div','ha-tools');header.append(el('strong','','자유 크롭'),button('선택 이미지 불러오기',()=>this.loadSelected()),button('접기',()=>panel.toggleCrop(false)));
    this.caption=el('div','ha-crop-caption','왼쪽 사진을 선택한 뒤 불러오세요.');
    this.viewport=el('div','ha-crop-viewport');this.canvas=el('canvas');this.canvas.tabIndex=0;this.canvas.setAttribute('aria-label','자유 크롭 영역: 드래그로 선택, 내부 이동, 모서리 크기 조절');this.viewport.append(this.canvas);
    const options=el('div','ha-tools');this.enabled=el('input');this.enabled.type='checkbox';
    const label=el('label','ha-crop-check');label.append(this.enabled,document.createTextNode('축소 사용'));
    this.limit=el('input');this.limit.type='number';this.limit.min='1';this.limit.max='32768';this.limit.step='1';this.limit.value='1536';this.limit.setAttribute('aria-label','긴 변 최대 픽셀');this.limit.disabled=true;
    options.append(label,el('span','','긴 변 최대'),this.limit,el('span','','px'),button('전체로 초기화',()=>this.reset()));
    this.info=el('div','ha-crop-info','크롭을 불러오지 않으면 CROP IMAGE도 선택 원본을 출력합니다.');
    this.error=el('div','ha-crop-error');this.error.setAttribute('role','status');
    this.root.append(header,this.caption,this.viewport,options,el('div','ha-crop-note','비율 유지 · 확대 안 함 · Shift+드래그: 새 영역'),this.info,this.error);
    this.enabled.onchange=()=>{this.limit.disabled=!this.enabled.checked;this.updateLimit();};this.limit.oninput=()=>this.updateLimit();
    this.canvas.addEventListener('pointerdown',e=>this.down(e));this.canvas.addEventListener('pointermove',e=>this.move(e));
    for(const name of ['pointerup','pointercancel','lostpointercapture'])this.canvas.addEventListener(name,e=>this.up(e));
    this.resize=new ResizeObserver(()=>this.draw());this.resize.observe(this.viewport);
    this.restore();
  }
  widget(){return this.node.widgets?.find(w=>w.name==='crop_state');}
  save(){
    if(!this.state)return;const widget=this.widget();if(!widget){this.error.textContent='노드를 새로 추가해야 CROP IMAGE를 사용할 수 있습니다.';return;}
    const old=widget.value;widget.value=JSON.stringify(this.state);widget.callback?.(widget.value);this.node.onWidgetChanged?.('crop_state',widget.value,old,widget);
    this.node.graph?.change?.();app.canvas.setDirty(true,true);this.draw();
  }
  async restore(){
    const raw=this.widget()?.value;this.controller?.abort();this.state=null;this.image=null;this.caption.textContent='왼쪽 사진을 선택한 뒤 불러오세요.';this.draw();if(!raw)return;
    try{const state=JSON.parse(raw);if(!validState(state))throw new Error('저장된 크롭 설정이 잘못되었습니다. 다시 불러오세요.');await this.load(state.path,state);}
    catch(e){this.error.textContent=e.message;}
  }
  async loadSelected(){if(!this.panel.selectedPath){this.error.textContent='왼쪽에서 사진을 먼저 선택하세요.';return;}await this.load(this.panel.selectedPath);}
  async load(path,restored){
    this.panel.hidePreview();this.controller?.abort();const controller=new AbortController();this.controller=controller;
    this.error.textContent='미리보기 불러오는 중…';
    let url;
    try{
      const response=await api.fetchApi('/healingarty/browser/preview?'+new URLSearchParams({path}),{signal:controller.signal});if(!response.ok)throw new Error(await response.text());
      const w=Number(response.headers.get('X-Image-Width')),h=Number(response.headers.get('X-Image-Height'));
      if(!Number.isInteger(w)||!Number.isInteger(h)||w<1||h<1)throw new Error('원본 해상도를 읽을 수 없습니다.');
      url=URL.createObjectURL(await response.blob());const image=new Image();image.src=url;await image.decode();if(controller.signal.aborted)return;
      if(restored&&(restored.size[0]!==w||restored.size[1]!==h))throw new Error('원본 해상도가 바뀌었습니다. 선택 이미지 불러오기를 다시 눌러주세요.');
      this.image=image;this.state=restored??{path,size:[w,h],box:[0,0,w,h],max_edge:this.enabled.checked?this.readLimit():0};
      this.enabled.checked=this.state.max_edge>0;this.limit.disabled=!this.enabled.checked;if(this.state.max_edge)this.limit.value=String(this.state.max_edge);
      this.caption.textContent=path.split(/[\\/]/).pop()+' · '+w+' × '+h;this.caption.title=path;this.error.textContent='';this.save();
    }catch(e){if(e.name!=='AbortError'&&!controller.signal.aborted)this.error.textContent='불러오기 실패: '+e.message+' (기존 크롭은 유지됩니다.)';}
    finally{if(url)URL.revokeObjectURL(url);}
  }
  readLimit(){const value=Number(this.limit.value);if(!Number.isInteger(value)||value<1||value>32768)throw new Error('긴 변 크기는 1~32768 정수로 입력하세요.');return value;}
  updateLimit(){try{const limit=this.enabled.checked?this.readLimit():0;this.limit.setCustomValidity('');this.error.textContent='';if(this.state){this.state.max_edge=limit;this.save();}}catch(e){this.limit.setCustomValidity(e.message);this.error.textContent=e.message+' 마지막 유효 설정을 유지합니다.';}}
  reset(){if(this.state){this.state.box=[0,0,...this.state.size];this.save();}}
  geometry(){
    if(!this.state)return null;const width=this.viewport.clientWidth,height=this.viewport.clientHeight,[w,h]=this.state.size;
    const scale=Math.min((width-20)/w,(height-20)/h);if(scale<=0)return null;
    return {width,height,scale,x:(width-w*scale)/2,y:(height-h*scale)/2};
  }
  draw(){
    const width=Math.max(1,this.viewport.clientWidth),height=Math.max(1,this.viewport.clientHeight),dpr=window.devicePixelRatio||1;
    this.canvas.width=Math.round(width*dpr);this.canvas.height=Math.round(height*dpr);this.canvas.style.width=width+'px';this.canvas.style.height=height+'px';
    const ctx=this.canvas.getContext('2d');ctx.scale(dpr,dpr);ctx.fillStyle='#17191d';ctx.fillRect(0,0,width,height);
    if(!this.state||!this.image){ctx.fillStyle='#aaa';ctx.textAlign='center';ctx.font='13px system-ui';ctx.fillText('선택 → 불러오기 → 자유 크롭',width/2,height/2);return;}
    const g=this.geometry();if(!g)return;const [w,h]=this.state.size,[x,y,r,b]=this.state.box;
    ctx.drawImage(this.image,g.x,g.y,w*g.scale,h*g.scale);
    ctx.fillStyle='#0009';ctx.beginPath();ctx.rect(g.x,g.y,w*g.scale,h*g.scale);ctx.rect(g.x+x*g.scale,g.y+y*g.scale,(r-x)*g.scale,(b-y)*g.scale);ctx.fill('evenodd');
    ctx.strokeStyle='#80b7ff';ctx.lineWidth=2;ctx.strokeRect(g.x+x*g.scale,g.y+y*g.scale,(r-x)*g.scale,(b-y)*g.scale);
    for(const [px,py] of this.handles()){ctx.fillStyle='#fff';ctx.fillRect(px-4,py-4,8,8);ctx.strokeRect(px-4,py-4,8,8);}
    const out=outputSize(this.state.box,this.state.max_edge);this.info.textContent=`크롭 ${r-x} × ${b-y} → 출력 ${out[0]} × ${out[1]}`;
  }
  handles(){const g=this.geometry();if(!g)return [];const [x,y,r,b]=this.state.box;return [[x,y],[(x+r)/2,y],[r,y],[r,(y+b)/2],[r,b],[(x+r)/2,b],[x,b],[x,(y+b)/2]].map(([a,c])=>[g.x+a*g.scale,g.y+c*g.scale]);}
  position(e){const rect=this.canvas.getBoundingClientRect(),g=this.geometry();if(!g||rect.width<=0||rect.height<=0)return null;const px=(e.clientX-rect.left)*g.width/rect.width,py=(e.clientY-rect.top)*g.height/rect.height;return {px,py,point:[clamp(Math.round((px-g.x)/g.scale),0,this.state.size[0]),clamp(Math.round((py-g.y)/g.scale),0,this.state.size[1])],g};}
  hit(pos){const modes=['nw','n','ne','e','se','s','sw','w'];const index=this.handles().findIndex(([x,y])=>Math.abs(x-pos.px)<=9&&Math.abs(y-pos.py)<=9);if(index>=0)return modes[index];const [x,y,r,b]=this.state.box,[a,c]=pos.point;return a>x&&a<r&&c>y&&c<b?'move':'draw';}
  down(e){
    if(e.button!==0||!this.state||!this.image||this.controller?.signal.aborted)return;const pos=this.position(e);if(!pos)return;const {g,px,py}=pos;
    if(px<g.x||py<g.y||px>g.width-g.x||py>g.height-g.y)return;
    e.preventDefault();this.panel.hidePreview();this.drag={id:e.pointerId,start:pos.point,origin:[...this.state.box],mode:e.shiftKey?'draw':this.hit(pos)};this.canvas.setPointerCapture(e.pointerId);
  }
  move(e){if(!this.state)return;const pos=this.position(e);if(!pos)return;if(!this.drag){const mode=this.hit(pos);this.canvas.style.cursor=mode==='draw'?'crosshair':mode==='move'?'move':mode+'-resize';return;}if(e.pointerId!==this.drag.id)return;e.preventDefault();const {start,origin,mode}=this.drag;const box=dragBox(start,pos.point,mode,origin,this.state.size);if(box[2]>box[0]&&box[3]>box[1]){this.state.box=box;this.save();}}
  up(e){if(!this.drag||e.pointerId!==this.drag.id)return;this.drag=null;if(this.canvas.hasPointerCapture(e.pointerId))this.canvas.releasePointerCapture(e.pointerId);}
  destroy(){this.controller?.abort();this.resize.disconnect();this.image=null;this.state=null;}
}
