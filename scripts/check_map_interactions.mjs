import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createMapSelectionGuard} from './map-interactions.mjs';

function canvasStub(){
 const listeners=new Map();
 return {style:{},addEventListener(type,fn){listeners.set(type,fn);},emit(type,id,x=0,y=0){listeners.get(type)?.({pointerId:id,clientX:x,clientY:y});}};
}
const canvas=canvasStub(),guard=createMapSelectionGuard(canvas);
canvas.emit('pointerdown',1);canvas.emit('pointerup',1);
assert.equal(guard.blocked,false,'a stationary single tap may be selected');
canvas.emit('pointerdown',1);canvas.emit('pointerdown',2);canvas.emit('pointerup',2);canvas.emit('pointerup',1);
assert.equal(guard.blocked,true,'a pinch must stay blocked after fingers lift');
canvas.emit('pointerdown',1);canvas.emit('pointermove',1,20);canvas.emit('pointerup',1);
assert.equal(guard.blocked,true,'panning must not create an endpoint');
canvas.emit('pointerdown',1);canvas.emit('pointercancel',1);
assert.equal(guard.blocked,true,'cancelled pointers must not create an endpoint');
canvas.emit('pointerdown',1);canvas.emit('pointerup',1);
assert.equal(guard.blocked,false,'the next independent tap must work');

// Execute the actual application's selection/card handlers, with the map and DOM mocked.
const source=fs.readFileSync(new URL('./app.source.mjs',import.meta.url),'utf8');
const controls=[0,1].map(()=>({attrs:{},classList:{toggle(){}},setAttribute(k,v){this.attrs[k]=v;}}));
const hint={textContent:''},callbacks=new Map(),keyListeners=new Map();
let selected=[],calculations=0,popups=0;
const mockMap={getCanvas:()=>canvas,doubleClickZoom:{enable(){}},on(type,layer,fn){callbacks.set(`${type}:${layer}`,fn);},queryRenderedFeatures:()=>[]};
const context=vm.createContext({
 map:mockMap,pick:null,points:[null,null],markers:[],ready:true,
 mapPickGuard:{blocked:false},pickedMapEvents:new WeakSet(),innerWidth:390,
 matchMedia:()=>({matches:false}),createMapSelectionGuard,
 document:{querySelectorAll:()=>controls,addEventListener:(type,fn)=>keyListeners.set(type,fn)},
 $:()=>hint,t:key=>key,inPilot:()=>true,showToast(){},
 setCustom(i,p){context.points[i]=p;selected.push(i);},calculate(){calculations++;},
 POI_DEFS:[{k:1}],poiCard:()=>({}),lineCard:()=>({}),
 maplibregl:{Popup:class{constructor(){popups++;}setLngLat(){return this;}setDOMContent(){return this;}addTo(){return this;}remove(){}}},
});
for(const name of ['ignoreFeatureClick','handleMapPickClick','finishPickMode','chooseMapPoint','installDirectMapPicking','installFeatureCards']){
 const fn=source.split('\n').find(line=>line.startsWith(`function ${name}(`));
 assert(fn,`missing application handler ${name}`);vm.runInContext(fn,context);
}
const click=()=>({lngLat:{lng:9.18,lat:48.77},originalEvent:{},features:[{properties:{k:1},geometry:{coordinates:[9.18,48.77]}}],point:{x:1,y:1}});
context.handleMapPickClick(click());
assert.equal(selected.length,0,'ordinary map clicks must not select points');
context.finishPickMode(0);
assert.equal(controls[0].attrs['aria-pressed'],'true');
context.handleMapPickClick(click());
assert.deepEqual(selected,[0]);assert.equal(context.pick,null,'selection must be one-shot');
context.handleMapPickClick(click());assert.equal(selected.length,1,'exploring after setting start must not set destination');
context.finishPickMode(1);context.mapPickGuard={blocked:true};context.handleMapPickClick(click());
assert.equal(selected.length,1,'pinching while armed must not select');
context.mapPickGuard={blocked:false};const destinationEvent=click();context.handleMapPickClick(destinationEvent);
assert.deepEqual(selected,[0,1]);assert.equal(calculations,1);assert.equal(context.pick,null);
context.installDirectMapPicking();context.finishPickMode(0);keyListeners.get('keydown')({key:'Escape'});
assert.equal(context.pick,null,'Escape must cancel selection');
context.installFeatureCards();
callbacks.get('mousemove:poi-points')(click());assert.equal(popups,0,'touch devices must not show hover cards');
callbacks.get('click:poi-points')(destinationEvent);assert.equal(popups,0,'an endpoint-selection tap must not also open a detail card');
callbacks.get('click:poi-points')(click());assert.equal(popups,1,'mobile POI details must open on a normal tap');
callbacks.get('click:network-line')(click());assert.equal(popups,2,'mobile line details must open on a normal tap');
context.finishPickMode(1);callbacks.get('click:poi-points')(click());assert.equal(popups,2,'details must not interfere with armed selection');
console.log('Map interactions passed: explicit one-shot selection, pinch/pan/cancel protection, Escape, mobile details and desktop-only hover.');
