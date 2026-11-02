import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {validateStyleMin} from '@maplibre/maplibre-gl-style-spec';
import {createBasemapStyle} from './basemap-style.mjs';
import {durationMetric,singleSelectedGeometry,profileScale} from './route-experience.mjs';
const source=fs.readFileSync(new URL('./app.source.mjs',import.meta.url),'utf8'),mobile=fs.readFileSync(new URL('./mobile-experience.mjs',import.meta.url),'utf8');
assert.deepEqual(durationMetric(183),{text:'3:03',unit:'h:min'});assert.deepEqual(durationMetric(59),{text:'59',unit:'min'});assert.equal(durationMetric(NaN).text,'—');
const a=[[[0,0],[1,0],[1,1],[0,1],[0,0]]],b=[[[3,0],[4,0],[4,1],[3,1],[3,0]]];assert.deepEqual(singleSelectedGeometry({type:'MultiPolygon',coordinates:[a,b]},[3.5,.5]),{type:'Polygon',coordinates:b});
const basin=profileScale([[0,380],[4000,210],[10000,400]]);assert(190/(basin.high-basin.low)>.5);assert(190/(basin.high-basin.low)<.8);
const choose=source.slice(source.indexOf('function chooseMapPoint('),source.indexOf('function installDirectMapPicking('));
let edits=0,routes=0;const elements=new Map(),ctx={points:[[9.1,48.7],[9.2,48.8]],pick:1,ready:true,stopRoutePreview(){},inPilot:()=>true,finishPickMode(value){ctx.pick=value;},hideToast(){},showToast(){},setCustom(index,p){edits++;ctx.points[index]=p;},calculate(){routes++;},map:{getCenter:()=>({lng:9.21,lat:48.78})},$:id=>{if(!elements.has(id))elements.set(id,{});return elements.get(id);}};
vm.runInNewContext(choose,ctx);const confirm=mobile.slice(mobile.indexOf("$('map-pick-confirm').onclick="),mobile.indexOf("$('map-pick-cancel').onclick="));vm.runInNewContext(confirm,ctx);for(let i=0;i<100;i++)elements.get('map-pick-confirm').onclick();assert.equal(edits,1,'a committed centre pick is consumed once');assert.equal(routes,1);for(let i=0;i<100;i++)vm.runInNewContext('chooseMapPoint([9.3,48.8]);',ctx);assert.equal(edits,1,'incidental map interactions never replace an established route');assert.equal(ctx.pick,null,'picking does not arm the next endpoint');
const style=createBasemapStyle(),terrainCalls=[],layers=[],terrainContext={displayTerrain:null,createTerrainHeightfield:options=>options,location:{href:'https://example.test/'},URL,meta:{bounds:[9.03,48.69,9.32,48.87]},is3D:true,map:{getSource:id=>style.sources[id],addSource:(id,s)=>style.sources[id]=s,getStyle:()=>style,addLayer:layer=>{layers.push(layer);style.layers.push(layer);},setTerrain:t=>terrainCalls.push(t),setLayoutProperty(){}}};
const terrain=source.slice(source.indexOf('function ensureDisplayTerrain(){'),source.indexOf('async function placeDisplayTrees('));vm.runInNewContext(terrain+';ensureDisplayTerrain();',terrainContext);
assert.equal(terrainContext.displayTerrain.zoom,14);assert.equal(style.sources['display-terrain'].maxzoom,14);assert(style.sources['display-terrain'].tiles[0].includes('/{z}/{x}/{y}.png'));assert.equal(terrainCalls.at(-1).source,'display-terrain');assert.equal(terrainCalls.at(-1).exaggeration,1);assert.deepEqual(validateStyleMin(style),[]);
terrainContext.is3D=false;vm.runInNewContext('ensureDisplayTerrain();',terrainContext);assert.equal(terrainCalls.at(-1),null);assert.equal(layers.length,1,'repeated mode switches reuse relief layers');
console.log('Mobile finalization passed: one-shot confirmed picking, stable routes, bounded single-building selection, legible duration, padded linear basin profile and native terrain pyramid/hillshade.');

const routeHandler=source.slice(source.indexOf('function onWorker('),source.indexOf('\npopulate();'));const failureEvents=[],failureContext={routeId:1,serverRoutingPending:true,result:null,shortest:null,$:()=>({hidden:false,disabled:true}),map:{getSource:()=>({setData(){}})},fc:x=>x,status:key=>failureEvents.push(key),syncMobileDock(){failureEvents.push('sync:'+failureContext.result.error);}};vm.runInNewContext(routeHandler+';onWorker({data:{type:"route",id:1,result:{error:"disconnected"}}});',failureContext);assert.deepEqual(failureEvents,['sync:disconnected','disconnected']);
console.log('Failed routes clear stale mobile result state.');

// The actual result renderer must work after diagnostic-only DOM nodes are removed.
const resultElements=new Map();const element=id=>{if(['snap-note','elevation-scale'].includes(id))throw Error('Removed diagnostic node accessed');if(!resultElements.has(id))resultElements.set(id,{textContent:'',nextElementSibling:{},style:{}});return resultElements.get(id);};
const resultContext={result:{minutes:11,length:1000,shade:.7,ascent:20,descent:10},shortest:null,currentSun:{altitude:30},lang:'de',preference:'balanced',durationMetric,document:{body:{classList:{remove(){}}}},finishPickMode(){},effectiveWeather:()=>null,$:element,t:x=>x,renderRouteAssessment(){}};
const resultCode=source.slice(source.indexOf('function showResult(){'),source.indexOf('function fitRoute(){'));vm.runInNewContext(resultCode+';showResult();',resultContext);assert.equal(element('duration').textContent,'= 11');assert.equal(element('duration').nextElementSibling.textContent,'Gehzeit · min');assert.equal(element('route-type').textContent,'balanced');
resultContext.result.minutes=183;vm.runInNewContext('showResult();',resultContext);assert.equal(element('duration').textContent,'= 3:03');

// Concise output still discloses relaxed constraints and missing profile data.
const node=()=>({children:[],textContent:'',classList:{add(){}},append(...children){this.children.push(...children);},replaceChildren(){this.children=[];}}),assessmentBox=node();
const assessmentContext={result:{quality:{surfaceKnown:1,slopeKnown:1,poorSurface:0},criteria:{}},lang:'de',$:id=>id==='route-assessment'?assessmentBox:{value:'wheelchair'},document:{createElement:node},routePoiCounts:()=>({})};
const assessmentCode=source.slice(source.indexOf('function renderRouteAssessment(){'),source.indexOf('function showResult(){'));vm.runInNewContext(assessmentCode+';renderRouteAssessment();',assessmentContext);assert.equal(assessmentBox.hidden,true);
assessmentContext.result.relaxedCriteria=['steps'];assessmentContext.result.quality.surfaceKnown=.2;vm.runInNewContext('renderRouteAssessment();',assessmentContext);assert.equal(assessmentBox.hidden,false);assert(assessmentBox.children.some(child=>child.textContent.includes('Nicht eingehalten: Treppen')));assert(assessmentBox.children.some(child=>child.textContent.includes('Angaben zur Eignung fehlen')));
console.log('Concise result UI passed: removed diagnostics, minute/hour formatting and retained constraint warnings.');

