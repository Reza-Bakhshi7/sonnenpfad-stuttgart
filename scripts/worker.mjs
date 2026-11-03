import {sunPosition,makeShadows,edgeShades,buildAdj,buildComponents,bestAvailableRoute,route} from './core.mjs';
import {adaptServerRoute} from './server-routing.mjs';
import {buildProfileV1Request,supportsProfileV1,requestProfileV1,adaptProfileV1Route} from './profile-routing-v1.mjs';
let profileCapabilities=null;
// Preview only: returns {result} from Stage 2 or {reason} for the browser fallback.
async function profileV2Route({profileApi,lonlat,options,iso}){
 try{
  const signal=AbortSignal.timeout(15000),toLocal=p=>[(p[0]-meta.origin[0])*meta.scale[0],(p[1]-meta.origin[1])*meta.scale[1]];
  if(!profileCapabilities){const response=await fetch(new URL('capabilities',profileApi),{signal,credentials:'omit',headers:{Accept:'application/json'}});if(!response.ok)throw Error('capabilities');profileCapabilities=await response.json();}
  if(!supportsProfileV1(profileCapabilities,buildProfileV1Request(lonlat[0],lonlat[1],options,{iso}),{preview:true}))return {reason:'unsupported'};
  const {data,request}=await requestProfileV1(lonlat[0],lonlat[1],options,{baseURL:profileApi,preview:true,capabilities:profileCapabilities,signal,iso});
  return {result:adaptProfileV1Route(data,toLocal,request)};
 }catch(error){return {reason:error.status?'serverError:'+(error.code||error.status):['TypeError','TimeoutError','AbortError'].includes(error.name)||error.message==='capabilities'?'unreachable':'invalidResponse'};}
}
let network,obstacles={buildings:[],trees:[]},activeEdgeIds=null,meta,adj,componentCache=new Map(),shades=[];

let cityLoadPromise=null,cityInit=null;
async function ensureNetwork(){if(!cityInit)return;if(!cityLoadPromise)cityLoadPromise=loadCity(cityInit.manifest,cityInit.base).catch(error=>{cityLoadPromise=null;throw error;});await cityLoadPromise;}
function finishNetwork(){adj=buildAdj(network);componentCache=new Map();shades=new Float32Array(network.edges.length);if(!cityInit)self.postMessage({type:'ready'});}

async function fetchBinary(files,base,label){
 const names=Array.isArray(files)?files:[files],buffers=await Promise.all(names.map(name=>fetch(new URL(name,base)).then(r=>{if(!r.ok)throw Error(label);return r.arrayBuffer();})));
 const length=buffers.reduce((sum,buffer)=>sum+buffer.byteLength,0),combined=new Uint8Array(length);let offset=0;
 for(const buffer of buffers){combined.set(new Uint8Array(buffer),offset);offset+=buffer.byteLength;}
 return combined.buffer;
}

async function fetchMapping(files,base,label){
 const names=Array.isArray(files)?files:[files],parts=await Promise.all(names.map(name=>fetch(new URL(name,base)).then(r=>{if(!r.ok)throw Error(label);return r.json();})));
 return Object.assign({},...parts);
}

async function loadCity(manifest,base){
 meta=manifest;
 const [nodeBuffer,edgeBuffer,snapIndex]=await Promise.all([
  fetchBinary(manifest.network.nodes,base,'nodes'),
  fetchBinary(manifest.network.edges,base,'edges'),
  fetchMapping(manifest.network.snapIndex,base,'snap index'),
 ]);
 const nodeView=new DataView(nodeBuffer),edgeView=new DataView(edgeBuffer),nodes=new Array(manifest.network.nodeCount),edges=new Array(manifest.network.edgeCount);
 for(let i=0;i<nodes.length;i++){const o=i*8;nodes[i]=[nodeView.getFloat32(o,true),nodeView.getFloat32(o+4,true)];}
 const stride=manifest.network.edgeStride||32;
 for(let i=0;i<edges.length;i++){const o=i*stride,a=edgeView.getUint32(o,true),b=edgeView.getUint32(o+4,true),flags=edgeView.getUint8(o+29),sf=edgeView.getFloat32(o+16,true),mobility=stride>=48?edgeView.getUint16(o+32,true):0;edges[i]={a,b,c:[nodes[a],nodes[b]],l:edgeView.getFloat32(o+8,true),s:edgeView.getFloat32(o+12,true),sf:Number.isNaN(sf)?null:sf,z0:edgeView.getFloat32(o+20,true),z1:edgeView.getFloat32(o+24,true),dz:edgeView.getFloat32(o+24,true)-edgeView.getFloat32(o+20,true),dir:edgeView.getInt8(o+28),steps:Boolean(flags&1),covered:Boolean(flags&2),sq:edgeView.getUint8(o+30),tactile:Boolean(mobility&1),handrail:Boolean(mobility&2),ramp:Boolean(mobility&4),escalator:Boolean(mobility&8),surface:stride>=48?edgeView.getUint8(o+34):0,way:stride>=48?edgeView.getUint8(o+35):0,width:stride>=48?edgeView.getUint16(o+36,true)/10:0,bench:stride>=48?edgeView.getUint16(o+38,true):65535,shelter:stride>=48?edgeView.getUint16(o+40,true):65535,crossing:stride>=48?edgeView.getUint8(o+42):0,wheelchair:stride>=48?edgeView.getUint8(o+43):0};}
 network={nodes,edges,snapIndex,snapGrid:manifest.network.snapGrid};finishNetwork();
}

self.onmessage=async({data:d})=>{try{
 if(d.type==='init'){({network,obstacles,meta}=d);finishNetwork();return;}
 if(d.type==='initCity'){cityInit=d;meta=d.manifest;network={nodes:[],edges:[]};self.postMessage({type:'ready'});return;}
 if(d.type==='obstacles'){obstacles=d.obstacles;activeEdgeIds=d.edgeIds||null;return;}
 if(d.type==='shade'){if(d.routeAware)await ensureNetwork();
 const center=d.center||[meta.origin[0],meta.origin[1]],sun=sunPosition(new Date(d.iso),center[1],center[0]),polys=makeShadows(obstacles,sun,d.leafOn,d.preview?{preview:true,treeSteps:8}:undefined);
 if(d.routeAware){if(activeEdgeIds){const visibleEdges=activeEdgeIds.map(i=>network.edges[i]),visibleShades=edgeShades(visibleEdges,polys,sun.altitude<=0),next=new Float32Array(network.edges.length);activeEdgeIds.forEach((edgeId,index)=>{next[edgeId]=visibleShades[index];});shades=next;}else shades=edgeShades(network.edges,polys,sun.altitude<=0);}
 const bounds=d.bounds||meta.bounds,maxRaster=d.preview?384:1024,aspect=(bounds[3]-bounds[1])*meta.scale[1]/((bounds[2]-bounds[0])*meta.scale[0]);let width=maxRaster,height=Math.max(1,Math.round(width*aspect));if(height>maxRaster){height=maxRaster;width=Math.max(1,Math.round(height/aspect));}
 const canvas=new OffscreenCanvas(width,height),ctx=canvas.getContext('2d');ctx.fillStyle='#24364f';
 const x0=(bounds[0]-meta.origin[0])*meta.scale[0],y1=(bounds[3]-meta.origin[1])*meta.scale[1],xs=width/((bounds[2]-bounds[0])*meta.scale[0]),ys=height/((bounds[3]-bounds[1])*meta.scale[1]);
 for(const rings of polys){ctx.beginPath();for(const ring of rings){for(let i=0;i<ring.length;i++){const x=(ring[i][0]-x0)*xs,y=(y1-ring[i][1])*ys;i?ctx.lineTo(x,y):ctx.moveTo(x,y);}ctx.closePath();}ctx.fill('evenodd');}
 const blob=await canvas.convertToBlob({type:'image/png'});
 self.postMessage({type:'shade',id:d.id,sun,blob,bounds});return;
 }
 if(d.type==='serverRoute'){
  try {
   const toLocal=p=>[(p[0]-meta.origin[0])*meta.scale[0],(p[1]-meta.origin[1])*meta.scale[1]],segments=d.route.properties.segments;
   let fractions=null;
   if(d.obstacles){const sun=sunPosition(new Date(d.iso),d.center[1],d.center[0]),polys=makeShadows(d.obstacles,sun,d.leafOn);fractions=edgeShades(segments.map(s=>{let tags={};try{tags=typeof s.atlas_attributes.routing_osm_tags==='string'?JSON.parse(s.atlas_attributes.routing_osm_tags):s.atlas_attributes.routing_osm_tags||{};}catch{}return {c:s.geometry.coordinates.map(toLocal),covered:tags.tunnel==='yes'||tags.covered==='yes'};}),polys,sun.altitude<=0);}
   const result=adaptServerRoute(d.route,toLocal,fractions);self.postMessage({type:'route',id:d.id,result,shortest:result});
  } catch(error){self.postMessage({type:'route',id:d.id,result:{error:'serverUnavailable'}});}
  return;
 }
 if(d.type==='route'){let fallback=null;if(d.profileApi){const via=await profileV2Route(d);if(via.result){self.postMessage({type:'route',id:d.id,result:via.result,shortest:via.result});return;}fallback=via.reason;}await ensureNetwork();const componentsFor=options=>{const key=[options.avoidSteps,options.avoidEscalators,options.avoidPoorSurface,options.avoidWheelchairNo,options.maxSlope||0].map(value=>String(value??false)).join(':');if(!componentCache.has(key))componentCache.set(key,buildComponents(network,options));return componentCache.get(key);},best=bestAvailableRoute(network,adj,shades,d.start,d.end,d.options,componentsFor),result=best.result,shortest=result.error||best.usedOptions.preference==='balanced'?result:route(network,adj,shades,d.start,d.end,{...best.usedOptions,preference:'balanced'});if(fallback)result.profileApiFallback=fallback;self.postMessage({type:'route',id:d.id,result,shortest});}
 }catch(e){if(d.type==='route')self.postMessage({type:'route',id:d.id,result:{error:'modelFailed'}});else self.postMessage({type:'error',message:e.message,id:d.id});}};

