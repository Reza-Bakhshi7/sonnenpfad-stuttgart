// Track gestures without intercepting MapLibre's native pan and pinch controls.
export function createMapSelectionGuard(canvas){
 const pointers=new Map(),releaseTarget=canvas.ownerDocument?.defaultView||canvas;
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
 // A mouse can be released outside the map; do not leave stale pointers behind.
 releaseTarget.addEventListener('pointerup',event=>{
  const start=pointers.get(event.pointerId);
  if(start&&Math.hypot(event.clientX-start[0],event.clientY-start[1])>8)blocked=true;
  pointers.delete(event.pointerId);
 },{passive:true,capture:true});
 releaseTarget.addEventListener('pointercancel',event=>{pointers.delete(event.pointerId);blocked=true;},{passive:true,capture:true});
 releaseTarget.addEventListener('blur',()=>{pointers.clear();blocked=true;});
 return {get blocked(){return blocked;}};
}
