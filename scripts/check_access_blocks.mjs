import fs from 'node:fs';
import assert from 'node:assert/strict';
import {buildAdj,route,bestAvailableRoute} from './core.mjs';

// Data: bitset matches the manifest; samples were checked against OSM on 2026-11-03.
const root=new URL('../dist/city/',import.meta.url),manifest=JSON.parse(fs.readFileSync(new URL('manifest.json',root),'utf8')),declared=manifest.network.accessBlocked;
const bits=fs.readFileSync(new URL(declared.file,root)),isBlocked=i=>Boolean(bits[i>>3]&1<<(i&7));
assert.equal(bits.length,Math.ceil(manifest.network.edgeCount/8));
let count=0;for(const byte of bits)for(let k=0;k<8;k++)count+=byte>>k&1;
assert.equal(count,declared.count);
for(const edge of [126106,10683])assert(isBlocked(edge),`access=private edge ${edge} must be blocked`);
for(const edge of [232424,2481])assert(isBlocked(edge),`foot=use_sidepath carriageway ${edge} must be blocked`);
for(const edge of [126736,153,192260,233187])assert(!isBlocked(edge),`ordinary walkable edge ${edge} must stay open`);

// Rule: a blocked shortcut is never used, by any profile, and never relaxed.
const nodes=[[0,0],[10,0],[20,0],[10,10]];
const edge=(a,b,extras={})=>({a,b,c:[nodes[a],nodes[b]],l:Math.hypot(nodes[b][0]-nodes[a][0],nodes[b][1]-nodes[a][1]),s:0,sf:0,dz:0,z0:250,z1:250,steps:false,escalator:false,dir:0,surface:1,way:1,width:2,wheelchair:1,bench:65535,shelter:65535,crossing:0,...extras});
const network={nodes,edges:[edge(0,1),edge(1,2,{accessBlocked:true}),edge(1,3),edge(3,2)]},adj=buildAdj(network),shades=network.edges.map(()=>0),uses=r=>r.path.some(part=>part.i===1);
for(const mobilityProfile of ['standard','wheelchair','vision','custom'])assert(!uses(route(network,adj,shades,[1,0],[19,0],{mobilityProfile})),`${mobilityProfile} must avoid a blocked edge`);
const far={nodes:[[0,0],[10,0],[100,0]],edges:[]};far.edges=[{...edge(0,1),c:[far.nodes[0],far.nodes[1]]},{...edge(0,1),a:1,b:2,c:[far.nodes[1],far.nodes[2]],l:90,accessBlocked:true}];
const blockedOnly=bestAvailableRoute(far,buildAdj(far),[0,0],[1,0],[99,0],{mobilityProfile:'wheelchair'}).result;
// Like the server, the wider search ends at the nearest allowed way (89 m away) instead of crossing the block.
// Orange like the server: a relaxed wheelchair route over the only stairs flags exactly that piece.
const stairs={nodes:[[0,0],[10,0],[200,0]],edges:[]};stairs.edges=[{...edge(0,1),c:[stairs.nodes[0],stairs.nodes[1]]},{...edge(1,2),c:[stairs.nodes[1],stairs.nodes[2]],l:190,steps:true}];
const relaxed=bestAvailableRoute(stairs,buildAdj(stairs),[0,0],[1,0],[199,0],{mobilityProfile:'wheelchair'}).result;
assert.equal(relaxed.relaxedCriteria.at(-1),'steps');assert.deepEqual(relaxed.warnings.map(w=>w.reasons),[['steps']]);assert.equal(relaxed.snapWidened,false);
assert(!blockedOnly.error&&!blockedOnly.path.some(part=>part.i===1),'neither snapping nor relaxation may use an access block');assert(blockedOnly.snapWidened&&Math.round(blockedOnly.snapDistances[1])===89,'the destination snaps to the nearest allowed way');

// Worker: the real city load marks exactly the declared edges.
globalThis.self={postMessage:message=>messages.push(message)};const messages=[];
globalThis.fetch=async url=>{const file=new URL(String(url));const bytes=fs.readFileSync(file);return {ok:true,arrayBuffer:async()=>bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),json:async()=>JSON.parse(bytes)};};
await import('./worker.mjs');
await self.onmessage({data:{type:'initCity',manifest,base:root.href}});
const local=p=>[(p[0]-manifest.origin[0])*manifest.scale[0],(p[1]-manifest.origin[1])*manifest.scale[1]];
await self.onmessage({data:{type:'route',id:1,start:local([9.17935,48.77845]),end:local([9.1661,48.7705]),options:{mobilityProfile:'standard',preference:'balanced'}}});
const result=messages.at(-1).result;assert(!result.error,JSON.stringify(result.error));
// The browser routes on the server's own graph, which leaves blocked ways out entirely.
assert(manifest.routingNetwork?.source?.graph.startsWith('routing.walk_edges')&&manifest.routingNetwork.edgeCount>200000,'browser routing uses the exported server graph');
assert(result.path.every(part=>part.i<manifest.routingNetwork.edgeCount));
console.log(`Access blocks passed: ${count} edges from the audited server graph, OSM-checked samples, hard filter for every profile, no relaxation, real worker load.`);
