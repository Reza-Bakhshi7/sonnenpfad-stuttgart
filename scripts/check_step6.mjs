import assert from 'node:assert/strict';
import fs from 'node:fs';
import {buildAdj,route} from './core.mjs';
import {normalizeWeather,weatherAt,weatherCodeGroup,weatherUrl} from './weather.mjs';

const payload={latitude:48.78,longitude:9.18,elevation:250,timezone:'Europe/Berlin',hourly:{
 time:['2026-10-01T10:00','2026-10-01T11:00'],temperature_2m:[15,16],apparent_temperature:[14,15],weather_code:[3,1],cloud_cover:[95,35],wind_speed_10m:[8,10],wind_direction_10m:[240,250],wind_gusts_10m:[18,20],direct_radiation:[20,400],shortwave_radiation:[100,500],terrestrial_radiation:[500,600],
}};
const model=normalizeWeather(payload,Date.parse('2026-10-01T09:55:00Z')),cloudy=weatherAt(model,'2026-10-01',10*60),brighter=weatherAt(model,'2026-10-01',11*60);
assert.equal(cloudy.solarWeight,.04);
assert.equal(brighter.solarWeight,.8);
assert.equal(weatherAt(model,'2026-10-02',12*60),null);
assert.equal(weatherCodeGroup(3),'overcast');
assert.equal(weatherCodeGroup(63),'rain');
assert(weatherUrl().searchParams.get('timezone')==='Europe/Berlin');

const nodes=[[0,0],[10,0],[90,0],[100,0],[10,40],[90,40]],edge=(a,b)=>({a,b,c:[nodes[a],nodes[b]],l:Math.hypot(nodes[b][0]-nodes[a][0],nodes[b][1]-nodes[a][1]),s:0,sf:0,dz:0,z0:250,z1:250,steps:false,escalator:false,dir:0,surface:1,way:1,width:2,wheelchair:1});
const network={nodes,edges:[edge(0,1),edge(1,2),edge(2,3),edge(1,4),edge(4,5),edge(5,2)]},adj=buildAdj(network),shades=[0,0,0,1,1,1];
const sunny=route(network,adj,shades,[1,0],[99,0],{preference:'shade',solarWeight:1});
const overcast=route(network,adj,shades,[1,0],[99,0],{preference:'shade',solarWeight:0});
assert(!sunny.path.some(part=>part.i===1),'strong direct sun should favour shaded detour');
assert(overcast.path.some(part=>part.i===1),'zero direct sun should reduce the preference to direct distance');

const app=fs.readFileSync('scripts/app.source.mjs','utf8'),html=fs.readFileSync('dist/index.html','utf8');
for(const token of ['loadWeather','selectedWeather','solarWeight','weatherRetrieved','weatherFallback'])assert(app.includes(token),`missing Step 6 token ${token}`);
for(const token of ['weather-strip','weather-radiation','weather-wind'])assert(html.includes(token),`missing Step 6 UI ${token}`);
for(const token of ['cityShadeTileCache','includeShade:is3D','routeAware:true','setTimeout(()=>requestShade(false,{silent:true}),650)'])assert(app.includes(token),`missing performance token ${token}`);
assert(!html.includes('time-play'), 'time animation controls must stay removed');
assert(app.includes("layout:{visibility:'none'},paint:{'raster-opacity':.34"), '2D shade layer must start hidden');
console.log('Step 6 live weather and cloud-aware routing verification passed');
