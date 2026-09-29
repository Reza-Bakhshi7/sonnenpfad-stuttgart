import assert from 'node:assert/strict';
import {buildAdj,route} from './core.mjs';

const edge=(a,b,c,l,sf)=>({a,b,c,l,s:Math.abs(sf??8),sf,sq:sf===null?2:0,dz:sf===null?0:sf*l/100,z0:250,z1:sf===null?250:250+sf*l/100,steps:false,dir:0});
const nodes=[[0,0],[5,0],[10,0],[10,10],[20,0],[25,0]];
const network={nodes,edges:[
 edge(0,1,[nodes[0],nodes[1]],5,0),
 edge(1,2,[nodes[1],nodes[2]],5,12),edge(2,4,[nodes[2],nodes[4]],10,12),
 edge(1,3,[nodes[1],nodes[3]],12,-12),edge(3,4,[nodes[3],nodes[4]],12,-12),
 edge(4,5,[nodes[4],nodes[5]],5,0),
]};
const adj=buildAdj(network),shades=network.edges.map(()=>0),edgeSet=result=>result.path.map(part=>part.i).sort((a,b)=>a-b);

assert.deepEqual(edgeSet(route(network,adj,shades,[1,0],[24,0],{slopeMode:'none'})),[0,1,2,5]);
assert.deepEqual(edgeSet(route(network,adj,shades,[1,0],[24,0],{slopeMode:'uphill'})),[0,3,4,5]);
assert.deepEqual(edgeSet(route(network,adj,shades,[1,0],[24,0],{slopeMode:'downhill'})),[0,1,2,5]);
assert.deepEqual(edgeSet(route(network,adj,shades,[24,0],[1,0],{slopeMode:'uphill'})),[0,1,2,5]);
assert.deepEqual(edgeSet(route(network,adj,shades,[24,0],[1,0],{slopeMode:'downhill'})),[0,3,4,5]);

const unknown={nodes,edges:[
 edge(0,1,[nodes[0],nodes[1]],5,0),
 edge(1,2,[nodes[1],nodes[2]],5,null),edge(2,4,[nodes[2],nodes[4]],10,null),
 edge(1,3,[nodes[1],nodes[3]],12,0),edge(3,4,[nodes[3],nodes[4]],12,0),
 edge(4,5,[nodes[4],nodes[5]],5,0),
]};
assert.deepEqual(edgeSet(route(unknown,buildAdj(unknown),unknown.edges.map(()=>0),[1,0],[24,0],{slopeMode:'uphill'})),[0,3,4,5]);
console.log('Directional slope verification passed');
