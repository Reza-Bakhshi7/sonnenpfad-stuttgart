import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {routeMeasure,pointAlongRoute,smoothBearing} from './route-experience.mjs';
import {buildProfileRequest,supportsProfileContract,directedProfileCosts} from './server-profile-contract.mjs';
import {projectBoundaryPath,clipCameraPolygon} from './boundary-projection.mjs';
import {sphereMesh} from './sphere-trees.mjs';
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
let setCount=0,calculated=0;const context={exploreMode:true,stopRoutePreview(){},inPilot:()=>true,points:[null,null],setCustom(i,p){context.points[i]=p;setCount++;},finishPickMode(){},hideToast(){},showToast(){},ready:true,calculate(){calculated++;}};vm.runInNewContext(choose+';this.choose=chooseMapPoint;',context);context.choose([9.1,48.7]);assert.equal(setCount,0);context.choose([9.1,48.7],{forcedIndex:0});assert.equal(setCount,1);context.exploreMode=false;context.choose([9.2,48.8]);assert.equal(calculated,1);
// Metadata initialization must not fetch the old 12 MB graph.
const worker=fs.readFileSync(new URL('./worker.mjs',import.meta.url),'utf8').replace(/^import .*$/gm,'');const messages=[];let fetches=0;const w={self:{postMessage:m=>messages.push(m)},fetch:()=>{fetches++;throw Error('Graph should be lazy');},Float32Array,console};vm.runInNewContext(worker,w);await w.self.onmessage({data:{type:'initCity',manifest:{origin:[0,0],scale:[1,1]},base:'https://example.test/'}});assert.equal(fetches,0);assert.equal(messages.at(-1).type,'ready');
console.log('Route experience checks passed: metre-based interpolation, curve bearings, exploration picks, lazy graph init, directed profile rules and API capability gate.');
