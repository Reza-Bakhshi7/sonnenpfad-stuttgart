import * as maplibregl from './vendor/maplibre-gl.mjs';
let THREE;
maplibregl.setWorkerUrl(new URL('./vendor/maplibre-gl-worker.mjs',import.meta.url).href);
function parseCityManifest(text) {
  let manifest;
  try {
    manifest = JSON.parse(text);
  } catch {
    return null;
  }

  const numberArray = (value, length) =>
    Array.isArray(value) && value.length === length && value.every(Number.isFinite);
  const network = manifest?.network;
  const obstacles = manifest?.obstacles;
  const assetList = value => typeof value === 'string' || (Array.isArray(value) && value.length > 0 && value.every(item => typeof item === 'string'));
  const tileList = obstacles?.tiles && typeof obstacles.tiles === 'object' && !Array.isArray(obstacles.tiles);
  const validTiles = tileList && Object.values(obstacles.tiles).every(tile =>
    tile && typeof tile === 'object' &&
    (typeof tile.file === 'string' || (typeof tile.displayFile === 'string' && typeof tile.shadeFile === 'string'))
  );
  if (
    manifest?.version !== 5 ||
    manifest?.scope !== 'city' ||
    !numberArray(manifest.origin, 2) ||
    !numberArray(manifest.scale, 2) ||
    !numberArray(manifest.bounds, 4) ||
    !assetList(network?.nodes) ||
    !Number.isInteger(network?.nodeCount) || network.nodeCount <= 0 ||
    !assetList(network?.edges) ||
    !Number.isInteger(network?.edgeCount) || network.edgeCount <= 0 ||
    !assetList(network?.snapIndex) ||
    !Number.isFinite(obstacles?.grid) || obstacles.grid <= 0 ||
    !validTiles ||
    !Array.isArray(manifest.themes) || manifest.themes.length !== 8 ||
    !manifest.poiTypes || Object.keys(manifest.poiTypes).length !== 10
  ) return null;

  return manifest;
}

const WEATHER_ENDPOINT='https://api.open-meteo.com/v1/forecast';
const WEATHER_CACHE_KEY='sonnenpfad.weather.stuttgart.v2';
const WEATHER_CACHE_MS=10*60*1000;
const WEATHER_STALE_MS=48*60*60*1000;
const clamp=(value,min=0,max=1)=>Math.max(min,Math.min(max,value));
const number=value=>typeof value==='number'&&Number.isFinite(value)?value:null;

function weatherUrl({dwd=false}={}){
 const url=new URL(dwd?'https://api.open-meteo.com/v1/dwd-icon':WEATHER_ENDPOINT);
 url.search=new URLSearchParams({latitude:'48.778',longitude:'9.180',timezone:'Europe/Berlin',past_days:'1',forecast_days:dwd?'5':'7',hourly:['temperature_2m','apparent_temperature','weather_code','cloud_cover','wind_speed_10m','wind_direction_10m','wind_gusts_10m','direct_radiation','shortwave_radiation','terrestrial_radiation'].join(',')});return url;
}

function normalizeWeather(payload,retrievedAt=Date.now()){
 if(payload?.version===2&&Array.isArray(payload.rows)){
  if(!payload.rows.some(row=>/^\d{4}-\d\d-\d\dT\d\d:\d\d/.test(row.time)&&Number.isFinite(row.temperature))||!Number.isFinite(payload.retrievedAt))throw Error('weather-contract');return payload;
 }
 const hourly=payload?.hourly,times=hourly?.time;if(!Array.isArray(times)||!times.length)throw Error('weather-contract');
 const rows=times.map((time,index)=>({time,temperature:number(hourly.temperature_2m?.[index]),apparentTemperature:number(hourly.apparent_temperature?.[index]),weatherCode:number(hourly.weather_code?.[index]),cloudCover:number(hourly.cloud_cover?.[index]),windSpeed:number(hourly.wind_speed_10m?.[index]),windDirection:number(hourly.wind_direction_10m?.[index]),windGust:number(hourly.wind_gusts_10m?.[index]),directRadiation:number(hourly.direct_radiation?.[index]),shortwaveRadiation:number(hourly.shortwave_radiation?.[index]),terrestrialRadiation:number(hourly.terrestrial_radiation?.[index])})).filter(row=>Number.isFinite(row.temperature));
 if(!rows.length)throw Error('weather-contract');return {version:2,retrievedAt,source:'Open-Meteo',licence:'CC BY 4.0',radiationBasis:'model',resolutionMinutes:60,latitude:payload.latitude,longitude:payload.longitude,elevation:payload.elevation,timezone:payload.timezone||'Europe/Berlin',rows};
}

function normalizeMetWeather(payload,retrievedAt=Date.now()) {
 const times=payload?.properties?.timeseries;if(!Array.isArray(times)||!times.length)throw Error('met-weather-contract');
 const formatter=new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Berlin',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
 const code=symbol=>symbol?.includes('thunder')?95:symbol?.includes('snow')||symbol?.includes('sleet')?73:symbol?.includes('rain')?63:symbol?.includes('fog')?45:symbol?.includes('partlycloudy')?2:symbol?.includes('fair')?1:symbol?.includes('clearsky')?0:3;
 const rows=times.map(item=>{const d=item.data?.instant?.details||{},symbol=(item.data?.next_1_hours||item.data?.next_6_hours||item.data?.next_12_hours)?.summary?.symbol_code;
  return {time:formatter.format(new Date(item.time)).replace(' ','T'),temperature:number(d.air_temperature),apparentTemperature:null,weatherCode:code(symbol),cloudCover:number(d.cloud_area_fraction),windSpeed:number(d.wind_speed)===null?null:d.wind_speed*3.6,windDirection:number(d.wind_from_direction),windGust:null,directRadiation:null,shortwaveRadiation:null,terrestrialRadiation:null};
 }).filter(row=>Number.isFinite(row.temperature));
 if(!rows.length)throw Error('met-weather-contract');return {version:2,retrievedAt,source:'MET Norway',licence:'CC BY 4.0',radiationBasis:'cloud-estimate',resolutionMinutes:180,latitude:48.778,longitude:9.18,timezone:'Europe/Berlin',rows};
}

function usableWeatherCache(model,now=Date.now()) {
 return model?.version===2&&Number.isFinite(model.retrievedAt)&&now-model.retrievedAt>=-300000&&now-model.retrievedAt<WEATHER_STALE_MS&&Array.isArray(model.rows)&&model.rows.some(row=>Number.isFinite(row.temperature));
}

async function requestWeatherModel({baseURL,fetchImpl=fetch}={}) {
 const urls=[new URL('/api/weather',baseURL),weatherUrl(),weatherUrl({dwd:true})];
 for(const url of urls){try{const response=await fetchImpl(url,{headers:{Accept:'application/json'},signal:AbortSignal.timeout(url.pathname==='/api/weather'?11000:6500)});if(!response.ok)throw Error('weather-'+response.status);return normalizeWeather(await response.json());}catch(error){if(url===urls.at(-1))throw error;}}
}

function weatherAt(model,day,minutes){
 if(!model?.rows?.length||!/^\d{4}-\d\d-\d\d$/.test(day))return null;
 const target=Date.parse(`${day}T00:00:00Z`)+Math.max(0,Math.min(1439,Number(minutes)||0))*60000;
 let best=null,distance=Infinity;for(const row of model.rows){const value=Date.parse(row.time.slice(0,16)+':00Z'),next=Math.abs(value-target);if(Number.isFinite(row.temperature)&&next<distance){best=row;distance=next;}}
 if(!best||distance>(model.resolutionMinutes===180?91:31)*60000)return null;
 const direct=number(best.directRadiation),solarWeight=direct!==null?clamp((direct-40)/450):number(best.cloudCover)!==null?clamp((1-clamp(best.cloudCover/100))**1.5):1;
 return {...best,solarWeight,radiationEstimated:direct===null,forecastDistanceMinutes:Math.round(distance/60000)};
}

function weatherCodeGroup(code){
 if(code===0)return 'clear';if([1,2].includes(code))return 'partlyCloudy';if(code===3)return 'overcast';if([45,48].includes(code))return 'fog';if([51,53,55,56,57].includes(code))return 'drizzle';if([61,63,65,66,67,80,81,82].includes(code))return 'rain';if([71,73,75,77,85,86].includes(code))return 'snow';if([95,96,99].includes(code))return 'thunderstorm';return 'unknown';
}

const BUNDLED_DISPLAY_WORKER="// Geometry and routing engine. Units: local metres. No synthetic connections.\r\nconst RAD=Math.PI/180;\r\nfunction sunPosition(date,lat=48.777,lon=9.18){\r\n const jd=date.getTime()/86400000+2440587.5,n=jd-2451545;\r\n const L=(280.46+.9856474*n)%360,g=(357.528+.9856003*n)*RAD;\r\n const lambda=(L+1.915*Math.sin(g)+.020*Math.sin(2*g))*RAD,eps=(23.439-.0000004*n)*RAD;\r\n const ra=Math.atan2(Math.cos(eps)*Math.sin(lambda),Math.cos(lambda));\r\n const dec=Math.asin(Math.sin(eps)*Math.sin(lambda));\r\n const gmst=(280.46061837+360.98564736629*n)*RAD;\r\n const H=gmst+lon*RAD-ra,phi=lat*RAD;\r\n const altitude=Math.asin(Math.sin(phi)*Math.sin(dec)+Math.cos(phi)*Math.cos(dec)*Math.cos(H));\r\n const azimuth=(Math.atan2(Math.sin(H),Math.cos(H)*Math.sin(phi)-Math.tan(dec)*Math.cos(phi))+Math.PI+2*Math.PI)%(2*Math.PI);\r\n return {altitude:altitude/RAD,azimuth:azimuth/RAD};\r\n}\r\nfunction insideRing(p,r){let c=false;for(let i=0,j=r.length-1;i<r.length;j=i++){const a=r[i],b=r[j];if((a[1]>p[1])!==(b[1]>p[1])&&p[0]<(b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1])+a[0])c=!c;}return c;}\r\nfunction insidePolygon(p,rings){return insideRing(p,rings[0])&&!rings.slice(1).some(r=>insideRing(p,r));}\r\nfunction previewBuildingShadow(rings,dx,dy){let x0=Infinity,y0=Infinity,x1=-Infinity,y1=-Infinity;for(const ring of rings)for(const p of ring){x0=Math.min(x0,p[0],p[0]+dx);y0=Math.min(y0,p[1],p[1]+dy);x1=Math.max(x1,p[0],p[0]+dx);y1=Math.max(y1,p[1],p[1]+dy);}return Number.isFinite(x0)?[[x0,y0],[x1,y0],[x1,y1],[x0,y1],[x0,y0]]:null;}\r\nfunction makeShadows(obstacles,sun,leafOn=true,quality={}){\r\n if(sun.altitude<=2)return [];\r\n const a=sun.azimuth*RAD,t=1/Math.tan(sun.altitude*RAD),polys=[],preview=Boolean(quality.preview),treeSteps=Math.max(8,quality.treeSteps||16);\r\n for(const b of obstacles.buildings){\r\n  const dx=-Math.sin(a)*b.h*t,dy=-Math.cos(a)*b.h*t;\r\n  if(preview){const ring=previewBuildingShadow(b.r,dx,dy);if(ring)polys.push([ring]);continue;}\r\n  polys.push(b.r.map(r=>r.map(p=>[p[0]+dx,p[1]+dy])));\r\n  // Swept vertical walls plus roof projection preserve concave footprints.\r\n  for(const r of b.r)for(let i=1;i<r.length;i++){\r\n   const p=r[i-1],q=r[i];polys.push([[p,q,[q[0]+dx,q[1]+dy],[p[0]+dx,p[1]+dy],p]]);\r\n  }\r\n }\r\n for(const b of obstacles.trees){\r\n  if(!leafOn&&!b.evergreen)continue;\r\n  const r=b.r,cy=Math.max(r,b.h-r),dx=-Math.sin(a)*cy*t,dy=-Math.cos(a)*cy*t;\r\n  const major=r/Math.sin(sun.altitude*RAD),ring=[];\r\n  for(let j=0;j<=treeSteps;j++){const u=2*Math.PI*j/treeSteps,along=major*Math.cos(u),cross=r*Math.sin(u);ring.push([b.p[0]+dx+along*Math.sin(a)+cross*Math.cos(a),b.p[1]+dy+along*Math.cos(a)-cross*Math.sin(a)]);}\r\n  polys.push([ring]);\r\n }\r\n return polys;\r\n}\r\nfunction shadowIndex(polys){const cells=new Map(),size=50;\r\n polys.forEach((r,i)=>{const p=r[0];let x0=Infinity,y0=Infinity,x1=-Infinity,y1=-Infinity;for(const [x,y] of p){x0=Math.min(x0,x);y0=Math.min(y0,y);x1=Math.max(x1,x);y1=Math.max(y1,y);}\r\n for(let x=Math.floor(x0/size);x<=Math.floor(x1/size);x++)for(let y=Math.floor(y0/size);y<=Math.floor(y1/size);y++){const k=x+','+y;if(!cells.has(k))cells.set(k,[]);cells.get(k).push(i);}});\r\n return p=>(cells.get(Math.floor(p[0]/size)+','+Math.floor(p[1]/size))||[]).some(i=>insidePolygon(p,polys[i]));\r\n}\r\nfunction edgeShades(edges,polys,night=false){\r\n const hit=shadowIndex(polys);\r\n return edges.map(e=>{if(e.covered||night)return 1;let yes=0,total=0;for(let i=1;i<e.c.length;i++){const a=e.c[i-1],b=e.c[i],len=Math.hypot(b[0]-a[0],b[1]-a[1]),n=Math.max(1,Math.ceil(len/4));for(let j=0;j<n;j++){const t=(j+.5)/n;if(hit([a[0]+t*(b[0]-a[0]),a[1]+t*(b[1]-a[1])]))yes+=len/n;total+=len/n;}}return total?yes/total:0;});\r\n}\r\nclass Heap{constructor(){this.a=[];}push(v){const a=this.a;let i=a.length;a.push(v);while(i){const p=(i-1)>>1;if(a[p][0]<=v[0])break;a[i]=a[p];i=p;}a[i]=v;}pop(){const a=this.a,v=a[0],last=a.pop();if(a.length){let i=0;while(i*2+1<a.length){let c=i*2+1;if(c+1<a.length&&a[c+1][0]<a[c][0])c++;if(a[c][0]>=last[0])break;a[i]=a[c];i=c;}a[i]=last;}return v;}get length(){return this.a.length;}}\r\nfunction buildAdj(network){const adj=network.nodes.map(()=>[]);network.edges.forEach((e,i)=>{if(e.dir!==-1)adj[e.a].push([e.b,i,1]);if(e.dir!==1)adj[e.b].push([e.a,i,-1]);});return adj;}\r\nconst MOBILITY_PROFILES={\r\n standard:{slopeMode:'none',speedMpm:75,ascentMinutesPer10m:1},\r\n // Hard filters apply only to explicitly known barriers. Missing attributes stay\r\n // routable, receive an uncertainty penalty and are reported to the user.\r\n wheelchair:{avoidSteps:true,avoidEscalators:true,avoidPoorSurface:true,avoidWheelchairNo:true,maxSlope:6,slopeMode:'both',slopeFactor:.9,surfaceFactor:1.3,wayFactor:1.1,wheelchairFactor:1.4,unknownFactor:.65,speedMpm:60,ascentMinutesPer10m:1.4},\r\n powerWheelchair:{avoidSteps:true,avoidEscalators:true,avoidPoorSurface:true,avoidWheelchairNo:true,maxSlope:10,slopeMode:'both',slopeFactor:.55,surfaceFactor:1,wayFactor:1,wheelchairFactor:1.1,unknownFactor:.5,speedMpm:75,ascentMinutesPer10m:.5},\r\n walkingAid:{avoidSteps:true,avoidEscalators:true,avoidPoorSurface:true,maxSlope:10,slopeMode:'both',slopeFactor:.65,surfaceFactor:.9,wayFactor:.7,benchFactor:1.2,shelterFactor:.35,unknownFactor:.45,speedMpm:50,ascentMinutesPer10m:1.6},\r\n vision:{slopeMode:'none',wayFactor:.9,crossingFactor:1.5,stairGuidanceFactor:1.2,unknownFactor:.25,speedMpm:65,ascentMinutesPer10m:1.1},\r\n stroller:{avoidSteps:true,avoidEscalators:true,avoidPoorSurface:true,maxSlope:12,slopeMode:'both',slopeFactor:.7,downhillFactor:.25,surfaceFactor:1,wayFactor:1.2,benchFactor:.35,unknownFactor:.4,speedMpm:65,ascentMinutesPer10m:1.2},\r\n};\r\nfunction resolvedOptions(options={}){\r\n const profile=options.mobilityProfile||'standard';\r\n return profile==='custom'?{...options}:{...MOBILITY_PROFILES[profile]||MOBILITY_PROFILES.standard,...options};\r\n}\r\nfunction signedEdgeSlope(e,forward=true){\r\n const raw=Number.isFinite(e.sf)?e.sf:(Number.isFinite(e.dz)&&Math.abs(e.dz)>.01?Math.sign(e.dz)*Math.abs(e.s):null);\r\n return raw===null?null:(forward?raw:-raw);\r\n}\r\nfunction edgeAllowed(e,options={},forward=null){\r\n // Access blocks from the audited server graph (private, foot=no, use_sidepath, motorways …) apply to every profile and are never relaxed.\r\n if(e.accessBlocked)return false;\r\n if(options.avoidSteps&&e.steps)return false;\r\n if(options.avoidEscalators&&e.escalator)return false;\r\n if(options.avoidPoorSurface&&e.surface===3)return false;\r\n if(options.avoidWheelchairNo&&e.wheelchair===3)return false;\r\n if(options.maxSlope){\r\n  if(forward===null)return edgeAllowed(e,{...options,maxSlope:0},true)&&(Math.abs(signedEdgeSlope(e,true)??0)<=options.maxSlope||Math.abs(signedEdgeSlope(e,false)??0)<=options.maxSlope);\r\n  const slope=signedEdgeSlope(e,forward);if(slope!==null&&Math.abs(slope)>options.maxSlope)return false;\r\n }\r\n return true;\r\n}\r\nfunction edgeCostMultiplier(e,options={},shade=0,forward=true){\r\n const {preference=\"balanced\"}=options,slopeMode=options.slopeMode||(options.gentle?\"both\":\"none\"),exposure=preference===\"shade\"?1-shade:preference===\"sun\"?shade:0,solarWeight=Math.max(0,Math.min(1,Number.isFinite(options.solarWeight)?options.solarWeight:1)),directed=signedEdgeSlope(e,forward);\r\n let cost=1+exposure*1.6*solarWeight,slope=0;if(slopeMode!=='none'){if(directed===null)slope=24;else if(slopeMode==='uphill')slope=Math.max(0,directed);else if(slopeMode==='downhill')slope=Math.max(0,-directed);else slope=Math.abs(directed);cost+=Math.min(5,slope/6)*(options.slopeFactor??1);}if(options.downhillFactor&&directed!==null)cost+=Math.min(3,Math.max(0,-directed)/8)*options.downhillFactor;if(options.surfaceFactor)cost+=(e.surface===3?2.5:e.surface===2?.7:0)*options.surfaceFactor;if(options.wayFactor)cost+=(e.way===3?1.7:e.way===2?.35:0)*options.wayFactor;if(options.wheelchairFactor)cost+=(e.wheelchair===3?4:e.wheelchair===2?1.3:0)*options.wheelchairFactor;if(options.crossingFactor&&e.crossing)cost+=(e.crossing===1?2.4:e.crossing===2?.55:0)*options.crossingFactor;if(options.stairGuidanceFactor&&e.steps)cost+=(!e.handrail?1.2:0)+(!e.tactile?1.2:0);if(options.benchFactor)cost+=Math.min(2,Math.max(0,(Math.min(e.bench??1000,1000)-100)/450))*options.benchFactor;if(options.shelterFactor)cost+=Math.min(1.2,Math.max(0,(Math.min(e.shelter??1000,1000)-200)/650))*options.shelterFactor;if(options.unknownFactor){let unknown=0;if(e.surface===0)unknown++;if(!Number.isFinite(e.sf))unknown++;if(options.avoidWheelchairNo&&e.wheelchair===0)unknown++;cost+=unknown*options.unknownFactor;}return cost;\r\n}\r\nfunction buildComponents(network,options={}){\r\n if(typeof options==='boolean')options={avoidSteps:options};\r\n options=resolvedOptions(options);\r\n const links=network.nodes.map(()=>[]);network.edges.forEach(e=>{if(!edgeAllowed(e,options))return;links[e.a].push(e.b);links[e.b].push(e.a);});\r\n const ids=new Int32Array(network.nodes.length).fill(-1);let id=0;\r\n for(let start=0;start<links.length;start++){if(ids[start]>=0||!links[start].length)continue;ids[start]=id;const q=[start];while(q.length){const u=q.pop();for(const v of links[u])if(ids[v]<0){ids[v]=id;q.push(v);}}id++;}\r\n return ids;\r\n}\r\nfunction edgeProjection(e,p){\r\n const a=e.c[0],b=e.c[e.c.length-1],dx=b[0]-a[0],dy=b[1]-a[1],den=dx*dx+dy*dy;\r\n const t=den?Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dy)/den)):0;\r\n const q=[a[0]+t*dx,a[1]+t*dy];return {t,p:q,distance:Math.hypot(p[0]-q[0],p[1]-q[1])};\r\n}\r\nfunction nearestEdge(network,p,avoidSteps=false){\r\n let best={i:-1,t:0,p:null,distance:Infinity};\r\n for(let i=0;i<network.edges.length;i++){\r\n  const e=network.edges[i];if(avoidSteps&&e.steps)continue;\r\n  const projection=edgeProjection(e,p);if(projection.distance<best.distance)best={i,...projection};\r\n }\r\n return best;\r\n}\r\nfunction snapCandidates(network,p,maxSnap){\r\n if(!network.snapIndex||!network.snapGrid)return null;\r\n const cell=network.snapGrid,reach=Math.max(1,Math.ceil(maxSnap/cell)+1),cx=Math.floor(p[0]/cell),cy=Math.floor(p[1]/cell),indices=new Set();\r\n for(let x=cx-reach;x<=cx+reach;x++)for(let y=cy-reach;y<=cy+reach;y++)for(const i of network.snapIndex[`${x}_${y}`]||[])indices.add(i);\r\n return indices.size?[...indices]:null;\r\n}\r\nfunction nearestByComponent(network,p,components,options,maxSnap){\r\n const candidates=snapCandidates(network,p,maxSnap)||network.edges.keys(),best=new Map();for(const i of candidates){const e=network.edges[i];if(!edgeAllowed(e,options))continue;const component=components[e.a];if(component<0)continue;const projection=edgeProjection(e,p),old=best.get(component);if(!old||projection.distance<old.distance)best.set(component,{i,component,...projection});}return best;\r\n}\r\nfunction sharedSnapExists(network,start,end,maxSnap){const components=network.baseComponents||=buildComponents(network,{}),starts=nearestByComponent(network,start,components,{},maxSnap),ends=nearestByComponent(network,end,components,{},maxSnap);for(const [component,a] of starts){const b=ends.get(component);if(b&&a.distance<=maxSnap&&b.distance<=maxSnap)return true;}return false;}\r\nfunction route(network,adj,shades,start,end,options={}){\r\n options=resolvedOptions(options);const {preference='balanced',gentle=false}=options,slopeMode=options.slopeMode||(gentle?'both':'none'),components=options.components||buildComponents(network,options),maxSnap=options.maxSnap||30;\r\n const starts=nearestByComponent(network,start,components,options,maxSnap),ends=nearestByComponent(network,end,components,options,maxSnap);let a=null,b=null,bestSnap=Infinity;\r\n for(const [component,sa] of starts){const sb=ends.get(component);if(!sb||sa.distance>maxSnap||sb.distance>maxSnap)continue;const score=sa.distance+sb.distance;if(score<bestSnap){bestSnap=score;a=sa;b=sb;}}\r\n if(!a||!b)return {error:hasRestrictions(options)&&sharedSnapExists(network,start,end,maxSnap)?'profileBlocked':'outside'};\r\n const penalty=(i,forward=true)=>edgeCostMultiplier(network.edges[i],options,Number.isFinite(shades[i])?shades[i]:0,forward);\r\n const ae=network.edges[a.i],be=network.edges[b.i];let directCandidate=null;\r\n if(a.i===b.i){\r\n  const forward=b.t>=a.t,allowed=(forward?ae.dir!==-1:ae.dir!==1)&&edgeAllowed(ae,options,forward),frac=Math.abs(b.t-a.t);\r\n  if(allowed){if(frac*ae.l<.01)return {error:'same'};directCandidate={parts:[{i:a.i,forward,frac,t0:a.t,t1:b.t,coords:[a.p,b.p]}],cost:ae.l*frac*penalty(a.i,forward)};}\r\n }\r\n const d=new Float64Array(network.nodes.length).fill(Infinity),prev=new Int32Array(d.length).fill(-1),pe=new Int32Array(d.length).fill(-1),heap=new Heap(),seedPart=new Map(),finalPart=new Map();\r\n const seed=(node,part)=>{const cost=network.edges[part.i].l*part.frac*penalty(part.i,part.forward);if(cost<d[node]){d[node]=cost;seedPart.set(node,part);heap.push([cost,node]);}};\r\n if(a.t<1e-12||(ae.dir!==1&&edgeAllowed(ae,options,false)))seed(ae.a,{i:a.i,forward:false,frac:a.t,t0:a.t,t1:0,coords:[a.p,network.nodes[ae.a]]});\r\n if(1-a.t<1e-12||(ae.dir!==-1&&edgeAllowed(ae,options,true)))seed(ae.b,{i:a.i,forward:true,frac:1-a.t,t0:a.t,t1:1,coords:[a.p,network.nodes[ae.b]]});\r\n const addFinal=(node,part)=>{const cost=network.edges[part.i].l*part.frac*penalty(part.i,part.forward),old=finalPart.get(node);if(!old||cost<old.cost)finalPart.set(node,{cost,part});};\r\n if(b.t<1e-12||(be.dir!==-1&&edgeAllowed(be,options,true)))addFinal(be.a,{i:b.i,forward:true,frac:b.t,t0:0,t1:b.t,coords:[network.nodes[be.a],b.p]});\r\n if(1-b.t<1e-12||(be.dir!==1&&edgeAllowed(be,options,false)))addFinal(be.b,{i:b.i,forward:false,frac:1-b.t,t0:1,t1:b.t,coords:[network.nodes[be.b],b.p]});\r\n let best=directCandidate?.cost??Infinity,target=-1,targetPart=null;\r\n while(heap.length){const [cost,u]=heap.pop();if(cost!==d[u])continue;if(cost>=best)break;const fin=finalPart.get(u);if(fin&&cost+fin.cost<best){best=cost+fin.cost;target=u;targetPart=fin.part;}for(const [v,i,direction] of adj[u]){const e=network.edges[i],forward=direction===1;if(!edgeAllowed(e,options,forward))continue;const nd=cost+e.l*penalty(i,forward);if(nd<d[v]){d[v]=nd;prev[v]=u;pe[v]=i;heap.push([nd,v]);}}}\r\n if(target<0)return directCandidate?finish(directCandidate.parts,a,b):{error:hasRestrictions(options)?'profileBlocked':'disconnected'};\r\n const full=[];let u=target;while(prev[u]>=0){const i=pe[u],forward=network.edges[i].b===u;full.push({i,forward,frac:1,t0:forward?0:1,t1:forward?1:0,coords:null});u=prev[u];}full.reverse();\r\n const parts=[seedPart.get(u),...full,targetPart].filter(Boolean);\r\n return finish(parts,a,b);\r\n function finish(parts,a,b){\r\n  let length=0,shaded=0,ascent=0,descent=0,steps=0,escalators=0,currentZ=null,heightsComplete=true;const coords=[],profile=[],quality={surfaceKnown:0,slopeKnown:0,widthKnown:0,wheelchairKnown:0,poorSurface:0,limitedWheelchair:0,maxUphill:0,maxDownhill:0,minWidth:null};\r\n  for(const part of parts){const e=network.edges[part.i],len=e.l*part.frac,t0=part.t0??(part.forward?0:1),t1=part.t1??(part.forward?1:0),raw0=e.z0,raw1=e.z1,known=Number.isFinite(raw0)&&Number.isFinite(raw1),dz=known?(raw1-raw0)*(t1-t0):0,segment=part.coords||(part.forward?e.c:e.c.slice().reverse()),directed=signedEdgeSlope(e,part.forward);if(known){profile.push([length,raw0+(raw1-raw0)*t0],[length+len,raw0+(raw1-raw0)*t1]);}else heightsComplete=false;length+=len;shaded+=len*shades[part.i];ascent+=Math.max(0,dz);descent+=Math.max(0,-dz);if(e.steps&&len>.01)steps++;if(e.escalator&&len>.01)escalators++;if(e.surface){quality.surfaceKnown+=len;if(e.surface===3)quality.poorSurface+=len;}if(directed!==null){quality.slopeKnown+=len;quality.maxUphill=Math.max(quality.maxUphill,directed);quality.maxDownhill=Math.max(quality.maxDownhill,-directed);}if(e.width>0){quality.widthKnown+=len;quality.minWidth=quality.minWidth===null?e.width:Math.min(quality.minWidth,e.width);}if(e.wheelchair){quality.wheelchairKnown+=len;if(e.wheelchair>=2)quality.limitedWheelchair+=len;}for(const p of segment)if(!coords.length||Math.hypot(coords.at(-1)[0]-p[0],coords.at(-1)[1]-p[1])>.001)coords.push(p);}\r\n  const speed=Math.max(1,options.speedMpm||75),ascentMinutes=options.ascentMinutesPer10m??1;\r\n  for(const key of ['surfaceKnown','slopeKnown','widthKnown','wheelchairKnown','poorSurface','limitedWheelchair'])quality[key]=length?quality[key]/length:0;\r\n  return {path:parts,coords,profile:heightsComplete?profile:[],length,shade:length?shaded/length:0,ascent:heightsComplete?ascent:null,descent:heightsComplete?descent:null,steps,escalators,quality,criteria:{maxSlope:options.maxSlope||0,avoidPoorSurface:Boolean(options.avoidPoorSurface),avoidWheelchairNo:Boolean(options.avoidWheelchairNo),avoidSteps:Boolean(options.avoidSteps),avoidEscalators:Boolean(options.avoidEscalators)},minutes:heightsComplete?Math.ceil(length/speed+ascent/10*ascentMinutes):null,timeModel:{speedMpm:speed,ascentMinutesPer10m:ascentMinutes,estimated:true},snaps:[a.p,b.p],snapDistances:[a.distance,b.distance]};\r\n }\r\n}\r\nfunction hasRestrictions(options){return Boolean(options.avoidSteps||options.avoidEscalators||options.avoidPoorSurface||options.avoidWheelchairNo||options.maxSlope);}\r\n\r\nfunction relaxationTiers(options={}){\r\n const base=resolvedOptions(options),tiers=[{options:base,relaxed:[]}],current={...base},relaxed=[];\r\n const relax=(key,label,value)=>{if(!current[key])return;current[key]=value;relaxed.push(label);tiers.push({options:{...current},relaxed:[...relaxed]});};\r\n // Keep physical barriers until the last possible stages. Strong gradients and\r\n // surface quality are relaxed first, then wheelchair tags, escalators and stairs.\r\n relax('maxSlope','maxSlope',0);\r\n relax('avoidPoorSurface','poorSurface',false);\r\n relax('avoidWheelchairNo','wheelchairNo',false);\r\n relax('avoidEscalators','escalators',false);\r\n relax('avoidSteps','steps',false);\r\n return tiers;\r\n}\r\n\r\n// Same search radii as the server (engine.py SNAP_STEPS): a point inside a construction site still gets a route.\r\nconst SNAP_STEPS=[50,300,1500,5000];\r\n// Requirements of the requested profile that edge e breaks in this direction (engine.py violations, drawn in orange).\r\nfunction edgeViolations(e,forward,options={}){\r\n const found=[],slope=signedEdgeSlope(e,forward);\r\n if(options.avoidSteps&&e.steps)found.push('steps');\r\n if(options.avoidEscalators&&e.escalator)found.push('escalator');\r\n if(options.avoidPoorSurface&&e.surface===3)found.push('poorSurface');\r\n if(options.avoidWheelchairNo&&e.wheelchair===3)found.push('wheelchairNo');\r\n if(options.maxSlope&&slope!==null&&Math.abs(slope)>options.maxSlope)found.push('maxSlope');\r\n return found;\r\n}\r\nfunction bestAvailableRoute(network,adj,shades,start,end,options={},componentResolver=null){\r\n const requestedProfile=options.mobilityProfile||'standard',tiers=relaxationTiers(options);let last={error:'outside'},usedOptions=tiers[0].options;\r\n for(const [step,radius] of SNAP_STEPS.entries()){\r\n  const maxSnap=Math.max(radius,options.maxSnap||0);\r\n  for(let level=0;level<tiers.length;level++){\r\n   const tier=tiers[level],candidateOptions={...tier.options,maxSnap};\r\n   if(componentResolver)candidateOptions.components=componentResolver(candidateOptions);\r\n   const candidate=route(network,adj,shades,start,end,candidateOptions);if(step===0||candidate.error!=='outside')last=candidate;usedOptions=candidateOptions;\r\n   if(!candidate.error){\r\n    candidate.fallbackLevel=level;candidate.relaxedCriteria=tier.relaxed;candidate.requestedProfile=requestedProfile;candidate.snapWidened=step>0;\r\n    candidate.warnings=candidate.path.map(part=>({part,reasons:edgeViolations(network.edges[part.i],part.forward,tiers[0].options)})).filter(w=>w.reasons.length)\r\n     .map(({part,reasons})=>{const slope=signedEdgeSlope(network.edges[part.i],part.forward);return {coords:part.coords||(part.forward?network.edges[part.i].c:network.edges[part.i].c.slice().reverse()),reasons,slope:slope===null?null:Math.abs(slope),limit:tiers[0].options.maxSlope||null};});\r\n    return {result:candidate,usedOptions};\r\n   }\r\n   if(candidate.error==='same')return {result:candidate,usedOptions};\r\n   if(candidate.error!=='profileBlocked')break;\r\n  }\r\n }\r\n return {result:last,usedOptions};\r\n}\r\n\r\n\n// Display only: analytical roof/wall projection, without PNG encoding or route work.\nfunction displayShadowOpacity(solarWeight,altitude) {\n if(!Number.isFinite(altitude)||altitude<=2)return 0;\n const weight=Number.isFinite(solarWeight)?Math.max(0,Math.min(1,solarWeight)):1;\n return .22+.16*weight;\n}\nfunction createLatestFrameQueue(send) {\n let busy=false,pending=null;\n return {push(value){pending=value;this.pump();},pump(){if(busy||!pending)return;const next=pending;pending=null;busy=true;send(next);},complete(){busy=false;this.pump();},get pending(){return pending;},get busy(){return busy;}};\n}\nfunction drawDisplayShadows(ctx,obstacles,sun,leafOn,transform) {\n ctx.clearRect(0,0,ctx.canvas.width,ctx.canvas.height);\n if(sun.altitude<=2)return;\n const az=sun.azimuth*Math.PI/180,alt=sun.altitude*Math.PI/180,cot=1/Math.tan(alt),sx=-Math.sin(az)*cot,sy=-Math.cos(az)*cot;\n const point=(p,dx=0,dy=0)=>transform(p[0]+dx,p[1]+dy);\n ctx.fillStyle='#24364f';\n for(const building of obstacles.buildings){\n  const dx=sx*building.h,dy=sy*building.h;\n  ctx.beginPath();for(const ring of building.r){ring.forEach((p,i)=>{const q=point(p,dx,dy);i?ctx.lineTo(...q):ctx.moveTo(...q);});ctx.closePath();}ctx.fill('evenodd');\n  for(const ring of building.r)for(let i=1;i<ring.length;i++){const a=point(ring[i-1]),b=point(ring[i]),c=point(ring[i],dx,dy),d=point(ring[i-1],dx,dy);ctx.beginPath();ctx.moveTo(...a);ctx.lineTo(...b);ctx.lineTo(...c);ctx.lineTo(...d);ctx.closePath();ctx.fill();}\n }\n for(const tree of obstacles.trees){\n  if(!leafOn&&!tree.evergreen)continue;\n  const centre=Math.max(tree.r,tree.h-tree.r),major=tree.r/Math.sin(alt);ctx.beginPath();\n  for(let i=0;i<=32;i++){const angle=i*Math.PI/16,along=major*Math.cos(angle),across=tree.r*Math.sin(angle),q=transform(tree.p[0]+sx*centre+along*Math.sin(az)+across*Math.cos(az),tree.p[1]+sy*centre+along*Math.cos(az)-across*Math.sin(az));i?ctx.lineTo(...q):ctx.moveTo(...q);}ctx.closePath();ctx.fill();\n }\n}\n\n\n\nlet obstacles={buildings:[],trees:[]},canvas;\nself.onmessage=({data:d})=>{try{\n if(d.type==='obstacles'){obstacles=d.obstacles;return;}\n if(d.type!=='frame')return;\n const started=performance.now(),sun=sunPosition(new Date(d.iso),d.center[1],d.center[0]),{bounds,meta,width,height}=d;\n if(!canvas||canvas.width!==width||canvas.height!==height)canvas=new OffscreenCanvas(width,height);\n const ctx=canvas.getContext('2d'),x0=(bounds[0]-meta.origin[0])*meta.scale[0],y1=(bounds[3]-meta.origin[1])*meta.scale[1],xs=width/((bounds[2]-bounds[0])*meta.scale[0]),ys=height/((bounds[3]-bounds[1])*meta.scale[1]);\n drawDisplayShadows(ctx,obstacles,sun,d.leafOn,(x,y)=>[(x-x0)*xs,(y1-y)*ys]);\n const bitmap=canvas.transferToImageBitmap();self.postMessage({type:'frame',id:d.id,epoch:d.epoch,iso:d.iso,bounds,bitmap,sun,renderMs:performance.now()-started},[bitmap]);\n }catch(error){self.postMessage({type:'error',message:error.message});}};\n";
const BUNDLED_WORKER="// Geometry and routing engine. Units: local metres. No synthetic connections.\r\nconst RAD=Math.PI/180;\r\nfunction sunPosition(date,lat=48.777,lon=9.18){\r\n const jd=date.getTime()/86400000+2440587.5,n=jd-2451545;\r\n const L=(280.46+.9856474*n)%360,g=(357.528+.9856003*n)*RAD;\r\n const lambda=(L+1.915*Math.sin(g)+.020*Math.sin(2*g))*RAD,eps=(23.439-.0000004*n)*RAD;\r\n const ra=Math.atan2(Math.cos(eps)*Math.sin(lambda),Math.cos(lambda));\r\n const dec=Math.asin(Math.sin(eps)*Math.sin(lambda));\r\n const gmst=(280.46061837+360.98564736629*n)*RAD;\r\n const H=gmst+lon*RAD-ra,phi=lat*RAD;\r\n const altitude=Math.asin(Math.sin(phi)*Math.sin(dec)+Math.cos(phi)*Math.cos(dec)*Math.cos(H));\r\n const azimuth=(Math.atan2(Math.sin(H),Math.cos(H)*Math.sin(phi)-Math.tan(dec)*Math.cos(phi))+Math.PI+2*Math.PI)%(2*Math.PI);\r\n return {altitude:altitude/RAD,azimuth:azimuth/RAD};\r\n}\r\nfunction insideRing(p,r){let c=false;for(let i=0,j=r.length-1;i<r.length;j=i++){const a=r[i],b=r[j];if((a[1]>p[1])!==(b[1]>p[1])&&p[0]<(b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1])+a[0])c=!c;}return c;}\r\nfunction insidePolygon(p,rings){return insideRing(p,rings[0])&&!rings.slice(1).some(r=>insideRing(p,r));}\r\nfunction previewBuildingShadow(rings,dx,dy){let x0=Infinity,y0=Infinity,x1=-Infinity,y1=-Infinity;for(const ring of rings)for(const p of ring){x0=Math.min(x0,p[0],p[0]+dx);y0=Math.min(y0,p[1],p[1]+dy);x1=Math.max(x1,p[0],p[0]+dx);y1=Math.max(y1,p[1],p[1]+dy);}return Number.isFinite(x0)?[[x0,y0],[x1,y0],[x1,y1],[x0,y1],[x0,y0]]:null;}\r\nfunction makeShadows(obstacles,sun,leafOn=true,quality={}){\r\n if(sun.altitude<=2)return [];\r\n const a=sun.azimuth*RAD,t=1/Math.tan(sun.altitude*RAD),polys=[],preview=Boolean(quality.preview),treeSteps=Math.max(8,quality.treeSteps||16);\r\n for(const b of obstacles.buildings){\r\n  const dx=-Math.sin(a)*b.h*t,dy=-Math.cos(a)*b.h*t;\r\n  if(preview){const ring=previewBuildingShadow(b.r,dx,dy);if(ring)polys.push([ring]);continue;}\r\n  polys.push(b.r.map(r=>r.map(p=>[p[0]+dx,p[1]+dy])));\r\n  // Swept vertical walls plus roof projection preserve concave footprints.\r\n  for(const r of b.r)for(let i=1;i<r.length;i++){\r\n   const p=r[i-1],q=r[i];polys.push([[p,q,[q[0]+dx,q[1]+dy],[p[0]+dx,p[1]+dy],p]]);\r\n  }\r\n }\r\n for(const b of obstacles.trees){\r\n  if(!leafOn&&!b.evergreen)continue;\r\n  const r=b.r,cy=Math.max(r,b.h-r),dx=-Math.sin(a)*cy*t,dy=-Math.cos(a)*cy*t;\r\n  const major=r/Math.sin(sun.altitude*RAD),ring=[];\r\n  for(let j=0;j<=treeSteps;j++){const u=2*Math.PI*j/treeSteps,along=major*Math.cos(u),cross=r*Math.sin(u);ring.push([b.p[0]+dx+along*Math.sin(a)+cross*Math.cos(a),b.p[1]+dy+along*Math.cos(a)-cross*Math.sin(a)]);}\r\n  polys.push([ring]);\r\n }\r\n return polys;\r\n}\r\nfunction shadowIndex(polys){const cells=new Map(),size=50;\r\n polys.forEach((r,i)=>{const p=r[0];let x0=Infinity,y0=Infinity,x1=-Infinity,y1=-Infinity;for(const [x,y] of p){x0=Math.min(x0,x);y0=Math.min(y0,y);x1=Math.max(x1,x);y1=Math.max(y1,y);}\r\n for(let x=Math.floor(x0/size);x<=Math.floor(x1/size);x++)for(let y=Math.floor(y0/size);y<=Math.floor(y1/size);y++){const k=x+','+y;if(!cells.has(k))cells.set(k,[]);cells.get(k).push(i);}});\r\n return p=>(cells.get(Math.floor(p[0]/size)+','+Math.floor(p[1]/size))||[]).some(i=>insidePolygon(p,polys[i]));\r\n}\r\nfunction edgeShades(edges,polys,night=false){\r\n const hit=shadowIndex(polys);\r\n return edges.map(e=>{if(e.covered||night)return 1;let yes=0,total=0;for(let i=1;i<e.c.length;i++){const a=e.c[i-1],b=e.c[i],len=Math.hypot(b[0]-a[0],b[1]-a[1]),n=Math.max(1,Math.ceil(len/4));for(let j=0;j<n;j++){const t=(j+.5)/n;if(hit([a[0]+t*(b[0]-a[0]),a[1]+t*(b[1]-a[1])]))yes+=len/n;total+=len/n;}}return total?yes/total:0;});\r\n}\r\nclass Heap{constructor(){this.a=[];}push(v){const a=this.a;let i=a.length;a.push(v);while(i){const p=(i-1)>>1;if(a[p][0]<=v[0])break;a[i]=a[p];i=p;}a[i]=v;}pop(){const a=this.a,v=a[0],last=a.pop();if(a.length){let i=0;while(i*2+1<a.length){let c=i*2+1;if(c+1<a.length&&a[c+1][0]<a[c][0])c++;if(a[c][0]>=last[0])break;a[i]=a[c];i=c;}a[i]=last;}return v;}get length(){return this.a.length;}}\r\nfunction buildAdj(network){const adj=network.nodes.map(()=>[]);network.edges.forEach((e,i)=>{if(e.dir!==-1)adj[e.a].push([e.b,i,1]);if(e.dir!==1)adj[e.b].push([e.a,i,-1]);});return adj;}\r\nconst MOBILITY_PROFILES={\r\n standard:{slopeMode:'none',speedMpm:75,ascentMinutesPer10m:1},\r\n // Hard filters apply only to explicitly known barriers. Missing attributes stay\r\n // routable, receive an uncertainty penalty and are reported to the user.\r\n wheelchair:{avoidSteps:true,avoidEscalators:true,avoidPoorSurface:true,avoidWheelchairNo:true,maxSlope:6,slopeMode:'both',slopeFactor:.9,surfaceFactor:1.3,wayFactor:1.1,wheelchairFactor:1.4,unknownFactor:.65,speedMpm:60,ascentMinutesPer10m:1.4},\r\n powerWheelchair:{avoidSteps:true,avoidEscalators:true,avoidPoorSurface:true,avoidWheelchairNo:true,maxSlope:10,slopeMode:'both',slopeFactor:.55,surfaceFactor:1,wayFactor:1,wheelchairFactor:1.1,unknownFactor:.5,speedMpm:75,ascentMinutesPer10m:.5},\r\n walkingAid:{avoidSteps:true,avoidEscalators:true,avoidPoorSurface:true,maxSlope:10,slopeMode:'both',slopeFactor:.65,surfaceFactor:.9,wayFactor:.7,benchFactor:1.2,shelterFactor:.35,unknownFactor:.45,speedMpm:50,ascentMinutesPer10m:1.6},\r\n vision:{slopeMode:'none',wayFactor:.9,crossingFactor:1.5,stairGuidanceFactor:1.2,unknownFactor:.25,speedMpm:65,ascentMinutesPer10m:1.1},\r\n stroller:{avoidSteps:true,avoidEscalators:true,avoidPoorSurface:true,maxSlope:12,slopeMode:'both',slopeFactor:.7,downhillFactor:.25,surfaceFactor:1,wayFactor:1.2,benchFactor:.35,unknownFactor:.4,speedMpm:65,ascentMinutesPer10m:1.2},\r\n};\r\nfunction resolvedOptions(options={}){\r\n const profile=options.mobilityProfile||'standard';\r\n return profile==='custom'?{...options}:{...MOBILITY_PROFILES[profile]||MOBILITY_PROFILES.standard,...options};\r\n}\r\nfunction signedEdgeSlope(e,forward=true){\r\n const raw=Number.isFinite(e.sf)?e.sf:(Number.isFinite(e.dz)&&Math.abs(e.dz)>.01?Math.sign(e.dz)*Math.abs(e.s):null);\r\n return raw===null?null:(forward?raw:-raw);\r\n}\r\nfunction edgeAllowed(e,options={},forward=null){\r\n // Access blocks from the audited server graph (private, foot=no, use_sidepath, motorways …) apply to every profile and are never relaxed.\r\n if(e.accessBlocked)return false;\r\n if(options.avoidSteps&&e.steps)return false;\r\n if(options.avoidEscalators&&e.escalator)return false;\r\n if(options.avoidPoorSurface&&e.surface===3)return false;\r\n if(options.avoidWheelchairNo&&e.wheelchair===3)return false;\r\n if(options.maxSlope){\r\n  if(forward===null)return edgeAllowed(e,{...options,maxSlope:0},true)&&(Math.abs(signedEdgeSlope(e,true)??0)<=options.maxSlope||Math.abs(signedEdgeSlope(e,false)??0)<=options.maxSlope);\r\n  const slope=signedEdgeSlope(e,forward);if(slope!==null&&Math.abs(slope)>options.maxSlope)return false;\r\n }\r\n return true;\r\n}\r\nfunction edgeCostMultiplier(e,options={},shade=0,forward=true){\r\n const {preference=\"balanced\"}=options,slopeMode=options.slopeMode||(options.gentle?\"both\":\"none\"),exposure=preference===\"shade\"?1-shade:preference===\"sun\"?shade:0,solarWeight=Math.max(0,Math.min(1,Number.isFinite(options.solarWeight)?options.solarWeight:1)),directed=signedEdgeSlope(e,forward);\r\n let cost=1+exposure*1.6*solarWeight,slope=0;if(slopeMode!=='none'){if(directed===null)slope=24;else if(slopeMode==='uphill')slope=Math.max(0,directed);else if(slopeMode==='downhill')slope=Math.max(0,-directed);else slope=Math.abs(directed);cost+=Math.min(5,slope/6)*(options.slopeFactor??1);}if(options.downhillFactor&&directed!==null)cost+=Math.min(3,Math.max(0,-directed)/8)*options.downhillFactor;if(options.surfaceFactor)cost+=(e.surface===3?2.5:e.surface===2?.7:0)*options.surfaceFactor;if(options.wayFactor)cost+=(e.way===3?1.7:e.way===2?.35:0)*options.wayFactor;if(options.wheelchairFactor)cost+=(e.wheelchair===3?4:e.wheelchair===2?1.3:0)*options.wheelchairFactor;if(options.crossingFactor&&e.crossing)cost+=(e.crossing===1?2.4:e.crossing===2?.55:0)*options.crossingFactor;if(options.stairGuidanceFactor&&e.steps)cost+=(!e.handrail?1.2:0)+(!e.tactile?1.2:0);if(options.benchFactor)cost+=Math.min(2,Math.max(0,(Math.min(e.bench??1000,1000)-100)/450))*options.benchFactor;if(options.shelterFactor)cost+=Math.min(1.2,Math.max(0,(Math.min(e.shelter??1000,1000)-200)/650))*options.shelterFactor;if(options.unknownFactor){let unknown=0;if(e.surface===0)unknown++;if(!Number.isFinite(e.sf))unknown++;if(options.avoidWheelchairNo&&e.wheelchair===0)unknown++;cost+=unknown*options.unknownFactor;}return cost;\r\n}\r\nfunction buildComponents(network,options={}){\r\n if(typeof options==='boolean')options={avoidSteps:options};\r\n options=resolvedOptions(options);\r\n const links=network.nodes.map(()=>[]);network.edges.forEach(e=>{if(!edgeAllowed(e,options))return;links[e.a].push(e.b);links[e.b].push(e.a);});\r\n const ids=new Int32Array(network.nodes.length).fill(-1);let id=0;\r\n for(let start=0;start<links.length;start++){if(ids[start]>=0||!links[start].length)continue;ids[start]=id;const q=[start];while(q.length){const u=q.pop();for(const v of links[u])if(ids[v]<0){ids[v]=id;q.push(v);}}id++;}\r\n return ids;\r\n}\r\nfunction edgeProjection(e,p){\r\n const a=e.c[0],b=e.c[e.c.length-1],dx=b[0]-a[0],dy=b[1]-a[1],den=dx*dx+dy*dy;\r\n const t=den?Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dy)/den)):0;\r\n const q=[a[0]+t*dx,a[1]+t*dy];return {t,p:q,distance:Math.hypot(p[0]-q[0],p[1]-q[1])};\r\n}\r\nfunction nearestEdge(network,p,avoidSteps=false){\r\n let best={i:-1,t:0,p:null,distance:Infinity};\r\n for(let i=0;i<network.edges.length;i++){\r\n  const e=network.edges[i];if(avoidSteps&&e.steps)continue;\r\n  const projection=edgeProjection(e,p);if(projection.distance<best.distance)best={i,...projection};\r\n }\r\n return best;\r\n}\r\nfunction snapCandidates(network,p,maxSnap){\r\n if(!network.snapIndex||!network.snapGrid)return null;\r\n const cell=network.snapGrid,reach=Math.max(1,Math.ceil(maxSnap/cell)+1),cx=Math.floor(p[0]/cell),cy=Math.floor(p[1]/cell),indices=new Set();\r\n for(let x=cx-reach;x<=cx+reach;x++)for(let y=cy-reach;y<=cy+reach;y++)for(const i of network.snapIndex[`${x}_${y}`]||[])indices.add(i);\r\n return indices.size?[...indices]:null;\r\n}\r\nfunction nearestByComponent(network,p,components,options,maxSnap){\r\n const candidates=snapCandidates(network,p,maxSnap)||network.edges.keys(),best=new Map();for(const i of candidates){const e=network.edges[i];if(!edgeAllowed(e,options))continue;const component=components[e.a];if(component<0)continue;const projection=edgeProjection(e,p),old=best.get(component);if(!old||projection.distance<old.distance)best.set(component,{i,component,...projection});}return best;\r\n}\r\nfunction sharedSnapExists(network,start,end,maxSnap){const components=network.baseComponents||=buildComponents(network,{}),starts=nearestByComponent(network,start,components,{},maxSnap),ends=nearestByComponent(network,end,components,{},maxSnap);for(const [component,a] of starts){const b=ends.get(component);if(b&&a.distance<=maxSnap&&b.distance<=maxSnap)return true;}return false;}\r\nfunction route(network,adj,shades,start,end,options={}){\r\n options=resolvedOptions(options);const {preference='balanced',gentle=false}=options,slopeMode=options.slopeMode||(gentle?'both':'none'),components=options.components||buildComponents(network,options),maxSnap=options.maxSnap||30;\r\n const starts=nearestByComponent(network,start,components,options,maxSnap),ends=nearestByComponent(network,end,components,options,maxSnap);let a=null,b=null,bestSnap=Infinity;\r\n for(const [component,sa] of starts){const sb=ends.get(component);if(!sb||sa.distance>maxSnap||sb.distance>maxSnap)continue;const score=sa.distance+sb.distance;if(score<bestSnap){bestSnap=score;a=sa;b=sb;}}\r\n if(!a||!b)return {error:hasRestrictions(options)&&sharedSnapExists(network,start,end,maxSnap)?'profileBlocked':'outside'};\r\n const penalty=(i,forward=true)=>edgeCostMultiplier(network.edges[i],options,Number.isFinite(shades[i])?shades[i]:0,forward);\r\n const ae=network.edges[a.i],be=network.edges[b.i];let directCandidate=null;\r\n if(a.i===b.i){\r\n  const forward=b.t>=a.t,allowed=(forward?ae.dir!==-1:ae.dir!==1)&&edgeAllowed(ae,options,forward),frac=Math.abs(b.t-a.t);\r\n  if(allowed){if(frac*ae.l<.01)return {error:'same'};directCandidate={parts:[{i:a.i,forward,frac,t0:a.t,t1:b.t,coords:[a.p,b.p]}],cost:ae.l*frac*penalty(a.i,forward)};}\r\n }\r\n const d=new Float64Array(network.nodes.length).fill(Infinity),prev=new Int32Array(d.length).fill(-1),pe=new Int32Array(d.length).fill(-1),heap=new Heap(),seedPart=new Map(),finalPart=new Map();\r\n const seed=(node,part)=>{const cost=network.edges[part.i].l*part.frac*penalty(part.i,part.forward);if(cost<d[node]){d[node]=cost;seedPart.set(node,part);heap.push([cost,node]);}};\r\n if(a.t<1e-12||(ae.dir!==1&&edgeAllowed(ae,options,false)))seed(ae.a,{i:a.i,forward:false,frac:a.t,t0:a.t,t1:0,coords:[a.p,network.nodes[ae.a]]});\r\n if(1-a.t<1e-12||(ae.dir!==-1&&edgeAllowed(ae,options,true)))seed(ae.b,{i:a.i,forward:true,frac:1-a.t,t0:a.t,t1:1,coords:[a.p,network.nodes[ae.b]]});\r\n const addFinal=(node,part)=>{const cost=network.edges[part.i].l*part.frac*penalty(part.i,part.forward),old=finalPart.get(node);if(!old||cost<old.cost)finalPart.set(node,{cost,part});};\r\n if(b.t<1e-12||(be.dir!==-1&&edgeAllowed(be,options,true)))addFinal(be.a,{i:b.i,forward:true,frac:b.t,t0:0,t1:b.t,coords:[network.nodes[be.a],b.p]});\r\n if(1-b.t<1e-12||(be.dir!==1&&edgeAllowed(be,options,false)))addFinal(be.b,{i:b.i,forward:false,frac:1-b.t,t0:1,t1:b.t,coords:[network.nodes[be.b],b.p]});\r\n let best=directCandidate?.cost??Infinity,target=-1,targetPart=null;\r\n while(heap.length){const [cost,u]=heap.pop();if(cost!==d[u])continue;if(cost>=best)break;const fin=finalPart.get(u);if(fin&&cost+fin.cost<best){best=cost+fin.cost;target=u;targetPart=fin.part;}for(const [v,i,direction] of adj[u]){const e=network.edges[i],forward=direction===1;if(!edgeAllowed(e,options,forward))continue;const nd=cost+e.l*penalty(i,forward);if(nd<d[v]){d[v]=nd;prev[v]=u;pe[v]=i;heap.push([nd,v]);}}}\r\n if(target<0)return directCandidate?finish(directCandidate.parts,a,b):{error:hasRestrictions(options)?'profileBlocked':'disconnected'};\r\n const full=[];let u=target;while(prev[u]>=0){const i=pe[u],forward=network.edges[i].b===u;full.push({i,forward,frac:1,t0:forward?0:1,t1:forward?1:0,coords:null});u=prev[u];}full.reverse();\r\n const parts=[seedPart.get(u),...full,targetPart].filter(Boolean);\r\n return finish(parts,a,b);\r\n function finish(parts,a,b){\r\n  let length=0,shaded=0,ascent=0,descent=0,steps=0,escalators=0,currentZ=null,heightsComplete=true;const coords=[],profile=[],quality={surfaceKnown:0,slopeKnown:0,widthKnown:0,wheelchairKnown:0,poorSurface:0,limitedWheelchair:0,maxUphill:0,maxDownhill:0,minWidth:null};\r\n  for(const part of parts){const e=network.edges[part.i],len=e.l*part.frac,t0=part.t0??(part.forward?0:1),t1=part.t1??(part.forward?1:0),raw0=e.z0,raw1=e.z1,known=Number.isFinite(raw0)&&Number.isFinite(raw1),dz=known?(raw1-raw0)*(t1-t0):0,segment=part.coords||(part.forward?e.c:e.c.slice().reverse()),directed=signedEdgeSlope(e,part.forward);if(known){profile.push([length,raw0+(raw1-raw0)*t0],[length+len,raw0+(raw1-raw0)*t1]);}else heightsComplete=false;length+=len;shaded+=len*shades[part.i];ascent+=Math.max(0,dz);descent+=Math.max(0,-dz);if(e.steps&&len>.01)steps++;if(e.escalator&&len>.01)escalators++;if(e.surface){quality.surfaceKnown+=len;if(e.surface===3)quality.poorSurface+=len;}if(directed!==null){quality.slopeKnown+=len;quality.maxUphill=Math.max(quality.maxUphill,directed);quality.maxDownhill=Math.max(quality.maxDownhill,-directed);}if(e.width>0){quality.widthKnown+=len;quality.minWidth=quality.minWidth===null?e.width:Math.min(quality.minWidth,e.width);}if(e.wheelchair){quality.wheelchairKnown+=len;if(e.wheelchair>=2)quality.limitedWheelchair+=len;}for(const p of segment)if(!coords.length||Math.hypot(coords.at(-1)[0]-p[0],coords.at(-1)[1]-p[1])>.001)coords.push(p);}\r\n  const speed=Math.max(1,options.speedMpm||75),ascentMinutes=options.ascentMinutesPer10m??1;\r\n  for(const key of ['surfaceKnown','slopeKnown','widthKnown','wheelchairKnown','poorSurface','limitedWheelchair'])quality[key]=length?quality[key]/length:0;\r\n  return {path:parts,coords,profile:heightsComplete?profile:[],length,shade:length?shaded/length:0,ascent:heightsComplete?ascent:null,descent:heightsComplete?descent:null,steps,escalators,quality,criteria:{maxSlope:options.maxSlope||0,avoidPoorSurface:Boolean(options.avoidPoorSurface),avoidWheelchairNo:Boolean(options.avoidWheelchairNo),avoidSteps:Boolean(options.avoidSteps),avoidEscalators:Boolean(options.avoidEscalators)},minutes:heightsComplete?Math.ceil(length/speed+ascent/10*ascentMinutes):null,timeModel:{speedMpm:speed,ascentMinutesPer10m:ascentMinutes,estimated:true},snaps:[a.p,b.p],snapDistances:[a.distance,b.distance]};\r\n }\r\n}\r\nfunction hasRestrictions(options){return Boolean(options.avoidSteps||options.avoidEscalators||options.avoidPoorSurface||options.avoidWheelchairNo||options.maxSlope);}\r\n\r\nfunction relaxationTiers(options={}){\r\n const base=resolvedOptions(options),tiers=[{options:base,relaxed:[]}],current={...base},relaxed=[];\r\n const relax=(key,label,value)=>{if(!current[key])return;current[key]=value;relaxed.push(label);tiers.push({options:{...current},relaxed:[...relaxed]});};\r\n // Keep physical barriers until the last possible stages. Strong gradients and\r\n // surface quality are relaxed first, then wheelchair tags, escalators and stairs.\r\n relax('maxSlope','maxSlope',0);\r\n relax('avoidPoorSurface','poorSurface',false);\r\n relax('avoidWheelchairNo','wheelchairNo',false);\r\n relax('avoidEscalators','escalators',false);\r\n relax('avoidSteps','steps',false);\r\n return tiers;\r\n}\r\n\r\n// Same search radii as the server (engine.py SNAP_STEPS): a point inside a construction site still gets a route.\r\nconst SNAP_STEPS=[50,300,1500,5000];\r\n// Requirements of the requested profile that edge e breaks in this direction (engine.py violations, drawn in orange).\r\nfunction edgeViolations(e,forward,options={}){\r\n const found=[],slope=signedEdgeSlope(e,forward);\r\n if(options.avoidSteps&&e.steps)found.push('steps');\r\n if(options.avoidEscalators&&e.escalator)found.push('escalator');\r\n if(options.avoidPoorSurface&&e.surface===3)found.push('poorSurface');\r\n if(options.avoidWheelchairNo&&e.wheelchair===3)found.push('wheelchairNo');\r\n if(options.maxSlope&&slope!==null&&Math.abs(slope)>options.maxSlope)found.push('maxSlope');\r\n return found;\r\n}\r\nfunction bestAvailableRoute(network,adj,shades,start,end,options={},componentResolver=null){\r\n const requestedProfile=options.mobilityProfile||'standard',tiers=relaxationTiers(options);let last={error:'outside'},usedOptions=tiers[0].options;\r\n for(const [step,radius] of SNAP_STEPS.entries()){\r\n  const maxSnap=Math.max(radius,options.maxSnap||0);\r\n  for(let level=0;level<tiers.length;level++){\r\n   const tier=tiers[level],candidateOptions={...tier.options,maxSnap};\r\n   if(componentResolver)candidateOptions.components=componentResolver(candidateOptions);\r\n   const candidate=route(network,adj,shades,start,end,candidateOptions);if(step===0||candidate.error!=='outside')last=candidate;usedOptions=candidateOptions;\r\n   if(!candidate.error){\r\n    candidate.fallbackLevel=level;candidate.relaxedCriteria=tier.relaxed;candidate.requestedProfile=requestedProfile;candidate.snapWidened=step>0;\r\n    candidate.warnings=candidate.path.map(part=>({part,reasons:edgeViolations(network.edges[part.i],part.forward,tiers[0].options)})).filter(w=>w.reasons.length)\r\n     .map(({part,reasons})=>{const slope=signedEdgeSlope(network.edges[part.i],part.forward);return {coords:part.coords||(part.forward?network.edges[part.i].c:network.edges[part.i].c.slice().reverse()),reasons,slope:slope===null?null:Math.abs(slope),limit:tiers[0].options.maxSlope||null};});\r\n    return {result:candidate,usedOptions};\r\n   }\r\n   if(candidate.error==='same')return {result:candidate,usedOptions};\r\n   if(candidate.error!=='profileBlocked')break;\r\n  }\r\n }\r\n return {result:last,usedOptions};\r\n}\r\n\r\n\n// API 0.2 metadata describes oriented route pieces. Atlas heights are interpolated,\n// not resampled from terrain; unknown attributes must remain unknown.\nconst ROUTING_API='https://138.2.184.1';\nfunction usesServerRouting(options={}) {\n return options.preference==='balanced' && (!options.mobilityProfile||options.mobilityProfile==='standard') && !options.gentle && (!options.slopeMode||options.slopeMode==='none') && !['avoidSteps','avoidEscalators','avoidPoorSurface','avoidWheelchairNo','maxSlope'].some(key=>options[key]);\n}\nasync function requestServerRoute(start,end,{signal,fetchImpl=fetch}={}) {\n const url=new URL('/route',ROUTING_API);\n for(const [key,value] of Object.entries({start_lon:start[0],start_lat:start[1],end_lon:end[0],end_lat:end[1],profile:'shortest',max_snap_m:50,include_segments:true}))url.searchParams.set(key,String(value));\n const response=await fetchImpl(url,{signal,headers:{Accept:'application/json'},credentials:'omit'});\n if(!response.ok){let detail='';try{detail=(await response.json()).detail||'';}catch{}const error=new Error(String(detail||'Routing service unavailable'));error.routeError=response.status===404?(detail.includes('within')?'serverOutside':'disconnected'):'serverUnavailable';throw error;}\n const data=await response.json();\n if(data?.type!=='FeatureCollection'||data.properties?.profile!=='shortest'||data.properties?.segment_metadata_version!==1||!Array.isArray(data.properties.segments))throw Error('Invalid routing metadata');\n return data;\n}\nfunction atlasNumber(value){if(value===null||value===undefined||String(value).trim()==='')return null;const n=Number(value);return Number.isFinite(n)?n:null;}\nfunction osmTags(value){if(typeof value==='string'){try{return JSON.parse(value);}catch{return {};}}return value&&typeof value==='object'?value:{};}\nfunction adaptServerRoute(data,toLocal,shadeFractions=null) {\n const p=data.properties,segments=p.segments;\n if(!Number.isFinite(p.distance_m)||p.distance_m<0||segments.length!==p.route_parts)throw Error('Invalid route length or segment count');\n if(!segments.length){if(p.distance_m>.01)throw Error('Missing route pieces');return {error:'same'};}\n let length=0,ascent=0,descent=0,heightsComplete=true,shaded=0,steps=0,escalators=0,previousStairs=null,previousEscalator=null;\n const coords=[],profile=[],quality={surfaceKnown:0,slopeKnown:0,widthKnown:0,wheelchairKnown:0,poorSurface:0,limitedWheelchair:0,maxUphill:null,maxDownhill:null,minWidth:null};\n for(let i=0;i<segments.length;i++){\n  const s=segments[i],a=s.atlas_attributes||{},tags=osmTags(a.routing_osm_tags),len=s.length_m,t0=s.atlas_t0,t1=s.atlas_t1;\n  if(!Number.isFinite(len)||len<=0||![t0,t1].every(t=>Number.isFinite(t)&&t>=0&&t<=1)||s.geometry?.type!=='LineString'||s.geometry.coordinates.length<2)throw Error('Invalid route piece');\n  const points=s.geometry.coordinates.map(point=>{if(!Array.isArray(point)||!point.every(Number.isFinite))throw Error('Invalid coordinate');return toLocal(point);});\n  if(coords.length&&Math.hypot(coords.at(-1)[0]-points[0][0],coords.at(-1)[1]-points[0][1])>.03)throw Error('Route geometry has a gap');\n  coords.push(...(coords.length?points.slice(1):points));\n  const z0=atlasNumber(a.elev_start),z1=atlasNumber(a.elev_end);\n  if(z0!==null&&z1!==null){const start=z0+(z1-z0)*t0,end=z0+(z1-z0)*t1,dz=end-start;profile.push([length,start],[length+len,end]);ascent+=Math.max(0,dz);descent+=Math.max(0,-dz);const slope=dz/len*100;quality.slopeKnown+=len;quality.maxUphill=Math.max(quality.maxUphill??0,slope);quality.maxDownhill=Math.max(quality.maxDownhill??0,-slope);}else heightsComplete=false;\n  if(['good','medium','poor'].includes(a.surface_class)){quality.surfaceKnown+=len;if(a.surface_class==='poor')quality.poorSurface+=len;}\n  const width=atlasNumber(a.width);if(width!==null&&width>0){quality.widthKnown+=len;quality.minWidth=Math.min(quality.minWidth??Infinity,width);}\n  if(['yes','designated','limited','no'].includes(a.wheelchair)){quality.wheelchairKnown+=len;if(['limited','no'].includes(a.wheelchair))quality.limitedWheelchair+=len;}\n  const stairs=tags.highway==='steps'||a.fclass==='steps',escalator=tags.conveying&&tags.conveying!=='no';\n  if(stairs&&previousStairs!==s.atlas_fid)steps++;previousStairs=stairs?s.atlas_fid:null;\n  if(escalator&&previousEscalator!==s.atlas_fid)escalators++;previousEscalator=escalator?s.atlas_fid:null;\n  if(shadeFractions){const f=shadeFractions[i];if(!Number.isFinite(f)||f<0||f>1)throw Error('Invalid route shade');shaded+=len*f;}\n  length+=len;\n }\n if(Math.abs(length-p.distance_m)>.1)throw Error('Route length does not match its pieces');\n const line=data.features?.[0]?.geometry;if(line?.type!=='LineString'||line.coordinates.length<2)throw Error('Missing route line');\n const supplied=line.coordinates.map(toLocal);if(supplied.length!==coords.length||supplied.some((point,i)=>Math.hypot(point[0]-coords[i][0],point[1]-coords[i][1])>.03))throw Error('Route line does not match its pieces');\n for(const key of ['surfaceKnown','slopeKnown','widthKnown','wheelchairKnown','poorSurface','limitedWheelchair'])quality[key]/=length;\n return {source:'server',path:[],coords:supplied,profile:heightsComplete?profile:[],length:p.distance_m,shade:shadeFractions?shaded/length:null,ascent:heightsComplete?ascent:null,descent:heightsComplete?descent:null,steps,escalators,quality,criteria:{},minutes:heightsComplete?Math.ceil(length/75+ascent/10):null,timeModel:{speedMpm:75,ascentMinutesPer10m:1,estimated:true},snaps:[p.snapped_start,p.snapped_end].map(toLocal),snapDistances:[p.start_snap_distance_m,p.end_snap_distance_m],calculationMs:p.calculation_ms};\n}\n\n\n\n// API 0.3 preparation. This is deliberately not enabled against API 0.2.\nconst PROFILE_CONTRACT_VERSION=1;\nfunction buildProfileRequest(start,end,options,{iso,leafOn=true}={}) {\n if(![start,end].every(p=>Array.isArray(p)&&p.length===2&&p.every(Number.isFinite)))throw Error('Invalid endpoints');\n const preference=options.preference||'balanced',mobilityProfile=options.mobilityProfile||'standard';\n if(!['balanced','shade','sun'].includes(preference)||!['standard','wheelchair','powerWheelchair','walkingAid','vision','stroller','custom'].includes(mobilityProfile))throw Error('Unsupported profile');\n if(['shade','sun'].includes(preference)&&(!iso||!Number.isFinite(Date.parse(iso))))throw Error('Sun/shade routing requires a time');\n const resolved=resolvedOptions({...options,preference,mobilityProfile});\n return {contract_version:PROFILE_CONTRACT_VERSION,start,end,max_snap_m:50,include_segments:true,preference,mobility_profile:mobilityProfile,options:resolved,time:iso||null,timezone:'Europe/Berlin',leaf_on:leafOn,tiers:relaxationTiers(resolved).map(tier=>({options:tier.options,relaxed_criteria:tier.relaxed}))};\n}\nfunction supportsProfileContract(capabilities,request) {\n return capabilities?.profile_contract_version===PROFILE_CONTRACT_VERSION&&capabilities?.topology==='audited-osm-nodes'&&capabilities?.segment_metadata_version===1&&capabilities.preferences?.includes(request.preference)&&capabilities.mobility_profiles?.includes(request.mobility_profile)&&(!['shade','sun'].includes(request.preference)||capabilities.shadow_model==='geometric-time-aware');\n}\nfunction directedProfileCosts(piece,options,shadeFraction=null) {\n if(!Number.isFinite(piece.l)||piece.l<=0)throw Error('Invalid edge length');\n const resolved=resolvedOptions(options);\n if(['shade','sun'].includes(resolved.preference)&&(!Number.isFinite(shadeFraction)||shadeFraction<0||shadeFraction>1))throw Error('Shadow fraction is required; unknown is not zero');\n const cost=forward=>edgeAllowed(piece,resolved,forward)?piece.l*edgeCostMultiplier(piece,resolved,shadeFraction||0,forward):-1;\n return {cost:piece.dir===-1?-1:cost(true),reverse_cost:piece.dir===1?-1:cost(false)};\n}\n\n// Prepared adapter only. It is deliberately absent from the application bundle.\r\n\r\n\r\n\r\nconst same=(a,b)=>{\r\n if(a===b)return true;\r\n if(!a||!b||typeof a!=='object'||typeof b!=='object'||Array.isArray(a)!==Array.isArray(b))return false;\r\n const keys=Object.keys(a);return keys.length===Object.keys(b).length&&keys.every(key=>Object.hasOwn(b,key)&&same(a[key],b[key]));\r\n};\r\nconst canonical=options=>{const value={...options};delete value.solarWeight;return value;};\r\n\r\nfunction buildProfileV1Request(start,end,options,{allowRelaxation=false,...context}={}){\r\n if(typeof allowRelaxation!=='boolean')throw Error('Relaxation requires an explicit boolean');\r\n return {...buildProfileRequest(start,end,options,context),allow_relaxation:allowRelaxation};\r\n}\r\n\r\nfunction supportsProfileV1(capabilities,request,{preview=false}={}){\r\n return capabilities?.profile_contract_version===1&&capabilities.segment_metadata_version===1&&\r\n  capabilities.topology==='audited-osm-nodes'&&capabilities.preferences?.includes(request.preference)&&\r\n  capabilities.mobility_profiles?.includes(request.mobility_profile)&&capabilities.strict_by_default===true&&\r\n  (!request.allow_relaxation||capabilities.explicit_relaxation===true)&&\r\n  (capabilities.production_ready===true||(preview===true&&capabilities.deployment_stage==='local-preview'))&&\r\n  (request.preference==='balanced'||capabilities.shadow_model==='geometric-time-aware');\r\n}\r\n\r\nfunction adaptProfileV1Route(data,toLocal,request){\r\n const p=data?.properties;\r\n if(p?.profile_contract_version!==1||p.segment_metadata_version!==1||p.requested_profile!==request.mobility_profile||p.preference!==request.preference)throw Error('Mismatched profile response');\r\n const level=p.fallback_level,tier=request.tiers[level];\r\n if(!Number.isInteger(level)||level<0||!tier||(level&&!request.allow_relaxation)||\r\n  !same(p.relaxed_criteria,tier.relaxed_criteria)||!same(p.effective_options,canonical(tier.options)))throw Error('Unpermitted effective profile');\r\n // The legacy validator checks every oriented piece, connection and route line.\r\n // V1 treats non-numeric/invalid source elevations as unknown, just as Python.\r\n const normalized={...data,properties:{...p,segments:p.segments?.map(segment=>{\r\n  const a={...segment.atlas_attributes};for(const key of ['elev_start','elev_end'])if(!Number.isFinite(a[key])||a[key]<100)a[key]=null;\r\n  return {...segment,atlas_attributes:a};\r\n })}};\r\n const route=adaptServerRoute(normalized,toLocal);if(route.error)return route;\r\n // The server computes the shade share with the browser's shadow model; sun/shade routes must report it.\r\n if((p.shade!==null&&!(Number.isFinite(p.shade)&&p.shade>=0&&p.shade<=1))||(request.preference!=='balanced'&&p.shade===null))throw Error('Invalid profile exposure');\r\n const options=p.effective_options,model=p.time_model;\r\n if(!same(model,{speedMpm:options.speedMpm,ascentMinutesPer10m:options.ascentMinutesPer10m,estimated:true}))throw Error('Invalid profile time model');\r\n const known=route.profile.length>0;\r\n for(const key of ['ascent_m','descent_m'])if(known?(!Number.isFinite(p[key])||p[key]<0):p[key]!==null)throw Error('Invalid profile elevations');\r\n if(known?(!Number.isInteger(p.estimated_minutes)||p.estimated_minutes<0):p.estimated_minutes!==null)throw Error('Invalid profile duration');\r\n if(!Array.isArray(p.elevation_profile)||p.elevation_profile.length!==route.profile.length||p.elevation_profile.some((point,i)=>!Array.isArray(point)||point.length!==2||point.some((value,j)=>!Number.isFinite(value)||Math.abs(value-route.profile[i][j])>.03)))throw Error('Inconsistent elevation profile');\r\n const coverage=p.attribute_coverage;\r\n if(!coverage||['surface','width','wheelchair','elevation'].some(key=>!Number.isFinite(coverage[key])||coverage[key]<0||coverage[key]>1+1e-9))throw Error('Invalid profile coverage');\r\n Object.assign(route.quality,{surfaceKnown:coverage.surface,widthKnown:coverage.width,wheelchairKnown:coverage.wheelchair,slopeKnown:coverage.elevation});\r\n // Pieces that break the requested profile (after relaxation) are drawn in orange.\r\n const warnings=(p.segments||[]).filter(segment=>Array.isArray(segment.profile_violations)&&segment.profile_violations.length)\r\n  .map(segment=>{const a=segment.atlas_attributes||{},slope=a.slope_pct===null||a.slope_pct===undefined?NaN:Math.abs(+a.slope_pct);return {coords:segment.geometry.coordinates.map(toLocal),reasons:segment.profile_violations,slope:Number.isFinite(slope)?slope:null,surface:a.surface||null,name:a.display_name||a.name||null,limit:request.tiers?.[0]?.options?.maxSlope||null};});\r\n return {...route,source:'server-profile-v1',shade:p.shade,warnings,snapWidened:p.snap_widened===true,minutes:p.estimated_minutes,ascent:p.ascent_m,descent:p.descent_m,\r\n  profile:p.elevation_profile,timeModel:model,criteria:options,effectiveOptions:options,\r\n  requestedProfile:p.requested_profile,relaxedCriteria:p.relaxed_criteria,fallbackLevel:level};\r\n}\r\n\r\nasync function requestProfileV1(start,end,options,{baseURL,preview=false,capabilities=null,signal,fetchImpl=fetch,...context}={}){\r\n if(!baseURL)throw Error('An explicit profile API URL is required');\r\n const base=new URL(baseURL.endsWith('/')?baseURL:baseURL+'/');\r\n if(!['http:','https:'].includes(base.protocol))throw Error('Unsupported profile API URL');\r\n const request=buildProfileV1Request(start,end,options,context);\r\n if(!capabilities){const response=await fetchImpl(new URL('capabilities',base),{signal,credentials:'omit',headers:{Accept:'application/json'}});if(!response.ok)throw Error('Profile capabilities unavailable');capabilities=await response.json();}\r\n if(!supportsProfileV1(capabilities,request,{preview}))throw Error('Profile API is not accepted for this request');\r\n const response=await fetchImpl(new URL('v1/route',base),{method:'POST',signal,credentials:'omit',headers:{Accept:'application/json','Content-Type':'application/json'},body:JSON.stringify(request)});\r\n const data=await response.json();if(!response.ok){const error=new Error('Profile route unavailable');error.code=data?.error;error.status=response.status;error.routeError=({candidate_search_limited:'serverSearchLimited',search_budget_exceeded:'serverSearchLimited',no_matching_snap:'serverOutside',same_point:'same',busy:'serverBusy',no_route:request.mobility_profile==='standard'?'disconnected':'profileBlocked'})[data?.error]||'serverUnavailable';throw error;}\r\n return {data,request};\r\n}\r\n\nlet profileCapabilities=null;\n// Preview: every route comes from the Stage-2 server; failures are reported, never recomputed locally.\nasync function profileV2Route({profileApi,lonlat,options,iso,serverPreview=true}){\n try{\n  const signal=AbortSignal.timeout(20000),toLocal=p=>[(p[0]-meta.origin[0])*meta.scale[0],(p[1]-meta.origin[1])*meta.scale[1]];\n  if(!profileCapabilities){const response=await fetch(new URL('capabilities',profileApi),{signal,credentials:'omit',headers:{Accept:'application/json'}});if(!response.ok)throw Error('capabilities');profileCapabilities=await response.json();}\n  const context={baseURL:profileApi,preview:serverPreview,capabilities:profileCapabilities,signal,iso,allowRelaxation:true};\n  if(!supportsProfileV1(profileCapabilities,buildProfileV1Request(lonlat[0],lonlat[1],options,{iso,allowRelaxation:true}),{preview:serverPreview}))return {result:{error:'serverUnavailable'}};\n  const {data,request}=await requestProfileV1(lonlat[0],lonlat[1],options,context),result=adaptProfileV1Route(data,toLocal,request);\n  if(result.error||options.preference==='balanced')return {result,shortest:result};\n  // The detour against the direct route (\"+x m\") also comes from the server.\n  let shortest=result;try{const direct=await requestProfileV1(lonlat[0],lonlat[1],{...options,preference:'balanced'},context);shortest=adaptProfileV1Route(direct.data,toLocal,direct.request);}catch{}\n  return {result,shortest:shortest.error?result:shortest};\n }catch(error){return {result:{error:error.routeError||'serverUnavailable'}};}\n}\nlet network,obstacles={buildings:[],trees:[]},activeEdgeIds=null,activeTiles=null,meta,adj,componentCache=new Map(),shades=[];\n\nlet cityLoadPromise=null,cityInit=null;\nasync function ensureNetwork(){if(!cityInit)return;if(!cityLoadPromise)cityLoadPromise=loadCity(cityInit.manifest,cityInit.base).catch(error=>{cityLoadPromise=null;throw error;});await cityLoadPromise;}\nfunction finishNetwork(){adj=buildAdj(network);componentCache=new Map();shades=new Float32Array(network.edges.length);if(!cityInit)self.postMessage({type:'ready'});}\n\nasync function fetchBinary(files,base,label){\n const names=Array.isArray(files)?files:[files],buffers=await Promise.all(names.map(name=>fetch(new URL(name,base)).then(r=>{if(!r.ok)throw Error(label);return r.arrayBuffer();})));\n const length=buffers.reduce((sum,buffer)=>sum+buffer.byteLength,0),combined=new Uint8Array(length);let offset=0;\n for(const buffer of buffers){combined.set(new Uint8Array(buffer),offset);offset+=buffer.byteLength;}\n return combined.buffer;\n}\n\nasync function fetchMapping(files,base,label){\n const names=Array.isArray(files)?files:[files],parts=await Promise.all(names.map(name=>fetch(new URL(name,base)).then(r=>{if(!r.ok)throw Error(label);return r.json();})));\n return Object.assign({},...parts);\n}\n\nasync function loadCity(manifest,base){\n meta=manifest;\n // The server's own graph (scripts/export_server_network.py) when published: blocked ways are already left out.\n const graph=manifest.routingNetwork||manifest.network,blockedFile=manifest.routingNetwork?null:graph.accessBlocked?.file,[nodeBuffer,edgeBuffer,snapIndex,blockedBuffer]=await Promise.all([\n  fetchBinary(graph.nodes,base,'nodes'),\n  fetchBinary(graph.edges,base,'edges'),\n  fetchMapping(graph.snapIndex,base,'snap index'),\n  blockedFile?fetchBinary(blockedFile,base,'access blocks'):null,\n ]);\n // A declared but unusable block list must fail loudly, never route through blocked ways.\n const blocked=blockedBuffer&&new Uint8Array(blockedBuffer);if(blockedFile&&blocked.length!==Math.ceil(graph.edgeCount/8))throw Error('access blocks');\n const nodeView=new DataView(nodeBuffer),edgeView=new DataView(edgeBuffer),nodes=new Array(graph.nodeCount),edges=new Array(graph.edgeCount);\n for(let i=0;i<nodes.length;i++){const o=i*8;nodes[i]=[nodeView.getFloat32(o,true),nodeView.getFloat32(o+4,true)];}\n const stride=graph.edgeStride||32;\n for(let i=0;i<edges.length;i++){const o=i*stride,a=edgeView.getUint32(o,true),b=edgeView.getUint32(o+4,true),flags=edgeView.getUint8(o+29),sf=edgeView.getFloat32(o+16,true),mobility=stride>=48?edgeView.getUint16(o+32,true):0;edges[i]={a,b,c:[nodes[a],nodes[b]],l:edgeView.getFloat32(o+8,true),s:edgeView.getFloat32(o+12,true),sf:Number.isNaN(sf)?null:sf,z0:edgeView.getFloat32(o+20,true),z1:edgeView.getFloat32(o+24,true),dz:edgeView.getFloat32(o+24,true)-edgeView.getFloat32(o+20,true),dir:edgeView.getInt8(o+28),steps:Boolean(flags&1),covered:Boolean(flags&2),sq:edgeView.getUint8(o+30),tactile:Boolean(mobility&1),handrail:Boolean(mobility&2),ramp:Boolean(mobility&4),escalator:Boolean(mobility&8),surface:stride>=48?edgeView.getUint8(o+34):0,way:stride>=48?edgeView.getUint8(o+35):0,width:stride>=48?edgeView.getUint16(o+36,true)/10:0,bench:stride>=48?edgeView.getUint16(o+38,true):65535,shelter:stride>=48?edgeView.getUint16(o+40,true):65535,crossing:stride>=48?edgeView.getUint8(o+42):0,wheelchair:stride>=48?edgeView.getUint8(o+43):0,accessBlocked:Boolean(blocked&&blocked[i>>3]&1<<(i&7))};}\n network={nodes,edges,snapIndex,snapGrid:graph.snapGrid};finishNetwork();\n}\n\nself.onmessage=async({data:d})=>{try{\n if(d.type==='init'){({network,obstacles,meta}=d);finishNetwork();return;}\n if(d.type==='initCity'){cityInit=d;meta=d.manifest;network={nodes:[],edges:[]};self.postMessage({type:'ready'});return;}\n if(d.type==='obstacles'){obstacles=d.obstacles;activeTiles=d.tiles||null;activeEdgeIds=d.edgeIds||null;return;}\n if(d.type==='shade'){if(d.routeAware)await ensureNetwork();\n const center=d.center||[meta.origin[0],meta.origin[1]],sun=sunPosition(new Date(d.iso),center[1],center[0]),polys=makeShadows(obstacles,sun,d.leafOn,d.preview?{preview:true,treeSteps:8}:undefined);\n // Tile edge ids belong to the display network; with the server graph the corridor is chosen by edge midpoint tile, as on the server.\n if(d.routeAware&&meta.routingNetwork&&activeTiles){const grid=+meta.obstacles.grid,keys=new Set(activeTiles);activeEdgeIds=[];network.edges.forEach((e,i)=>{if(keys.has(`${Math.floor((e.c[0][0]+e.c[1][0])/2/grid)}_${Math.floor((e.c[0][1]+e.c[1][1])/2/grid)}`))activeEdgeIds.push(i);});}\n if(d.routeAware){if(activeEdgeIds){const visibleEdges=activeEdgeIds.map(i=>network.edges[i]),visibleShades=edgeShades(visibleEdges,polys,sun.altitude<=0),next=new Float32Array(network.edges.length);activeEdgeIds.forEach((edgeId,index)=>{next[edgeId]=visibleShades[index];});shades=next;}else shades=edgeShades(network.edges,polys,sun.altitude<=0);}\n const bounds=d.bounds||meta.bounds,maxRaster=d.preview?384:1024,aspect=(bounds[3]-bounds[1])*meta.scale[1]/((bounds[2]-bounds[0])*meta.scale[0]);let width=maxRaster,height=Math.max(1,Math.round(width*aspect));if(height>maxRaster){height=maxRaster;width=Math.max(1,Math.round(height/aspect));}\n const canvas=new OffscreenCanvas(width,height),ctx=canvas.getContext('2d');ctx.fillStyle='#24364f';\n const x0=(bounds[0]-meta.origin[0])*meta.scale[0],y1=(bounds[3]-meta.origin[1])*meta.scale[1],xs=width/((bounds[2]-bounds[0])*meta.scale[0]),ys=height/((bounds[3]-bounds[1])*meta.scale[1]);\n for(const rings of polys){ctx.beginPath();for(const ring of rings){for(let i=0;i<ring.length;i++){const x=(ring[i][0]-x0)*xs,y=(y1-ring[i][1])*ys;i?ctx.lineTo(x,y):ctx.moveTo(x,y);}ctx.closePath();}ctx.fill('evenodd');}\n const blob=await canvas.convertToBlob({type:'image/png'});\n self.postMessage({type:'shade',id:d.id,sun,blob,bounds});return;\n }\n if(d.type==='serverRoute'){\n  try {\n   const toLocal=p=>[(p[0]-meta.origin[0])*meta.scale[0],(p[1]-meta.origin[1])*meta.scale[1]],segments=d.route.properties.segments;\n   let fractions=null;\n   if(d.obstacles){const sun=sunPosition(new Date(d.iso),d.center[1],d.center[0]),polys=makeShadows(d.obstacles,sun,d.leafOn);fractions=edgeShades(segments.map(s=>{let tags={};try{tags=typeof s.atlas_attributes.routing_osm_tags==='string'?JSON.parse(s.atlas_attributes.routing_osm_tags):s.atlas_attributes.routing_osm_tags||{};}catch{}return {c:s.geometry.coordinates.map(toLocal),covered:tags.tunnel==='yes'||tags.covered==='yes'};}),polys,sun.altitude<=0);}\n   const result=adaptServerRoute(d.route,toLocal,fractions);self.postMessage({type:'route',id:d.id,result,shortest:result});\n  } catch(error){self.postMessage({type:'route',id:d.id,result:{error:'serverUnavailable'}});}\n  return;\n }\n if(d.type==='route'){if(d.profileApi){const via=await profileV2Route(d);self.postMessage({type:'route',id:d.id,result:via.result,shortest:via.shortest||via.result});return;}await ensureNetwork();const componentsFor=options=>{const key=[options.avoidSteps,options.avoidEscalators,options.avoidPoorSurface,options.avoidWheelchairNo,options.maxSlope||0].map(value=>String(value??false)).join(':');if(!componentCache.has(key))componentCache.set(key,buildComponents(network,options));return componentCache.get(key);},best=bestAvailableRoute(network,adj,shades,d.start,d.end,d.options,componentsFor),result=best.result,shortest=result.error||best.usedOptions.preference==='balanced'?result:route(network,adj,shades,d.start,d.end,{...best.usedOptions,preference:'balanced'});self.postMessage({type:'route',id:d.id,result,shortest});}\n }catch(e){if(d.type==='route')self.postMessage({type:'route',id:d.id,result:{error:'modelFailed',detail:String(e?.stack||e).slice(0,600)}});else self.postMessage({type:'error',message:e.message,id:d.id});}};\n\n";
const BUNDLED_POI_ICONS={"Signalized_Crossings.svg":"data:image/svg+xml;base64,PD94bWwgdmVyc2lvbj0iMS4wIiBlbmNvZGluZz0iVVRGLTgiPz4KPHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgd2lkdGg9IjI0IiBoZWlnaHQ9IjI0Ij4KPHRpdGxlPlNpZ25hbGl6ZWQgY3Jvc3Npbmc8L3RpdGxlPgo8ZGVzYz5PcmlnaW5hbCBnZW9tZXRyaWMgc3ltYm9sIHByZXBhcmVkIGZvciBQZWRlc3RyaWFuIEF0bGFzIFN0dXR0Z2FydCwgMjcgT2N0b2JlciAyMDI2LiBObyBpbXBvcnRlZCB0aGlyZC1wYXJ0eSBwYXRocy48L2Rlc2M+CjxnIGZpbGw9InBhcmFtKGZpbGwpICMwMDAwMDAiIGZpbGwtb3BhY2l0eT0icGFyYW0oZmlsbC1vcGFjaXR5KSAxIj48cGF0aCBmaWxsLXJ1bGU9ImV2ZW5vZGQiIGQ9Ik03IDFoMTB2MThIN3ptMiAydjE0aDZWM1oiLz48Y2lyY2xlIGN4PSIxMiIgY3k9IjUiIHI9IjEuNSIvPjxjaXJjbGUgY3g9IjEyIiBjeT0iMTAiIHI9IjEuNSIvPjxjaXJjbGUgY3g9IjEyIiBjeT0iMTUiIHI9IjEuNSIvPjxwYXRoIGQ9Ik0xMSAxOWgydjRoLTJ6Ii8+PC9nPgo8L3N2Zz4K","Elevators.svg":"data:image/svg+xml;base64,PD94bWwgdmVyc2lvbj0iMS4wIiBlbmNvZGluZz0iVVRGLTgiPz4KPHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgd2lkdGg9IjI0IiBoZWlnaHQ9IjI0Ij4KPHRpdGxlPkVsZXZhdG9yPC90aXRsZT4KPGRlc2M+T3JpZ2luYWwgZ2VvbWV0cmljIHN5bWJvbCBwcmVwYXJlZCBmb3IgUGVkZXN0cmlhbiBBdGxhcyBTdHV0dGdhcnQsIDI3IE9jdG9iZXIgMjAyNi4gTm8gaW1wb3J0ZWQgdGhpcmQtcGFydHkgcGF0aHMuPC9kZXNjPgo8ZyBmaWxsPSJwYXJhbShmaWxsKSAjMDAwMDAwIiBmaWxsLW9wYWNpdHk9InBhcmFtKGZpbGwtb3BhY2l0eSkgMSI+PHBhdGggZmlsbC1ydWxlPSJldmVub2RkIiBkPSJNMiAyaDIwdjIwSDJ6bTIgMnYxNmgxNlY0WiIvPjxwYXRoIGQ9Im04IDYtMyA0aDJ2N2gydi03aDJ6bTggMTIgMy00aC0yVjdoLTJ2N2gtMnoiLz48L2c+Cjwvc3ZnPgo=","Ramps.svg":"data:image/svg+xml;base64,PD94bWwgdmVyc2lvbj0iMS4wIiBlbmNvZGluZz0iVVRGLTgiPz4KPHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgd2lkdGg9IjI0IiBoZWlnaHQ9IjI0Ij4KPHRpdGxlPlJhbXA8L3RpdGxlPgo8ZGVzYz5PcmlnaW5hbCBnZW9tZXRyaWMgc3ltYm9sIHByZXBhcmVkIGZvciBQZWRlc3RyaWFuIEF0bGFzIFN0dXR0Z2FydCwgMjcgT2N0b2JlciAyMDI2LiBObyBpbXBvcnRlZCB0aGlyZC1wYXJ0eSBwYXRocy48L2Rlc2M+CjxnIGZpbGw9InBhcmFtKGZpbGwpICMwMDAwMDAiIGZpbGwtb3BhY2l0eT0icGFyYW0oZmlsbC1vcGFjaXR5KSAxIj48cGF0aCBkPSJNMiAxOSAyMSA1djE0WiIvPjxwYXRoIGQ9Ik0yIDIxaDIwdjJIMnoiLz48L2c+Cjwvc3ZnPgo=","Escalators.svg":"data:image/svg+xml;base64,PD94bWwgdmVyc2lvbj0iMS4wIiBlbmNvZGluZz0iVVRGLTgiPz4KPHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgd2lkdGg9IjI0IiBoZWlnaHQ9IjI0Ij4KPHRpdGxlPkVzY2FsYXRvcjwvdGl0bGU+CjxkZXNjPk9yaWdpbmFsIGdlb21ldHJpYyBzeW1ib2wgcHJlcGFyZWQgZm9yIFBlZGVzdHJpYW4gQXRsYXMgU3R1dHRnYXJ0LCAyNyBPY3RvYmVyIDIwMjYuIE5vIGltcG9ydGVkIHRoaXJkLXBhcnR5IHBhdGhzLjwvZGVzYz4KPGcgZmlsbD0icGFyYW0oZmlsbCkgIzAwMDAwMCIgZmlsbC1vcGFjaXR5PSJwYXJhbShmaWxsLW9wYWNpdHkpIDEiPjxwYXRoIGZpbGwtcnVsZT0iZXZlbm9kZCIgZD0iTTMgMTdoNGw5LTEwaDV2NWgtNEw4IDIySDN6bTIgMnYxaDJsOS0xMGgzVjloLTJMOCAxOVoiLz48Y2lyY2xlIGN4PSI5IiBjeT0iNSIgcj0iMiIvPjxwYXRoIGQ9Ik03IDhoNHY1bC00IDR6Ii8+PC9nPgo8L3N2Zz4K","Stairs.svg":"data:image/svg+xml;base64,PD94bWwgdmVyc2lvbj0iMS4wIiBlbmNvZGluZz0iVVRGLTgiPz4KPHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgd2lkdGg9IjI0IiBoZWlnaHQ9IjI0Ij4KPHRpdGxlPlN0YWlyczwvdGl0bGU+CjxkZXNjPk9yaWdpbmFsIGdlb21ldHJpYyBzeW1ib2wgcHJlcGFyZWQgZm9yIFBlZGVzdHJpYW4gQXRsYXMgU3R1dHRnYXJ0LCAyNyBPY3RvYmVyIDIwMjYuIE5vIGltcG9ydGVkIHRoaXJkLXBhcnR5IHBhdGhzLjwvZGVzYz4KPGcgZmlsbD0icGFyYW0oZmlsbCkgIzAwMDAwMCIgZmlsbC1vcGFjaXR5PSJwYXJhbShmaWxsLW9wYWNpdHkpIDEiPjxwYXRoIGQ9Ik0yIDE5aDV2LTVoNVY5aDVWNGg1djNoLTJ2NWgtNXY1aC01djVIMloiLz48L2c+Cjwvc3ZnPgo=","Barriers_and_Gates.svg":"data:image/svg+xml;base64,PD94bWwgdmVyc2lvbj0iMS4wIiBlbmNvZGluZz0iVVRGLTgiPz4KPHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgd2lkdGg9IjI0IiBoZWlnaHQ9IjI0Ij4KPHRpdGxlPkdhdGUgb3IgYmFycmllcjwvdGl0bGU+CjxkZXNjPk9yaWdpbmFsIGdlb21ldHJpYyBzeW1ib2wgcHJlcGFyZWQgZm9yIFBlZGVzdHJpYW4gQXRsYXMgU3R1dHRnYXJ0LCAyNyBPY3RvYmVyIDIwMjYuIE5vIGltcG9ydGVkIHRoaXJkLXBhcnR5IHBhdGhzLjwvZGVzYz4KPGcgZmlsbD0icGFyYW0oZmlsbCkgIzAwMDAwMCIgZmlsbC1vcGFjaXR5PSJwYXJhbShmaWxsLW9wYWNpdHkpIDEiPjxwYXRoIGQ9Ik0zIDVoMnYxN0gzem0xNiAwaDJ2MTdoLTJ6TTUgN2gxNHYzSDV6bTAgOGgxNHYzSDV6Ii8+PHBhdGggZD0ibTYgMTAgMTEgNWgtNGwtNy0zeiIvPjwvZz4KPC9zdmc+Cg==","Lowered_Curbs.svg":"data:image/svg+xml;base64,PD94bWwgdmVyc2lvbj0iMS4wIiBlbmNvZGluZz0iVVRGLTgiPz4KPHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgd2lkdGg9IjI0IiBoZWlnaHQ9IjI0Ij4KPHRpdGxlPkxvd2VyZWQgY3VyYjwvdGl0bGU+CjxkZXNjPk9yaWdpbmFsIGdlb21ldHJpYyBzeW1ib2wgcHJlcGFyZWQgZm9yIFBlZGVzdHJpYW4gQXRsYXMgU3R1dHRnYXJ0LCAyNyBPY3RvYmVyIDIwMjYuIE5vIGltcG9ydGVkIHRoaXJkLXBhcnR5IHBhdGhzLjwvZGVzYz4KPGcgZmlsbD0icGFyYW0oZmlsbCkgIzAwMDAwMCIgZmlsbC1vcGFjaXR5PSJwYXJhbShmaWxsLW9wYWNpdHkpIDEiPjxwYXRoIGQ9Ik0yIDdoN3YySDJ6bTYgMCA4IDgtMS40IDEuNC04LTh6TTE1IDE1aDd2MmgtN3pNMiAyMWgyMHYxSDJ6Ii8+PC9nPgo8L3N2Zz4K","Raised_Curbs.svg":"data:image/svg+xml;base64,PD94bWwgdmVyc2lvbj0iMS4wIiBlbmNvZGluZz0iVVRGLTgiPz4KPHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgd2lkdGg9IjI0IiBoZWlnaHQ9IjI0Ij4KPHRpdGxlPlJhaXNlZCBjdXJiPC90aXRsZT4KPGRlc2M+T3JpZ2luYWwgZ2VvbWV0cmljIHN5bWJvbCBwcmVwYXJlZCBmb3IgUGVkZXN0cmlhbiBBdGxhcyBTdHV0dGdhcnQsIDI3IE9jdG9iZXIgMjAyNi4gTm8gaW1wb3J0ZWQgdGhpcmQtcGFydHkgcGF0aHMuPC9kZXNjPgo8ZyBmaWxsPSJwYXJhbShmaWxsKSAjMDAwMDAwIiBmaWxsLW9wYWNpdHk9InBhcmFtKGZpbGwtb3BhY2l0eSkgMSI+PHBhdGggZD0iTTIgN2gxMXY5aDl2MkgxMVY5SDJ6TTIgMjFoMjB2MUgyeiIvPjwvZz4KPC9zdmc+Cg==","Benches.svg":"data:image/svg+xml;base64,PD94bWwgdmVyc2lvbj0iMS4wIiBlbmNvZGluZz0iVVRGLTgiPz4KPHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgd2lkdGg9IjI0IiBoZWlnaHQ9IjI0Ij4KPHRpdGxlPkJlbmNoPC90aXRsZT4KPGRlc2M+T3JpZ2luYWwgZ2VvbWV0cmljIHN5bWJvbCBwcmVwYXJlZCBmb3IgUGVkZXN0cmlhbiBBdGxhcyBTdHV0dGdhcnQsIDI3IE9jdG9iZXIgMjAyNi4gTm8gaW1wb3J0ZWQgdGhpcmQtcGFydHkgcGF0aHMuPC9kZXNjPgo8ZyBmaWxsPSJwYXJhbShmaWxsKSAjMDAwMDAwIiBmaWxsLW9wYWNpdHk9InBhcmFtKGZpbGwtb3BhY2l0eSkgMSI+PHBhdGggZD0iTTMgN2gxOHYzSDN6bTAgNWgxOHYzSDN6bTIgNGgzdjZINXptMTEgMGgzdjZoLTN6Ii8+PC9nPgo8L3N2Zz4K","Shelters.svg":"data:image/svg+xml;base64,PD94bWwgdmVyc2lvbj0iMS4wIiBlbmNvZGluZz0iVVRGLTgiPz4KPHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgd2lkdGg9IjI0IiBoZWlnaHQ9IjI0Ij4KPHRpdGxlPlNoZWx0ZXIgd2l0aCBzZWF0aW5nPC90aXRsZT4KPGRlc2M+T3JpZ2luYWwgZ2VvbWV0cmljIHN5bWJvbCBwcmVwYXJlZCBmb3IgUGVkZXN0cmlhbiBBdGxhcyBTdHV0dGdhcnQsIDI3IE9jdG9iZXIgMjAyNi4gTm8gaW1wb3J0ZWQgdGhpcmQtcGFydHkgcGF0aHMuPC9kZXNjPgo8ZyBmaWxsPSJwYXJhbShmaWxsKSAjMDAwMDAwIiBmaWxsLW9wYWNpdHk9InBhcmFtKGZpbGwtb3BhY2l0eSkgMSI+PHBhdGggZD0iTTEgOCAxMiAxbDExIDctMSAyLTEwLTZMMiAxMHptMiAyaDJ2MTJIM3ptMTYgMGgydjEyaC0yek03IDEyaDEwdjNIN3ptMCA1aDEwdjJIN3ptMSAyaDJ2M0g4em02IDBoMnYzaC0yeiIvPjwvZz4KPC9zdmc+Cg=="};
// Central dictionary of interface texts (German / English). Interface code never chooses a
// language inline: it calls tr('key') or t('key') (older `strings` table in app.source.mjs).
const UI_TEXT={de:{
 cached:'gespeichert',
 locale:'de-DE',
 forecast:'Vorhersage',
 sunEffectEstimatedFromClouds:'Sonnenwirkung aus Wolkenanteil',
 data:'Daten: ',
 modified:'; bearbeitet. ',
 map:'Karte: ',
 aerialImagery:'Luftbild: ',
 weather:'Wetter: ',
 allSourcesAndLicences:'Alle Quellen und Lizenzen',
 everyRouteIsCalculatedOn:'Alle Routen werden auf dem Sonnenpfad-Server berechnet; dafür werden Start, Ziel, Profil und Zeitpunkt übertragen und nicht gespeichert.',
 inThisPreviewRoutesAre:'In dieser Vorschau werden Routen auf deinem Gerät berechnet.',
 standardDirectRoutesSendStart:'Standard-Direktrouten senden Start und Ziel an den Sonnenpfad-Server. Andere Profile werden derzeit auf deinem Gerät berechnet.',
 de:'EN',
 aufDeutschWechseln:'Switch to English',
 signalCrossingQualityInThe:'Ampelqualität im Fußgängeratlas',
 colourSoundVibrationAndTactile:'Farbe: Ton, Vibration und taktiles Leitsystem. Rollstuhleignung steht separat im Detailfenster.',
 poorSurface:'Schlechte Oberfläche',
 barriersNearTheRoute:'Barrieren nahe der Route',
 raisedKerbsNearTheRoute:'Erhöhte Bordsteine nahe der Route',
 surface:'Oberfläche',
 gradient:'Steigung',
 wheelchairSuitability:'Rollstuhleignung',
 thisIsTheBestPossible:'Das ist die bestmögliche Route. Orange markierte Abschnitte erfüllen dein Profil nicht (',
 profileSetting:'Profileinstellung',
 weDoNotRecommendThem:'). Wir empfehlen sie nicht; tippe auf ein oranges Stück für den Grund und prüfe es vor Ort.',
 suitabilityInformationMissingShareOf:'Angaben zur Eignung fehlen (Anteil der Strecke): ',
 theseSectionsAreNotConfirmed:'. Diese Abschnitte sind nicht als geeignet bestätigt. Bitte vor Ort prüfen.',
 crossingEquipmentIsOftenNot:'Die Ausstattung von Ampeln ist oft nicht erfasst. Ampeln ohne Angaben werden nicht abgewertet. Bitte vor Ort prüfen.',
 calculatedOnTheSonnenpfadServer:'Berechnet auf dem Sonnenpfad-Server.',
 noRouteFullyMeetsYour:'Keine Route erfüllt dein Profil vollständig',
 routeNotices:'Hinweise zur Route',
 walkingTime:'Gehzeit',
 de2:'en',
 myLocation:'Mein Standort',
 yes:'Ja',
 no:'Nein',
 otherValue:'Abweichende Angabe',
 unknown:'Unbekannt',
 source:'Quelle: ',
 doorWidth:'Türbreite',
 cabinWidth:'Kabinenbreite',
 cabinLength:'Kabinenlänge',
 wheelchairSuitability2:'Rollstuhleignung',
 connection:'Verbindung',
 levels:'Ebenen',
 speechOutput:'Sprachausgabe',
 tactileWriting:'Taktile Schrift',
 access:'Zugang',
 operator:'Betreiber',
 recorded:'Erfasst',
 length:'Länge',
 width:'Breite',
 gradient2:'Längsneigung',
 crossSlope:'Querneigung',
 direction:'Richtung',
 reversible:'Umkehrbar',
 duration:'Dauer',
 steps:'Stufen',
 stepHeight:'Stufenhöhe',
 leftHandrail:'Handlauf links',
 rightHandrail:'Handlauf rechts',
 centreHandrail:'Handlauf Mitte',
 bicycleGroove:'Fahrradrille',
 type:'Art',
 passageWidth:'Durchgangsbreite',
 pedestrianAccess:'Fußverkehr',
 bicycle:'Fahrrad',
 locked:'Verschlossen',
 openingHours:'Öffnungszeiten',
 kerb:'Bordstein',
 kerbHeight:'Bordsteinhöhe',
 tactilePaving:'Taktiles Leitsystem',
 surface2:'Oberfläche',
 crossing:'Querung',
 trafficIsland:'Mittelinsel',
 backrest:'Rückenlehne',
 armrests:'Armlehnen',
 seats:'Sitzplätze',
 covered:'Überdacht',
 lit:'Beleuchtet',
 material:'Material',
 bench:'Sitzbank',
 bin:'Abfalleimer',
 departureBoard:'Abfahrtstafel',
 quality:'Qualität',
 tactile:'Taktil',
 audible:'Akustisch',
 stairs:'Treppe',
 bridge:'Brücke',
 tunnel:'Tunnel',
 pathSegment:'Wegsegment',
 slope:'Steigung',
 summerShade:'Schatten Sommer',
 winterShade:'Schatten Winter',
 summer:'Sommer',
 winter:'Winter',
 noise:'Lärm',
 relativeWindExposure:'Relative Windexposition',
 streetNetwork:'Straßennetz',
 district:'Stadtbezirk',
 name:'Name',
 atlasId:'Atlas-ID',
 noValue:'Wert fehlt',
 sourceStuttgartPedestrianAtlasDistrict:'Quelle: Fußgängeratlas Stuttgart · Arbeitsbestand der Bezirksauswertung',
 loadingDetails:'Details werden geladen …',
 detailsCouldNotLoadClick:'Details konnten nicht geladen werden. Bitte erneut klicken.',
 yourSettings:'deine Einstellungen',
 stepsCannotBePassedOr:'Stufen sind für diese Gruppe nicht oder nur schwer passierbar.',
 escalator:'Rolltreppe',
 notSafeWithAWheelchair:'Mit Rollstuhl, Rollator oder Kinderwagen nicht sicher nutzbar.',
 anUnevenSurfaceMakesRolling:'Unebener Belag erschwert Rollen und Gehen.',
 notWheelchairAccessible:'Nicht rollstuhlgerecht',
 recordedAsWheelchairNoIn:'Im Fußgängeratlas als „Rollstuhl: nein“ erfasst.',
 gradient3:'Steigung ',
 steeperThanYourSettingsAllow:'Steiler als in deinen Einstellungen erlaubt.',
 noConnectionMeetsEveryRequirement:'Keine Verbindung erfüllt alle Anforderungen, deshalb führt die Route hier entlang. Bitte vor Ort prüfen.',
 developmentPreviewRoutesMayDiffer:'Entwicklungsversion · Routen können von der veröffentlichten App abweichen.',
 topographic:'Topografisch',
 aerial:'Luftbild',
 basemap:'Hintergrundkarte',
 mapCredits:'Kartenquellen',
 explore:'Entdecken',
 exploreStuttgart:'Stuttgart entdecken',
 chooseMapLayersThenClick:'Wähle Kartenebenen und klicke auf Wege oder Orte, um mehr zu erfahren.',
 chooseMapLayers:'Kartenebenen wählen',
 switchTo2d:'Zur 2D-Karte',
 viewTheCityIn3d:'Stadt in 3D ansehen',
 exploreFreelySwitchToRoute:'Karte frei erkunden. Zur Routenplanung wechseln.',
 routePlanningActiveSwitchTo:'Routenplanung aktiv. Frei erkunden einschalten.',
 resume:'Fortsetzen',
 pause:'Pause',
 stop:'Stopp',
 previewSpeed:'Vorschaugeschwindigkeit',
 editRoute:'Route bearbeiten',
 showWeatherAndDate:'Wetter und Datum einblenden',
 confirmPoint:'Punkt übernehmen',
 cancel:'Abbrechen',
 stopPreview:'■ Vorschau beenden',
 ndRoutePreview:'▶ 3D-Routenvorschau',
 elevationProfileMoveThePointer:'Höhenprofil: Zeiger bewegen, um die Position auf der Karte zu sehen',
 nextHowWouldYouLike:'Weiter: Wie möchtest du gehen? →',
 changeStartAndDestination:'‹ Start und Ziel ändern',
 useMyLocationAsStart:'⌖ Meinen Standort als Start',
 checkDistricts:'Bezirke prüfen',
 allDistricts:'Alle Stadtbezirke',
 districts:'Bezirke',
 onlyGradientAbove:'Nur Steigung über',
 showSectionsWithoutAValue:'Abschnitte ohne Wert zeigen (grau)',
 showStairs:'Treppen einblenden',
 reset:'Zurücksetzen',
 loadingData:'Daten werden geladen …',
 noSectionMatchesThisSelection:'Kein Abschnitt passt zu dieser Auswahl. Grenzwert senken oder andere Bezirke wählen.',
 all:'Alle',
 none:'Keine',
 basisThesisWorkingNetworkWays:'Grundlage: Arbeitsbestand der Bezirksauswertung, Wege an Bezirksgrenzen geschnitten. Steigung ohne Richtung; Werte über 30 % entfernt.',
 districtDataCouldNotBe:'Bezirksdaten konnten nicht geladen werden.',
 gradient4:'Steigung > ',
 turnLeft:'Links abbiegen',
 turnRight:'Rechts abbiegen',
 keepSlightlyLeft:'Leicht links halten',
 keepSlightlyRight:'Leicht rechts halten',
 turnSharpLeft:'Scharf links abbiegen',
 turnSharpRight:'Scharf rechts abbiegen',
 turnAround:'Wenden',
 arriveAtDestination:'Ziel erreichen',
 continueStraight:'Geradeaus weiter',
 startWalking:'Losgehen',
 after:'nach ',
 startNavigation:'▶ Navigation starten',
 go:'▶ Los',
 end:'Beenden',
 recalculate:'Neu berechnen',
 findingYourLocation:'Standort wird gesucht …',
 youLeftTheRoute:'Du bist von der Route abgekommen',
 youHaveArrived:'Ziel erreicht',
 recalculating:'Route wird neu berechnet …',
 aboutBody:`<p><strong>Sonnenpfad</strong> und der {atlas} sind Projekte von {author}, Autor und Inhaber.</p><p>Plane Fußwege mit mehr Schatten, mehr Sonne oder passenden Mobilitätseinstellungen.</p><p>Gehzeit und Schatten sind Schätzungen. Angaben zur Zugänglichkeit können fehlen; beachte die Hinweise zur Route und die Situation vor Ort.</p><p><strong>Datenschutz:</strong> {privacy} Geteilte Links enthalten die gewählten Orte. Wetteranfragen verwenden einen festen Punkt in Stuttgart.</p>`,
 atlasName:'Fußgängeratlas Stuttgart',
 sunDirectionLabel:'Sonne: {altitude} Grad Höhe, {azimuth} Grad Azimut',
 snapFarNote:'Start oder Ziel liegt {metres} m vom nächsten begehbaren Weg entfernt (z. B. Baustelle oder Gleisanlage). Die gestrichelte Linie zeigt nur die Richtung zum Weg.',
 crossingSource:'Quelle: Fußgängeratlas Stuttgart · {layer} · Stand {date}',
 crossingLayer:'Ampelübergänge',
 atlasSource:'Quelle: Fußgängeratlas Stuttgart{layer} · Stand {date}',
 limitFor:'Grenze für {group}: {limit}. Steilere Abschnitte sind ohne Hilfe kaum zu schaffen.',
 notRecommendedFor:'Für {group} nicht empfohlen',
 plannerMissing:' · davon {count} ohne Wert (grau)',
 plannerSections:'{count} Abschnitte · {km} km{parts}{gaps}',
 directionsTitle:'Wegbeschreibung · {count} Schritte',
 relaxedMaxSlope:'zu steile Abschnitte',
 relaxedPoorSurface:'schlechte Oberfläche',
 relaxedWheelchairNo:'für Rollstühle ungeeignet',
 relaxedEscalators:'Rolltreppen',
 relaxedSteps:'Treppen',
 stairSectionOne:'Treppenabschnitt',
 stairSectionMany:'Treppenabschnitte',
 escalatorOne:'Rolltreppe',
 escalatorMany:'Rolltreppen',
 audibleSignal:'Akustisches Signal',
 vibrationSignal:'Vibrationssignal',
 tactilePaving:'Taktiles Leitsystem',
 wheelchairSuitability:'Rollstuhleignung',
 wheelchairYes:'Ja',
 wheelchairLimited:'Eingeschränkt',
 wheelchairNo:'Nein',
 unknownValue:'Unbekannt',
 kerb:'Bordstein',
 kerbLowered:'Abgesenkt',
 kerbFlush:'Bündig',
 kerbRaised:'Erhöht',
 kerbNone:'Kein Bordstein',
 buttonOperated:'Tasterbetrieb',
 trafficIsland:'Mittelinsel',
 marking:'Markierung',
 lighting:'Beleuchtung',
 surfaceGood:'Gut',
 surfaceMedium:'Mittel',
 surfacePoor:'Schlecht',
 tipModeRoute:'Route planen',
 tipModeExplore:'Stuttgart erkunden',
 tipView:'Zwischen 2D und 3D wechseln',
 creditsHide:'Kartenquellen ausblenden',
 creditsShow:'Kartenquellen einblenden',
 pickBarStart:'Karte verschieben · Start festlegen',
 pickBarEnd:'Karte verschieben · Ziel festlegen',
 stepWhere:'Wohin?',
 stepHow:'Wie?',
 stepRoute:'Route',
 searchPlaceholder:'Ort oder Adresse suchen',
 chooseOnMap:'Auf Karte wählen',
 walkTimeMin:'Gehzeit · min',
 previewSpeed:'Vorschaugeschwindigkeit',
 elevationChart:'Höhenprofil der Route',
 cancel:'Abbrechen',
 confirmPoint:'Punkt übernehmen',
 basemapTopo:'Topografisch · OpenTopoMap',
 basemapAerial:'Luftbild · LGL BW',
 cloudCover:'Bewölkung',
 directRadiation:'Direkte Strahlung',
 modeRouting:'Routing',
 modeExplore:'Entdecken',
 mlZoomIn:'Hineinzoomen',
 mlZoomOut:'Herauszoomen',
 mlResetBearing:'Karte nach Norden ausrichten',
 mlClosePopup:'Fenster schließen',
 mlToggleAttribution:'Kartenquellen ein- oder ausblenden',
 mlMapTitle:'Karte',
 mlMapFeedback:'Karte verbessern',
 analysisTitle:'Analyse',
 filterHeading:'Filter (alle Bedingungen gelten zugleich)',
 resetAll:'Alles zurücksetzen',
 wholeCity:'Ganz Stuttgart',
 analysisSource:'Grundlage: Arbeitsbestand der Bezirksauswertung (Fußgängeratlas Stuttgart), Wege an Bezirksgrenzen geschnitten. Steigung ohne Richtung; Werte über 30 % entfernt. „Ohne Angabe“ heißt: nicht erfasst – nicht „Nein“.',
 exportCsv:'CSV herunterladen',
 exportGeojson:'GeoJSON (QGIS) herunterladen',
 exportNote:'Nur die gefilterten Abschnitte · Koordinaten EPSG:4326 (WGS 84), Geometrie als WKT · UTF-8 · Daten unter ODbL 1.0, © OpenStreetMap-Mitwirkende',
 filterNot:'nicht',
 filterRemove:'Filter entfernen',
 filterOperator:'Vergleich',
 op_gt:'größer als',
 op_lt:'kleiner als',
 op_eq:'gleich',
 op_between:'zwischen',
 filterValue:'Wert',
 filterValueTo:'bis',
 filterMode:'Auswahl',
 mode_include:'nur diese',
 mode_exclude:'alle außer diesen',
 filterIncludeMissing:'Abschnitte ohne Angabe einbeziehen',
 filterAdd:'+ Filter hinzufügen',
 networkShare:'{share} % des Netzes im Gebiet',
 privacyUsage:'<strong>Nutzungsstatistik:</strong> Ohne Cookies und ohne etwas auf deinem Gerät zu speichern, zählen wir, welche Funktionen genutzt werden (z. B. „Route berechnet“ oder der Bezirk einer Analyse). IP-Adressen, Standorte und Routenpunkte werden nicht gespeichert; Besucher werden pro Tag über einen täglich gelöschten Zufallsschlüssel geschätzt. Mit „Do Not Track“ oder „Global Privacy Control“ wird nichts gezählt.',
 adminLink:'Verwaltung',
},en:{
 cached:'cached',
 locale:'en-GB',
 forecast:'Forecast',
 sunEffectEstimatedFromClouds:'Sun effect estimated from clouds',
 data:'Data: ',
 modified:'; modified. ',
 map:'Map: ',
 aerialImagery:'Aerial imagery: ',
 weather:'Weather: ',
 allSourcesAndLicences:'All sources and licences',
 everyRouteIsCalculatedOn:'Every route is calculated on the Sonnenpfad server; start, destination, profile and time are sent for this and not stored.',
 inThisPreviewRoutesAre:'In this preview, routes are calculated on your device.',
 standardDirectRoutesSendStart:'Standard Direct routes send start and destination to the Sonnenpfad server. Other profiles currently run on your device.',
 de:'DE',
 aufDeutschWechseln:'Auf Deutsch wechseln',
 signalCrossingQualityInThe:'Signal-crossing quality in the pedestrian atlas',
 colourSoundVibrationAndTactile:'Colour: sound, vibration and tactile paving. Wheelchair suitability is shown separately in the detail popup.',
 poorSurface:'Poor surface',
 barriersNearTheRoute:'Barriers near the route',
 raisedKerbsNearTheRoute:'Raised kerbs near the route',
 surface:'surface',
 gradient:'gradient',
 wheelchairSuitability:'wheelchair suitability',
 thisIsTheBestPossible:'This is the best possible route. Sections in orange do not meet your profile (',
 profileSetting:'profile setting',
 weDoNotRecommendThem:'). We do not recommend them; tap an orange piece for the reason and check it on site.',
 suitabilityInformationMissingShareOf:'Suitability information missing (share of route): ',
 theseSectionsAreNotConfirmed:'. These sections are not confirmed as suitable. Check on site.',
 crossingEquipmentIsOftenNot:'Crossing equipment is often not recorded. Crossings without data are not penalised. Check on site.',
 calculatedOnTheSonnenpfadServer:'Calculated on the Sonnenpfad server.',
 noRouteFullyMeetsYour:'No route fully meets your profile',
 routeNotices:'Route notices',
 walkingTime:'Walking time',
 de2:'de',
 myLocation:'My location',
 yes:'Yes',
 no:'No',
 otherValue:'Other value',
 unknown:'Unknown',
 source:'Source: ',
 doorWidth:'Door width',
 cabinWidth:'Cabin width',
 cabinLength:'Cabin length',
 wheelchairSuitability2:'Wheelchair suitability',
 connection:'Connection',
 levels:'Levels',
 speechOutput:'Speech output',
 tactileWriting:'Tactile writing',
 access:'Access',
 operator:'Operator',
 recorded:'Recorded',
 length:'Length',
 width:'Width',
 gradient2:'Gradient',
 crossSlope:'Cross slope',
 direction:'Direction',
 reversible:'Reversible',
 duration:'Duration',
 steps:'Steps',
 stepHeight:'Step height',
 leftHandrail:'Left handrail',
 rightHandrail:'Right handrail',
 centreHandrail:'Centre handrail',
 bicycleGroove:'Bicycle groove',
 type:'Type',
 passageWidth:'Passage width',
 pedestrianAccess:'Pedestrian access',
 bicycle:'Bicycle',
 locked:'Locked',
 openingHours:'Opening hours',
 kerb:'Kerb',
 kerbHeight:'Kerb height',
 tactilePaving:'Tactile paving',
 surface2:'Surface',
 crossing:'Crossing',
 trafficIsland:'Traffic island',
 backrest:'Backrest',
 armrests:'Armrests',
 seats:'Seats',
 covered:'Covered',
 lit:'Lit',
 material:'Material',
 bench:'Bench',
 bin:'Bin',
 departureBoard:'Departure board',
 quality:'Quality',
 tactile:'Tactile',
 audible:'Audible',
 stairs:'Stairs',
 bridge:'Bridge',
 tunnel:'Tunnel',
 pathSegment:'Path segment',
 slope:'Slope',
 summerShade:'Summer shade',
 winterShade:'Winter shade',
 summer:'summer',
 winter:'winter',
 noise:'Noise',
 relativeWindExposure:'Relative wind exposure',
 streetNetwork:'street network',
 district:'District',
 name:'Name',
 atlasId:'Atlas ID',
 noValue:'No value',
 sourceStuttgartPedestrianAtlasDistrict:'Source: Stuttgart Pedestrian Atlas · district working network',
 loadingDetails:'Loading details …',
 detailsCouldNotLoadClick:'Details could not load. Click again to retry.',
 yourSettings:'your settings',
 stepsCannotBePassedOr:'Steps cannot be passed, or only with difficulty, by this group.',
 escalator:'Escalator',
 notSafeWithAWheelchair:'Not safe with a wheelchair, walker or pushchair.',
 anUnevenSurfaceMakesRolling:'An uneven surface makes rolling and walking harder.',
 notWheelchairAccessible:'Not wheelchair accessible',
 recordedAsWheelchairNoIn:'Recorded as “wheelchair: no” in the pedestrian atlas.',
 gradient3:'Gradient ',
 steeperThanYourSettingsAllow:'Steeper than your settings allow.',
 noConnectionMeetsEveryRequirement:'No connection meets every requirement, so the route passes here. Please check on site.',
 developmentPreviewRoutesMayDiffer:'Development preview · Routes may differ from the published app.',
 topographic:'Topographic',
 aerial:'Aerial',
 basemap:'Basemap',
 mapCredits:'Map credits',
 explore:'Explore',
 exploreStuttgart:'Explore Stuttgart',
 chooseMapLayersThenClick:'Choose map layers, then click paths or places to learn more.',
 chooseMapLayers:'Choose map layers',
 switchTo2d:'Switch to 2D',
 viewTheCityIn3d:'View the city in 3D',
 exploreFreelySwitchToRoute:'Explore freely. Switch to route planning.',
 routePlanningActiveSwitchTo:'Route planning active. Switch to free exploration.',
 resume:'Resume',
 pause:'Pause',
 stop:'Stop',
 previewSpeed:'Preview speed',
 editRoute:'Edit route',
 showWeatherAndDate:'Show weather and date',
 confirmPoint:'Confirm point',
 cancel:'Cancel',
 stopPreview:'■ Stop preview',
 ndRoutePreview:'▶ 3D route preview',
 elevationProfileMoveThePointer:'Elevation profile: move the pointer to see the location on the map',
 nextHowWouldYouLike:'Next: how would you like to walk? →',
 changeStartAndDestination:'‹ Change start and destination',
 useMyLocationAsStart:'⌖ Use my location as start',
 checkDistricts:'Check districts',
 allDistricts:'All districts',
 districts:'districts',
 onlyGradientAbove:'Only gradient above',
 showSectionsWithoutAValue:'Show sections without a value (grey)',
 showStairs:'Show stairs',
 reset:'Reset',
 loadingData:'Loading data …',
 noSectionMatchesThisSelection:'No section matches this selection. Lower the threshold or choose other districts.',
 all:'All',
 none:'None',
 basisThesisWorkingNetworkWays:'Basis: thesis working network, ways cut at district borders. Gradient regardless of direction; values above 30 % removed.',
 districtDataCouldNotBe:'District data could not be loaded.',
 gradient4:'Gradient > ',
 turnLeft:'Turn left',
 turnRight:'Turn right',
 keepSlightlyLeft:'Keep slightly left',
 keepSlightlyRight:'Keep slightly right',
 turnSharpLeft:'Turn sharp left',
 turnSharpRight:'Turn sharp right',
 turnAround:'Turn around',
 arriveAtDestination:'Arrive at destination',
 continueStraight:'Continue straight',
 startWalking:'Start walking',
 after:'after ',
 startNavigation:'▶ Start navigation',
 go:'▶ Go',
 end:'End',
 recalculate:'Recalculate',
 findingYourLocation:'Finding your location …',
 youLeftTheRoute:'You left the route',
 youHaveArrived:'You have arrived',
 recalculating:'Recalculating …',
 aboutBody:`<p><strong>Sonnenpfad</strong> and the {atlas} are projects by {author}, author and owner.</p><p>Plan walks with more shade, more sun or mobility settings that suit you.</p><p>Walking time and shade are estimates. Accessibility information may be missing; check route notices and conditions on site.</p><p><strong>Privacy:</strong> {privacy} Shared links contain the selected places. Weather requests use a fixed point in Stuttgart.</p>`,
 atlasName:'Stuttgart Pedestrian Atlas',
 sunDirectionLabel:'Sun: {altitude} degrees elevation, {azimuth} degrees azimuth',
 snapFarNote:'Start or destination is {metres} m from the nearest walkable way (e.g. construction site or railway). The dashed line only shows the direction to it.',
 crossingSource:'Source: Stuttgart Pedestrian Atlas · {layer} · data {date}',
 crossingLayer:'signal crossings',
 atlasSource:'Source: Stuttgart Pedestrian Atlas{layer} · data {date}',
 limitFor:'Limit for {group}: {limit}. Steeper sections are hard to manage without help.',
 notRecommendedFor:'Not recommended for {group}',
 plannerMissing:' · {count} without a value (grey)',
 plannerSections:'{count} sections · {km} km{parts}{gaps}',
 directionsTitle:'Directions · {count} steps',
 relaxedMaxSlope:'steep sections',
 relaxedPoorSurface:'poor surface',
 relaxedWheelchairNo:'not suitable for wheelchairs',
 relaxedEscalators:'escalators',
 relaxedSteps:'stairs',
 stairSectionOne:'stair section',
 stairSectionMany:'stair sections',
 escalatorOne:'escalator',
 escalatorMany:'escalators',
 audibleSignal:'Audible signal',
 vibrationSignal:'Vibration signal',
 tactilePaving:'Tactile paving',
 wheelchairSuitability:'Wheelchair suitability',
 wheelchairYes:'Yes',
 wheelchairLimited:'Limited',
 wheelchairNo:'No',
 unknownValue:'Unknown',
 kerb:'Kerb',
 kerbLowered:'Lowered',
 kerbFlush:'Flush',
 kerbRaised:'Raised',
 kerbNone:'No kerb',
 buttonOperated:'Button operated',
 trafficIsland:'Traffic island',
 marking:'Marking',
 lighting:'Lighting',
 surfaceGood:'Good',
 surfaceMedium:'Medium',
 surfacePoor:'Poor',
 tipModeRoute:'Plan a route',
 tipModeExplore:'Explore Stuttgart',
 tipView:'Switch between 2D and 3D',
 creditsHide:'Hide map credits',
 creditsShow:'Show map credits',
 pickBarStart:'Move map · choose start',
 pickBarEnd:'Move map · choose destination',
 stepWhere:'Where?',
 stepHow:'How?',
 stepRoute:'Route',
 searchPlaceholder:'Search for a place or address',
 chooseOnMap:'Choose on the map',
 walkTimeMin:'Walking time · min',
 previewSpeed:'Preview speed',
 elevationChart:'Elevation profile of the route',
 cancel:'Cancel',
 confirmPoint:'Use this point',
 basemapTopo:'Topographic · OpenTopoMap',
 basemapAerial:'Aerial image · LGL BW',
 cloudCover:'Cloud cover',
 directRadiation:'Direct radiation',
 modeRouting:'Routing',
 modeExplore:'Explore',
 mlZoomIn:'Zoom in',
 mlZoomOut:'Zoom out',
 mlResetBearing:'Reset bearing to north',
 mlClosePopup:'Close popup',
 mlToggleAttribution:'Toggle attribution',
 mlMapTitle:'Map',
 mlMapFeedback:'Improve this map',
 analysisTitle:'Analysis',
 filterHeading:'Filters (all conditions apply together)',
 resetAll:'Reset all',
 wholeCity:'All of Stuttgart',
 analysisSource:'Basis: thesis working network (Stuttgart Pedestrian Atlas), ways cut at district borders. Gradient regardless of direction; values above 30 % removed. “No value” means not recorded – not “no”.',
 exportCsv:'Download CSV',
 exportGeojson:'Download GeoJSON (QGIS)',
 exportNote:'Filtered sections only · coordinates EPSG:4326 (WGS 84), geometry as WKT · UTF-8 · data under ODbL 1.0, © OpenStreetMap contributors',
 filterNot:'not',
 filterRemove:'Remove filter',
 filterOperator:'Comparison',
 op_gt:'greater than',
 op_lt:'less than',
 op_eq:'equal to',
 op_between:'between',
 filterValue:'Value',
 filterValueTo:'to',
 filterMode:'Selection',
 mode_include:'only these',
 mode_exclude:'all except these',
 filterIncludeMissing:'Include sections without a value',
 filterAdd:'+ Add filter',
 networkShare:'{share} % of the network in the area',
 privacyUsage:'<strong>Usage statistics:</strong> Without cookies and without storing anything on your device, we count which features are used (e.g. “route calculated” or the district of an analysis). IP addresses, locations and route points are not stored; visitors are estimated per day with a random key that is deleted daily. With “Do Not Track” or “Global Privacy Control” nothing is counted.',
 adminLink:'Administration',
}};
// Display names of OpenStreetMap attribute values in detail popups.
const OSM_VALUES={de:{yes:'Ja',no:'Nein',limited:'Eingeschränkt',unknown:'Unbekannt',true:'Ja',false:'Nein',ja:'Ja',nein:'Nein','beide richtungen':'Beide Richtungen',travertine:'Travertin',brick:'Ziegel',metal_construction:'Metallkonstruktion',permit:'Mit Genehmigung',delivery:'Lieferverkehr',rolled:'Abgerundet',public_transport:'ÖPNV-Unterstand',lean_to:'Offener Unterstand',rolling:'Rolltor',uphill:'Bergauf',downhill:'Bergab',marked:'Markiert',timetable:'Fahrplanaushang',nondenominational:'Konfessionsunabhängig (Quellangabe)',wood:'Holz',metal:'Metall',steel:'Stahl',stainless_steel:'Edelstahl',concrete:'Beton',plastic:'Kunststoff',stone:'Stein',granite:'Granit',aluminium:'Aluminium',asphalt:'Asphalt',paved:'Befestigt',unpaved:'Unbefestigt',paving_stones:'Pflastersteine',sett:'Natursteinpflaster',cobblestone:'Kopfsteinpflaster',gravel:'Schotter',fine_gravel:'Feiner Kies',compacted:'Wassergebundene Decke',ground:'Naturboden',dirt:'Erde',grass:'Gras',sand:'Sand',rubber:'Gummi',raised:'Erhöht',lowered:'Abgesenkt',flush:'Bündig',up:'Aufwärts',down:'Abwärts',both:'Beide Richtungen',forward:'Vorwärts',backward:'Rückwärts',public:'Öffentlich',private:'Privat',permissive:'Geduldet',customers:'Nur für Kundschaft',designated:'Ausgewiesen',destination:'Anliegerverkehr',gate:'Tor',bollard:'Poller',cycle_barrier:'Umlaufsperre',lift_gate:'Schranke',kissing_gate:'Personenschleuse',swing_gate:'Schwenktor',bus_stop:'Bushaltestelle',weather_shelter:'Wetterschutzhütte',basic_hut:'Einfache Schutzhütte',picnic_shelter:'Picknickunterstand',building_passage:'Gebäudedurchgang',zebra:'Zebrastreifen',uncontrolled:'Ungeregelt',traffic_signals:'Ampel',unmarked:'Ohne Markierung'},en:{yes:'Yes',no:'No',limited:'Limited',unknown:'Unknown',true:'Yes',false:'No',ja:'Yes',nein:'No','beide richtungen':'Both directions'}};
// Labels of MapLibre's own controls and popups, in the interface language.
function mapLibreLocale(language){return {'NavigationControl.ZoomIn':tr('mlZoomIn',null,language),'NavigationControl.ZoomOut':tr('mlZoomOut',null,language),'NavigationControl.ResetBearing':tr('mlResetBearing',null,language),'Popup.Close':tr('mlClosePopup',null,language),'AttributionControl.ToggleAttribution':tr('mlToggleAttribution',null,language),'AttributionControl.MapFeedback':tr('mlMapFeedback',null,language),'Map.Title':tr('mlMapTitle',null,language)};}
// `{name}` placeholders are filled from vars; the current interface language is the global `lang`.
function tr(key,vars=null,language=typeof lang==='string'?lang:'de'){
 const table=UI_TEXT[language==='en'?'en':'de'],text=table[key]??UI_TEXT.de[key]??key;
 return vars?text.replace(/\{(\w+)\}/g,(match,name)=>vars[name]??match):text;
}

// Anonymous usage counts for the admin dashboard (services/platform.mjs): no cookies, nothing stored on
// the device, no coordinates. Only on the production hosts and never with Do Not Track / Global Privacy Control.
const USAGE_HOSTS=new Set(['sonnenpfad-stuttgart.de','www.sonnenpfad-stuttgart.de','sonnenpfad-stuttgart.mohammadreza-bakhshi.workers.dev']);
function usageAllowed(environment=globalThis){
 const nav=environment.navigator||{},host=environment.location?.hostname||'';
 return USAGE_HOSTS.has(host)&&nav.doNotTrack!=='1'&&nav.globalPrivacyControl!==true;
}
// Districts are reported, never points: a route start counts for its district only.
function districtAt(point,boundaries){
 const inside=(p,ring)=>{let hit=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){const a=ring[i],b=ring[j];if((a[1]>p[1])!==(b[1]>p[1])&&p[0]<(b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1])+a[0])hit=!hit;}return hit;};
 for(const item of boundaries?.features||[]){if(item.properties?.level!=='district')continue;if(item.geometry.coordinates.some(polygon=>inside(point,polygon[0])&&!polygon.slice(1).some(ring=>inside(point,ring))))return item.properties.id;}
 return null;
}
const usageQueue=[];let usageTimer=0;
function track(type,value){
 if(!usageAllowed())return;
 usageQueue.push({t:type,v:String(value)});clearTimeout(usageTimer);
 if(usageQueue.length>=15)flushUsage();else usageTimer=setTimeout(flushUsage,2000);
}
function flushUsage(){
 if(!usageQueue.length)return;
 const body=JSON.stringify({e:usageQueue.splice(0,20),d:isMobileMap()?'m':'d',l:lang});
 try{if(navigator.sendBeacon?.('/api/event',new Blob([body],{type:'application/json'})))return;}catch{}
 fetch('/api/event',{method:'POST',body,keepalive:true,credentials:'omit',headers:{'Content-Type':'application/json'}}).catch(()=>{});
}
if(typeof document!=='undefined'){addEventListener('pagehide',flushUsage);addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden')flushUsage();});}


// Mobile map gestures never edit endpoints. Choosing a point is a separate,
// explicit centre-and-confirm transaction, cancelled after one committed point.
function isMobileMap(){return innerWidth<=800;}
function syncMapInteraction(){
 document.body.classList.toggle('is-picking',pick!==null);
 const bar=$('map-pick-bar');if(bar){bar.hidden=pick===null||!isMobileMap();$('map-pick-label').textContent=tr(pick===0?'pickBarStart':'pickBarEnd');}
 if(map){map.getCanvas().style.cursor=pick!==null&&!isMobileMap()?'crosshair':exploreMode?'default':'';}
}
function syncMobileDock(){
 const mobile=isMobileMap(),dock=$('mobile-dock'),sheet=$('sidebar-body'),time=document.querySelector('.time-panel'),controls=$('preview-controls');
 if(!dock)return;
 if(mobile){if(time.parentElement!==dock)dock.prepend(time);if(sheet.parentElement!==dock)dock.append(sheet);
  const slot=previewState?$('mobile-preview-slot'):$('preview-controls-home');if(controls.parentElement!==slot)slot.append(controls);
 }else{if(time.parentElement!==mobileTimeHome.parentElement)mobileTimeHome.after(time);if(sheet.parentElement!==mobileSheetHome.parentElement)mobileSheetHome.after(sheet);if(controls.parentElement!==$('preview-controls-home'))$('preview-controls-home').append(controls);const profile=$('elevation-profile');if(profile.parentElement!==$('profile-home'))$('profile-home').append(profile);}
 if(mobile&&result&&!result.error){if($('result').previousElementSibling)$('journey-panel').prepend($('result'));}else if(mobileResultHome&&$('result').previousSibling!==mobileResultHome)mobileResultHome.after($('result'));
 if(mobile){const profile=$('elevation-profile'),slot=previewState?$('mobile-preview-slot'):$('profile-home');if(profile.parentElement!==slot)slot.append(profile);}
 document.body.classList.toggle('has-route',Boolean(result&&!result.error));document.body.classList.toggle('preview-active',Boolean(previewState));
 const summary=$('mobile-route-summary');if(summary){summary.hidden=!result||Boolean(result.error);if(result&&!result.error){$('mobile-route-time').textContent=formatWalkDuration(result.minutes,lang);$('mobile-route-distance').textContent=(result.length/1000).toLocaleString(lang,{maximumFractionDigits:2})+' km';}}
 if(mobile)$('panel-toggle').lastElementChild.textContent=result&&!result.error?(document.body.classList.contains('route-editing')?(tr('editRoute')):t('yourRoute')):t('planRoute');
 if(mobile){const height=Math.ceil(dock.getBoundingClientRect().height);document.documentElement.style.setProperty('--mobile-dock-height',`${height}px`);}
 syncMapInteraction();
}
let mobileTimeHome=null,mobileSheetHome=null,mobileResultHome=null;
function setupMobileExperience(){
 const time=document.querySelector('.time-panel'),sheet=$('sidebar-body');mobileTimeHome=document.createComment('time-home');time.before(mobileTimeHome);mobileSheetHome=document.createComment('sheet-home');sheet.before(mobileSheetHome);
 mobileResultHome=document.createComment('result-home');$('result').before(mobileResultHome);
 const dock=document.createElement('div');dock.id='mobile-dock';document.body.append(dock);
 const summary=document.createElement('div');summary.id='mobile-route-summary';summary.hidden=true;summary.innerHTML='<strong id="mobile-route-time"></strong><span id="mobile-route-distance"></span><button id="mobile-edit-route" type="button" aria-label="Start oder Ziel bearbeiten">✎</button>';$('panel-toggle').after(summary);
 $('mobile-edit-route').onclick=()=>{stopRoutePreview(false);document.body.classList.add('route-editing');sheet.classList.add('expanded');$('panel-toggle').setAttribute('aria-expanded','true');requestAnimationFrame(()=>{sheet.scrollTop=0;syncMobileDock();});};
 const slot=document.createElement('div');slot.id='mobile-preview-slot';summary.after(slot);
 const toggle=document.createElement('button');toggle.id='mobile-weather-toggle';toggle.type='button';toggle.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>';toggle.setAttribute('aria-expanded','false');time.querySelector('.time-top').append(toggle);
 toggle.onclick=()=>{const open=time.classList.toggle('mobile-time-open');toggle.setAttribute('aria-expanded',String(open));syncMobileDock();};
 $('map-pick-confirm').onclick=()=>{if(pick===null||!map)return;const c=map.getCenter();chooseMapPoint([c.lng,c.lat],{forcedIndex:pick});};$('map-pick-cancel').onclick=()=>{finishPickMode(null);hideToast();document.body.classList.remove('route-editing');syncMobileDock();};
 $('panel-toggle').addEventListener('click',()=>requestAnimationFrame(()=>{if(!sheet.classList.contains('expanded')&&pick===null)document.body.classList.remove('route-editing');syncMobileDock();}));
 // Drag only the handle, never the scrollable contents or map. All sheet
 // positions have the same DOM; no duplicated state or intercepted map taps.
 let start=null,lastDrag=-Infinity;const handle=$('panel-toggle');handle.style.touchAction='none';handle.addEventListener('pointerdown',e=>{if(!isMobileMap())return;start=e.clientY;handle.setPointerCapture(e.pointerId);});handle.addEventListener('pointerup',e=>{if(start===null)return;const delta=e.clientY-start;start=null;if(Math.abs(delta)>30){lastDrag=performance.now();sheet.classList.toggle('expanded',delta<0);handle.setAttribute('aria-expanded',String(delta<0));requestAnimationFrame(syncMobileDock);}});handle.addEventListener('pointercancel',()=>start=null);handle.addEventListener('click',e=>{if(performance.now()-lastDrag<500){e.preventDefault();e.stopImmediatePropagation();}},{capture:true});
 if(globalThis.ResizeObserver){new ResizeObserver(()=>requestAnimationFrame(syncMobileDock)).observe(dock);}
 setupMobileSteps();
 window.addEventListener('resize',syncMobileDock);document.addEventListener('keydown',e=>{if(e.key==='Escape'){finishPickMode(null);hideToast();}if(e.key==='Control')document.body.classList.add('map-camera-key');});document.addEventListener('keyup',e=>{if(e.key==='Control')document.body.classList.remove('map-camera-key');});window.addEventListener('blur',()=>document.body.classList.remove('map-camera-key'));
 syncMobileDock();
}

// Mobile journey in three steps (1 where, 2 how, 3 route); the map stays visible above the sheet.
let mobileStep=1;
function mobileStepAllowed(step){return step===1||(step===2&&points.every(Boolean))||(step===3&&Boolean(result&&!result.error));}
function renderMobileSteps(){
 document.body.dataset.mobileStep=String(mobileStep);const de=lang==='de';
 const labels=[tr('stepWhere'),tr('stepHow'),tr('stepRoute')];
 document.querySelectorAll('#mobile-steps [data-step]').forEach(button=>{const step=+button.dataset.step;button.querySelector('span').textContent=labels[step-1];button.disabled=!mobileStepAllowed(step);button.setAttribute('aria-current',step===mobileStep?'step':'false');});
 const next=$('mobile-next');if(next){next.disabled=!points.every(Boolean);next.textContent=tr('nextHowWouldYouLike');}
 const back=$('mobile-back');if(back)back.textContent=tr('changeStartAndDestination');
 const here=$('use-location');if(here)here.textContent=tr('useMyLocationAsStart');
}
function setMobileStep(step,{open=true}={}){
 if(!mobileStepAllowed(step))step=points.every(Boolean)?2:1;mobileStep=step;renderMobileSteps();
 if(open&&isMobileMap()&&!document.body.classList.contains('is-navigating')){$('sidebar-body').classList.add('expanded');$('panel-toggle').setAttribute('aria-expanded','true');$('sidebar-body').scrollTop=0;}
 requestAnimationFrame(syncMobileDock);
}
function setupMobileSteps(){
 const panel=$('journey-panel');if(!panel||$('mobile-steps'))return;
 const steps=document.createElement('nav');steps.id='mobile-steps';steps.className='mobile-steps';steps.setAttribute('aria-label','Schritte');
 steps.innerHTML='<button type="button" data-step="1"><b>1</b><span></span></button><button type="button" data-step="2"><b>2</b><span></span></button><button type="button" data-step="3"><b>3</b><span></span></button>';
 panel.prepend(steps);steps.querySelectorAll('[data-step]').forEach(button=>button.onclick=()=>setMobileStep(+button.dataset.step));
 const journey=panel.querySelector('.journey'),here=document.createElement('button');here.type='button';here.id='use-location';here.className='mobile-only text-button';here.onclick=()=>$('locate').click();journey.querySelector('#pick-hint').before(here);
 const next=document.createElement('button');next.type='button';next.id='mobile-next';next.className='primary mobile-only';next.onclick=()=>setMobileStep(2);journey.append(next);
 const back=document.createElement('button');back.type='button';back.id='mobile-back';back.className='text-button mobile-only';back.onclick=()=>setMobileStep(1);panel.querySelector('.preferences').prepend(back);
 const go=document.createElement('button');go.type='button';go.id='mobile-navigate';go.hidden=true;$('mobile-edit-route').before(go);
 $('mobile-edit-route').addEventListener('click',()=>setMobileStep(1));
 renderMobileSteps();
 if(isMobileMap()&&!points.every(Boolean))setMobileStep(1);
}

// Compressed image cache, separate from GPU textures. Quota failures do not
// disable imagery. Only the fixed public LGL tile endpoint is accepted.
let aerialProtocolInstalled=false;
function createAerialCache({fetchImpl=fetch,maxEntries=192,maxBytes=24*1024*1024,cacheStorage=globalThis.caches}={}){
 const memory=new Map(),pending=new Map();let bytes=0,diskWrites=Promise.resolve();
 const remember=(url,data)=>{if(memory.has(url)){bytes-=memory.get(url).byteLength;memory.delete(url);}memory.set(url,data);bytes+=data.byteLength;while(memory.size>maxEntries||bytes>maxBytes){const key=memory.keys().next().value;bytes-=memory.get(key).byteLength;memory.delete(key);}return data;};
 const get=async url=>{
  if(!url.startsWith('https://owsproxy.lgl-bw.de/owsproxy/ows/WMTS_LGL-BW_ATKIS_DOP_20_C?'))throw Error('Invalid aerial endpoint');
  if(memory.has(url)){const data=memory.get(url);memory.delete(url);memory.set(url,data);return data.slice(0);}
  if(!pending.has(url))pending.set(url,(async()=>{
   let disk;try{disk=await cacheStorage?.open('sonnenpfad-lgl-v1');const hit=await disk?.match(url);if(hit&&Date.now()-Number(hit.headers.get('x-saved-at'))<7*86400000)return remember(url,await hit.arrayBuffer());}catch{}
   const response=await fetchImpl(url);if(!response.ok)throw Error(`LGL ${response.status}`);
   if(!response.headers.get('content-type')?.startsWith('image/'))throw Error('LGL returned no image');
   const data=await response.arrayBuffer();if(!data.byteLength)throw Error('Empty LGL tile');remember(url,data);
   if(disk){diskWrites=diskWrites.then(async()=>{await disk.put(url,new Response(data.slice(0),{headers:{'content-type':'image/jpeg','x-saved-at':String(Date.now())}}));const keys=await disk.keys();for(const key of keys.slice(0,Math.max(0,keys.length-maxEntries)))await disk.delete(key);}).catch(()=>{});}
   return data;
  })().finally(()=>pending.delete(url)));
  return (await pending.get(url)).slice(0);
 };
 const invalidate=url=>{if(memory.has(url)){bytes-=memory.get(url).byteLength;memory.delete(url);}diskWrites=diskWrites.then(async()=>{const disk=await cacheStorage?.open('sonnenpfad-lgl-v1');await disk?.delete(url);}).catch(()=>{});return diskWrites;};
 return {get,invalidate,snapshot:()=>({entries:memory.size,bytes,pending:pending.size})};
}
function installAerialProtocol(sdk){
 if(aerialProtocolInstalled)return;aerialProtocolInstalled=true;
 const count=matchMedia('(pointer:coarse)').matches?128:256,raw=createAerialCache({maxEntries:count,maxBytes:12*1024*1024}),cache=createAerialFallback({cache:raw,maxEntries:count});
 sdk.addProtocol('lgl',async(request,controller)=>{const data=await cache.get(request.url.replace(/^lgl:/,'https:'));if(controller.signal.aborted)throw new DOMException('Aborted','AbortError');return {data,cacheControl:'max-age=604800'};});
}

function aerialParent(url){
 const target=new URL(url),matrix=target.searchParams.get('TILEMATRIX')||'',match=matrix.match(/^GoogleMapsCompatible:(\d+)$/);if(!match||+match[1]<=0)return null;
 const z=+match[1],x=+target.searchParams.get('TILECOL'),y=+target.searchParams.get('TILEROW');
 target.searchParams.set('TILEMATRIX',`GoogleMapsCompatible:${z-1}`);target.searchParams.set('TILECOL',String(Math.floor(x/2)));target.searchParams.set('TILEROW',String(Math.floor(y/2)));
 return {url:target.href,x:x%2,y:y%2};
}
// Some LGL levels return a valid HTTP 200 JPEG filled entirely with white.
// Detect just those tiny homogeneous responses, then crop the correct ancestor
// quadrant. Cropping preserves geography and never invents higher resolution.
async function isBlankAerial(data){
 if(data.byteLength>4096||typeof createImageBitmap!=='function')return false;
 const bitmap=await createImageBitmap(new Blob([data],{type:'image/jpeg'}));
 try{const canvas=aerialCanvas(16,16),ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.drawImage(bitmap,0,0,16,16);const pixels=ctx.getImageData(0,0,16,16).data;
  for(let i=0;i<pixels.length;i+=4)if(pixels[i]<250||pixels[i+1]<250||pixels[i+2]<250)return false;return true;
 }finally{bitmap.close();}
}
async function cropAerialParent(data,parent){
 const bitmap=await createImageBitmap(new Blob([data],{type:'image/jpeg'}));
 try{const canvas=aerialCanvas(256,256),ctx=canvas.getContext('2d');ctx.drawImage(bitmap,parent.x*128,parent.y*128,128,128,0,0,256,256);return (await (canvas.convertToBlob?canvas.convertToBlob({type:'image/jpeg',quality:.9}):new Promise((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(Error('Image encoding failed')),'image/jpeg',.9)))).arrayBuffer();}finally{bitmap.close();}
}
function createAerialFallback({cache,isBlank=isBlankAerial,crop=cropAerialParent,maxBytes=12*1024*1024,maxEntries=128}={}){
 const resolved=new Map(),pending=new Map();let bytes=0;
 const load=async(url,depth=0)=>{
  const hit=resolved.get(url);if(hit&&Date.now()<hit.expires){resolved.delete(url);resolved.set(url,hit);return hit.data.slice(0);}if(hit){resolved.delete(url);bytes-=hit.data.byteLength;}
  if(!pending.has(url))pending.set(url,(async()=>{
   let data,error;try{data=await cache.get(url);if(await isBlank(data)){data=null;await cache.invalidate?.(url);}}catch(e){error=e;}
   const derived=!data;
   if(!data){const parent=depth<6?aerialParent(url):null;if(!parent)throw error||Error('Empty LGL imagery');data=await crop(await load(parent.url,depth+1),parent);}
   resolved.set(url,{data,expires:Date.now()+(derived?60000:7*86400000)});bytes+=data.byteLength;
   while(bytes>maxBytes||resolved.size>maxEntries){const key=resolved.keys().next().value;bytes-=resolved.get(key).data.byteLength;resolved.delete(key);}return data;
  })().finally(()=>pending.delete(url)));
  return (await pending.get(url)).slice(0);
 };
 return {get:load};
}

function aerialCanvas(width,height){if(typeof OffscreenCanvas==='function')return new OffscreenCanvas(width,height);const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;return canvas;}

// Display only: analytical roof/wall projection, without PNG encoding or route work.
function displayShadowOpacity(solarWeight,altitude) {
 if(!Number.isFinite(altitude)||altitude<=2)return 0;
 const weight=Number.isFinite(solarWeight)?Math.max(0,Math.min(1,solarWeight)):1;
 return .22+.16*weight;
}
function createLatestFrameQueue(send) {
 let busy=false,pending=null;
 return {push(value){pending=value;this.pump();},pump(){if(busy||!pending)return;const next=pending;pending=null;busy=true;send(next);},complete(){busy=false;this.pump();},get pending(){return pending;},get busy(){return busy;}};
}
function drawDisplayShadows(ctx,obstacles,sun,leafOn,transform) {
 ctx.clearRect(0,0,ctx.canvas.width,ctx.canvas.height);
 if(sun.altitude<=2)return;
 const az=sun.azimuth*Math.PI/180,alt=sun.altitude*Math.PI/180,cot=1/Math.tan(alt),sx=-Math.sin(az)*cot,sy=-Math.cos(az)*cot;
 const point=(p,dx=0,dy=0)=>transform(p[0]+dx,p[1]+dy);
 ctx.fillStyle='#24364f';
 for(const building of obstacles.buildings){
  const dx=sx*building.h,dy=sy*building.h;
  ctx.beginPath();for(const ring of building.r){ring.forEach((p,i)=>{const q=point(p,dx,dy);i?ctx.lineTo(...q):ctx.moveTo(...q);});ctx.closePath();}ctx.fill('evenodd');
  for(const ring of building.r)for(let i=1;i<ring.length;i++){const a=point(ring[i-1]),b=point(ring[i]),c=point(ring[i],dx,dy),d=point(ring[i-1],dx,dy);ctx.beginPath();ctx.moveTo(...a);ctx.lineTo(...b);ctx.lineTo(...c);ctx.lineTo(...d);ctx.closePath();ctx.fill();}
 }
 for(const tree of obstacles.trees){
  if(!leafOn&&!tree.evergreen)continue;
  const centre=Math.max(tree.r,tree.h-tree.r),major=tree.r/Math.sin(alt);ctx.beginPath();
  for(let i=0;i<=32;i++){const angle=i*Math.PI/16,along=major*Math.cos(angle),across=tree.r*Math.sin(angle),q=transform(tree.p[0]+sx*centre+along*Math.sin(az)+across*Math.cos(az),tree.p[1]+sy*centre+along*Math.cos(az)-across*Math.sin(az));i?ctx.lineTo(...q):ctx.moveTo(...q);}ctx.closePath();ctx.fill();
 }
}

// Object heights come from immutable DEM assets, never the renderer's transient
// visible-tile cache. A missing/failed tile is an error, not a sea-level sample.
function terrainTilePoint(lngLat, zoom=14) {
 const [lon,lat]=lngLat,n=2**zoom,sin=Math.sin(lat*Math.PI/180);
 const x=(lon+180)/360*n,y=(.5-Math.log((1+sin)/(1-sin))/(4*Math.PI))*n;
 return {x:Math.floor(x),y:Math.floor(y),u:x-Math.floor(x),v:y-Math.floor(y)};
}
function interpolateDEMTile(tile,u,v) {
 const x=Math.max(0,Math.min(tile.width-1,u*tile.width)),y=Math.max(0,Math.min(tile.height-1,v*tile.height)),a=Math.floor(x),b=Math.floor(y),tx=x-a,ty=y-b;
 const at=(i,j)=>tile.heights[Math.min(j,tile.height-1)*tile.width+Math.min(i,tile.width-1)];
 return at(a,b)*(1-tx)*(1-ty)+at(a+1,b)*tx*(1-ty)+at(a,b+1)*(1-tx)*ty+at(a+1,b+1)*tx*ty;
}
async function decodeDEMPNG(blob) {
 const image=await createImageBitmap(blob,{colorSpaceConversion:'none',premultiplyAlpha:'none'});
 const canvas=typeof OffscreenCanvas==='function'?new OffscreenCanvas(image.width,image.height):Object.assign(document.createElement('canvas'),{width:image.width,height:image.height});
 const context=canvas.getContext('2d',{willReadFrequently:true});context.drawImage(image,0,0);image.close();
 const rgba=context.getImageData(0,0,canvas.width,canvas.height).data,heights=new Float32Array(canvas.width*canvas.height);
 for(let i=0;i<heights.length;i++){const p=i*4;heights[i]=-10000+(rgba[p]*65536+rgba[p+1]*256+rgba[p+2])*.1;}
 return {width:canvas.width,height:canvas.height,heights};
}
function createTerrainHeightfield({baseURL,zoom=14,exaggeration=1.3,loadTile,maxTiles=96,concurrency=6}) {
 const tiles=new Map(),pending=new Map(),samples=new Map(),queue=[];let active=0;
 const pump=()=>{while(active<concurrency&&queue.length){const {task,resolve,reject}=queue.shift();active++;Promise.resolve().then(task).then(resolve,reject).finally(()=>{active--;pump();});}};
 const schedule=task=>new Promise((resolve,reject)=>{queue.push({task,resolve,reject});pump();});
 const readTile=loadTile||(async(x,y)=>{const response=await fetch(new URL(`${zoom}/${x}/${y}.png`,baseURL),{signal:AbortSignal.timeout(12000)});if(!response.ok)throw Error(`Terrain tile ${x}/${y}: ${response.status}`);return decodeDEMPNG(await response.blob());});
 const getTile=(x,y)=>{const key=`${x}/${y}`;if(tiles.has(key)){const tile=tiles.get(key);tiles.delete(key);tiles.set(key,tile);return Promise.resolve(tile);}if(pending.has(key))return pending.get(key);
  const request=schedule(()=>readTile(x,y)).then(tile=>{if(!tile?.heights||!tile.width||!tile.height)throw Error('Invalid DEM tile');tiles.set(key,tile);while(tiles.size>maxTiles)tiles.delete(tiles.keys().next().value);return tile;}).finally(()=>pending.delete(key));pending.set(key,request);return request;};
 const keyFor=point=>point.map(value=>Number(value).toFixed(8)).join(':');
 return {
  async sample(point){const key=keyFor(point);if(samples.has(key))return samples.get(key);const p=terrainTilePoint(point,zoom),tile=await getTile(p.x,p.y),height=interpolateDEMTile(tile,p.u,p.v)*exaggeration;if(!Number.isFinite(height))throw Error('Non-finite DEM height');samples.set(key,height);if(samples.size>100000)samples.delete(samples.keys().next().value);return height;},
  sampleMany(points){return Promise.all(points.map(point=>this.sample(point)));},
  peek(point){const key=keyFor(point);if(samples.has(key))return samples.get(key);const p=terrainTilePoint(point,zoom),tile=tiles.get(`${p.x}/${p.y}`);return tile?interpolateDEMTile(tile,p.u,p.v)*exaggeration:undefined;},
  get stats(){return {tiles:tiles.size,pending:pending.size,samples:samples.size};}
 };
}

// Distances use local metres, also for oriented partial pieces from the API.
function routeMeasure(coords) {
 const cumulative=[0];
 for(let i=1;i<coords.length;i++)cumulative.push(cumulative[i-1]+Math.hypot(coords[i][0]-coords[i-1][0],coords[i][1]-coords[i-1][1]));
 return {coords,cumulative,total:cumulative.at(-1)||0};
}
function pointAlongRoute(measure,fraction) {
 const {coords,cumulative,total}=measure;
 if(!coords.length)return null;
 const target=Math.max(0,Math.min(1,fraction))*total;
 let lo=1,hi=cumulative.length-1;
 while(lo<hi){const mid=(lo+hi)>>1;if(cumulative[mid]<target)lo=mid+1;else hi=mid;}
 const i=Math.min(lo,coords.length-1),a=coords[Math.max(0,i-1)],b=coords[i],length=cumulative[i]-cumulative[Math.max(0,i-1)],f=length?(target-cumulative[Math.max(0,i-1)])/length:0;
 return [a[0]+(b[0]-a[0])*f,a[1]+(b[1]-a[1])*f];
}
function smoothBearing(previous,next,weight) {
 return previous+(((next-previous+540)%360)-180)*Math.max(0,Math.min(1,weight));
}
function valueAlongRoute(measure,values,fraction) {
 const target=Math.max(0,Math.min(1,fraction))*measure.total;
 let lo=1,hi=measure.cumulative.length-1;
 while(lo<hi){const mid=(lo+hi)>>1;if(measure.cumulative[mid]<target)lo=mid+1;else hi=mid;}
 const i=Math.min(lo,values.length-1),a=Math.max(0,i-1),length=measure.cumulative[i]-measure.cumulative[a],f=length?(target-measure.cumulative[a])/length:0;
 return values[a]+(values[i]-values[a])*f;
}
function densifyRoute(coords,spacing=12) {
 if(coords.length<2)return coords;
 const total=routeMeasure(coords).total,step=Math.max(spacing,total/10000),points=[coords[0]];
 for(let i=1;i<coords.length;i++){const a=coords[i-1],b=coords[i],count=Math.max(1,Math.ceil(Math.hypot(b[0]-a[0],b[1]-a[1])/step));for(let j=1;j<=count;j++){const f=j/count;points.push([a[0]+(b[0]-a[0])*f,a[1]+(b[1]-a[1])*f]);}}
 return points;
}

// The same linear metric scale applies to short and long routes. A modest,
// explicit 2x vertical exaggeration is used until the full relief needs more.
// Independent, linear distance/elevation axes, padded to show relief without
// filling the entire chart with a small rise. Explicit vertical factor remains.
function profileScale(values,width=300,height=70) {
 const valid=values.filter(p=>p.every(Number.isFinite));if(valid.length<2)return null;
 const total=valid.at(-1)[0]||1,zs=valid.map(p=>p[1]),min=Math.min(...zs),max=Math.max(...zs);
 const range=Math.max(35,(max-min)*1.6,total*.012),low=(min+max-range)/2;
 return {low,high:low+range,total,exaggeration:total/width/(range/height),min,max};
}
function formatWalkDuration(minutes,language='de') {
 if(!Number.isFinite(minutes))return '—';
 const n=Math.max(0,Math.round(minutes));
 return n<60?`${n} min`:`${Math.floor(n/60)} ${language==='de'?'Std.':'h'}${n%60?` ${n%60} min`:''}`;
}
function profileAtDistance(values,distance) {
 for(let i=1;i<values.length;i++){
  const a=values[i-1],b=values[i];
  if(distance<=b[0]){if(!a.every(Number.isFinite)||!b.every(Number.isFinite))return null;
   const f=Math.max(0,Math.min(1,(distance-a[0])/(b[0]-a[0]||1)));return a[1]+(b[1]-a[1])*f;}
 }
 return values.at(-1)?.every(Number.isFinite)?values.at(-1)[1]:null;
}

// Public production hosts retain Oracle routing. Preview hosts have no Oracle
// CORS grant and use the existing local engine with an explicit UI notice.
function isRoutingPreview(hostname='') {
 return /^(?:app09-mobile-finalization-preview|app09-ui-cleanup-preview|oracle-profiles-v1-preview|access-blocks-preview|server-routing-preview|[a-f0-9]{8})-sonnenpfad-stuttgart\.mohammadreza-bakhshi\.workers\.dev$/.test(hostname);
}
// Stage-2 routing server (Nginx /profile-v2/ -> 127.0.0.1:8002). Preview hosts route every
// request there, with no browser fallback; production hosts use it once /capabilities reports production.
const PROFILE_V2_API='https://138.2.184.1/profile-v2/';
function profileApiFor(hostname=''){
 return isRoutingPreview(hostname)?PROFILE_V2_API:null;
}

function durationMetric(minutes){
 if(!Number.isFinite(minutes)||minutes<0)return {text:'—',unit:'min'};
 const n=Math.round(minutes);return n<60?{text:String(n),unit:'min'}:{text:`${Math.floor(n/60)}:${String(n%60).padStart(2,'0')}`,unit:'h:min'};
}
function singleSelectedGeometry(geometry,point){
 if(geometry?.type!=='MultiPolygon')return geometry;
 const inside=ring=>{let hit=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){const a=ring[i],b=ring[j];if((a[1]>point[1])!==(b[1]>point[1])&&point[0]<(b[0]-a[0])*(point[1]-a[1])/(b[1]-a[1])+a[0])hit=!hit;}return hit;};
 const dist=ring=>{let best=Infinity;const sx=Math.cos(point[1]*Math.PI/180);for(let i=1;i<ring.length;i++){const a=[(ring[i-1][0]-point[0])*sx,ring[i-1][1]-point[1]],b=[(ring[i][0]-point[0])*sx,ring[i][1]-point[1]],dx=b[0]-a[0],dy=b[1]-a[1],f=Math.max(0,Math.min(1,-(a[0]*dx+a[1]*dy)/(dx*dx+dy*dy||1)));best=Math.min(best,Math.hypot(a[0]+f*dx,a[1]+f*dy));}return best;};
 const polygons=geometry.coordinates;const selected=polygons.find(p=>inside(p[0])&&!p.slice(1).some(inside))||polygons.slice().sort((a,b)=>dist(a[0])-dist(b[0]))[0];
 return selected?{type:'Polygon',coordinates:selected}:geometry;
}


// Display requests never fetch the calculation graph or shadow obstacles.
const DISPLAY_THEME_KEYS=['sl','su','ss','sw','us','uw','n','w'];
const DISPLAY_THEME_NAMES=['slope','surface','shadeSummer','shadeWinter','utciSummer','utciWinter','noise','wind'];

// Desktop shows the whole network from zoom 10; phones load paths from 14.45 (14 MB for the city).
// Places (1.5 MB for the city) appear from zoom 10 on every device.
function displayDemand({explore=false,threeD=false,zoom=0,pois=false,theme='slope',wide=false}={}) {
 const min=wide?10:14.45;
 return {paths:explore&&zoom>=min,theme:explore&&zoom>=min&&DISPLAY_THEME_NAMES.includes(theme)?theme:null,pois:explore&&pois&&zoom>=10,trees:threeD&&zoom>=14,details:false,dem:false,obstacles:false};
}

function selectDisplayTiles(manifest,meta,bounds,center,{limit=18,padding=1,bearing=0}={}) {
 const grid=manifest.grid||1000,toCell=p=>[Math.floor((p[0]-meta.origin[0])*meta.scale[0]/grid),Math.floor((p[1]-meta.origin[1])*meta.scale[1]/grid)],a=toCell([bounds[0],bounds[1]]),z=toCell([bounds[2],bounds[3]]),c=toCell(center),available=manifest.tiles||{},r=bearing*Math.PI/180,forward=[Math.sin(r),Math.cos(r)],keys=[];
 for(let x=a[0]-padding;x<=z[0]+padding;x++)for(let y=a[1]-padding;y<=z[1]+padding;y++){const key=`${x}_${y}`;if(available[key])keys.push(key);}
 const score=key=>{const [x,y]=key.split('_').map(Number),dx=x-c[0],dy=y-c[1];return Math.hypot(dx,dy)-Math.max(0,dx*forward[0]+dy*forward[1])*.3;};
 return keys.sort((a,b)=>score(a)-score(b)||a.localeCompare(b)).slice(0,limit);
}

function createDisplayStore({baseURL,fetchImpl=fetch,maxEntries=96}={}) {
 const cache=new Map(),pending=new Map();
 const get=async(file,revision='')=>{
  const key=file+'?v='+revision;
  if(cache.has(key)){const value=cache.get(key);cache.delete(key);cache.set(key,value);return value;}
  if(pending.has(key))return pending.get(key);
  const url=new URL(file,baseURL);if(revision)url.searchParams.set('v',revision);
  const request=(async()=>{const response=await fetchImpl(url,{signal:AbortSignal.timeout(30000)});if(!response.ok)throw Error(`Display asset ${response.status}: ${file}`);const value=await response.json();cache.set(key,value);while(cache.size>maxEntries)cache.delete(cache.keys().next().value);return value;})().finally(()=>pending.delete(key));
  pending.set(key,request);return request;
 };
 return {get,snapshot:()=>({cached:cache.size,pending:pending.size})};
}

// Small local style: no external style JSON in the application's start-up path.
// Geometry for display is independent from the Atlas calculation geometry.
function createBasemapStyle() {
 const source='openmaptiles',name=['coalesce',['get','name'],['get','name:en'],''];
 const line=(id,color,width,filter,minzoom=0)=>({id,type:'line',source,'source-layer':'transportation',minzoom,filter,layout:{'line-cap':'round','line-join':'round'},paint:{'line-color':color,'line-width':width}});
 return {version:8,glyphs:'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',light:{anchor:'viewport',color:'#ffffff',intensity:.28,position:[1.15,210,45]},sources:{[source]:{type:'vector',url:'https://tiles.openfreemap.org/planet/latest',attribution:'<a href="https://openfreemap.org/">OpenFreeMap</a> · <a href="https://www.openmaptiles.org/">© OpenMapTiles</a> · <a href="https://www.openstreetmap.org/copyright">© OpenStreetMap</a>'}},layers:[
  {id:'background',type:'background',paint:{'background-color':'#f5f3ed'}},
  {id:'landcover',type:'fill',source,'source-layer':'landcover',paint:{'fill-color':['match',['get','class'],'wood','#dce7cf','grass','#e5eddc','farmland','#ecebd7','#eeeae1'],'fill-opacity':.8}},
  {id:'landuse',type:'fill',source,'source-layer':'landuse',paint:{'fill-color':['match',['get','class'],'park','#dce9d1','cemetery','#e0e8d9','industrial','#eae7df','residential','#f0eee7','#f3f0e8'],'fill-opacity':.7}},
  {id:'parks',type:'fill',source,'source-layer':'park',paint:{'fill-color':'#dce9d1','fill-opacity':.75}},
  {id:'water',type:'fill',source,'source-layer':'water',paint:{'fill-color':'#b8dbe2'}},
  {id:'waterway',type:'line',source,'source-layer':'waterway',paint:{'line-color':'#b8dbe2','line-width':['interpolate',['linear'],['zoom'],12,.7,17,3]}},
  {id:'building-footprint',type:'fill',source,'source-layer':'building',minzoom:13,paint:{'fill-color':'#e7d6b6','fill-outline-color':'#d6c39e'}},
  line('roads-casing','#e2ddd1',['interpolate',['linear'],['zoom'],12,1.8,15,6,18,20],['in',['get','class'],['literal',['motorway','trunk','primary','secondary','tertiary','minor','service']]]),
  line('roads','#ffffff',['interpolate',['linear'],['zoom'],12,.8,15,4.5,18,17],['in',['get','class'],['literal',['primary','secondary','tertiary','minor','service']]]),
  line('major-roads','#f0dba3',['interpolate',['linear'],['zoom'],12,1.6,15,5,18,18],['in',['get','class'],['literal',['motorway','trunk']]]),
  line('paths','#d7c9a7',['interpolate',['linear'],['zoom'],13,.5,16,1.2,18,2.5],['in',['get','class'],['literal',['path','track']]],13),
  {...line('rail','#c7cbd0',['interpolate',['linear'],['zoom'],12,.6,18,2],['==',['get','class'],'rail']),paint:{'line-color':'#c7cbd0','line-width':['interpolate',['linear'],['zoom'],12,.6,18,2],'line-dasharray':[3,3]}},
  {id:'road-labels',type:'symbol',source,'source-layer':'transportation_name',minzoom:14,layout:{'symbol-placement':'line','text-field':name,'text-font':['Noto Sans Regular'],'text-size':['interpolate',['linear'],['zoom'],14,10,18,12],'text-max-angle':35,'text-padding':4},paint:{'text-color':'#68706c','text-halo-color':'#ffffff','text-halo-width':1.3}},
  {id:'place-labels',type:'symbol',source,'source-layer':'place',filter:['in',['get','class'],['literal',['city','town','village','suburb','neighbourhood']]],layout:{'text-field':name,'text-font':['Noto Sans Regular'],'text-size':['interpolate',['linear'],['zoom'],11,13,15,16],'text-max-width':9},paint:{'text-color':'#56655e','text-halo-color':'#ffffff','text-halo-width':1.4}},
 ]};
}

function buildingDisplayLayer() {
 return {id:'city-buildings-3d',type:'fill-extrusion',source:'openmaptiles','source-layer':'building',minzoom:13,filter:['!=',['get','hide_3d'],true],layout:{visibility:'none'},paint:{'fill-extrusion-color':'#efefeb','fill-extrusion-height':['max',2,['coalesce',['get','render_height'],8]],'fill-extrusion-base':['coalesce',['get','render_min_height'],0],'fill-extrusion-opacity':1,'fill-extrusion-vertical-gradient':false}};
}



function createCityFrame(origin) {
 const earth=40075016.68557849;
 const mercator=([lon,lat])=>{const sin=Math.sin(lat*Math.PI/180);return [(lon+180)/360,.5-Math.log((1+sin)/(1-sin))/(4*Math.PI)];};
 const [x,y]=mercator(origin),unit=1/(earth*Math.cos(origin[1]*Math.PI/180));
 return {x,y,unit,point(point,height=0){const [px,py]=mercator(point),scale=1/(earth*Math.cos(point[1]*Math.PI/180));return [(px-x)/unit,(y-py)/unit,height*scale/unit];},radius(point,radius){return radius/(earth*Math.cos(point[1]*Math.PI/180))/unit;}};
}

// North-positive scene metres keep Three's right-handed coordinates. The
// model matrix flips Y once into Mercator, as in the SDK's Three examples.
// Only trees live in this layer. MapLibre draws vector buildings and the route.
// Tree bases use immutable sampled display-ground heights; routing heights remain separate.
function createCitySceneLayer({origin,toLngLat,dimensions,rendererFactory,treeCap=4000}) {
 const frame=createCityFrame(origin),scene=new THREE.Scene(),camera=new THREE.Camera(),objects=new THREE.Group();scene.add(objects);
 const ambient=new THREE.AmbientLight(0xfff9eb,1.35),sun=new THREE.DirectionalLight(0xffffff,.55);sun.position.set(-400,600,900);scene.add(ambient,sun);
 const crownGeometry=new THREE.SphereGeometry(1,24,16),trunkGeometry=new THREE.CylinderGeometry(1,1,1,8);trunkGeometry.rotateX(Math.PI/2);
 // A closed opaque shell avoids the unsortable surfaces of blended instances.
 const crownMaterial=new THREE.MeshLambertMaterial({color:0xffffff,transparent:false,opacity:1,depthWrite:true,side:THREE.FrontSide}),trunkMaterial=new THREE.MeshLambertMaterial({color:0x967345});
 const crowns=new THREE.InstancedMesh(crownGeometry,crownMaterial,treeCap),trunks=new THREE.InstancedMesh(trunkGeometry,trunkMaterial,treeCap);crowns.count=trunks.count=0;crowns.frustumCulled=trunks.frustumCulled=false;objects.add(crowns,trunks);
 const trees=new Map(),instance=new THREE.Object3D(),colour=new THREE.Color(),raycaster=new THREE.Raycaster();
 const localMatrix=new THREE.Matrix4().makeTranslation(frame.x,frame.y,0).scale(new THREE.Vector3(frame.unit,-frame.unit,frame.unit)),projection=new THREE.Matrix4();
 let map,renderer,visible=false,disposed=false,selected=[],selectionKey='',lastMatrix=null;
 const keyFor=point=>point.map(value=>Number(value).toFixed(2)).join(':');
 const layer={id:'city-scene-3d',type:'custom',renderingMode:'3d',
  onAdd(current,gl){map=current;renderer=rendererFactory?rendererFactory(current,gl):new THREE.WebGLRenderer({canvas:map.getCanvas(),context:gl,antialias:true});renderer.autoClear=false;},
  setVisible(value){visible=Boolean(value);map?.triggerRepaint();},
  setSun(value){if(!value)return;const az=value.azimuth*Math.PI/180,alt=Math.max(.3,value.altitude*Math.PI/180);sun.position.set(Math.sin(az)*Math.cos(alt)*1000,Math.cos(az)*Math.cos(alt)*1000,Math.sin(alt)*1000);sun.intensity=value.altitude>0?.55:.2;map?.triggerRepaint();},
  setTrees(input,centre){
   if(disposed)return;const distance=p=>Math.hypot(p[0]-centre[0],p[1]-centre[1]);
   for(const tree of input){if(!tree.p?.every(Number.isFinite)||!Number.isFinite(tree.r)||!Number.isFinite(tree.h))continue;const key=keyFor(tree.p);if(!trees.has(key)||Number.isFinite(tree.ground)&&tree.ground!==trees.get(key).tree.ground)trees.set(key,{tree,key,ll:toLngLat(tree.p)});}
   for(const [key,record] of trees)if(distance(record.tree.p)>3400)trees.delete(key);
   const next=[...trees.values()].filter(record=>distance(record.tree.p)<2200).sort((a,b)=>distance(a.tree.p)-distance(b.tree.p)||a.key.localeCompare(b.key)).slice(0,treeCap),signature=next.map(record=>record.key+':'+(record.tree.ground??0)).sort().join('|');
   if(signature===selectionKey)return;selectionKey=signature;selected=next;
   for(const [index,record] of selected.entries()){
    const {r,h}=dimensions(record.tree),radius=frame.radius(record.ll,Math.max(.5,Math.min(r,h*.46))),height=frame.radius(record.ll,Math.max(2,h)),[x,y,ground]=frame.point(record.ll,record.tree.ground??0),canopyCentre=Math.max(radius+.35,height-radius),trunkHeight=Math.max(.6,canopyCentre-radius*.65),trunkRadius=Math.max(.12,Math.min(.28,r*.13));
    instance.position.set(x,y,ground+canopyCentre);instance.scale.setScalar(radius);instance.updateMatrix();crowns.setMatrixAt(index,instance.matrix);
    const variation=((Math.round(record.tree.p[0]*10)*31+Math.round(record.tree.p[1]*10))>>>0)%4,palette=record.tree.evergreen?[0x3f8057,0x4c8854,0x528c60,0x458653]:[0x79a34c,0x69a255,0x86aa57,0x76a85b];colour.set(palette[variation]);crowns.setColorAt(index,colour);
    instance.position.set(x,y,ground+trunkHeight/2);instance.scale.set(trunkRadius,trunkRadius,trunkHeight);instance.updateMatrix();trunks.setMatrixAt(index,instance.matrix);
   }
   crowns.count=trunks.count=selected.length;crowns.boundingSphere=trunks.boundingSphere=null;crowns.instanceMatrix.needsUpdate=trunks.instanceMatrix.needsUpdate=true;if(crowns.instanceColor)crowns.instanceColor.needsUpdate=true;map?.triggerRepaint();
  },
  pickTree(point){
   if(!visible||!lastMatrix||!selected.length)return null;const canvas=map.getCanvas(),x=point.x/canvas.clientWidth*2-1,y=1-point.y/canvas.clientHeight*2,near=new THREE.Vector3(x,y,-1).applyMatrix4(camera.projectionMatrixInverse),far=new THREE.Vector3(x,y,1).applyMatrix4(camera.projectionMatrixInverse);
   raycaster.set(near,far.sub(near).normalize());scene.updateMatrixWorld(true);const hit=raycaster.intersectObject(crowns,false)[0];return hit?selected[hit.instanceId]:null;
  },
  render(gl,args){if(!visible||!renderer)return;const matrix=args.defaultProjectionData?.mainMatrix;if(!matrix||matrix.length!==16)return;lastMatrix=matrix;camera.projectionMatrix.copy(projection.fromArray(matrix).multiply(localMatrix));camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();renderer.resetState();renderer.render(scene,camera);renderer.resetState();},
  snapshot(){return {trees:selected.map(record=>({p:record.tree.p,ground:record.tree.ground??0})),instances:crowns.count,visible,cached:trees.size};},
  onRemove(){disposed=true;for(const value of [crownGeometry,trunkGeometry,crownMaterial,trunkMaterial])value.dispose();renderer?.dispose();trees.clear();selected=[];map=null;}
 };return layer;
}

// Clip in homogeneous camera space BEFORE dividing by w. Projecting vertices
// behind a tilted camera first turns the city polygon inside out.
function multiplyPoint(matrix,point){
 const [x,y,z=0]=point;
 return [matrix[0]*x+matrix[4]*y+matrix[8]*z+matrix[12],matrix[1]*x+matrix[5]*y+matrix[9]*z+matrix[13],matrix[2]*x+matrix[6]*y+matrix[10]*z+matrix[14],matrix[3]*x+matrix[7]*y+matrix[11]*z+matrix[15]];
}
function clipCameraPolygon(points){
 let polygon=points;
 // Include the near plane and all viewport edges. The far plane intentionally
 // does not clip a ground boundary; map terrain controls its own visibility.
 for(const distance of [p=>p[3]-1e-8,p=>p[2]+p[3],p=>p[0]+p[3],p=>p[3]-p[0],p=>p[1]+p[3],p=>p[3]-p[1]]){
  if(!polygon.length)break;const next=[];
  for(let i=0;i<polygon.length;i++){const a=polygon[i],b=polygon[(i+1)%polygon.length],da=distance(a),db=distance(b),insideA=da>=0,insideB=db>=0;if(insideA)next.push(a);if(insideA!==insideB){const f=da/(da-db);next.push(a.map((v,j)=>v+(b[j]-v)*f));}}
  polygon=next;
 }
 return polygon;
}
function projectBoundaryPath(rings,matrix,width,height){
 let path='';
 for(const ring of rings){const clipped=clipCameraPolygon(ring.map(point=>multiplyPoint(matrix,point)));if(clipped.length<3)continue;path+=clipped.map((p,i)=>`${i?'L':'M'}${((p[0]/p[3]+1)*width/2).toFixed(2)} ${((1-p[1]/p[3])*height/2).toFixed(2)}`).join('')+'Z';}
 return path;
}

// "So funktioniert's": step-by-step help. Every control is shown with the symbol the app really uses,
// cloned or rebuilt from the live interface so the guide cannot drift from it.
function guideContent(lang) {
 const de = lang === 'de', el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
 const key = (...children) => { const n = el('span', 'guide-key'); n.setAttribute('aria-hidden', 'true'); n.append(...children); return n; };
 const K = {
  text: text => { const n = key(text); if ([...text].length === 1) n.classList.add('guide-glyph'); return n; },
  glyph: cls => key(el('span', 'choice-glyph ' + cls)),
  svg: selector => { const s = document.querySelector(selector); return key(s ? s.cloneNode(true) : ''); },
  map: control => { const wrap = el('span', 'maplibregl-ctrl maplibregl-ctrl-group guide-map-key'), b = el('button', 'maplibregl-ctrl-' + control); b.tabIndex = -1; b.append(el('span', 'maplibregl-ctrl-icon')); wrap.setAttribute('aria-hidden', 'true'); wrap.append(b); return wrap; },
  point: end => { const n = el('span', 'point ' + (end ? 'end' : 'start'), end ? 'B' : 'A'); n.classList.add('guide-point'); n.setAttribute('aria-hidden', 'true'); return n; },
  poi: d => { const n = el('span', 'guide-poi'); n.style.background = d.color; const img = el('img'); img.alt = ''; img.src = poiIcons[d.icon] || ''; n.append(img); n.setAttribute('aria-hidden', 'true'); return n; },
  chip: color => { const n = el('span', 'guide-chip'); n.style.background = color; return n; },
 };
 // A line is text with {name} placeholders that are replaced by symbols.
 const line = (tag, text, keys = {}) => { const n = el(tag); for (const part of text.split(/(\{\w+\})/)) { const m = part.match(/^\{(\w+)\}$/); n.append(m && keys[m[1]] ? keys[m[1]] : part); } return n; };
 const steps = items => { const ol = el('ol', 'guide-steps'); for (const [title, text, keys] of items) { const li = el('li'); li.append(el('strong', '', title), line('p', text, keys)); ol.append(li); } return ol; };
 const list = items => { const ul = el('ul', 'guide-list'); for (const [text, keys] of items) ul.append(line('li', text, keys)); return ul; };
 // Profile texts come from the app's own descriptions, so guide and route panel always agree.
 const profiles = [['icon-walk', 'standard', de ? 'Standard' : 'Standard'], ['icon-wheelchair', 'wheelchair', de ? 'Rollstuhl' : 'Wheelchair'],
  ['icon-power-wheelchair', 'powerWheelchair', de ? 'Elektrorollstuhl' : 'Power wheelchair'], ['icon-walking-aid', 'walkingAid', de ? 'Stock oder Rollator' : 'Cane or walker'],
  ['icon-blind', 'vision', de ? 'Blind oder sehbehindert' : 'Blind or low vision'], ['icon-stroller', 'stroller', de ? 'Kinderwagen' : 'Pushchair'],
  ['icon-settings', 'custom', de ? 'Eigene Einstellungen' : 'Custom settings']].map(([cls, k, name]) => [cls, name, (profileDescriptions[lang] || profileDescriptions.de)[k] || ''])

 const route = el('div', 'guide-pane');
 route.append(steps([
  [de ? 'Start und Ziel wählen' : 'Choose start and destination',
   de ? 'Tippe eine Adresse oder einen Ort in das Feld {a} Start und wähle einen Vorschlag. Dasselbe für {b} Ziel. Oder drück {pick} neben dem Feld und klick auf die Karte. Am Handy schiebst du die Karte unter das Kreuz und bestätigst mit {ok}, mit {cancel} brichst du ab.'
      : 'Type an address or place into {a} Start and pick a suggestion. Do the same for {b} Destination. Or press {pick} next to the field and click the map. On a phone, move the map under the cross and confirm with {ok}; {cancel} aborts.',
   { a: K.point(false), b: K.point(true), pick: K.text('⌖'), ok: K.text('✓'), cancel: K.text('×') }],
  [de ? 'Abkürzungen' : 'Shortcuts',
   de ? '{swap} tauscht Start und Ziel. {locate} rechts auf der Karte setzt deinen Standort als Start (der Browser fragt einmal um Erlaubnis).'
      : '{swap} swaps start and destination. {locate} on the right of the map sets your location as start (the browser asks once for permission).',
   { swap: K.text('⇅'), locate: K.text('⌖') }],
  [de ? 'Wie möchtest du gehen?' : 'How do you want to walk?',
   de ? '{direct} Direkt: kürzester passender Weg. {shade} Schatten: möglichst viel Schatten. {sun} Sonne: möglichst viel Sonne. Schatten und Sonne gelten für Datum und Uhrzeit unten auf der Karte.'
      : '{direct} Direct: shortest suitable way. {shade} Shade: as much shade as possible. {sun} Sun: as much sun as possible. Shade and sun use the date and time at the bottom of the map.',
   { direct: K.glyph('icon-direct'), shade: K.glyph('icon-shade'), sun: K.glyph('icon-sun') }],
  [de ? 'Für wen planst du?' : 'Who are you planning for?', de ? 'Tippe auf ein Symbol:' : 'Tap a symbol:', {}],
 ]));
 route.querySelector('.guide-steps').lastElementChild.append(list(profiles.map(([cls, name, text]) => ['{icon} ' + name + ': ' + text, { icon: K.glyph(cls) }])),
  line('p', de ? 'Bei {custom} wählst du: Steigung {flat} egal, {up} bergauf meiden, {down} bergab meiden, {both} beides meiden. Ein Haken bei {stairs} Treppen, {esc} Rolltreppen, {surface} schlechter Oberfläche oder {wheel} „Rollstuhl: nein“ heißt: diese Wege meiden.'
   : 'With {custom} you choose: gradient {flat} any, {up} avoid uphill, {down} avoid downhill, {both} avoid both. A tick at {stairs} stairs, {esc} escalators, {surface} poor surface or {wheel} “wheelchair: no” means: avoid these ways.',
   { custom: K.glyph('icon-settings'), flat: K.svg('[data-slope="none"] svg'), up: K.svg('[data-slope="uphill"] svg'), down: K.svg('[data-slope="downhill"] svg'), both: K.svg('[data-slope="both"] svg'), stairs: K.glyph('icon-stairs'), esc: K.glyph('icon-escalator'), surface: K.glyph('icon-surface'), wheel: K.glyph('icon-wheelchair') }));
 route.querySelector('.guide-steps').append(...steps([
  [de ? 'Route berechnen' : 'Calculate the route',
   de ? 'Drück {go}. Änderst du danach Profil, Gehweise oder Uhrzeit, rechnet die App selbst neu.' : 'Press {go}. If you then change the profile, walking mode or time, the app recalculates by itself.',
   { go: K.text(de ? 'Route entdecken →' : 'Discover route →') }],
  [de ? 'Ergebnis lesen' : 'Read the result',
   de ? 'Oben stehen Gehzeit, Kilometer und Schattenanteil. Auf der Karte ist die Route {red} blau. {orange} Orange Stücke passen nicht zu deinem Profil (z. B. eine Treppe). Tippe auf ein oranges Stück, dann siehst du den Grund, zum Beispiel die Steigung. Die gestrichelte Linie führt vom gewählten Punkt zum nächsten Gehweg. Passt gar keine Route, siehst du trotzdem die bestmögliche mit dem Hinweis „Keine Route erfüllt dein Profil vollständig“.'
      : 'At the top you see walking time, kilometres and share of shade. On the map the route is {red} blue. {orange} Orange pieces do not fit your profile (e.g. stairs). Tap an orange piece to see why, for example the gradient. The dashed line leads from your point to the nearest footway. If no route fits, you still get the best possible one with the note “No route fully meets your profile”.',
   { red: K.chip('#1a73e8'), orange: K.chip('#f28c28') }],
  [de ? 'Höhenprofil' : 'Elevation profile',
   de ? 'Fahr mit Maus oder Finger über die Kurve. Ein blauer Pfeil zeigt dir die Stelle auf der Karte.' : 'Move the mouse or your finger along the curve. A blue arrow shows the spot on the map.', {}],
  [de ? 'Route ansehen und teilen' : 'Watch and share the route',
   de ? '{preview} fliegt die Strecke in 3D ab, mit Pause, Stopp und Tempo ×1, ×2, ×4. {fit} zeigt die ganze Route. {share} kopiert einen Link mit Start, Ziel und Einstellungen. Am Handy änderst du Start oder Ziel über den Stift in der unteren Leiste.'
      : '{preview} flies along the route in 3D, with pause, stop and speed ×1, ×2, ×4. {fit} shows the whole route. {share} copies a link with start, destination and settings. On a phone, change start or destination with the pencil in the bottom bar.',
   { preview: K.text(de ? '▶ 3D-Routenvorschau' : '▶ 3D route preview'), fit: K.text('⤢'), share: K.text(de ? 'Route als Link teilen ↗' : 'Share route link ↗') }],
 ]).children);

 const explore = el('div', 'guide-pane');
 explore.append(steps([
  [de ? 'Entdecken einschalten' : 'Switch to Explore',
   de ? 'Oben links auf der Karte {explore} tippen. Mit {routing} kommst du zurück, deine Route bleibt erhalten.' : 'Tap {explore} at the top left of the map. {routing} brings you back; your route is kept.',
   { explore: K.text(de ? 'Entdecken' : 'Explore'), routing: K.text('Routing') }],
  [de ? 'Kartenebenen öffnen' : 'Open map layers',
   de ? 'Drück {layers} rechts auf der Karte (oder „Kartenebenen wählen“). Mit {close} schließt du das Fenster wieder.' : 'Press {layers} on the right of the map (or “Choose map layers”). {close} closes the window.',
   { layers: K.text('◫'), close: K.text('×') }],
  [de ? 'Bezirke prüfen' : 'Check districts',
   de ? 'Oben im Fenster wählst du einen oder mehrere Stadtbezirke und kannst „Nur Steigung über … %“ einschalten. Die Karte zeigt dann nur passende Wegabschnitte und zählt sie. Die aktive Auswahl steht oben links auf der Karte; {reset} setzt alles zurück.' : 'At the top of the window you choose one or more districts and can switch on “Only gradient above … %”. The map then shows and counts only matching sections. The active selection appears at the top left of the map; {reset} clears it.',
   { reset: K.text('×') }],
  [de ? 'Ein Linienthema wählen' : 'Choose one line theme',
   de ? 'Die Wege werden nach genau einem Thema eingefärbt. Eine Legende oben links erklärt die Farben:' : 'Paths are coloured by exactly one theme. A legend at the top left explains the colours:', {}],
 ]));
 const chips = d => { const n = el('span', 'guide-chips'); n.append(...(d.legend || []).map(([color]) => K.chip(color))); return n; };
 explore.querySelector('.guide-steps').lastElementChild.append(list(Object.values(THEME_DEFS).map(d => ['{chips} ' + d[lang] + ': ' + d[de ? 'deHelp' : 'enHelp'], { chips: chips(d) }])));
 const places = steps([
  [de ? 'Orte einblenden' : 'Show places',
   de ? 'Unter „Barrierefreiheit & Komfort“ hakst du an, was du sehen willst:' : 'Under “Accessibility & comfort”, tick what you want to see:', {}],
 ]);
 places.lastElementChild.append(list(POI_DEFS.map(d => ['{icon} ' + d[lang], { icon: K.poi(d) }])),
  line('p', de ? 'Ampeln haben vier Farben:' : 'Signal crossings have four colours:'),
  list([3, 2, 1, 0].map(k => CROSSING_CLASSES[k]).map(c => ['{chip} ' + c[lang] + ': ' + c[de ? 'deRule' : 'enRule'], { chip: K.chip(c.color) }])));
 explore.querySelector('.guide-steps').append(...places.children);
 explore.querySelector('.guide-steps').append(...steps([
  [de ? 'Details ansehen' : 'See details',
   de ? 'Klick auf einen Weg oder ein Symbol. Ein Fenster zeigt alles, was der Atlas dazu weiß, etwa Steigung, Belag, Breite oder Ausstattung einer Ampel. {close} schließt es.' : 'Click a path or a symbol. A window shows what the atlas knows, such as gradient, surface, width or the equipment of a crossing. {close} closes it.',
   { close: K.text('×') }],
  [de ? 'Stadt in 3D' : 'City in 3D',
   de ? '{d3} oder „Stadt in 3D ansehen“ zeigt Gelände, Gebäude, Bäume und ihre Schatten zur gewählten Uhrzeit.' : '{d3} or “View city in 3D” shows terrain, buildings, trees and their shadows at the chosen time.',
   { d3: K.text('3D') }],
 ]).children);

 const tools = el('div', 'guide-pane');
 tools.append(list([
  [de ? '{zin} {zout} hinein- und herauszoomen. Auf der Karte geht das auch mit Mausrad oder zwei Fingern.' : '{zin} {zout} zoom in and out. Mouse wheel or two fingers work too.', { zin: K.map('zoom-in'), zout: K.map('zoom-out') }],
  [de ? '{compass} dreht die Karte zurück nach Norden. Mit rechter Maustaste oder zwei Fingern kannst du sie drehen und neigen.' : '{compass} turns the map back to north. Right mouse button or two fingers rotate and tilt it.', { compass: K.map('compass') }],
  [de ? '{d3} wechselt zwischen flacher Karte und 3D-Ansicht.' : '{d3} switches between flat map and 3D view.', { d3: K.text('3D') }],
  [de ? 'Das Auswahlfeld oben rechts wechselt die Hintergrundkarte: OpenFreeMap, OSM Standard, Topografisch oder Luftbild.' : 'The menu at the top right changes the base map: OpenFreeMap, OSM standard, topographic or aerial image.', {}],
  [de ? 'Unten wählst du die Uhrzeit mit dem Schieberegler und das Datum im Kalender. {now} springt auf jetzt. Der kleine Kompass mit {sun} zeigt, aus welcher Richtung die Sonne gerade scheint.' : 'At the bottom, set the time with the slider and the date in the calendar. {now} jumps to now. The small compass with {sun} shows where the sun is shining from.', { now: K.text(de ? 'Jetzt' : 'Now'), sun: K.text('☀') }],
  [de ? 'Die Wetterzeile zeigt Temperatur, Wolken, Sonnenstrahlung und Wind für Stuttgart. Ist {weather} an, berücksichtigen Schatten- und Sonnenrouten die Wolken. {info} erklärt die Werte und die Quelle.' : 'The weather line shows temperature, clouds, sunshine and wind for Stuttgart. With {weather} on, shade and sun routes take the clouds into account. {info} explains the values and the source.', { weather: K.text(de ? 'Wetter' : 'Weather'), info: K.text('i') }],
  [de ? '{credits} unten rechts auf der Karte zeigt die Kartenquellen.' : '{credits} at the bottom right of the map shows the map sources.', { credits: K.text('i') }],
  [de ? '{lang} oben stellt die Sprache auf Englisch oder Deutsch um.' : '{lang} at the top switches between English and German.', { lang: K.text(de ? 'EN' : 'DE') }],
 ]));

 const panes = [[de ? 'Route planen' : 'Plan a route', route], [de ? 'Entdecken' : 'Explore', explore], [de ? 'Karte & Zeit' : 'Map & time', tools]];
 const tabs = el('div', 'segmented guide-tabs'), box = el('div');
 tabs.setAttribute('role', 'tablist');
 panes.forEach(([label, pane], i) => {
  const b = el('button', i ? '' : 'selected', label); b.type = 'button'; b.setAttribute('role', 'tab'); b.setAttribute('aria-selected', String(!i)); pane.hidden = i > 0;
  b.onclick = () => { panes.forEach(([, p], j) => { p.hidden = j !== i; tabs.children[j].classList.toggle('selected', j === i); tabs.children[j].setAttribute('aria-selected', String(j === i)); }); };
  tabs.append(b); box.append(pane);
 });
 const intro = el('p', 'guide-intro', de ? 'Sonnenpfad findet Fußwege in ganz Stuttgart: mit mehr Schatten, mehr Sonne oder passend zu deinen Bedürfnissen. So geht’s:' : 'Sonnenpfad finds walking routes across Stuttgart: with more shade, more sun or suited to your needs. Here is how:');
 const fragment = document.createDocumentFragment(); fragment.append(intro, tabs, box); return fragment;
}


// Analysis in explore mode: district selection, combined attribute filters (AND), result figures and
// export, on the thesis working network (dist/city/planner, scripts/export_planner_data.py).
const PLANNER_SLOPE_MAX=30;
// Defaults for a newly added numeric filter (the planner changes them freely).
const NUMERIC_DEFAULTS={slope:5,shadeSummer:20,shadeWinter:20,utciSummer:32,utciWinter:-5,noise:65,wind:.5,width:1.5,length:50};

// ---- Pure model: shared by the map expression, the counts and the tests --------------------------
function analysisActive(state){return state.districts.size>0||state.filters.length>0;}
function numericTest(value,filter){
 if(filter.op==='gt')return value>filter.value;
 if(filter.op==='lt')return value<filter.value;
 if(filter.op==='eq')return Math.abs(value-filter.value)<1e-9;
 const low=Math.min(filter.value,filter.value2),high=Math.max(filter.value,filter.value2);return value>=low&&value<=high;
}
// Missing values are their own case: a filter keeps them only when `missing` is ticked.
function filterMatches(p,filter){
 if(filter.type==='number'){const value=p['x_'+filter.key];return value===undefined||value===null?filter.missing:numericTest(value,filter);}
 const code=p['c_'+filter.key];if(code===undefined||code===null)return filter.missing;
 return filter.mode==='exclude'?!filter.codes.has(code):filter.codes.has(code);
}
function analysisMatches(p,state){
 if(state.districts.size&&!state.districts.has(p.d))return false;
 return state.filters.every(filter=>filterMatches(p,filter));
}
function analysisMapFilter(state){
 const parts=['all'];
 if(state.districts.size)parts.push(['in',['get','d'],['literal',[...state.districts]]]);
 for(const filter of state.filters){
  if(filter.type==='number'){
   const key='x_'+filter.key,value=['get',key],low=Math.min(filter.value,filter.value2??filter.value),high=Math.max(filter.value,filter.value2??filter.value);
   const test=filter.op==='gt'?['>',value,filter.value]:filter.op==='lt'?['<',value,filter.value]:filter.op==='eq'?['==',value,filter.value]:['all',['>=',value,low],['<=',value,high]];
   parts.push(['case',['has',key],test,filter.missing]);
  }else{
   const key='c_'+filter.key,inside=['in',['get',key],['literal',[...filter.codes]]];
   parts.push(['case',['has',key],filter.mode==='exclude'?['!',inside]:inside,filter.missing]);
  }
 }
 return parts;
}
function analysisSummary(features,state){
 const perDistrict=new Map();let pieces=0,metres=0,areaMetres=0,missing=0;
 for(const item of features){
  const p=item.properties;if(state.districts.size&&!state.districts.has(p.d))continue;areaMetres+=p.m;
  if(!analysisMatches(p,state))continue;pieces++;metres+=p.m;perDistrict.set(p.d,(perDistrict.get(p.d)||0)+1);
  if(state.filters.some(filter=>filter.missing&&(filter.type==='number'?p['x_'+filter.key]==null:p['c_'+filter.key]==null)))missing++;
 }
 return {pieces,metres,areaMetres,share:areaMetres?metres/areaMetres:0,missing,perDistrict};
}
// Compact, URL-safe form of the analysis (shared links reproduce it exactly).
function encodeAnalysis(state){
 if(!state.filters.length)return '';
 return state.filters.map(f=>f.type==='number'?[f.key,f.op,f.value,f.op==='between'?f.value2:'',f.missing?1:0].join('~'):[f.key,f.mode,[...f.codes].join('.'),f.missing?1:0].join('~')).join('_');
}
function decodeAnalysis(text,schema){
 const filters=[];
 for(const part of String(text||'').split('_').filter(Boolean)){
  const [key,a,b,c,d]=part.split('~'),definition=schema.find(item=>item.key===key);if(!definition)continue;
  if(definition.type==='number'&&['gt','lt','eq','between'].includes(a)&&Number.isFinite(+b))filters.push({key,type:'number',op:a,value:+b,value2:a==='between'&&Number.isFinite(+c)?+c:undefined,missing:d==='1'});
  else if(definition.type==='category'&&['include','exclude'].includes(a)){const codes=new Set(String(b).split('.').filter(code=>definition.categories.some(item=>item.code===code)));filters.push({key,type:'category',mode:a,codes,missing:c==='1'});}
 }
 return filters;
}
// Export rows: one per matching section, stable column names, geometry as WKT in EPSG:4326.
function exportColumns(schema){
 const unit={'%':'pct','°C':'c',dB:'db',m:'m','':''};
 return ['segment_id','atlas_id','district_id','district','name',...schema.map(a=>a.type==='number'?[a.key.replace(/[A-Z]/g,c=>'_'+c.toLowerCase()),unit[a.unit]].filter(Boolean).join('_'):a.key.replace(/[A-Z]/g,c=>'_'+c.toLowerCase())),'geometry_wkt','crs'];
}
function exportRow(p,coordinates,schema){
 return [p.sid,p.a,p.d,p.dn,p.nm,...schema.map(a=>a.type==='number'?(a.key==='length'?p.m:p['x_'+a.key]??''):p['c_'+a.key]??''),'LINESTRING('+coordinates.map(c=>c[0]+' '+c[1]).join(', ')+')','EPSG:4326'];
}
function csvText(rows){
 const cell=value=>{const text=value===null||value===undefined?'':String(value);return /[",\n;]/.test(text)?'"'+text.replace(/"/g,'""')+'"':text;};
 return '﻿'+rows.map(row=>row.map(cell).join(',')).join('\r\n')+'\r\n';
}

// ---- Interface ---------------------------------------------------------------------------------
let plannerIndex=null,plannerIndexPending=null,plannerFeatures=[];
const plannerFiles=new Map();
const plannerState={districts:new Set(),filters:[]};
let plannerLoadId=0,plannerInitialFit=true,lastSummary=null;
const label=item=>item?.[lang==='en'?'en':'de']||'';

async function ensurePlannerIndex(){
 if(plannerIndex)return plannerIndex;
 // The index is always revalidated (cheap 304); district files carry their content revision in the URL.
 plannerIndexPending??=fetch(new URL('planner/districts.json',cityBaseURL),{cache:'no-cache'}).then(r=>{if(!r.ok)throw Error('planner-index');return r.json();}).then(value=>{if(value.version!==2||value.districts?.length!==23||!value.attributes?.length)throw Error('planner-contract');plannerIndex=value;return value;}).catch(error=>{plannerIndexPending=null;throw error;});
 return plannerIndexPending;
}
function featureProperties(data,i,district,schema,counter){
 const x=key=>data.n[key]?.[i],c=key=>{const code=data.c[key]?.[i];return code===null||code===undefined?null:schema.find(a=>a.key===key).categories[code].code;};
 const quality={good:1,medium:2,poor:3}[c('surfaceQuality')]||0,stairs=c('stairs')==='yes',p={sl:x('slope')??-1,su:quality,ss:x('shadeSummer')??-1,sw:x('shadeWinter')??-1,us:x('utciSummer')??-999,uw:x('utciWinter')??-999,n:x('noise')??-1,w:x('wind')??-1,
  steps:stairs?1:0,st:(c('bridge')==='yes'?1:0)|(c('tunnel')==='yes'?2:0),d:district.id,dn:district.name,m:x('length'),nm:data.nm[i]||'',a:data.a[i]||'',planner:1};
 counter.set(p.a,(counter.get(p.a)||0)+1);p.sid=`${p.d}-${p.a}-${counter.get(p.a)}`;
 for(const attribute of schema){if(attribute.type==='number'){const value=x(attribute.key);if(value!==null&&value!==undefined)p['x_'+attribute.key]=value;}else{const code=c(attribute.key);if(code!==null)p['c_'+attribute.key]=code;}}
 return p;
}
async function plannerDistrictFeatures(district){
 if(plannerFiles.has(district.id))return plannerFiles.get(district.id);
 const schema=plannerIndex.attributes,counter=new Map();
 const job=fetch(new URL(`planner/${district.file}${district.rev?'?v='+district.rev:''}`,cityBaseURL)).then(r=>{if(!r.ok)throw Error(district.file);return r.json();}).then(data=>data.lines.map((coordinates,i)=>feature('LineString',coordinates,featureProperties(data,i,district,schema,counter))));
 plannerFiles.set(district.id,job);job.catch(()=>plannerFiles.delete(district.id));return job;
}

function installPlannerLayers(index){
 if(map.getSource('districts'))return;
 const labels=fc(index.districts.map(d=>feature('Point',d.label,{id:d.id,name:d.name})));
 map.addSource('districts',{type:'geojson',data:index.boundaries,promoteId:'id'});map.addSource('district-labels',{type:'geojson',data:labels});map.addSource('planner',{type:'geojson',data:fc([])});
 map.addLayer({id:'district-dim',type:'fill',source:'districts',layout:{visibility:'none'},paint:{'fill-color':'#edf1f2','fill-opacity':.55}},'route-halo');
 map.addLayer({id:'planner-line',type:'line',source:'planner',layout:{'line-cap':'round','line-join':'round',visibility:'none'},paint:{'line-width':['interpolate',['linear'],['zoom'],10,.8,12.5,1.4,14.5,2.4,17,3.6,20,6],'line-opacity':.95}},'route-halo');
 map.addLayer({id:'district-line',type:'line',source:'districts',layout:{visibility:'none','line-join':'round'},paint:{'line-color':'#56636a','line-width':['interpolate',['linear'],['zoom'],10,.8,14,1.6],'line-opacity':.75,'line-dasharray':[3,2]}},'route-halo');
 map.addLayer({id:'district-selected',type:'line',source:'districts',layout:{visibility:'none','line-join':'round'},filter:['in',['get','id'],['literal',[]]],paint:{'line-color':'#1a56c4','line-width':['interpolate',['linear'],['zoom'],10,2,14,3.5]}},'route-halo');
 map.addLayer({id:'district-label',type:'symbol',source:'district-labels',maxzoom:14.5,layout:{visibility:'none','text-field':['get','name'],'text-font':['Noto Sans Regular'],'text-size':['interpolate',['linear'],['zoom'],10,10,13,12.5],'text-transform':'uppercase','text-letter-spacing':.12,'text-allow-overlap':false},paint:{'text-color':'#1a56c4','text-halo-color':'#ffffff','text-halo-width':1.6}});
}

function areaLabel(){
 if(!plannerIndex||!plannerState.districts.size)return tr('allDistricts');
 const names=plannerIndex.districts.filter(d=>plannerState.districts.has(d.id)).map(d=>d.name);
 return names.length<=3?names.join(', '):`${names.length} ${tr('districts')}: ${names.slice(0,2).join(', ')} …`;
}
const OPERATORS=['gt','lt','eq','between'];
function filterSummary(filter){
 const attribute=plannerIndex?.attributes.find(a=>a.key===filter.key);if(!attribute)return '';
 if(filter.type==='number'){const unit=attribute.unit?' '+attribute.unit:'',value=v=>Number(v).toLocaleString(lang)+unit;return `${label(attribute)} ${filter.op==='between'?`${value(filter.value)}–${value(filter.value2)}`:{gt:'>',lt:'<',eq:'='}[filter.op]+' '+value(filter.value)}`;}
 // Yes/no attributes read as a plain answer: "Treppe: Nein" instead of "Treppe: nicht Ja".
 const effective=filter.mode==='exclude'?attribute.categories.filter(item=>!filter.codes.has(item.code)):attribute.categories.filter(item=>filter.codes.has(item.code));
 if(attribute.categories.length===2&&attribute.categories.every(item=>['yes','no'].includes(item.code))&&effective.length===1)return `${label(attribute)}: ${label(effective[0])}`;
 const names=attribute.categories.filter(item=>filter.codes.has(item.code)).map(label);
 return `${label(attribute)}: ${filter.mode==='exclude'?tr('filterNot')+' ':''}${names.join(', ')||'–'}`;
}
function renderFilterCards(){
 const holder=$('filter-list');if(!holder||!plannerIndex)return;holder.replaceChildren();
 plannerState.filters.forEach((filter,index)=>{
  const attribute=plannerIndex.attributes.find(a=>a.key===filter.key),card=document.createElement('div');card.className='filter-card';
  const head=document.createElement('div');head.className='filter-head';const title=document.createElement('strong');title.textContent=label(attribute)+(attribute.unit?` (${attribute.unit})`:'');
  const remove=document.createElement('button');remove.type='button';remove.className='filter-remove';remove.textContent='×';remove.title=remove.ariaLabel=tr('filterRemove');remove.onclick=()=>{plannerState.filters.splice(index,1);applyPlanner();};
  head.append(title,remove);card.append(head);
  const row=document.createElement('div');row.className='filter-row';
  if(filter.type==='number'){
   const op=document.createElement('select');op.setAttribute('aria-label',tr('filterOperator'));for(const code of OPERATORS){const option=new Option(tr('op_'+code),code);option.selected=code===filter.op;op.append(option);}
   const input=(value,name)=>{const element=document.createElement('input');element.type='number';element.step='any';element.value=String(value??'');element.setAttribute('aria-label',name);element.onchange=()=>{const number=Number(element.value);if(Number.isFinite(number)){filter[name===tr('filterValueTo')?'value2':'value']=number;applyPlanner();}};return element;};
   op.onchange=()=>{filter.op=op.value;if(filter.op==='between'&&!Number.isFinite(filter.value2))filter.value2=filter.value+5;applyPlanner();};
   row.append(op,input(filter.value,tr('filterValue')));if(filter.op==='between'){const dash=document.createElement('span');dash.textContent='–';row.append(dash,input(filter.value2,tr('filterValueTo')));}
  }else{
   const mode=document.createElement('select');mode.setAttribute('aria-label',tr('filterMode'));for(const code of ['include','exclude']){const option=new Option(tr('mode_'+code),code);option.selected=code===filter.mode;mode.append(option);}mode.onchange=()=>{filter.mode=mode.value;applyPlanner();};
   row.append(mode);const chips=document.createElement('div');chips.className='filter-chips';
   for(const item of attribute.categories){const chip=document.createElement('label');chip.className='filter-chip';chip.innerHTML='<input type="checkbox"><span></span>';const box=chip.querySelector('input');box.checked=filter.codes.has(item.code);chip.querySelector('span').textContent=label(item);box.onchange=()=>{box.checked?filter.codes.add(item.code):filter.codes.delete(item.code);applyPlanner();};chips.append(chip);}
   card.append(row,chips);
  }
  if(filter.type==='number')card.append(row);
  const missing=document.createElement('label');missing.className='planner-check filter-missing';missing.innerHTML='<input type="checkbox"><span></span>';missing.querySelector('input').checked=filter.missing;missing.querySelector('span').textContent=tr('filterIncludeMissing');missing.querySelector('input').onchange=event=>{filter.missing=event.target.checked;applyPlanner();};
  if(attribute.complete)missing.hidden=true;
  card.append(missing);holder.append(card);
 });
 const add=$('filter-add');add.replaceChildren(new Option(tr('filterAdd'),''));for(const attribute of plannerIndex.attributes)add.append(new Option(label(attribute)+(attribute.unit?` (${attribute.unit})`:''),attribute.key));add.value='';
}
function renderPlannerControls(){
 const box=$('planner');if(!box)return;box.hidden=!exploreMode;
 $('planner-title').textContent=tr('analysisTitle');$('district-summary').textContent=areaLabel();$('filter-heading').textContent=tr('filterHeading');
 $('planner-reset').textContent=tr('resetAll');$('district-all').textContent=tr('all');$('district-none').textContent=tr('wholeCity');$('planner-source').textContent=tr('analysisSource');
 $('export-csv').textContent=tr('exportCsv');$('export-geojson').textContent=tr('exportGeojson');$('export-note').textContent=tr('exportNote');
 $('planner-reset').hidden=!analysisActive(plannerState);$('planner-export').hidden=!analysisActive(plannerState)||!lastSummary?.pieces;
 const chip=$('planner-chip');if(chip){chip.hidden=!exploreMode||!analysisActive(plannerState);$('planner-chip-open').textContent=[areaLabel(),...plannerState.filters.map(filterSummary)].join(' · ');$('planner-chip-clear').setAttribute('aria-label',tr('resetAll'));}
 for(const input of document.querySelectorAll('#district-options input'))input.checked=plannerState.districts.has(+input.value);
 renderFilterCards();
}
function renderPlannerResult(text,empty=false){const box=$('planner-result');box.textContent=text;box.classList.toggle('is-empty',empty);box.hidden=!text;}

function syncPlannerURL(){
 const query=new URLSearchParams(location.search);query.delete('steigungAb');
 if(exploreMode&&plannerState.districts.size)query.set('bezirke',[...plannerState.districts].sort((a,b)=>a-b).join(','));else query.delete('bezirke');
 const encoded=exploreMode?encodeAnalysis(plannerState):'';if(encoded)query.set('filter',encoded);else query.delete('filter');
 history.replaceState(null,'',location.pathname+(query.size?'?'+query:''));
}

async function applyPlanner({fit=false}={}){
 if(!map?.getLayer?.('route-halo')){renderPlannerControls();return;}
 let index;try{index=await ensurePlannerIndex();}catch(error){console.warn(error);renderPlannerResult(exploreMode?tr('districtDataCouldNotBe'):'',true);return;}
 installPlannerLayers(index);renderPlannerControls();
 const active=exploreMode&&analysisActive(plannerState),visible=exploreMode?'visible':'none';
 for(const id of ['district-line','district-label'])map.setLayoutProperty(id,'visibility',visible);
 map.setLayoutProperty('district-selected','visibility',exploreMode&&plannerState.districts.size?'visible':'none');map.setFilter('district-selected',['in',['get','id'],['literal',[...plannerState.districts]]]);
 map.setLayoutProperty('district-dim','visibility',exploreMode&&plannerState.districts.size?'visible':'none');map.setFilter('district-dim',['!',['in',['get','id'],['literal',[...plannerState.districts]]]]);
 // The analysis layer replaces the ordinary network while an area or filter is active.
 map.setLayoutProperty('planner-line','visibility',active?'visible':'none');
 for(const id of ['network-line','stairs-halo','stairs-treads','slope-arrows'])if(map.getLayer(id)&&active)map.setLayoutProperty(id,'visibility','none');
 if(!active){lastSummary=null;if(map.getLayer('network-line'))map.setLayoutProperty('network-line','visibility',visible);for(const id of ['stairs-halo','stairs-treads','slope-arrows'])if(map.getLayer(id))map.setLayoutProperty(id,'visibility',exploreMode&&activeTheme==='slope'?'visible':'none');renderPlannerResult('');renderPlannerControls();syncPlannerURL();return;}
 const definition=THEME_DEFS[activeTheme]||THEME_DEFS.slope;map.setPaintProperty('planner-line','line-color',['case',['==',['get','steps'],1],'#4a4f54',definition.expression]);map.setFilter('planner-line',analysisMapFilter(plannerState));
 if(plannerInitialFit&&plannerState.districts.size){fit=true;plannerInitialFit=false;}
 const wanted=index.districts.filter(d=>!plannerState.districts.size||plannerState.districts.has(d.id)),id=++plannerLoadId;
 if(fit&&plannerState.districts.size){const b=wanted.reduce((box,d)=>[Math.min(box[0],d.bbox[0]),Math.min(box[1],d.bbox[1]),Math.max(box[2],d.bbox[2]),Math.max(box[3],d.bbox[3])],[180,90,-180,-90]);map.fitBounds([[b[0],b[1]],[b[2],b[3]]],{padding:isMobileMap()?{top:70,bottom:Math.min(innerHeight*.45,320),left:24,right:24}:{top:150,bottom:190,left:60,right:90},duration:500});}
 if(wanted.some(d=>!plannerFiles.has(d.id)))renderPlannerResult(tr('loadingData'));
 let loaded;try{loaded=(await Promise.all(wanted.map(plannerDistrictFeatures))).flat();}catch(error){console.warn(error);if(id===plannerLoadId)renderPlannerResult(tr('districtDataCouldNotBe'),true);return;}
 if(id!==plannerLoadId)return;
 if(loaded!==plannerFeatures){plannerFeatures=loaded;map.getSource('planner').setData(fc(loaded));}
 const summary=lastSummary=analysisSummary(loaded,plannerState),km=(summary.metres/1000).toLocaleString(lang,{maximumFractionDigits:1});
 if(!summary.pieces)renderPlannerResult(tr('noSectionMatchesThisSelection'),true);
 else{const parts=wanted.length>1&&wanted.length<=4?' ('+wanted.map(d=>`${d.name} ${summary.perDistrict.get(d.id)||0}`).join(', ')+')':'';const gaps=summary.missing?tr('plannerMissing',{count:summary.missing}):'';renderPlannerResult(tr('plannerSections',{count:summary.pieces.toLocaleString(lang),km,parts,gaps})+' · '+tr('networkShare',{share:(summary.share*100).toLocaleString(lang,{maximumFractionDigits:1})}));}
 renderPlannerControls();syncPlannerURL();
}

function exportAnalysis(format){
 if(!plannerIndex||!lastSummary?.pieces)return;track('export',format);
 const schema=plannerIndex.attributes,matches=plannerFeatures.filter(item=>analysisMatches(item.properties,plannerState)),columns=exportColumns(schema);
 const stamp=new Date().toISOString().replace(/[-:]/g,'').slice(0,13).replace('T','-'),area=plannerState.districts.size?plannerIndex.districts.filter(d=>plannerState.districts.has(d.id)).map(d=>d.name).join('-'):'stuttgart';
 const slug=area.normalize('NFKD').replace(/[̀-ͯ]/g,'').replace(/ß/g,'ss').replace(/[^A-Za-z0-9]+/g,'-').replace(/^-|-$/g,'').toLowerCase().slice(0,60),name=`sonnenpfad-analyse_${slug}_${stamp}`;
 let blob;
 if(format==='csv')blob=new Blob([csvText([columns,...matches.map(item=>exportRow(item.properties,item.geometry.coordinates,schema))])],{type:'text/csv;charset=utf-8'});
 else{
  const features=matches.map(item=>{const row=exportRow(item.properties,item.geometry.coordinates,schema),properties=Object.fromEntries(columns.slice(0,-2).map((column,i)=>[column,row[i]===''?null:row[i]]));return {type:'Feature',geometry:{type:'LineString',coordinates:item.geometry.coordinates},properties};});
  blob=new Blob([JSON.stringify({type:'FeatureCollection',name,sonnenpfad:{crs:'EPSG:4326',area:areaLabel(),filters:plannerState.filters.map(filterSummary),source:plannerIndex.source,licence:'ODbL 1.0 – © OpenStreetMap contributors; Fußgängeratlas Stuttgart (M. Bakhshi)',created:new Date().toISOString()},features})],{type:'application/geo+json'});
 }
 const link=document.createElement('a');link.href=URL.createObjectURL(blob);link.download=`${name}.${format==='csv'?'csv':'geojson'}`;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(link.href),2000);
}

// Extra rows of the detail popup: path width and every recorded category of the section.
function analysisDetailRows(p){
 if(!plannerIndex)return [];const rows=[];
 for(const attribute of plannerIndex.attributes){
  if(attribute.type==='number'&&attribute.key==='width'&&p.x_width!=null)rows.push([label(attribute),Number(p.x_width).toLocaleString(lang)+' m']);
  if(attribute.type==='category'&&p['c_'+attribute.key]&&!['stairs','bridge','tunnel','surfaceQuality'].includes(attribute.key))rows.push([label(attribute),label(attribute.categories.find(item=>item.code===p['c_'+attribute.key]))]);
 }
 return rows;
}
function addFilter(key){
 const attribute=plannerIndex?.attributes.find(a=>a.key===key);if(!attribute)return;track('filter',key);
 // Gradient keeps the earlier decision: sections without a value stay visible (grey) by default.
 plannerState.filters.push(attribute.type==='number'?{key,type:'number',op:'gt',value:NUMERIC_DEFAULTS[key]??0,missing:key==='slope'}:{key,type:'category',mode:'include',codes:new Set(attribute.categories.slice(0,1).map(item=>item.code)),missing:false});
 applyPlanner();
}
function setupPlanner(){
 const box=$('planner');if(!box)return;
 const query=new URLSearchParams(location.search);
 for(const value of (query.get('bezirke')||'').split(',').map(Number))if(Number.isInteger(value)&&value>0)plannerState.districts.add(value);
 ensurePlannerIndex().then(index=>{
  const holder=$('district-options');holder.replaceChildren();
  for(const d of index.districts){const item=document.createElement('label');item.className='district-option';item.innerHTML='<input type="checkbox"><span></span>';item.querySelector('input').value=d.id;item.querySelector('span').textContent=d.name;item.querySelector('input').onchange=event=>{if(event.target.checked){plannerState.districts.add(d.id);track('district',d.id);}else plannerState.districts.delete(d.id);applyPlanner({fit:true});};holder.append(item);}
  for(const id of [...plannerState.districts])if(!index.districts.some(d=>d.id===id))plannerState.districts.delete(id);
  plannerState.filters=decodeAnalysis(query.get('filter'),index.attributes);
  // Links from 0.19–0.21: steigungAb=5 means gradient above 5 % without stairs, gaps shown.
  const min=Number(query.get('steigungAb'));if(query.has('steigungAb')&&Number.isFinite(min)&&!plannerState.filters.length)plannerState.filters.push({key:'slope',type:'number',op:'gt',value:Math.min(PLANNER_SLOPE_MAX,Math.max(0,min)),missing:true},{key:'stairs',type:'category',mode:'exclude',codes:new Set(['yes']),missing:false});
  applyPlanner();
 }).catch(console.warn);
 $('filter-add').onchange=event=>addFilter(event.target.value);
 $('district-all').onclick=()=>{for(const d of plannerIndex?.districts||[])plannerState.districts.add(d.id);applyPlanner({fit:true});};
 $('district-none').onclick=()=>{plannerState.districts.clear();applyPlanner();};
 $('planner-chip-open').onclick=()=>{$('layers-panel').hidden=false;$('layers-toggle').setAttribute('aria-expanded','true');};
 $('planner-chip-clear').onclick=()=>$('planner-reset').click();
 $('planner-reset').onclick=()=>{plannerState.districts.clear();plannerState.filters=[];applyPlanner();};
 $('export-csv').onclick=()=>exportAnalysis('csv');$('export-geojson').onclick=()=>exportAnalysis('geojson');
 renderPlannerControls();
}


// Turn-by-turn directions and live navigation along the calculated route (local metric coordinates).

const bearingOf=(a,b)=>(Math.atan2(b[0]-a[0],b[1]-a[1])*180/Math.PI+360)%360;
const turnAngle=(incoming,outgoing)=>((outgoing-incoming+540)%360)-180;
function pointAt(measure,distance){
 const {coords,cumulative,total}=measure,d=Math.max(0,Math.min(total,distance));
 let i=1;while(i<cumulative.length-1&&cumulative[i]<d)i++;
 const span=cumulative[i]-cumulative[i-1]||1,f=(d-cumulative[i-1])/span,a=coords[i-1],b=coords[i];
 return [a[0]+(b[0]-a[0])*f,a[1]+(b[1]-a[1])*f];
}
function routeBearingAt(measure,distance,look=12){return bearingOf(pointAt(measure,distance-look/2),pointAt(measure,distance+look));}
function turnKind(angle){
 const size=Math.abs(angle),side=angle>0?'Right':'Left';
 if(size<35)return null;if(size<60)return 'slight'+side;if(size<135)return side.toLowerCase();if(size<165)return 'sharp'+side;return 'uturn';
}
// One maneuver per real change of direction; vertices of a gently curving path never count.
function routeManeuvers(coords,{look=15,merge=12}={}){
 const measure=routeMeasure(coords),found=[];
 if(measure.total<1)return [];
 for(let i=1;i<coords.length-1;i++){
  const at=measure.cumulative[i];if(at<look/2||measure.total-at<look/2)continue;
  const angle=turnAngle(bearingOf(pointAt(measure,at-look),coords[i]),bearingOf(coords[i],pointAt(measure,at+look))),kind=turnKind(angle);
  if(!kind)continue;
  const last=found.at(-1);
  if(last&&at-last.at<merge){if(Math.abs(angle)>Math.abs(last.angle))Object.assign(last,{at,angle,kind,point:coords[i]});continue;}
  found.push({at,angle,kind,point:coords[i]});
 }
 found.push({at:measure.total,angle:0,kind:'arrive',point:coords.at(-1)});
 return found;
}
// Nearest point of the route; `along` is the travelled distance, `distance` the offset from the route.
function locateOnRoute(measure,p,hint=0){
 const {coords,cumulative}=measure;let best={distance:Infinity,along:0,index:0};
 for(let i=1;i<coords.length;i++){
  const a=coords[i-1],b=coords[i],dx=b[0]-a[0],dy=b[1]-a[1],den=dx*dx+dy*dy,t=den?Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dy)/den)):0;
  const distance=Math.hypot(p[0]-(a[0]+t*dx),p[1]-(a[1]+t*dy)),along=cumulative[i-1]+t*Math.sqrt(den);
  // Prefer the part ahead of the last known position where a route passes itself.
  const score=distance+(along<hint-25?15:0);
  if(score<best.distance+(best.along<hint-25?15:0))best={distance,along,index:i};
 }
 return best;
}
const TURN_ARROWS={left:'↰',right:'↱',slightLeft:'↖',slightRight:'↗',sharpLeft:'⤺',sharpRight:'⤻',uturn:'⮌',arrive:'⚑',straight:'↑'};
function maneuverText(kind,language='de'){
 const de=language==='de';
 return ({left:tr('turnLeft'),right:tr('turnRight'),slightLeft:tr('keepSlightlyLeft'),slightRight:tr('keepSlightlyRight'),
  sharpLeft:tr('turnSharpLeft'),sharpRight:tr('turnSharpRight'),uturn:tr('turnAround'),arrive:tr('arriveAtDestination'),straight:tr('continueStraight')})[kind];
}
function formatMetres(metres){return metres>=1000?(metres/1000).toLocaleString(lang,{maximumFractionDigits:1})+' km':Math.max(5,Math.round(metres/5)*5)+' m';}

function renderDirections(){
 const box=$('directions'),list=$('directions-list');if(!box||!list)return;
 list.replaceChildren();if(!result?.coords?.length||result.error){box.hidden=true;return;}
 const maneuvers=routeManeuvers(result.coords);let previous=0;
 const head=document.createElement('li');head.innerHTML='<i>↑</i><span></span>';head.querySelector('span').textContent=tr('startWalking');list.append(head);
 for(const item of maneuvers){const row=document.createElement('li');row.innerHTML='<i></i><span></span><small></small>';row.querySelector('i').textContent=TURN_ARROWS[item.kind];row.querySelector('span').textContent=maneuverText(item.kind,lang);row.querySelector('small').textContent=(tr('after'))+formatMetres(item.at-previous);previous=item.at;list.append(row);}
 $('directions-title').textContent=tr('directionsTitle',{count:maneuvers.length});box.hidden=false;
 $('navigate').hidden=!navigator.geolocation;$('navigate').textContent=tr('startNavigation');
 const mobile=$('mobile-navigate');if(mobile){mobile.hidden=!navigator.geolocation;mobile.textContent=tr('go');}
}

let nav=null;
function navigationMarker(){const el=document.createElement('div');el.className='nav-position';el.innerHTML='<span></span>';return new maplibregl.Marker({element:el,rotationAlignment:'map'});}
function setNavBanner({arrow='↑',instruction='',remaining='',reroute=false}){$('nav-turn').textContent=arrow;$('nav-instruction').textContent=instruction;$('nav-remaining').textContent=remaining;$('nav-reroute').hidden=!reroute;}
function startNavigation(){
 if(!result?.coords?.length||result.error||!navigator.geolocation||!map)return;
 stopRoutePreview(false);featurePopup?.remove();track('nav','start');
 nav={measure:routeMeasure(result.coords),maneuvers:routeManeuvers(result.coords),along:0,off:0,marker:navigationMarker(),lock:null,arrived:false,watch:null,rerouting:false};
 document.body.classList.add('is-navigating');$('nav-banner').hidden=false;$('sidebar-body').classList.remove('expanded');$('panel-toggle').setAttribute('aria-expanded','false');
 $('nav-stop').textContent=tr('end');$('nav-reroute').textContent=tr('recalculate');
 setNavBanner({arrow:'⌖',instruction:tr('findingYourLocation')});
 navigator.wakeLock?.request('screen').then(lock=>{if(nav)nav.lock=lock;else lock.release();}).catch(()=>{});
 nav.watch=navigator.geolocation.watchPosition(onNavigationPosition,()=>setNavBanner({arrow:'!',instruction:t('locationFail')}),{enableHighAccuracy:true,maximumAge:2000,timeout:20000});
 syncMobileDock();
}
function stopNavigation(){
 if(!nav)return;navigator.geolocation.clearWatch(nav.watch);nav.marker.remove();nav.lock?.release?.().catch?.(()=>{});nav=null;
 document.body.classList.remove('is-navigating');$('nav-banner').hidden=true;map?.easeTo({bearing:0,duration:400});syncMobileDock();
}
function onNavigationPosition(position){
 if(!nav)return;const p=[position.coords.longitude,position.coords.latitude],here=local(p),place=locateOnRoute(nav.measure,here,nav.along),de=lang==='de';
 nav.marker.setLngLat(p).addTo(map);
 if(nav.rerouting)return;
 nav.off=place.distance>35?nav.off+1:0;if(place.distance<=35)nav.along=Math.max(nav.along-10,place.along);
 const heading=Number.isFinite(position.coords.heading)&&position.coords.speed>.6?position.coords.heading:routeBearingAt(nav.measure,nav.along);
 nav.marker.setRotation(heading);map.easeTo({center:p,zoom:Math.max(map.getZoom(),17.5),bearing:heading,duration:900,essential:true});
 const remaining=Math.max(0,nav.measure.total-nav.along),minutes=Number.isFinite(result?.minutes)&&nav.measure.total?Math.max(1,Math.round(result.minutes*remaining/nav.measure.total)):null,summary=`${formatMetres(remaining)}${minutes?' · '+formatWalkDuration(minutes,lang):''}`;
 if(nav.off>=2){setNavBanner({arrow:'!',instruction:tr('youLeftTheRoute'),remaining:summary,reroute:true});return;}
 if(remaining<20){if(!nav.arrived)track('nav','arrive');nav.arrived=true;setNavBanner({arrow:'⚑',instruction:tr('youHaveArrived'),remaining:''});return;}
 const next=nav.maneuvers.find(item=>item.at>nav.along+3)||nav.maneuvers.at(-1),distance=next.at-nav.along;
 setNavBanner({arrow:TURN_ARROWS[distance>150&&next.kind!=='arrive'?'straight':next.kind],instruction:distance>150&&next.kind!=='arrive'?`${maneuverText('straight',lang)} · ${formatMetres(distance)}`:`In ${formatMetres(distance)}: ${maneuverText(next.kind,lang)}`,remaining:summary});
}
function rerouteNavigation(){
 if(!nav)return;track('nav','reroute');navigator.geolocation.getCurrentPosition(position=>{if(!nav)return;const p=[position.coords.longitude,position.coords.latitude];if(!inPilot(p)){showToast('outsideLocation');return;}nav.rerouting=true;setNavBanner({arrow:'⟳',instruction:tr('recalculating')});setCustom(0,p,tr('myLocation'));calculate();},()=>setNavBanner({arrow:'!',instruction:t('locationFail'),reroute:true}),{enableHighAccuracy:true,timeout:15000,maximumAge:5000});
}
// A new route while navigating (reroute or changed settings) continues the navigation on it.
function navigationRouteChanged(){
 if(!nav)return;if(!result?.coords?.length||result.error){nav.rerouting=false;setNavBanner({arrow:'!',instruction:t(result?.error||'modelFailed'),reroute:true});return;}
 Object.assign(nav,{measure:routeMeasure(result.coords),maneuvers:routeManeuvers(result.coords),along:0,off:0,rerouting:false});
}
function setupNavigation(){
 $('navigate').onclick=startNavigation;$('nav-stop').onclick=stopNavigation;$('nav-reroute').onclick=rerouteNavigation;
 const mobile=$('mobile-navigate');if(mobile)mobile.onclick=startNavigation;
}

// API 0.2 metadata describes oriented route pieces. Atlas heights are interpolated,
// not resampled from terrain; unknown attributes must remain unknown.
const ROUTING_API='https://138.2.184.1';
function usesServerRouting(options={}) {
 return options.preference==='balanced' && (!options.mobilityProfile||options.mobilityProfile==='standard') && !options.gentle && (!options.slopeMode||options.slopeMode==='none') && !['avoidSteps','avoidEscalators','avoidPoorSurface','avoidWheelchairNo','maxSlope'].some(key=>options[key]);
}
async function requestServerRoute(start,end,{signal,fetchImpl=fetch}={}) {
 const url=new URL('/route',ROUTING_API);
 for(const [key,value] of Object.entries({start_lon:start[0],start_lat:start[1],end_lon:end[0],end_lat:end[1],profile:'shortest',max_snap_m:50,include_segments:true}))url.searchParams.set(key,String(value));
 const response=await fetchImpl(url,{signal,headers:{Accept:'application/json'},credentials:'omit'});
 if(!response.ok){let detail='';try{detail=(await response.json()).detail||'';}catch{}const error=new Error(String(detail||'Routing service unavailable'));error.routeError=response.status===404?(detail.includes('within')?'serverOutside':'disconnected'):'serverUnavailable';throw error;}
 const data=await response.json();
 if(data?.type!=='FeatureCollection'||data.properties?.profile!=='shortest'||data.properties?.segment_metadata_version!==1||!Array.isArray(data.properties.segments))throw Error('Invalid routing metadata');
 return data;
}
function atlasNumber(value){if(value===null||value===undefined||String(value).trim()==='')return null;const n=Number(value);return Number.isFinite(n)?n:null;}
function osmTags(value){if(typeof value==='string'){try{return JSON.parse(value);}catch{return {};}}return value&&typeof value==='object'?value:{};}
function adaptServerRoute(data,toLocal,shadeFractions=null) {
 const p=data.properties,segments=p.segments;
 if(!Number.isFinite(p.distance_m)||p.distance_m<0||segments.length!==p.route_parts)throw Error('Invalid route length or segment count');
 if(!segments.length){if(p.distance_m>.01)throw Error('Missing route pieces');return {error:'same'};}
 let length=0,ascent=0,descent=0,heightsComplete=true,shaded=0,steps=0,escalators=0,previousStairs=null,previousEscalator=null;
 const coords=[],profile=[],quality={surfaceKnown:0,slopeKnown:0,widthKnown:0,wheelchairKnown:0,poorSurface:0,limitedWheelchair:0,maxUphill:null,maxDownhill:null,minWidth:null};
 for(let i=0;i<segments.length;i++){
  const s=segments[i],a=s.atlas_attributes||{},tags=osmTags(a.routing_osm_tags),len=s.length_m,t0=s.atlas_t0,t1=s.atlas_t1;
  if(!Number.isFinite(len)||len<=0||![t0,t1].every(t=>Number.isFinite(t)&&t>=0&&t<=1)||s.geometry?.type!=='LineString'||s.geometry.coordinates.length<2)throw Error('Invalid route piece');
  const points=s.geometry.coordinates.map(point=>{if(!Array.isArray(point)||!point.every(Number.isFinite))throw Error('Invalid coordinate');return toLocal(point);});
  if(coords.length&&Math.hypot(coords.at(-1)[0]-points[0][0],coords.at(-1)[1]-points[0][1])>.03)throw Error('Route geometry has a gap');
  coords.push(...(coords.length?points.slice(1):points));
  const z0=atlasNumber(a.elev_start),z1=atlasNumber(a.elev_end);
  if(z0!==null&&z1!==null){const start=z0+(z1-z0)*t0,end=z0+(z1-z0)*t1,dz=end-start;profile.push([length,start],[length+len,end]);ascent+=Math.max(0,dz);descent+=Math.max(0,-dz);const slope=dz/len*100;quality.slopeKnown+=len;quality.maxUphill=Math.max(quality.maxUphill??0,slope);quality.maxDownhill=Math.max(quality.maxDownhill??0,-slope);}else heightsComplete=false;
  if(['good','medium','poor'].includes(a.surface_class)){quality.surfaceKnown+=len;if(a.surface_class==='poor')quality.poorSurface+=len;}
  const width=atlasNumber(a.width);if(width!==null&&width>0){quality.widthKnown+=len;quality.minWidth=Math.min(quality.minWidth??Infinity,width);}
  if(['yes','designated','limited','no'].includes(a.wheelchair)){quality.wheelchairKnown+=len;if(['limited','no'].includes(a.wheelchair))quality.limitedWheelchair+=len;}
  const stairs=tags.highway==='steps'||a.fclass==='steps',escalator=tags.conveying&&tags.conveying!=='no';
  if(stairs&&previousStairs!==s.atlas_fid)steps++;previousStairs=stairs?s.atlas_fid:null;
  if(escalator&&previousEscalator!==s.atlas_fid)escalators++;previousEscalator=escalator?s.atlas_fid:null;
  if(shadeFractions){const f=shadeFractions[i];if(!Number.isFinite(f)||f<0||f>1)throw Error('Invalid route shade');shaded+=len*f;}
  length+=len;
 }
 if(Math.abs(length-p.distance_m)>.1)throw Error('Route length does not match its pieces');
 const line=data.features?.[0]?.geometry;if(line?.type!=='LineString'||line.coordinates.length<2)throw Error('Missing route line');
 const supplied=line.coordinates.map(toLocal);if(supplied.length!==coords.length||supplied.some((point,i)=>Math.hypot(point[0]-coords[i][0],point[1]-coords[i][1])>.03))throw Error('Route line does not match its pieces');
 for(const key of ['surfaceKnown','slopeKnown','widthKnown','wheelchairKnown','poorSurface','limitedWheelchair'])quality[key]/=length;
 return {source:'server',path:[],coords:supplied,profile:heightsComplete?profile:[],length:p.distance_m,shade:shadeFractions?shaded/length:null,ascent:heightsComplete?ascent:null,descent:heightsComplete?descent:null,steps,escalators,quality,criteria:{},minutes:heightsComplete?Math.ceil(length/75+ascent/10):null,timeModel:{speedMpm:75,ascentMinutesPer10m:1,estimated:true},snaps:[p.snapped_start,p.snapped_end].map(toLocal),snapDistances:[p.start_snap_distance_m,p.end_snap_distance_m],calculationMs:p.calculation_ms};
}

let serverRouteController=null,serverRoutingPending=false,serverRoutingReady=false,browserRoutingOnly=false;
let exploreMode=false,citySceneLayer=null,profileMarker=null,routeMeasureCache=null,previewFrame=0,previewState=null,previewPreparing=false,previewRequestId=0;
const cityFetchPending=new Map();
let displayManifest=null,displayManifestPending=null,displayStore=null,featurePopup=null,featureRequestId=0,poiImagesPending=null,cityScenePending=null;
let displayShadeFrame=null,displayShadeQueue=null,displayShadeEpoch=0,displayObstacleKey='',displayTerrain=null;
const shadowDisplayEnabled=true;
let shadeOverlay=false;
// The modelled shadow raster shows in 3D and, on request, in the flat 2D map.
function shadeOverlayActive(){return shadowDisplayEnabled&&(is3D||shadeOverlay);}
let displayShadeWorker=null,displayShadeId=0,displayShadeSignature='',weatherRefreshTimer=null,weatherLoadingPromise=null;
const displayBaseURL=new URL('./city/',location.href);
let viewTransitionId=0;
const $=id=>document.getElementById(id);
const strings={de:{pilot:'FUSSWEGE · PILOT MITTE',headline:'Dein Weg. Dein Wetter.',intro:'Entdecke den Weg mit mehr Schatten, mehr Sonne oder weniger Steigung.',from:'Start',to:'Ziel',pickHint:'Oder mit ⌖ einen Punkt auf der Karte wählen.',preference:'Wie möchtest du gehen?',balanced:'Direkt',shade:'Schatten',sun:'Sonne',gentle:'Weniger Steigung bevorzugen',steps:'Treppen vermeiden',calculate:'Route berechnen',loading:'Kartendaten werden geladen …',yourRoute:'Dein Weg',minutes:'Minuten¹',kilometres:'Kilometer',shadePart:'im Schatten',elevationProfile:'Höhenprofil',share:'Route als Link teilen ↗',note:'Schatten für den gewählten Zeitpunkt. Ein Modell, keine Messung vor Ort.',about:'Über Sonnenpfad',guide:'So funktioniert’s',prototype:'PROTOTYP 0.7',modelShade:'Modellierter Schatten',walkRoute:'Dein Weg',exploreTime:'SONNE & SCHATTEN ENTDECKEN',date:'Datum',now:'Jetzt',time:'Uhrzeit',summer:'Sommer',winter:'Winter',timezone:'Ortszeit Stuttgart',aboutTitle:'Über Sonnenpfad',understood:'Verstanden',ready:'Bereit. Wähle Start und Ziel.',computing:'Schatten werden berechnet …',routing:'Dein Weg wird berechnet …',done:'Route auf dem Fußwegenetz gefunden.',pickStart:'Klicke auf die Karte, um den Start zu setzen.',pickEnd:'Klicke auf die Karte, um das Ziel zu setzen.',point:'Kartenpunkt',outsidePilot:'Mindestens ein Punkt liegt außerhalb des gestrichelten Pilotgebiets Stuttgart-Mitte.',outside:'Innerhalb von 200 m wurde kein gemeinsam erreichbarer Fußweg gefunden. Bitte einen Punkt näher an eine graue Netzlinie setzen.',disconnected:'Für diese Richtung wurde keine begehbare Verbindung gefunden.',same:'Start und Ziel liegen praktisch am selben Ort. Bitte weiter auseinander wählen.',copied:'Link kopiert.',copyFail:'Link konnte nicht kopiert werden. Die Adresse im Browser enthält deine Route.',night:'Nacht · keine direkte Sonne',lowSun:'Sonne sehr tief · Modell pausiert',sunHeight:'Sonnenhöhe',baseFailed:'Hintergrundkarte nicht verfügbar. Die eigenen Atlasdaten bleiben nutzbar.',loadFail:'Daten konnten nicht geladen werden. Bitte die Seite neu laden.',locationFail:'Standort nicht verfügbar. Bitte einen Punkt auf der Karte wählen.',modelFailed:'Berechnung fehlgeschlagen. Bitte erneut versuchen.',flat:'zusätzlich',routeLabel:'Direkter Weg',noHeat:'Noch keine Live-Wetterdaten',swap:'Start und Ziel tauschen',pickOrigin:'Start auf Karte wählen',pickDestination:'Ziel auf Karte wählen',locate:'Mein Standort',fit:'Gesamte Route anzeigen',close:'Schließen'},en:{pilot:'WALKING · CITY CENTRE PILOT',headline:'Walk with the weather.',intro:'Find a walk with more shade, more sunshine or gentler slopes.',from:'From',to:'To',pickHint:'Or use ⌖ to choose a point on the map.',preference:'How would you like to walk?',balanced:'Direct',shade:'Shade',sun:'Sun',gentle:'Prefer gentler slopes',steps:'Avoid stairs',calculate:'Find my route',loading:'Loading map data …',yourRoute:'Your walk',minutes:'minutes¹',kilometres:'kilometres',shadePart:'in shade',elevationProfile:'Elevation profile',share:'Share route link ↗',note:'Shade at the selected time. A model, not an on-site measurement.',about:'About Sonnenpfad',guide:'How it works',prototype:'PROTOTYPE 0.7',modelShade:'Modelled shade',walkRoute:'Your walk',exploreTime:'EXPLORE SUN & SHADE',date:'Date',now:'Now',time:'Time',summer:'Summer',winter:'Winter',timezone:'Stuttgart local time',aboutTitle:'About Sonnenpfad',understood:'Got it',ready:'Ready. Choose your start and destination.',computing:'Calculating shade …',routing:'Finding your walk …',done:'Route found on the pedestrian network.',pickStart:'Click on the map to set your starting point.',pickEnd:'Click on the map to set your destination.',point:'Map point',outsidePilot:'At least one point is outside the dashed Stuttgart city-centre pilot area.',outside:'No mutually reachable walking line was found within 200 m. Place a point closer to a grey network line.',disconnected:'No walkable connection was found for this direction.',same:'The two points are effectively at the same place. Please move them further apart.',copied:'Link copied.',copyFail:'Could not copy the link. Your browser address contains the route.',night:'Night · no direct sun',lowSun:'Sun too low · model paused',sunHeight:'Solar elevation',baseFailed:'Basemap unavailable. The atlas layers still work.',loadFail:'Could not load the data. Please reload the page.',locationFail:'Location unavailable. Please choose a point on the map.',modelFailed:'Calculation failed. Please try again.',flat:'extra',routeLabel:'Direct route',noHeat:'Live weather not connected yet',swap:'Swap start and destination',pickOrigin:'Choose start on map',pickDestination:'Choose destination on map',locate:'My location',fit:'Show entire route',close:'Close'}};
strings.de.mapUnsupported='Die 2D-/3D-Karte kann auf diesem Gerät nicht gestartet werden (WebGL ist deaktiviert oder nicht verfügbar). Bitte Hardwarebeschleunigung aktivieren oder einen aktuellen Browser verwenden.';
strings.en.mapUnsupported='The 2D/3D map cannot start on this device (WebGL is disabled or unavailable). Enable hardware acceleration or use a current browser.';
Object.assign(strings.de,{slopeLabel:'Steigungen vermeiden',slopeNone:'Keine Steigungsvermeidung',slopeUp:'Bergauf vermeiden',slopeDown:'Bergab vermeiden',slopeBoth:'Bergauf und bergab vermeiden'});
Object.assign(strings.en,{slopeLabel:'Avoid slopes',slopeNone:'No slope avoidance',slopeUp:'Avoid uphill',slopeDown:'Avoid downhill',slopeBoth:'Avoid uphill and downhill'});
Object.assign(strings.de,{pilot:'FUSSWEGE · PILOT MITTE',prototype:'PROTOTYP 0.14',pickHint:'Start oder Ziel mit ⌖ wählen. Mobil: Karte ausrichten und mit ✓ bestätigen.',routeTools:'Start & Ziel',routeOptions:'Route & Mobilität',profileLabel:'Für wen planst du?',profileStandard:'Standard',profileWheelchair:'Rollstuhl',profilePower:'Elektrorollstuhl',profileWalkingAid:'Stock oder Rollator',profileVision:'Blind oder sehbehindert',profileStroller:'Kinderwagen',profileCustom:'Eigene Einstellungen',advanced:'Eigene Einstellungen',escalators:'Rolltreppen vermeiden',stepsShort:'Treppen',escalatorsShort:'Rolltreppen',poorSurfaceShort:'Schlechte Oberfläche',wheelchairNoShort:'Rollstuhl: nein',profileBlocked:'Keine Verbindung im Fußwegenetz gefunden.',outsidePilot:'Mindestens ein Punkt liegt außerhalb der verfügbaren Routingdaten.',searchNone:'Kein passender Ort gefunden.',searchFail:'Ortssuche momentan nicht erreichbar.',mapStartSet:'Start gesetzt.',mapStartSetTouch:'Start gesetzt. Wähle jetzt das Ziel.'});
Object.assign(strings.en,{pilot:'WALKING · CITY CENTRE PILOT',prototype:'PROTOTYPE 0.14',pickHint:'Choose start or destination with ⌖. Mobile: move the map and confirm with ✓.',routeTools:'Start & destination',routeOptions:'Route & mobility',profileLabel:'Who are you planning for?',profileStandard:'Standard',profileWheelchair:'Wheelchair',profilePower:'Power wheelchair',profileWalkingAid:'Cane or walker',profileVision:'Blind or low vision',profileStroller:'Pushchair',profileCustom:'Custom settings',advanced:'Custom settings',escalators:'Avoid escalators',stepsShort:'Stairs',escalatorsShort:'Escalators',poorSurfaceShort:'Poor surface',wheelchairNoShort:'Wheelchair: no',profileBlocked:'No connection was found in the walking network.',outsidePilot:'At least one point is outside the available routing data.',searchNone:'No matching place found.',searchFail:'Place search is temporarily unavailable.',mapStartSet:'Start set.',mapStartSetTouch:'Start set. Choose your destination.'});
Object.assign(strings.de,{prototype:'SCHRITT 5 · VORSCHAU',layersTitle:'Kartenebenen',themeLabel:'Linienthema',poiLabel:'Barrierefreiheit & Komfort',layersZoom:'Themen und POIs erscheinen ab Zoomstufe 14,5.',themeNone:'Kein Thema'});
Object.assign(strings.en,{prototype:'STEP 5 · PREVIEW',layersTitle:'Map layers',themeLabel:'Line theme',poiLabel:'Accessibility & comfort',layersZoom:'Themes and POIs appear from zoom level 14.5.',themeNone:'No theme'});
Object.assign(strings.de,{outsideLocation:'Dein Standort liegt außerhalb des Stadtgebiets Stuttgart.'});
Object.assign(strings.en,{outsideLocation:'Your location is outside the Stuttgart city limits.'});
Object.assign(strings.de,{prototype:'SCHRITT 6 · VORSCHAU',weatherRetry:'Wetter wird aktualisiert …',weatherLoading:'Wetter wird geladen …',weatherUnavailable:'Wetter momentan nicht erreichbar',weatherOutside:'Für diese Zeit liegt keine Vorhersage vor',weatherClear:'Klar',weatherPartlyCloudy:'Leicht bewölkt',weatherOvercast:'Bedeckt',weatherFog:'Nebel',weatherDrizzle:'Nieselregen',weatherRain:'Regen',weatherSnow:'Schnee',weatherThunderstorm:'Gewitter',weatherUnknown:'Unbekannte Wetterlage',weatherModel:'Modellvorhersage, keine Stationsmessung',weatherRetrieved:'Abruf',weatherValid:'Gültig',weatherStale:'Zwischengespeicherte Daten',weatherEffect:'Wetterwirkung auf Sonne/Schatten',weatherFallback:'Ohne passende Wetterdaten gilt das geometrische Klarhimmel-Modell.',weatherSource:'Quelle: Open-Meteo · CC BY 4.0'});
Object.assign(strings.en,{prototype:'STEP 6 · PREVIEW',weatherRetry:'Refreshing weather …',weatherLoading:'Loading weather …',weatherUnavailable:'Weather is temporarily unavailable',weatherOutside:'No forecast is available for this time',weatherClear:'Clear',weatherPartlyCloudy:'Partly cloudy',weatherOvercast:'Overcast',weatherFog:'Fog',weatherDrizzle:'Drizzle',weatherRain:'Rain',weatherSnow:'Snow',weatherThunderstorm:'Thunderstorm',weatherUnknown:'Unknown weather',weatherModel:'Model forecast, not a station measurement',weatherRetrieved:'Retrieved',weatherValid:'Valid',weatherStale:'Cached data',weatherEffect:'Weather influence on sun/shade',weatherFallback:'Without matching weather data, the geometric clear-sky model is used.',weatherSource:'Source: Open-Meteo · CC BY 4.0'});
Object.assign(strings.de,{weatherLive:'Wetter',weatherClearSky:'Modell',weatherToggleOn:'Live-Wetter · zum Sonnenmodell wechseln',weatherToggleOff:'Sonnenmodell · Live-Wetter einschalten',weatherManual:'Klarhimmel-Modell ist manuell aktiv; die Wetterwerte werden nur zur Information angezeigt.'});
Object.assign(strings.en,{weatherLive:'Weather',weatherClearSky:'Model',weatherToggleOn:'Live weather · switch to clear sky',weatherToggleOff:'Clear sky · enable live weather',weatherManual:'The clear-sky model is active manually; weather values are shown for information only.'});
Object.assign(strings.de,{prototype:'ENTWICKLUNGSVERSION'});
Object.assign(strings.en,{prototype:'DEVELOPMENT PREVIEW'});
Object.assign(strings.de,{outside:'Kein sicherer Zugang zum Fußwegenetz innerhalb von 30 m gefunden. Bitte Start oder Ziel näher an einen erfassten Weg setzen.'});
Object.assign(strings.en,{outside:'No safe connection to the walking network was found within 30 m. Move the start or destination closer to a mapped path.'});
Object.assign(strings.de,{serverOutside:'Innerhalb von 50 m wurde am Start oder Ziel kein begehbarer Weg gefunden.',serverUnavailable:'Die Routenberechnung auf dem Server ist derzeit nicht verfügbar. Bitte erneut versuchen.'});
Object.assign(strings.en,{serverOutside:'No walkable edge was found within 50 m of the start or destination.',serverUnavailable:'Server routing is currently unavailable. Please try again.'});
strings.de.minutes='Minuten · geschätzt';strings.en.minutes='minutes · estimated';
let lang=new URLSearchParams(location.search).get('lang')==='en'?'en':'de',meta,network,obstacles,map,worker,cityManifest=null,cityBoundary=null,poiIcons=BUNDLED_POI_ICONS,poiDetails={},slopeDirections=new Int8Array(),stepFlags=new Uint8Array(),structureFlags=new Uint8Array(),cityBaseURL=new URL('./city/',location.href),cityTileCache=new Map(),cityShadeTileCache=new Map(),activeCityEdgeIds=[],activeTileKeys='',activeCityViewSignature='',routeShadeSignature='',routePois=[],ready=false,shadeReady=true,preference='balanced',pick=null,shadeId=0,routeId=0,result=null,shortest=null,currentSun=null,shadowURL=null,shading=false,pendingShade=null,autoRoute=false,is3D=false,viewSwitching=false,tileLoadId=0,activeTheme='slope',toastTimer=null,shadeBusyInteractive=false,cityShadeTimer=null,weatherModel=null,weatherState='loading',weatherIsStale=false,liveWeatherEnabled=true,lastWeatherRenderKey='';
const shadeContexts=new Map();
// One zoom range for desktop and mobile: zoomed out, all of Baden-Württemberg fits on a phone.
const MAP_MIN_ZOOM=6,MAP_BOUNDS=[[6.6,47.0],[11.4,50.3]];
let stateBoundary=null;
const selectedPois=new Set();
const POI_DEFS=[
 {k:1,color:'#2E7D32',foreground:'#111',icon:'Signalized_Crossings.svg',de:'Ampelquerungen',en:'Signal crossings'},
 {k:2,color:'#1a9641',foreground:'#fff',icon:'Elevators.svg',de:'Aufzüge',en:'Elevators'},
 {k:3,color:'#1a9641',foreground:'#fff',icon:'Ramps.svg',de:'Rampen',en:'Ramps'},
 {k:4,color:'#1a9641',foreground:'#fff',icon:'Escalators.svg',de:'Rolltreppen',en:'Escalators'},
 {k:5,color:'#5f5f5f',foreground:'#fff',icon:'Stairs.svg',de:'Treppen',en:'Stairs'},
 {k:6,color:'#d7191c',foreground:'#111',icon:'Barriers_and_Gates.svg',de:'Barrieren & Tore',en:'Barriers & gates'},
 {k:7,color:'#1a9641',foreground:'#fff',icon:'Lowered_Curbs.svg',de:'Abgesenkte Bordsteine',en:'Lowered kerbs'},
 {k:8,color:'#c43c39',foreground:'#fff',icon:'Raised_Curbs.svg',de:'Erhöhte Bordsteine',en:'Raised kerbs'},
 {k:9,color:'#1a9641',foreground:'#111',icon:'Benches.svg',de:'Sitzbänke',en:'Benches'},
 {k:10,color:'#1a9641',foreground:'#111',icon:'Shelters.svg',de:'Unterstände',en:'Shelters'},
];
const CROSSING_CLASSES={
 3:{color:'#2E7D32',de:'Gute Unterstützung',en:'Good support',deRule:'Mindestens 2 von 3 Hilfen sind mit Ja dokumentiert.',enRule:'At least 2 of 3 aids are documented as yes.'},
 2:{color:'#F9A825',de:'Teilweise Unterstützung',en:'Partial support',deRule:'Genau 1 von 3 Hilfen ist mit Ja dokumentiert.',enRule:'Exactly 1 of 3 aids is documented as yes.'},
 1:{color:'#C62828',de:'Keine dokumentierte Unterstützung',en:'No documented support',deRule:'Ton, Vibration und taktiles Leitsystem sind jeweils Nein.',enRule:'Sound, vibration and tactile paving are all documented as no.'},
 0:{color:'#9E9E9E',de:'Unbekannt oder unvollständig',en:'Unknown or incomplete',deRule:'Die drei Atlasmerkmale reichen für keine andere Klasse aus.',enRule:'The three atlas attributes are insufficient for another class.'},
};
const THEME_DEFS={
 slope:{de:'Steigung',en:'Slope',deHelp:'Steigung in Prozent; graue Pfeile zeigen bergauf.',enHelp:'Gradient in percent; grey arrows point uphill.',key:'sl',expression:['case',['<',['get','sl'],0],'#9aa6ad',['step',['get','sl'],'#3f9b61',3,'#d7b83f',6,'#e98437',10,'#c74646']],legend:[['#3f9b61','0–3 %'],['#d7b83f','3–6 %'],['#e98437','6–10 %'],['#c74646','> 10 %']]},
 surface:{de:'Oberfläche',en:'Surface',deHelp:'Qualität der Gehoberfläche: gut, mittel, schlecht oder unbekannt.',enHelp:'Walking-surface quality: good, medium, poor or unknown.',key:'su',expression:['match',['get','su'],1,'#3f9b61',2,'#d7b83f',3,'#c74646','#9aa6ad'],legend:[['#3f9b61','Gut','Good'],['#d7b83f','Mittel','Medium'],['#c74646','Schlecht','Poor'],['#9aa6ad','Unbekannt','Unknown']]},
 shadeSummer:{de:'Schatten · Sommer',en:'Shade · summer',deHelp:'Modellierter Schattenanteil einer typischen Sommersituation.',enHelp:'Modelled shade share for a typical summer situation.',key:'ss',expression:['case',['<',['get','ss'],0],'#9aa6ad',['interpolate',['linear'],['get','ss'],0,'#f4d35e',25,'#9fc8c2',60,'#4c83a3',100,'#284b73']],legend:[['#f4d35e','0 %'],['#9fc8c2','25 %'],['#4c83a3','60 %'],['#284b73','100 %']]},
 shadeWinter:{de:'Schatten · Winter',en:'Shade · winter',deHelp:'Modellierter Schattenanteil einer typischen Wintersituation.',enHelp:'Modelled shade share for a typical winter situation.',key:'sw',expression:['case',['<',['get','sw'],0],'#9aa6ad',['interpolate',['linear'],['get','sw'],0,'#f4d35e',25,'#b7cbd0',60,'#6d8ca8',100,'#3a506b']],legend:[['#f4d35e','0 %'],['#b7cbd0','25 %'],['#6d8ca8','60 %'],['#3a506b','100 %']]},
 utciSummer:{de:'UTCI · Sommer',en:'UTCI · summer',deHelp:'Modellierte gefühlte Wärmebelastung im Sommer, keine Live-Messung.',enHelp:'Modelled summer heat stress, not a live measurement.',key:'us',expression:['case',['<',['get','us'],-100],'#9aa6ad',['interpolate',['linear'],['get','us'],32,'#f2c84b',36,'#ed8b3a',38,'#d84a38',40,'#8e2d3b']],legend:[['#f2c84b','32 °C'],['#ed8b3a','36 °C'],['#d84a38','38 °C'],['#8e2d3b','40 °C']]},
 utciWinter:{de:'UTCI · Winter',en:'UTCI · winter',deHelp:'Modellierte gefühlte Kältebelastung im Winter, keine Live-Messung.',enHelp:'Modelled winter cold stress, not a live measurement.',key:'uw',expression:['case',['<',['get','uw'],-100],'#9aa6ad',['interpolate',['linear'],['get','uw'],-15,'#315a9c',-10,'#5e91c6',-5,'#a8cbe0',0,'#d9e7e7']],legend:[['#315a9c','−15 °C'],['#5e91c6','−10 °C'],['#a8cbe0','−5 °C'],['#d9e7e7','0 °C']]},
 noise:{de:'Lärm',en:'Noise',deHelp:'Modellierter Lärmpegel entlang des Fußwegenetzes in dB.',enHelp:'Modelled noise level along the walking network in dB.',key:'n',expression:['case',['<',['get','n'],0],'#4f9c70',['interpolate',['linear'],['get','n'],55,'#7eb26d',60,'#d5c35b',65,'#e28b42',70,'#ce513f',78,'#7e2945']],legend:[['#4f9c70','Ruhig','Quiet'],['#d5c35b','60–65 dB'],['#e28b42','65–70 dB'],['#7e2945','> 70 dB']]},
 wind:{de:'Wind-Exposition',en:'Wind exposure',deHelp:'Relative Windexposition des Weges; keine aktuelle Windgeschwindigkeit.',enHelp:'Relative route exposure, not current wind speed.',key:'w',expression:['case',['<',['get','w'],0],'#9aa6ad',['interpolate',['linear'],['get','w'],0,'#4f8fbd',.33,'#7ab7aa',.66,'#e3ad4c',1,'#c85a42']],legend:[['#4f8fbd','Geschützt','Sheltered'],['#7ab7aa','Moderat','Moderate'],['#e3ad4c','Exponiert','Exposed'],['#c85a42','Stark','High']]},
};
const defaultPlaces=[{name:'Schlossplatz, Stuttgart',p:[9.17935,48.77845]},{name:'Feuersee, Stuttgart',p:[9.1661,48.7705]}];
let points=[null,null],markers=[],searchCache=new Map();
const profileDescriptions={"de":{"standard":"Für Fußwege ohne besondere Anforderungen.","wheelchair":"Meidet bekannte Treppen, Rolltreppen, ungeeignete Wege und Steigungen über 6 %. Abweichungen werden angezeigt.","powerWheelchair":"Wie Rollstuhl, mit einer Steigungsgrenze von 10 %. Abweichungen werden angezeigt.","walkingAid":"Meidet bekannte Treppen, Rolltreppen, schlechte Oberflächen und Steigungen über 10 %. Bevorzugt Wege nahe Sitzgelegenheiten.","vision":"Bevorzugt Ampelquerungen mit Hilfen sowie Treppen mit Handlauf und taktilen Hinweisen. Ampeln ohne Angaben werden nicht abgewertet.","stroller":"Meidet bekannte Treppen, Rolltreppen, schlechte Oberflächen und Steigungen über 12 %.","custom":"Wähle deine Anforderungen. Abweichungen werden im Ergebnis angezeigt."},"en":{"standard":"For walks without specific mobility requirements.","wheelchair":"Avoids known stairs, escalators, unsuitable paths and gradients above 6%. Any exceptions are shown.","powerWheelchair":"As wheelchair, with a 10% gradient limit. Any exceptions are shown.","walkingAid":"Avoids known stairs, escalators, poor surfaces and gradients above 10%. Favours paths near seating.","vision":"Favours crossings with accessibility aids and stairs with handrails and tactile guidance. Crossings without data are not penalised.","stroller":"Avoids known stairs, escalators, poor surfaces and gradients above 12%.","custom":"Choose your requirements. Any exceptions are shown with the result."}};
// One lookup for the interface: the legacy `strings` table first, then the central dictionary (i18n.mjs).
const t=k=>strings[lang][k]||UI_TEXT[lang==='en'?'en':'de'][k]||k;
const local=p=>[(p[0]-meta.origin[0])*meta.scale[0],(p[1]-meta.origin[1])*meta.scale[1]];
const ll=p=>[meta.origin[0]+p[0]/meta.scale[0],meta.origin[1]+p[1]/meta.scale[1]];
const fc=features=>({type:'FeatureCollection',features});
const feature=(type,coordinates,properties={})=>({type:'Feature',geometry:{type,coordinates},properties});
let statusKey='loading';
function status(k){statusKey=k;$('status').textContent=t(k);}
Object.assign(strings.de,{choosePoints:'Wähle zuerst Start und Ziel.',planRoute:'Route planen',closePanel:'Karte anzeigen'});
Object.assign(strings.en,{choosePoints:'Choose a start and destination first.',planRoute:'Plan a route',closePanel:'Show map'});
async function loadChunkedData(){
 const configResponse=await fetch('./city-config.json').catch(()=>null),config=configResponse?.ok?await configResponse.json().catch(()=>null):null;if(typeof config?.base==='string')cityBaseURL=new URL(config.base,location.href);browserRoutingOnly=config?.serverRouting===false;
 const cityResponse=await fetch(new URL('manifest.json',cityBaseURL)).catch(()=>null);
 const cityCandidate=cityResponse?.ok?parseCityManifest(await cityResponse.text().catch(()=>'')):null;
 if(cityCandidate){cityManifest=cityCandidate;cityManifest.edges=cityManifest.network.edgeCount;return [cityManifest,{nodes:[],edges:[]},{buildings:[],trees:[]}];}
 const response=await fetch('./data/manifest.json');if(!response.ok)throw Error('manifest');const manifest=await response.json();
 const load=async files=>(await Promise.all(files.map(async file=>{const r=await fetch('./data/'+file);if(!r.ok)throw Error(file);return r.json();}))).flat();
 const [metaResponse,nodes,edges,buildings,trees]=await Promise.all([fetch('./data/'+manifest.meta),load(manifest.nodes),load(manifest.edges),load(manifest.buildings),load(manifest.trees)]);
 if(!metaResponse.ok)throw Error(manifest.meta);return [await metaResponse.json(),{nodes,edges},{buildings,trees}];
}
function berlinParts(d){return Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Berlin',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(d).map(x=>[x.type,x.value]));}
function dateNow(){const p=berlinParts(new Date());return `${p.year}-${p.month}-${p.day}`;}
function selectedISO(){const day=$('date').value,mins=+$('time').value;let ms=Date.parse(day+'T00:00:00Z')+mins*60000;
 // Resolve a Berlin wall clock against the actual IANA DST offset.
 for(let i=0;i<3;i++){const p=berlinParts(new Date(ms)),asUTC=Date.parse(`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:00Z`),target=Date.parse(day+'T00:00:00Z')+mins*60000;const change=target-asUTC;ms+=change;if(!change)break;}return new Date(ms).toISOString();}
function selectedWeather(){return weatherAt(weatherModel,$('date').value,+$('time').value);}
function effectiveWeather(){return liveWeatherEnabled?selectedWeather():null;}
function localTimeLabel(value){if(!value)return '–';const [day,time]=value.split('T');return `${day.split('-').reverse().join('.')} · ${time||''}`;}
function weatherCondition(group){const key='weather'+group[0].toUpperCase()+group.slice(1),icons={clear:'☀',partlyCloudy:'🌤',overcast:'☁',fog:'≋',drizzle:'🌦',rain:'🌧',snow:'❄',thunderstorm:'⚡',unknown:'◌'};return {label:t(key),icon:icons[group]||icons.unknown};}
function updateWeatherOpacity(weather=effectiveWeather()){
 if(!map?.getLayer?.('shade-fill'))return;const weight=weather?.solarWeight;
 map.setPaintProperty('shade-fill','raster-opacity',displayShadowOpacity(weight,currentSun?.altitude));
}

function renderWeather(force=false){
 const strip=$('weather-strip');if(!strip)return;const key=`${lang}|${weatherState}|${weatherIsStale}|${weatherModel?.retrievedAt}|${liveWeatherEnabled}|${$('date').value}|${Math.round((+$('time').value||0)/60)}`;if(!force&&key===lastWeatherRenderKey)return;lastWeatherRenderKey=key;
 const weather=selectedWeather();strip.dataset.state=weather?'ready':weatherState;strip.dataset.mode=liveWeatherEnabled?'live':'model';const toggle=$('weather-toggle');
 if(toggle){toggle.textContent=t(liveWeatherEnabled?'weatherLive':'weatherClearSky');toggle.title=t(liveWeatherEnabled?'weatherToggleOn':'weatherToggleOff');toggle.setAttribute('aria-label',toggle.title);toggle.setAttribute('aria-pressed',String(liveWeatherEnabled));}
 if(!weather){$('weather-icon').textContent='◌';$('weather-temperature').textContent='–';$('weather-condition').textContent=t(weatherState==='loading'?'weatherLoading':weatherModel?'weatherOutside':'weatherRetry');for(const id of ['weather-cloud','weather-radiation','weather-wind'])$(id).textContent='–';$('weather-details').textContent=t('weatherFallback');updateWeatherOpacity(null);return;}
 const condition=weatherCondition(weatherCodeGroup(weather.weatherCode));$('weather-icon').textContent=condition.icon;$('weather-temperature').textContent=`${Math.round(weather.temperature)}°`;$('weather-condition').textContent=condition.label+(weatherIsStale?' · '+(tr('cached')):'');
 $('weather-cloud').textContent=Number.isFinite(weather.cloudCover)?`${Math.round(weather.cloudCover)} %`:'–';$('weather-radiation').textContent=Number.isFinite(weather.directRadiation)?`${Math.round(weather.directRadiation)} W/m²`:'–';$('weather-wind').textContent=Number.isFinite(weather.windSpeed)?`${Math.round(weather.windSpeed)} km/h`:'–';$('weather-wind-arrow').style.transform=`rotate(${(weather.windDirection||0)+180}deg)`;
 const retrieved=new Intl.DateTimeFormat(tr('locale'),{timeZone:'Europe/Berlin',day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}).format(new Date(weatherModel.retrievedAt)),valid=weather.time.slice(11,16),source=weatherModel.source||'Open-Meteo',detail=$('weather-details');
 detail.textContent=`${tr('forecast')} ${valid} · ${t('weatherRetrieved')} ${retrieved} · ${source}${weatherIsStale?' · '+t('weatherStale'):''}${weather.radiationEstimated?' · '+(tr('sunEffectEstimatedFromClouds')):''} · CC BY 4.0`;
 detail.title=t('weatherModel');updateWeatherOpacity(liveWeatherEnabled?weather:null);
}

async function loadWeather(){
 if(weatherLoadingPromise)return weatherLoadingPromise;
 const run=async()=>{let cached=null;try{cached=JSON.parse(localStorage.getItem(WEATHER_CACHE_KEY)||'null');if(!cached){const legacy=JSON.parse(localStorage.getItem('sonnenpfad.weather.stuttgart.v1')||'null');if(legacy?.payload)cached=normalizeWeather(legacy.payload,legacy.retrievedAt);}}catch{}
  if(usableWeatherCache(cached)){weatherModel=cached;weatherIsStale=Boolean(cached.stale)||Date.now()-cached.retrievedAt>=WEATHER_CACHE_MS;weatherState='ready';renderWeather(true);if(!weatherIsStale)return;}
  if(!weatherModel){weatherState='loading';renderWeather();}
  try{const model=await requestWeatherModel({baseURL:location.href});weatherModel=model;weatherIsStale=Boolean(model.stale)||Date.now()-model.retrievedAt>=WEATHER_CACHE_MS;weatherState='ready';try{localStorage.setItem(WEATHER_CACHE_KEY,JSON.stringify(model));}catch{}renderWeather(true);if(!exploreMode&&(result||serverRoutingPending)&&preference!=='balanced')calculate();}
  catch(error){weatherState=weatherModel?'ready':'retry';weatherIsStale=Boolean(weatherModel);renderWeather(true);console.warn('Weather refresh postponed:',error);}
 };
 weatherLoadingPromise=run().finally(()=>{weatherLoadingPromise=null;clearTimeout(weatherRefreshTimer);weatherRefreshTimer=setTimeout(()=>{if(!document.hidden)loadWeather();},weatherState==='retry'||weatherIsStale?60000:WEATHER_CACHE_MS);});return weatherLoadingPromise;
}

function clientSunPosition(date,lat=48.777,lon=9.18){const rad=Math.PI/180,jd=date.getTime()/86400000+2440587.5,n=jd-2451545,L=(280.46+.9856474*n)%360,g=(357.528+.9856003*n)*rad,lambda=(L+1.915*Math.sin(g)+.020*Math.sin(2*g))*rad,eps=(23.439-.0000004*n)*rad,ra=Math.atan2(Math.cos(eps)*Math.sin(lambda),Math.cos(lambda)),dec=Math.asin(Math.sin(eps)*Math.sin(lambda)),gmst=(280.46061837+360.98564736629*n)*rad,H=gmst+lon*rad-ra,phi=lat*rad,altitude=Math.asin(Math.sin(phi)*Math.sin(dec)+Math.cos(phi)*Math.cos(dec)*Math.cos(H)),azimuth=(Math.atan2(Math.sin(H),Math.cos(H)*Math.sin(phi)-Math.tan(dec)*Math.cos(phi))+Math.PI+2*Math.PI)%(2*Math.PI);return {altitude:altitude/rad,azimuth:azimuth/rad};}
function updateImmediateSun(){const center=map?.getCenter?.(),lon=center?.lng??9.18,lat=center?.lat??48.777;currentSun=clientSunPosition(new Date(selectedISO()),lat,lon);updateClock();}
function aboutContent(){
 const author='<strong>Mohammadreza Bakhshi</strong>',atlas=`<a href="https://github.com/Reza-Bakhshi7/fussgaengeratlas-stuttgart" target="_blank" rel="noreferrer">${tr('atlasName')}</a>`;
 const sources=(tr('data'))+'<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">© OpenStreetMap contributors</a> (<a href="https://opendatacommons.org/licenses/odbl/1-0/" target="_blank" rel="noreferrer">ODbL</a>), <a href="https://www.lgl-bw.de/" target="_blank" rel="noreferrer">LGL</a> DGM1/nDOM1 (<a href="https://www.govdata.de/dl-de/by-2-0" target="_blank" rel="noreferrer">dl-de/by-2-0</a>), <a href="https://opendata.stuttgart.de/de/dataset/laermkartierung" target="_blank" rel="noreferrer">Landeshauptstadt Stuttgart, Lärmkartierung</a> (<a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noreferrer">CC BY 4.0</a>), <a href="https://opendata.stuttgart.de/dataset/kleinraumige-gliederung" target="_blank" rel="noreferrer">Landeshauptstadt Stuttgart, Stadtmessungsamt, Kleinräumige Gliederung</a> (<a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noreferrer">CC BY 4.0</a>), <a href="https://www.klimaatlas-bw.de/" target="_blank" rel="noreferrer">Klimaatlas BW der LUBW</a>, 2026 (<a href="https://www.govdata.de/dl-de/by-2-0" target="_blank" rel="noreferrer">dl-de/by-2-0</a>), © <a href="https://www.bkg.bund.de/" target="_blank" rel="noreferrer">BKG</a> (2026) VG25 (<a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noreferrer">CC BY 4.0</a>, <a href="https://sgx.geodatenzentrum.de/web_public/gdz/datenquellen/datenquellen_vg25.pdf" target="_blank" rel="noreferrer">Datenquellen</a>), <a href="https://mobidata-bw.de/dataset/daten-barrierefreiheit" target="_blank" rel="noreferrer">MobiData BW / NVBW</a> (<a href="https://www.govdata.de/dl-de/by-2-0" target="_blank" rel="noreferrer">dl-de/by-2-0</a>)'+(tr('modified'))+(tr('map'))+'<a href="https://openfreemap.org/" target="_blank" rel="noreferrer">OpenFreeMap</a> / <a href="https://www.openmaptiles.org/" target="_blank" rel="noreferrer">OpenMapTiles</a> / <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">© OpenStreetMap contributors</a>. '+(tr('aerialImagery'))+'<a href="https://www.lgl-bw.de/" target="_blank" rel="noreferrer">LGL-BW (2026)</a> · dl-de/by-2-0. '+(tr('weather'))+'<a href="https://open-meteo.com/" target="_blank" rel="noreferrer">Open-Meteo</a> / <a href="https://www.met.no/" target="_blank" rel="noreferrer">MET Norway</a> · <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noreferrer">CC BY 4.0</a>. '+'<a href="https://github.com/Reza-Bakhshi7/sonnenpfad-stuttgart/blob/main/SOURCES_AND_LICENCES.md" target="_blank" rel="noreferrer">{all}</a>'.replace('{all}',tr('allSourcesAndLicences'))+'.';
 const privacy=routingServer()?(tr('everyRouteIsCalculatedOn')):isRoutingPreview(location.hostname)?(tr('inThisPreviewRoutesAre')):(tr('standardDirectRoutesSendStart'));
 const body=tr('aboutBody',{atlas,author,privacy});
 // The admin entry is only a link: /admin is protected by Cloudflare Access and checked again in the Worker.
 return body+'<p>'+tr('privacyUsage')+'</p><p class="micro">'+sources+'</p><p class="micro admin-entry"><a href="/admin/" rel="nofollow">'+tr('adminLink')+'</a></p>';
}
Object.assign(strings.de,{mobilityGroup:'Mobilitätsprofil',mapLabel:'Karte von Stuttgart',mapMode:'Kartenmodus'});Object.assign(strings.en,{mobilityGroup:'Mobility profile',mapLabel:'Map of Stuttgart',mapMode:'Map mode'});
function language(){featureRequestId++;featurePopup?.remove();featurePopup=null;clearFeatureSelection();updateExperienceLanguage();document.documentElement.lang=lang;document.querySelectorAll('[data-i-aria]').forEach(el=>el.setAttribute('aria-label',t(el.dataset.iAria)));document.querySelectorAll('[data-i]').forEach(el=>el.textContent=t(el.dataset.i));document.querySelectorAll('[data-i-title]').forEach(el=>el.title=t(el.dataset.iTitle));document.querySelectorAll('[data-i-placeholder]').forEach(el=>el.placeholder=t(el.dataset.iPlaceholder));$('language').textContent=tr('de');$('language').setAttribute('aria-label',tr('aufDeutschWechseln'));$('about-content').innerHTML=aboutContent();status(statusKey);for(const [id,k]of [['swap','swap'],['pick-origin','pickOrigin'],['pick-destination','pickDestination'],['locate','locate'],['fit','fit'],['close-about','close']]){const element=$(id);if(element){element.setAttribute('aria-label',t(k));element.title=t(k);}}document.querySelectorAll('[data-profile],[data-slope]').forEach(button=>button.title=button.querySelector('[data-i]').textContent);$('origin').setAttribute('aria-label',t('from'));$('destination').setAttribute('aria-label',t('to'));if($('mobility-profile'))$('profile-description').textContent=profileDescriptions[lang][$('mobility-profile').value]||'';updateStep4Language();if(map){const locale=mapLibreLocale(lang);if(map._locale)Object.assign(map._locale,locale);map.getCanvas()?.setAttribute('aria-label',locale['Map.Title']);for(const [selector,key] of [['.maplibregl-ctrl-zoom-in','NavigationControl.ZoomIn'],['.maplibregl-ctrl-zoom-out','NavigationControl.ZoomOut'],['.maplibregl-ctrl-compass','NavigationControl.ResetBearing']]){const button=map.getContainer().querySelector(selector);if(button){button.title=locale[key];button.setAttribute('aria-label',locale[key]);}}}if(result)showResult();updateClock();renderWeather(true);if(typeof applyPlanner==='function')applyPlanner().catch(console.warn);}
function themeProperties(values=[],structure=0,edgeId=-1){return {sl:values[0]??-1,su:values[1]??0,ss:values[2]??-1,sw:values[3]??-1,us:values[4]??-999,uw:values[5]??-999,n:values[6]??-1,w:values[7]??-1,st:structure,e:edgeId,steps:edgeId>=0&&stepFlags[edgeId]?1:0};}
function renderThemeLegend(){const box=$('theme-legend'),definition=THEME_DEFS[activeTheme];if(!box||!definition||!exploreMode){if(box)box.hidden=true;return;}box.hidden=false;box.innerHTML=`<strong></strong><div class="legend-items"></div><div class="legend-zoom" hidden></div>`;box.querySelector('strong').textContent=definition[lang];const items=box.querySelector('.legend-items');for(const [color,deLabel,enLabel=deLabel] of definition.legend){const item=document.createElement('span');item.className='legend-item';item.innerHTML='<i class="legend-line"></i><span></span>';item.querySelector('i').style.background=color;item.querySelector('span').textContent=lang==='en'?enLabel:deLabel;items.append(item);}const note=box.querySelector('.legend-zoom');note.textContent=t('layersZoom');note.hidden=true;}
function applyTheme({reload=true}={}){
 if(map?.getLayer('network-line')){const definition=THEME_DEFS[activeTheme]||THEME_DEFS.slope;map.setPaintProperty('network-line','line-color',['case',['>', ['get','st'],0],'#aeb8bd',definition.expression]);map.setPaintProperty('network-line','line-width',['interpolate',['linear'],['zoom'],10,.7,12.5,1.2,14.5,2,17,3.2,19,4.5]);map.setPaintProperty('network-line','line-opacity',.92);map.setLayoutProperty('network-line','visibility',exploreMode?'visible':'none');for(const id of ['stairs-halo','stairs-treads','slope-arrows'])if(map.getLayer(id))map.setLayoutProperty(id,'visibility',exploreMode&&activeTheme==='slope'?'visible':'none');}
 renderThemeLegend();if(reload&&exploreMode&&ready)loadVisibleCityTiles().catch(console.warn);
}

function updateCrossingLegend(){const box=$('crossing-legend');if(!box)return;box.hidden=!exploreMode||!selectedPois.has(1);if(box.hidden)return;box.replaceChildren();const heading=document.createElement('strong');heading.textContent=tr('signalCrossingQualityInThe');box.append(heading);for(const quality of [3,2,1,0]){const definition=CROSSING_CLASSES[quality],item=document.createElement('div'),dot=document.createElement('i'),text=document.createElement('span');item.className='crossing-legend-item';dot.style.background=definition.color;text.textContent=`${definition[lang]} · ${definition[lang+'Rule']}`;item.append(dot,text);box.append(item);}const note=document.createElement('small');note.textContent=tr('colourSoundVibrationAndTactile');box.append(note);}
function applyPoiFilter({reload=true}={}){for(const id of ['poi-points','poi-overview'])if(map?.getLayer(id)){map.setFilter(id,['in',['get','k'],['literal',[...selectedPois]]]);map.setLayoutProperty(id,'visibility',exploreMode?'visible':'none');}updateCrossingLegend();if(reload&&exploreMode&&ready)loadVisibleCityTiles().catch(console.warn);}

function updateStep4Language(){if(!$('theme'))return;for(const option of $('theme').options)option.textContent=THEME_DEFS[option.value]?.[lang]||option.textContent;for(const label of document.querySelectorAll('.theme-option')){const definition=THEME_DEFS[label.dataset.theme];if(!definition)continue;label.querySelector('.theme-name').textContent=definition[lang];label.title=definition[lang]+': '+definition[lang+'Help'];label.dataset.tooltip=label.title;label.querySelector('input').setAttribute('aria-label',`${definition[lang]}. ${definition[lang+'Help']}`);}for(const label of document.querySelectorAll('.poi-toggle')){const definition=POI_DEFS.find(item=>item.k===+label.dataset.kind);if(definition){label.querySelector('.poi-name').textContent=definition[lang];label.title=definition[lang];label.dataset.tooltip=definition[lang];label.querySelector('input').setAttribute('aria-label',definition[lang]);}}const layersToggle=$('layers-toggle'),layersTitle=t('layersTitle');layersToggle.title=layersTitle;layersToggle.setAttribute('aria-label',layersTitle);$('theme-description').textContent=THEME_DEFS[activeTheme][lang+'Help'];renderThemeLegend();updateCrossingLegend();}
function refreshPoiControlIcons(){for(const label of document.querySelectorAll('.poi-toggle')){const definition=POI_DEFS.find(item=>item.k===+label.dataset.kind);if(definition&&poiIcons[definition.icon])label.style.setProperty('--poi-icon',`url("${poiIcons[definition.icon]}")`);}}
function setupStep4Controls(){const themes=$('theme-options');for(const [key,definition] of Object.entries(THEME_DEFS)){const label=document.createElement('label');label.className='theme-option';label.dataset.theme=key;label.style.setProperty('--theme-color',definition.legend[0][0]);label.innerHTML=`<input type="radio" name="line-theme" value="${key}"><i></i><span class="theme-name"></span>`;const input=label.querySelector('input');input.checked=key===activeTheme;input.onchange=()=>{if(!input.checked)return;activeTheme=key;$('theme').value=key;document.querySelectorAll('.theme-option').forEach(item=>item.classList.toggle('selected',item.dataset.theme===key));applyTheme();updateStep4Language();};label.onmouseenter=()=>{$('theme-description').textContent=definition[lang+'Help'];};label.onmouseleave=()=>{$('theme-description').textContent=THEME_DEFS[activeTheme][lang+'Help'];};label.classList.toggle('selected',input.checked);themes.append(label);}const holder=$('poi-options');for(const definition of POI_DEFS){const label=document.createElement('label');label.className='poi-toggle';label.dataset.kind=definition.k;label.style.setProperty('--poi-color',definition.color);label.style.setProperty('--poi-foreground',definition.foreground);label.innerHTML=`<input type="checkbox" value="${definition.k}"><span class="poi-symbol"></span><span class="poi-name"></span>`;const input=label.querySelector('input');input.checked=selectedPois.has(definition.k);input.onchange=event=>{event.target.checked?selectedPois.add(definition.k):selectedPois.delete(definition.k);applyPoiFilter();};holder.append(label);}$('theme').value=activeTheme;const close=()=>{$('layers-panel').hidden=true;$('layers-toggle').setAttribute('aria-expanded','false');};$('layers-toggle').onclick=()=>{const opening=$('layers-panel').hidden;$('layers-panel').hidden=!opening;$('layers-toggle').setAttribute('aria-expanded',String(opening));};$('layers-close').onclick=close;refreshPoiControlIcons();updateStep4Language();}
function updateSunDirection(){citySceneLayer?.setSun(currentSun);const el=$('sun-direction');if(!el||!currentSun)return;const angle=currentSun.azimuth-(map?.getBearing()||0);el.style.setProperty('--sun-angle',`${angle}deg`);el.style.setProperty('--ray-angle',`${angle+180}deg`);el.classList.toggle('is-night',currentSun.altitude<=0);el.setAttribute('aria-label',tr('sunDirectionLabel',{altitude:Math.round(currentSun.altitude),azimuth:Math.round(currentSun.azimuth)}));}
function updateClock(){const v=Math.round(+$('time').value),hours=Math.floor(v/60)%24,minutes=v%60;$('clock').textContent=String(hours).padStart(2,'0')+':'+String(minutes).padStart(2,'0');if(currentSun)$('sun-elevation').textContent=currentSun.altitude<=0?t('night'):currentSun.altitude<=2?t('lowSun'):`☀ ${Math.round(currentSun.altitude)}° · ${t('sunHeight')}`;updateSunDirection();renderWeather();}
function placeLabel(feature){const p=feature.properties||{},name=p.name||p.street||p.city||t('point'),context=[p.street&&p.street!==name?p.street:null,p.housenumber,p.postcode,p.city].filter(Boolean).join(' ');return {name,context};}
function showSearchResults(i,features,message=''){const box=$(i?'destination-results':'origin-results');box.replaceChildren();if(message){const item=document.createElement('div');item.className='search-empty';item.textContent=message;box.append(item);}for(const featureItem of features){const coordinates=featureItem.geometry?.coordinates;if(!Array.isArray(coordinates)||coordinates.length<2)continue;const label=placeLabel(featureItem),button=document.createElement('button');button.type='button';button.className='search-result';button.setAttribute('role','option');button.innerHTML=`<strong></strong><span></span>`;button.querySelector('strong').textContent=label.name;button.querySelector('span').textContent=label.context;button.onclick=()=>{setCustom(i,[coordinates[0],coordinates[1]],[label.name,label.context].filter(Boolean).join(', '));box.hidden=true;if(points.every(Boolean)&&ready&&!exploreMode)calculate();else map?.flyTo({center:coordinates,zoom:15});};box.append(button);}box.hidden=!box.childElementCount;}
async function searchPlaces(i,query){const normalized=query.trim();if(normalized.length>200)return;if(normalized.length<3){showSearchResults(i,[]);return;}const key=`${lang}:${normalized.toLowerCase()}`;if(searchCache.has(key)){showSearchResults(i,searchCache.get(key));return;}try{const url=new URL('https://photon.komoot.io/api/');url.search=new URLSearchParams({q:normalized,limit:'6',lang,bbox:'9.03,48.69,9.32,48.87',lon:String(map?.getCenter().lng||9.18),lat:String(map?.getCenter().lat||48.777)});const response=await fetch(url,{headers:{Accept:'application/json'}});if(!response.ok)throw Error('search');const data=await response.json(),features=(data.features||[]).filter(item=>item.geometry?.type==='Point');searchCache.set(key,features);if(searchCache.size>100)searchCache.delete(searchCache.keys().next().value);if($(i?'destination':'origin').value.trim()===normalized)showSearchResults(i,features,features.length?'':t('searchNone'));}catch{if($(i?'destination':'origin').value.trim()===normalized)showSearchResults(i,[],t('searchFail'));}}
function populate(){for(const [i,id]of ['origin','destination'].entries()){const input=$(id);input.value='';let timer;input.oninput=()=>{clearTimeout(timer);points[i]=null;markers[i]?.remove();markers[i]=null;invalidateRoute();if(input.value.trim().length>=3)timer=setTimeout(()=>searchPlaces(i,input.value),350);else showSearchResults(i,[]);};input.onfocus=()=>{if(input.value.trim().length>=3)searchPlaces(i,input.value);};input.onkeydown=e=>{if(e.key==='Escape')$(i?'destination-results':'origin-results').hidden=true;};}}
function setCustom(i,p,label){stopRoutePreview(false);points[i]=p;const input=$(i?'destination':'origin');input.value=label||`${t('point')} · ${p[1].toFixed(4)}, ${p[0].toFixed(4)}`;updateMarkers();invalidateRoute();if(innerWidth<=800){$('sidebar-body').classList.remove('expanded');$('panel-toggle').setAttribute('aria-expanded','false');}}
function finishPickMode(next=null){pick=next;document.querySelectorAll('.pick').forEach((button,index)=>button.classList.toggle('active',index===pick));if(map)map.getCanvas().style.cursor=pick===null?'':'crosshair';$('pick-hint').textContent=pick===0?t('pickStart'):pick===1?t('pickEnd'):t('pickHint');if(typeof syncMapInteraction==='function')syncMapInteraction();}
function chooseMapPoint(p,{forcedIndex=null}={}){
 if(forcedIndex!==0&&forcedIndex!==1)return;
 stopRoutePreview(false);if(!inPilot(p)){showToast('outsideLocation');return;}
 // Consume the pick transaction BEFORE setCustom/calculate can trigger events.
 finishPickMode(null);hideToast();setCustom(forcedIndex,p);
 if(points.every(Boolean)&&ready)calculate();
}
function installDirectMapPicking(){
 map.doubleClickZoom.enable();
 // No implicit double-click or long-press endpoint edits on any device.
 map.getCanvas().addEventListener('contextmenu',event=>event.preventDefault());
}

function updateMarkers(){if(!map)return;points.forEach((p,i)=>{if(!p)return;if(markers[i])markers[i].setLngLat(p);else{const el=document.createElement('div');el.className='point pin '+(i?'end':'start');el.textContent=i?'B':'A';markers[i]=new maplibregl.Marker({element:el,draggable:false}).setLngLat(p).addTo(map);markers[i].on('dragend',()=>{const c=markers[i].getLngLat();setCustom(i,[c.lng,c.lat]);});}});}
function invalidateRoute(){stopRoutePreview(false);hideRoutePosition();routeMeasureCache=null;document.body.classList.remove('has-route');$('route-preview').disabled=true;serverRoutingPending=false;serverRouteController?.abort();result=null;shortest=null;autoRoute=false;routeId++;$('result').hidden=true;$('panel-toggle').lastElementChild.textContent=t('planRoute');if(map?.getSource('route'))map.getSource('route').setData(fc([]));if(ready)status('ready');}
function setPreference(p){preference=p;document.querySelectorAll('[data-pref]').forEach(b=>{b.classList.toggle('selected',b.dataset.pref===p);b.setAttribute('aria-pressed',String(b.dataset.pref===p));});if(result||serverRoutingPending)calculate();}
function stopDisplayShadows(){displayShadeEpoch++;displayShadeWorker?.terminate();displayShadeWorker=null;displayShadeQueue=null;displayObstacleKey='';displayShadeSignature='';displayShadeFrame=null;}
function ensureDisplayShadeWorker(){
 if(displayShadeWorker)return;
 const url=URL.createObjectURL(new Blob([BUNDLED_DISPLAY_WORKER],{type:'text/javascript'}));displayShadeWorker=new Worker(url);URL.revokeObjectURL(url);
 displayShadeQueue=createLatestFrameQueue(frame=>displayShadeWorker.postMessage(frame));
 displayShadeWorker.onmessage=({data:d})=>{
  if(d.type==='error'){stopDisplayShadows();map?.setLayoutProperty('shade-fill','visibility','none');return;}
  if(d.type!=='frame')return;
  if(d.epoch===displayShadeEpoch&&shadeOverlayActive()){
   const canvas=$('shadow-canvas');canvas.width=d.bitmap.width;canvas.height=d.bitmap.height;canvas.getContext('2d').drawImage(d.bitmap,0,0);
   map.getSource('shade').setCoordinates([[d.bounds[0],d.bounds[3]],[d.bounds[2],d.bounds[3]],[d.bounds[2],d.bounds[1]],[d.bounds[0],d.bounds[1]]]);
   if(d.iso===selectedISO()){currentSun=d.sun;updateClock();}displayShadeFrame={iso:d.iso,renderMs:d.renderMs};map.setLayoutProperty('shade-fill','visibility','visible');updateWeatherOpacity();const source=map.getSource('shade');source.play();map.once('render',()=>source.pause());map.triggerRepaint();
  }
  d.bitmap.close();displayShadeQueue?.complete();
 };
 displayShadeWorker.onerror=()=>{stopDisplayShadows();map?.setLayoutProperty('shade-fill','visibility','none');};
}
async function requestShade(recalculateRoute=false,{silent=false}={}){
 if(!ready||!shadeOverlayActive()||previewState||viewSwitching)return;if(map.getZoom()<14){map.setLayoutProperty('shade-fill','visibility','none');return;}
 const epoch=displayShadeEpoch,id=++displayShadeId;
 try{
  const visual=await ensureDisplayManifest(),b=map.getBounds(),c=map.getCenter(),bounds=[b.getWest(),b.getSouth(),b.getEast(),b.getNorth()],keys=selectDisplayTiles(visual,meta,bounds,[c.lng,c.lat],{limit:16,bearing:map.getBearing()}),key=keys.slice().sort().join(',');
  if(!keys.length)return;
  const selected=key===displayObstacleKey?null:await fetchObstacleTiles(keys);
  if(epoch!==displayShadeEpoch||id!==displayShadeId||!shadeOverlayActive())return;
  ensureDisplayShadeWorker();
  if(selected){displayShadeWorker.postMessage({type:'obstacles',obstacles:{buildings:selected.flatMap(tile=>tile.buildings),trees:selected.flatMap(tile=>tile.trees)}});displayObstacleKey=key;}
  const canvas=map.getCanvas(),ratio=Math.min(2,globalThis.devicePixelRatio||1),scale=Math.min(1,2048/(Math.max(canvas.clientWidth,canvas.clientHeight)*ratio)),width=Math.max(1,Math.round(canvas.clientWidth*ratio*scale)),height=Math.max(1,Math.round(canvas.clientHeight*ratio*scale));
  displayShadeQueue.push({type:'frame',id,epoch,iso:selectedISO(),leafOn:+$('date').value.slice(5,7)>=4&&+$('date').value.slice(5,7)<=10,bounds,center:[c.lng,c.lat],meta:{origin:meta.origin,scale:meta.scale},width,height});
 }catch(error){displayShadeSignature='';console.warn('Optional shadow view postponed:',error);}
}
function ensureDisplayTerrain(){
 if(!displayTerrain)displayTerrain=createTerrainHeightfield({baseURL:new URL('./dem/',location.href),zoom:14,exaggeration:1,maxTiles:96,concurrency:4});
 if(!map.getSource('display-terrain'))map.addSource('display-terrain',{type:'raster-dem',tiles:[new URL('./dem/{z}/{x}/{y}.png?v=relief14',location.href).href.replaceAll('%7B','{').replaceAll('%7D','}')],tileSize:256,minzoom:12,maxzoom:14,encoding:'mapbox',bounds:meta.bounds});
 map.setTerrain(is3D?{source:'display-terrain',exaggeration:1}:null);
 if(!map.getSource('display-relief')){const src=map.getStyle().sources['display-terrain'];map.addSource('display-relief',{...src});map.addLayer({id:'terrain-relief',type:'hillshade',source:'display-relief',layout:{visibility:'none'},paint:{'hillshade-exaggeration':.25,'hillshade-shadow-color':'#425046','hillshade-highlight-color':'#ffffff','hillshade-accent-color':'#647368'}},'network-line');}
 map.setLayoutProperty('terrain-relief','visibility',is3D?'visible':'none');
}
async function placeDisplayTrees(trees){
 if(!displayTerrain)return trees;
 const heights=await displayTerrain.sampleMany(trees.map(tree=>ll(tree.p)));
 return trees.map((tree,i)=>({...tree,ground:heights[i]}));
}

function invalidateShownRoute(){serverRouteController?.abort();if(result){autoRoute=true;$('result').hidden=true;if(map?.getSource('route'))map.getSource('route').setData(fc([]));}routeId++;}
function sendShade(){if(!pendingShade)return;shading=true;worker.postMessage(pendingShade);pendingShade=null;}
function pointInRing(point,ring){let inside=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){const a=ring[i],b=ring[j];if((a[1]>point[1])!==(b[1]>point[1])&&point[0]<(b[0]-a[0])*(point[1]-a[1])/(b[1]-a[1])+a[0])inside=!inside;}return inside;}
function inPilot(p){if(!meta||p[0]<meta.bounds[0]||p[0]>meta.bounds[2]||p[1]<meta.bounds[1]||p[1]>meta.bounds[3])return false;if(!cityBoundary)return true;return cityBoundary.geometry.coordinates.some(polygon=>pointInRing(p,polygon[0])&&!polygon.slice(1).some(ring=>pointInRing(p,ring)));}
function showToast(key){const box=$('map-toast');if(!box)return;clearTimeout(toastTimer);$('map-toast-text').textContent=t(key);box.hidden=false;toastTimer=setTimeout(()=>box.hidden=true,5500);}
function hideToast(){clearTimeout(toastTimer);if($('map-toast'))$('map-toast').hidden=true;}
async function fetchCityTiles(keys,{includeShade=false}={}){
 const available=cityManifest.obstacles.tiles;
 const load=async(key,shade)=>{const cache=shade?cityShadeTileCache:cityTileCache;if(cache.has(key))return cache.get(key);const id=(shade?'s:':'d:')+key;if(cityFetchPending.has(id))return cityFetchPending.get(id);const definition=available[key],file=shade?definition.shadeFile:(definition.displayFile||definition.file);const pending=(async()=>{if(!file){const display=await load(key,false);return {buildings:display.buildings||[],trees:display.trees||[]};}const response=await fetch(new URL(file,cityBaseURL));if(!response.ok)throw Error(file);return response.json();})().then(value=>{cache.set(key,value);return value;}).finally(()=>cityFetchPending.delete(id));cityFetchPending.set(id,pending);return pending;};
 let cursor=0;const selected=new Array(keys.length);
 await Promise.all(Array.from({length:Math.min(6,keys.length)},async()=>{while(cursor<keys.length){const index=cursor++,key=keys[index];if(!available[key])continue;const [display,shade]=await Promise.all([load(key,false),includeShade?load(key,true):null]);selected[index]={...display,buildings:shade?.buildings||[],trees:shade?.trees||[]};}}));return selected.filter(Boolean);
}
async function fetchObstacleTiles(keys){
 return Promise.all(keys.map(async key=>{const definition=cityManifest.obstacles.tiles[key];if(!definition)return {buildings:[],trees:[]};if(cityShadeTileCache.has(key))return cityShadeTileCache.get(key);const id='s:'+key;if(cityFetchPending.has(id))return cityFetchPending.get(id);const file=definition.shadeFile||definition.file,job=fetch(new URL(file,cityBaseURL),{signal:AbortSignal.timeout(9000)}).then(response=>{if(!response.ok)throw Error(file);return response.json();}).then(value=>{cityShadeTileCache.set(key,value);while(cityShadeTileCache.size>48)cityShadeTileCache.delete(cityShadeTileCache.keys().next().value);return value;}).finally(()=>cityFetchPending.delete(id));cityFetchPending.set(id,job);return job;}));
}

function routeTileKeys(){const grid=cityManifest.obstacles.grid,available=cityManifest.obstacles.tiles,[a,b]=points.map(local),distance=Math.hypot(b[0]-a[0],b[1]-a[1]),steps=Math.max(1,Math.ceil(distance/(grid*.65))),padding=2,keys=new Set();for(let i=0;i<=steps;i++){const f=i/steps,x=Math.floor((a[0]+(b[0]-a[0])*f)/grid),y=Math.floor((a[1]+(b[1]-a[1])*f)/grid);for(let dx=-padding;dx<=padding;dx++)for(let dy=-padding;dy<=padding;dy++){const key=`${x+dx}_${y+dy}`;if(available[key])keys.add(key);}}return [...keys];}
async function prepareRouteShade(){const keys=routeTileKeys(),signature=keys.join(',')+'|'+selectedISO();if(routeShadeSignature===signature&&shadeReady)return true;status('computing');$('calculate').disabled=true;shadeBusyInteractive=true;const selected=await fetchCityTiles(keys,{includeShade:true}),routeObstacles={buildings:selected.flatMap(tile=>tile.buildings),trees:selected.flatMap(tile=>tile.trees)},edgeIds=selected.flatMap(tile=>tile.edgeIds||[]),xs=points.map(p=>p[0]),ys=points.map(p=>p[1]),pad=.018;routePois=selected.flatMap(tile=>tile.pois||[]);worker.postMessage({type:'obstacles',obstacles:routeObstacles,edgeIds,tiles:keys});routeShadeSignature=signature;shadeReady=false;autoRoute=true;if(pendingShade)shadeContexts.delete(pendingShade.id);shadeId++;shadeContexts.set(shadeId,{silent:false,routeOnly:true});pendingShade={type:'shade',id:shadeId,iso:selectedISO(),leafOn:(+$('date').value.slice(5,7))>=4&&(+$('date').value.slice(5,7))<=10,bounds:[Math.min(...xs)-pad,Math.min(...ys)-pad,Math.max(...xs)+pad,Math.max(...ys)+pad],center:[(xs[0]+xs[1])/2,(ys[0]+ys[1])/2],preview:false,routeAware:true};if(!shading)sendShade();return false;}
function routeOptions(){const selectedProfile=$('mobility-profile').value,mobilityProfile=selectedProfile==='none'?'standard':selectedProfile,weather=effectiveWeather(),options={preference:currentSun?.altitude<=2?'balanced':preference,mobilityProfile,solarWeight:weather?.solarWeight??1};if(mobilityProfile==='custom')Object.assign(options,{avoidSteps:$('steps').checked,avoidEscalators:$('escalators').checked,avoidPoorSurface:$('poor-surface').checked,avoidWheelchairNo:$('wheelchair-no').checked,slopeMode:$('slope-mode').value,unknownFactor:.45,speedMpm:75,ascentMinutesPer10m:1});return options;}
function updateProfile(){const profile=$('mobility-profile').value,custom=profile==='custom';$('profile-description').textContent=profileDescriptions[lang][profile]||'';$('advanced-routing').hidden=!custom;$('advanced-routing').open=custom;document.querySelectorAll('[data-profile]').forEach(button=>{const selected=button.dataset.profile===profile;button.classList.toggle('selected',selected);button.setAttribute('aria-pressed',String(selected));});if(result||serverRoutingPending)calculate();}
function updateSlopeChoice(){document.querySelectorAll('[data-slope]').forEach(button=>{const selected=button.dataset.slope===$('slope-mode').value;button.classList.toggle('selected',selected);button.setAttribute('aria-pressed',String(selected));});if(result||serverRoutingPending)calculate();}
// Preview hosts always route on the Stage-2 server; production hosts only once it declares production readiness.
// Emergency switch: "serverRouting": false in city-config.json routes every request in the browser.
function routingServer(){return !browserRoutingOnly&&(isRoutingPreview(location.hostname)||serverRoutingReady)?PROFILE_V2_API:null;}

async function calculate(){finishPickMode(null);stopRoutePreview(false);hideRoutePosition();if(points.some(p=>!p)){status('choosePoints');return;}if(points.some(p=>!inPilot(p))){$('result').hidden=true;if(map?.getSource('route'))map.getSource('route').setData(fc([]));status('outsidePilot');return;}routeId++;serverRouteController?.abort();const server=routingServer();if(server){serverRoutingPending=false;status('routing');$('calculate').disabled=true;worker.postMessage({type:'route',id:++routeId,start:local(points[0]),end:local(points[1]),lonlat:[points[0].slice(),points[1].slice()],profileApi:server,serverPreview:isRoutingPreview(location.hostname),iso:selectedISO(),options:routeOptions()});return;}if(!isRoutingPreview(location.hostname)&&!browserRoutingOnly)checkServerReadiness();serverRoutingPending=false;if(cityManifest&&preference!=='balanced'){try{if(!await prepareRouteShade())return;}catch(error){console.error(error);status('modelFailed');$('calculate').disabled=false;return;}}else if(!shadeReady&&map?.getZoom()>=14.5){autoRoute=true;return;}status('routing');$('calculate').disabled=true;worker.postMessage({type:'route',id:++routeId,start:local(points[0]),end:local(points[1]),lonlat:[points[0].slice(),points[1].slice()],profileApi:null,iso:selectedISO(),options:routeOptions()});}
function routePoiCounts(maxDistance=12){const counts={};if(!result?.coords?.length||!routePois.length)return counts;const segmentDistance=(p,a,b)=>{const dx=b[0]-a[0],dy=b[1]-a[1],den=dx*dx+dy*dy,t=den?Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dy)/den)):0;return Math.hypot(p[0]-(a[0]+t*dx),p[1]-(a[1]+t*dy));};for(const poi of routePois){if(![6,7,8].includes(poi.k))continue;for(let i=1;i<result.coords.length;i++)if(segmentDistance(poi.p,result.coords[i-1],result.coords[i])<=maxDistance){counts[poi.k]=(counts[poi.k]||0)+1;break;}}return counts;}
function renderRouteAssessment(){
 const box=$('route-assessment'),q=result?.quality;
 if(!box)return;box.replaceChildren();box.hidden=true;if(!q)return;
 const de=lang==='de',selected=$('mobility-profile').value||'standard',criteria=result.criteria||{},relaxed=result.relaxedCriteria||[],nearby=routePoiCounts(),facts=[];
 const labels={maxSlope:tr('relaxedMaxSlope'),poorSurface:tr('relaxedPoorSurface'),wheelchairNo:tr('relaxedWheelchairNo'),escalators:tr('relaxedEscalators'),steps:tr('relaxedSteps')};
 if(result.steps)facts.push(`${result.steps} ${tr(result.steps===1?'stairSectionOne':'stairSectionMany')}`);
 if(result.escalators)facts.push(`${result.escalators} ${tr(result.escalators===1?'escalatorOne':'escalatorMany')}`);
 if(q.poorSurface>0)facts.push(tr('poorSurface'));
 if(nearby[6])facts.push(tr('barriersNearTheRoute'));
 if(nearby[8])facts.push(tr('raisedKerbsNearTheRoute'));
 // Unknown is never "suitable": report every unknown share, not only large ones.
 const coverage=[[tr('surface'),q.surfaceKnown],[tr('gradient'),q.slopeKnown]];if(criteria.avoidWheelchairNo)coverage.push([tr('wheelchairSuitability'),q.wheelchairKnown]);
 const missing=selected==='standard'?[]:coverage.filter(([,value])=>!Number.isFinite(value)||value<.995).map(([label,value])=>`${label} ${Number.isFinite(value)?Math.max(1,Math.round((1-value)*100)):100} %`);
 const notes=[];
 if(relaxed.length)notes.push((tr('thisIsTheBestPossible'))+relaxed.map(key=>labels[key]||(tr('profileSetting'))).join(', ')+(tr('weDoNotRecommendThem')));
 const far=Math.max(...(result.snapDistances||[0]).map(Number).filter(Number.isFinite),0);if(far>30)notes.push(tr('snapFarNote',{metres:Math.round(far)}));
 if(missing.length)notes.push((tr('suitabilityInformationMissingShareOf'))+missing.join(', ')+(tr('theseSectionsAreNotConfirmed')));
 if(selected==='vision')notes.push(tr('crossingEquipmentIsOftenNot'));
 if(result.source==='server-profile-v1')notes.push(tr('calculatedOnTheSonnenpfadServer'));
 if(!facts.length&&!notes.length)return;
 box.hidden=false;box.classList.add('warning');
 const heading=document.createElement('strong');heading.textContent=relaxed.length?(tr('noRouteFullyMeetsYour')):(tr('routeNotices'));box.append(heading);
 if(notes.length){const note=document.createElement('span');note.className='assessment-note';note.textContent=notes.join(' ');box.append(note);}
 if(facts.length){const list=document.createElement('div');list.className='route-facts';for(const fact of facts){const item=document.createElement('span');item.textContent=fact;list.append(item);}box.append(list);}
}
function showResult(){if(!result||result.error)return;finishPickMode(null);document.body.classList.remove('route-editing');const weather=effectiveWeather(),shadeActive=Number.isFinite(result.shade)&&result.shade>=0&&result.shade<=1&&currentSun?.altitude>2&&(!weather||weather.solarWeight>=.05);$('result').hidden=false;const duration=durationMetric(result.minutes);$('duration').textContent=Number.isFinite(result.minutes)?'= '+duration.text:'—';$('duration').nextElementSibling.textContent=(tr('walkingTime'))+' · '+duration.unit;$('distance').textContent=Number.isFinite(result.length)&&result.length>=0?(result.length/1000).toLocaleString(lang,{minimumFractionDigits:2,maximumFractionDigits:2}):'—';$('shade-value').textContent=shadeActive?Math.round(result.shade*100)+'%':'—';$('exposure-fill').style.width=shadeActive?result.shade*100+'%':'0%';$('route-type').textContent=t(currentSun?.altitude<=2?'balanced':preference);$('elevation').textContent=`↗ ${Number.isFinite(result.ascent)?Math.round(result.ascent):'—'} m  ·  ↘ ${Number.isFinite(result.descent)?Math.round(result.descent):'—'} m`;renderRouteAssessment();
 const extra=shortest&&!shortest.error?Math.max(0,Math.round(result.length-shortest.length)):0;$('detour').textContent=extra?`+${extra} m ${t('flat')}`:'';
}
function fitRoute(){if(!map||!result?.coords)return;const b=new maplibregl.LngLatBounds();result.coords.map(ll).forEach(p=>b.extend(p));map.fitBounds(b,{padding:{top:95,bottom:innerWidth<=800?210:200,left:45,right:45},maxZoom:is3D?16.3:17,duration:500});}
function shareURL(){const q=new URLSearchParams({lang,date:$('date').value,time:$('time').value,pref:preference,weather:liveWeatherEnabled?'1':'0',from:points[0].join(','),to:points[1].join(','),profile:$('mobility-profile').value,steps:$('steps').checked?'1':'0',escalators:$('escalators').checked?'1':'0',poorSurface:$('poor-surface').checked?'1':'0',wheelchairNo:$('wheelchair-no').checked?'1':'0',slope:$('slope-mode').value,theme:activeTheme,poi:[...selectedPois].join(',')});return location.origin+location.pathname+'?'+q;}
async function updateVisibleCitySources(selected,theme=activeTheme){
 const field=THEME_DEFS[theme]?.key||'sl',lines=[],stairs=[],arrows=[],pois=[];activeCityEdgeIds=[];
 for(const tile of selected){const path=tile.paths;if(path){for(const [index,coordinates] of path.lines.entries()){const edgeId=path.edgeIds[index],flags=path.flags[index]||[],properties={[field]:tile.values?.[index]??(field.startsWith('u')?-999:-1),st:flags[0]||0,e:edgeId,steps:flags[1]||0,_tile:tile.key};activeCityEdgeIds.push(edgeId);lines.push(feature('LineString',coordinates.map(ll),properties));if(flags[1])stairs.push(feature('LineString',coordinates.map(ll),{edgeId}));if(theme==='slope'&&!flags[0]&&flags[2]&&Math.abs(properties.sl)>=.1){const oriented=flags[2]<0?coordinates.slice().reverse():coordinates,segment=straightArrowSegment(oriented,16);if(segment)arrows.push(feature('LineString',segment.map(ll),{priority:-Math.abs(properties.sl)}));}}}
  for(const item of tile.pois?.pois||[])if(selectedPois.has(item.k)){const {p,...properties}=item;pois.push(feature('Point',ll(p),{...properties,_tile:tile.key}));}
 }
 map.getSource('network')?.setData(fc(lines));map.getSource('stairs-lines')?.setData(fc(stairs));map.getSource('slope-direction')?.setData(fc(arrows));map.getSource('pois')?.setData(fc(pois));
}

async function loadVisibleCityTiles({force=false}={}){
 if(!map||!cityManifest||viewSwitching&&!force)return;if(previewState&&!force){if(Date.now()-lastPreviewTileLoad<900)return;lastPreviewTileLoad=Date.now();}
 const demand=displayDemand({explore:exploreMode,threeD:is3D,zoom:map.getZoom(),pois:selectedPois.size>0,theme:activeTheme,wide:!isMobileMap()}),before=tileLoadId;
 if(!demand.paths){for(const source of ['network','stairs-lines','slope-direction'])map.getSource(source)?.setData(fc([]));if(!demand.pois)map.getSource('pois')?.setData(fc([]));activeCityEdgeIds=[];}
 if(!demand.trees)citySceneLayer?.setVisible(false);if(!demand.paths&&!demand.trees&&!demand.pois){++tileLoadId;activeCityViewSignature='';renderThemeLegend();return;}
 const visual=await ensureDisplayManifest();if(before!==tileLoadId)return;const b=map.getBounds(),c=map.getCenter(),bounds=[b.getWest(),b.getSouth(),b.getEast(),b.getNorth()],centre=[c.lng,c.lat],keys=selectDisplayTiles(visual,meta,bounds,centre,{limit:demand.paths?(map.getZoom()<13&&!isMobileMap()?600:18):demand.pois?600:9,bearing:map.getBearing()}),treeKeys=demand.trees?keys.slice(0,9).filter(key=>visual.tiles[key].trees):[],signature=`${exploreMode}|${is3D}|${demand.paths}|${demand.pois}|${activeTheme}|${[...selectedPois].sort()}|${keys.slice().sort()}|${treeKeys.slice().sort()}`;
 if(!force&&signature===activeCityViewSignature)return;const id=++tileLoadId,theme=activeTheme,revision=visual.revision;activeCityViewSignature=signature;
 const tasks=keys.map(async key=>{const definition=visual.tiles[key],tile={key};const jobs=[];if(demand.paths){jobs.push(displayStore.get(definition.pathsFile,revision).then(value=>tile.paths=value),displayStore.get(definition.themeFiles[theme],revision).then(value=>tile.values=value));}if(demand.pois&&definition.pois)jobs.push(displayStore.get(definition.poiFile,revision).then(value=>tile.pois=value));await Promise.all(jobs);return tile;});
 // Buildings render immediately from MapLibre's existing vector tiles. Tree
 // loading is an independent job and can never block a camera transition.
 if(demand.trees){const treeJob=async()=>{const layer=await ensureCityScene();if(id!==tileLoadId||!is3D)return;const input=[];let frame=0;const update=()=>{frame=0;if(id===tileLoadId&&is3D){layer.setTrees(input,local(centre));layer.setVisible(true);}};await Promise.allSettled(treeKeys.map(async key=>{const tile=await displayStore.get(visual.tiles[key].sceneFile,revision);if(id!==tileLoadId||!is3D)return;const placed=typeof placeDisplayTrees==='function'?await placeDisplayTrees((tile.trees||[]).filter(tree=>inPilot(ll(tree.p)))):(tile.trees||[]).filter(tree=>inPilot(ll(tree.p)));if(id!==tileLoadId||!is3D)return;input.push(...placed);if(!frame)frame=requestAnimationFrame(update);}));};treeJob().catch(error=>console.warn('Tree display postponed:',error));}
 if(demand.pois)await ensurePoiImages();let selected;try{selected=await Promise.all(tasks);}catch(error){if(id===tileLoadId)activeCityViewSignature='';throw error;}if(id!==tileLoadId)return;if(demand.paths||demand.pois)await updateVisibleCitySources(selected,theme);activeCityViewSignature=signature;activeTileKeys=keys.join(',');renderThemeLegend();
 if(shadeOverlayActive()&&!previewState){clearTimeout(cityShadeTimer);cityShadeTimer=setTimeout(()=>requestShade(false,{silent:true}),650);}
}
let lastPreviewTileLoad=0;

async function ensureDisplayManifest(){
 if(displayManifest)return displayManifest;if(!displayManifestPending)displayManifestPending=fetch(new URL('visual/manifest.json',displayBaseURL),{signal:AbortSignal.timeout(9000)}).then(async response=>{if(!response.ok)throw Error('visual-manifest');const value=await response.json();if(value.version!==1||!value.tiles||!value.revision)throw Error('visual-contract');displayManifest=value;displayStore=createDisplayStore({baseURL:displayBaseURL});return value;}).catch(error=>{displayManifestPending=null;throw error;});return displayManifestPending;
}

async function ensurePoiImages(){
 if(poiImagesPending)return poiImagesPending;poiImagesPending=(async()=>{const crossing=POI_DEFS.find(item=>item.k===1);await Promise.all([...POI_DEFS.map(definition=>addPoiMapImage(definition)),...Object.entries(CROSSING_CLASSES).map(([quality,definition])=>addPoiMapImage(crossing,`poi-1-q${quality}`,definition.color))]);})().catch(error=>{poiImagesPending=null;throw error;});return poiImagesPending;
}

async function init(){
 try{
  const loaded=await loadChunkedData();[meta,network,obstacles]=loaded;if(cityManifest){strings.de.pilot='FUSSWEGE · STADTGEBIET';strings.en.pilot='WALKING · STUTTGART';strings.de.outsidePilot='Mindestens ein Punkt liegt außerhalb des Stadtgebiets Stuttgart.';strings.en.outsidePilot='At least one point is outside Stuttgart city limits.';const [response,stateResponse]=await Promise.all([fetch(new URL('stuttgart-boundary.json',cityBaseURL)),fetch(new URL('bw-boundary.json',cityBaseURL)).catch(()=>null)]);if(response.ok)cityBoundary=await response.json();if(stateResponse?.ok)stateBoundary=await stateResponse.json().catch(()=>null);}language();
  if(typeof maplibregl.Map!=='function')throw Error('MapLibre unavailable');
  map=new maplibregl.Map({locale:mapLibreLocale(lang),container:'map',style:createBasemapStyle(),center:[9.1779,48.7775],zoom:cityManifest?12.2:15.2,minZoom:cityManifest?MAP_MIN_ZOOM:12,maxZoom:20,maxBounds:cityManifest?MAP_BOUNDS:undefined,maxPitch:0,maxTileCacheSize:matchMedia('(pointer:coarse)').matches?96:192,maxTileCacheZoomLevels:8,cancelPendingTileRequestsWhileZooming:false,attributionControl:false,pitch:0,centerClampedToGround:true,canvasContextAttributes:{antialias:true}});map.touchPitch.disable();
  map.addControl(new maplibregl.NavigationControl({showCompass:true}),'top-right');map.addControl(new maplibregl.AttributionControl({compact:false,customAttribution:'Atlas: M. Bakhshi'}),'bottom-right');
  map.on('load',()=>{setupLayers();updateMarkers();installDirectMapPicking();updateModeUI();$('loading-cover').hidden=true;worker=new Worker(URL.createObjectURL(new Blob([BUNDLED_WORKER],{type:'text/javascript'})));worker.onerror=event=>{console.error('Routing worker failed:',event.message,event.lineno);status('modelFailed');$('calculate').disabled=true;};worker.onmessage=onWorker;if(cityManifest){worker.postMessage({type:'initCity',manifest:cityManifest,base:cityBaseURL.href});loadVisibleCityTiles().catch(console.warn);map.on('moveend',()=>{loadVisibleCityTiles().catch(error=>console.warn('Viewport display postponed:',error));});}else worker.postMessage({type:'init',meta,network,obstacles});map.on('rotate',updateSunDirection);map.on('moveend',trackView);map.on('moveend',()=>{if(shadeOverlay&&!is3D&&!viewSwitching){clearTimeout(cityShadeTimer);cityShadeTimer=setTimeout(()=>requestShade(false,{silent:true}),650);}});map.on('click',e=>{if(pick===null||isMobileMap())return;chooseMapPoint([e.lngLat.lng,e.lngLat.lat],{forcedIndex:pick});});});
 }catch(e){const key=typeof maplibregl.GPUInitializationError==='function'&&e instanceof maplibregl.GPUInitializationError?'mapUnsupported':'loadFail';status(key);$('loading-cover').querySelector('span').textContent=t(key);$('loading-cover').querySelector('.spinner').hidden=true;console.error(e);}
}

function setupLayers(){
 const toPoly=b=>b.r.map(r=>r.map(ll));
 // Map context: Stuttgart in full colour, the rest of Baden-Württemberg at about 30 %, everything beyond further faded.
 // The extended map is context only; routing and analysis stay inside Stuttgart (inPilot).
 if(cityBoundary){const world=[[-180,-85],[180,-85],[180,85],[-180,85],[-180,-85]],cityHoles=cityBoundary.geometry.coordinates.map(polygon=>polygon[0].slice().reverse()),state=stateBoundary?.geometry?.coordinates||[],main=state.reduce((best,polygon,i)=>polygon[0].length>(state[best]?.[0].length||0)?i:best,0),features=state.length?[feature('Polygon',[world,...state.map(polygon=>polygon[0].slice().reverse())],{level:'outside'}),...state.map((polygon,i)=>feature('Polygon',i===main?[polygon[0],...polygon.slice(1),...cityHoles]:polygon,{level:'state'}))]:[feature('Polygon',[world,...cityHoles],{level:'state'})];map.addSource('city-mask',{type:'geojson',data:fc(features)});map.addLayer({id:'city-mask',type:'fill',source:'city-mask',paint:{'fill-color':'#f1f4f5','fill-opacity':['match',['get','level'],'outside',.92,.7]}});if(state.length){map.addSource('state-boundary',{type:'geojson',data:stateBoundary});map.addLayer({id:'state-line',type:'line',source:'state-boundary',layout:{'line-join':'round'},paint:{'line-color':'#46545d','line-width':['interpolate',['linear'],['zoom'],6,1.2,12,2.2],'line-dasharray':[4,2],'line-opacity':.85}});}}
 map.addSource('network',{type:'geojson',data:fc(network.edges.map(e=>feature('LineString',e.c.map(ll),themeProperties(e.theme,(e.bridge?1:0)|(e.tunnel?2:0)))))});map.addLayer({id:'network-line',type:'line',source:'network',minzoom:10,layout:{'line-cap':'round','line-join':'round'},paint:{'line-color':'#c2ccd0','line-width':['interpolate',['linear'],['zoom'],13,.7,17,2.5],'line-opacity':.65}});
 const emptyCanvas=document.createElement('canvas');emptyCanvas.width=1;emptyCanvas.height=1;
 map.addSource('shade',{type:'canvas',canvas:$('shadow-canvas'),animate:false,coordinates:[[meta.bounds[0],meta.bounds[3]],[meta.bounds[2],meta.bounds[3]],[meta.bounds[2],meta.bounds[1]],[meta.bounds[0],meta.bounds[1]]]});map.addLayer({id:'shade-fill',type:'raster',source:'shade',layout:{visibility:'none'},paint:{'raster-opacity':.34,'raster-fade-duration':0}});
 map.addSource('boundary',{type:'geojson',data:cityBoundary?fc([cityBoundary]):fc([feature('Polygon',[[[meta.bounds[0],meta.bounds[1]],[meta.bounds[2],meta.bounds[1]],[meta.bounds[2],meta.bounds[3]],[meta.bounds[0],meta.bounds[3]],[meta.bounds[0],meta.bounds[1]]]])])});map.addLayer({id:'pilot-boundary',type:'line',source:'boundary',paint:{'line-color':'#f4c542','line-width':['interpolate',['linear'],['zoom'],11.5,2,16,4],'line-opacity':1}});
 map.addSource('route',{type:'geojson',data:fc([])});map.addLayer({id:'route-halo',type:'line',source:'route',layout:{'line-cap':'round','line-join':'round'},paint:{'line-color':'#fff','line-width':['interpolate',['linear'],['zoom'],11,9,14.5,17,17,21,20,27]}});map.addLayer({id:'route-line',type:'line',source:'route',layout:{'line-cap':'round','line-join':'round'},paint:{'line-color':'#1a73e8','line-width':['interpolate',['linear'],['zoom'],11,5,14.5,11,17,14,20,19],'line-opacity':1}});map.addLayer({id:'route-warning',type:'line',source:'route',filter:['==',['get','kind'],'warning'],layout:{'line-cap':'round','line-join':'round'},paint:{'line-color':'#f28c28','line-width':['interpolate',['linear'],['zoom'],11,5,14.5,11,17,14,20,19],'line-opacity':1}});
}
function onWorker({data:d}){
 if(d.type==='ready'){ready=true;$('calculate').disabled=false;shadeReady=true;status('ready');if(autoRoute&&!exploreMode)calculate();return;}
 if(d.type==='shade'){shading=false;const context=shadeContexts.get(d.id)||{silent:false,routeOnly:false};shadeContexts.delete(d.id);if(d.id!==shadeId){sendShade();return;}currentSun=d.sun;if(is3D&&!context.routeOnly){const previousURL=shadowURL;shadowURL=URL.createObjectURL(d.blob);const update={url:shadowURL};if(d.bounds)update.coordinates=[[d.bounds[0],d.bounds[3]],[d.bounds[2],d.bounds[3]],[d.bounds[2],d.bounds[1]],[d.bounds[0],d.bounds[1]]];map.getSource('shade').updateImage(update);if(previousURL)setTimeout(()=>URL.revokeObjectURL(previousURL),3000);}shadeReady=true;updateClock();if(!context.silent){shadeBusyInteractive=false;$('calculate').disabled=false;status(result?'done':'ready');}if(autoRoute&&context.routeOnly){autoRoute=false;calculate();}sendShade();return;}
 if(d.type==='route'){if(d.id!==routeId)return;serverRoutingPending=false;$('calculate').disabled=false;result=d.result;shortest=d.shortest;if(result.error){if(result.detail)console.error('Route calculation failed:',result.detail);$('result').hidden=true;syncMobileDock();map.getSource('route').setData(fc([]));status(result.error);return;}status('done');showResult();map.getSource('route').setData(fc([feature('LineString',result.coords.map(ll)),...(result.warnings||[]).map(w=>feature('LineString',w.coords.map(ll),{kind:'warning',reasons:w.reasons.join(','),slope:w.slope??-1,limit:w.limit??0,surface:w.surface||'',name:w.name||''}))]));$('panel-toggle').lastElementChild.textContent=`${t('yourRoute')} · ${Number.isFinite(result.minutes)?'= '+formatWalkDuration(result.minutes,lang):'—'} · ${(result.length/1000).toFixed(1)} km`;fitRoute();return;}
 if(d.type==='error'){shading=false;const context=shadeContexts.get(d.id)||{silent:false};shadeContexts.delete(d.id);if(d.id!==shadeId){sendShade();return;}if(!context.silent){shadeBusyInteractive=false;status('modelFailed');$('calculate').disabled=!shadeReady;}console.error(d.message);sendShade();}
}
populate();$('date').value=dateNow();{const now=berlinParts(new Date());$('time').value=+now.hour*60+ +now.minute;}$('date').min='2020-01-01';$('date').max='2035-12-31';
const query=new URLSearchParams(location.search);liveWeatherEnabled=query.get('weather')!=='0';exploreMode=query.get('mode')==='explore';activeTheme=THEME_DEFS[query.get('theme')]?query.get('theme'):'slope';for(const kind of (query.get('poi')||'').split(',').map(Number))if(POI_DEFS.some(item=>item.k===kind))selectedPois.add(kind);setupStep4Controls();if(/^\d{4}-\d\d-\d\d$/.test(query.get('date')||'')&&!Number.isNaN(Date.parse(query.get('date'))))$('date').value=query.get('date');if(query.has('time'))$('time').value=Math.min(1439,Math.max(0,Number(query.get('time'))||0));
for(const [i,key]of ['from','to'].entries()){const p=(query.get(key)||'').split(',').map(Number);if(p.length===2&&p.every(Number.isFinite)&&p[0]>9.03&&p[0]<9.32&&p[1]>48.69&&p[1]<48.87){setCustom(i,p);autoRoute=true;}}
$('steps').checked=query.get('steps')==='1';$('escalators').checked=query.get('escalators')==='1';$('poor-surface').checked=query.get('poorSurface')==='1';$('wheelchair-no').checked=query.get('wheelchairNo')==='1';$('slope-mode').value=['uphill','downhill','both'].includes(query.get('slope'))?query.get('slope'):(query.get('gentle')==='1'?'both':'none');$('mobility-profile').value=['standard','wheelchair','powerWheelchair','walkingAid','vision','stroller','custom'].includes(query.get('profile'))?query.get('profile'):'standard';setPreference(['shade','sun'].includes(query.get('pref'))?query.get('pref'):'balanced');updateProfile();updateSlopeChoice();
$('language').onclick=()=>{lang=tr('de2');language();};
$('calculate').onclick=()=>{calculate();if(innerWidth<=800&&points.every(Boolean)){$('sidebar-body').classList.remove('expanded');$('panel-toggle').setAttribute('aria-expanded','false');}};document.querySelectorAll('[data-pref]').forEach(b=>b.onclick=()=>setPreference(b.dataset.pref));$('mobility-profile').onchange=updateProfile;document.querySelectorAll('[data-profile]').forEach(b=>b.onclick=()=>{$('mobility-profile').value=b.dataset.profile;updateProfile();});document.querySelectorAll('[data-slope]').forEach(b=>b.onclick=()=>{$('slope-mode').value=b.dataset.slope;updateSlopeChoice();});for(const id of ['steps','escalators','poor-surface','wheelchair-no'])$(id).onchange=()=>{if(result||serverRoutingPending)calculate();};$('panel-toggle').onclick=()=>{const open=$('sidebar-body').classList.toggle('expanded');$('panel-toggle').setAttribute('aria-expanded',String(open));};
for(const [i,id]of ['pick-origin','pick-destination'].entries())$(id).onclick=()=>{if(!map)return;if(exploreMode)setExploreMode(false);stopRoutePreview(false);finishPickMode(pick===i?null:i);if(innerWidth<=800){$('sidebar-body').classList.remove('expanded');$('panel-toggle').setAttribute('aria-expanded','false');}if(!isMobileMap())showToast(i===0?'pickStart':'pickEnd');syncMobileDock();};
$('swap').onclick=()=>{const p=points[0]?.slice(),originLabel=$('origin').value,destinationLabel=$('destination').value;if(!p&&!points[1])return;for(const [i,value,label]of [[0,points[1]?.slice(),destinationLabel],[1,p,originLabel]]){points[i]=value||null;$(i?'destination':'origin').value=value?label:'';markers[i]?.remove();markers[i]=null;}updateMarkers();invalidateRoute();};
let debounce;function selectedTimeChanged(){const reroute=!exploreMode&&preference!=='balanced'&&Boolean(result||serverRoutingPending);if(reroute&&serverRoutingPending){routeId++;serverRouteController?.abort();serverRoutingPending=false;}updateImmediateSun();if(shadeOverlayActive())requestShade(false,{silent:true});clearTimeout(debounce);if(reroute)debounce=setTimeout(()=>calculate(),250);}$('time').oninput=selectedTimeChanged;$('date').onchange=()=>{if($('date').checkValidity()&&$('date').value)selectedTimeChanged();};
$('now').onclick=()=>{const p=berlinParts(new Date());$('date').value=dateNow();$('time').value=Math.min(1439,+p.hour*60+ +p.minute);selectedTimeChanged();};
$('fit').onclick=()=>{stopRoutePreview(false);fitRoute();};
$('locate').onclick=()=>{if(!navigator.geolocation){status('locationFail');return;}navigator.geolocation.getCurrentPosition(pos=>{const p=[pos.coords.longitude,pos.coords.latitude];if(!inPilot(p)){showToast('outsideLocation');return;}hideToast();setCustom(0,p,tr('myLocation'));map.flyTo({center:p,zoom:16});},()=>status('locationFail'),{timeout:10000,maximumAge:60000});};
$('map-toast-close').onclick=()=>{finishPickMode(null);hideToast();};
$('weather-info').onclick=()=>{const details=$('weather-details'),open=details.hidden;details.hidden=!open;$('weather-info').setAttribute('aria-expanded',String(open));};
$('weather-toggle').onclick=()=>{liveWeatherEnabled=!liveWeatherEnabled;renderWeather(true);if(!exploreMode&&preference!=='balanced'&&(result||serverRoutingPending))calculate();else if(shadeOverlayActive())requestShade(false,{silent:true});};
$('share').onclick=async()=>{const url=shareURL();history.replaceState(null,'',url);try{await navigator.clipboard.writeText(url);status('copied');}catch{status('copyFail');}};
$('about').onclick=()=>{$('about-content').innerHTML=aboutContent();$('about-dialog').showModal();};$('about-mobile').onclick=$('about').onclick;$('guide').onclick=$('guide-mobile').onclick=()=>{$('guide-content').replaceChildren(guideContent(lang));$('guide-dialog').showModal();};$('close-guide').onclick=$('close-guide-bottom').onclick=()=>$('guide-dialog').close();$('close-about').onclick=$('close-about-bottom').onclick=()=>$('about-dialog').close();
// v0.7 presentation, terrain and routing UX extensions.
function renderProfile(){
 routeMeasureCache=result?.coords?.length?routeMeasure(result.coords):null;
 const box=$('elevation-profile'),values=result?.profile;if(box)box.hidden=false;const scale=values?profileScale(values,$('elevation-chart').getBoundingClientRect().width||300,($('elevation-chart').getBoundingClientRect().height||86)*70/86):null;
 if(!box||!scale){if(box)box.hidden=true;return;}box.hidden=false;
 const w=300,h=86,bottom=10,{low,high,total,min,max}=scale;let open=false;
 const line=values.map(([d,z])=>{if(!Number.isFinite(d)||!Number.isFinite(z)){open=false;return '';}
  const command=open?'L':'M';open=true;return command+(d/total*w).toFixed(2)+' '+(6+(high-z)/(high-low)*(h-16)).toFixed(2);}).join(' ');
 // Separate closed areas preserve gaps instead of inventing missing heights.
 const area=line.split(/(?=M)/).filter(Boolean).map(part=>{const pairs=[...part.matchAll(/[ML]([\d.-]+) ([\d.-]+)/g)];return part+` L ${pairs.at(-1)[1]} ${h-bottom} L ${pairs[0][1]} ${h-bottom} Z`;}).join(' ');
 $('elevation-line').setAttribute('d',line);$('elevation-area').setAttribute('d',area);
 $('elevation-range').textContent=`${Math.round(min)}–${Math.round(max)} m`;
 const height=p=>Number.isFinite(p?.[1])?Math.round(p[1])+' m':'—';
 $('elevation-start').textContent=`A · ${height(values[0])}`;$('elevation-end').textContent=`B · ${height(values.at(-1))}`;
 $('elevation-position').textContent='';$('profile-distance-middle').textContent=(total/2000).toLocaleString(lang,{maximumFractionDigits:2})+' km';$('profile-distance-end').textContent=(total/1000).toLocaleString(lang,{maximumFractionDigits:2})+' km';$('profile-y-labels').innerHTML=[high,(high+low)/2,low].map((z,i)=>`<text x="3" y="${12+i*30}">${Math.round(z)} m</text>`).join('');
}
const showResultBase=showResult;showResult=()=>{showResultBase();if(result&&!result.error){renderProfile();$('route-preview').disabled=!routeMeasureCache;syncMobileDock();}};
function treeDimensions(tree){return {r:Math.max(.5,Math.min(8,tree.r)),h:Math.max(3,Math.min(30,tree.h))};}

function addV7Layers(){map.setPaintProperty('shade-fill','raster-opacity',.24);map.addSource('osm-raster',{type:'raster',tiles:['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],tileSize:256,maxzoom:19,attribution:'© OpenStreetMap contributors'});map.addLayer({id:'osm-raster',type:'raster',source:'osm-raster',layout:{visibility:'none'}},'network-line');map.addSource('topo-raster',{type:'raster',tiles:['https://tile.opentopomap.org/{z}/{x}/{y}.png'],tileSize:256,maxzoom:17,attribution:'© OpenStreetMap contributors · SRTM · OpenTopoMap'});map.addLayer({id:'topo-raster',type:'raster',source:'topo-raster',layout:{visibility:'none'}},'network-line');installAerialProtocol(maplibregl);const aerial='lgl://owsproxy.lgl-bw.de/owsproxy/ows/WMTS_LGL-BW_ATKIS_DOP_20_C?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=DOP_20_C&STYLE=default&TILEMATRIXSET=GoogleMapsCompatible&TILEMATRIX=GoogleMapsCompatible:{z}&TILEROW={y}&TILECOL={x}&FORMAT=image/jpeg';map.addSource('aerial-raster',{type:'raster',tiles:[aerial],tileSize:256,minzoom:0,maxzoom:20,bounds:[7.49,47.46,10.67,49.81],attribution:'LGL-BW (2026) · dl-de/by-2-0 · www.lgl-bw.de'});map.addLayer({id:'aerial-raster',type:'raster',source:'aerial-raster',layout:{visibility:'none'},paint:{'raster-fade-duration':250,'raster-resampling':'linear'}},'network-line');if(map.getLayer('city-mask'))map.moveLayer('city-mask','network-line');map.addLayer(buildingDisplayLayer(),'route-halo');if(map.getLayer('city-mask'))map.moveLayer('city-mask');for(const id of ['state-line','pilot-boundary'])if(map.getLayer(id))map.moveLayer(id);map.addSource('access',{type:'geojson',data:fc([])});map.addLayer({id:'access-line',type:'line',source:'access',layout:{'line-cap':'round'},paint:{'line-color':'#f4c542','line-width':3,'line-dasharray':[1.2,1.2]}});}
function addPoiMapImage(definition,id=`poi-${definition.k}`,color=definition.color){return new Promise(resolve=>{const image=new Image();image.onload=()=>{const size=64,canvas=document.createElement('canvas'),context=canvas.getContext('2d'),glyph=document.createElement('canvas'),glyphContext=glyph.getContext('2d');canvas.width=canvas.height=glyph.width=glyph.height=size;context.beginPath();context.arc(size/2,size/2,28,0,Math.PI*2);context.fillStyle=color;context.fill();context.lineWidth=2;context.strokeStyle='#111';context.stroke();const naturalWidth=image.naturalWidth||size,naturalHeight=image.naturalHeight||size,max=38,ratio=naturalWidth/naturalHeight,width=ratio>=1?max:max*ratio,height=ratio>=1?max/ratio:max,x=(size-width)/2,y=(size-height)/2;glyphContext.drawImage(image,x,y,width,height);glyphContext.globalCompositeOperation='source-in';glyphContext.fillStyle=definition.foreground;glyphContext.fillRect(0,0,size,size);context.drawImage(glyph,0,0);if(!map.hasImage(id))map.addImage(id,context.getImageData(0,0,size,size),{pixelRatio:2});resolve();};image.onerror=resolve;image.src=poiIcons[definition.icon];});}
function crossingValue(value,other=false){value=+value;if(value===1)return tr('yes');if(value===2)return tr('no');if(value===3&&other)return tr('otherValue');return tr('unknown');}
function crossingPopup(item,kind){const p=item.properties||{},quality=CROSSING_CLASSES[+p.q]||CROSSING_CLASSES[0],content=document.createElement('div');content.className='crossing-popup feature-card';const title=document.createElement('strong');title.textContent=kind[lang];const badge=document.createElement('span');badge.className='crossing-quality';badge.style.setProperty('--quality-color',quality.color);badge.textContent=quality[lang];const rule=document.createElement('small');rule.textContent=quality[lang+'Rule'];content.append(title,badge,rule);const rows=[[tr('audibleSignal'),crossingValue(p.a)],[tr('vibrationSignal'),crossingValue(p.v)],[tr('tactilePaving'),crossingValue(p.t,true)],[tr('wheelchairSuitability'),tr({1:'wheelchairYes',2:'wheelchairLimited',3:'wheelchairNo'}[+p.w]||'unknownValue')],[tr('kerb'),tr({1:'kerbLowered',2:'kerbFlush',3:'kerbRaised',4:'kerbNone'}[+p.c]||'unknownValue')],[tr('buttonOperated'),crossingValue(p.b)],[tr('trafficIsland'),cleanDetailValue(p.is)],[tr('marking'),cleanDetailValue(p.mk)],[tr('lighting'),cleanDetailValue(p.li)]];const list=document.createElement('dl');for(const [label,value] of rows){if(value===null)continue;const dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=label;dd.textContent=value;list.append(dt,dd);}content.append(list);const footer=document.createElement('small');footer.textContent=tr('crossingSource',{layer:p.src||tr('crossingLayer'),date:cityManifest?.sourceDate||meta?.sourceDate||'2026-09-15'});content.append(footer);return content;}
function cleanDetailValue(value){if(value===null||value===undefined||value==='')return null;if(typeof value==='number'&&Number.isFinite(value))return value.toLocaleString(lang,{maximumFractionDigits:10});const normalized=String(value).trim().toLowerCase(),translated=OSM_VALUES[lang==='en'?'en':'de'];const readable=part=>lang==='en'&&/^[a-z_]+$/.test(part)?part[0].toUpperCase()+part.slice(1).replace(/_/g,' '):part;return translated[normalized]||(lang==='en'&&!normalized.includes(';')?readable(String(value).trim()):null)||(normalized.includes(';')?String(value).split(';').map(part=>translated[part.trim().toLowerCase()]||part.trim()).join(' · '):String(value));}
function detailCard(title,rows,properties={},compact=false){const content=document.createElement('div');content.className=`feature-card${compact?' compact':''}`;const heading=document.createElement('strong');heading.textContent=title;content.append(heading);const list=document.createElement('dl');for(const [label,rawValue,unit='']of rows){const value=cleanDetailValue(rawValue);if(value===null)continue;const dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=label;dd.textContent=`${value}${unit}`;list.append(dt,dd);}if(list.childElementCount)content.append(list);if(!compact){const footer=document.createElement('small');const layer=properties.src||properties.layer||'';if(properties.displaySource){footer.textContent=(tr('source'))+properties.displaySource;content.append(footer);return content;}footer.textContent=tr('atlasSource',{layer:layer?` · ${layer}`:'',date:cityManifest?.sourceDate||meta?.sourceDate||'2026-09-15'});content.append(footer);}return content;}
function poiRows(kind,p,compact=false){const de=lang==='de',yesNo=value=>cleanDetailValue(value),rows={
 2:[[tr('doorWidth'),p.dw,' cm'],[tr('cabinWidth'),p.cw,' cm'],[tr('cabinLength'),p.cl,' cm'],[tr('wheelchairSuitability2'),p.wc],[tr('connection'),p.cf],[tr('levels'),p.lv],[tr('speechOutput'),p.sp],[tr('tactileWriting'),p.tw],[tr('access'),p.ac],[tr('operator'),p.op],[tr('recorded'),p.dt]],
 3:[[tr('length'),p.le,' cm'],[tr('width'),p.wi,' cm'],[tr('gradient2'),p.sl,' %'],[tr('crossSlope'),p.cs,' %'],[tr('connection'),p.cn],[tr('recorded'),p.dt]],
 4:[[tr('direction'),p.di],[tr('reversible'),p.rv],[tr('duration'),p.du,' s'],[tr('connection'),p.cn],[tr('recorded'),p.dt]],
 5:[[tr('steps'),p.sc],[tr('stepHeight'),p.sh,' cm'],[tr('leftHandrail'),p.hl],[tr('rightHandrail'),p.hr],[tr('centreHandrail'),p.hc],[tr('bicycleGroove'),p.bg],[tr('connection'),p.cn],[tr('recorded'),p.dt]],
 6:[[tr('type'),p.bt||p.gt],[tr('passageWidth'),p.wi,' m'],[tr('wheelchairSuitability2'),p.wc],[tr('access'),p.ac],[tr('pedestrianAccess'),p.ft],[tr('bicycle'),p.bi],[tr('locked'),p.lk],[tr('openingHours'),p.oh],[tr('operator'),p.op]],
 7:[[tr('kerb'),p.kb],[tr('kerbHeight'),p.kh,' cm'],[tr('tactilePaving'),p.tp],[tr('wheelchairSuitability2'),p.wc],[tr('surface2'),p.sf],[tr('crossing'),p.cr],[tr('trafficIsland'),p.is]],
 8:[[tr('kerb'),p.kb],[tr('kerbHeight'),p.kh,' cm'],[tr('tactilePaving'),p.tp],[tr('wheelchairSuitability2'),p.wc],[tr('surface2'),p.sf]],
 9:[[tr('backrest'),p.br],[tr('armrests'),p.ar],[tr('seats'),p.se],[tr('wheelchairSuitability2'),p.wc],[tr('covered'),p.cv],[tr('lit'),p.li],[tr('material'),p.ma],[tr('surface2'),p.sf],[tr('access'),p.ac],[tr('openingHours'),p.oh]],
 10:[[tr('type'),p.ty],[tr('bench'),p.be],[tr('bin'),p.bi],[tr('wheelchairSuitability2'),p.wc],[tr('lit'),p.li],[tr('tactilePaving'),p.tp],[tr('departureBoard'),p.db],[tr('surface2'),p.sf],[tr('covered'),p.cv],[tr('openingHours'),p.oh]],
 }[kind.k]||[];return compact?rows.filter(([,value])=>cleanDetailValue(value)!==null).slice(0,4):rows;}
function poiCard(item,kind,compact=false){const p=item.properties||{};if(kind.k===1){if(!compact)return crossingPopup(item,kind);const quality=CROSSING_CLASSES[+p.q]||CROSSING_CLASSES[0];return detailCard(kind[lang],[[tr('quality'),quality[lang]],[tr('tactile'),crossingValue(p.t,true)],[tr('audible'),crossingValue(p.a)]],p,true);}return detailCard(kind[lang],poiRows(kind,p,compact),p,compact);}
function surfaceText(value){const key={1:'surfaceGood',2:'surfaceMedium',3:'surfacePoor'}[+value];return key?tr(key):null;}
function lineCard(item,compact=false){const p=item.properties||{},de=lang==='de',known=(value,min)=>value!==null&&value!==undefined&&Number.isFinite(Number(value))&&Number(value)>=min,title=p.steps?(tr('stairs')):(+p.st&1)?(tr('bridge')):(+p.st&2)?(tr('tunnel')):(tr('pathSegment')),rows=[[tr('slope'),known(p.sl,0)?Number(p.sl).toLocaleString(lang,{maximumFractionDigits:1}):null,' %'],[tr('surface2'),surfaceText(p.su)],[tr('summerShade'),known(p.ss,0)?Math.round(p.ss):null,' %'],[tr('winterShade'),known(p.sw,0)?Math.round(p.sw):null,' %'],['UTCI · '+(tr('summer')),known(p.us,-99.99)?Number(p.us).toLocaleString(lang,{maximumFractionDigits:1}):null,' °C'],['UTCI · '+(tr('winter')),known(p.uw,-99.99)?Number(p.uw).toLocaleString(lang,{maximumFractionDigits:1}):null,' °C'],[tr('noise'),known(p.n,0)?Number(p.n).toLocaleString(lang,{maximumFractionDigits:1}):null,' dB'],[tr('relativeWindExposure'),known(p.w,0)?Number(p.w).toLocaleString(lang,{maximumFractionDigits:2}):null]];return detailCard(title,compact?rows.filter(([,value])=>value!==null).slice(0,4):rows,{layer:tr('streetNetwork')},compact);}
function plannerCard(item){const p=item.properties||{},de=lang==='de',base=lineCard(item,false),list=base.querySelector('dl')||base.appendChild(document.createElement('dl')),rows=[[tr('district'),p.dn],[tr('name'),p.nm||null],[tr('length'),Number.isFinite(+p.m)?Math.round(+p.m)+' m':null],[tr('atlasId'),p.a||null]];for(const [label,value] of rows.reverse()){if(!value)continue;const dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=label;dd.textContent=value;list.prepend(dt,dd);}if(+p.sl<0&&!+p.steps){const dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=tr('slope');dd.textContent=tr('noValue');list.append(dt,dd);}for(const [label,value] of analysisDetailRows(p)){const dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=label;dd.textContent=value;list.append(dt,dd);}const footer=base.querySelector('small');if(footer)footer.textContent=(tr('sourceStuttgartPedestrianAtlasDistrict'));return base;}
function clearFeatureSelection(){map?.getSource('selected-feature')?.setData(fc([]));}
function selectFeature(item){map?.getSource('selected-feature')?.setData(fc([feature(item.geometry.type,item.geometry.coordinates)]));}
function installSelectionLayers(){
 map.addSource('selected-feature',{type:'geojson',data:fc([])});
 map.addLayer({id:'selected-halo',type:'line',source:'selected-feature',filter:['!=',['geometry-type'],'Point'],layout:{'line-cap':'round','line-join':'round'},paint:{'line-color':'#fff','line-width':10,'line-opacity':.95}});
 map.addLayer({id:'selected-outline',type:'line',source:'selected-feature',filter:['!=',['geometry-type'],'Point'],layout:{'line-cap':'round','line-join':'round'},paint:{'line-color':'#087cdb','line-width':5,'line-opacity':1}});
 map.addLayer({id:'selected-point',type:'circle',source:'selected-feature',filter:['==',['geometry-type'],'Point'],paint:{'circle-radius':21,'circle-color':'#168bee','circle-opacity':.18,'circle-stroke-width':3,'circle-stroke-color':'#087cdb','circle-pitch-alignment':'map'}});
}
function installFeatureCards(){
 installSelectionLayers();
 map.on('click',async event=>{
  if(!exploreMode||pick!==null||viewSwitching||previewState||map.getZoom()<14.5||!inPilot([event.lngLat.lng,event.lngLat.lat]))return;const request=++featureRequestId;featurePopup?.remove();featurePopup=null;clearFeatureSelection();
  const layers=['poi-points','planner-line','network-line'].filter(id=>map.getLayer(id)&&map.getLayoutProperty(id,'visibility')!=='none'),items=map.queryRenderedFeatures(event.point,{layers}),poi=items.find(item=>item.layer.id==='poi-points'),line=items.find(item=>item.layer.id==='network-line'),plannerLine=items.find(item=>item.layer.id==='planner-line');
  const show=(location,content)=>{if(request!==featureRequestId||!exploreMode)return;const previous=featurePopup;featurePopup=null;previous?.remove();const popup=new maplibregl.Popup({closeButton:true,maxWidth:innerWidth<=800?'min(340px, calc(100vw - 28px))':'340px',className:'feature-detail'}).setLngLat(location).setDOMContent(content).addTo(map);featurePopup=popup;popup.on('close',()=>{if(featurePopup===popup){featurePopup=null;clearFeatureSelection();}});};
  if(!poi&&plannerLine){selectFeature(plannerLine);show(event.lngLat,plannerCard(plannerLine));return;}
  if(poi||line){const item=poi||line;selectFeature(item);const kind=poi?POI_DEFS.find(definition=>definition.k===+poi.properties.k):null;if(poi&&!kind)return;const location=poi?poi.geometry.coordinates:event.lngLat,pending=document.createElement('div');pending.className='feature-card';pending.textContent=tr('loadingDetails');show(location,pending);
   try{const visual=await ensureDisplayManifest(),file=visual.tiles[item.properties._tile]?.detailFile;if(!file)throw Error('No detail shard');const [details,fullPaths]=await Promise.all([displayStore.get(file,visual.revision),!poi?displayStore.get(visual.tiles[item.properties._tile].pathsFile,visual.revision):null]),properties=poi?details.pois[item.properties.detailKey]:details.lines[item.properties.e];if(request!==featureRequestId||!exploreMode)return;if(fullPaths){const index=fullPaths.edgeIds.indexOf(+item.properties.e);if(index>=0)selectFeature({geometry:{type:'LineString',coordinates:fullPaths.lines[index].map(ll)}});}const enriched={...item,properties:{...item.properties,...properties}};show(location,poi?poiCard(enriched,kind,false):lineCard(enriched,false));}
   catch(error){pending.textContent=tr('detailsCouldNotLoadClick');}return;
  }
 });
}

// Why an orange route piece is not recommended for the chosen group (planners see the exact cause).
function warningCard(p){
 const de=lang==='de',profile=$('mobility-profile').value,profileKey={standard:'profileStandard',wheelchair:'profileWheelchair',powerWheelchair:'profilePower',walkingAid:'profileWalkingAid',vision:'profileVision',stroller:'profileStroller'}[profile],group=profileKey?t(profileKey):(tr('yourSettings'));
 const percent=value=>Number(value).toLocaleString(lang,{maximumFractionDigits:1})+' %',reasons=String(p.reasons||'').split(',').filter(Boolean),rows=[];
 for(const reason of reasons){
  if(reason==='steps')rows.push([tr('stairs'),tr('stepsCannotBePassedOr')]);
  else if(reason==='escalator')rows.push([tr('escalator'),tr('notSafeWithAWheelchair')]);
  else if(reason==='poorSurface')rows.push([tr('poorSurface'),(p.surface?cleanDetailValue(p.surface)+'. ':'')+(tr('anUnevenSurfaceMakesRolling'))]);
  else if(reason==='wheelchairNo')rows.push([tr('notWheelchairAccessible'),tr('recordedAsWheelchairNoIn')]);
  else if(reason==='maxSlope')rows.push([(tr('gradient3'))+(+p.slope>=0?percent(p.slope):'?'),+p.limit>0?(tr('limitFor',{group,limit:percent(p.limit)})):(tr('steeperThanYourSettingsAllow'))]);
 }
 const content=document.createElement('div');content.className='feature-card warning-card';
 const title=document.createElement('strong');title.textContent=tr('notRecommendedFor',{group});content.append(title);
 if(p.name){const name=document.createElement('span');name.className='warning-name';name.textContent=p.name;content.append(name);}
 const list=document.createElement('dl');for(const [label,text] of rows){const dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=label;dd.textContent=text;list.append(dt,dd);}content.append(list);
 const note=document.createElement('small');note.textContent=tr('noConnectionMeetsEveryRequirement');content.append(note);return content;
}
function installWarningCards(){
 map.on('mouseenter','route-warning',()=>{if(pick===null)map.getCanvas().style.cursor='pointer';});map.on('mouseleave','route-warning',()=>{if(pick===null)map.getCanvas().style.cursor='';});
 map.on('click','route-warning',event=>{if(pick!==null||exploreMode||previewState)return;const item=event.features?.[0];if(!item)return;featurePopup?.remove();featurePopup=new maplibregl.Popup({closeButton:true,maxWidth:innerWidth<=800?'min(340px, calc(100vw - 28px))':'340px',className:'feature-detail'}).setLngLat(event.lngLat).setDOMContent(warningCard(item.properties||{})).addTo(map);});
}
function lineLength(coordinates){let length=0;for(let i=1;i<coordinates.length;i++)length+=Math.hypot(coordinates[i][0]-coordinates[i-1][0],coordinates[i][1]-coordinates[i-1][1]);return length;}
function straightArrowSegment(coordinates,direction){let best=null;for(let i=1;i<coordinates.length;i++){const a=coordinates[i-1],b=coordinates[i],length=Math.hypot(b[0]-a[0],b[1]-a[1]);if(!best||length>best.length)best={a,b,length};}if(!best||best.length<24)return null;let {a,b,length}=best;if(direction<0)[a,b]=[b,a];const dx=(b[0]-a[0])/length,dy=(b[1]-a[1])/length,mx=(a[0]+b[0])/2,my=(a[1]+b[1])/2,half=Math.min(24,length*.36);return [[mx-dx*half,my-dy*half],[mx+dx*half,my+dy*half]];}
function slopeArrowFeatures(lines,themes,edgeIds){const seen=new Set(),features=[];for(let index=0;index<lines.length;index++){const edgeId=edgeIds[index],coordinates=lines[index],direction=slopeDirections[edgeId]||0,slope=themes[index]?.[0],length=lineLength(coordinates),segment=straightArrowSegment(coordinates,direction);if(seen.has(edgeId)||structureFlags[edgeId]||length<24||!direction||!segment||!Number.isFinite(slope)||Math.abs(slope)<.1)continue;seen.add(edgeId);features.push(feature('LineString',segment.map(ll),{edgeId,length,priority:-length}));}return features;}
function addSlopeArrowImage(){if(map.hasImage('slope-uphill-arrow'))return;const canvas=document.createElement('canvas'),context=canvas.getContext('2d');canvas.width=64;canvas.height=24;context.translate(2,2);context.lineJoin='round';context.lineCap='round';context.beginPath();context.moveTo(2,10);context.lineTo(50,10);context.lineTo(40,2);context.moveTo(50,10);context.lineTo(40,18);context.strokeStyle='#111';context.lineWidth=6;context.stroke();context.strokeStyle='#fff';context.lineWidth=3;context.stroke();map.addImage('slope-uphill-arrow',context.getImageData(0,0,64,24),{pixelRatio:2});}
async function addStep4Layers(){installMapExperience();map.moveLayer('network-line','route-halo');const legacyStairs=network.edges?.filter(edge=>edge.steps).map(edge=>feature('LineString',edge.c.map(ll),{}))||[];map.addSource('stairs-lines',{type:'geojson',data:fc(legacyStairs)});map.addLayer({id:'stairs-halo',type:'line',source:'stairs-lines',minzoom:14.5,layout:{'line-cap':'butt','line-join':'round'},paint:{'line-color':'#111','line-width':['interpolate',['linear'],['zoom'],14.5,8,17,11,19,13]}},'route-halo');map.addLayer({id:'stairs-treads',type:'line',source:'stairs-lines',minzoom:14.5,layout:{'line-cap':'butt','line-join':'round'},paint:{'line-color':'#fff','line-width':['interpolate',['linear'],['zoom'],14.5,5,17,7,19,8],'line-dasharray':[.55,.38]}},'route-halo');addSlopeArrowImage();map.addSource('slope-direction',{type:'geojson',data:fc([])});map.addLayer({id:'slope-arrows',type:'symbol',source:'slope-direction',minzoom:14.5,layout:{'symbol-placement':'line-center','symbol-sort-key':['get','priority'],'icon-image':'slope-uphill-arrow','icon-size':['interpolate',['linear'],['zoom'],14.5,.82,17,1.04,19,1.18],'icon-rotation-alignment':'map','icon-pitch-alignment':'map','icon-keep-upright':false,'icon-allow-overlap':false,'icon-ignore-placement':false,'icon-padding':5}},'route-halo');map.addSource('pois',{type:'geojson',data:fc([])});const ordinaryPoiIcon=['match',['get','k'],...POI_DEFS.flatMap(item=>[item.k,`poi-${item.k}`]),'poi-1'],crossingIcon=['match',['get','q'],3,'poi-1-q3',2,'poi-1-q2',1,'poi-1-q1','poi-1-q0'];// Zoomed out, symbols may not overlap (no clutter); from zoom 14.5 every selected place is drawn.
 map.addLayer({id:'poi-overview',type:'symbol',source:'pois',minzoom:10,maxzoom:14.5,layout:{'icon-image':['case',['==',['get','k'],1],crossingIcon,ordinaryPoiIcon],'icon-size':['interpolate',['linear'],['zoom'],10,.2,14.5,.5],'icon-allow-overlap':false,'icon-padding':1},paint:{'icon-opacity':.95}});
 map.addLayer({id:'poi-points',type:'symbol',source:'pois',minzoom:14.5,layout:{'icon-image':['case',['==',['get','k'],1],crossingIcon,ordinaryPoiIcon],'icon-size':['interpolate',['linear'],['zoom'],10,.16,12.5,.32,14.5,.62,17,.8,19,.92],'icon-allow-overlap':true,'icon-ignore-placement':true,'icon-padding':0},paint:{'icon-opacity':.96}});applyTheme();applyPoiFilter();installFeatureCards();installWarningCards();}
const applyThemeBase=applyTheme;applyTheme=options=>{applyThemeBase(options);applyPlanner().catch(console.warn);};
const setupLayersBase=setupLayers;setupLayers=()=>{setupLayersBase();addV7Layers();addStep4Layers();};
const invalidateRouteBase=invalidateRoute;invalidateRoute=()=>{invalidateRouteBase();if(map?.getSource('access'))map.getSource('access').setData(fc([]));};
const onWorkerBase=onWorker;onWorker=e=>{onWorkerBase(e);const d=e.data;if(d.type==='route'&&d.id===routeId&&d.result&&!d.result.error&&map?.getSource('access')){const s=d.result.snaps;map.getSource('access').setData(fc([feature('LineString',[points[0],ll(s[0])]),feature('LineString',[ll(s[1]),points[1]])]));}else if(d.type==='route'&&d.id===routeId&&map?.getSource('access'))map.getSource('access').setData(fc([]));};
function easeCamera(options){return new Promise(resolve=>{let finished=false;const finish=()=>{if(finished)return;finished=true;map.off('moveend',finish);resolve();};map.once('moveend',finish);map.easeTo(options);setTimeout(finish,(options.duration||0)+300);});}
async function setMapViewMode(entering){
 if(!map?.getLayer('city-buildings-3d')||viewSwitching||entering===is3D)return;
 viewSwitching=true;const transition=++viewTransitionId,button=$('view');button.disabled=true;button.classList.add('is-switching');map.getContainer?.()?.parentElement?.classList?.add('is-view-switching');stopRoutePreview(false);map.stop();++tileLoadId;clearTimeout(cityShadeTimer);displayShadeId++;displayShadeSignature='';is3D=entering;if(typeof stopDisplayShadows==='function')stopDisplayShadows();if(typeof ensureDisplayTerrain==='function')ensureDisplayTerrain();
 button.setAttribute('aria-pressed',String(is3D));button.textContent=is3D?'2D':'3D';$('city-screen-mask')?.setAttribute('hidden','');map.setLayoutProperty('city-buildings-3d','visibility',is3D?'visible':'none');map.setLayoutProperty('building-footprint','visibility',is3D?'none':'visible');map.setLayoutProperty('shade-fill','visibility','none');citySceneLayer?.setVisible(is3D);map.setMinZoom(is3D?12:cityManifest?MAP_MIN_ZOOM:12);map.setMaxPitch(60);if(is3D)map.touchPitch.enable();else map.touchPitch.disable();
 // The switch owns only the camera. Neither Three, tree tiles nor DEM can hold
 // the button disabled. Vector buildings already share the loaded basemap.
 try{await easeCamera({pitch:entering?55:0,zoom:map.getZoom(),duration:450,easing:value=>1-Math.pow(1-value,3),essential:true});}
 finally{if(transition===viewTransitionId){viewSwitching=false;button.disabled=false;button.classList.remove('is-switching');map.getContainer?.()?.parentElement?.classList?.remove('is-view-switching');if(!is3D){map.setMaxPitch(0);map.touchPitch.disable();}activeCityViewSignature='';updateModeUI();updateSunDirection();map.triggerRepaint();loadVisibleCityTiles({force:true}).catch(console.warn);}}
}
$('view').onclick=()=>setMapViewMode(!is3D);

$('basemap').onchange=()=>{if(!map?.getLayer('osm-raster'))return;const value=$('basemap').value;for(const [layer,selected]of [['osm-raster','osm'],['topo-raster','topo'],['aerial-raster','aerial']])map.setLayoutProperty(layer,'visibility',value===selected?'visible':'none');};
// 0.19: mobile steps, directions, live navigation and the 2D shade overlay.
Object.assign(strings.de,{shadeToggle:'Schatten auf der Karte',shadeZoom:'Zoom näher heran, um die Schatten zu sehen.'});Object.assign(strings.en,{shadeToggle:'Shade on the map',shadeZoom:'Zoom in to see the shade.'});
let shadeOverlayAuto=false;
function setShadeOverlay(on){
 shadeOverlay=on;const button=$('shade-toggle');if(button){button.setAttribute('aria-pressed',String(on));button.title=button.ariaLabel=t('shadeToggle');}
 if(!map?.getLayer?.('shade-fill'))return;
 if(!shadeOverlayActive()){stopDisplayShadows();map.setLayoutProperty('shade-fill','visibility','none');return;}
 if(map.getZoom()<14)showToast('shadeZoom');requestShade(false,{silent:true});
}
const setPreferenceBase=setPreference;setPreference=p=>{setPreferenceBase(p);if(p!=='balanced'&&!shadeOverlayAuto&&ready){shadeOverlayAuto=true;setShadeOverlay(true);}};
const setCustomBase=setCustom;setCustom=(i,p,label)=>{setCustomBase(i,p,label);if(isMobileMap())setMobileStep(points.every(Boolean)?2:1);};
const invalidateRouteSteps=invalidateRoute;invalidateRoute=()=>{invalidateRouteSteps();renderDirections();if(mobileStep===3)setMobileStep(points.every(Boolean)?2:1,{open:false});};
const onWorkerSteps=onWorker;onWorker=e=>{onWorkerSteps(e);const d=e.data;if(d.type!=='route'||d.id!==routeId)return;renderDirections();navigationRouteChanged();trackRoute();if(result&&!result.error){setMobileStep(3,{open:false});if(preference!=='balanced'&&!shadeOverlayAuto){shadeOverlayAuto=true;setShadeOverlay(true);}}};
const languageSteps=language;language=()=>{languageSteps();renderMobileSteps();renderDirections();setShadeOverlay(shadeOverlay);};
$('shade-toggle').onclick=()=>{setShadeOverlay(!shadeOverlay);if(shadeOverlay)track('shade','on');};
// Anonymous usage counts (scripts/usage.mjs): districts and feature names only, never places or people.
function trackRoute(){
 if(!usageAllowed())return;
 if(!result||result.error){if(result?.error)track('route_fail',result.error);return;}
 track('route',`${$('mobility-profile').value||'standard'}|${preference}`);
 const ends=points.filter(Boolean).map(p=>p.slice());ensurePlannerIndex().then(index=>{for(const p of ends){const id=districtAt(p,index.boundaries);if(id)track('route_area',id);}}).catch(()=>{});
}
const setExploreModeUsage=setExploreMode;setExploreMode=active=>{const changed=exploreMode!==active;setExploreModeUsage(active);if(changed)track('mode',active?'explore':'route');};
const setMapViewModeUsage=setMapViewMode;setMapViewMode=entering=>{if(entering&&!is3D)track('view3d','on');return setMapViewModeUsage(entering);};
let trackedTheme='';const applyThemeUsage=applyTheme;applyTheme=options=>{applyThemeUsage(options);if(exploreMode&&activeTheme!==trackedTheme){trackedTheme=activeTheme;track('layer',activeTheme);}};
const trackedPois=new Set();const applyPoiFilterUsage=applyPoiFilter;applyPoiFilter=options=>{applyPoiFilterUsage(options);for(const kind of selectedPois)if(!trackedPois.has(kind)){trackedPois.add(kind);track('layer','poi'+kind);}};
let lastViewCell='',viewTimer=0;
function trackView(){clearTimeout(viewTimer);viewTimer=setTimeout(()=>{if(!exploreMode||!map||map.getZoom()<12)return;const c=map.getCenter(),p=local([c.lng,c.lat]),cell=`${Math.floor(p[0]/1000)}_${Math.floor(p[1]/1000)}`;if(cell!==lastViewCell&&inPilot([c.lng,c.lat])){lastViewCell=cell;track('view',cell);}},3000);}
setupRouteExperience();setupPlanner();setupNavigation();updateImmediateSun();language();loadWeather();init();track('pv',exploreMode?'explore':'route');
// Optional read-only WebMCP integration.
if(document.modelContext?.registerTool){try{Promise.resolve(document.modelContext.registerTool({name:'read_walking_route',description:'Read the visible walking route and forecast context.',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:true},execute:()=>({mode:exploreMode?'explore':'route',date:$('date').value,time:$('clock').textContent,weather:selectedWeather(),route:result&&!result.error?{metres:result.length,minutes:result.minutes,source:result.source}:null})})).catch(()=>{});}catch{}}
// Production switches to server-only routing as soon as the Stage-2 server declares production readiness.
// Without a ready server, routes run in the browser on the same graph; readiness is rechecked at most once a minute.
let serverCheckedAt=0;
function checkServerReadiness(){if(serverRoutingReady||Date.now()-serverCheckedAt<60000)return;serverCheckedAt=Date.now();fetch(new URL('capabilities',PROFILE_V2_API),{credentials:'omit',headers:{Accept:'application/json'},signal:AbortSignal.timeout(5000)}).then(r=>r.ok?r.json():null).then(c=>{serverRoutingReady=c?.production_ready===true&&c?.deployment_stage==='production';}).catch(()=>{});}
if(!isRoutingPreview(location.hostname))checkServerReadiness();

// Included after the application declarations by the bundler.
function updateExperienceLanguage(){
 for(const [id,key] of [['mode-route','tipModeRoute'],['mode-explore','tipModeExplore'],['view','tipView']])if($(id)){$(id).title=tr(key);$(id).setAttribute('aria-label',$(id).title);}
 const previewNote=$('preview-routing-note');if(previewNote){previewNote.hidden=!isRoutingPreview(location.hostname);previewNote.textContent=tr('developmentPreviewRoutesMayDiffer');}
 const de=lang==='de',labels={openfree:'OpenFreeMap',osm:'Standard · OpenStreetMap',topo:(tr('topographic'))+' · OpenTopoMap',aerial:(tr('aerial'))+' · LGL BW'};
 for(const option of $('basemap')?.options||[])option.textContent=labels[option.value]||option.textContent;
 $('basemap')?.setAttribute('aria-label',tr('basemap'));$('map-credits')?.setAttribute('aria-label',tr('mapCredits'));const credits=$('credits-toggle');if(credits){const open=credits.getAttribute('aria-expanded')==='true',label=tr(open?'creditsHide':'creditsShow');credits.title=label;credits.setAttribute('aria-label',label);}
 for(const [id,label] of [['mode-route','Routing'],['mode-explore',tr('explore')],['explore-title',tr('exploreStuttgart')],['explore-description',tr('chooseMapLayersThenClick')],['explore-layers',tr('chooseMapLayers')],['explore-3d',is3D?(tr('switchTo2d')):(tr('viewTheCityIn3d'))]])if($(id))$(id).textContent=label;
 const button=$('explore-mode');if(button){button.textContent=exploreMode?'◎':'↦';button.title=exploreMode?(tr('exploreFreelySwitchToRoute')):(tr('routePlanningActiveSwitchTo'));button.setAttribute('aria-label',button.title);}
 if($('preview-controls'))$('preview-controls').hidden=!previewState;
 if($('preview-pause')){const button=$('preview-pause');button.innerHTML=playbackIcon(previewState?.paused?'play':'pause');button.title=previewState?.paused?(tr('resume')):(tr('pause'));button.setAttribute('aria-label',button.title);button.setAttribute('aria-pressed',String(Boolean(previewState?.paused)));}
 if($('preview-stop')){$('preview-stop').innerHTML=playbackIcon('stop');$('preview-stop').title=tr('stop');$('preview-stop').setAttribute('aria-label',tr('stop'));}
 document.querySelector('.preview-speeds')?.setAttribute('aria-label',tr('previewSpeed'));
 if($('route-preview'))$('route-preview').hidden=Boolean(previewState);
 if($('mobile-weather-toggle')){$('mobile-edit-route')?.setAttribute('aria-label',tr('editRoute'));$('mobile-weather-toggle').setAttribute('aria-label',tr('showWeatherAndDate'));$('map-pick-confirm').setAttribute('aria-label',tr('confirmPoint'));$('map-pick-cancel').setAttribute('aria-label',tr('cancel'));}
 if($('route-preview'))$('route-preview').textContent=previewState?(tr('stopPreview')):(tr('ndRoutePreview'));
 $('elevation-chart')?.setAttribute('aria-label',tr('elevationProfileMoveThePointer'));
}
function updateModeUI(){
 document.body.classList.toggle('is-exploring',exploreMode);document.body.classList.toggle('is-routing',!exploreMode);
 for(const [id,active] of [['mode-route',!exploreMode],['mode-explore',exploreMode]]){$(id)?.classList.toggle('selected',active);$(id)?.setAttribute('aria-pressed',String(active));}
 $('explore-panel').hidden=!exploreMode;$('journey-panel').hidden=exploreMode;$('layers-toggle').hidden=!exploreMode;if(!exploreMode){$('layers-panel').hidden=true;$('layers-toggle').setAttribute('aria-expanded','false');}
 if(map){applyTheme({reload:false});applyPoiFilter({reload:false});if(map.getLayer('shade-fill'))map.setLayoutProperty('shade-fill','visibility',shadeOverlayActive()&&Boolean(displayShadeFrame)?'visible':'none');}
 const heading=$('panel-toggle')?.lastElementChild;if(heading&&exploreMode)heading.textContent=tr('exploreStuttgart');else if(heading)heading.textContent=t('planRoute');
 updateExperienceLanguage();syncMobileDock();
}
function setExploreMode(active){
 if(exploreMode===active)return;exploreMode=active;stopRoutePreview(false);hideRoutePosition();finishPickMode(null);hideToast();featureRequestId++;featurePopup?.remove();featurePopup=null;++tileLoadId;++displayShadeId;displayShadeSignature='';clearTimeout(cityShadeTimer);
 stopDisplayShadows();if(map)map.doubleClickZoom.enable();clearFeatureSelection();
 const url=new URL(location.href);if(active)url.searchParams.set('mode','explore');else url.searchParams.delete('mode');history.replaceState(null,'',url);activeCityViewSignature='';updateModeUI();if(map)loadVisibleCityTiles().catch(console.warn);
}
function showRoutePosition(fraction){
 if(!map||!routeMeasureCache)return;fraction=Math.max(0,Math.min(1,fraction));
 const position=pointAlongRoute(routeMeasureCache,fraction);if(!position)return;
 if(!profileMarker){const element=document.createElement('div');element.className='profile-map-point';element.innerHTML='<svg viewBox="0 0 40 48" aria-hidden="true"><path d="M20 3L36 42L20 33L4 42Z" fill="#2376df" stroke="white" stroke-width="3" stroke-linejoin="round"/></svg>';profileMarker=new maplibregl.Marker({element,rotationAlignment:'map',pitchAlignment:'map'}).setLngLat(ll(position)).addTo(map);}else profileMarker.setLngLat(ll(position));
 const before=pointAlongRoute(routeMeasureCache,Math.max(0,fraction-8/(routeMeasureCache.total||1))),after=pointAlongRoute(routeMeasureCache,Math.min(1,fraction+8/(routeMeasureCache.total||1)));
 const bearing=Math.atan2(after[0]-before[0],after[1]-before[1])*180/Math.PI;profileMarker.setRotation(bearing);
 const cursor=$('elevation-cursor');cursor.removeAttribute('hidden');cursor.setAttribute('d',`M${fraction*300} 0V86`);
 const distance=fraction*(result?.profile?.at(-1)?.[0]||routeMeasureCache.total),height=profileAtDistance(result?.profile||[],distance);
 $('elevation-position').textContent=`${(distance/1000).toLocaleString(lang,{maximumFractionDigits:2})} km · ${height===null?'—':Math.round(height)+' m'}`;
 $('elevation-chart').setAttribute('aria-valuenow',String(Math.round(fraction*100)));
 $('elevation-chart').setAttribute('aria-valuetext',$('elevation-position').textContent);
}
function hideRoutePosition(){profileMarker?.remove();profileMarker=null;$('elevation-cursor')?.setAttribute('hidden','');if($('elevation-position'))$('elevation-position').textContent='';}

function stopRoutePreview(restore=true){
 ++previewRequestId;previewPreparing=false;if($('route-preview'))$('route-preview').disabled=!result?.coords?.length;
 if(!previewState)return;const camera=previewState.camera;previewState=null;cancelAnimationFrame(previewFrame);previewFrame=0;hideRoutePosition();updateExperienceLanguage();syncMobileDock();if(restore&&map)map.easeTo({...camera,duration:500});if(map&&cityManifest)loadVisibleCityTiles().catch(console.warn);
}
async function startRoutePreview(){
 if(previewState){stopRoutePreview();return;}if(previewPreparing||viewSwitching||!result?.coords?.length||!map)return;
 if(!is3D){await $('view').onclick();if(!is3D||viewSwitching)return;}
 const route=result,coordinates=densifyRoute(route.coords);routeMeasureCache=routeMeasure(coordinates);if(!routeMeasureCache.total)return;
 map.stop();
 const camera={center:[map.getCenter().lng,map.getCenter().lat],zoom:map.getZoom(),bearing:map.getBearing(),pitch:map.getPitch()},state={camera,last:performance.now(),started:performance.now(),distance:0,speed:1,paused:false,bearing:camera.bearing};previewState=state;if(isMobileMap()){$('sidebar-body').classList.remove('expanded');$('panel-toggle').setAttribute('aria-expanded','false');}syncMobileDock();document.querySelectorAll('[data-speed]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.speed==='1')));updateExperienceLanguage();
 // One camera owner follows the route with native terrain grounding. The
 // terrain remains enabled throughout replay; Atlas route heights stay separate.
 const tick=now=>{
  if(previewState!==state)return;const dt=Math.min(.1,Math.max(0,(now-state.last)/1000));state.last=now;const intro=Math.min(1,(now-state.started)/650);
  if(intro>=1&&!state.paused)state.distance=Math.min(routeMeasureCache.total,state.distance+dt*18*(state.speed||1));
  const f=state.distance/routeMeasureCache.total,point=pointAlongRoute(routeMeasureCache,f),ahead=pointAlongRoute(routeMeasureCache,Math.min(1,(state.distance+25)/routeMeasureCache.total));
  if(Math.hypot(ahead[0]-point[0],ahead[1]-point[1])>.01){const bearing=Math.atan2(ahead[0]-point[0],ahead[1]-point[1])*180/Math.PI;state.bearing=smoothBearing(state.bearing,(bearing+360)%360,1-Math.exp(-dt*4));}
  const target=ll(point),blend=1-Math.pow(1-intro,3);
  map.jumpTo({center:intro<1?camera.center.map((value,index)=>value+(target[index]-value)*blend):target,zoom:camera.zoom+(17-camera.zoom)*blend,pitch:camera.pitch+(50-camera.pitch)*blend,bearing:state.bearing});showRoutePosition(f);
  if(f>=1){stopRoutePreview(false);return;}previewFrame=requestAnimationFrame(tick);
 };previewFrame=requestAnimationFrame(tick);
}
function setupRouteExperience(){
 setupCompactTools();setupMobileExperience();
 $('explore-mode').onclick=()=>setExploreMode(!exploreMode);$('mode-route').onclick=()=>setExploreMode(false);$('mode-explore').onclick=()=>setExploreMode(true);$('route-preview').onclick=startRoutePreview;
 $('preview-pause').onclick=()=>{if(!previewState)return;previewState.paused=!previewState.paused;previewState.last=performance.now();updateExperienceLanguage();};
 $('preview-stop').onclick=()=>stopRoutePreview();
 document.querySelectorAll('[data-speed]').forEach(button=>button.onclick=()=>{if(!previewState)return;previewState.speed=+button.dataset.speed;document.querySelectorAll('[data-speed]').forEach(item=>item.setAttribute('aria-pressed',String(item===button)));});
 $('explore-layers').onclick=()=>{if(!exploreMode)setExploreMode(true);$('layers-panel').hidden=false;$('layers-toggle').setAttribute('aria-expanded','true');};$('explore-3d').onclick=()=>setMapViewMode(!is3D);
 document.addEventListener('visibilitychange',()=>{if(!document.hidden)loadWeather();});window.addEventListener('online',()=>loadWeather());

 const chart=$('elevation-chart');let hoverFrame=0,lastFraction=0;
 if(globalThis.ResizeObserver){let profileResize=0;new ResizeObserver(()=>{cancelAnimationFrame(profileResize);profileResize=requestAnimationFrame(()=>{if(result?.profile)renderProfile();});}).observe(chart);}
 chart.addEventListener('pointermove',event=>{const rect=chart.getBoundingClientRect();lastFraction=Math.max(0,Math.min(1,(event.clientX-rect.left)/rect.width));if(!hoverFrame)hoverFrame=requestAnimationFrame(()=>{hoverFrame=0;if(!previewState)showRoutePosition(lastFraction);});});
 chart.addEventListener('pointerdown',event=>{if(previewState)return;event.preventDefault();chart.focus();chart.setPointerCapture?.(event.pointerId);const rect=chart.getBoundingClientRect();lastFraction=Math.max(0,Math.min(1,(event.clientX-rect.left)/rect.width));showRoutePosition(lastFraction);});
 chart.addEventListener('pointerup',event=>{if(chart.hasPointerCapture?.(event.pointerId))chart.releasePointerCapture(event.pointerId);});
 chart.addEventListener('pointerleave',event=>{if(chart.hasPointerCapture?.(event.pointerId))return;cancelAnimationFrame(hoverFrame);hoverFrame=0;if(!previewState)hideRoutePosition();});
 chart.addEventListener('pointercancel',()=>{if(!previewState)hideRoutePosition();});
 chart.setAttribute('tabindex','0');chart.setAttribute('role','slider');chart.setAttribute('aria-valuemin','0');chart.setAttribute('aria-valuemax','100');chart.setAttribute('aria-valuenow','0');
 chart.addEventListener('keydown',event=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;event.preventDefault();lastFraction=event.key==='Home'?0:event.key==='End'?1:Math.max(0,Math.min(1,lastFraction+(event.key==='ArrowRight'?.02:-.02)));chart.setAttribute('aria-valuenow',String(Math.round(lastFraction*100)));showRoutePosition(lastFraction);});chart.addEventListener('blur',()=>{if(!previewState)hideRoutePosition();});
 document.addEventListener('visibilitychange',()=>{if(document.hidden)stopRoutePreview(false);});document.addEventListener('keydown',event=>{if(event.key==='Escape')stopRoutePreview();});
}
async function ensureCityScene(){
 if(citySceneLayer)return citySceneLayer;if(!cityScenePending)cityScenePending=(async()=>{THREE=await import('./vendor/three.mjs');citySceneLayer=createCitySceneLayer({origin:meta.origin,toLngLat:ll,dimensions:treeDimensions});map.addLayer(citySceneLayer,'route-halo');citySceneLayer.setSun(currentSun);return citySceneLayer;})().catch(error=>{cityScenePending=null;throw error;});return cityScenePending;
}
function playbackIcon(kind){return `<svg viewBox="0 0 24 24" aria-hidden="true">${kind==='pause'?'<path d="M8 5v14M16 5v14"/>':kind==='play'?'<path d="M8 5l11 7-11 7z"/>':'<rect x="6" y="6" width="12" height="12" rx="1"/>'}</svg>`;}
function installMapExperience(){
 for(const event of ['dragstart','zoomstart','rotatestart','pitchstart'])map.on(event,e=>{if(e.originalEvent)stopRoutePreview(false);});
 // Credits live in a reserved DOM slot, outside the map's control corners.
 const attribution=document.querySelector('.maplibregl-ctrl-attrib'),host=$('map-credits');
 if(attribution&&host){$('credits-content').append(attribution);$('credits-toggle').onclick=()=>{const content=$('credits-content'),open=content.hidden;content.hidden=!open;$('credits-toggle').setAttribute('aria-expanded',String(open));host.classList.toggle('is-open',open);updateExperienceLanguage();};const measure=()=>{const rect=host.getBoundingClientRect(),area=map.getContainer().parentElement;area.style.setProperty('--attribution-height',`${Math.ceil(rect.height)}px`);area.style.setProperty('--credits-clearance',`${Math.ceil(area.getBoundingClientRect().bottom-rect.top)}px`);};if(globalThis.ResizeObserver){const observer=new ResizeObserver(measure);observer.observe(host);observer.observe(map.getContainer().parentElement);}measure();}
 const tools=document.querySelector('.map-tools');if(tools&&globalThis.ResizeObserver){const measureTools=()=>{const area=tools.parentElement.getBoundingClientRect(),rect=tools.getBoundingClientRect();tools.parentElement.style.setProperty('--toolbar-end',`${Math.ceil(rect.bottom-area.top+8)}px`);};new ResizeObserver(measureTools).observe(tools);measureTools();}
 // The native opaque mask remains a fallback. The overlay uses camera-space
 // clipping so vertices behind the camera cannot obscure the whole viewport.
 const mask=$('city-screen-mask'),path=mask.querySelector('path');let rings=[],ringsPending=null,lastSignature='',ringsUseTerrain=false;
 const prepareRings=()=>{if(ringsPending)return;const terrain=displayTerrain,polygons=cityBoundary.geometry.coordinates.flatMap(polygon=>polygon);ringsPending=Promise.all(polygons.map(async ring=>{const heights=terrain?await terrain.sampleMany(ring):ring.map(()=>0);return ring.map((point,index)=>{const p=maplibregl.MercatorCoordinate.fromLngLat(point,heights[index]);return [p.x,p.y,p.z];});})).then(next=>{rings=next;ringsUseTerrain=Boolean(terrain);lastSignature='';map.triggerRepaint();}).catch(error=>console.warn('Boundary projection postponed:',error)).finally(()=>ringsPending=null);};
 if(cityBoundary)prepareRings();
 if(cityBoundary)map.addLayer({id:'boundary-projector',type:'custom',renderingMode:'3d',render(gl,args){
  if(!is3D){mask.setAttribute('hidden','');lastSignature='';return;}if(displayTerrain&&!ringsUseTerrain){prepareRings();mask.setAttribute('hidden','');return;}const matrix=args.defaultProjectionData?.mainMatrix;if(!matrix||matrix.length!==16){mask.setAttribute('hidden','');return;}
  if(!rings.length){prepareRings();mask.setAttribute('hidden','');return;}
  const canvas=map.getCanvas(),width=canvas.clientWidth,height=canvas.clientHeight;
  const signature=width+'|'+height+'|'+Array.from(matrix).join(',');if(signature===lastSignature)return;lastSignature=signature;
  const inside=projectBoundaryPath(rings,matrix,width,height),centre=map.getCenter(),screenCentre=map.project(centre),projectedRings=inside.split('Z').filter(Boolean).map(part=>[...part.matchAll(/[ML]([\d.-]+) ([\d.-]+)/g)].map(match=>[+match[1],+match[2]]));
  // Fail open to the native GPU-clipped mask if an inconsistent matrix/terrain
  // state would cover the actual city centre. A map must never go all-grey here.
  const centreVisible=projectedRings.reduce((hit,ring)=>hit!==pointInRing([screenCentre.x,screenCentre.y],ring),false);
  if(inPilot([centre.lng,centre.lat])&&!centreVisible){mask.setAttribute('hidden','');return;}
  mask.setAttribute('viewBox',`0 0 ${width} ${height}`);path.setAttribute('d',`M0 0H${width}V${height}H0Z`+inside);mask.removeAttribute('hidden');
 }});
 else mask.setAttribute('hidden','');
}

function setupCompactTools(){
 const panel=$('layers-panel');
 document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!panel.hidden){panel.hidden=true;$('layers-toggle').setAttribute('aria-expanded','false');$('layers-toggle').focus();}});
 document.addEventListener('pointerdown',event=>{if(!panel.hidden&&!panel.contains(event.target)&&!$('layers-toggle').contains(event.target)){panel.hidden=true;$('layers-toggle').setAttribute('aria-expanded','false');}});
}

