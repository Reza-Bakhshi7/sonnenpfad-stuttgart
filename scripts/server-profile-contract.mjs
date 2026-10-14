import {resolvedOptions,relaxationTiers,edgeAllowed,edgeCostMultiplier} from './core.mjs';

// API 0.3 preparation. This is deliberately not enabled against API 0.2.
export const PROFILE_CONTRACT_VERSION=1;
export function buildProfileRequest(start,end,options,{iso,leafOn=true}={}) {
 if(![start,end].every(p=>Array.isArray(p)&&p.length===2&&p.every(Number.isFinite)))throw Error('Invalid endpoints');
 const preference=options.preference||'balanced',mobilityProfile=options.mobilityProfile||'standard';
 if(!['balanced','shade','sun'].includes(preference)||!['standard','wheelchair','powerWheelchair','walkingAid','vision','stroller','custom'].includes(mobilityProfile))throw Error('Unsupported profile');
 if(['shade','sun'].includes(preference)&&(!iso||!Number.isFinite(Date.parse(iso))))throw Error('Sun/shade routing requires a time');
 const resolved=resolvedOptions({...options,preference,mobilityProfile});
 return {contract_version:PROFILE_CONTRACT_VERSION,start,end,max_snap_m:50,include_segments:true,preference,mobility_profile:mobilityProfile,options:resolved,time:iso||null,timezone:'Europe/Berlin',leaf_on:leafOn,tiers:relaxationTiers(resolved).map(tier=>({options:tier.options,relaxed_criteria:tier.relaxed}))};
}
export function supportsProfileContract(capabilities,request) {
 return capabilities?.profile_contract_version===PROFILE_CONTRACT_VERSION&&capabilities?.topology==='audited-osm-nodes'&&capabilities?.segment_metadata_version===1&&capabilities.preferences?.includes(request.preference)&&capabilities.mobility_profiles?.includes(request.mobility_profile)&&(!['shade','sun'].includes(request.preference)||capabilities.shadow_model==='geometric-time-aware');
}
export function directedProfileCosts(piece,options,shadeFraction=null) {
 if(!Number.isFinite(piece.l)||piece.l<=0)throw Error('Invalid edge length');
 const resolved=resolvedOptions(options);
 if(['shade','sun'].includes(resolved.preference)&&(!Number.isFinite(shadeFraction)||shadeFraction<0||shadeFraction>1))throw Error('Shadow fraction is required; unknown is not zero');
 const cost=forward=>edgeAllowed(piece,resolved,forward)?piece.l*edgeCostMultiplier(piece,resolved,shadeFraction||0,forward):-1;
 return {cost:piece.dir===-1?-1:cost(true),reverse_cost:piece.dir===1?-1:cost(false)};
}
