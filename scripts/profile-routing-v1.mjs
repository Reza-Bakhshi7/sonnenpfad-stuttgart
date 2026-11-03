// Prepared adapter only. It is deliberately absent from the application bundle.
import {buildProfileRequest} from './server-profile-contract.mjs';
import {adaptServerRoute} from './server-routing.mjs';

const same=(a,b)=>{
 if(a===b)return true;
 if(!a||!b||typeof a!=='object'||typeof b!=='object'||Array.isArray(a)!==Array.isArray(b))return false;
 const keys=Object.keys(a);return keys.length===Object.keys(b).length&&keys.every(key=>Object.hasOwn(b,key)&&same(a[key],b[key]));
};
const canonical=options=>{const value={...options};delete value.solarWeight;return value;};

export function buildProfileV1Request(start,end,options,{allowRelaxation=false,...context}={}){
 if(typeof allowRelaxation!=='boolean')throw Error('Relaxation requires an explicit boolean');
 return {...buildProfileRequest(start,end,options,context),allow_relaxation:allowRelaxation};
}

export function supportsProfileV1(capabilities,request,{preview=false}={}){
 return capabilities?.profile_contract_version===1&&capabilities.segment_metadata_version===1&&
  capabilities.topology==='audited-osm-nodes'&&capabilities.preferences?.includes(request.preference)&&
  capabilities.mobility_profiles?.includes(request.mobility_profile)&&capabilities.strict_by_default===true&&
  (!request.allow_relaxation||capabilities.explicit_relaxation===true)&&
  (capabilities.production_ready===true||(preview===true&&capabilities.deployment_stage==='local-preview'))&&
  (request.preference==='balanced'||capabilities.shadow_model==='geometric-time-aware');
}

export function adaptProfileV1Route(data,toLocal,request){
 const p=data?.properties;
 if(p?.profile_contract_version!==1||p.segment_metadata_version!==1||p.requested_profile!==request.mobility_profile||p.preference!==request.preference)throw Error('Mismatched profile response');
 const level=p.fallback_level,tier=request.tiers[level];
 if(!Number.isInteger(level)||level<0||!tier||(level&&!request.allow_relaxation)||
  !same(p.relaxed_criteria,tier.relaxed_criteria)||!same(p.effective_options,canonical(tier.options)))throw Error('Unpermitted effective profile');
 // The legacy validator checks every oriented piece, connection and route line.
 // V1 treats non-numeric/invalid source elevations as unknown, just as Python.
 const normalized={...data,properties:{...p,segments:p.segments?.map(segment=>{
  const a={...segment.atlas_attributes};for(const key of ['elev_start','elev_end'])if(!Number.isFinite(a[key])||a[key]<100)a[key]=null;
  return {...segment,atlas_attributes:a};
 })}};
 const route=adaptServerRoute(normalized,toLocal);if(route.error)return route;
 // The server computes the shade share with the browser's shadow model; sun/shade routes must report it.
 if((p.shade!==null&&!(Number.isFinite(p.shade)&&p.shade>=0&&p.shade<=1))||(request.preference!=='balanced'&&p.shade===null))throw Error('Invalid profile exposure');
 const options=p.effective_options,model=p.time_model;
 if(!same(model,{speedMpm:options.speedMpm,ascentMinutesPer10m:options.ascentMinutesPer10m,estimated:true}))throw Error('Invalid profile time model');
 const known=route.profile.length>0;
 for(const key of ['ascent_m','descent_m'])if(known?(!Number.isFinite(p[key])||p[key]<0):p[key]!==null)throw Error('Invalid profile elevations');
 if(known?(!Number.isInteger(p.estimated_minutes)||p.estimated_minutes<0):p.estimated_minutes!==null)throw Error('Invalid profile duration');
 if(!Array.isArray(p.elevation_profile)||p.elevation_profile.length!==route.profile.length||p.elevation_profile.some((point,i)=>!Array.isArray(point)||point.length!==2||point.some((value,j)=>!Number.isFinite(value)||Math.abs(value-route.profile[i][j])>.03)))throw Error('Inconsistent elevation profile');
 const coverage=p.attribute_coverage;
 if(!coverage||['surface','width','wheelchair','elevation'].some(key=>!Number.isFinite(coverage[key])||coverage[key]<0||coverage[key]>1+1e-9))throw Error('Invalid profile coverage');
 Object.assign(route.quality,{surfaceKnown:coverage.surface,widthKnown:coverage.width,wheelchairKnown:coverage.wheelchair,slopeKnown:coverage.elevation});
 // Pieces that break the requested profile (after relaxation) are drawn in orange.
 const warnings=(p.segments||[]).filter(segment=>Array.isArray(segment.profile_violations)&&segment.profile_violations.length)
  .map(segment=>({coords:segment.geometry.coordinates.map(toLocal),reasons:segment.profile_violations}));
 return {...route,source:'server-profile-v1',shade:p.shade,warnings,snapWidened:p.snap_widened===true,minutes:p.estimated_minutes,ascent:p.ascent_m,descent:p.descent_m,
  profile:p.elevation_profile,timeModel:model,criteria:options,effectiveOptions:options,
  requestedProfile:p.requested_profile,relaxedCriteria:p.relaxed_criteria,fallbackLevel:level};
}

export async function requestProfileV1(start,end,options,{baseURL,preview=false,capabilities=null,signal,fetchImpl=fetch,...context}={}){
 if(!baseURL)throw Error('An explicit profile API URL is required');
 const base=new URL(baseURL.endsWith('/')?baseURL:baseURL+'/');
 if(!['http:','https:'].includes(base.protocol))throw Error('Unsupported profile API URL');
 const request=buildProfileV1Request(start,end,options,context);
 if(!capabilities){const response=await fetchImpl(new URL('capabilities',base),{signal,credentials:'omit',headers:{Accept:'application/json'}});if(!response.ok)throw Error('Profile capabilities unavailable');capabilities=await response.json();}
 if(!supportsProfileV1(capabilities,request,{preview}))throw Error('Profile API is not accepted for this request');
 const response=await fetchImpl(new URL('v1/route',base),{method:'POST',signal,credentials:'omit',headers:{Accept:'application/json','Content-Type':'application/json'},body:JSON.stringify(request)});
 const data=await response.json();if(!response.ok){const error=new Error('Profile route unavailable');error.code=data?.error;error.status=response.status;error.routeError=({candidate_search_limited:'serverSearchLimited',search_budget_exceeded:'serverSearchLimited',no_matching_snap:'serverOutside',same_point:'same',busy:'serverBusy',no_route:request.mobility_profile==='standard'?'disconnected':'profileBlocked'})[data?.error]||'serverUnavailable';throw error;}
 return {data,request};
}
