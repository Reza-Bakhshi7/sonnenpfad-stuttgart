import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {routeMeasure,pointAlongRoute,smoothBearing} from './route-experience.mjs';
import {buildProfileRequest,supportsProfileContract,directedProfileCosts} from './server-profile-contract.mjs';
import {projectBoundaryPath,clipCameraPolygon} from './boundary-projection.mjs';
import {sphereMesh,createSphereTreeLayer} from './sphere-trees.mjs';
import {stableTreeSelection,treeKey} from './tree-selection.mjs';
// Regression for the user's all-grey 3D recording: half of the city polygon is
// behind the camera. Clipping must preserve the centre of the visible city.
const ring=[[-10,-10,0],[10,-10,0],[10,10,0],[-10,10,0]],cameraMatrix=[1,0,0,0,0,.6,0,.8,0,-.8,0,-.6,0,-.2,.1,.5];
const projected=projectBoundaryPath([ring],cameraMatrix,800,600),screenRing=[...projected.matchAll(/[ML]([\d.-]+) ([\d.-]+)/g)].map(match=>[+match[1],+match[2]]);
assert(screenRing.length>=3);assert(screenRing.every(p=>p[0]>=0&&p[0]<=800&&p[1]>=0&&p[1]<=600));
const inside=(point,polygon)=>{let hit=false;for(let i=0,j=polygon.length-1;i<polygon.length;j=i++){const a=polygon[i],b=polygon[j];if((a[1]>point[1])!==(b[1]>point[1])&&point[0]<(b[0]-a[0])*(point[1]-a[1])/(b[1]-a[1])+a[0])hit=!hit;}return hit;};
assert(inside([400,300],screenRing),'city centre must remain visible with boundary vertices behind the camera');
assert.equal(clipCameraPolygon([[0,0,0,-1],[1,0,0,-1],[0,1,0,-1]]).length,0);
const mesh=sphereMesh();for(let i=0;i<mesh.vertices.length;i+=3)assert(Math.abs(Math.hypot(...mesh.vertices.slice(i,i+3))-1)<1e-6);
for(let i=0;i<mesh.indices.length;i+=3){const a=[...mesh.vertices.slice(mesh.indices[i]*3,mesh.indices[i]*3+3)],b=[...mesh.vertices.slice(mesh.indices[i+1]*3,mesh.indices[i+1]*3+3)],c=[...mesh.vertices.slice(mesh.indices[i+2]*3,mesh.indices[i+2]*3+3)],u=b.map((v,j)=>v-a[j]),v=c.map((q,j)=>q-a[j]),normal=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]];assert(normal.reduce((sum,q,j)=>sum+q*a[j],0)>0,'sphere faces must point outward');}
const measure=routeMeasure([[0,0],[30,0],[30,40]]);
assert.equal(measure.total,70);assert.deepEqual(pointAlongRoute(measure,0),[0,0]);assert.deepEqual(pointAlongRoute(measure,1),[30,40]);assert.deepEqual(pointAlongRoute(measure,.5),[30,5]);assert.deepEqual(pointAlongRoute(measure,-1),[0,0]);assert.equal(smoothBearing(359,1,.5),360);
const edge={l:100,dir:0,sf:8,s:8,dz:8,surface:1,way:1,wheelchair:1,steps:false};
const request=buildProfileRequest([9.1,48.7],[9.2,48.8],{preference:'shade',mobilityProfile:'wheelchair'},{iso:'2026-06-21T12:00:00Z'});
assert.equal(request.options.maxSlope,6);assert.equal(request.options.avoidSteps,true);assert(!supportsProfileContract({profile_contract_version:0},request));assert.throws(()=>directedProfileCosts(edge,{preference:'shade'}),/required/);
assert.deepEqual(directedProfileCosts({...edge,steps:true},{mobilityProfile:'wheelchair'}),{cost:-1,reverse_cost:-1});assert(directedProfileCosts(edge,{slopeMode:'uphill'}).cost>directedProfileCosts(edge,{slopeMode:'uphill'}).reverse_cost);
assert.deepEqual(directedProfileCosts({...edge,dir:1},{preference:'balanced'}),{cost:100,reverse_cost:-1});
// Execute actual map interaction code. Explore mode must never set route endpoints.
const source=fs.readFileSync(new URL('./app.source.mjs',import.meta.url),'utf8'),choose=source.slice(source.indexOf('function chooseMapPoint'),source.indexOf('function installDirectMapPicking'));
// Known ground must survive a temporarily missing DEM sample. Otherwise every
// refreshed crown can jump hundreds of metres down and disappear below terrain.
const uploads=[],draws=[];let ground=300,resourceId=0;
const gl=new Proxy({getShaderParameter:()=>true,getProgramParameter:()=>true,getParameter:key=>key==='DEPTH_WRITEMASK',isEnabled:()=>false,bufferData:(target,data,usage)=>{if(usage==='DYNAMIC_DRAW')uploads.push([...data]);},drawElementsInstanced:(mode,count,type,offset,instances)=>draws.push(instances)},{get(target,key){if(key in target)return target[key];if(String(key).toUpperCase()===key)return key;if(String(key).startsWith('create'))return ()=>({id:++resourceId});return ()=>{};}});
globalThis.maplibregl={MercatorCoordinate:{fromLngLat:(p,z)=>({x:p[0],y:p[1],z,meterInMercatorCoordinateUnits:()=>1})}};
const layer=createSphereTreeLayer({toLngLat:p=>p,dimensions:tree=>({r:tree.r,h:tree.h})}),treeMap={triggerRepaint(){},queryTerrainElevation:()=>ground,getTerrain:()=>({source:'dem'})},tree={p:[0,0],r:5,h:20};
layer.onAdd(treeMap,gl);layer.setTrees([tree]);layer.setVisible(true);const renderArgs={defaultProjectionData:{mainMatrix:[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]}};layer.render(gl,renderArgs);assert.equal(uploads.at(-1)[2],315);assert.equal(draws.at(-1),1);
const uploadCount=uploads.length;layer.setTrees([{...tree}]);layer.render(gl,renderArgs);assert.equal(uploads.length,uploadCount,'unchanged crowns must not upload again');
ground=null;layer.terrainRevision++;layer.render(gl,renderArgs);assert.equal(uploads.at(-1)[2],315,'missing terrain sample must retain the known height');assert.equal(draws.at(-1),1);
layer.setVisible(false);const drawCount=draws.length;layer.render(gl,renderArgs);assert.equal(draws.length,drawCount,'2D must never draw crowns');layer.setVisible(true);layer.render(gl,renderArgs);assert.equal(draws.at(-1),1);
const population=[tree,{p:[10,0],r:5,h:20},{p:[20,0],r:5,h:20}],firstSelection=stableTreeSelection(population,[],[0,0],2),secondSelection=stableTreeSelection(population,firstSelection.keys,[20,0],2);assert.deepEqual(secondSelection.keys,firstSelection.keys,'camera movement must retain the existing tree population');
assert.equal(treeKey(population[1]),'10.00:0.00');
let setCount=0,calculated=0;const context={exploreMode:true,stopRoutePreview(){},inPilot:()=>true,points:[null,null],setCustom(i,p){context.points[i]=p;setCount++;},finishPickMode(){},hideToast(){},showToast(){},ready:true,calculate(){calculated++;}};vm.runInNewContext(choose+';this.choose=chooseMapPoint;',context);context.choose([9.1,48.7]);assert.equal(setCount,0);context.choose([9.1,48.7],{forcedIndex:0});assert.equal(setCount,1);context.exploreMode=false;context.choose([9.2,48.8]);assert.equal(calculated,1);
// Metadata initialization must not fetch the old 12 MB graph.
const worker=fs.readFileSync(new URL('./worker.mjs',import.meta.url),'utf8').replace(/^import .*$/gm,'');const messages=[];let fetches=0;const w={self:{postMessage:m=>messages.push(m)},fetch:()=>{fetches++;throw Error('Graph should be lazy');},Float32Array,console};vm.runInNewContext(worker,w);await w.self.onmessage({data:{type:'initCity',manifest:{origin:[0,0],scale:[1,1]},base:'https://example.test/'}});assert.equal(fetches,0);assert.equal(messages.at(-1).type,'ready');
// Run the real view transaction: a second click cannot interleave, terrain is
// changed once before animation, and the mode switch never performs a jumpTo.
const transitionCode=source.slice(source.indexOf('async function setMapViewMode('),source.indexOf("$('view').onclick=()=>setMapViewMode")),events=[],elements=new Map();let finishEase;
const viewContext={viewSwitching:false,viewTransitionId:0,is3D:false,tileLoadId:0,cityShadeTimer:null,pendingShade:null,shadeId:0,cityManifest:{},activeCityViewSignature:'old',shadeReady:true,shadeBusyInteractive:false,ready:true,previewState:null,obstacles:{buildings:[],trees:[]},activeCityEdgeIds:[],console,stopRoutePreview(){},clearTimeout(){},setTimeout:()=>0,updateSunDirection(){},requestShade(){},worker:{postMessage(){}},treeSphereLayer:{setVisible:value=>events.push(['trees',value])},$:id=>{if(!elements.has(id))elements.set(id,{disabled:false,classList:{add(){},remove(){}},setAttribute(){}});return elements.get(id);},easeCamera:()=>{events.push(['ease']);return new Promise(resolve=>finishEase=resolve);},loadVisibleCityTiles:async options=>{assert.equal(options.force,true);events.push(['load']);},map:{getLayer:()=>true,stop(){},getCenter:()=>({lng:9.18,lat:48.777}),getZoom:()=>16,getBearing:()=>0,setLayoutProperty:(id,key,value)=>events.push([id,value]),setMinZoom(){},setMaxZoom(){},setMaxPitch(){},setTerrain:value=>events.push(['terrain',value]),touchPitch:{enable(){},disable(){}},triggerRepaint(){},jumpTo(){throw Error('A second camera jump is forbidden');}}};
vm.runInNewContext(transitionCode+';this.switchMode=setMapViewMode;',viewContext);const entering=viewContext.switchMode(true);assert.equal(viewContext.viewSwitching,true);await viewContext.switchMode(false);assert.equal(events.filter(e=>e[0]==='terrain').length,1);assert(events.findIndex(e=>e[0]==='terrain')<events.findIndex(e=>e[0]==='ease'));finishEase();await entering;assert.equal(viewContext.viewSwitching,false);assert.equal(viewContext.is3D,true);assert.equal(elements.get('view').disabled,false);
const leaving=viewContext.switchMode(false);finishEase();await leaving;assert.equal(viewContext.is3D,false);assert.equal(viewContext.viewSwitching,false);assert.equal(events.filter(e=>e[0]==='terrain').length,2);assert.equal(events.filter(e=>e[0]==='terrain').at(-1)[1],null);
console.log('Route experience checks passed: camera clipping, stable sphere heights/selection, serialized view switching, exploration, lazy graph and profile rules.');
