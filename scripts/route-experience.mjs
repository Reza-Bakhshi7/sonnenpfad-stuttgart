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
