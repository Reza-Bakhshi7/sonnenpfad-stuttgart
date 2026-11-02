import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {validateStyleMin,createExpression} from '@maplibre/maplibre-gl-style-spec';
import {displayDemand,selectDisplayTiles,createDisplayStore,DISPLAY_THEME_KEYS} from './display-data.mjs';
import {createBasemapStyle,buildingDisplayLayer} from './basemap-style.mjs';

const root=new URL('../',import.meta.url),source=fs.readFileSync(new URL('scripts/app.source.mjs',root),'utf8');
const style=createBasemapStyle();style.layers.push(buildingDisplayLayer());assert.deepEqual(validateStyleMin(style),[],'local style and native building expressions must pass the SDK validator');
assert.equal(style.sources.openmaptiles.url,'https://tiles.openfreemap.org/planet/latest');
const filter=createExpression(buildingDisplayLayer().filter,'layers[0].filter');assert.equal(filter.result,'success');assert.equal(filter.value.evaluate({}, {properties:{hide_3d:true}}),false);assert.equal(filter.value.evaluate({}, {properties:{}}),true);
for(const zoom of [12,15,18]){const demand=displayDemand({zoom});assert.equal(demand.paths,false);assert.equal(demand.pois,false);assert.equal(demand.details,false);assert.equal(demand.obstacles,false);assert.equal(demand.dem,false);}
assert.equal(displayDemand({threeD:true,zoom:16}).trees,true);assert.equal(displayDemand({threeD:true,zoom:13}).trees,false);assert.equal(displayDemand({explore:true,zoom:16,pois:true,theme:'noise'}).theme,'noise');
let fetches=0,release,fail=false;const store=createDisplayStore({baseURL:'https://example.test/city/',maxEntries:2,fetchImpl:async()=>{fetches++;if(fail)return {ok:false,status:503};await new Promise(resolve=>release=resolve);return {ok:true,json:async()=>({trees:[]})};}});
const one=store.get('visual/scene/0_0.json','v1'),two=store.get('visual/scene/0_0.json','v1');assert.equal(fetches,1);release();assert.deepEqual(await one,await two);assert.equal(store.snapshot().pending,0);await store.get('visual/scene/0_0.json','v1');assert.equal(fetches,1);
fail=true;await assert.rejects(store.get('bad.json'),/503/);assert.equal(store.snapshot().pending,0);await assert.rejects(store.get('bad.json'),/503/);assert.equal(fetches,3,'failed requests must permit a later retry');
const visual=JSON.parse(fs.readFileSync(new URL('dist/city/visual/manifest.json',root),'utf8')),manifest=JSON.parse(fs.readFileSync(new URL('dist/city/manifest.json',root),'utf8'));
assert.equal(visual.stats.paths,manifest.network.edgeCount);assert.equal(visual.stats.pois,manifest.counts.pois);assert(visual.stats.sceneBytes<visual.stats.oldSceneBytes*.1,'tree display must not carry the expensive building/shadow payload');
let trees=0,pois=0;for(const [key,definition] of Object.entries(visual.tiles)){
 const read=file=>JSON.parse(fs.readFileSync(new URL('dist/city/'+file,root),'utf8')),scene=read(definition.sceneFile),paths=read(definition.pathsFile),details=read(definition.detailFile),points=read(definition.poiFile);
 assert.deepEqual(Object.keys(scene),['trees']);trees+=scene.trees.length;pois+=points.pois.length;assert.equal(paths.lines.length,paths.edgeIds.length);assert.equal(paths.flags.length,paths.lines.length);
 for(const tree of scene.trees)assert(Object.keys(tree).every(k=>['p','r','h','evergreen'].includes(k)));
 for(const item of points.pois){assert(!('src' in item));assert(details.pois[item.detailKey]?.src,'full POI provenance is retained in the click shard');}
 for(const field of Object.values(definition.themeFiles))assert.equal(read(field).length,paths.lines.length);
}
assert.equal(trees,visual.stats.trees);assert.equal(pois,manifest.counts.pois);

// Execute the real viewport controller and inspect its requests by mode.
const loadCode=source.slice(source.indexOf('async function loadVisibleCityTiles('),source.indexOf('let lastPreviewTileLoad=0;'));
const files=[],writes=[],frames=[],tile={pathsFile:'paths',sceneFile:'scene',poiFile:'pois',detailFile:'details',themeFiles:{slope:'slope',noise:'noise'},trees:1,pois:1},testManifest={revision:'test',grid:1000,tiles:{'0_0':tile}},context={viewSwitching:false,previewState:null,lastPreviewTileLoad:0,map:{getZoom:()=>16,getBounds:()=>({getWest:()=>9.17,getSouth:()=>48.77,getEast:()=>9.19,getNorth:()=>48.79}),getCenter:()=>({lng:9.18,lat:48.777}),getBearing:()=>0,getSource:id=>({setData:value=>writes.push([id,value])})},cityManifest:{},exploreMode:false,is3D:false,selectedPois:new Set(),activeTheme:'slope',tileLoadId:0,activeCityEdgeIds:[],activeCityViewSignature:'',activeTileKeys:'',displayDemand,selectDisplayTiles:()=>['0_0'],ensureDisplayManifest:async()=>{files.push('manifest');return testManifest;},meta:manifest,fc:features=>({features}),renderThemeLegend(){},ensureCityScene:async()=>({setTrees(){},setVisible(){}}),displayStore:{get:async(file)=>{files.push(file);return file==='scene'?{trees:[{p:[0,0],r:3,h:10}]}:{lines:[],edgeIds:[],flags:[]};}},ensurePoiImages:async()=>files.push('icons'),updateVisibleCitySources:async()=>{},shadowDisplayEnabled:false,requestAnimationFrame:callback=>{frames.push(callback);return frames.length;},local:p=>p,ll:p=>p,inPilot:()=>true,console,citySceneLayer:null};
vm.runInNewContext(loadCode+';this.load=loadVisibleCityTiles;',context);await context.load();assert.deepEqual(files,[],'Routing 2D must request zero Atlas display files');
context.is3D=true;let releaseTree,treeUpdates=0;const originalGet=context.displayStore.get;context.displayStore.get=async file=>{if(file!=='scene')return originalGet(file);files.push(file);await new Promise(resolve=>releaseTree=resolve);return {trees:[{p:[0,0],r:3,h:10}]};};context.ensureCityScene=async()=>({setTrees(){treeUpdates++;},setVisible(){}});await context.load();await new Promise(resolve=>setImmediate(resolve));const treeGeneration=context.tileLoadId;await context.load();assert.equal(context.tileLoadId,treeGeneration,'an unchanged viewport must not cancel its still-loading trees');releaseTree();await new Promise(resolve=>setImmediate(resolve));for(const frame of frames.splice(0))frame();assert.equal(treeUpdates,1);assert(files.includes('scene'));assert(files.every(file=>['manifest','scene'].includes(file)),'Routing 3D only requests tree display files');
files.length=0;context.exploreMode=true;context.is3D=false;context.activeTheme='noise';context.activeCityViewSignature='';await context.load();assert.deepEqual(files.sort(),['manifest','noise','paths']);
files.length=0;context.selectedPois.add(9);context.activeCityViewSignature='';await context.load();assert(files.includes('pois'));assert(files.includes('icons'));assert(!files.includes('details'),'hover/viewport loading must never fetch detailed attributes');

// Cards are click-only and cannot appear or fetch data in Routing.
const cardCode=source.slice(source.indexOf('function clearFeatureSelection(){'),source.indexOf('function lineLength(')),handlers=new Map(),shown=[],requests=[];
class Popup{on(name,fn){this.close=fn;return this;}setLngLat(){return this;}setDOMContent(content){shown.push(content);return this;}addTo(){return this;}remove(){this.close?.();}}
let selection=null;const cardContext={ll:p=>p,innerWidth:1200,fc:features=>({features}),feature:(type,coordinates)=>({geometry:{type,coordinates}}),inPilot:()=>true,exploreMode:false,pick:null,viewSwitching:false,previewState:null,is3D:false,featureRequestId:0,featurePopup:null,lang:'de',POI_DEFS:[],maplibregl:{Popup},document:{createElement:()=>({})},map:{addSource(){},addLayer(){},getSource:()=>({setData:value=>selection=value}),on:(type,handler)=>handlers.set(type,handler),getLayer:()=>true,queryRenderedFeatures:()=>[{geometry:{type:'LineString',coordinates:[[9.18,48.77],[9.19,48.78]]},layer:{id:'network-line'},properties:{e:5,_tile:'0_0',sl:4}}]},ensureDisplayManifest:async()=>testManifest,displayStore:{get:async file=>{requests.push(file);if(file==='paths')return {edgeIds:[5],lines:[[[9.18,48.77],[9.185,48.775],[9.19,48.78]]]};return {lines:{5:{sl:4,su:2,ss:70,src:'Atlas'}},pois:{}};}},lineCard:item=>item.properties,console};
vm.runInNewContext(cardCode+';installFeatureCards();',cardContext);assert.deepEqual([...handlers.keys()],['click']);await handlers.get('click')({point:{x:0,y:0},lngLat:[9.18,48.777]});assert.equal(requests.length,0);assert.equal(shown.length,0);
cardContext.exploreMode=true;await handlers.get('click')({point:{x:0,y:0},lngLat:[9.18,48.777]});assert.deepEqual(requests,['details','paths']);assert.equal(shown.at(-1).su,2);assert.equal(shown.at(-1).ss,70);assert.equal(selection.features[0].geometry.coordinates.length,3,'selection restores the full source line instead of a clipped rendered fragment');cardContext.featurePopup.remove();assert.equal(selection.features.length,0,'closing detail card clears highlight');

// The map worker can be initialized in either mode without downloading a graph.
// Decorative buildings and trees never enter Explore hit-testing or selection.
const cardsBefore=shown.length;cardContext.is3D=true;cardContext.citySceneLayer={pickTree(){throw Error('Trees must not be inspected');}};
cardContext.map.queryRenderedFeatures=(point,{layers})=>{assert.deepEqual(Array.from(layers),['poi-points','network-line']);return [];};
await handlers.get('click')({point:{x:10,y:10},lngLat:{lng:9.18,lat:48.777}});assert.equal(shown.length,cardsBefore);assert.equal(selection.features.length,0);

const worker=fs.readFileSync(new URL('scripts/worker.mjs',root),'utf8').replace(/^import .*$/gm,'');let graphFetches=0;const w={self:{postMessage(){}},fetch:()=>{graphFetches++;throw Error('Graph is lazy');},Float32Array,console};vm.runInNewContext(worker,w);await w.self.onmessage({data:{type:'initCity',manifest:{origin:[0,0],scale:[1,1]},base:'https://example.test/'}});assert.equal(graphFetches,0);
console.log(`Display pipeline verified: Routing 2D makes zero Atlas display requests; Routing 3D loads only trees; Explore uses one selected theme and click-only shards. Tree display ${(visual.stats.sceneBytes/1e6).toFixed(2)} MB, ${Math.round((1-visual.stats.sceneBytes/visual.stats.oldSceneBytes)*100)}% smaller.`);

