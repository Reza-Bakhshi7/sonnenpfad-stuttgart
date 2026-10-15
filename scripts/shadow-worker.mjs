import {sunPosition} from './core.mjs';
import {drawDisplayShadows} from './shadow-display.mjs';
let obstacles={buildings:[],trees:[]},canvas;
self.onmessage=({data:d})=>{try{
 if(d.type==='obstacles'){obstacles=d.obstacles;return;}
 if(d.type!=='frame')return;
 const started=performance.now(),sun=sunPosition(new Date(d.iso),d.center[1],d.center[0]),{bounds,meta,width,height}=d;
 if(!canvas||canvas.width!==width||canvas.height!==height)canvas=new OffscreenCanvas(width,height);
 const ctx=canvas.getContext('2d'),x0=(bounds[0]-meta.origin[0])*meta.scale[0],y1=(bounds[3]-meta.origin[1])*meta.scale[1],xs=width/((bounds[2]-bounds[0])*meta.scale[0]),ys=height/((bounds[3]-bounds[1])*meta.scale[1]);
 drawDisplayShadows(ctx,obstacles,sun,d.leafOn,(x,y)=>[(x-x0)*xs,(y1-y)*ys]);
 const bitmap=canvas.transferToImageBitmap();self.postMessage({type:'frame',id:d.id,epoch:d.epoch,iso:d.iso,bounds,bitmap,sun,renderMs:performance.now()-started},[bitmap]);
 }catch(error){self.postMessage({type:'error',message:error.message});}};
