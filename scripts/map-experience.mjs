// Included after the application declarations by the bundler.
function updateExperienceLanguage(){
 const de=lang==='de',labels={openfree:'OpenFreeMap',osm:'Standard · OpenStreetMap',topo:(de?'Topografisch':'Topographic')+' · OpenTopoMap',aerial:(de?'Luftbild':'Aerial')+' · LGL BW'};
 for(const option of $('basemap')?.options||[])option.textContent=labels[option.value]||option.textContent;
 $('basemap')?.setAttribute('aria-label',de?'Hintergrundkarte':'Basemap');$('map-credits')?.setAttribute('aria-label',de?'Kartenquellen':'Map credits');const credits=$('credits-toggle');if(credits){const open=credits.getAttribute('aria-expanded')==='true',label=de?(open?'Kartenquellen ausblenden':'Kartenquellen einblenden'):(open?'Hide map credits':'Show map credits');credits.title=label;credits.setAttribute('aria-label',label);}
 const button=$('explore-mode');if(button){button.textContent=exploreMode?'◎':'↦';button.title=exploreMode?(de?'Karte frei erkunden. Zur Routenplanung wechseln.':'Explore freely. Switch to route planning.'):(de?'Routenplanung aktiv. Frei erkunden einschalten.':'Route planning active. Switch to free exploration.');button.setAttribute('aria-label',button.title);}
 if($('route-preview'))$('route-preview').textContent=previewState?(de?'■ Vorschau beenden':'■ Stop preview'):(de?'▶ 3D-Routenvorschau':'▶ 3D route preview');
 $('elevation-chart')?.setAttribute('aria-label',de?'Höhenprofil: Zeiger bewegen, um die Position auf der Karte zu sehen':'Elevation profile: move the pointer to see the location on the map');
}
function setExploreMode(active){exploreMode=active;stopRoutePreview(false);finishPickMode(null);hideToast();$('explore-mode').setAttribute('aria-pressed',String(active));if(active)map.doubleClickZoom.enable();else map.doubleClickZoom.disable();updateExperienceLanguage();}
function showRoutePosition(fraction){if(!map||!routeMeasureCache)return;const position=pointAlongRoute(routeMeasureCache,fraction);if(!position)return;if(!profileMarker){const element=document.createElement('div');element.className='profile-map-point';profileMarker=new maplibregl.Marker({element}).setLngLat(ll(position)).addTo(map);}else profileMarker.setLngLat(ll(position));const cursor=$('elevation-cursor');cursor.hidden=false;cursor.setAttribute('d',`M${Math.max(0,Math.min(1,fraction))*300} 0V86`);}
function hideRoutePosition(){profileMarker?.remove();profileMarker=null;if($('elevation-cursor'))$('elevation-cursor').hidden=true;}
function stopRoutePreview(restore=true){if(!previewState)return;const camera=previewState.camera;previewState=null;cancelAnimationFrame(previewFrame);previewFrame=0;hideRoutePosition();updateExperienceLanguage();if(restore&&map)map.easeTo({...camera,duration:500});if(map&&cityManifest)loadVisibleCityTiles().catch(console.warn);}
async function startRoutePreview(){
 if(previewState){stopRoutePreview();return;}if(!result?.coords?.length||!map)return;
 if(!is3D){await $('view').onclick();if(!is3D||viewSwitching)return;}
 routeMeasureCache=routeMeasure(result.coords);if(!routeMeasureCache.total)return;
 map.stop();previewState={camera:{center:[map.getCenter().lng,map.getCenter().lat],zoom:map.getZoom(),bearing:map.getBearing(),pitch:map.getPitch()},last:performance.now(),distance:0,bearing:map.getBearing()};updateExperienceLanguage();
 // 18 m/s, with bearings eased through curves. Nothing is calculated during playback.
 const tick=now=>{if(!previewState)return;const state=previewState,dt=Math.min(.1,(now-state.last)/1000);state.last=now;state.distance=Math.min(routeMeasureCache.total,state.distance+dt*18);const f=state.distance/routeMeasureCache.total,point=pointAlongRoute(routeMeasureCache,f),ahead=pointAlongRoute(routeMeasureCache,Math.min(1,(state.distance+25)/routeMeasureCache.total));if(Math.hypot(ahead[0]-point[0],ahead[1]-point[1])>.01){const bearing=Math.atan2(ahead[0]-point[0],ahead[1]-point[1])*180/Math.PI;state.bearing=smoothBearing(state.bearing,(bearing+360)%360,1-Math.exp(-dt*4));}map.jumpTo({center:ll(point),zoom:17,pitch:50,bearing:state.bearing});showRoutePosition(f);if(f>=1){stopRoutePreview(false);return;}previewFrame=requestAnimationFrame(tick);};previewFrame=requestAnimationFrame(tick);
}
function setupRouteExperience(){
 $('explore-mode').onclick=()=>setExploreMode(!exploreMode);$('route-preview').onclick=startRoutePreview;
 const chart=$('elevation-chart');let hoverFrame=0,lastFraction=0;
 chart.addEventListener('pointermove',event=>{const rect=chart.getBoundingClientRect();lastFraction=Math.max(0,Math.min(1,(event.clientX-rect.left)/rect.width));if(!hoverFrame)hoverFrame=requestAnimationFrame(()=>{hoverFrame=0;if(!previewState)showRoutePosition(lastFraction);});});
 chart.addEventListener('pointerleave',()=>{cancelAnimationFrame(hoverFrame);hoverFrame=0;if(!previewState)hideRoutePosition();});
 chart.setAttribute('tabindex','0');chart.setAttribute('role','slider');chart.setAttribute('aria-valuemin','0');chart.setAttribute('aria-valuemax','100');chart.setAttribute('aria-valuenow','0');
 chart.addEventListener('keydown',event=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;event.preventDefault();lastFraction=event.key==='Home'?0:event.key==='End'?1:Math.max(0,Math.min(1,lastFraction+(event.key==='ArrowRight'?.02:-.02)));chart.setAttribute('aria-valuenow',String(Math.round(lastFraction*100)));showRoutePosition(lastFraction);});chart.addEventListener('blur',()=>{if(!previewState)hideRoutePosition();});
 document.addEventListener('visibilitychange',()=>{if(document.hidden)stopRoutePreview(false);});document.addEventListener('keydown',event=>{if(event.key==='Escape')stopRoutePreview();});
}
function installMapExperience(){
 treeSphereLayer=createSphereTreeLayer({toLngLat:ll,dimensions:treeDimensions});map.addLayer(treeSphereLayer);
 map.on('sourcedata',event=>{if(event.sourceId==='terrain-dem'&&event.sourceDataType==='content'){treeSphereLayer.terrainRevision++;map.triggerRepaint();}});
 for(const event of ['dragstart','zoomstart','rotatestart','pitchstart'])map.on(event,e=>{if(e.originalEvent)stopRoutePreview(false);});
 // Credits live in a reserved DOM slot, outside the map's control corners.
 const attribution=document.querySelector('.maplibregl-ctrl-attrib'),host=$('map-credits');
 if(attribution&&host){$('credits-content').append(attribution);$('credits-toggle').onclick=()=>{const content=$('credits-content'),open=content.hidden;content.hidden=!open;$('credits-toggle').setAttribute('aria-expanded',String(open));host.classList.toggle('is-open',open);updateExperienceLanguage();};const measure=()=>{const height=host.getBoundingClientRect().height;map.getContainer().parentElement.style.setProperty('--attribution-height',`${Math.ceil(height)}px`);};if(globalThis.ResizeObserver)new ResizeObserver(measure).observe(host);measure();}
 const tools=document.querySelector('.map-tools');if(tools&&globalThis.ResizeObserver){const measureTools=()=>{const area=tools.parentElement.getBoundingClientRect(),rect=tools.getBoundingClientRect();tools.parentElement.style.setProperty('--toolbar-end',`${Math.ceil(rect.bottom-area.top+8)}px`);};new ResizeObserver(measureTools).observe(tools);measureTools();}
 // The native opaque mask remains a fallback. The overlay uses camera-space
 // clipping so vertices behind the camera cannot obscure the whole viewport.
 const mask=$('city-screen-mask'),path=mask.querySelector('path');let rings=[],terrainRevision=-1,lastSignature='';
 if(cityBoundary)map.addLayer({id:'boundary-projector',type:'custom',renderingMode:'3d',render(gl,args){
  if(!is3D||viewSwitching){mask.setAttribute('hidden','');lastSignature='';return;}const matrix=args.defaultProjectionData?.mainMatrix;if(!matrix||matrix.length!==16){mask.setAttribute('hidden','');return;}
  const canvas=map.getCanvas(),width=canvas.clientWidth,height=canvas.clientHeight,revision=treeSphereLayer?.terrainRevision||0;
  if(!rings.length||terrainRevision!==revision){rings=cityBoundary.geometry.coordinates.flatMap(polygon=>polygon.map(ring=>ring.map(point=>{const ground=map.queryTerrainElevation(point)||0,p=maplibregl.MercatorCoordinate.fromLngLat(point,ground);return [p.x,p.y,p.z];})));terrainRevision=revision;}
  const signature=width+'|'+height+'|'+revision+'|'+Array.from(matrix).join(',');if(signature===lastSignature)return;lastSignature=signature;
  const inside=projectBoundaryPath(rings,matrix,width,height),centre=map.getCenter(),screenCentre=map.project(centre),projectedRings=inside.split('Z').filter(Boolean).map(part=>[...part.matchAll(/[ML]([\d.-]+) ([\d.-]+)/g)].map(match=>[+match[1],+match[2]]));
  // Fail open to the native GPU-clipped mask if an inconsistent matrix/terrain
  // state would cover the actual city centre. A map must never go all-grey here.
  const centreVisible=projectedRings.reduce((hit,ring)=>hit!==pointInRing([screenCentre.x,screenCentre.y],ring),false);
  if(inPilot([centre.lng,centre.lat])&&!centreVisible){mask.setAttribute('hidden','');return;}
  mask.setAttribute('viewBox',`0 0 ${width} ${height}`);path.setAttribute('d',`M0 0H${width}V${height}H0Z`+inside);mask.removeAttribute('hidden');
 }});
 else mask.setAttribute('hidden','');
}
