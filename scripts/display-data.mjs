// Display requests never fetch the calculation graph or shadow obstacles.
export const DISPLAY_THEME_KEYS=['sl','su','ss','sw','us','uw','n','w'];
export const DISPLAY_THEME_NAMES=['slope','surface','shadeSummer','shadeWinter','utciSummer','utciWinter','noise','wind'];

export function displayDemand({explore=false,threeD=false,zoom=0,pois=false,theme='slope'}={}) {
 return {paths:explore&&zoom>=14.45,theme:explore&&zoom>=14.45&&DISPLAY_THEME_NAMES.includes(theme)?theme:null,pois:explore&&pois&&zoom>=14.45,trees:threeD&&zoom>=14,details:false,dem:false,obstacles:false};
}

export function selectDisplayTiles(manifest,meta,bounds,center,{limit=18,padding=1,bearing=0}={}) {
 const grid=manifest.grid||1000,toCell=p=>[Math.floor((p[0]-meta.origin[0])*meta.scale[0]/grid),Math.floor((p[1]-meta.origin[1])*meta.scale[1]/grid)],a=toCell([bounds[0],bounds[1]]),z=toCell([bounds[2],bounds[3]]),c=toCell(center),available=manifest.tiles||{},r=bearing*Math.PI/180,forward=[Math.sin(r),Math.cos(r)],keys=[];
 for(let x=a[0]-padding;x<=z[0]+padding;x++)for(let y=a[1]-padding;y<=z[1]+padding;y++){const key=`${x}_${y}`;if(available[key])keys.push(key);}
 const score=key=>{const [x,y]=key.split('_').map(Number),dx=x-c[0],dy=y-c[1];return Math.hypot(dx,dy)-Math.max(0,dx*forward[0]+dy*forward[1])*.3;};
 return keys.sort((a,b)=>score(a)-score(b)||a.localeCompare(b)).slice(0,limit);
}

export function createDisplayStore({baseURL,fetchImpl=fetch,maxEntries=96}={}) {
 const cache=new Map(),pending=new Map();
 const get=async(file,revision='')=>{
  const key=file+'?v='+revision;
  if(cache.has(key)){const value=cache.get(key);cache.delete(key);cache.set(key,value);return value;}
  if(pending.has(key))return pending.get(key);
  const url=new URL(file,baseURL);if(revision)url.searchParams.set('v',revision);
  const request=(async()=>{const response=await fetchImpl(url,{signal:AbortSignal.timeout(9000)});if(!response.ok)throw Error(`Display asset ${response.status}: ${file}`);const value=await response.json();cache.set(key,value);while(cache.size>maxEntries)cache.delete(cache.keys().next().value);return value;})().finally(()=>pending.delete(key));
  pending.set(key,request);return request;
 };
 return {get,snapshot:()=>({cached:cache.size,pending:pending.size})};
}
