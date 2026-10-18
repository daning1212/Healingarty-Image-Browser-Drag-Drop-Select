import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const source=readFileSync(new URL('../web/browser.js',import.meta.url),'utf8');
const registration=source.slice(source.indexOf('  registerCustomNodes(){')+'  registerCustomNodes(){'.length,source.lastIndexOf('\n  }\n});'));
let Browser;
class Base {
  addDOMWidget(name,type,element,options){this.widget={options};}
  setSize(size){this.size=size;}
}
const context={LiteGraph:{LGraphNode:Base,registerNodeType:(type,cls)=>{Browser=cls;}},BrowserPanel:class {constructor(){this.root={style:{}};}destroy(){this.destroyed=true;}},TYPE:'Healingarty/ImageBrowser'};
vm.runInNewContext(registration,context);
const node=new Browser();
assert.equal(node.panel.root.style.width,'700px');
assert.equal(node.widget.options.selectOn.length,0);
assert.equal(node.isVirtualNode,true,'UI-only node must not enter API prompt');
assert.equal(node.widget.options.getHeight(),'100%','Widget must fill available height without node-height feedback');
assert.equal(node.widget.options.getMinHeight(),280);
assert.deepEqual([...node.size],[720,550]);
node.setSize([1000,700]);node.widget.options.afterResize();
assert.equal(node.panel.root.style.width,'980px');
assert.equal(node.panel.root.style.height,'665px');
node.widget.options.onDraw();
assert.equal(node.widget.options.getHeight(),'100%');
node.onRemoved();assert.equal(node.panel.destroyed,true);
const css=readFileSync(new URL('../web/browser.css',import.meta.url),'utf8');assert.match(css,/width:100%;height:100%;flex:1 1 auto/);
console.log('Frontend node registration, execution exclusion, sizing and cleanup checks passed.');
