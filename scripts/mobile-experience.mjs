// Mobile map gestures never edit endpoints. Choosing a point is a separate,
// explicit centre-and-confirm transaction, cancelled after one committed point.
function isMobileMap(){return innerWidth<=800;}
function syncMapInteraction(){
 document.body.classList.toggle('is-picking',pick!==null);
 const bar=$('map-pick-bar');if(bar){bar.hidden=pick===null||!isMobileMap();$('map-pick-label').textContent=lang==='de'?(pick===0?'Karte verschieben · Start festlegen':'Karte verschieben · Ziel festlegen'):(pick===0?'Move map · choose start':'Move map · choose destination');}
 if(map){map.getCanvas().style.cursor=pick!==null&&!isMobileMap()?'crosshair':exploreMode?'default':'';}
}
function syncMobileDock(){
 const mobile=isMobileMap(),dock=$('mobile-dock'),sheet=$('sidebar-body'),time=document.querySelector('.time-panel'),controls=$('preview-controls');
 if(!dock)return;
 if(mobile){if(time.parentElement!==dock)dock.prepend(time);if(sheet.parentElement!==dock)dock.append(sheet);
  const slot=previewState?$('mobile-preview-slot'):$('preview-controls-home');if(controls.parentElement!==slot)slot.append(controls);
 }else{if(time.parentElement!==mobileTimeHome.parentElement)mobileTimeHome.after(time);if(sheet.parentElement!==mobileSheetHome.parentElement)mobileSheetHome.after(sheet);if(controls.parentElement!==$('preview-controls-home'))$('preview-controls-home').append(controls);const profile=$('elevation-profile');if(profile.parentElement!==$('profile-home'))$('profile-home').append(profile);}
 if(mobile&&result&&!result.error){if($('result').previousElementSibling)$('journey-panel').prepend($('result'));}else if(mobileResultHome&&$('result').previousSibling!==mobileResultHome)mobileResultHome.after($('result'));
 if(mobile){const profile=$('elevation-profile'),slot=previewState?$('mobile-preview-slot'):$('profile-home');if(profile.parentElement!==slot)slot.append(profile);}
 document.body.classList.toggle('has-route',Boolean(result&&!result.error));document.body.classList.toggle('preview-active',Boolean(previewState));
 const summary=$('mobile-route-summary');if(summary){summary.hidden=!result||Boolean(result.error);if(result&&!result.error){$('mobile-route-time').textContent=formatWalkDuration(result.minutes,lang);$('mobile-route-distance').textContent=(result.length/1000).toLocaleString(lang,{maximumFractionDigits:2})+' km';}}
 if(mobile)$('panel-toggle').lastElementChild.textContent=result&&!result.error?(document.body.classList.contains('route-editing')?(lang==='de'?'Route bearbeiten':'Edit route'):t('yourRoute')):t('planRoute');
 if(mobile){const height=Math.ceil(dock.getBoundingClientRect().height);document.documentElement.style.setProperty('--mobile-dock-height',`${height}px`);}
 syncMapInteraction();
}
let mobileTimeHome=null,mobileSheetHome=null,mobileResultHome=null;
function setupMobileExperience(){
 const time=document.querySelector('.time-panel'),sheet=$('sidebar-body');mobileTimeHome=document.createComment('time-home');time.before(mobileTimeHome);mobileSheetHome=document.createComment('sheet-home');sheet.before(mobileSheetHome);
 mobileResultHome=document.createComment('result-home');$('result').before(mobileResultHome);
 const dock=document.createElement('div');dock.id='mobile-dock';document.body.append(dock);
 const summary=document.createElement('div');summary.id='mobile-route-summary';summary.hidden=true;summary.innerHTML='<strong id="mobile-route-time"></strong><span id="mobile-route-distance"></span><button id="mobile-edit-route" type="button" aria-label="Start oder Ziel bearbeiten">✎</button>';$('panel-toggle').after(summary);
 $('mobile-edit-route').onclick=()=>{stopRoutePreview(false);document.body.classList.add('route-editing');sheet.classList.add('expanded');$('panel-toggle').setAttribute('aria-expanded','true');requestAnimationFrame(()=>{sheet.scrollTop=0;syncMobileDock();});};
 const slot=document.createElement('div');slot.id='mobile-preview-slot';summary.after(slot);
 const toggle=document.createElement('button');toggle.id='mobile-weather-toggle';toggle.type='button';toggle.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>';toggle.setAttribute('aria-expanded','false');time.querySelector('.time-top').append(toggle);
 toggle.onclick=()=>{const open=time.classList.toggle('mobile-time-open');toggle.setAttribute('aria-expanded',String(open));syncMobileDock();};
 $('map-pick-confirm').onclick=()=>{if(pick===null||!map)return;const c=map.getCenter();chooseMapPoint([c.lng,c.lat],{forcedIndex:pick});};$('map-pick-cancel').onclick=()=>{finishPickMode(null);hideToast();document.body.classList.remove('route-editing');syncMobileDock();};
 $('panel-toggle').addEventListener('click',()=>requestAnimationFrame(()=>{if(!sheet.classList.contains('expanded')&&pick===null)document.body.classList.remove('route-editing');syncMobileDock();}));
 // Drag only the handle, never the scrollable contents or map. All sheet
 // positions have the same DOM; no duplicated state or intercepted map taps.
 let start=null,lastDrag=-Infinity;const handle=$('panel-toggle');handle.style.touchAction='none';handle.addEventListener('pointerdown',e=>{if(!isMobileMap())return;start=e.clientY;handle.setPointerCapture(e.pointerId);});handle.addEventListener('pointerup',e=>{if(start===null)return;const delta=e.clientY-start;start=null;if(Math.abs(delta)>30){lastDrag=performance.now();sheet.classList.toggle('expanded',delta<0);handle.setAttribute('aria-expanded',String(delta<0));requestAnimationFrame(syncMobileDock);}});handle.addEventListener('pointercancel',()=>start=null);handle.addEventListener('click',e=>{if(performance.now()-lastDrag<500){e.preventDefault();e.stopImmediatePropagation();}},{capture:true});
 if(globalThis.ResizeObserver){new ResizeObserver(()=>requestAnimationFrame(syncMobileDock)).observe(dock);}
 window.addEventListener('resize',syncMobileDock);document.addEventListener('keydown',e=>{if(e.key==='Escape'){finishPickMode(null);hideToast();}if(e.key==='Control')document.body.classList.add('map-camera-key');});document.addEventListener('keyup',e=>{if(e.key==='Control')document.body.classList.remove('map-camera-key');});window.addEventListener('blur',()=>document.body.classList.remove('map-camera-key'));
 syncMobileDock();
}
