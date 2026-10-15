// Display only: analytical roof/wall projection, without PNG encoding or route work.
export function displayShadowOpacity(solarWeight,altitude) {
 if(!Number.isFinite(altitude)||altitude<=2)return 0;
 const weight=Number.isFinite(solarWeight)?Math.max(0,Math.min(1,solarWeight)):1;
 return .22+.16*weight;
}
export function createLatestFrameQueue(send) {
 let busy=false,pending=null;
 return {push(value){pending=value;this.pump();},pump(){if(busy||!pending)return;const next=pending;pending=null;busy=true;send(next);},complete(){busy=false;this.pump();},get pending(){return pending;},get busy(){return busy;}};
}
export function drawDisplayShadows(ctx,obstacles,sun,leafOn,transform) {
 ctx.clearRect(0,0,ctx.canvas.width,ctx.canvas.height);
 if(sun.altitude<=2)return;
 const az=sun.azimuth*Math.PI/180,alt=sun.altitude*Math.PI/180,cot=1/Math.tan(alt),sx=-Math.sin(az)*cot,sy=-Math.cos(az)*cot;
 const point=(p,dx=0,dy=0)=>transform(p[0]+dx,p[1]+dy);
 ctx.fillStyle='#24364f';
 for(const building of obstacles.buildings){
  const dx=sx*building.h,dy=sy*building.h;
  ctx.beginPath();for(const ring of building.r){ring.forEach((p,i)=>{const q=point(p,dx,dy);i?ctx.lineTo(...q):ctx.moveTo(...q);});ctx.closePath();}ctx.fill('evenodd');
  for(const ring of building.r)for(let i=1;i<ring.length;i++){const a=point(ring[i-1]),b=point(ring[i]),c=point(ring[i],dx,dy),d=point(ring[i-1],dx,dy);ctx.beginPath();ctx.moveTo(...a);ctx.lineTo(...b);ctx.lineTo(...c);ctx.lineTo(...d);ctx.closePath();ctx.fill();}
 }
 for(const tree of obstacles.trees){
  if(!leafOn&&!tree.evergreen)continue;
  const centre=Math.max(tree.r,tree.h-tree.r),major=tree.r/Math.sin(alt);ctx.beginPath();
  for(let i=0;i<=32;i++){const angle=i*Math.PI/16,along=major*Math.cos(angle),across=tree.r*Math.sin(angle),q=transform(tree.p[0]+sx*centre+along*Math.sin(az)+across*Math.cos(az),tree.p[1]+sy*centre+along*Math.cos(az)-across*Math.sin(az));i?ctx.lineTo(...q):ctx.moveTo(...q);}ctx.closePath();ctx.fill();
 }
}
