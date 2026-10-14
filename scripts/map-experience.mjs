// Included after the application declarations by the bundler.
function updateExperienceLanguage(){
 const de=lang==='de',labels={openfree:'OpenFreeMap',osm:'Standard · OpenStreetMap',topo:(de?'Topografisch':'Topographic')+' · OpenTopoMap',aerial:(de?'Luftbild':'Aerial')+' · LGL BW'};
 for(const option of $('basemap')?.options||[])option.textContent=labels[option.value]||option.textContent;
 $('basemap')?.setAttribute('aria-label',de?'Hintergrundkarte':'Basemap');
 const button=$('explore-mode');if(button){button.textContent=exploreMode?(de?'Entdecken':'Explore'):(de?'Route planen':'Plan route');button.title=exploreMode?(de?'Karte frei erkunden. Zur Routenplanung wechseln.':'Explore freely. Switch to route planning.'):(de?'Routenplanung aktiv. Frei erkunden einschalten.':'Route planning active. Switch to free exploration.');button.setAttribute('aria-label',button.title);}
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
 map.on('sourcedata',event=>{if(event.sourceId==='terrain-dem'){treeSphereLayer.terrainRevision++;map.triggerRepaint();}});
 for(const event of ['dragstart','zoomstart','rotatestart','pitchstart'])map.on(event,e=>{if(e.originalEvent)stopRoutePreview(false);});
 const attribution=document.querySelector('.maplibregl-ctrl-attrib');if(attribution&&globalThis.ResizeObserver)new ResizeObserver(()=>{const height=attribution.getBoundingClientRect().height;$('map').parentElement.style.setProperty('--attribution-height',`${Math.ceil(height)}px`);}).observe(attribution);
 // Screen-space opaque boundary also covers terrain, raster textures and 3D meshes.
 const mask=$('city-screen-mask'),path=mask.querySelector('path');let signature='';
 const updateMask=()=>{if(!cityBoundary){mask.hidden=true;return;}const c=map.getCenter(),canvas=map.getCanvas(),next=[c.lng,c.lat,map.getZoom(),map.getPitch(),map.getBearing(),canvas.clientWidth,canvas.clientHeight,treeSphereLayer.terrainRevision].join('|');if(next===signature)return;signature=next;mask.setAttribute('viewBox',`0 0 ${canvas.clientWidth} ${canvas.clientHeight}`);let d=`M0 0H${canvas.clientWidth}V${canvas.clientHeight}H0Z`;for(const polygon of cityBoundary.geometry.coordinates)for(const ring of polygon){d+=ring.map((point,i)=>{const p=map.project(point);return `${i?'L':'M'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`;}).join('')+'Z';}path.setAttribute('d',d);};map.on('render',updateMask);updateMask();
}
