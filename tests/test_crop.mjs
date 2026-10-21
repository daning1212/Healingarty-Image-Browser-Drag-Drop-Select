import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
let source=readFileSync(new URL('../web/crop.js',import.meta.url),'utf8').replace(/^import .*;\n/gm,'').replace(/export /g,'');
const context={};vm.createContext(context);vm.runInContext(source+'\nglobalThis.crop={outputSize,validState,dragBox};',context);
const {outputSize,validState,dragBox}=context.crop;
const equal=(a,b)=>assert.deepEqual(Array.from(a),b);
equal(outputSize([0,0,1200,2400],1536),[768,1536]);
equal(outputSize([0,0,100,200],1536),[100,200]);
equal(outputSize([0,0,1200,2400],0),[1200,2400]);
const state={path:'a.png',size:[200,300],box:[20,30,100,200],max_edge:0};assert.ok(validState(state));assert.ok(!validState({...state,box:[0,0,201,300]}));
equal(dragBox([30,40],[200,300],'move',state.box,state.size),[120,130,200,300]);
equal(dragBox([20,30],[150,250],'nw',state.box,state.size),[99,199,100,200]);
equal(dragBox([100,200],[10,20],'draw',state.box,state.size),[10,20,100,200]);
console.log('Original-coordinate crop drawing, move bounds, resize, validation and aspect-preserving output checks passed.');

// Exercise editor load/persistence without requiring a ComfyUI server or browser.
class Element {
  constructor(tag){this.tag=tag;this.style={};this.children=[];this.clientWidth=400;this.clientHeight=500;this.value='';this.checked=false;this.captured=new Set();}
  append(...items){this.children.push(...items);}
  setAttribute(){} addEventListener(){} setCustomValidity(value){this.validity=value;}
  getContext(){return new Proxy({},{get:()=>()=>{}});}
  getBoundingClientRect(){return {left:0,top:0,width:400,height:500};}
  setPointerCapture(id){this.captured.add(id);}hasPointerCapture(id){return this.captured.has(id);}releasePointerCapture(id){this.captured.delete(id);}
}
let fail=false;const revoked=[];
const ui={document:{createElement:tag=>new Element(tag),createTextNode:t=>t},window:{devicePixelRatio:1},ResizeObserver:class{observe(){}disconnect(){}},Image:class{async decode(){}},AbortController,URL:{createObjectURL:()=> 'blob:preview',revokeObjectURL:v=>revoked.push(v)},URLSearchParams,app:{canvas:{setDirty(){}}},api:{async fetchApi(){if(fail)throw Error('test failure');return {ok:true,headers:{get:k=>k==='X-Image-Width'?'1200':'2400'},blob:async()=>({})};}}};
vm.createContext(ui);vm.runInContext(source+'\nglobalThis.Editor=CropEditor;',ui);
const widget={name:'crop_state',value:''};let changed=0;const panel={selectedPath:'a.png',node:{widgets:[widget],graph:{change(){changed++;}}},hidePreview(){},toggleCrop(){}};
const editor=new ui.Editor(panel);await editor.loadSelected();
assert.equal(JSON.parse(widget.value).path,'a.png');assert.equal(revoked.length,1);
panel.selectedPath='b.png';assert.equal(editor.state.path,'a.png');
editor.state.box=[100,200,1100,2200];editor.enabled.checked=true;editor.limit.value='1000';editor.updateLimit();assert.equal(JSON.parse(widget.value).max_edge,1000);
editor.limit.value='';editor.updateLimit();assert.equal(JSON.parse(widget.value).max_edge,1000);assert.ok(editor.error.textContent.includes('유효 설정'));
fail=true;await editor.loadSelected();assert.equal(editor.state.path,'a.png');assert.ok(editor.error.textContent.includes('실패'));fail=false;
await editor.restore();assert.equal(editor.state.path,'a.png');equal(editor.state.box,[100,200,1100,2200]);
editor.reset();equal(editor.state.box,[0,0,1200,2400]);assert.equal(editor.state.max_edge,1000);
assert.ok(changed>0);editor.destroy();assert.equal(editor.image,null);
console.log('Editor explicit load, independent image, failed-load preservation, persistence/restore, invalid resize input and cleanup checks passed.');
