import fs from 'node:fs';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {buildProfileV1Request,supportsProfileV1,requestProfileV1,adaptProfileV1Route} from './profile-routing-v1.mjs';

const capabilities={profile_contract_version:1,segment_metadata_version:1,topology:'audited-osm-nodes',mobility_profiles:['standard','wheelchair','powerWheelchair'],preferences:['balanced'],strict_by_default:true,explicit_relaxation:true,production_ready:false,deployment_stage:'local-preview',shadow_model:null};
const requests=['standard','wheelchair','powerWheelchair'].map(mobilityProfile=>buildProfileV1Request([9,48],[9.001,48],{preference:'balanced',mobilityProfile,solarWeight:.5}));
for(const request of requests){assert(!supportsProfileV1(capabilities,request),'preview capabilities must never enable production');assert(supportsProfileV1(capabilities,request,{preview:true}));assert.equal(request.allow_relaxation,false);}
assert(!supportsProfileV1({...capabilities,deployment_stage:'unknown'},requests[0],{preview:true}));

// Execute the real Python validator and response adapter, then consume those
// responses through the real JavaScript geometry/profile adapter.
const bridge=String.raw`
import json,sys
from app import validate_contract,adapt_response,core
from sonnenpfad_profile_rules import resolved_options
results=[]
for body in json.load(sys.stdin):
 request=validate_contract(body)
 options=resolved_options({'mobilityProfile':request['mobility_profile'],'preference':'balanced'})
 attributes={'elev_start':200,'elev_end':210,'surface_class':'good','width':None,'wheelchair':None,'fclass':'footway','routing_osm_tags':{}}
 segments=[{'length_m':100,'atlas_t0':0,'atlas_t1':1,'atlas_fid':1,'atlas_attributes':attributes,'geometry':{'type':'LineString','coordinates':[[9,48],[9.001,48]]}}]
 metrics=core.route_metrics(segments,options)
 data={'type':'FeatureCollection','features':[{'type':'Feature','properties':{},'geometry':segments[0]['geometry']}],'properties':dict(**metrics,requested_profile=request['mobility_profile'],effective_options=options,relaxed_criteria=[],fallback_level=0,segments=segments,segment_metadata_version=1,snapped_start=[9,48],snapped_end=[9.001,48],start_snap_distance_m=0,end_snap_distance_m=0,calculation_ms=1)}
 results.append(adapt_response(data,request))
print(json.dumps(results,allow_nan=False))
`;
const python=process.env.ORACLE_REVIEW_PYTHON||'python3';
const output=spawnSync(python,['-B','-c',bridge],{cwd:new URL('../services/profile-api-v1/',import.meta.url),input:JSON.stringify(requests),encoding:'utf8'});
assert.equal(output.status,0,output.stderr);const responses=JSON.parse(output.stdout),local=p=>[(p[0]-9)*100000,(p[1]-48)*100000];
for(let i=0;i<requests.length;i++){
 const route=adaptProfileV1Route(responses[i],local,requests[i]);assert.equal(route.length,100);assert.equal(route.ascent,10);assert.equal(route.quality.wheelchairKnown,0);assert.equal(route.quality.widthKnown,0);assert.equal(route.timeModel.speedMpm,i===1?60:75);assert.equal(route.minutes,i===1?4:i===2?2:3);assert.deepEqual(route.relaxedCriteria,[]);
 const tampered=structuredClone(responses[i]);tampered.properties.effective_options.avoidSteps=false;assert.throws(()=>adaptProfileV1Route(tampered,local,requests[i]),/effective profile/);
}
const unknown=structuredClone(responses[1]);Object.assign(unknown.properties,{estimated_minutes:null,ascent_m:null,descent_m:null,elevation_profile:[],attribute_coverage:{surface:1,width:0,wheelchair:0,elevation:0}});unknown.properties.segments[0].atlas_attributes.elev_start=null;
assert.equal(adaptProfileV1Route(unknown,local,requests[1]).minutes,null);

let posted;
await requestProfileV1([9,48],[9.001,48],{preference:'balanced',mobilityProfile:'wheelchair'},{baseURL:'http://127.0.0.1:8002/',preview:true,capabilities,fetchImpl:async(url,options)=>{assert.equal(url.pathname,'/v1/route');posted=JSON.parse(options.body);return {ok:true,json:async()=>responses[1]};}});
assert.equal(posted.allow_relaxation,false);assert.equal(posted.contract_version,1);
await assert.rejects(requestProfileV1([9,48],[9.001,48],{preference:'balanced',mobilityProfile:'wheelchair'},{baseURL:'http://127.0.0.1:8002/',preview:true,capabilities,fetchImpl:async()=>({ok:false,status:409,json:async()=>({error:'candidate_search_limited'})})}),error=>error.routeError==='serverSearchLimited');
const bundle=fs.readFileSync(new URL('../scripts/build-cloudflare.mjs',import.meta.url),'utf8');assert.equal(bundle.match(/profile-routing-v1/g)?.length,1,'the adapter enters only the worker source');
const {profileApiFor}=await import('./route-experience.mjs');
for(const host of ['sonnenpfad-stuttgart.de','sonnenpfad-stuttgart.mohammadreza-bakhshi.workers.dev'])assert.equal(profileApiFor(host),null,'production never uses the preview API');
assert.equal(profileApiFor('server-routing-preview-sonnenpfad-stuttgart.mohammadreza-bakhshi.workers.dev'),'https://138.2.184.1/profile-v2/');
console.log('Profile V1 passed: Python/JS requests and actual response parity, profile times, unknown data, strict capability gate, no silent relaxation, preview-only server routing.');
