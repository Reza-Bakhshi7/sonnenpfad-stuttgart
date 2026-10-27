// API 0.2 metadata describes oriented route pieces. Atlas heights are interpolated,
// not resampled from terrain; unknown attributes must remain unknown.
export const ROUTING_API='https://138.2.184.1';
export function usesServerRouting(options={}) {
 return options.preference==='balanced' && (!options.mobilityProfile||options.mobilityProfile==='standard') && !options.gentle && (!options.slopeMode||options.slopeMode==='none') && !['avoidSteps','avoidEscalators','avoidPoorSurface','avoidWheelchairNo','maxSlope'].some(key=>options[key]);
}
export async function requestServerRoute(start,end,{signal,fetchImpl=fetch}={}) {
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
export function adaptServerRoute(data,toLocal,shadeFractions=null) {
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
