import {tr} from './i18n.mjs';
// District planner in explore mode: district boundaries, multi-selection and the slope filter
// on the thesis working network (dist/city/planner, scripts/export_planner_data.py).
export const PLANNER_SLOPE_MAX=30;
export function plannerFilterActive(state){return state.districts.size>0||state.slope;}
// Same rule as the map filter below: |slope| above the threshold, stairs and missing values only on request.
export function plannerMatches(p,state){
 if(state.districts.size&&!state.districts.has(p.d))return false;
 if(p.steps)return state.stairs;
 if(!state.slope)return true;
 return p.sl<0?state.missing:p.sl>state.min;
}
export function plannerMapFilter(state){
 const district=state.districts.size?['in',['get','d'],['literal',[...state.districts]]]:true;
 const value=state.slope?['case',['<',['get','sl'],0],state.missing,['>',['get','sl'],state.min]]:true;
 return ['all',district,['case',['==',['get','steps'],1],state.stairs,value]];
}
export function plannerSummary(features,state){
 const perDistrict=new Map();let pieces=0,metres=0,missing=0;
 for(const item of features){const p=item.properties;if(!plannerMatches(p,state))continue;pieces++;metres+=p.m;if(state.slope&&!p.steps&&p.sl<0)missing++;perDistrict.set(p.d,(perDistrict.get(p.d)||0)+1);}
 return {pieces,metres,missing,perDistrict};
}

let plannerIndex=null,plannerIndexPending=null,plannerFeatures=[];
const plannerFiles=new Map();
const plannerState={districts:new Set(),slope:false,min:5,missing:true,stairs:false};
let plannerLoadId=0,plannerInitialFit=true;

function plannerText(key){const de=lang==='de',text={
 title:tr('checkDistricts'),all:tr('allDistricts'),districts:tr('districts'),
 slope:tr('onlyGradientAbove'),missing:tr('showSectionsWithoutAValue'),
 stairs:tr('showStairs'),reset:tr('reset'),loading:tr('loadingData'),
 none:tr('noSectionMatchesThisSelection'),
 selectAll:tr('all'),clear:tr('none'),source:tr('basisThesisWorkingNetworkWays'),
 failed:tr('districtDataCouldNotBe')}[key];return text;}

async function ensurePlannerIndex(){
 if(plannerIndex)return plannerIndex;
 plannerIndexPending??=fetch(new URL('planner/districts.json',cityBaseURL)).then(r=>{if(!r.ok)throw Error('planner-index');return r.json();}).then(value=>{if(value.version!==1||value.districts?.length!==23)throw Error('planner-contract');plannerIndex=value;return value;}).catch(error=>{plannerIndexPending=null;throw error;});
 return plannerIndexPending;
}
async function plannerDistrictFeatures(district){
 if(plannerFiles.has(district.id))return plannerFiles.get(district.id);
 const job=fetch(new URL('planner/'+district.file,cityBaseURL)).then(r=>{if(!r.ok)throw Error(district.file);return r.json();}).then(data=>data.lines.map((coordinates,i)=>{const v=data.v[i],k=data.k[i];return feature('LineString',coordinates,{sl:v[0]??-1,su:v[1]??0,ss:v[2]??-1,sw:v[3]??-1,us:v[4]??-999,uw:v[5]??-999,n:v[6]??-1,w:v[7]??-1,steps:k&1?1:0,st:(k&2?1:0)|(k&4?2:0),d:district.id,dn:district.name,m:data.m[i],nm:data.nm[i]||'',a:data.a[i]||'',planner:1});}));
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

function plannerSummaryLabel(){
 if(!plannerIndex||!plannerState.districts.size)return plannerText('all');
 const names=plannerIndex.districts.filter(d=>plannerState.districts.has(d.id)).map(d=>d.name);
 return names.length<=3?names.join(', '):`${names.length} ${plannerText('districts')}: ${names.slice(0,2).join(', ')} …`;
}
function renderPlannerControls(){
 const box=$('planner');if(!box)return;box.hidden=!exploreMode;
 $('planner-title').textContent=plannerText('title');$('district-summary').textContent=plannerSummaryLabel();
 $('slope-filter-label').textContent=plannerText('slope');$('planner-missing-label').textContent=plannerText('missing');$('planner-stairs-label').textContent=plannerText('stairs');
 $('planner-reset').textContent=plannerText('reset');$('district-all').textContent=plannerText('selectAll');$('district-none').textContent=plannerText('clear');$('planner-source').textContent=plannerText('source');
 $('slope-filter').checked=plannerState.slope;$('slope-min').value=String(plannerState.min);$('slope-range').value=String(plannerState.min);$('planner-missing').checked=plannerState.missing;$('planner-stairs').checked=plannerState.stairs;
 for(const id of ['slope-min','slope-range','planner-missing'])$(id).disabled=!plannerState.slope;
 $('planner-reset').hidden=!plannerFilterActive(plannerState)&&!plannerState.stairs;
 const chip=$('planner-chip');if(chip){chip.hidden=!exploreMode||!plannerFilterActive(plannerState);$('planner-chip-open').textContent=[plannerState.districts.size?plannerSummaryLabel():plannerText('all'),plannerState.slope?(tr('gradient4'))+plannerState.min.toLocaleString(lang)+' %':null].filter(Boolean).join(' · ');$('planner-chip-clear').setAttribute('aria-label',plannerText('reset'));}
 for(const input of document.querySelectorAll('#district-options input'))input.checked=plannerState.districts.has(+input.value);
}
function renderPlannerResult(text,empty=false){const box=$('planner-result');box.textContent=text;box.classList.toggle('is-empty',empty);box.hidden=!text;}

function syncPlannerURL(){
 const query=new URLSearchParams(location.search);
 if(exploreMode&&plannerState.districts.size)query.set('bezirke',[...plannerState.districts].sort((a,b)=>a-b).join(','));else query.delete('bezirke');
 if(exploreMode&&plannerState.slope)query.set('steigungAb',String(plannerState.min));else query.delete('steigungAb');
 history.replaceState(null,'',location.pathname+(query.size?'?'+query:''));
}

async function applyPlanner({fit=false}={}){
 renderPlannerControls();if(!map?.getLayer?.('route-halo'))return;
 let index;try{index=await ensurePlannerIndex();}catch(error){console.warn(error);renderPlannerResult(exploreMode?plannerText('failed'):'',true);return;}
 installPlannerLayers(index);
 const active=exploreMode&&plannerFilterActive(plannerState),visible=exploreMode?'visible':'none';
 for(const id of ['district-line','district-label'])map.setLayoutProperty(id,'visibility',visible);
 map.setLayoutProperty('district-selected','visibility',exploreMode&&plannerState.districts.size?'visible':'none');map.setFilter('district-selected',['in',['get','id'],['literal',[...plannerState.districts]]]);
 map.setLayoutProperty('district-dim','visibility',exploreMode&&plannerState.districts.size?'visible':'none');map.setFilter('district-dim',['!',['in',['get','id'],['literal',[...plannerState.districts]]]]);
 // The planner layer replaces the ordinary network while a selection or filter is active.
 map.setLayoutProperty('planner-line','visibility',active?'visible':'none');
 for(const id of ['network-line','stairs-halo','stairs-treads','slope-arrows'])if(map.getLayer(id)&&active)map.setLayoutProperty(id,'visibility','none');
 if(!active){if(map.getLayer('network-line'))map.setLayoutProperty('network-line','visibility',visible);for(const id of ['stairs-halo','stairs-treads','slope-arrows'])if(map.getLayer(id))map.setLayoutProperty(id,'visibility',exploreMode&&activeTheme==='slope'?'visible':'none');renderPlannerResult('');syncPlannerURL();return;}
 const definition=THEME_DEFS[activeTheme]||THEME_DEFS.slope;map.setPaintProperty('planner-line','line-color',['case',['==',['get','steps'],1],'#4a4f54',definition.expression]);map.setFilter('planner-line',plannerMapFilter(plannerState));
 if(plannerInitialFit&&plannerState.districts.size){fit=true;plannerInitialFit=false;}
 const wanted=index.districts.filter(d=>!plannerState.districts.size||plannerState.districts.has(d.id)),id=++plannerLoadId;
 if(fit&&plannerState.districts.size){const b=wanted.reduce((box,d)=>[Math.min(box[0],d.bbox[0]),Math.min(box[1],d.bbox[1]),Math.max(box[2],d.bbox[2]),Math.max(box[3],d.bbox[3])],[180,90,-180,-90]);map.fitBounds([[b[0],b[1]],[b[2],b[3]]],{padding:isMobileMap()?{top:70,bottom:Math.min(innerHeight*.45,320),left:24,right:24}:{top:150,bottom:190,left:60,right:90},duration:500});}
 if(wanted.some(d=>!plannerFiles.has(d.id)))renderPlannerResult(plannerText('loading'));
 let loaded;try{loaded=(await Promise.all(wanted.map(plannerDistrictFeatures))).flat();}catch(error){console.warn(error);if(id===plannerLoadId)renderPlannerResult(plannerText('failed'),true);return;}
 if(id!==plannerLoadId)return;
 if(loaded!==plannerFeatures){plannerFeatures=loaded;map.getSource('planner').setData(fc(loaded));}
 const summary=plannerSummary(loaded,plannerState),de=lang==='de',km=(summary.metres/1000).toLocaleString(lang,{maximumFractionDigits:1});
 if(!summary.pieces)renderPlannerResult(plannerText('none'),true);
 else{const parts=wanted.length>1&&wanted.length<=4?' ('+wanted.map(d=>`${d.name} ${summary.perDistrict.get(d.id)||0}`).join(', ')+')':'';const gaps=summary.missing?(tr('plannerMissing',{count:summary.missing})):'';renderPlannerResult(tr('plannerSections',{count:summary.pieces.toLocaleString(lang),km,parts,gaps}));}
 syncPlannerURL();
}

function setupPlanner(){
 const box=$('planner');if(!box)return;
 const query=new URLSearchParams(location.search);
 for(const value of (query.get('bezirke')||'').split(',').map(Number))if(Number.isInteger(value)&&value>0)plannerState.districts.add(value);
 const min=Number(query.get('steigungAb'));if(query.has('steigungAb')&&Number.isFinite(min)){plannerState.slope=true;plannerState.min=Math.min(PLANNER_SLOPE_MAX,Math.max(0,min));}
 ensurePlannerIndex().then(index=>{const holder=$('district-options');holder.replaceChildren();for(const d of index.districts){const label=document.createElement('label');label.className='district-option';label.innerHTML='<input type="checkbox"><span></span>';label.querySelector('input').value=d.id;label.querySelector('span').textContent=d.name;label.querySelector('input').onchange=event=>{event.target.checked?plannerState.districts.add(d.id):plannerState.districts.delete(d.id);applyPlanner({fit:true});};holder.append(label);}for(const id of [...plannerState.districts])if(!index.districts.some(d=>d.id===id))plannerState.districts.delete(id);renderPlannerControls();}).catch(console.warn);
 const setMin=value=>{const number=Math.min(PLANNER_SLOPE_MAX,Math.max(0,Number(value)));if(!Number.isFinite(number))return;plannerState.min=Math.round(number*10)/10;applyPlanner();};
 $('slope-filter').onchange=event=>{plannerState.slope=event.target.checked;applyPlanner();};
 $('slope-min').onchange=event=>setMin(event.target.value);$('slope-range').oninput=event=>setMin(event.target.value);
 $('planner-missing').onchange=event=>{plannerState.missing=event.target.checked;applyPlanner();};
 $('planner-stairs').onchange=event=>{plannerState.stairs=event.target.checked;applyPlanner();};
 $('district-all').onclick=()=>{for(const d of plannerIndex?.districts||[])plannerState.districts.add(d.id);applyPlanner({fit:true});};
 $('district-none').onclick=()=>{plannerState.districts.clear();applyPlanner();};
 $('planner-chip-open').onclick=()=>{$('layers-panel').hidden=false;$('layers-toggle').setAttribute('aria-expanded','true');};
 $('planner-chip-clear').onclick=()=>$('planner-reset').click();
 $('planner-reset').onclick=()=>{plannerState.districts.clear();Object.assign(plannerState,{slope:false,min:5,missing:true,stairs:false});applyPlanner();};
 renderPlannerControls();
}
