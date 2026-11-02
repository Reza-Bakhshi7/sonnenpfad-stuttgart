import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createAerialCache,createAerialFallback,aerialParent} from './aerial-cache.mjs';
import {isRoutingPreview,profileScale,profileAtDistance,formatWalkDuration,routeMeasure,pointAlongRoute,densifyRoute,smoothBearing} from './route-experience.mjs';
const source=fs.readFileSync(new URL('./app.source.mjs',import.meta.url),'utf8');
// Read every original signed direction as int8; compare regenerated display
// flags, so a regression from -1 to unsigned 255 cannot quietly return.
const root=new URL('../dist/city/',import.meta.url),read=f=>JSON.parse(fs.readFileSync(new URL(f,root),'utf8'));
const manifest=read('manifest.json'),visual=read('visual/manifest.json'),directions=fs.readFileSync(new URL(manifest.visual.slopeDirections,root));let descending=0;
for(const tile of Object.values(visual.tiles)){const data=read(tile.pathsFile);data.flags.forEach((flag,i)=>{const expected=directions.readInt8(data.edgeIds[i]);assert.equal(flag[2],expected);if(expected<0)descending++;});}
assert(descending>1000,'the real dataset must exercise reversed arrows');
const arrowCode=source.slice(source.indexOf('function straightArrowSegment('),source.indexOf('function slopeArrowFeatures('));const arrow={};vm.runInNewContext(arrowCode+';this.segment=straightArrowSegment;',arrow);
assert(arrow.segment([[0,0],[0,100]],-1)[0][1]>arrow.segment([[0,0],[0,100]],-1)[1][1]);
// Same true 5% grade on a 1 km and 10 km route must have the same display
// tangent when the fixed 2x scale fits. Missing heights remain gaps.
const basin=profileScale([[0,360],[4000,220],[10000,410]]);assert(basin.high>410&&basin.low<220);assert(190/(basin.high-basin.low)>.5&&190/(basin.high-basin.low)<.8,'the basin remains visible with deliberate headroom');
assert.equal(profileAtDistance([[0,200],[500,null],[1000,250]],250),null);
assert.equal(profileAtDistance([[0,200],[1000,250]],500),225);
assert.equal(formatWalkDuration(59),'59 min');assert.equal(formatWalkDuration(60),'1 Std.');assert.equal(formatWalkDuration(125),'2 Std. 5 min');assert.equal(formatWalkDuration(83,'en'),'1 h 23 min');
// Moving away and returning uses compressed data, concurrent views deduplicate;
// transferred buffers are independent and failures remain retryable.
let fetches=0,fail=false;const url=n=>`https://owsproxy.lgl-bw.de/owsproxy/ows/WMTS_LGL-BW_ATKIS_DOP_20_C?tile=${n}`;
const cache=createAerialCache({maxEntries:2,maxBytes:100,cacheStorage:null,fetchImpl:async()=>{fetches++;if(fail)return new Response('',{status:503});return new Response(new Uint8Array([1,2,3]),{headers:{'content-type':'image/jpeg'}});}});
const [a,b]=await Promise.all([cache.get(url(1)),cache.get(url(1))]);assert.equal(fetches,1);assert.notEqual(a,b);new Uint8Array(a)[0]=9;assert.equal(new Uint8Array(await cache.get(url(1)))[0],1);
await cache.get(url(2));await cache.get(url(1));assert.equal(fetches,2);await cache.get(url(3));assert.equal(cache.snapshot().entries,2);await cache.get(url(2));assert.equal(fetches,4);
fail=true;await assert.rejects(cache.get(url(4)),/503/);fail=false;await cache.get(url(4));assert.equal(cache.snapshot().pending,0);await assert.rejects(cache.get('https://example.test/'),/Invalid/);
// Execute the real touch handler: a hold/double tap cannot set a point. A
// desktop double click still works, without passing touch gesture timers.
const picking=source.slice(source.indexOf('function installDirectMapPicking('),source.indexOf('function updateMarkers('));const events={},canvasEvents={};const context={map:{doubleClickZoom:{enable(){}},on:(name,fn)=>events[name]=fn,getCanvas:()=>({addEventListener:(name,fn)=>canvasEvents[name]=fn})}};vm.runInNewContext(picking+';installDirectMapPicking();',context);assert.equal(events.dblclick,undefined);assert.equal(canvasEvents.pointerdown,undefined);
// Real replay loop: pause does not advance, x2/x4 change distance continuously,
// stop cancels the current camera owner even with a previously queued callback.
const experience=fs.readFileSync(new URL('./map-experience.mjs',import.meta.url),'utf8'),controller=experience.slice(experience.indexOf('function stopRoutePreview('),experience.indexOf('function setupRouteExperience()'));
let callback=null,clock=0;const frames=[],ctx={isMobileMap:()=>false,syncMobileDock(){},document:{querySelectorAll:()=>[]},result:{coords:[[0,0],[1000,0]]},previewState:null,previewPreparing:false,previewRequestId:0,previewFrame:0,is3D:true,viewSwitching:false,cityManifest:null,routeMeasureCache:null,routeMeasure,pointAlongRoute,densifyRoute,smoothBearing,performance:{now:()=>clock},$:()=>({}),ll:p=>p,showRoutePosition(){},hideRoutePosition(){},updateExperienceLanguage(){},requestAnimationFrame:fn=>{callback=fn;return 1;},cancelAnimationFrame:()=>callback=null,map:{stop(){},getCenter:()=>({lng:0,lat:0}),getZoom:()=>17,getBearing:()=>90,getPitch:()=>50,jumpTo:o=>frames.push(o),easeTo(){}}};
vm.runInNewContext(controller+';this.start=startRoutePreview;this.stop=stopRoutePreview;',ctx);await ctx.start();const tick=()=>{clock+=100;callback(clock);};for(let i=0;i<10;i++)tick();const initial=ctx.previewState.distance;ctx.previewState.paused=true;tick();assert.equal(ctx.previewState.distance,initial);ctx.previewState.paused=false;ctx.previewState.speed=2;tick();assert(Math.abs(ctx.previewState.distance-initial-3.6)<1e-9);const twice=ctx.previewState.distance;ctx.previewState.speed=4;tick();assert(Math.abs(ctx.previewState.distance-twice-7.2)<1e-9);const queued=callback;ctx.stop(false);const count=frames.length;queued(clock+100);assert.equal(frames.length,count);
console.log(`App 09 passed: ${descending} reversed signed display records, metric grades, gaps, hour durations, bounded aerial cache/retry, touch safety and pause/x2/x4/cancel.`);

// A white HTTP-200 child must use the geographically correct parent quadrant.
const child='https://owsproxy.lgl-bw.de/owsproxy/ows/WMTS_LGL-BW_ATKIS_DOP_20_C?TILEMATRIX=GoogleMapsCompatible:18&TILECOL=137757&TILEROW=90273';
const parent=aerialParent(child);assert.equal(new URL(parent.url).searchParams.get('TILECOL'),'68878');assert.equal(parent.x,1);assert.equal(parent.y,1);
const calls=[];const fallback=createAerialFallback({cache:{get:async url=>{calls.push(url);return new Uint8Array([url===child?0:9]).buffer;}},isBlank:async data=>new Uint8Array(data)[0]===0,crop:async(data,p)=>{assert.equal(p.x,1);assert.equal(p.y,1);return data;}});
assert.equal(new Uint8Array(await fallback.get(child))[0],9);await fallback.get(child);assert.equal(calls.length,2,'cached fallback avoids repeated white-child and parent requests');
console.log('Aerial blank-tile parent fallback verified.');

assert(isRoutingPreview('app09-mobile-finalization-preview-sonnenpfad-stuttgart.mohammadreza-bakhshi.workers.dev'));
assert(isRoutingPreview('2feb460e-sonnenpfad-stuttgart.mohammadreza-bakhshi.workers.dev'));
assert(isRoutingPreview('oracle-profiles-v1-preview-sonnenpfad-stuttgart.mohammadreza-bakhshi.workers.dev'));
assert(!isRoutingPreview('sonnenpfad-stuttgart.de'));assert(!isRoutingPreview('sonnenpfad-stuttgart.mohammadreza-bakhshi.workers.dev'));assert(!isRoutingPreview('example.test'));
console.log('Preview routing is isolated from production hosts.');
