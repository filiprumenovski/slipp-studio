import { useRef, useState } from 'react';

export const defaultPanes = { left: 218, right: 350 };
export function fitPanes(width: number, panes: typeof defaultPanes) {
  const space = Math.max(450, width - 310); // Two 5px dividers and at least 300px for the molecular view.
  const right = Math.max(280, Math.min(panes.right, 640, space - 170));
  const left = Math.max(170, Math.min(panes.left, 380, space - right));
  return { left, right };
}
export function readPanes() {
  try {
    const value = JSON.parse(localStorage.getItem('slipp-pane-widths') ?? 'null');
    if (value && Number.isFinite(value.left) && Number.isFinite(value.right)) return fitPanes(2000, value);
  } catch { /* Storage may be unavailable; the default layout still works. */ }
  return defaultPanes;
}
export function PaneDivider({side,value,max,onChange}:{side:'left'|'right';value:number;max:number;onChange:(width:number)=>void}) {
  const drag=useRef<{x:number;width:number}|null>(null),[dragging,setDragging]=useState(false);
  const min=side==='left'?170:280,sign=side==='left'?1:-1;
  const resize=(next:number)=>onChange(Math.max(min,Math.min(max,next)));
  return <div className="pane-divider" role="separator" tabIndex={0} aria-orientation="vertical" aria-label={side==='left'?'Resize structure navigator':'Resize pocket inspector'} aria-controls={side==='left'?'structure-navigator':'pocket-inspector'} aria-valuemin={min} aria-valuemax={max} aria-valuenow={Math.round(value)} data-dragging={dragging} title="Drag to resize · double-click to reset · arrow keys to adjust"
    onPointerDown={e=>{if(e.button!==0)return;e.preventDefault();e.currentTarget.focus();e.currentTarget.setPointerCapture(e.pointerId);drag.current={x:e.clientX,width:value};setDragging(true);}}
    onPointerMove={e=>{if(drag.current)resize(drag.current.width+sign*(e.clientX-drag.current.x));}}
    onPointerUp={e=>{drag.current=null;setDragging(false);if(e.currentTarget.hasPointerCapture(e.pointerId))e.currentTarget.releasePointerCapture(e.pointerId);}}
    onLostPointerCapture={()=>{drag.current=null;setDragging(false);}}
    onPointerCancel={()=>{drag.current=null;setDragging(false);}}
    onDoubleClick={()=>resize(defaultPanes[side])}
    onKeyDown={e=>{if(e.key==='ArrowLeft'||e.key==='ArrowRight'){e.preventDefault();resize(value+(e.key==='ArrowRight'?1:-1)*sign*(e.shiftKey?40:10));}else if(e.key==='Home'||e.key==='End'){e.preventDefault();resize(e.key==='Home'?min:max);}}}
  />;
}
