import assert from 'node:assert/strict';
import {handleRouting} from '../services/routing-proxy.mjs';
import worker from '../services/weather-worker.mjs';
const query='start_lon=9.18&start_lat=48.78&end_lon=9.19&end_lat=48.77&profile=shortest&max_snap_m=50&include_segments=true';
const url='https://sonnenpfad-stuttgart.de/api/route?'+query;
const fixture={type:'FeatureCollection',features:[],properties:{profile:'shortest',segment_metadata_version:1,segments:[]}};
let calls=0,seen;
const fetchImpl=async(upstream,options)=>{calls++;seen={upstream,options};return Response.json(fixture,{headers:{'Set-Cookie':'upstream-cookie=private','Access-Control-Allow-Origin':'*'}});};
const response=await handleRouting(new Request(url,{headers:{Cookie:'session=private',Authorization:'Bearer private',Origin:'https://untrusted.example'}}),{fetchImpl});
assert.equal(response.status,200);assert.deepEqual(await response.json(),fixture);
assert.equal(seen.upstream.origin,'https://138.2.184.1');assert.equal(seen.upstream.pathname,'/route');
assert.equal(seen.upstream.searchParams.get('include_segments'),'true');
assert.deepEqual(seen.options.headers,{Accept:'application/json'});assert.equal(seen.options.redirect,'error');assert.equal(seen.options.credentials,'omit');
assert.equal(response.headers.get('Cache-Control'),'no-store');assert.equal(response.headers.get('Set-Cookie'),null);assert.equal(response.headers.get('Access-Control-Allow-Origin'),null);
for(const bad of [query+'&url=https://example.com',query+'&start_lon=9.2',query.replace('9.18','NaN'),query.replace('9.18',''),query.replace('9.18','0'),query.replace('48.78','90'),query.replace('max_snap_m=50','max_snap_m=100'),query.replace('shortest','wheelchair'),query.replace('include_segments=true','include_segments=false')]){
 const before=calls,r=await handleRouting(new Request(url.split('?')[0]+'?'+bad),{fetchImpl});assert.equal(r.status,400);assert.equal(calls,before);
}
assert.equal((await handleRouting(new Request(url,{method:'POST'}),{fetchImpl})).status,405);
const upstreamError=async status=>Response.json({detail:status===404?'No edge within 50m':'secret internal database details'},{status});
for(const [status,expected] of [[404,404],[429,429],[500,502],[503,503]]){
 const r=await handleRouting(new Request(url),{fetchImpl:()=>upstreamError(status)});assert.equal(r.status,expected);assert.equal((await r.text()).includes('secret'),false);
}
const disconnected=await handleRouting(new Request(url),{fetchImpl:()=>Response.json({detail:'No connection'},{status:404})});assert.equal((await disconnected.json()).detail,'No pedestrian connection between the snapped points');
for(const make of [()=>new Response('<html>failure</html>'),()=>new Response('{bad',{headers:{'Content-Type':'application/json'}}),()=>Response.json({type:'FeatureCollection'}),()=>Response.json(fixture,{headers:{'Content-Length':String(9*1024*1024)}})])assert.equal((await handleRouting(new Request(url),{fetchImpl:async()=>make()})).status,502);
const aborted=await handleRouting(new Request(url),{timeoutMs:5,fetchImpl:async(_url,{signal})=>new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(Error('aborted')),{once:true}))});assert.equal(aborted.status,504);
const previousFetch=globalThis.fetch;let assetsRequested=false;
try{globalThis.fetch=fetchImpl;const routed=await worker.fetch(new Request(url),{ASSETS:{fetch(){assetsRequested=true;}}},{});assert.equal(routed.status,200);assert.equal(assetsRequested,false);}finally{globalThis.fetch=previousFetch;}
assert.equal((await handleRouting(new Request(url),{fetchImpl})).status,200);assert.ok(calls>=3);
console.log('Routing proxy checks passed: same-origin dispatch, fixed upstream, contract validation, no credential forwarding/cache, safe errors, malformed/oversized responses and timeout.');
