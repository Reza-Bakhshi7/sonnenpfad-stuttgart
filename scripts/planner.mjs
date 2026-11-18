import {tr} from './i18n.mjs';
// Analysis in explore mode: district selection, combined attribute filters (AND), result figures and
// export, on the thesis working network (dist/city/planner, scripts/export_planner_data.py).
export const PLANNER_SLOPE_MAX=30;
// Defaults for a newly added numeric filter (the planner changes them freely).
const NUMERIC_DEFAULTS={slope:5,shadeSummer:20,shadeWinter:20,utciSummer:32,utciWinter:-5,noise:65,wind:.5,width:1.5,length:50};

// ---- Pure model: shared by the map expression, the counts and the tests --------------------------
export function analysisActive(state){return state.districts.size>0||state.filters.length>0;}
function numericTest(value,filter){
 if(filter.op==='gt')return value>filter.value;
 if(filter.op==='lt')return value<filter.value;
 if(filter.op==='eq')return Math.abs(value-filter.value)<1e-9;
 const low=Math.min(filter.value,filter.value2),high=Math.max(filter.value,filter.value2);return value>=low&&value<=high;
}
// Missing values are their own case: a filter keeps them only when `missing` is ticked.
export function filterMatches(p,filter){
 if(filter.type==='number'){const value=p['x_'+filter.key];return value===undefined||value===null?filter.missing:numericTest(value,filter);}
 const code=p['c_'+filter.key];if(code===undefined||code===null)return filter.missing;
 return filter.mode==='exclude'?!filter.codes.has(code):filter.codes.has(code);
}
export function analysisMatches(p,state){
 if(state.districts.size&&!state.districts.has(p.d))return false;
 return state.filters.every(filter=>filterMatches(p,filter));
}
export function analysisMapFilter(state){
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
export function analysisSummary(features,state){
 const perDistrict=new Map();let pieces=0,metres=0,areaMetres=0,missing=0;
 for(const item of features){
  const p=item.properties;if(state.districts.size&&!state.districts.has(p.d))continue;areaMetres+=p.m;
  if(!analysisMatches(p,state))continue;pieces++;metres+=p.m;perDistrict.set(p.d,(perDistrict.get(p.d)||0)+1);
  if(state.filters.some(filter=>filter.missing&&(filter.type==='number'?p['x_'+filter.key]==null:p['c_'+filter.key]==null)))missing++;
 }
 return {pieces,metres,areaMetres,share:areaMetres?metres/areaMetres:0,missing,perDistrict};
}
// Compact, URL-safe form of the analysis (shared links reproduce it exactly).
export function encodeAnalysis(state){
 if(!state.filters.length)return '';
 return state.filters.map(f=>f.type==='number'?[f.key,f.op,f.value,f.op==='between'?f.value2:'',f.missing?1:0].join('~'):[f.key,f.mode,[...f.codes].join('.'),f.missing?1:0].join('~')).join('_');
}
export function decodeAnalysis(text,schema){
 const filters=[];
 for(const part of String(text||'').split('_').filter(Boolean)){
  const [key,a,b,c,d]=part.split('~'),definition=schema.find(item=>item.key===key);if(!definition)continue;
  if(definition.type==='number'&&['gt','lt','eq','between'].includes(a)&&Number.isFinite(+b))filters.push({key,type:'number',op:a,value:+b,value2:a==='between'&&Number.isFinite(+c)?+c:undefined,missing:d==='1'});
  else if(definition.type==='category'&&['include','exclude'].includes(a)){const codes=new Set(String(b).split('.').filter(code=>definition.categories.some(item=>item.code===code)));filters.push({key,type:'category',mode:a,codes,missing:c==='1'});}
 }
 return filters;
}
// Export rows: one per matching section, stable column names, geometry as WKT in EPSG:4326.
export function exportColumns(schema){
 const unit={'%':'pct','°C':'c',dB:'db',m:'m','':''};
 return ['segment_id','atlas_id','district_id','district','name',...schema.map(a=>a.type==='number'?[a.key.replace(/[A-Z]/g,c=>'_'+c.toLowerCase()),unit[a.unit]].filter(Boolean).join('_'):a.key.replace(/[A-Z]/g,c=>'_'+c.toLowerCase())),'geometry_wkt','crs'];
}
export function exportRow(p,coordinates,schema){
 return [p.sid,p.a,p.d,p.dn,p.nm,...schema.map(a=>a.type==='number'?(a.key==='length'?p.m:p['x_'+a.key]??''):p['c_'+a.key]??''),'LINESTRING('+coordinates.map(c=>c[0]+' '+c[1]).join(', ')+')','EPSG:4326'];
}
export function csvText(rows){
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
 if(!plannerIndex||!lastSummary?.pieces)return;
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
 const attribute=plannerIndex?.attributes.find(a=>a.key===key);if(!attribute)return;
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
  for(const d of index.districts){const item=document.createElement('label');item.className='district-option';item.innerHTML='<input type="checkbox"><span></span>';item.querySelector('input').value=d.id;item.querySelector('span').textContent=d.name;item.querySelector('input').onchange=event=>{event.target.checked?plannerState.districts.add(d.id):plannerState.districts.delete(d.id);applyPlanner({fit:true});};holder.append(item);}
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
