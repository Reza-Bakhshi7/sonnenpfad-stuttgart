import {tr as trBase,OSM_VALUES,mapLibreLocale} from './i18n.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {routeMeasure,pointAlongRoute,smoothBearing,valueAlongRoute,densifyRoute} from './route-experience.mjs';
import {buildProfileRequest,supportsProfileContract,directedProfileCosts} from './server-profile-contract.mjs';
import {projectBoundaryPath,clipCameraPolygon} from './boundary-projection.mjs';
import {createCitySceneLayer,createCityFrame} from './city-scene.mjs';
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
let initialized=false,lastStartStatus=null,initialMapOptions=null;const initContext={tr:(key,vars,language)=>trBase(key,vars,language??initContext.lang),OSM_VALUES,mapLibreLocale,lang:'de',matchMedia:()=>({matches:false}),moduleNamespace:{Map:class {constructor(options){initialMapOptions=options;initialized=true;throw Error('Constructor sentinel');}},GPUInitializationError:class extends Error{}},loadChunkedData:async()=>[{bounds:[9,48,10,49]}, {}, {buildings:[],trees:[]}],cityManifest:null,meta:null,network:null,obstacles:null,poiIcons:null,fetch:async()=>({ok:false}),refreshPoiControlIcons(){},language(){},createBasemapStyle:()=>({version:8,sources:{},layers:[]}),location:{href:'https://example.test/'},AbortSignal,URL,status:key=>lastStartStatus=key,t:key=>key,$:()=>({querySelector:()=>({textContent:'',hidden:false})}),console:{error(){}}};
vm.runInNewContext('const maplibregl=moduleNamespace;'+initCode+';this.initialize=init;',initContext);assert.equal(initContext.maplibregl,undefined,'the test must not install a global library');await initContext.initialize();assert.equal(initialMapOptions.centerClampedToGround,true,'terrain navigation must pivot at ground elevation');assert.equal(initialized,true,'module import must reach Map construction without a window global');assert.equal(lastStartStatus,'loadFail','non-GPU startup errors must not claim WebGL is disabled');initContext.moduleNamespace.Map=class {constructor(){throw new initContext.moduleNamespace.GPUInitializationError('No GPU');}};await initContext.initialize();assert.equal(lastStartStatus,'mapUnsupported','only a real GPU initialization error should show the GPU message');

// Execute actual map interaction code. Explore mode must never set route endpoints.
const source=fs.readFileSync(new URL('./app.source.mjs',import.meta.url),'utf8'),choose=source.slice(source.indexOf('function chooseMapPoint'),source.indexOf('function installDirectMapPicking'));
// Display is flat and closed: no tile/terrain query can move a known tree.
let rendered=0,renderedScene=null,resets=0;const map={getCanvas:()=>({clientWidth:800,clientHeight:600}),triggerRepaint(){},queryTerrainElevation:()=>{throw Error('Display must never read DEM');}};
const scene=createCitySceneLayer({origin:[9.18,48.77],toLngLat:p=>[9.18+p[0]/100000,48.77+p[1]/100000],dimensions:t=>({r:t.r,h:t.h}),rendererFactory:()=>({resetState(){resets++;},render(value){rendered++;renderedScene=value;},dispose(){}})});
scene.onAdd(map,{});const tree={p:[0,0],r:5,h:20};scene.setTrees([tree],[0,0]);scene.setVisible(true);assert.equal(scene.snapshot().trees[0].ground,0);assert.equal(scene.snapshot().instances,1);
const renderArgs={defaultProjectionData:{mainMatrix:[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]}};
for(let i=0;i<10;i++){scene.setVisible(false);scene.render({},renderArgs);scene.setVisible(true);scene.render({},renderArgs);assert.equal(scene.snapshot().trees[0].ground,0);}
assert.equal(rendered,10);assert.equal(resets,20,'Three must reset the shared WebGL state before and after drawing');
const crownMesh=renderedScene.children[0].children[0],trunkMesh=renderedScene.children[0].children[1],trunkMatrix=new THREE.Matrix4();
assert.equal(crownMesh.material.transparent,false);assert.equal(crownMesh.material.opacity,1);assert.equal(crownMesh.material.depthWrite,true);assert.equal(crownMesh.material.side,THREE.FrontSide);
trunkMesh.getMatrixAt(0,trunkMatrix);const trunkPoints=trunkMesh.geometry.getAttribute('position'),point=new THREE.Vector3();let bottom=Infinity,top=-Infinity;
for(let i=0;i<trunkPoints.count;i++){point.fromBufferAttribute(trunkPoints,i).applyMatrix4(trunkMatrix);bottom=Math.min(bottom,point.z);top=Math.max(top,point.z);}
assert(Math.abs(bottom)<.001,'trunk begins at the flat display ground');assert(top<20,'a 20 m tree cannot produce a several-hundred-metre trunk');
scene.setTrees([{p:[10,0],r:4,h:10}],[0,0]);assert.equal(scene.snapshot().instances,2,'progressive tile arrival must retain previously shown trees');scene.setTrees([],[0,0]);assert.equal(scene.snapshot().instances,2,'an empty/failed tile may not clear known crowns');
const frame=createCityFrame([9.18,48.77]),oneMetre=frame.point([9.18+1/(111319.49079327358*Math.cos(48.77*Math.PI/180)),48.77]);assert(Math.abs(Math.fround(oneMetre[0])-1)<1e-6,'local Float32 positions retain metre precision');
const centimetre=frame.point([9.18+.01/(111319.49079327358*Math.cos(48.77*Math.PI/180)),48.77]);assert(Math.abs(Math.fround(centimetre[0])-.01)<1e-6);
assert(frame.point([9.18,48.771])[1]>0,'Three scene Y must point north; the model matrix flips it once to Mercator');
const transform=new THREE.Matrix4().makeTranslation(frame.x,frame.y,0).scale(new THREE.Vector3(frame.unit,-frame.unit,frame.unit));assert(transform.determinant()<0,'model transform must contain the Mercator handedness reflection');
// Hit the actual sphere through the same combined camera matrix as rendering.
const nativeModel=new THREE.Matrix4().makeTranslation(frame.x,frame.y,0).scale(new THREE.Vector3(frame.unit,-frame.unit,frame.unit)),testCamera=new THREE.PerspectiveCamera(45,800/600,1,1000);testCamera.position.set(20,-60,60);testCamera.lookAt(0,0,15);testCamera.updateMatrixWorld();const desiredProjection=testCamera.projectionMatrix.clone().multiply(testCamera.matrixWorldInverse),nativeProjection=desiredProjection.clone().multiply(nativeModel.clone().invert());scene.render({}, {defaultProjectionData:{mainMatrix:nativeProjection.elements}});const projectedCrown=new THREE.Vector3(0,0,15).applyMatrix4(desiredProjection),picked=scene.pickTree({x:(projectedCrown.x+1)*400,y:(1-projectedCrown.y)*300});assert.deepEqual(picked.tree.p,[0,0],'click raycasting must hit the visible crown after the Mercator reflection');
scene.onRemove();
assert.equal(interpolateDEMTile({width:2,height:2,heights:new Float32Array([200,300,400,500])},.25,.25),350);
let loads=0,fail=true;const heights=createTerrainHeightfield({baseURL:'https://example.test/dem/',loadTile:async()=>{loads++;if(fail)throw Error('missing DEM');return {width:2,height:2,heights:new Float32Array([300,300,300,300])};}});
await assert.rejects(heights.sample([9.18,48.77]),/missing DEM/);assert.equal(heights.peek([9.18,48.77]),undefined);fail=false;
assert.deepEqual(await Promise.all([heights.sample([9.18,48.77]),heights.sample([9.18,48.77])]),[390,390]);assert.equal(loads,2,'concurrent samples must share a single retry fetch');assert.equal(await heights.sample([9.18,48.77]),390);
const seaLevel=createTerrainHeightfield({baseURL:'https://example.test/dem/',loadTile:async()=>({width:1,height:1,heights:new Float32Array([0])})});assert.equal(await seaLevel.sample([0,0]),0,'a decoded real sea-level sample is valid; a missing tile is not');
let setCount=0,calculated=0;const context={tr:(key,vars,language)=>trBase(key,vars,language??context.lang),OSM_VALUES,exploreMode:true,stopRoutePreview(){},inPilot:()=>true,points:[null,null],setCustom(i,p){context.points[i]=p;setCount++;},finishPickMode(){},hideToast(){},showToast(){},ready:true,calculate(){calculated++;}};vm.runInNewContext(choose+';this.choose=chooseMapPoint;',context);context.choose([9.1,48.7]);assert.equal(setCount,0);context.choose([9.1,48.7],{forcedIndex:0});assert.equal(setCount,1);context.exploreMode=false;context.choose([9.2,48.8]);assert.equal(calculated,0,'implicit selection must not modify an established route');context.choose([9.2,48.8],{forcedIndex:1});assert.equal(calculated,1);
// Metadata initialization must not fetch the old 12 MB graph.
const worker=fs.readFileSync(new URL('./worker.mjs',import.meta.url),'utf8').replace(/^import .*$/gm,'');const messages=[];let fetches=0;const w={self:{postMessage:m=>messages.push(m)},fetch:()=>{fetches++;throw Error('Graph should be lazy');},Float32Array,console};vm.runInNewContext(worker,w);await w.self.onmessage({data:{type:'initCity',manifest:{origin:[0,0],scale:[1,1]},base:'https://example.test/'}});assert.equal(fetches,0);assert.equal(messages.at(-1).type,'ready');
assert.equal(w.unknownDirectShade({shade:0},{preference:'balanced'}).shade,null,'browser direct route: shade unknown, not 0 %');assert.equal(w.unknownDirectShade({shade:.4},{preference:'shade'}).shade,.4);
// Execute the actual replay controller: camera height is explicit, introduction
// is animated, the final coordinate matches the route, and cancellation owns
// the animation frame instead of leaving a second camera writer alive.
const experience=fs.readFileSync(new URL('./map-experience.mjs',import.meta.url),'utf8'),playbackCode=experience.slice(experience.indexOf('function stopRoutePreview('),experience.indexOf('function setupRouteExperience()'));
let frameCallback=null,playbackTime=0;const cameraFrames=[],clamps=[],previewButton={disabled:false},playbackContext={tr:(key,vars,language)=>trBase(key,vars,language??playbackContext.lang),OSM_VALUES,syncMobileDock(){},isMobileMap:()=>false,document:{querySelectorAll:()=>[]},result:{coords:[[0,0],[30,0],[30,40]]},previewState:null,previewPreparing:false,previewRequestId:0,previewFrame:0,is3D:true,viewSwitching:false,cityManifest:null,routeMeasureCache:null,routeMeasure,pointAlongRoute,smoothBearing,valueAlongRoute,densifyRoute,console,performance:{now:()=>playbackTime},$:()=>previewButton,ll:p=>[9.18+p[0]/100000,48.77+p[1]/100000],terrainHeightfield:{sampleMany:async points=>points.map((point,index)=>390+20*index/(points.length-1))},showRoutePosition(){},hideRoutePosition(){},updateExperienceLanguage(){},requestAnimationFrame:callback=>{frameCallback=callback;return 1;},cancelAnimationFrame:()=>{frameCallback=null;},map:{stop(){},getCenter:()=>({lng:9.179,lat:48.77}),getZoom:()=>16,getBearing:()=>0,getPitch:()=>44,getCenterElevation:()=>390,setCenterClampedToGround:value=>clamps.push(value),jumpTo:options=>cameraFrames.push(options),queryTerrainElevation(){throw Error('Replay must not consult transient terrain');},easeTo(){}},loadVisibleCityTiles:async()=>{}};
vm.runInNewContext(playbackCode+';this.play=startRoutePreview;this.stop=stopRoutePreview;',playbackContext);await playbackContext.play();assert.equal(clamps.length,0,'flat replay must never change terrain lifecycle');
for(let time=0;time<10000&&frameCallback;time+=50){playbackTime=time;const callback=frameCallback;frameCallback=null;callback(time);}
assert.equal(cameraFrames[0].zoom,16);assert(cameraFrames.some(frame=>frame.zoom>16&&frame.zoom<17),'preview must animate entry instead of snapping');assert(cameraFrames.every(frame=>!('elevation' in frame)));assert(Math.abs(cameraFrames.at(-1).center[0]-9.1803)<1e-10&&Math.abs(cameraFrames.at(-1).center[1]-48.7704)<1e-10);assert.equal(cameraFrames.at(-1).elevation,undefined);assert.equal(clamps.length,0);
await playbackContext.play();const scheduled=frameCallback;playbackContext.stop(false);const previousFrames=cameraFrames.length;scheduled(playbackTime+100);assert.equal(cameraFrames.length,previousFrames,'a cancelled replay must not change the camera again');
// Camera switching cannot be blocked by a stalled tree request or DEM request.
const transitionCode=source.slice(source.indexOf('async function setMapViewMode('),source.indexOf("$('view').onclick=()=>setMapViewMode")),events=[],elements=new Map();let finishEase;
const viewContext={tr:(key,vars,language)=>trBase(key,vars,language??viewContext.lang),OSM_VALUES,isMobileMap:()=>false,MAP_MIN_ZOOM:6,viewSwitching:false,viewTransitionId:0,is3D:false,tileLoadId:0,cityShadeTimer:null,displayShadeId:0,displayShadeSignature:'',cityManifest:{},activeCityViewSignature:'old',console,stopRoutePreview(){},clearTimeout(){},updateModeUI(){},updateSunDirection(){},citySceneLayer:{setVisible:value=>events.push(['trees',value])},$:id=>{if(!elements.has(id))elements.set(id,{disabled:false,classList:{add(){},remove(){}},setAttribute(){}});return elements.get(id);},easeCamera:options=>{events.push(['ease',options]);return new Promise(resolve=>finishEase=resolve);},loadVisibleCityTiles:options=>{assert.equal(options.force,true);events.push(['load']);return new Promise(()=>{});},map:{getLayer:()=>true,stop(){},getZoom:()=>12.2,setLayoutProperty:(id,key,value)=>events.push([id,value]),setMinZoom(){},setMaxPitch(){},touchPitch:{enable(){},disable(){}},triggerRepaint(){},setTerrain(){throw Error('Display must never create terrain');},queryTerrainElevation(){throw Error('Display must never query terrain');}}};
vm.runInNewContext(transitionCode+';this.switchMode=setMapViewMode;',viewContext);
for(let i=0;i<12;i++){
 const entering=viewContext.switchMode(true);assert.equal(viewContext.viewSwitching,true);await viewContext.switchMode(false);assert.equal(events.filter(e=>e[0]==='ease').length,i*2+1,'switches cannot interleave');finishEase();await entering;assert.equal(viewContext.is3D,true);assert.equal(elements.get('view').disabled,false);
 const leaving=viewContext.switchMode(false);finishEase();await leaving;assert.equal(viewContext.is3D,false);assert.equal(viewContext.viewSwitching,false);
}
assert.equal(events.filter(e=>e[0]==='load').length,24);assert(events.filter(e=>e[0]==='ease').every(([,options])=>options.zoom===12.2),'view switching must preserve overview zoom');assert(events.filter(e=>e[0]==='ease').every(([,options])=>!('center' in options)),'rotation/view switches must not recenter the map');
console.log('Route experience checks passed: camera clipping, opaque persistent tree geometry, metre precision, 24 nonblocking view switches, replay completion/cancellation, exploration and profile rules.');

// Address search by keyboard: ArrowDown enters the suggestions, arrows move, ArrowUp returns to the field, Escape closes.
{
 const app=fs.readFileSync(new URL('./app.source.mjs',import.meta.url),'utf8'),code=app.slice(app.indexOf('function populate(){'),app.indexOf('function setCustom('));
 const node=id=>({id,hidden:false,value:'',attrs:{},setAttribute(k,v){this.attrs[k]=v;},getAttribute(k){return this.attrs[k];},focus(){doc.activeElement=this;}});
 const doc={activeElement:null},els={origin:node('origin'),destination:node('destination'),'origin-results':node('origin-results'),'destination-results':node('destination-results')};
 const options=[node('a'),node('b'),node('c')];for(const box of [els['origin-results'],els['destination-results']]){box.querySelector=()=>options[0];box.querySelectorAll=()=>options;}
 vm.runInNewContext(code+';populate();',{$:id=>els[id],document:doc,points:[null,null],markers:[],invalidateRoute(){},searchPlaces(){},showSearchResults(){}});
 const input=els.origin,box=els['origin-results'],key=(target,key)=>{let prevented=false;target.onkeydown({key,preventDefault(){prevented=true;}});return prevented;};
 assert(key(input,'ArrowDown'));assert.equal(doc.activeElement,options[0],'ArrowDown moves into the suggestions');
 key(box,'ArrowDown');key(box,'ArrowDown');key(box,'ArrowDown');assert.equal(doc.activeElement,options[2],'the last suggestion stops the movement');
 key(box,'ArrowUp');key(box,'ArrowUp');key(box,'ArrowUp');assert.equal(doc.activeElement,input,'ArrowUp from the first suggestion returns to the field');
 options[1].focus();key(box,'Escape');assert.equal(box.hidden,true);assert.equal(input.attrs['aria-expanded'],'false');assert.equal(doc.activeElement,input,'Escape closes and returns to the field');
 doc.activeElement=input;assert.equal(key(input,'ArrowDown'),false,'a closed list keeps the cursor in the field');
 const html=fs.readFileSync(new URL('../dist/index.html',import.meta.url),'utf8');
 for(const id of ['origin','destination'])assert.match(html,new RegExp(`<input id="${id}" type="search" role="combobox" aria-expanded="false"`),`${id} is announced as a combobox`);
 assert.match(app,/setAttribute\('aria-expanded',String\(!box\.hidden&&Boolean\(box\.querySelector\('\[role=option\]'\)\)\)\)/,'the field reports whether suggestions are open');
 console.log('Address search keyboard passed: arrows, return to field, Escape, combobox state.');
}

// Faster start: modules preload in parallel; manifest and boundaries are requested before the config answers.
{
 const html=fs.readFileSync(new URL('../dist/index.html',import.meta.url),'utf8'),shared=fs.readFileSync(new URL('../dist/vendor/maplibre-gl.mjs',import.meta.url),'utf8');
 for(const file of ['maplibre-gl.mjs','maplibre-gl-shared.mjs'])assert(html.includes(`<link rel="modulepreload" href="./vendor/${file}">`),`${file} is preloaded`);
 assert(shared.includes('"./maplibre-gl-shared.mjs"'),'preload URL matches the real import');
 const app=fs.readFileSync(new URL('./app.source.mjs',import.meta.url),'utf8'),code=app.slice(app.indexOf('let cityBoundaryPending=null;'),app.indexOf('\n}\n',app.indexOf('async function loadChunkedData(){'))+3);
 const run=async base=>{
  const asked=[];let releaseConfig;const config=new Promise(resolve=>releaseConfig=resolve);
  const ctx={URL,location:{href:'https://sonnenpfad-stuttgart.de/'},cityBaseURL:new URL('https://sonnenpfad-stuttgart.de/city/'),browserRoutingOnly:false,cityManifest:null,
   parseCityManifest:()=>({network:{edgeCount:1}}),fetch:url=>{asked.push(String(url).replace('https://sonnenpfad-stuttgart.de',''));return String(url).endsWith('city-config.json')?config:Promise.resolve({ok:true,text:async()=>'{}',json:async()=>({})});}};
  vm.runInNewContext(code+';this.load=loadChunkedData;this.pending=()=>cityBoundaryPending;',ctx);
  const done=ctx.load();await new Promise(r=>setTimeout(r,0));const before=[...asked];
  releaseConfig({ok:true,json:async()=>({base})});await done;return {before,after:asked,pending:ctx.pending()};
 };
 const same=await run('./city/');
 assert.deepEqual(same.before.sort(),['./city-config.json','/city/bw-boundary.json','/city/manifest.json','/city/stuttgart-boundary.json'],'all four start before the config answers');
 assert.equal(same.after.length,4,'nothing is fetched twice');assert(same.pending,'boundaries are handed to init');
 const moved=await run('./other/');
 assert(moved.after.includes('/other/manifest.json'),'a changed base loads its own manifest');assert.equal(moved.pending,null,'early boundaries of the old base are dropped');
 console.log('Faster start passed: parallel module preload; manifest and boundaries requested together with the config.');
}

// Mobile: the moved route sheet stays inside a named landmark (search fields, legal links).
{
 const mobile=fs.readFileSync(new URL('./mobile-experience.mjs',import.meta.url),'utf8');
 assert.match(mobile,/dock\.setAttribute\('role','region'\);dock\.dataset\.iAria='plannerPanel';dock\.setAttribute\('aria-label',tr\('plannerPanel'\)\)/,'mobile dock is a named region in both languages');
 console.log('Mobile landmark passed.');
}

// Mobile: map buttons under the open route sheet are hidden; all come back when it closes or on desktop.
{
 const mobile=fs.readFileSync(new URL('./mobile-experience.mjs',import.meta.url),'utf8'),code=mobile.slice(mobile.indexOf('function hideCoveredMapTools('),mobile.indexOf('function syncMobileDock('));
 const button=(id,top,bottom)=>({id,style:{visibility:''},getBoundingClientRect:()=>({top,bottom})});
 const tools=[button('view',107,149),button('shade',154,196),button('locate',201,243),button('fit',248,290),button('zoom',298,424)];
 const ctx={document:{querySelectorAll:()=>tools}};vm.runInNewContext(code+';this.hide=hideCoveredMapTools;',ctx);
 const visible=()=>tools.filter(t=>t.style.visibility!=='hidden').map(t=>t.id);
 ctx.hide(true,{getBoundingClientRect:()=>({top:225})});assert.deepEqual(visible(),['view','shade'],'sheet open (top 225): locate, fit and zoom are hidden');
 ctx.hide(true,{getBoundingClientRect:()=>({top:691})});assert.deepEqual(visible(),['view','shade','locate','fit','zoom'],'sheet closed: everything is back');
 ctx.hide(false,{getBoundingClientRect:()=>({top:0})});assert.equal(visible().length,5,'desktop never hides map buttons');
 assert.match(mobile,/hideCoveredMapTools\(mobile,dock\);\n syncMapInteraction\(\);/,'runs on every dock change');
 console.log('Covered map buttons passed.');
}
