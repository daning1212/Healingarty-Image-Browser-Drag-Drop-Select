import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
class Pointer extends Event {
  constructor(type,options={}){super(type,{bubbles:true,cancelable:true});for(const key of ['pointerId','pointerType','isPrimary','clientX','clientY','screenX','screenY','button','buttons','ctrlKey','shiftKey','altKey','metaKey','pressure','width','height'])this[key]=options[key];}
}
class Surface extends EventTarget{
  constructor(){super();this.listeners=new Map();}
  addEventListener(type,fn,capture){super.addEventListener(type,fn,capture);let set=this.listeners.get(type);if(!set)this.listeners.set(type,set=new Set());set.add(fn);}
  removeEventListener(type,fn,capture){super.removeEventListener(type,fn,capture);this.listeners.get(type)?.delete(fn);}
  count(){return [...this.listeners.values()].reduce((n,s)=>n+s.size,0);}
}
const win=new Surface();win.PointerEvent=Pointer;
class Wheel extends Event {constructor(type,options={}){super(type,{cancelable:true});for(const [k,v]of Object.entries(options))if(!['bubbles','cancelable','composed'].includes(k))this[k]=v;}}
win.WheelEvent=Wheel;
const doc=new Surface();doc.defaultView=win;
const root=new Surface();root.ownerDocument=doc;const classes=new Set();root.classList={add:k=>classes.add(k),remove:k=>classes.delete(k)};
const canvas=new Surface();const events=[];
// Simulate graph pan in screen pixels, converted to graph units at a zoom scale.
let previous=null,offset=[0,0],scale=.5;
canvas.addEventListener('pointerdown',e=>{previous=[e.clientX,e.clientY];events.push(e);});
canvas.addEventListener('pointermove',e=>{offset[0]+=(e.clientX-previous[0])/scale;offset[1]+=(e.clientY-previous[1])/scale;previous=[e.clientX,e.clientY];events.push(e);});
canvas.addEventListener('pointerup',e=>{previous=null;events.push(e);});
const ctx={};vm.createContext(ctx);vm.runInContext(readFileSync(new URL('../web/pan.js',import.meta.url),'utf8').replace('export function','function')+'\nglobalThis.install=installCanvasPan;',ctx);
let hidden=0,scrolled=0;const wheels=[];canvas.addEventListener('wheel',e=>wheels.push(e));const remove=ctx.install(root,()=>canvas,()=>hidden++,e=>scrolled+=e.deltaY);
const event=(type,options={})=>new Pointer(type,{pointerId:7,pointerType:'mouse',isPrimary:true,clientX:100,clientY:80,button:1,buttons:4,...options});
// Left click, right click and touch must not become canvas navigation.
for(const options of [{button:0,buttons:1},{button:2,buttons:2},{pointerType:'touch'},{button:1,buttons:5}]){const e=event('pointerdown',options);root.dispatchEvent(e);assert.equal(e.defaultPrevented,false);}
for(const deltaY of [-100,100]){
 const e=new Wheel('wheel',{deltaY,deltaX:0,deltaMode:0,clientX:310,clientY:220,ctrlKey:true});root.dispatchEvent(e);
 assert.ok(e.defaultPrevented);assert.equal(wheels.at(-1).deltaY,deltaY);assert.equal(wheels.at(-1).wheelDeltaY,-deltaY);assert.equal(wheels.at(-1).clientX,310);assert.equal(wheels.at(-1).ctrlKey,true);
}
root.dispatchEvent(new Wheel('wheel',{deltaY:30,shiftKey:true}));assert.equal(scrolled,30);assert.equal(wheels.length,2);assert.equal(events.length,0);
hidden=0;
let childDown=0;root.addEventListener('pointerdown',()=>childDown++);
const down=event('pointerdown',{ctrlKey:true});root.dispatchEvent(down);assert.equal(childDown,0);assert.ok(down.defaultPrevented);assert.equal(hidden,1);assert.ok(classes.has('ha-panning'));
assert.equal(events[0].isPrimary,true);assert.equal(events[0].ctrlKey,true);assert.equal(events[0].pointerId,7);
// Moving outside the panel still reaches the graph once, with original coordinates.
doc.dispatchEvent(event('pointermove',{button:-1,clientX:125,clientY:90}));assert.deepEqual(offset,[50,20]);
const unrelated=event('pointermove',{pointerId:99});doc.dispatchEvent(unrelated);assert.equal(unrelated.defaultPrevented,false);
doc.dispatchEvent(event('pointerup',{buttons:0,clientX:125,clientY:90}));assert.equal(events.length,3);assert.equal(previous,null);assert.equal(doc.count(),0);assert.equal(win.count(),0);assert.equal(classes.size,0);
// Native canvas pointer capture must pass through without a duplicate forwarded move.
root.dispatchEvent(event('pointerdown'));
const beforeNative=events.length;
for(const type of ['pointermove','pointerup']){
 const e=event(type,{button:type==='pointerup'?1:-1,buttons:type==='pointerup'?0:4,clientX:140,clientY:100});
 Object.defineProperty(e,'target',{value:canvas});
 doc.dispatchEvent(e);assert.equal(e.defaultPrevented,false);assert.equal(events.length,beforeNative+(type==='pointerup'?1:0));
 canvas.dispatchEvent(e);
}
assert.equal(events.length,beforeNative+2);assert.equal(doc.count(),0);
// Cancellation, missing button-up, blur, and removal cannot leave a stuck pan.
for(const ending of ['pointercancel','missing-button','blur','destroy']){
 root.dispatchEvent(event('pointerdown'));
 if(ending==='blur')win.dispatchEvent(new Event('blur'));
 else if(ending==='destroy')remove();
 else doc.dispatchEvent(event(ending==='missing-button'?'pointermove':ending,{buttons:0}));
 assert.equal(previous,null);assert.equal(doc.count(),0);assert.equal(win.count(),0);assert.equal(classes.size,0);
}
assert.equal(root.count(),1); // only the test listener remains after disposal
console.log('PASS: middle-button forwarding, scaled pan, left/right/touch isolation, wheel directions/anchor/legacy delta forwarding, Shift scrolling, preview dismissal, outside drag, pointer identity, cancel/blur/removal cleanup.');
