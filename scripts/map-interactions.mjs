// Track gestures without intercepting MapLibre's native pan and pinch controls.
export function createMapSelectionGuard(canvas){
 const pointers=new Map();
 let blocked=false;
 canvas.addEventListener('pointerdown',event=>{
  if(!pointers.size)blocked=false;
  pointers.set(event.pointerId,[event.clientX,event.clientY]);
  if(pointers.size>1)blocked=true;
 },{passive:true});
 canvas.addEventListener('pointermove',event=>{
  const start=pointers.get(event.pointerId);
  if(start&&Math.hypot(event.clientX-start[0],event.clientY-start[1])>8)blocked=true;
 },{passive:true});
 canvas.addEventListener('pointerup',event=>pointers.delete(event.pointerId),{passive:true});
 canvas.addEventListener('pointercancel',event=>{pointers.delete(event.pointerId);blocked=true;},{passive:true});
 return {get blocked(){return blocked;}};
}
