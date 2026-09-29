import assert from 'node:assert/strict';
import {buildAdj,route} from './core.mjs';

const nodes=[[0,0],[10,0],[20,0],[10,10],[20,10],[30,0]];
const edge=(a,b,extras={})=>({a,b,c:[nodes[a],nodes[b]],l:Math.hypot(nodes[b][0]-nodes[a][0],nodes[b][1]-nodes[a][1]),s:0,sf:0,dz:0,z0:250,z1:250,steps:false,escalator:false,dir:0,surface:1,way:1,width:1.8,wheelchair:1,bench:50,shelter:100,crossing:0,...extras});
const network={nodes,edges:[
 edge(0,1),edge(1,2,{steps:true}),edge(2,5),
 edge(1,3),edge(3,4),edge(4,5),
]};
const adj=buildAdj(network),shades=network.edges.map(()=>0),indices=result=>result.path.map(part=>part.i);

assert(indices(route(network,adj,shades,[1,0],[29,0],{mobilityProfile:'standard'})).includes(1));
assert(!indices(route(network,adj,shades,[1,0],[29,0],{mobilityProfile:'wheelchair'})).includes(1));
for (const preference of ['shade','sun']) {
  const extremeShades=network.edges.map((_,index)=>index===1?(preference==='shade'?1:0):(preference==='shade'?0:1));
  const wheelchairRoute=route(network,adj,extremeShades,[1,0],[29,0],{mobilityProfile:'wheelchair',preference});
  assert(!indices(wheelchairRoute).includes(1),`${preference} must never override wheelchair stair exclusion`);
}

network.edges[1].steps=false;
network.edges[1].escalator=true;
assert(!indices(route(network,adj,shades,[1,0],[29,0],{mobilityProfile:'stroller'})).includes(1));

const indexed={...network,snapGrid:500,snapIndex:{'0_0':[0,1,2,3,4,5]}};
assert(!route(indexed,adj,shades,[1,1],[29,1],{mobilityProfile:'standard'}).error);

console.log('Mobility profile and indexed snapping verification passed');
