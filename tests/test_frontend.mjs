import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
let source=readFileSync(new URL('../web/browser.js',import.meta.url),'utf8');
source=source.replace(/^import .*;\n/gm,'').replace('import.meta.url',"'https://localhost/browser.js'");
let extension;const graph={change(){this.changed=true;}};
const context={app:{registerExtension:e=>extension=e,canvas:{setDirty(){} }},api:{},localStorage:{getItem:()=>null},URL,console};
vm.createContext(context);vm.runInContext(source,context);
vm.runInContext('globalThis.RealPanel=BrowserPanel;BrowserPanel=class {constructor(){this.root={style:{}};this.grid={children:[]};}destroy(){this.destroyed=true;}};',context);
class Node {constructor(){this.widgets=[{name:'selected_path',value:'D:/a.png'}];this.size=[200,100];this.graph=graph;this.onNodeCreated();}addDOMWidget(n,t,e,options){this.dom={options};}setSize(size){this.size=size;}}
extension.beforeRegisterNodeDef(Node,{name:'Healingarty/ImageBrowser'});
const node=new Node();assert.equal(node.isVirtualNode,false);assert.equal(node.widgets[0].type,'hidden');assert.equal(node.dom.options.selectOn.length,0);
assert.equal(node.panel.root.style.width,'700px');node.setSize([1000,700]);node.dom.options.afterResize();assert.equal(node.panel.root.style.width,'980px');
const classes=new Set();const card={item:{path:'D:/selected.png'},classList:{toggle:(k,v)=>v?classes.add(k):classes.delete(k)},setAttribute(k,v){this[k]=v;}};
const panel=Object.create(context.RealPanel.prototype);Object.assign(panel,{node,grid:{children:[card]},status:{}});
panel.selectImage('D:/selected.png');assert.equal(node.widgets[0].value,'D:/selected.png');assert.equal(card['aria-pressed'],'true');assert.ok(classes.has('ha-selected'));assert.ok(graph.changed);
panel.selectImage('D:/other.png');assert.equal(card['aria-pressed'],'false');assert.ok(!classes.has('ha-selected'));
node.onConfigure();assert.equal(node.panel.selectedPath,'D:/other.png');node.onRemoved();assert.equal(node.panel.destroyed,true);
console.log('Selection, highlight, serialized path widget, restore, sizing and cleanup checks passed.');
