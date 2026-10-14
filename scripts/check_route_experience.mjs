import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {routeMeasure,pointAlongRoute,smoothBearing,valueAlongRoute,densifyRoute} from './route-experience.mjs';
import {buildProfileRequest,supportsProfileContract,directedProfileCosts} from './server-profile-contract.mjs';
import {projectBoundaryPath,clipCameraPolygon} from './boundary-projection.mjs';
import {createCitySceneLayer,createCityFrame,cityBuildingGeometry} from './city-scene.mjs';
import {createTerrainHeightfield,interpolateDEMTile} from './terrain-heightfield.mjs';
import * as THREE from '../dist/vendor/three.mjs';
// Regression for the user's all-grey 3D recording: half of the city polygon is
// behind the camera. Clipping must preserve the centre of the visible city.
const ring=[[-10,-10,0],[10,-10,0],[10,10,0],[-10,10,0]],cameraMatrix=[1,0,0,0,0,.6,0,.8,0,-.8,0,-.6,0,-.2,.1,.5];
const projected=projectBoundaryPath([ring],cameraMatrix,800,600),screenRing=[...projected.matchAll(/[ML]([\d.-]+) ([\d.-]+)/g)].map(match=>[+match[1],+match[2]]);
assert(screenRing.length>=3);assert(screenRing.every(p=>p[0]>=0&&p[0]<=800&&p[1]>=0&&p[1]<=600));
const inside=(point,polygon)=>{let hit=false;for(let i=0,j=polygon.length-1;i<polygon.length;j=i++){const a=polygon[i],b=polygon[j];if((a[1]>point[1])!==(b[1]>point[1])&&point[0]<(b[0]-a[0])*(point[1]-a[1])/(b[1]-a[1])+a[0])hit=!hit;}return hit;};
assert(inside([400,300],screenRing),'city centre must remain visible with boundary vertices behind the camera');
assert.equal(clipCameraPolygon([[0,0,0,-1],[1,0,0,-1],[0,1,0,-1]]).length,0);
const measure=routeMeasure([[0,0],[30,0],[30,40]]);
assert.equal(measure.total,70);assert.deepEqual(pointAlongRoute(measure,0),[0,0]);assert.deepEqual(pointAlongRoute(measure,1),[30,40]);assert.deepEqual(pointAlongRoute(measure,.5),[30,5]);assert.deepEqual(pointAlongRoute(measure,-1),[0,0]);assert.equal(smoothBearing(359,1,.5),360);
const edge={l:100,dir:0,sf:8,s:8,dz:8,surface:1,way:1,wheelchair:1,steps:false};
const request=buildProfileRequest([9.1,48.7],[9.2,48.8],{preference:'shade',mobilityProfile:'wheelchair'},{iso:'2026-06-21T12:00:00Z'});
assert.equal(request.options.maxSlope,6);assert.equal(request.options.avoidSteps,true);assert(!supportsProfileContract({profile_contract_version:0},request));assert.throws(()=>directedProfileCosts(edge,{preference:'shade'}),/required/);
assert.deepEqual(directedProfileCosts({...edge,steps:true},{mobilityProfile:'wheelchair'}),{cost:-1,reverse_cost:-1});assert(directedProfileCosts(edge,{slopeMode:'uphill'}).cost>directedProfileCosts(edge,{slopeMode:'uphill'}).reverse_cost);
assert.deepEqual(directedProfileCosts({...edge,dir:1},{preference:'balanced'}),{cost:100,reverse_cost:-1});
// An ESM namespace is lexical, not a window/globalThis property. Exercise the
// actual init function up to Map construction with that exact module layout.
const initSource=fs.readFileSync(new URL('./app.source.mjs',import.meta.url),'utf8'),initCode=initSource.slice(initSource.indexOf('async function init(){'),initSource.indexOf('function setupLayers(){'));
let initialized=false,lastStartStatus=null;const initContext={moduleNamespace:{Map:class {constructor(){initialized=true;throw Error('Constructor sentinel');}},GPUInitializationError:class extends Error{}},loadChunkedData:async()=>[{bounds:[9,48,10,49]}, {}, {buildings:[],trees:[]}],cityManifest:null,meta:null,network:null,obstacles:null,poiIcons:null,fetch:async()=>({ok:false}),refreshPoiControlIcons(){},language(){},createTerrainHeightfield:()=>({}),location:{href:'https://example.test/'},AbortSignal,URL,status:key=>lastStartStatus=key,t:key=>key,$:()=>({querySelector:()=>({textContent:'',hidden:false})}),console:{error(){}}};
vm.runInNewContext('const maplibregl=moduleNamespace;'+initCode+';this.initialize=init;',initContext);assert.equal(initContext.maplibregl,undefined,'the test must not install a global library');await initContext.initialize();assert.equal(initialized,true,'module import must reach Map construction without a window global');assert.equal(lastStartStatus,'loadFail','non-GPU startup errors must not claim WebGL is disabled');initContext.moduleNamespace.Map=class {constructor(){throw new initContext.moduleNamespace.GPUInitializationError('No GPU');}};await initContext.initialize();assert.equal(lastStartStatus,'mapUnsupported','only a real GPU initialization error should show the GPU message');

// Execute actual map interaction code. Explore mode must never set route endpoints.
const source=fs.readFileSync(new URL('./app.source.mjs',import.meta.url),'utf8'),choose=source.slice(source.indexOf('function chooseMapPoint'),source.indexOf('function installDirectMapPicking'));
// Reproduce the SDK's actual missing-data value: its API would return 0.
// Scene heights must not consult that API at all, even after repeated renders.
let samples=0,rendered=0;const map={getCanvas:()=>({}),triggerRepaint(){},queryTerrainElevation:()=>{throw Error('Transient renderer elevation must never be read');}},terrain={sample:async()=>{samples++;return 300;},sampleMany:async points=>points.map(()=>300)};
const scene=createCitySceneLayer({origin:[9.18,48.77],toLngLat:p=>[9.18+p[0]/100000,48.77+p[1]/100000],dimensions:t=>({r:t.r,h:t.h}),terrain,rendererFactory:()=>({resetState(){},render(){rendered++;},dispose(){}})});
scene.onAdd(map,{});const tree={p:[0,0],r:5,h:20};await scene.setObjects({trees:[tree],buildings:[]},[0,0]);await Promise.resolve();scene.setVisible(true);
const stable=scene.snapshot().trees[0].ground;assert(stable>299&&stable<301);assert.equal(scene.snapshot().instances,1);
await scene.setObjects({trees:[{...tree}],buildings:[]},[0,0]);await Promise.resolve();assert.equal(samples,1,'known objects must reuse their immutable height');
const renderArgs={defaultProjectionData:{mainMatrix:[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]}};
for(let i=0;i<10;i++){scene.setVisible(false);scene.render({},renderArgs);scene.setVisible(true);scene.render({},renderArgs);assert.equal(scene.snapshot().trees[0].ground,stable);}
assert.equal(rendered,10);assert.equal(samples,1);
terrain.sample=async()=>{throw Error('Tile temporarily unavailable');};await scene.setObjects({trees:[tree,{p:[10,0],r:5,h:20}],buildings:[]},[0,0]);await Promise.resolve();assert.equal(scene.snapshot().instances,1,'a failed DEM fetch must retain existing crowns');assert.equal(scene.snapshot().trees[0].ground,stable);
const frame=createCityFrame([9.18,48.77]),oneMetre=frame.point([9.18+1/(111319.49079327358*Math.cos(48.77*Math.PI/180)),48.77]);assert(Math.abs(Math.fround(oneMetre[0])-1)<1e-6,'local Float32 positions must retain metre precision');
const centimetre=frame.point([9.18+.01/(111319.49079327358*Math.cos(48.77*Math.PI/180)),48.77]);assert(Math.abs(Math.fround(centimetre[0])-.01)<1e-6);
const building={h:20,r:[[[0,0],[10,0],[10,10],[0,10],[0,0]],[[3,3],[3,7],[7,7],[7,3],[3,3]]]},geometry=cityBuildingGeometry(building,{point:p=>p},p=>p,[300,310,305,300,300]);const vertices=geometry.getAttribute('position').array;let roofArea=0;
for(let i=0;i<vertices.length;i+=9){if(vertices[i+2]===330&&vertices[i+5]===330&&vertices[i+8]===330)roofArea+=Math.abs((vertices[i+3]-vertices[i])*(vertices[i+7]-vertices[i+1])-(vertices[i+6]-vertices[i])*(vertices[i+4]-vertices[i+1]))/2;}
assert.equal(roofArea,84,'building courtyard holes must remain open');assert([...vertices].every(Number.isFinite));geometry.dispose();scene.onRemove();
assert.equal(interpolateDEMTile({width:2,height:2,heights:new Float32Array([200,300,400,500])},.25,.25),350);
let loads=0,fail=true;const heights=createTerrainHeightfield({baseURL:'https://example.test/dem/',loadTile:async()=>{loads++;if(fail)throw Error('missing DEM');return {width:2,height:2,heights:new Float32Array([300,300,300,300])};}});
await assert.rejects(heights.sample([9.18,48.77]),/missing DEM/);assert.equal(heights.peek([9.18,48.77]),undefined);fail=false;
assert.deepEqual(await Promise.all([heights.sample([9.18,48.77]),heights.sample([9.18,48.77])]),[390,390]);assert.equal(loads,2,'concurrent samples must share a single retry fetch');assert.equal(await heights.sample([9.18,48.77]),390);
const seaLevel=createTerrainHeightfield({baseURL:'https://example.test/dem/',loadTile:async()=>({width:1,height:1,heights:new Float32Array([0])})});assert.equal(await seaLevel.sample([0,0]),0,'a decoded real sea-level sample is valid; a missing tile is not');
let setCount=0,calculated=0;const context={exploreMode:true,stopRoutePreview(){},inPilot:()=>true,points:[null,null],setCustom(i,p){context.points[i]=p;setCount++;},finishPickMode(){},hideToast(){},showToast(){},ready:true,calculate(){calculated++;}};vm.runInNewContext(choose+';this.choose=chooseMapPoint;',context);context.choose([9.1,48.7]);assert.equal(setCount,0);context.choose([9.1,48.7],{forcedIndex:0});assert.equal(setCount,1);context.exploreMode=false;context.choose([9.2,48.8]);assert.equal(calculated,1);
// Metadata initialization must not fetch the old 12 MB graph.
const worker=fs.readFileSync(new URL('./worker.mjs',import.meta.url),'utf8').replace(/^import .*$/gm,'');const messages=[];let fetches=0;const w={self:{postMessage:m=>messages.push(m)},fetch:()=>{fetches++;throw Error('Graph should be lazy');},Float32Array,console};vm.runInNewContext(worker,w);await w.self.onmessage({data:{type:'initCity',manifest:{origin:[0,0],scale:[1,1]},base:'https://example.test/'}});assert.equal(fetches,0);assert.equal(messages.at(-1).type,'ready');
// Execute the actual replay controller: camera height is explicit, introduction
// is animated, the final coordinate matches the route, and cancellation owns
// the animation frame instead of leaving a second camera writer alive.
const experience=fs.readFileSync(new URL('./map-experience.mjs',import.meta.url),'utf8'),playbackCode=experience.slice(experience.indexOf('function stopRoutePreview('),experience.indexOf('function setupRouteExperience()'));
let frameCallback=null,playbackTime=0;const cameraFrames=[],clamps=[],previewButton={disabled:false},playbackContext={result:{coords:[[0,0],[30,0],[30,40]]},previewState:null,previewPreparing:false,previewRequestId:0,previewFrame:0,is3D:true,viewSwitching:false,cityManifest:null,routeMeasureCache:null,routeMeasure,pointAlongRoute,smoothBearing,valueAlongRoute,densifyRoute,console,performance:{now:()=>playbackTime},$:()=>previewButton,ll:p=>[9.18+p[0]/100000,48.77+p[1]/100000],terrainHeightfield:{sampleMany:async points=>points.map((point,index)=>390+20*index/(points.length-1))},showRoutePosition(){},hideRoutePosition(){},updateExperienceLanguage(){},requestAnimationFrame:callback=>{frameCallback=callback;return 1;},cancelAnimationFrame:()=>{frameCallback=null;},map:{stop(){},getCenter:()=>({lng:9.179,lat:48.77}),getZoom:()=>16,getBearing:()=>0,getPitch:()=>44,getCenterElevation:()=>390,setCenterClampedToGround:value=>clamps.push(value),jumpTo:options=>cameraFrames.push(options),queryTerrainElevation(){throw Error('Replay must not consult transient terrain');},easeTo(){}},loadVisibleCityTiles:async()=>{}};
vm.runInNewContext(playbackCode+';this.play=startRoutePreview;this.stop=stopRoutePreview;',playbackContext);await playbackContext.play();assert.equal(clamps.at(-1),false);
for(let time=0;time<10000&&frameCallback;time+=50){playbackTime=time;const callback=frameCallback;frameCallback=null;callback(time);}
assert.equal(cameraFrames[0].zoom,16);assert(cameraFrames.some(frame=>frame.zoom>16&&frame.zoom<17),'preview must animate entry instead of snapping');assert(cameraFrames.every(frame=>Number.isFinite(frame.elevation)&&frame.elevation>=390));assert(Math.abs(cameraFrames.at(-1).center[0]-9.1803)<1e-10&&Math.abs(cameraFrames.at(-1).center[1]-48.7704)<1e-10);assert.equal(cameraFrames.at(-1).elevation,410);assert.equal(clamps.at(-1),true);
await playbackContext.play();const scheduled=frameCallback;playbackContext.stop(false);const previousFrames=cameraFrames.length;scheduled(playbackTime+100);assert.equal(cameraFrames.length,previousFrames,'a cancelled replay must not change the camera again');
// Run the real view transaction: a second click cannot interleave, terrain is
// initialized once for all switches, and the mode switch never jumps the camera.
const transitionCode=source.slice(source.indexOf('async function setMapViewMode('),source.indexOf("$('view').onclick=()=>setMapViewMode")),events=[],elements=new Map();let finishEase;
let terrainPresent=false;const viewContext={result:null,ensureCityScene:async()=>{},terrainHeightfield:{sample:async()=>390},viewSwitching:false,viewTransitionId:0,is3D:false,tileLoadId:0,cityShadeTimer:null,pendingShade:null,shadeId:0,cityManifest:{},activeCityViewSignature:'old',shadeReady:true,shadeBusyInteractive:false,ready:true,previewState:null,obstacles:{buildings:[],trees:[]},activeCityEdgeIds:[],console,stopRoutePreview(){},clearTimeout(){},setTimeout:()=>0,updateSunDirection(){},requestShade(){},worker:{postMessage(){}},citySceneLayer:{setRoute:async()=>{},setVisible:value=>events.push(['trees',value])},$:id=>{if(!elements.has(id))elements.set(id,{disabled:false,classList:{add(){},remove(){}},setAttribute(){}});return elements.get(id);},easeCamera:()=>{events.push(['ease']);return new Promise(resolve=>finishEase=resolve);},loadVisibleCityTiles:async options=>{assert.equal(options.force,true);events.push(['load']);},map:{getLayer:()=>true,stop(){},getCenter:()=>({lng:9.18,lat:48.777}),getZoom:()=>16,getBearing:()=>0,setLayoutProperty:(id,key,value)=>events.push([id,value]),setMinZoom(){},setMaxZoom(){},setMaxPitch(){},getTerrain:()=>terrainPresent,setCenterClampedToGround:value=>events.push(['clamp',value]),setCenterElevation:value=>events.push(['elevation',value]),setTerrain:value=>{terrainPresent=!!value;events.push(['terrain',value]);},touchPitch:{enable(){},disable(){}},triggerRepaint(){},jumpTo(){throw Error('A second camera jump is forbidden');}}};
vm.runInNewContext(transitionCode+';this.switchMode=setMapViewMode;',viewContext);
for(let i=0;i<12;i++){
 const entering=viewContext.switchMode(true);assert.equal(viewContext.viewSwitching,true);await viewContext.switchMode(false);await new Promise(resolve=>setImmediate(resolve));assert.equal(events.filter(e=>e[0]==='terrain').length,1);finishEase();await entering;assert.equal(viewContext.is3D,true);assert.equal(elements.get('view').disabled,false);
 const leaving=viewContext.switchMode(false);await new Promise(resolve=>setImmediate(resolve));finishEase();await leaving;assert.equal(viewContext.is3D,false);assert.equal(viewContext.viewSwitching,false);assert.equal(terrainPresent,true,'2D must keep the DEM lifecycle and cache alive');
}
assert.equal(events.filter(e=>e[0]==='terrain').length,1,'24 view transitions must initialize terrain once');
console.log('Route experience checks passed: camera clipping, immutable DEM heights, metre precision, building courtyards and persistent terrain switches, exploration, lazy graph and profile rules.');
