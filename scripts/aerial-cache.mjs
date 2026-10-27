// Compressed image cache, separate from GPU textures. Quota failures do not
// disable imagery. Only the fixed public LGL tile endpoint is accepted.
let aerialProtocolInstalled=false;
export function createAerialCache({fetchImpl=fetch,maxEntries=192,maxBytes=24*1024*1024,cacheStorage=globalThis.caches}={}){
 const memory=new Map(),pending=new Map();let bytes=0,diskWrites=Promise.resolve();
 const remember=(url,data)=>{if(memory.has(url)){bytes-=memory.get(url).byteLength;memory.delete(url);}memory.set(url,data);bytes+=data.byteLength;while(memory.size>maxEntries||bytes>maxBytes){const key=memory.keys().next().value;bytes-=memory.get(key).byteLength;memory.delete(key);}return data;};
 const get=async url=>{
  if(!url.startsWith('https://owsproxy.lgl-bw.de/owsproxy/ows/WMTS_LGL-BW_ATKIS_DOP_20_C?'))throw Error('Invalid aerial endpoint');
  if(memory.has(url)){const data=memory.get(url);memory.delete(url);memory.set(url,data);return data.slice(0);}
  if(!pending.has(url))pending.set(url,(async()=>{
   let disk;try{disk=await cacheStorage?.open('sonnenpfad-lgl-v1');const hit=await disk?.match(url);if(hit&&Date.now()-Number(hit.headers.get('x-saved-at'))<7*86400000)return remember(url,await hit.arrayBuffer());}catch{}
   const response=await fetchImpl(url);if(!response.ok)throw Error(`LGL ${response.status}`);
   if(!response.headers.get('content-type')?.startsWith('image/'))throw Error('LGL returned no image');
   const data=await response.arrayBuffer();if(!data.byteLength)throw Error('Empty LGL tile');remember(url,data);
   if(disk){diskWrites=diskWrites.then(async()=>{await disk.put(url,new Response(data.slice(0),{headers:{'content-type':'image/jpeg','x-saved-at':String(Date.now())}}));const keys=await disk.keys();for(const key of keys.slice(0,Math.max(0,keys.length-maxEntries)))await disk.delete(key);}).catch(()=>{});}
   return data;
  })().finally(()=>pending.delete(url)));
  return (await pending.get(url)).slice(0);
 };
 const invalidate=url=>{if(memory.has(url)){bytes-=memory.get(url).byteLength;memory.delete(url);}diskWrites=diskWrites.then(async()=>{const disk=await cacheStorage?.open('sonnenpfad-lgl-v1');await disk?.delete(url);}).catch(()=>{});return diskWrites;};
 return {get,invalidate,snapshot:()=>({entries:memory.size,bytes,pending:pending.size})};
}
export function installAerialProtocol(sdk){
 if(aerialProtocolInstalled)return;aerialProtocolInstalled=true;
 const count=matchMedia('(pointer:coarse)').matches?128:256,raw=createAerialCache({maxEntries:count,maxBytes:12*1024*1024}),cache=createAerialFallback({cache:raw,maxEntries:count});
 sdk.addProtocol('lgl',async(request,controller)=>{const data=await cache.get(request.url.replace(/^lgl:/,'https:'));if(controller.signal.aborted)throw new DOMException('Aborted','AbortError');return {data,cacheControl:'max-age=604800'};});
}

export function aerialParent(url){
 const target=new URL(url),matrix=target.searchParams.get('TILEMATRIX')||'',match=matrix.match(/^GoogleMapsCompatible:(\d+)$/);if(!match||+match[1]<=0)return null;
 const z=+match[1],x=+target.searchParams.get('TILECOL'),y=+target.searchParams.get('TILEROW');
 target.searchParams.set('TILEMATRIX',`GoogleMapsCompatible:${z-1}`);target.searchParams.set('TILECOL',String(Math.floor(x/2)));target.searchParams.set('TILEROW',String(Math.floor(y/2)));
 return {url:target.href,x:x%2,y:y%2};
}
// Some LGL levels return a valid HTTP 200 JPEG filled entirely with white.
// Detect just those tiny homogeneous responses, then crop the correct ancestor
// quadrant. Cropping preserves geography and never invents higher resolution.
export async function isBlankAerial(data){
 if(data.byteLength>4096||typeof createImageBitmap!=='function')return false;
 const bitmap=await createImageBitmap(new Blob([data],{type:'image/jpeg'}));
 try{const canvas=aerialCanvas(16,16),ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.drawImage(bitmap,0,0,16,16);const pixels=ctx.getImageData(0,0,16,16).data;
  for(let i=0;i<pixels.length;i+=4)if(pixels[i]<250||pixels[i+1]<250||pixels[i+2]<250)return false;return true;
 }finally{bitmap.close();}
}
export async function cropAerialParent(data,parent){
 const bitmap=await createImageBitmap(new Blob([data],{type:'image/jpeg'}));
 try{const canvas=aerialCanvas(256,256),ctx=canvas.getContext('2d');ctx.drawImage(bitmap,parent.x*128,parent.y*128,128,128,0,0,256,256);return (await (canvas.convertToBlob?canvas.convertToBlob({type:'image/jpeg',quality:.9}):new Promise((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(Error('Image encoding failed')),'image/jpeg',.9)))).arrayBuffer();}finally{bitmap.close();}
}
export function createAerialFallback({cache,isBlank=isBlankAerial,crop=cropAerialParent,maxBytes=12*1024*1024,maxEntries=128}={}){
 const resolved=new Map(),pending=new Map();let bytes=0;
 const load=async(url,depth=0)=>{
  const hit=resolved.get(url);if(hit&&Date.now()<hit.expires){resolved.delete(url);resolved.set(url,hit);return hit.data.slice(0);}if(hit){resolved.delete(url);bytes-=hit.data.byteLength;}
  if(!pending.has(url))pending.set(url,(async()=>{
   let data,error;try{data=await cache.get(url);if(await isBlank(data)){data=null;await cache.invalidate?.(url);}}catch(e){error=e;}
   const derived=!data;
   if(!data){const parent=depth<6?aerialParent(url):null;if(!parent)throw error||Error('Empty LGL imagery');data=await crop(await load(parent.url,depth+1),parent);}
   resolved.set(url,{data,expires:Date.now()+(derived?60000:7*86400000)});bytes+=data.byteLength;
   while(bytes>maxBytes||resolved.size>maxEntries){const key=resolved.keys().next().value;bytes-=resolved.get(key).data.byteLength;resolved.delete(key);}return data;
  })().finally(()=>pending.delete(url)));
  return (await pending.get(url)).slice(0);
 };
 return {get:load};
}

function aerialCanvas(width,height){if(typeof OffscreenCanvas==='function')return new OffscreenCanvas(width,height);const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;return canvas;}
