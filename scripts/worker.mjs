import {sunPosition,makeShadows,edgeShades,buildAdj,buildComponents,resolvedOptions,route} from './core.mjs';
let network,obstacles={buildings:[],trees:[]},activeEdgeIds=null,meta,adj,componentCache=new Map(),shades=[];

function finishNetwork(){adj=buildAdj(network);componentCache=new Map();shades=new Float32Array(network.edges.length);self.postMessage({type:'ready'});}

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
 if(d.type==='initCity'){await loadCity(d.manifest,d.base);return;}
 if(d.type==='obstacles'){obstacles=d.obstacles;activeEdgeIds=d.edgeIds||null;return;}
 if(d.type==='shade'){
 const center=d.center||[meta.origin[0],meta.origin[1]],sun=sunPosition(new Date(d.iso),center[1],center[0]),polys=makeShadows(obstacles,sun,d.leafOn);
 if(!d.preview){if(activeEdgeIds){const visibleEdges=activeEdgeIds.map(i=>network.edges[i]),visibleShades=edgeShades(visibleEdges,polys,sun.altitude<=0),next=new Float32Array(network.edges.length);activeEdgeIds.forEach((edgeId,index)=>{next[edgeId]=visibleShades[index];});shades=next;}else shades=edgeShades(network.edges,polys,sun.altitude<=0);}
 const bounds=d.bounds||meta.bounds,maxRaster=d.preview?512:1024,aspect=(bounds[3]-bounds[1])*meta.scale[1]/((bounds[2]-bounds[0])*meta.scale[0]);let width=maxRaster,height=Math.max(1,Math.round(width*aspect));if(height>maxRaster){height=maxRaster;width=Math.max(1,Math.round(height/aspect));}
 const canvas=new OffscreenCanvas(width,height),ctx=canvas.getContext('2d');ctx.fillStyle='#24364f';
 const x0=(bounds[0]-meta.origin[0])*meta.scale[0],y1=(bounds[3]-meta.origin[1])*meta.scale[1],xs=width/((bounds[2]-bounds[0])*meta.scale[0]),ys=height/((bounds[3]-bounds[1])*meta.scale[1]);
 for(const rings of polys){ctx.beginPath();for(const ring of rings){for(let i=0;i<ring.length;i++){const x=(ring[i][0]-x0)*xs,y=(y1-ring[i][1])*ys;i?ctx.lineTo(x,y):ctx.moveTo(x,y);}ctx.closePath();}ctx.fill('evenodd');}
 const blob=await canvas.convertToBlob({type:'image/png'});
 self.postMessage({type:'shade',id:d.id,sun,blob,bounds});return;
 }
 if(d.type==='route'){const base=resolvedOptions(d.options),key=[base.avoidSteps,base.avoidEscalators,base.avoidPoorSurface,base.avoidWheelchairNo,base.minWidth||0,base.maxSlope||0].map(value=>String(value??false)).join(':');if(!componentCache.has(key))componentCache.set(key,buildComponents(network,base));const options={...base,components:componentCache.get(key)},result=route(network,adj,shades,d.start,d.end,options),shortest=options.preference==='balanced'?result:route(network,adj,shades,d.start,d.end,{...options,preference:'balanced'});self.postMessage({type:'route',id:d.id,result,shortest});}
 }catch(e){self.postMessage({type:'error',message:e.message,id:d.id});}};
