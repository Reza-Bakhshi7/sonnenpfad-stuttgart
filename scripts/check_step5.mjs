import assert from 'node:assert/strict';
import fs from 'node:fs';
import {buildAdj,route} from './core.mjs';

const nodes=[[0,0],[20,0],[40,0],[20,20],[40,20],[60,0]];
const makeEdge=(a,b,extras={})=>({
 a,b,c:[nodes[a],nodes[b]],l:Math.hypot(nodes[b][0]-nodes[a][0],nodes[b][1]-nodes[a][1]),
 s:0,sf:0,dz:0,z0:250,z1:250,steps:false,escalator:false,dir:0,surface:1,way:1,
 width:1.8,wheelchair:1,bench:50,shelter:100,crossing:0,tactile:false,handrail:false,...extras,
});
const buildNetwork=barrier=>({nodes,edges:[
 makeEdge(0,1),makeEdge(1,2,barrier),makeEdge(2,5),
 makeEdge(1,3),makeEdge(3,4),makeEdge(4,5),
]});
const edgeIds=result=>result.path.map(part=>part.i);
const routeFor=(barrier,profile='wheelchair')=>{
 const network=buildNetwork(barrier);
 return route(network,buildAdj(network),network.edges.map(()=>0),[1,0],[59,0],{mobilityProfile:profile});
};

for(const barrier of [
 {steps:true},
 {escalator:true},
 {surface:3},
 {wheelchair:3},
 {width:.8},
 {sf:7,s:7,dz:1.4,z1:251.4},
]) assert(!edgeIds(routeFor(barrier)).includes(1),`wheelchair route used known barrier ${JSON.stringify(barrier)}`);

const unknownNetwork={nodes:nodes.slice(0,3),edges:[makeEdge(0,1),makeEdge(1,2,{sf:null,s:8,dz:0})]};
assert(!route(unknownNetwork,buildAdj(unknownNetwork),[0,0],[1,0],[39,0],{mobilityProfile:'wheelchair'}).error,'unknown slope must stay routable');
const visionNetwork={nodes:nodes.slice(0,3),edges:[makeEdge(0,1),makeEdge(1,2,{steps:true,handrail:true,tactile:true})]};
const visionRoute=route(visionNetwork,buildAdj(visionNetwork),[0,0],[1,0],[39,0],{mobilityProfile:'vision'});
assert(!visionRoute.error&&visionRoute.steps===1,'vision profile must not categorically exclude stairs');

const assessedNetwork={nodes:nodes.slice(0,3),edges:[makeEdge(0,1),makeEdge(1,2,{surface:0,width:0,wheelchair:0,sf:null})]};
const assessed=route(assessedNetwork,buildAdj(assessedNetwork),[0,0],[1,0],[39,0],{mobilityProfile:'wheelchair'});
assert(!assessed.error);
assert.equal(assessed.criteria.maxSlope,6);
assert.equal(assessed.criteria.minWidth,.9);
assert(assessed.quality.surfaceKnown<1&&assessed.quality.widthKnown<1&&assessed.quality.wheelchairKnown<1);

const blockedNodes=[[0,0],[100,0],[110,0],[210,0]];
const blocked={nodes:blockedNodes,edges:[
 {a:0,b:1,c:[blockedNodes[0],blockedNodes[1]],l:100,s:0,sf:0,dz:0,z0:250,z1:250,steps:false,escalator:false,dir:0,surface:1,way:1,width:1.5,wheelchair:1},
 {a:1,b:2,c:[blockedNodes[1],blockedNodes[2]],l:10,s:0,sf:0,dz:0,z0:250,z1:250,steps:true,escalator:false,dir:0,surface:1,way:1,width:1.5,wheelchair:3},
 {a:2,b:3,c:[blockedNodes[2],blockedNodes[3]],l:100,s:0,sf:0,dz:0,z0:250,z1:250,steps:false,escalator:false,dir:0,surface:1,way:1,width:1.5,wheelchair:1},
]};
assert.equal(route(blocked,buildAdj(blocked),[0,0,0],[1,0],[209,0],{mobilityProfile:'wheelchair',maxSnap:20}).error,'profileBlocked');
assert.equal(route(blocked,buildAdj(blocked),[0,0,0],[-500,0],[209,0],{mobilityProfile:'wheelchair',maxSnap:20}).error,'outside');

const app=fs.readFileSync('scripts/app.source.mjs','utf8');
const html=fs.readFileSync('dist/index.html','utf8');
for(const token of ['profileBlocked','renderRouteAssessment','poor-surface','wheelchair-no','max-slope','min-width'])assert(app.includes(token)||html.includes(token),`missing Step 5 token ${token}`);
assert(html.includes('route-assessment'),'route assessment panel missing');
console.log('Step 5 routing profiles and accessibility verification passed');
