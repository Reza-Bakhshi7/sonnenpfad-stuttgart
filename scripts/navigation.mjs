// Turn-by-turn directions and live navigation along the calculated route (local metric coordinates).
const bearingOf=(a,b)=>(Math.atan2(b[0]-a[0],b[1]-a[1])*180/Math.PI+360)%360;
const turnAngle=(incoming,outgoing)=>((outgoing-incoming+540)%360)-180;
function pointAt(measure,distance){
 const {coords,cumulative,total}=measure,d=Math.max(0,Math.min(total,distance));
 let i=1;while(i<cumulative.length-1&&cumulative[i]<d)i++;
 const span=cumulative[i]-cumulative[i-1]||1,f=(d-cumulative[i-1])/span,a=coords[i-1],b=coords[i];
 return [a[0]+(b[0]-a[0])*f,a[1]+(b[1]-a[1])*f];
}
export function routeBearingAt(measure,distance,look=12){return bearingOf(pointAt(measure,distance-look/2),pointAt(measure,distance+look));}
export function turnKind(angle){
 const size=Math.abs(angle),side=angle>0?'Right':'Left';
 if(size<35)return null;if(size<60)return 'slight'+side;if(size<135)return side.toLowerCase();if(size<165)return 'sharp'+side;return 'uturn';
}
// One maneuver per real change of direction; vertices of a gently curving path never count.
export function routeManeuvers(coords,{look=15,merge=12}={}){
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
export function locateOnRoute(measure,p,hint=0){
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
export function maneuverText(kind,language='de'){
 const de=language==='de';
 return ({left:de?'Links abbiegen':'Turn left',right:de?'Rechts abbiegen':'Turn right',slightLeft:de?'Leicht links halten':'Keep slightly left',slightRight:de?'Leicht rechts halten':'Keep slightly right',
  sharpLeft:de?'Scharf links abbiegen':'Turn sharp left',sharpRight:de?'Scharf rechts abbiegen':'Turn sharp right',uturn:de?'Wenden':'Turn around',arrive:de?'Ziel erreichen':'Arrive at destination',straight:de?'Geradeaus weiter':'Continue straight'})[kind];
}
function formatMetres(metres){return metres>=1000?(metres/1000).toLocaleString(lang,{maximumFractionDigits:1})+' km':Math.max(5,Math.round(metres/5)*5)+' m';}

function renderDirections(){
 const box=$('directions'),list=$('directions-list');if(!box||!list)return;
 list.replaceChildren();if(!result?.coords?.length||result.error){box.hidden=true;return;}
 const maneuvers=routeManeuvers(result.coords);let previous=0;
 const head=document.createElement('li');head.innerHTML='<i>↑</i><span></span>';head.querySelector('span').textContent=lang==='de'?'Losgehen':'Start walking';list.append(head);
 for(const item of maneuvers){const row=document.createElement('li');row.innerHTML='<i></i><span></span><small></small>';row.querySelector('i').textContent=TURN_ARROWS[item.kind];row.querySelector('span').textContent=maneuverText(item.kind,lang);row.querySelector('small').textContent=(lang==='de'?'nach ':'after ')+formatMetres(item.at-previous);previous=item.at;list.append(row);}
 $('directions-title').textContent=lang==='de'?`Wegbeschreibung · ${maneuvers.length} Schritte`:`Directions · ${maneuvers.length} steps`;box.hidden=false;
 $('navigate').hidden=!navigator.geolocation;$('navigate').textContent=lang==='de'?'▶ Navigation starten':'▶ Start navigation';
 const mobile=$('mobile-navigate');if(mobile){mobile.hidden=!navigator.geolocation;mobile.textContent=lang==='de'?'▶ Los':'▶ Go';}
}

let nav=null;
function navigationMarker(){const el=document.createElement('div');el.className='nav-position';el.innerHTML='<span></span>';return new maplibregl.Marker({element:el,rotationAlignment:'map'});}
function setNavBanner({arrow='↑',instruction='',remaining='',reroute=false}){$('nav-turn').textContent=arrow;$('nav-instruction').textContent=instruction;$('nav-remaining').textContent=remaining;$('nav-reroute').hidden=!reroute;}
function startNavigation(){
 if(!result?.coords?.length||result.error||!navigator.geolocation||!map)return;
 stopRoutePreview(false);featurePopup?.remove();
 nav={measure:routeMeasure(result.coords),maneuvers:routeManeuvers(result.coords),along:0,off:0,marker:navigationMarker(),lock:null,arrived:false,watch:null,rerouting:false};
 document.body.classList.add('is-navigating');$('nav-banner').hidden=false;$('sidebar-body').classList.remove('expanded');$('panel-toggle').setAttribute('aria-expanded','false');
 $('nav-stop').textContent=lang==='de'?'Beenden':'End';$('nav-reroute').textContent=lang==='de'?'Neu berechnen':'Recalculate';
 setNavBanner({arrow:'⌖',instruction:lang==='de'?'Standort wird gesucht …':'Finding your location …'});
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
 if(nav.off>=2){setNavBanner({arrow:'!',instruction:de?'Du bist von der Route abgekommen':'You left the route',remaining:summary,reroute:true});return;}
 if(remaining<20){nav.arrived=true;setNavBanner({arrow:'⚑',instruction:de?'Ziel erreicht':'You have arrived',remaining:''});return;}
 const next=nav.maneuvers.find(item=>item.at>nav.along+3)||nav.maneuvers.at(-1),distance=next.at-nav.along;
 setNavBanner({arrow:TURN_ARROWS[distance>150&&next.kind!=='arrive'?'straight':next.kind],instruction:distance>150&&next.kind!=='arrive'?`${maneuverText('straight',lang)} · ${formatMetres(distance)}`:`In ${formatMetres(distance)}: ${maneuverText(next.kind,lang)}`,remaining:summary});
}
function rerouteNavigation(){
 if(!nav)return;navigator.geolocation.getCurrentPosition(position=>{if(!nav)return;const p=[position.coords.longitude,position.coords.latitude];if(!inPilot(p)){showToast('outsideLocation');return;}nav.rerouting=true;setNavBanner({arrow:'⟳',instruction:lang==='de'?'Route wird neu berechnet …':'Recalculating …'});setCustom(0,p,lang==='de'?'Mein Standort':'My location');calculate();},()=>setNavBanner({arrow:'!',instruction:t('locationFail'),reroute:true}),{enableHighAccuracy:true,timeout:15000,maximumAge:5000});
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
