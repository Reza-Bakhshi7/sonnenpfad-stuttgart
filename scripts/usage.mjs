// Anonymous usage counts for the admin dashboard (services/platform.mjs): no cookies, nothing stored on
// the device, no coordinates. Only on the production hosts and never with Do Not Track / Global Privacy Control.
const USAGE_HOSTS=new Set(['sonnenpfad-stuttgart.de','www.sonnenpfad-stuttgart.de','sonnenpfad-stuttgart.mohammadreza-bakhshi.workers.dev']);
export function usageAllowed(environment=globalThis){
 const nav=environment.navigator||{},host=environment.location?.hostname||'';
 return USAGE_HOSTS.has(host)&&nav.doNotTrack!=='1'&&nav.globalPrivacyControl!==true;
}
// Districts are reported, never points: a route start counts for its district only.
export function districtAt(point,boundaries){
 const inside=(p,ring)=>{let hit=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){const a=ring[i],b=ring[j];if((a[1]>p[1])!==(b[1]>p[1])&&p[0]<(b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1])+a[0])hit=!hit;}return hit;};
 for(const item of boundaries?.features||[]){if(item.properties?.level!=='district')continue;if(item.geometry.coordinates.some(polygon=>inside(point,polygon[0])&&!polygon.slice(1).some(ring=>inside(point,ring))))return item.properties.id;}
 return null;
}
const usageQueue=[];let usageTimer=0;
function track(type,value){
 if(!usageAllowed())return;
 usageQueue.push({t:type,v:String(value)});clearTimeout(usageTimer);
 if(usageQueue.length>=15)flushUsage();else usageTimer=setTimeout(flushUsage,2000);
}
function flushUsage(){
 if(!usageQueue.length)return;
 const body=JSON.stringify({e:usageQueue.splice(0,20),d:isMobileMap()?'m':'d',l:lang});
 try{if(navigator.sendBeacon?.('/api/event',new Blob([body],{type:'application/json'})))return;}catch{}
 fetch('/api/event',{method:'POST',body,keepalive:true,credentials:'omit',headers:{'Content-Type':'application/json'}}).catch(()=>{});
}
if(typeof document!=='undefined'){addEventListener('pagehide',flushUsage);addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden')flushUsage();});}
