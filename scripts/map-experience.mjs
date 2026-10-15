// Included after the application declarations by the bundler.
function updateExperienceLanguage(){
 for(const [id,de,en] of [['mode-route','Route planen','Plan a route'],['mode-explore','Stuttgart erkunden','Explore Stuttgart'],['view','Zwischen 2D und 3D wechseln','Switch between 2D and 3D']])if($(id)){$(id).title=lang==='de'?de:en;$(id).setAttribute('aria-label',$(id).title);}
 const de=lang==='de',labels={openfree:'OpenFreeMap',osm:'Standard · OpenStreetMap',topo:(de?'Topografisch':'Topographic')+' · OpenTopoMap',aerial:(de?'Luftbild':'Aerial')+' · LGL BW'};
 for(const option of $('basemap')?.options||[])option.textContent=labels[option.value]||option.textContent;
 $('basemap')?.setAttribute('aria-label',de?'Hintergrundkarte':'Basemap');$('map-credits')?.setAttribute('aria-label',de?'Kartenquellen':'Map credits');const credits=$('credits-toggle');if(credits){const open=credits.getAttribute('aria-expanded')==='true',label=de?(open?'Kartenquellen ausblenden':'Kartenquellen einblenden'):(open?'Hide map credits':'Show map credits');credits.title=label;credits.setAttribute('aria-label',label);}
 for(const [id,label] of [['mode-route',de?'Route':'Route'],['mode-explore',de?'Entdecken':'Explore'],['explore-title',de?'Stuttgart entdecken':'Explore Stuttgart'],['explore-description',de?'Klicke auf einen Weg, einen Baum oder ein Gebäude, um mehr zu erfahren. Wähle zusätzliche Ebenen nach Interesse.':'Click a path, tree or building to learn more. Choose additional layers as you explore.'],['explore-layers',de?'Kartenebenen wählen':'Choose map layers'],['explore-3d',is3D?(de?'Zur 2D-Karte':'Switch to 2D'):(de?'Stadt in 3D ansehen':'View the city in 3D')],['shadow-view-label',de?'Modellierten Schatten anzeigen':'Show modelled shadows'],['shadow-view-note',de?'In 3D · wird erst beim Einschalten berechnet':'In 3D · calculated when enabled']])if($(id))$(id).textContent=label;
 const button=$('explore-mode');if(button){button.textContent=exploreMode?'◎':'↦';button.title=exploreMode?(de?'Karte frei erkunden. Zur Routenplanung wechseln.':'Explore freely. Switch to route planning.'):(de?'Routenplanung aktiv. Frei erkunden einschalten.':'Route planning active. Switch to free exploration.');button.setAttribute('aria-label',button.title);}
 if($('route-preview'))$('route-preview').textContent=previewState?(de?'■ Vorschau beenden':'■ Stop preview'):(de?'▶ 3D-Routenvorschau':'▶ 3D route preview');
 $('elevation-chart')?.setAttribute('aria-label',de?'Höhenprofil: Zeiger bewegen, um die Position auf der Karte zu sehen':'Elevation profile: move the pointer to see the location on the map');
}
function updateModeUI(){
 document.body.classList.toggle('is-exploring',exploreMode);document.body.classList.toggle('is-routing',!exploreMode);
 for(const [id,active] of [['mode-route',!exploreMode],['mode-explore',exploreMode]]){$(id)?.classList.toggle('selected',active);$(id)?.setAttribute('aria-pressed',String(active));}
 $('explore-panel').hidden=!exploreMode;$('journey-panel').hidden=exploreMode;$('layers-toggle').hidden=false;if(!exploreMode){$('layers-panel').hidden=true;$('layers-toggle').setAttribute('aria-expanded','false');}
 if(map){applyTheme({reload:false});applyPoiFilter({reload:false});if(map.getLayer('shade-fill'))map.setLayoutProperty('shade-fill','visibility',exploreMode&&shadowDisplayEnabled&&is3D&&Boolean(displayShadeFrame)?'visible':'none');}
 $('shadow-view').disabled=!is3D;$('shadow-view').checked=shadowDisplayEnabled;
 const heading=$('panel-toggle')?.lastElementChild;if(heading&&exploreMode)heading.textContent=lang==='de'?'Stuttgart entdecken':'Explore Stuttgart';else if(heading)heading.textContent=t('planRoute');
 updateExperienceLanguage();
}
function setExploreMode(active){
 if(exploreMode===active)return;exploreMode=active;stopRoutePreview(false);hideRoutePosition();finishPickMode(null);hideToast();featureRequestId++;featurePopup?.remove();featurePopup=null;++tileLoadId;++displayShadeId;displayShadeSignature='';clearTimeout(cityShadeTimer);
 stopDisplayShadows();if(map){if(active)map.doubleClickZoom.enable();else map.doubleClickZoom.disable();}
 const url=new URL(location.href);if(active)url.searchParams.set('mode','explore');else url.searchParams.delete('mode');history.replaceState(null,'',url);activeCityViewSignature='';updateModeUI();if(map)loadVisibleCityTiles().catch(console.warn);
}
function showRoutePosition(fraction){if(!map||!routeMeasureCache)return;const position=pointAlongRoute(routeMeasureCache,fraction);if(!position)return;if(!profileMarker){const element=document.createElement('div');element.className='profile-map-point';profileMarker=new maplibregl.Marker({element}).setLngLat(ll(position)).addTo(map);}else profileMarker.setLngLat(ll(position));const cursor=$('elevation-cursor');cursor.hidden=false;cursor.setAttribute('d',`M${Math.max(0,Math.min(1,fraction))*300} 0V86`);}
function hideRoutePosition(){profileMarker?.remove();profileMarker=null;if($('elevation-cursor'))$('elevation-cursor').hidden=true;}
function stopRoutePreview(restore=true){
 ++previewRequestId;previewPreparing=false;if($('route-preview'))$('route-preview').disabled=!result?.coords?.length;
 if(!previewState)return;const camera=previewState.camera;previewState=null;cancelAnimationFrame(previewFrame);previewFrame=0;hideRoutePosition();updateExperienceLanguage();if(restore&&map)map.easeTo({...camera,duration:500});if(map&&cityManifest)loadVisibleCityTiles().catch(console.warn);
}
async function startRoutePreview(){
 if(previewState){stopRoutePreview();return;}if(previewPreparing||viewSwitching||!result?.coords?.length||!map)return;
 if(!is3D){await $('view').onclick();if(!is3D||viewSwitching)return;}
 const route=result,coordinates=densifyRoute(route.coords);routeMeasureCache=routeMeasure(coordinates);if(!routeMeasureCache.total)return;
 map.stop();
 const camera={center:[map.getCenter().lng,map.getCenter().lat],zoom:map.getZoom(),bearing:map.getBearing(),pitch:map.getPitch()},state={camera,last:performance.now(),started:performance.now(),distance:0,bearing:camera.bearing};previewState=state;updateExperienceLanguage();
 // One camera owner follows the flat visual route. Actual ascent/descent remain
 // in the Atlas profile; the preview neither downloads nor queries DEM heights.
 const tick=now=>{
  if(previewState!==state)return;const dt=Math.min(.1,(now-state.last)/1000);state.last=now;const intro=Math.min(1,(now-state.started)/650);
  if(intro>=1)state.distance=Math.min(routeMeasureCache.total,state.distance+dt*18);
  const f=state.distance/routeMeasureCache.total,point=pointAlongRoute(routeMeasureCache,f),ahead=pointAlongRoute(routeMeasureCache,Math.min(1,(state.distance+25)/routeMeasureCache.total));
  if(Math.hypot(ahead[0]-point[0],ahead[1]-point[1])>.01){const bearing=Math.atan2(ahead[0]-point[0],ahead[1]-point[1])*180/Math.PI;state.bearing=smoothBearing(state.bearing,(bearing+360)%360,1-Math.exp(-dt*4));}
  const target=ll(point),blend=1-Math.pow(1-intro,3);
  map.jumpTo({center:intro<1?camera.center.map((value,index)=>value+(target[index]-value)*blend):target,zoom:camera.zoom+(17-camera.zoom)*blend,pitch:camera.pitch+(50-camera.pitch)*blend,bearing:state.bearing});showRoutePosition(f);
  if(f>=1){stopRoutePreview(false);return;}previewFrame=requestAnimationFrame(tick);
 };previewFrame=requestAnimationFrame(tick);
}
function setupRouteExperience(){
 setupCompactTools();
 $('explore-mode').onclick=()=>setExploreMode(!exploreMode);$('mode-route').onclick=()=>setExploreMode(false);$('mode-explore').onclick=()=>setExploreMode(true);$('route-preview').onclick=startRoutePreview;
 $('explore-layers').onclick=()=>{if(!exploreMode)setExploreMode(true);$('layers-panel').hidden=false;$('layers-toggle').setAttribute('aria-expanded','true');};$('explore-3d').onclick=()=>setMapViewMode(!is3D);
 $('shadow-view').onchange=()=>{shadowDisplayEnabled=$('shadow-view').checked;displayShadeId++;displayShadeSignature='';if(!shadowDisplayEnabled){stopDisplayShadows();map?.setLayoutProperty('shade-fill','visibility','none');}else requestShade(false,{silent:true});};
 document.addEventListener('visibilitychange',()=>{if(!document.hidden)loadWeather();});window.addEventListener('online',()=>loadWeather());

 const chart=$('elevation-chart');let hoverFrame=0,lastFraction=0;
 chart.addEventListener('pointermove',event=>{const rect=chart.getBoundingClientRect();lastFraction=Math.max(0,Math.min(1,(event.clientX-rect.left)/rect.width));if(!hoverFrame)hoverFrame=requestAnimationFrame(()=>{hoverFrame=0;if(!previewState)showRoutePosition(lastFraction);});});
 chart.addEventListener('pointerleave',()=>{cancelAnimationFrame(hoverFrame);hoverFrame=0;if(!previewState)hideRoutePosition();});
 chart.setAttribute('tabindex','0');chart.setAttribute('role','slider');chart.setAttribute('aria-valuemin','0');chart.setAttribute('aria-valuemax','100');chart.setAttribute('aria-valuenow','0');
 chart.addEventListener('keydown',event=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;event.preventDefault();lastFraction=event.key==='Home'?0:event.key==='End'?1:Math.max(0,Math.min(1,lastFraction+(event.key==='ArrowRight'?.02:-.02)));chart.setAttribute('aria-valuenow',String(Math.round(lastFraction*100)));showRoutePosition(lastFraction);});chart.addEventListener('blur',()=>{if(!previewState)hideRoutePosition();});
 document.addEventListener('visibilitychange',()=>{if(document.hidden)stopRoutePreview(false);});document.addEventListener('keydown',event=>{if(event.key==='Escape')stopRoutePreview();});
}
async function ensureCityScene(){
 if(citySceneLayer)return citySceneLayer;if(!cityScenePending)cityScenePending=(async()=>{THREE=await import('./vendor/three.mjs');citySceneLayer=createCitySceneLayer({origin:meta.origin,toLngLat:ll,dimensions:treeDimensions});map.addLayer(citySceneLayer,'route-halo');citySceneLayer.setSun(currentSun);return citySceneLayer;})().catch(error=>{cityScenePending=null;throw error;});return cityScenePending;
}
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
 const tools=document.querySelector('.map-tools'),panel=$('layers-panel');
 tools.prepend(document.querySelector('.mode-switch'));
 const basemap=$('basemap'),holder=document.createElement('label');holder.className='basemap-choice';holder.append(basemap);panel.insertBefore(holder,panel.querySelector('label'));
 $('layers-toggle').hidden=false;
 document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!panel.hidden){panel.hidden=true;$('layers-toggle').setAttribute('aria-expanded','false');$('layers-toggle').focus();}});
 document.addEventListener('pointerdown',event=>{if(!panel.hidden&&!panel.contains(event.target)&&!$('layers-toggle').contains(event.target)){panel.hidden=true;$('layers-toggle').setAttribute('aria-expanded','false');}});
 const icons={slope:'M3 18 11 10 15 14 21 6M15 6h6v6',surface:'M4 5h16v14H4zM4 12h16M12 5v7M8 12v7M16 12v7',shadeSummer:'M12 3v18M12 4a8 8 0 0 1 0 16M4 12h3M5 5l2 2M5 19l2-2',shadeWinter:'M12 3v18M4 7l16 10M4 17 20 7',utciSummer:'M9 5a3 3 0 0 1 6 0v9a5 5 0 1 1-6 0zM12 7v10M19 4v6M16 7h6',utciWinter:'M9 5a3 3 0 0 1 6 0v9a5 5 0 1 1-6 0zM12 10v7M18 6h5',noise:'M3 9h4l5-4v14l-5-4H3zM16 8q5 4 0 8M19 5q7 7 0 14',wind:'M3 8h12q6 0 4-4M3 12h17M3 16h10q6 0 4 4'};
 for(const label of document.querySelectorAll('.theme-option')){const icon=label.querySelector('i');icon.innerHTML=`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${icons[label.dataset.theme]}"/></svg>`;}
}
