import type { PluginContext } from 'molstar/lib/mol-plugin/context';

// Molstar's handleResize clears the drawing buffer immediately. ResizeObserver
// runs after animation callbacks, so calling it there can paint an empty frame.
// Flush all resize requests immediately before the renderer's next synchronous draw.
export function resizeWithFrame(plugin: Pick<PluginContext, 'handleResize' | 'canvas3d'>) {
  const canvas=plugin.canvas3d;
  if(!canvas)return ()=>{};
  const resize=plugin.handleResize,tick=canvas.tick;
  let pending=false;
  plugin.handleResize=()=>{pending=true;};
  canvas.tick=(time,options)=>{
    const resizing=pending&&!options?.manualDraw;
    if(resizing){pending=false;resize();}
    tick(time,resizing?{...options,isSynchronous:true}:options);
  };
  return ()=>{pending=false;plugin.handleResize=resize;canvas.tick=tick;};
}
