// Route middle-button navigation from the DOM overlay to ComfyUI's graph canvas.
// Wheel scrolls only the photo list; other panel areas follow graph navigation.
export function installCanvasPan(root, getCanvas, hidePreview, photoList, resizeThumbnails, folderList) {
  const doc=root.ownerDocument, win=doc.defaultView;
  let active=null;
  function forward(type,e){
    const event=new win.PointerEvent(type,{
      bubbles:true,cancelable:true,composed:true,
      pointerId:e.pointerId,pointerType:e.pointerType,isPrimary:e.isPrimary,
      clientX:e.clientX,clientY:e.clientY,screenX:e.screenX,screenY:e.screenY,
      button:type==='pointerup'?1:e.button,buttons:type==='pointerup'?0:e.buttons,
      ctrlKey:e.ctrlKey,shiftKey:e.shiftKey,altKey:e.altKey,metaKey:e.metaKey,
      pressure:e.pressure,width:e.width,height:e.height,
    });
    active.canvas.dispatchEvent(event);
  }
  function stop(e){e.preventDefault();e.stopImmediatePropagation();}
  function finish(){
    for(const type of ['pointermove','pointerup','pointercancel'])doc.removeEventListener(type,track,true);
    win.removeEventListener('blur',cancel);
    root.classList.remove('ha-panning');active=null;
  }
  function cancel(){if(!active)return;try{forward('pointerup',active.last);}finally{finish();}}
  function track(e){
    if(!active||e.pointerId!==active.last.pointerId)return;
    active.last=e;
    // Modern ComfyUI captures the real pointer on the canvas after forwarded down.
    // Let those native events through; forwarding them again would pan twice.
    const native=e.target===active.canvas;
    const ended=e.type==='pointerup'||e.type==='pointercancel'||!(e.buttons&4);
    if(native){if(ended)finish();return;}
    stop(e);
    try{forward(ended?'pointerup':e.type,e);}finally{if(ended)finish();}
  }
  function down(e){
    if(active||e.button!==1||(e.pointerType&&e.pointerType!=='mouse')||(e.buttons&3))return;
    const canvas=getCanvas();if(!canvas?.dispatchEvent||!win.PointerEvent)return;
    stop(e);hidePreview();active={canvas,last:e};root.classList.add('ha-panning');
    for(const type of ['pointermove','pointerup','pointercancel'])doc.addEventListener(type,track,true);
    win.addEventListener('blur',cancel);
    try{forward('pointerdown',e);}catch(error){finish();throw error;}
  }
  function wheel(e){
    const scrollList=folderList?.contains(e.target)?folderList:photoList?.contains(e.target)?photoList:null;
    if(scrollList){
      stop(e);hidePreview();
      if(scrollList===photoList&&e.ctrlKey&&resizeThumbnails){if(e.deltaY)resizeThumbnails(e.deltaY);return;}
      const unit=e.deltaMode===1?40:e.deltaMode===2?scrollList.clientHeight:1;
      scrollList.scrollTop+=e.deltaY*unit;
      scrollList.scrollLeft+=e.deltaX*unit;
      return;
    }
    const canvas=getCanvas();if(!canvas?.dispatchEvent||!win.WheelEvent)return;
    stop(e);hidePreview();
    const event=new win.WheelEvent('wheel',{
      bubbles:true,cancelable:true,composed:true,
      clientX:e.clientX,clientY:e.clientY,screenX:e.screenX,screenY:e.screenY,
      deltaX:e.deltaX,deltaY:e.deltaY,deltaZ:e.deltaZ,deltaMode:e.deltaMode,
      ctrlKey:e.ctrlKey,shiftKey:e.shiftKey,altKey:e.altKey,metaKey:e.metaKey,
    });
    // Older LiteGraph versions read wheelDeltaY instead of standard deltaY.
    const delta=e.wheelDeltaY??-e.deltaY*(e.deltaMode===1?40:e.deltaMode===2?800:1);
    Object.defineProperty(event,'wheelDeltaY',{value:delta});
    Object.defineProperty(event,'wheelDelta',{value:e.wheelDelta??delta});
    canvas.dispatchEvent(event);
  }
  function suppressMiddle(e){if(e.button===1)stop(e);}
  root.addEventListener('wheel',wheel,{capture:true,passive:false});
  root.addEventListener('pointerdown',down,true);
  root.addEventListener('mousedown',suppressMiddle,true);
  root.addEventListener('auxclick',suppressMiddle,true);
  return ()=>{
    cancel();root.removeEventListener('wheel',wheel,true);root.removeEventListener('pointerdown',down,true);
    root.removeEventListener('mousedown',suppressMiddle,true);
    root.removeEventListener('auxclick',suppressMiddle,true);
  };
}
