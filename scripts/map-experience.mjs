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
function stopRoutePreview(restore=true){
 ++previewRequestId;previewPreparing=false;if($('route-preview'))$('route-preview').disabled=!result?.coords?.length;
 if(!previewState)return;const camera=previewState.camera;previewState=null;cancelAnimationFrame(previewFrame);previewFrame=0;map?.setCenterClampedToGround(true);hideRoutePosition();updateExperienceLanguage();if(restore&&map)map.easeTo({...camera,duration:500});if(map&&cityManifest)loadVisibleCityTiles().catch(console.warn);
}
async function startRoutePreview(){
 if(previewState){stopRoutePreview();return;}if(previewPreparing||viewSwitching||!result?.coords?.length||!map)return;
 if(!is3D){await $('view').onclick();if(!is3D||viewSwitching)return;}
 const route=result,coordinates=densifyRoute(route.coords),request=++previewRequestId;previewPreparing=true;$('route-preview').disabled=true;
 let elevations;try{elevations=await terrainHeightfield.sampleMany(coordinates.map(ll));}catch(error){console.warn('Preview is waiting for terrain heights:',error);return;}finally{if(request===previewRequestId){previewPreparing=false;$('route-preview').disabled=!result?.coords?.length;}}
 if(request!==previewRequestId||route!==result||!is3D)return;
 routeMeasureCache=routeMeasure(coordinates);if(!routeMeasureCache.total)return;
 map.stop();map.setCenterClampedToGround(false);
 const camera={center:[map.getCenter().lng,map.getCenter().lat],zoom:map.getZoom(),bearing:map.getBearing(),pitch:map.getPitch(),elevation:map.getCenterElevation()},state={camera,last:performance.now(),started:performance.now(),distance:0,bearing:camera.bearing,elevations};previewState=state;updateExperienceLanguage();
 // One camera owner, with explicit cached elevations. Enter smoothly, then
 // follow the route at 18 m/s. No per-frame DEM query or automatic grounding.
 const tick=now=>{
  if(previewState!==state)return;const dt=Math.min(.1,(now-state.last)/1000);state.last=now;const intro=Math.min(1,(now-state.started)/650);
  if(intro>=1)state.distance=Math.min(routeMeasureCache.total,state.distance+dt*18);
  const f=state.distance/routeMeasureCache.total,point=pointAlongRoute(routeMeasureCache,f),ahead=pointAlongRoute(routeMeasureCache,Math.min(1,(state.distance+25)/routeMeasureCache.total));
  if(Math.hypot(ahead[0]-point[0],ahead[1]-point[1])>.01){const bearing=Math.atan2(ahead[0]-point[0],ahead[1]-point[1])*180/Math.PI;state.bearing=smoothBearing(state.bearing,(bearing+360)%360,1-Math.exp(-dt*4));}
  const target=ll(point),blend=1-Math.pow(1-intro,3),elevation=valueAlongRoute(routeMeasureCache,state.elevations,f);
  map.jumpTo({center:intro<1?camera.center.map((value,index)=>value+(target[index]-value)*blend):target,zoom:camera.zoom+(17-camera.zoom)*blend,pitch:camera.pitch+(50-camera.pitch)*blend,bearing:state.bearing,elevation:camera.elevation+(elevation-camera.elevation)*blend});showRoutePosition(f);
  if(f>=1){stopRoutePreview(false);return;}previewFrame=requestAnimationFrame(tick);
 };previewFrame=requestAnimationFrame(tick);
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
async function ensureCityScene(){
 if(!citySceneLayer){THREE=await import('./vendor/three.mjs');citySceneLayer=createCitySceneLayer({origin:meta.origin,toLngLat:ll,dimensions:treeDimensions,terrain:terrainHeightfield});map.addLayer(citySceneLayer,'route-halo');citySceneLayer.setSun(currentSun);}
 return citySceneLayer;
}
function installMapExperience(){
 for(const event of ['dragstart','zoomstart','rotatestart','pitchstart'])map.on(event,e=>{if(e.originalEvent)stopRoutePreview(false);});
 // Credits live in a reserved DOM slot, outside the map's control corners.
 const attribution=document.querySelector('.maplibregl-ctrl-attrib'),host=$('map-credits');
 if(attribution&&host){$('credits-content').append(attribution);$('credits-toggle').onclick=()=>{const content=$('credits-content'),open=content.hidden;content.hidden=!open;$('credits-toggle').setAttribute('aria-expanded',String(open));host.classList.toggle('is-open',open);updateExperienceLanguage();};const measure=()=>{const rect=host.getBoundingClientRect(),area=map.getContainer().parentElement;area.style.setProperty('--attribution-height',`${Math.ceil(rect.height)}px`);area.style.setProperty('--credits-clearance',`${Math.ceil(area.getBoundingClientRect().bottom-rect.top)}px`);};if(globalThis.ResizeObserver){const observer=new ResizeObserver(measure);observer.observe(host);observer.observe(map.getContainer().parentElement);}measure();}
 const tools=document.querySelector('.map-tools');if(tools&&globalThis.ResizeObserver){const measureTools=()=>{const area=tools.parentElement.getBoundingClientRect(),rect=tools.getBoundingClientRect();tools.parentElement.style.setProperty('--toolbar-end',`${Math.ceil(rect.bottom-area.top+8)}px`);};new ResizeObserver(measureTools).observe(tools);measureTools();}
 // The native opaque mask remains a fallback. The overlay uses camera-space
 // clipping so vertices behind the camera cannot obscure the whole viewport.
 const mask=$('city-screen-mask'),path=mask.querySelector('path');let rings=[],ringsPending=null,lastSignature='';
 const prepareRings=()=>{if(ringsPending)return;ringsPending=(async()=>{const source=cityBoundary.geometry.coordinates.flatMap(polygon=>polygon),points=source.flat(),heights=await terrainHeightfield.sampleMany(points);let index=0;rings=source.map(ring=>ring.map(point=>{const p=maplibregl.MercatorCoordinate.fromLngLat(point,heights[index++]);return [p.x,p.y,p.z];}));map.triggerRepaint();})().catch(error=>{ringsPending=null;console.warn('Boundary terrain not ready:',error);});};
 if(cityBoundary)map.addLayer({id:'boundary-projector',type:'custom',renderingMode:'3d',render(gl,args){
  if(!is3D||viewSwitching){mask.setAttribute('hidden','');lastSignature='';return;}const matrix=args.defaultProjectionData?.mainMatrix;if(!matrix||matrix.length!==16){mask.setAttribute('hidden','');return;}
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
