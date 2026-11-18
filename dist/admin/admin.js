// Sonnenpfad admin dashboard. Reads only the protected /api/admin/* endpoints (Cloudflare Access +
// server-side JWT check in services/platform.mjs). All text is inserted with textContent (no HTML injection).
const $=id=>document.getElementById(id);
const el=(tag,props={},...children)=>{const node=document.createElement(tag);for(const [key,value] of Object.entries(props)){if(key==='class')node.className=value;else if(key==='text')node.textContent=value;else node.setAttribute(key,value);}node.append(...children);return node;};
const svgEl=(tag,attrs={})=>{const node=document.createElementNS('http://www.w3.org/2000/svg',tag);for(const [key,value] of Object.entries(attrs))node.setAttribute(key,value);return node;};
const fmt=value=>Number(value||0).toLocaleString('de-DE');
const WEEKDAYS=['Mo','Di','Mi','Do','Fr','Sa','So'];
const FEATURE_LABELS={'mode|explore':'Wechsel in den Entdeckmodus','mode|route':'Wechsel ins Routing','view3d|on':'3D-Ansicht','shade|on':'Schatten-Ebene (2D)','export|csv':'Export CSV','export|geojson':'Export GeoJSON','nav|start':'Navigation gestartet','nav|reroute':'Navigation neu berechnet','nav|arrive':'Navigation: Ziel erreicht'};
const PROFILES={standard:'Standard',wheelchair:'Rollstuhl',powerWheelchair:'E-Rollstuhl',walkingAid:'Stock/Rollator',vision:'Blind/sehbehindert',stroller:'Kinderwagen',custom:'Eigene Einstellungen'};
const PREFS={balanced:'Direkt',shade:'Schatten',sun:'Sonne'};
let districtNames={},grid=null;

async function getJSON(path){const response=await fetch(path,{credentials:'same-origin',headers:{Accept:'application/json'}});if(!response.ok)throw Error(`${path}: ${response.status}`);return response.json();}
function notice(text){$('notice').textContent=text;$('notice').hidden=!text;}

function sum(rows,metric,dim){return rows.filter(r=>r.metric===metric&&(dim===undefined||r.dim===dim)).reduce((total,r)=>total+r.n,0);}
function byDim(rows,metric){const map=new Map();for(const r of rows)if(r.metric===metric)map.set(r.dim,(map.get(r.dim)||0)+r.n);return [...map].sort((a,b)=>b[1]-a[1]);}
function byDay(rows,metric){const map=new Map();for(const r of rows)if(r.metric===metric)map.set(r.day,(map.get(r.day)||0)+r.n);return map;}
function dayList(since,today){const days=[];for(let t=Date.parse(since+'T12:00:00Z');;t+=86400000){const d=new Date(t).toISOString().slice(0,10);days.push(d);if(d>=today)break;}return days;}

function barChart(container,labels,series,{height=160}={}){
 container.replaceChildren();const width=1000,max=Math.max(1,...series.flatMap(s=>s.values)),svg=svgEl('svg',{viewBox:`0 0 ${width} ${height+22}`,role:'img'});
 const band=width/labels.length,colors=['#1a56c4','#f4c542','#2e7d32'];
 series.forEach((s,k)=>s.values.forEach((value,i)=>{const h=value/max*height,w=band*.8/series.length;const rect=svgEl('rect',{x:i*band+band*.1+k*w,y:height-h,width:Math.max(1,w-1),height:h,fill:colors[k],rx:1.5});rect.append(svgEl('title'));rect.firstChild.textContent=`${labels[i]}: ${fmt(value)} ${s.name}`;svg.append(rect);}));
 const step=Math.ceil(labels.length/12);labels.forEach((label,i)=>{if(i%step)return;const t=svgEl('text',{x:i*band+band/2,y:height+15,'text-anchor':'middle'});t.textContent=label;svg.append(t);});
 const legend=el('div',{class:'muted'});legend.textContent=series.map((s,k)=>`${['■ blau','■ gelb','■ grün'][k]}: ${s.name}`).join('   ');
 container.append(svg,legend);
}
function barList(title,entries,label=key=>key){
 const box=el('div',{class:'bar-list'},el('h4',{text:title}));const max=Math.max(1,...entries.map(e=>e[1]));
 if(!entries.length)box.append(el('p',{class:'muted',text:'Noch keine Daten.'}));
 for(const [key,value] of entries.slice(0,12)){const bar=el('i');bar.style.width=`${value/max*100}%`;box.append(el('div',{class:'bar-row'},el('span',{text:label(key)}),bar,el('b',{text:fmt(value)})));}
 return box;
}
function kpi(value,text){return el('div',{class:'kpi'},el('b',{text:value}),el('span',{text}));}

function renderUsage(data){
 const rows=data.rows,days=dayList(data.since,data.today),live=data.live||{};
 const visitorsByDay=byDay(rows,'visitors');visitorsByDay.set(data.today,live.visitors||0);
 const pvByDay=byDay(rows,'pv'),routes=sum(rows,'route'),fails=sum(rows,'route_fail');
 const totalVisitors=[...visitorsByDay.values()].reduce((a,b)=>a+b,0),sessions=sum(rows,'sessions')+(live.sessions||0),duration=sum(rows,'duration_s')+Math.round((live.duration||0)/1000);
 $('kpis').replaceChildren(kpi(fmt(live.visitors),'Besucher heute (geschätzt)'),kpi(fmt(live.active),'Aktiv in den letzten 5 Min.'),kpi(fmt(totalVisitors),`Besucher in ${data.days} Tagen`),kpi(fmt(sum(rows,'pv')),'Seitenaufrufe'),kpi(fmt(sessions),'Sitzungen'),kpi(sessions?`${Math.round(duration/sessions/60*10)/10} min`:'–','Ø Nutzungsdauer'),kpi(fmt(routes),'Berechnete Routen'),kpi(routes+fails?`${Math.round(fails/(routes+fails)*1000)/10} %`:'–','Fehlgeschlagene Routen'),kpi(fmt(sum(rows,'export')),'Datenexporte'));
 barChart($('chart-days'),days.map(d=>d.slice(5).split('-').reverse().join('.')),[{name:'Besucher',values:days.map(d=>visitorsByDay.get(d)||0)},{name:'Seitenaufrufe',values:days.map(d=>pvByDay.get(d)||0)}]);
 // Week, month and year totals of the selected period.
 const periods=[['Woche',d=>{const date=new Date(d+'T12:00:00Z'),thursday=new Date(date);thursday.setUTCDate(date.getUTCDate()+3-(date.getUTCDay()+6)%7);const first=new Date(Date.UTC(thursday.getUTCFullYear(),0,4));return `${thursday.getUTCFullYear()}-KW${String(1+Math.round(((thursday-first)/86400000-3+(first.getUTCDay()+6)%7)/7)).padStart(2,'0')}`;}],['Monat',d=>d.slice(0,7)],['Jahr',d=>d.slice(0,4)]];
 const table=el('table');table.append(el('tr',{},el('th',{text:'Zeitraum'}),el('th',{text:'Besucher'}),el('th',{text:'Seitenaufrufe'}),el('th',{text:'Routen'})));
 const routesByDay=byDay(rows,'route');
 for(const [name,key] of periods){const groups=new Map();for(const d of days){const g=key(d),entry=groups.get(g)||[0,0,0];entry[0]+=visitorsByDay.get(d)||0;entry[1]+=pvByDay.get(d)||0;entry[2]+=routesByDay.get(d)||0;groups.set(g,entry);}for(const [g,[v,p,r]] of [...groups].slice(-6))table.append(el('tr',{},el('td',{text:`${name} ${g}`}),el('td',{text:fmt(v)}),el('td',{text:fmt(p)}),el('td',{text:fmt(r)})));}
 $('period-table').replaceChildren(table);
 const hours=byDim(rows,'hour'),hourValues=Array.from({length:24},(_,h)=>hours.find(([k])=>+k===h)?.[1]||0);barChart($('chart-hours'),hourValues.map((_,h)=>String(h)),[{name:'Seitenaufrufe',values:hourValues}],{height:260});
 const weekdays=byDim(rows,'weekday'),weekValues=WEEKDAYS.map((_,d)=>weekdays.find(([k])=>+k===d)?.[1]||0);barChart($('chart-weekdays'),WEEKDAYS,[{name:'Seitenaufrufe',values:weekValues}],{height:260});
 $('tech').replaceChildren(barList('Gerät',byDim(rows,'device'),k=>({mobile:'Handy/Tablet',desktop:'Computer'})[k]||k),barList('Browser',byDim(rows,'browser')),barList('Betriebssystem',byDim(rows,'os')),barList('Sprache',byDim(rows,'lang'),k=>({de:'Deutsch',en:'Englisch'})[k]||k),barList('Start im Modus',byDim(rows,'pv'),k=>({route:'Routing',explore:'Entdecken'})[k]||k));
 const routeLabel=key=>{const [profile,pref]=key.split('|');return `${PROFILES[profile]||profile} · ${PREFS[pref]||pref}`;};
 const other=rows.filter(r=>['mode','view3d','shade','export','nav'].includes(r.metric)),otherMap=new Map();for(const r of other){const key=`${r.metric}|${r.dim}`;otherMap.set(key,(otherMap.get(key)||0)+r.n);}
 $('features').replaceChildren(barList('Routen nach Profil und Gehweise',byDim(rows,'route'),routeLabel),barList('Fehlgeschlagene Routen (Grund)',byDim(rows,'route_fail')),barList('Analyse-Filter',byDim(rows,'filter')),barList('Kartenebenen',byDim(rows,'layer')),barList('Weitere Funktionen',[...otherMap].sort((a,b)=>b[1]-a[1]),k=>FEATURE_LABELS[k]||k));
 const known=[...Object.keys(FEATURE_LABELS),...Object.keys(PROFILES).map(p=>'profile|'+p)],used=new Set([...otherMap.keys(),...byDim(rows,'route').map(([k])=>'profile|'+k.split('|')[0])]);
 $('unused').textContent=known.filter(k=>!used.has(k)).map(k=>FEATURE_LABELS[k]||('Profil '+PROFILES[k.split('|')[1]])).join(' · ')||'Alle erfassten Funktionen wurden genutzt.';
 const name=id=>districtNames[id]||`Bezirk ${id}`;
 $('districts-analysis').replaceChildren(barList('Ausgewählte Bezirke',byDim(rows,'district'),name));
 $('districts-routes').replaceChildren(barList('Start/Ziel im Bezirk',byDim(rows,'route_area'),name));
 renderHeatmap(byDim(rows,'view'));
 renderSecurity(data.security||[]);renderSettings(data.settings||{});
}
function renderHeatmap(cells){
 const box=$('heatmap');box.replaceChildren();if(!cells.length){box.append(el('p',{class:'muted',text:'Noch keine Daten.'}));return;}
 const parsed=cells.map(([key,n])=>{const [x,y]=key.split('_').map(Number);return {x,y,n};}),xs=parsed.map(c=>c.x),ys=parsed.map(c=>c.y),minX=Math.min(...xs,-11),maxX=Math.max(...xs,11),minY=Math.min(...ys,-10),maxY=Math.max(...ys,10),max=Math.max(...parsed.map(c=>c.n)),size=12;
 const svg=svgEl('svg',{viewBox:`0 0 ${(maxX-minX+1)*size} ${(maxY-minY+1)*size}`,role:'img'});
 svg.append(svgEl('rect',{x:0,y:0,width:(maxX-minX+1)*size,height:(maxY-minY+1)*size,fill:'#f3f6f8'}));
 for(const c of parsed){const rect=svgEl('rect',{x:(c.x-minX)*size,y:(maxY-c.y)*size,width:size-1,height:size-1,fill:'#1a56c4','fill-opacity':(.15+.85*c.n/max).toFixed(2)});rect.append(svgEl('title'));rect.firstChild.textContent=`${fmt(c.n)} Ansichten`;svg.append(rect);}
 box.append(svg);
}
function renderSecurity(events){
 const table=el('table');table.append(el('tr',{},el('th',{text:'Zeit'}),el('th',{text:'Ereignis'}),el('th',{text:'Detail'})));
 for(const e of events)table.append(el('tr',{},el('td',{text:new Date(e.ts).toLocaleString('de-DE')}),el('td',{text:e.kind}),el('td',{text:e.detail||''})));
 if(!events.length)table.append(el('tr',{},el('td',{text:'Keine Ereignisse.',colspan:'3'})));
 $('security').replaceChildren(table);
}
function renderSettings(settings){
 const box=$('settings');box.replaceChildren();
 const toggle=(key,title,text)=>{const button=el('button',{type:'button',class:settings[key]?'on':''});button.textContent=settings[key]?'Eingeschaltet':'Aus';button.onclick=async()=>{if(!confirm(`${title}: ${settings[key]?'ausschalten':'einschalten'}?`))return;await save({[key]:!settings[key]});};return el('div',{class:'setting'},el('div',{},el('strong',{text:title}),el('p',{text})),button);};
 const retention=el('input',{type:'number',min:'30',max:'760',value:String(settings.retentionDays||760),'aria-label':'Aufbewahrung in Tagen'});retention.onchange=()=>save({retentionDays:Math.round(+retention.value)});
 box.append(toggle('maintenance','Wartungsmodus','Besucher sehen eine Wartungsseite; die Verwaltung bleibt erreichbar.'),toggle('browserRouting','Notfall: Routing im Browser','Alle Routen werden im Browser berechnet, ohne Server (wirkt in etwa 30 Sekunden).'),el('div',{class:'setting'},el('div',{},el('strong',{text:'Aufbewahrung der Statistik'}),el('p',{text:'Tage (30–760). Ältere Tageswerte werden nachts gelöscht.'})),retention));
}
async function save(change){
 try{const response=await fetch('/api/admin/settings',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json','X-Sonnenpfad-Admin':'1'},body:JSON.stringify(change)});if(!response.ok)throw Error(response.status);renderSettings(await response.json());notice('Gespeichert.');}catch(error){notice('Speichern fehlgeschlagen: '+error.message);}
}

function renderServer(data){
 const box=$('server');box.replaceChildren();
 if(!data.configured){box.append(el('p',{class:'muted',text:'Server-Messwerte sind noch nicht verbunden (OPS_URL / OPS_TOKEN).'}));return;}
 if(!data.reachable){box.append(el('p',{},el('span',{class:'status bad',text:'Server nicht erreichbar'}),document.createTextNode(` ${data.status||data.error||''}`)));return;}
 const m=data.metrics,gauge=(title,value,pct,small)=>{const meter=el('div',{class:'meter'},el('i'));meter.firstChild.style.width=`${Math.min(100,pct||0)}%`;meter.firstChild.style.background=pct>85?'#c62828':pct>70?'#e98437':'#1a56c4';return el('div',{class:'gauge'},el('small',{text:title}),el('b',{text:value}),meter,el('small',{text:small||''}));};
 const age=Math.round((Date.now()-Date.parse(m.time))/60000);
 box.append(el('p',{class:'muted',text:`Stand ${new Date(m.time).toLocaleString('de-DE')} (${age} min alt) · Abruf ${data.fetchMs} ms · ${m.host}`}));
 const grid=el('div',{class:'server-grid'});
 grid.append(gauge('CPU',`${m.cpu_pct} %`,m.cpu_pct,`Last ${m.load.join(' / ')}`),gauge('Arbeitsspeicher',`${m.mem.pct} %`,m.mem.pct,`${fmt(m.mem.used_mb)} von ${fmt(m.mem.total_mb)} MB`),gauge('Festplatte',`${m.disk.pct} %`,m.disk.pct,`${m.disk.used_gb} von ${m.disk.total_gb} GB`),gauge('Netzwerk',`↓ ${m.net.rx_kbs} · ↑ ${m.net.tx_kbs} kB/s`,0,'Mittel der letzten 5 Minuten'),gauge('Laufzeit',`${Math.floor(m.uptime_s/86400)} Tage`,0,`seit ${new Date(Date.now()-m.uptime_s*1000).toLocaleDateString('de-DE')}`),gauge('Datenbank',`${fmt(m.db.size_mb)} MB`,0,`${m.db.connections} Verbindungen`),gauge('Routing-API (1 h)',`${fmt(m.api.requests_1h)} Anfragen`,0,`Median ${m.api.p50_ms ?? '–'} ms · 95 % ${m.api.p95_ms ?? '–'} ms`),gauge('Fehler (1 h)',`${fmt(m.api.errors_1h)}`,0,`busy/Überlast: ${fmt(m.api.busy_1h)} · 5xx: ${fmt(m.api.status_5xx_1h)}`));
 box.append(grid);
 const services=el('p');for(const [name,state] of Object.entries(m.services||{}))services.append(el('span',{class:`status ${state==='active'?'ok':'bad'}`,text:`${name}: ${state}`}),document.createTextNode('   '));
 const backup=m.backup||{},backupAge=backup.last_time?Math.round((Date.now()-Date.parse(backup.last_time))/3600000):null;
 services.append(el('span',{class:`status ${backup.last_result==='success'&&backupAge!==null&&backupAge<30?'ok':'warn'}`,text:`Backup: ${backup.last_result||'unbekannt'}${backupAge!==null?` vor ${backupAge} h`:''}`}));
 box.append(el('h3',{text:'Dienste'}),services);
 const history=m.history||[];
 if(history.length>2){const holder=el('div',{class:'chart'});box.append(el('h3',{text:'Verlauf (CPU %, RAM %, Anfragen je 5 min)'}),holder);const labels=history.map(h=>new Date(h.t).toLocaleString('de-DE',{day:'2-digit',hour:'2-digit'}));barChart(holder,labels,[{name:'CPU %',values:history.map(h=>h.cpu)},{name:'RAM %',values:history.map(h=>h.mem)},{name:'API-Anfragen',values:history.map(h=>h.req)}],{height:120});}
}

async function load(){
 notice('');const days=$('days').value;
 try{const index=await getJSON('/city/planner/districts.json');districtNames=Object.fromEntries(index.districts.map(d=>[d.id,d.name]));}catch{}
 try{const data=await getJSON(`/api/admin/summary?days=${days}`);if(!data.configured)notice('Die Statistik-Datenbank ist noch nicht verbunden (D1-Bindung „DB“).');else renderUsage(data);}catch(error){notice('Statistik konnte nicht geladen werden: '+error.message);}
 try{renderServer(await getJSON('/api/admin/server'));}catch(error){$('server').textContent='Server-Messwerte konnten nicht geladen werden: '+error.message;}
}
$('refresh').onclick=load;$('days').onchange=load;
load();setInterval(()=>{if(document.visibilityState==='visible')load();},60000);
// Inactivity: after 30 minutes without interaction the session ends (Cloudflare Access logout).
let idleTimer;const idle=()=>{clearTimeout(idleTimer);idleTimer=setTimeout(()=>{location.href='/cdn-cgi/access/logout';},30*60000);};
for(const type of ['pointerdown','keydown','scroll'])addEventListener(type,idle,{passive:true});idle();
