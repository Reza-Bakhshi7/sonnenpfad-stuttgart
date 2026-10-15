import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createLatestFrameQueue,displayShadowOpacity,drawDisplayShadows} from './shadow-display.mjs';
import {makeShadows,insidePolygon,buildAdj,route} from './core.mjs';
import {createCitySceneLayer} from './city-scene.mjs';
// Hundreds of slider inputs can queue only the latest pending frame.
const sent=[],queue=createLatestFrameQueue(frame=>sent.push(frame));
for(let i=0;i<1000;i++)queue.push({id:i});
assert.deepEqual(sent,[{id:0}]);assert.deepEqual(queue.pending,{id:999});queue.complete();assert.deepEqual(sent,[{id:0},{id:999}]);queue.complete();assert.equal(queue.busy,false);
assert.equal(displayShadowOpacity(0,40),.22);assert.equal(displayShadowOpacity(1,40),.38);assert.equal(displayShadowOpacity(1,-1),0);
// The allocation-free renderer must preserve concave roof/courtyard and wall shadows.
let rings=[],paths=[];const ctx={canvas:{width:1000,height:1000},clearRect(){paths=[];},beginPath(){rings=[];},moveTo(x,y){rings.push([[x,y]]);},lineTo(x,y){rings.at(-1).push([x,y]);},closePath(){},fill(){paths.push(rings);}};
const obstacles={buildings:[{h:20,r:[[[0,0],[40,0],[40,40],[0,40],[0,0]],[[10,10],[10,30],[30,30],[30,10],[10,10]]]},{h:9,r:[[[50,0],[80,0],[80,10],[60,10],[60,30],[50,30],[50,0]]]}],trees:[]};
for(const altitude of [5,25,60])for(const azimuth of [0,70,180,260]){
 const sun={altitude,azimuth},reference=makeShadows(obstacles,sun);
 drawDisplayShadows(ctx,obstacles,sun,true,(x,y)=>[x,y]);
 for(let x=-60;x<160;x+=3)for(let y=-60;y<160;y+=3)assert.equal(paths.some(p=>insidePolygon([x+.1,y+.1],p)),reference.some(p=>insidePolygon([x+.1,y+.1],p)));
}
// Actual worker protocol: transferable bitmap, bounded raster, no PNG round trip.
const source=fs.readFileSync('scripts/shadow-worker.mjs','utf8').replace(/^import .*$/gm,''),messages=[];
class OffscreenCanvas{constructor(width,height){this.width=width;this.height=height;}getContext(){return {...ctx,canvas:this};}transferToImageBitmap(){return {width:this.width,height:this.height};}}
const workerContext={self:{postMessage:(message,transfer)=>messages.push({message,transfer})},performance,OffscreenCanvas,sunPosition:()=>({altitude:45,azimuth:180}),drawDisplayShadows};
vm.runInNewContext(source,workerContext);workerContext.self.onmessage({data:{type:'obstacles',obstacles}});workerContext.self.onmessage({data:{type:'frame',id:1,epoch:2,iso:'2026-06-21T12:00:00Z',center:[9.18,48.77],bounds:[0,0,1,1],meta:{origin:[0,0],scale:[1,1]},width:1024,height:700,leafOn:true}});
assert.equal(messages[0].message.type,'frame');assert.equal(messages[0].message.bitmap.width,1024);assert.equal(messages[0].transfer[0],messages[0].message.bitmap);
// Ground height is absolute; the trunk remains relative, never stretched from sea level.
const scene=createCitySceneLayer({origin:[9.18,48.77],toLngLat:()=>[9.18,48.77],dimensions:tree=>tree});scene.setTrees([{p:[0,0],r:3,h:12,ground:420}],[0,0]);assert.equal(scene.snapshot().trees[0].ground,420);scene.onRemove();
const edge=(a,b,nodes,z0=100,z1=100)=>({a,b,c:[nodes[a],nodes[b]],l:Math.hypot(nodes[a][0]-nodes[b][0],nodes[a][1]-nodes[b][1]),z0,z1,dz:z1-z0,s:0,sf:0,dir:0});
const nodes=[[0,0],[300,0],[0,40],[300,40]],edges=[edge(0,1,nodes),edge(0,2,nodes),edge(2,3,nodes),edge(3,1,nodes)],network={nodes,edges};
const direct=route(network,buildAdj(network),[0,1,1,1],[30,0],[270,0],{preference:'balanced',maxSnap:1});assert.equal(direct.length,240);assert.equal(direct.minutes,4);
const shade=route(network,buildAdj(network),[0,1,1,1],[30,0],[270,0],{preference:'shade',maxSnap:1});assert(shade.path.some(part=>part.i!==0),'same-edge endpoints must still consider a cheaper shaded detour');
const missing={nodes,edges:edges.map(e=>({...e,z0:undefined,z1:undefined}))};const unknown=route(missing,buildAdj(missing),[0,0,0,0],[30,0],[270,0],{maxSnap:1});assert.equal(unknown.ascent,null);assert.equal(unknown.minutes,null);assert.deepEqual(unknown.profile,[]);
// Independent Floyd–Warshall reference on 30 deterministic directed graphs.
let seed=9876;const random=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;};
for(let trial=0;trial<30;trial++){
 const n=Array.from({length:8},(_,i)=>[i*150,(i%2)*100]),es=[];
 for(let a=0;a<8;a++)for(let b=a+1;b<8;b++)if(b===a+1||random()<.18)es.push({...edge(a,b,n),dir:random()<.2?1:0});
 const d=Array.from({length:8},(_,a)=>Array.from({length:8},(_,b)=>a===b?0:Infinity));for(const e of es){d[e.a][e.b]=e.l;if(e.dir!==1)d[e.b][e.a]=e.l;}
 for(let k=0;k<8;k++)for(let a=0;a<8;a++)for(let b=0;b<8;b++)d[a][b]=Math.min(d[a][b],d[a][k]+d[k][b]);
 const result=route({nodes:n,edges:es},buildAdj({nodes:n,edges:es}),es.map(()=>0),n[0],n[7],{maxSnap:.01});assert(!result.error);assert(Math.abs(result.length-d[0][7])<1e-7,JSON.stringify({trial,actual:result.length,expected:d[0][7],es,path:result.path}));
}
console.log('Next-release checks passed: 1,000-event backpressure, projection equivalence, bitmap worker, terrain placement, missing heights, same-edge detour and 30 independent shortest-path references.');
