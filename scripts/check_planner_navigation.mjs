import fs from 'node:fs';import assert from 'node:assert/strict';
import {plannerMatches,plannerMapFilter,plannerSummary} from './planner.mjs';
import {routeManeuvers,locateOnRoute,turnKind} from './navigation.mjs';
import {routeMeasure} from './route-experience.mjs';

// Filter rule: |slope| strictly above the threshold; stairs and missing values only on request.
const state={districts:new Set([11,21]),slope:true,min:5,missing:true,stairs:false};
assert.equal(plannerMatches({d:11,sl:5,steps:0},state),false);
assert.equal(plannerMatches({d:11,sl:5.1,steps:0},state),true);
assert.equal(plannerMatches({d:11,sl:-1,steps:0},state),true);
assert.equal(plannerMatches({d:11,sl:-1,steps:0},{...state,missing:false}),false);
assert.equal(plannerMatches({d:11,sl:20,steps:1},state),false);
assert.equal(plannerMatches({d:11,sl:20,steps:1},{...state,stairs:true}),true);
assert.equal(plannerMatches({d:1,sl:20,steps:0},state),false);
assert.equal(plannerMatches({d:1,sl:2,steps:0},{...state,districts:new Set(),slope:false}),true);
assert.equal(JSON.stringify(plannerMapFilter(state)).includes('"literal",[11,21]'),true);

// Data contract and the first complete test case: Wangen and Hedelfingen above 5 %.
const index=JSON.parse(fs.readFileSync('dist/city/planner/districts.json','utf8'));
assert.equal(index.districts.length,23);assert.equal(index.boundaries.features.length,23);assert.equal(index.slopeCap,30);
const features=[];
for(const district of index.districts){
 const data=JSON.parse(fs.readFileSync('dist/city/planner/'+district.file,'utf8'));
 assert.equal(data.lines.length,district.pieces);
 data.v.forEach((v,i)=>{assert(v[0]===null||data.k[i]&1||(v[0]>=0&&v[0]<=30),'Non-stair gradients above 30 % must be removed');features.push({properties:{d:district.id,sl:v[0]??-1,steps:data.k[i]&1,m:data.m[i]}});});
}
const summary=plannerSummary(features,state);
assert.equal(summary.pieces,710);assert.equal(summary.missing,16);assert.equal(summary.perDistrict.get(11),493);assert.equal(summary.perDistrict.get(21),217);
assert.equal(plannerSummary(features,{...state,min:30}).pieces,summary.missing,'Only gaps remain when nothing is steeper than the cap');

// Directions: one right turn on an L-shaped route, then arrival; position projection.
assert.equal(turnKind(90),'right');assert.equal(turnKind(-45),'slightLeft');assert.equal(turnKind(10),null);
const coords=[[0,0],[0,50],[0,100],[50,100],[100,100]],maneuvers=routeManeuvers(coords);
assert.deepEqual(maneuvers.map(m=>m.kind),['right','arrive']);assert.equal(maneuvers[0].at,100);
const place=locateOnRoute(routeMeasure(coords),[60,108]);assert.equal(Math.round(place.along),160);assert.equal(Math.round(place.distance),8);
console.log(`Planner and navigation verified: test case Wangen + Hedelfingen > 5 % = ${summary.pieces} sections (${summary.missing} without value), directions and route projection.`);
