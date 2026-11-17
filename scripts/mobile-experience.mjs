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
 setupMobileSteps();
 window.addEventListener('resize',syncMobileDock);document.addEventListener('keydown',e=>{if(e.key==='Escape'){finishPickMode(null);hideToast();}if(e.key==='Control')document.body.classList.add('map-camera-key');});document.addEventListener('keyup',e=>{if(e.key==='Control')document.body.classList.remove('map-camera-key');});window.addEventListener('blur',()=>document.body.classList.remove('map-camera-key'));
 syncMobileDock();
}

// Mobile journey in three steps (1 where, 2 how, 3 route); the map stays visible above the sheet.
let mobileStep=1;
function mobileStepAllowed(step){return step===1||(step===2&&points.every(Boolean))||(step===3&&Boolean(result&&!result.error));}
function renderMobileSteps(){
 document.body.dataset.mobileStep=String(mobileStep);const de=lang==='de';
 const labels=de?['Wohin?','Wie?','Route']:['Where?','How?','Route'];
 document.querySelectorAll('#mobile-steps [data-step]').forEach(button=>{const step=+button.dataset.step;button.querySelector('span').textContent=labels[step-1];button.disabled=!mobileStepAllowed(step);button.setAttribute('aria-current',step===mobileStep?'step':'false');});
 const next=$('mobile-next');if(next){next.disabled=!points.every(Boolean);next.textContent=de?'Weiter: Wie möchtest du gehen? →':'Next: how would you like to walk? →';}
 const back=$('mobile-back');if(back)back.textContent=de?'‹ Start und Ziel ändern':'‹ Change start and destination';
 const here=$('use-location');if(here)here.textContent=de?'⌖ Meinen Standort als Start':'⌖ Use my location as start';
}
function setMobileStep(step,{open=true}={}){
 if(!mobileStepAllowed(step))step=points.every(Boolean)?2:1;mobileStep=step;renderMobileSteps();
 if(open&&isMobileMap()&&!document.body.classList.contains('is-navigating')){$('sidebar-body').classList.add('expanded');$('panel-toggle').setAttribute('aria-expanded','true');$('sidebar-body').scrollTop=0;}
 requestAnimationFrame(syncMobileDock);
}
function setupMobileSteps(){
 const panel=$('journey-panel');if(!panel||$('mobile-steps'))return;
 const steps=document.createElement('nav');steps.id='mobile-steps';steps.className='mobile-steps';steps.setAttribute('aria-label','Schritte');
 steps.innerHTML='<button type="button" data-step="1"><b>1</b><span></span></button><button type="button" data-step="2"><b>2</b><span></span></button><button type="button" data-step="3"><b>3</b><span></span></button>';
 panel.prepend(steps);steps.querySelectorAll('[data-step]').forEach(button=>button.onclick=()=>setMobileStep(+button.dataset.step));
 const journey=panel.querySelector('.journey'),here=document.createElement('button');here.type='button';here.id='use-location';here.className='mobile-only text-button';here.onclick=()=>$('locate').click();journey.querySelector('#pick-hint').before(here);
 const next=document.createElement('button');next.type='button';next.id='mobile-next';next.className='primary mobile-only';next.onclick=()=>setMobileStep(2);journey.append(next);
 const back=document.createElement('button');back.type='button';back.id='mobile-back';back.className='text-button mobile-only';back.onclick=()=>setMobileStep(1);panel.querySelector('.preferences').prepend(back);
 const go=document.createElement('button');go.type='button';go.id='mobile-navigate';go.hidden=true;$('mobile-edit-route').before(go);
 $('mobile-edit-route').addEventListener('click',()=>setMobileStep(1));
 renderMobileSteps();
 if(isMobileMap()&&!points.every(Boolean))setMobileStep(1);
}
