import {sunPosition,makeShadows,edgeShades,buildAdj,buildComponents,route} from './core.mjs';
let network,obstacles={buildings:[],trees:[]},meta,adj,componentsAll,componentsNoSteps,shades=[];

function finishNetwork(){adj=buildAdj(network);componentsAll=buildComponents(network,false);componentsNoSteps=buildComponents(network,true);shades=new Float32Array(network.edges.length);self.postMessage({type:'ready'});}

async function loadCity(manifest,base){
 meta=manifest;
 const [nodeBuffer,edgeBuffer]=await Promise.all([
  fetch(new URL(manifest.network.nodes,base)).then(r=>{if(!r.ok)throw Error('nodes');return r.arrayBuffer();}),
  fetch(new URL(manifest.network.edges,base)).then(r=>{if(!r.ok)throw Error('edges');return r.arrayBuffer();}),
 ]);
 const nodeView=new DataView(nodeBuffer),edgeView=new DataView(edgeBuffer),nodes=new Array(manifest.network.nodeCount),edges=new Array(manifest.network.edgeCount);
 for(let i=0;i<nodes.length;i++){const o=i*8;nodes[i]=[nodeView.getFloat32(o,true),nodeView.getFloat32(o+4,true)];}
 for(let i=0;i<edges.length;i++){const o=i*32,a=edgeView.getUint32(o,true),b=edgeView.getUint32(o+4,true),flags=edgeView.getUint8(o+29),sf=edgeView.getFloat32(o+16,true);edges[i]={a,b,c:[nodes[a],nodes[b]],l:edgeView.getFloat32(o+8,true),s:edgeView.getFloat32(o+12,true),sf:Number.isNaN(sf)?null:sf,z0:edgeView.getFloat32(o+20,true),z1:edgeView.getFloat32(o+24,true),dz:edgeView.getFloat32(o+24,true)-edgeView.getFloat32(o+20,true),dir:edgeView.getInt8(o+28),steps:Boolean(flags&1),covered:Boolean(flags&2),sq:edgeView.getUint8(o+30)};}
 network={nodes,edges};finishNetwork();
}

self.onmessage=async({data:d})=>{try{
 if(d.type==='init'){({network,obstacles,meta}=d);finishNetwork();return;}
 if(d.type==='initCity'){await loadCity(d.manifest,d.base);return;}
 if(d.type==='obstacles'){obstacles=d.obstacles;return;}
 if(d.type==='shade'){
 const center=d.center||[meta.origin[0],meta.origin[1]],sun=sunPosition(new Date(d.iso),center[1],center[0]),polys=makeShadows(obstacles,sun,d.leafOn);shades=edgeShades(network.edges,polys,sun.altitude<=0);
 const bounds=d.bounds||meta.bounds,width=1536,height=Math.max(1,Math.round(width*(bounds[3]-bounds[1])*meta.scale[1]/((bounds[2]-bounds[0])*meta.scale[0])));
 const canvas=new OffscreenCanvas(width,height),ctx=canvas.getContext('2d');ctx.fillStyle='#24364f';
 const x0=(bounds[0]-meta.origin[0])*meta.scale[0],y1=(bounds[3]-meta.origin[1])*meta.scale[1],xs=width/((bounds[2]-bounds[0])*meta.scale[0]),ys=height/((bounds[3]-bounds[1])*meta.scale[1]);
 for(const rings of polys){ctx.beginPath();for(const ring of rings){for(let i=0;i<ring.length;i++){const x=(ring[i][0]-x0)*xs,y=(y1-ring[i][1])*ys;i?ctx.lineTo(x,y):ctx.moveTo(x,y);}ctx.closePath();}ctx.fill('evenodd');}
 const blob=await canvas.convertToBlob({type:'image/png'});
 self.postMessage({type:'shade',id:d.id,sun,blob,bounds});return;
 }
 if(d.type==='route'){const components=d.options.avoidSteps?componentsNoSteps:componentsAll,options={...d.options,components},result=route(network,adj,shades,d.start,d.end,options),shortest=route(network,adj,shades,d.start,d.end,{...options,preference:'balanced'});self.postMessage({type:'route',id:d.id,result,shortest});}
 }catch(e){self.postMessage({type:'error',message:e.message,id:d.id});}};
