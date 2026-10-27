// Distances use local metres, also for oriented partial pieces from the API.
export function routeMeasure(coords) {
 const cumulative=[0];
 for(let i=1;i<coords.length;i++)cumulative.push(cumulative[i-1]+Math.hypot(coords[i][0]-coords[i-1][0],coords[i][1]-coords[i-1][1]));
 return {coords,cumulative,total:cumulative.at(-1)||0};
}
export function pointAlongRoute(measure,fraction) {
 const {coords,cumulative,total}=measure;
 if(!coords.length)return null;
 const target=Math.max(0,Math.min(1,fraction))*total;
 let lo=1,hi=cumulative.length-1;
 while(lo<hi){const mid=(lo+hi)>>1;if(cumulative[mid]<target)lo=mid+1;else hi=mid;}
 const i=Math.min(lo,coords.length-1),a=coords[Math.max(0,i-1)],b=coords[i],length=cumulative[i]-cumulative[Math.max(0,i-1)],f=length?(target-cumulative[Math.max(0,i-1)])/length:0;
 return [a[0]+(b[0]-a[0])*f,a[1]+(b[1]-a[1])*f];
}
export function smoothBearing(previous,next,weight) {
 return previous+(((next-previous+540)%360)-180)*Math.max(0,Math.min(1,weight));
}
export function valueAlongRoute(measure,values,fraction) {
 const target=Math.max(0,Math.min(1,fraction))*measure.total;
 let lo=1,hi=measure.cumulative.length-1;
 while(lo<hi){const mid=(lo+hi)>>1;if(measure.cumulative[mid]<target)lo=mid+1;else hi=mid;}
 const i=Math.min(lo,values.length-1),a=Math.max(0,i-1),length=measure.cumulative[i]-measure.cumulative[a],f=length?(target-measure.cumulative[a])/length:0;
 return values[a]+(values[i]-values[a])*f;
}
export function densifyRoute(coords,spacing=12) {
 if(coords.length<2)return coords;
 const total=routeMeasure(coords).total,step=Math.max(spacing,total/10000),points=[coords[0]];
 for(let i=1;i<coords.length;i++){const a=coords[i-1],b=coords[i],count=Math.max(1,Math.ceil(Math.hypot(b[0]-a[0],b[1]-a[1])/step));for(let j=1;j<=count;j++){const f=j/count;points.push([a[0]+(b[0]-a[0])*f,a[1]+(b[1]-a[1])*f]);}}
 return points;
}

// The same linear metric scale applies to short and long routes. A modest,
// explicit 2x vertical exaggeration is used until the full relief needs more.
// Independent, linear distance/elevation axes, padded to show relief without
// filling the entire chart with a small rise. Explicit vertical factor remains.
export function profileScale(values,width=300,height=70) {
 const valid=values.filter(p=>p.every(Number.isFinite));if(valid.length<2)return null;
 const total=valid.at(-1)[0]||1,zs=valid.map(p=>p[1]),min=Math.min(...zs),max=Math.max(...zs);
 const range=Math.max(35,(max-min)*1.6,total*.012),low=(min+max-range)/2;
 return {low,high:low+range,total,exaggeration:total/width/(range/height),min,max};
}
export function formatWalkDuration(minutes,language='de') {
 if(!Number.isFinite(minutes))return '—';
 const n=Math.max(0,Math.round(minutes));
 return n<60?`${n} min`:`${Math.floor(n/60)} ${language==='de'?'Std.':'h'}${n%60?` ${n%60} min`:''}`;
}
export function profileAtDistance(values,distance) {
 for(let i=1;i<values.length;i++){
  const a=values[i-1],b=values[i];
  if(distance<=b[0]){if(!a.every(Number.isFinite)||!b.every(Number.isFinite))return null;
   const f=Math.max(0,Math.min(1,(distance-a[0])/(b[0]-a[0]||1)));return a[1]+(b[1]-a[1])*f;}
 }
 return values.at(-1)?.every(Number.isFinite)?values.at(-1)[1]:null;
}

// Public production hosts retain Oracle routing. Preview hosts have no Oracle
// CORS grant and use the existing local engine with an explicit UI notice.
export function isRoutingPreview(hostname='') {
 return /^(?:app09-mobile-finalization-preview|[a-f0-9]{8})-sonnenpfad-stuttgart\.mohammadreza-bakhshi\.workers\.dev$/.test(hostname);
}

export function durationMetric(minutes){
 if(!Number.isFinite(minutes)||minutes<0)return {text:'—',unit:'min'};
 const n=Math.round(minutes);return n<60?{text:String(n),unit:'min'}:{text:`${Math.floor(n/60)}:${String(n%60).padStart(2,'0')}`,unit:'h:min'};
}
export function singleSelectedGeometry(geometry,point){
 if(geometry?.type!=='MultiPolygon')return geometry;
 const inside=ring=>{let hit=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){const a=ring[i],b=ring[j];if((a[1]>point[1])!==(b[1]>point[1])&&point[0]<(b[0]-a[0])*(point[1]-a[1])/(b[1]-a[1])+a[0])hit=!hit;}return hit;};
 const dist=ring=>{let best=Infinity;const sx=Math.cos(point[1]*Math.PI/180);for(let i=1;i<ring.length;i++){const a=[(ring[i-1][0]-point[0])*sx,ring[i-1][1]-point[1]],b=[(ring[i][0]-point[0])*sx,ring[i][1]-point[1]],dx=b[0]-a[0],dy=b[1]-a[1],f=Math.max(0,Math.min(1,-(a[0]*dx+a[1]*dy)/(dx*dx+dy*dy||1)));best=Math.min(best,Math.hypot(a[0]+f*dx,a[1]+f*dy));}return best;};
 const polygons=geometry.coordinates;const selected=polygons.find(p=>inside(p[0])&&!p.slice(1).some(inside))||polygons.slice().sort((a,b)=>dist(a[0])-dist(b[0]))[0];
 return selected?{type:'Polygon',coordinates:selected}:geometry;
}
