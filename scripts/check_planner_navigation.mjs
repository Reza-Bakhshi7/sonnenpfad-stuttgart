import fs from 'node:fs';import assert from 'node:assert/strict';
import {featureFilter} from '@maplibre/maplibre-gl-style-spec';
import {filterMatches,analysisMatches,analysisMapFilter,analysisSummary,encodeAnalysis,decodeAnalysis,exportColumns,exportRow,csvText} from './planner.mjs';
import {routeManeuvers,locateOnRoute,turnKind} from './navigation.mjs';
import {routeMeasure} from './route-experience.mjs';

// Filter rules: numeric comparisons, categories include/exclude, missing values only on request.
const slope={key:'slope',type:'number',op:'gt',value:5,missing:true},noStairs={key:'stairs',type:'category',mode:'exclude',codes:new Set(['yes']),missing:false};
assert.equal(filterMatches({x_slope:5},slope),false);assert.equal(filterMatches({x_slope:5.1},slope),true);
assert.equal(filterMatches({},slope),true);assert.equal(filterMatches({},{...slope,missing:false}),false);
assert.equal(filterMatches({x_slope:7},{...slope,op:'between',value:8,value2:6}),true);assert.equal(filterMatches({x_slope:5},{...slope,op:'eq'}),true);
assert.equal(filterMatches({c_stairs:'yes'},noStairs),false);assert.equal(filterMatches({c_stairs:'no'},noStairs),true);
assert.equal(filterMatches({c_surface:'sett'},{key:'surface',type:'category',mode:'include',codes:new Set(['sett','gravel']),missing:false}),true);

// Data contract: schema, districts and every feature as the browser builds it.
const index=JSON.parse(fs.readFileSync('dist/city/planner/districts.json','utf8')),schema=index.attributes;
assert.equal(index.version,2);assert.equal(index.districts.length,23);assert.equal(index.slopeCap,30);
assert(schema.some(a=>a.key==='slope'&&a.type==='number')&&schema.some(a=>a.key==='surface'&&a.type==='category'));
const features=[];
for(const district of index.districts){
 const data=JSON.parse(fs.readFileSync('dist/city/planner/'+district.file,'utf8')),counter=new Map();
 assert.equal(data.lines.length,district.pieces);
 data.lines.forEach((coordinates,i)=>{
  const p={d:district.id,dn:district.name,m:data.n.length[i],a:data.a[i],nm:data.nm[i]};counter.set(p.a,(counter.get(p.a)||0)+1);p.sid=`${p.d}-${p.a}-${counter.get(p.a)}`;
  for(const a of schema){if(a.type==='number'){const v=data.n[a.key][i];if(v!==null)p['x_'+a.key]=v;}else{const code=data.c[a.key][i];if(code!==null)p['c_'+a.key]=a.categories[code].code;}}
  assert(p.x_slope===undefined||p.c_stairs==='yes'||(p.x_slope>=0&&p.x_slope<=30),'Non-stair gradients above 30 % must be removed');
  features.push({type:'Feature',geometry:{type:'LineString',coordinates},properties:p});
 });
}
assert.equal(new Set(features.map(f=>f.properties.sid)).size,features.length,'segment ids are unique');

// First complete test case: Wangen and Hedelfingen above 5 %, without stairs, gaps shown.
const testCase={districts:new Set([11,21]),filters:[slope,noStairs]},summary=analysisSummary(features,testCase);
assert.equal(summary.pieces,710);assert.equal(summary.missing,16);assert.equal(summary.perDistrict.get(11),493);assert.equal(summary.perDistrict.get(21),217);
assert(summary.share>0&&summary.share<1);

// Combined planner query (Nord + Mitte): gradient > 5 %, no stairs, poor surface, noise > 65 dB, little summer shade.
const combined={districts:new Set([1,2]),filters:[{...slope,missing:false},noStairs,{key:'surfaceQuality',type:'category',mode:'include',codes:new Set(['poor']),missing:false},{key:'noise',type:'number',op:'gt',value:65,missing:false},{key:'shadeSummer',type:'number',op:'lt',value:20,missing:false}]};
const combinedSummary=analysisSummary(features,combined);
// The map shows exactly what is counted and exported: the MapLibre expression equals the JS rule.
for(const state of [testCase,combined,{districts:new Set(),filters:[{key:'width',type:'number',op:'between',value:1,value2:2,missing:false},{key:'lit',type:'category',mode:'exclude',codes:new Set(['no']),missing:true}]}]){
 const filter=featureFilter(analysisMapFilter(state),'layers[0].filter');
 const mismatch=features.filter(f=>filter.filter({zoom:15},{type:2,properties:f.properties,geometry:[]})!==analysisMatches(f.properties,state));
 assert.equal(mismatch.length,0,'map filter and counts disagree');
}
// Shared links reproduce the analysis.
const decoded=decodeAnalysis(encodeAnalysis(combined),schema);assert.equal(analysisSummary(features,{districts:combined.districts,filters:decoded}).pieces,combinedSummary.pieces);

// Export: one row per matching section, stable columns, WKT geometry, CRS, UTF-8 BOM.
const columns=exportColumns(schema),rows=features.filter(f=>analysisMatches(f.properties,testCase)).map(f=>exportRow(f.properties,f.geometry.coordinates,schema));
assert.equal(rows.length,710);assert(rows.every(row=>row.length===columns.length));
assert(columns.includes('slope_pct')&&columns.includes('surface_quality')&&columns.includes('geometry_wkt')&&columns.at(-1)==='crs');
assert(/^LINESTRING\(9\.\d+ 48\.\d+, /.test(rows[0][columns.indexOf('geometry_wkt')]));assert.equal(rows[0].at(-1),'EPSG:4326');
const csv=csvText([columns,...rows]);assert(csv.startsWith('﻿segment_id,atlas_id,district_id,district,name,'));assert.equal(csv.trim().split('\r\n').length,711);

// Directions: one right turn on an L-shaped route, then arrival; position projection.
assert.equal(turnKind(90),'right');assert.equal(turnKind(-45),'slightLeft');assert.equal(turnKind(10),null);
const coords=[[0,0],[0,50],[0,100],[50,100],[100,100]],maneuvers=routeManeuvers(coords);
assert.deepEqual(maneuvers.map(m=>m.kind),['right','arrive']);assert.equal(maneuvers[0].at,100);
const place=locateOnRoute(routeMeasure(coords),[60,108]);assert.equal(Math.round(place.along),160);assert.equal(Math.round(place.distance),8);
console.log(`Analysis and navigation verified: test case Wangen + Hedelfingen > 5 % = ${summary.pieces} sections (${summary.missing} without value, ${(summary.share*100).toFixed(1)} % of the network); combined Nord + Mitte query = ${combinedSummary.pieces} sections, ${(combinedSummary.metres/1000).toFixed(2)} km; map filter identical to counts; export rows and directions checked.`);
