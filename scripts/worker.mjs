import {sunPosition,makeShadows,edgeShades,buildAdj,buildComponents,route} from './core.mjs';
let network,obstacles,meta,adj,componentsAll,componentsNoSteps,shades=[];
self.onmessage=async({data:d})=>{try{
 if(d.type==='init'){({network,obstacles,meta}=d);adj=buildAdj(network);componentsAll=buildComponents(network,false);componentsNoSteps=buildComponents(network,true);self.postMessage({type:'ready'});return;}
 if(d.type==='shade'){
 const sun=sunPosition(new Date(d.iso)),polys=makeShadows(obstacles,sun,d.leafOn);shades=edgeShades(network.edges,polys,sun.altitude<=0);
 // Rasterize the exact polygons used for sampling; one uniform opacity on the map.
 // This avoids transferring 140k overlapping vector features to the map renderer.
 const bounds=meta.bounds,width=1536,height=Math.round(width*(bounds[3]-bounds[1])*meta.scale[1]/((bounds[2]-bounds[0])*meta.scale[0]));
 const canvas=new OffscreenCanvas(width,height),ctx=canvas.getContext('2d');ctx.fillStyle='#24364f';
 const x0=(bounds[0]-meta.origin[0])*meta.scale[0],y1=(bounds[3]-meta.origin[1])*meta.scale[1],xs=width/((bounds[2]-bounds[0])*meta.scale[0]),ys=height/((bounds[3]-bounds[1])*meta.scale[1]);
 for(const rings of polys){ctx.beginPath();for(const ring of rings){for(let i=0;i<ring.length;i++){const x=(ring[i][0]-x0)*xs,y=(y1-ring[i][1])*ys;i?ctx.lineTo(x,y):ctx.moveTo(x,y);}ctx.closePath();}ctx.fill('evenodd');}
 const blob=await canvas.convertToBlob({type:'image/png'});
 self.postMessage({type:'shade',id:d.id,sun,blob});return;
 }
 if(d.type==='route'){const components=d.options.avoidSteps?componentsNoSteps:componentsAll,options={...d.options,components},result=route(network,adj,shades,d.start,d.end,options),shortest=route(network,adj,shades,d.start,d.end,{...options,preference:'balanced'});self.postMessage({type:'route',id:d.id,result,shortest});}
 }catch(e){self.postMessage({type:'error',message:e.message,id:d.id});}};
