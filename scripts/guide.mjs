// "So funktioniert's": step-by-step help. Every control is shown with the symbol the app really uses,
// cloned or rebuilt from the live interface so the guide cannot drift from it.
export function guideContent(lang) {
 const de = lang === 'de', el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
 const key = (...children) => { const n = el('span', 'guide-key'); n.setAttribute('aria-hidden', 'true'); n.append(...children); return n; };
 const K = {
  text: text => key(text),
  glyph: cls => key(el('span', 'choice-glyph ' + cls)),
  svg: selector => { const s = document.querySelector(selector); return key(s ? s.cloneNode(true) : ''); },
  map: control => { const wrap = el('span', 'maplibregl-ctrl guide-map-key'), b = el('button', 'maplibregl-ctrl-' + control); b.tabIndex = -1; b.append(el('span', 'maplibregl-ctrl-icon')); wrap.setAttribute('aria-hidden', 'true'); wrap.append(b); return wrap; },
  point: end => { const n = el('span', 'point ' + (end ? 'end' : 'start'), end ? 'B' : 'A'); n.classList.add('guide-point'); n.setAttribute('aria-hidden', 'true'); return n; },
  poi: d => { const n = el('span', 'guide-poi'); n.style.background = d.color; const img = el('img'); img.alt = ''; img.src = poiIcons[d.icon] || ''; n.append(img); n.setAttribute('aria-hidden', 'true'); return n; },
  chip: color => { const n = el('span', 'guide-chip'); n.style.background = color; return n; },
 };
 // A line is text with {name} placeholders that are replaced by symbols.
 const line = (tag, text, keys = {}) => { const n = el(tag); for (const part of text.split(/(\{\w+\})/)) { const m = part.match(/^\{(\w+)\}$/); n.append(m && keys[m[1]] ? keys[m[1]] : part); } return n; };
 const steps = items => { const ol = el('ol', 'guide-steps'); for (const [title, text, keys] of items) { const li = el('li'); li.append(el('strong', '', title), line('p', text, keys)); ol.append(li); } return ol; };
 const list = items => { const ul = el('ul', 'guide-list'); for (const [text, keys] of items) ul.append(line('li', text, keys)); return ul; };
 const profiles = [['icon-walk', de ? 'Standard' : 'Standard', de ? 'normale Fußwege' : 'regular walking'],
  ['icon-wheelchair', de ? 'Rollstuhl' : 'Wheelchair', de ? 'ohne Treppen, Rolltreppen und Steigungen über 6 %' : 'no stairs, escalators or gradients above 6 %'],
  ['icon-power-wheelchair', de ? 'Elektrorollstuhl' : 'Power wheelchair', de ? 'wie Rollstuhl, verträgt etwas mehr Steigung' : 'like wheelchair, handles a little more gradient'],
  ['icon-walking-aid', de ? 'Stock oder Rollator' : 'Cane or walker', de ? 'flachere Wege, Bänke zum Ausruhen werden bevorzugt' : 'flatter paths, prefers benches for a rest'],
  ['icon-blind', de ? 'Blind oder sehbehindert' : 'Blind or low vision', de ? 'bevorzugt Ampeln mit Ton, Vibration oder Leitsystem' : 'prefers crossings with sound, vibration or tactile paving'],
  ['icon-stroller', de ? 'Kinderwagen' : 'Pushchair', de ? 'ohne Treppen, möglichst glatter Belag' : 'no stairs, smooth surfaces where possible'],
  ['icon-settings', de ? 'Eigene Einstellungen' : 'Custom settings', de ? 'du legst selbst fest, was gemieden wird' : 'you choose what to avoid']];

 const route = el('div', 'guide-pane');
 route.append(steps([
  [de ? 'Start und Ziel wählen' : 'Choose start and destination',
   de ? 'Tippe eine Adresse oder einen Ort in das Feld {a} Start und wähle einen Vorschlag. Dasselbe für {b} Ziel. Oder drück {pick} neben dem Feld und klick auf die Karte. Am Handy schiebst du die Karte unter das Kreuz und bestätigst mit {ok}, mit {cancel} brichst du ab.'
      : 'Type an address or place into {a} Start and pick a suggestion. Do the same for {b} Destination. Or press {pick} next to the field and click the map. On a phone, move the map under the cross and confirm with {ok}; {cancel} aborts.',
   { a: K.point(false), b: K.point(true), pick: K.text('⌖'), ok: K.text('✓'), cancel: K.text('×') }],
  [de ? 'Abkürzungen' : 'Shortcuts',
   de ? '{swap} tauscht Start und Ziel. {locate} rechts auf der Karte setzt deinen Standort als Start (der Browser fragt einmal um Erlaubnis).'
      : '{swap} swaps start and destination. {locate} on the right of the map sets your location as start (the browser asks once for permission).',
   { swap: K.text('⇅'), locate: K.text('⌖') }],
  [de ? 'Wie möchtest du gehen?' : 'How do you want to walk?',
   de ? '{direct} Direkt: kürzester passender Weg. {shade} Schatten: möglichst viel Schatten. {sun} Sonne: möglichst viel Sonne. Schatten und Sonne gelten für Datum und Uhrzeit unten auf der Karte.'
      : '{direct} Direct: shortest suitable way. {shade} Shade: as much shade as possible. {sun} Sun: as much sun as possible. Shade and sun use the date and time at the bottom of the map.',
   { direct: K.glyph('icon-direct'), shade: K.glyph('icon-shade'), sun: K.glyph('icon-sun') }],
  [de ? 'Für wen planst du?' : 'Who are you planning for?', de ? 'Tippe auf ein Symbol:' : 'Tap a symbol:', {}],
 ]));
 route.querySelector('.guide-steps li:last-child').append(list(profiles.map(([cls, name, text]) => ['{icon} ' + name + ': ' + text + '.', { icon: K.glyph(cls) }])),
  line('p', de ? 'Bei {custom} wählst du: Steigung {flat} egal, {up} bergauf meiden, {down} bergab meiden, {both} beides meiden. Ein Haken bei {stairs} Treppen, {esc} Rolltreppen, {surface} schlechter Oberfläche oder {wheel} „Rollstuhl: nein“ heißt: diese Wege meiden.'
   : 'With {custom} you choose: gradient {flat} any, {up} avoid uphill, {down} avoid downhill, {both} avoid both. A tick at {stairs} stairs, {esc} escalators, {surface} poor surface or {wheel} “wheelchair: no” means: avoid these ways.',
   { custom: K.glyph('icon-settings'), flat: K.svg('[data-slope="none"] svg'), up: K.svg('[data-slope="uphill"] svg'), down: K.svg('[data-slope="downhill"] svg'), both: K.svg('[data-slope="both"] svg'), stairs: K.glyph('icon-stairs'), esc: K.glyph('icon-escalator'), surface: K.glyph('icon-surface'), wheel: K.glyph('icon-wheelchair') }));
 route.querySelector('.guide-steps').append(...steps([
  [de ? 'Route berechnen' : 'Calculate the route',
   de ? 'Drück {go}. Änderst du danach Profil, Gehweise oder Uhrzeit, rechnet die App selbst neu.' : 'Press {go}. If you then change the profile, walking mode or time, the app recalculates by itself.',
   { go: K.text(de ? 'Route entdecken →' : 'Discover route →') }],
  [de ? 'Ergebnis lesen' : 'Read the result',
   de ? 'Oben stehen Gehzeit, Kilometer und Schattenanteil. Auf der Karte ist die Route {red} rot. {orange} Orange Stücke passen nicht zu deinem Profil (z. B. eine Treppe), die App sagt darunter warum. Die gestrichelte Linie führt vom gewählten Punkt zum nächsten Gehweg. Passt gar keine Route, siehst du trotzdem die bestmögliche mit dem Hinweis „Keine Route erfüllt dein Profil vollständig“.'
      : 'At the top you see walking time, kilometres and share of shade. On the map the route is {red} red. {orange} Orange pieces do not fit your profile (e.g. stairs); the app explains why below. The dashed line leads from your point to the nearest footway. If no route fits, you still get the best possible one with the note “No route fully meets your profile”.',
   { red: K.chip('#d7191c'), orange: K.chip('#f28c28') }],
  [de ? 'Höhenprofil' : 'Elevation profile',
   de ? 'Fahr mit Maus oder Finger über die Kurve. Ein blauer Pfeil zeigt dir die Stelle auf der Karte.' : 'Move the mouse or your finger along the curve. A blue arrow shows the spot on the map.', {}],
  [de ? 'Route ansehen und teilen' : 'Watch and share the route',
   de ? '{preview} fliegt die Strecke in 3D ab, mit Pause, Stopp und Tempo ×1, ×2, ×4. {fit} zeigt die ganze Route. {share} kopiert einen Link mit Start, Ziel und Einstellungen. Am Handy änderst du Start oder Ziel über den Stift in der unteren Leiste.'
      : '{preview} flies along the route in 3D, with pause, stop and speed ×1, ×2, ×4. {fit} shows the whole route. {share} copies a link with start, destination and settings. On a phone, change start or destination with the pencil in the bottom bar.',
   { preview: K.text(de ? '▶ 3D-Routenvorschau' : '▶ 3D route preview'), fit: K.text('⤢'), share: K.text(de ? 'Route als Link teilen ↗' : 'Share route link ↗') }],
 ]).children);

 const explore = el('div', 'guide-pane');
 explore.append(steps([
  [de ? 'Entdecken einschalten' : 'Switch to Explore',
   de ? 'Oben links auf der Karte {explore} tippen. Mit {routing} kommst du zurück, deine Route bleibt erhalten.' : 'Tap {explore} at the top left of the map. {routing} brings you back; your route is kept.',
   { explore: K.text(de ? 'Entdecken' : 'Explore'), routing: K.text('Routing') }],
  [de ? 'Kartenebenen öffnen' : 'Open map layers',
   de ? 'Drück {layers} rechts auf der Karte (oder „Kartenebenen wählen“). Mit {close} schließt du das Fenster wieder.' : 'Press {layers} on the right of the map (or “Choose map layers”). {close} closes the window.',
   { layers: K.text('◫'), close: K.text('×') }],
  [de ? 'Ein Linienthema wählen' : 'Choose one line theme',
   de ? 'Die Wege werden nach genau einem Thema eingefärbt. Eine Legende oben links erklärt die Farben:' : 'Paths are coloured by exactly one theme. A legend at the top left explains the colours:', {}],
 ]));
 const chips = d => { const n = el('span', 'guide-chips'); n.append(...(d.legend || []).map(([color]) => K.chip(color))); return n; };
 explore.querySelector('.guide-steps li:last-child').append(list(Object.values(THEME_DEFS).map(d => ['{chips} ' + d[lang] + ': ' + d[de ? 'deHelp' : 'enHelp'], { chips: chips(d) }])));
 explore.querySelector('.guide-steps').append(...steps([
  [de ? 'Orte einblenden' : 'Show places',
   de ? 'Unter „Barrierefreiheit & Komfort“ hakst du an, was du sehen willst:' : 'Under “Accessibility & comfort”, tick what you want to see:', {}],
 ]).children);
 explore.querySelector('.guide-steps li:last-child').append(list(POI_DEFS.map(d => ['{icon} ' + d[lang], { icon: K.poi(d) }])),
  line('p', de ? 'Ampeln haben vier Farben: ' : 'Signal crossings have four colours: '),
  list(Object.values(CROSSING_CLASSES).map(c => ['{chip} ' + c[lang] + ': ' + c[de ? 'deRule' : 'enRule'], { chip: K.chip(c.color) }])));
 explore.querySelector('.guide-steps').append(...steps([
  [de ? 'Details ansehen' : 'See details',
   de ? 'Klick auf einen Weg oder ein Symbol. Ein Fenster zeigt alles, was der Atlas dazu weiß, etwa Steigung, Belag, Breite oder Ausstattung einer Ampel. {close} schließt es.' : 'Click a path or a symbol. A window shows what the atlas knows, such as gradient, surface, width or the equipment of a crossing. {close} closes it.',
   { close: K.text('×') }],
  [de ? 'Stadt in 3D' : 'City in 3D',
   de ? '{d3} oder „Stadt in 3D ansehen“ zeigt Gelände, Gebäude, Bäume und ihre Schatten zur gewählten Uhrzeit.' : '{d3} or “View city in 3D” shows terrain, buildings, trees and their shadows at the chosen time.',
   { d3: K.text('3D') }],
 ]).children);

 const tools = el('div', 'guide-pane');
 tools.append(list([
  [de ? '{zin} {zout} hinein- und herauszoomen. Auf der Karte geht das auch mit Mausrad oder zwei Fingern.' : '{zin} {zout} zoom in and out. Mouse wheel or two fingers work too.', { zin: K.map('zoom-in'), zout: K.map('zoom-out') }],
  [de ? '{compass} dreht die Karte zurück nach Norden. Mit rechter Maustaste oder zwei Fingern kannst du sie drehen und neigen.' : '{compass} turns the map back to north. Right mouse button or two fingers rotate and tilt it.', { compass: K.map('compass') }],
  [de ? '{d3} wechselt zwischen flacher Karte und 3D-Ansicht.' : '{d3} switches between flat map and 3D view.', { d3: K.text('3D') }],
  [de ? 'Das Auswahlfeld oben rechts wechselt die Hintergrundkarte: OpenFreeMap, OSM Standard, Topografisch oder Luftbild.' : 'The menu at the top right changes the base map: OpenFreeMap, OSM standard, topographic or aerial image.', {}],
  [de ? 'Unten wählst du die Uhrzeit mit dem Schieberegler und das Datum im Kalender. {now} springt auf jetzt. Der kleine Kompass mit {sun} zeigt, aus welcher Richtung die Sonne gerade scheint.' : 'At the bottom, set the time with the slider and the date in the calendar. {now} jumps to now. The small compass with {sun} shows where the sun is shining from.', { now: K.text(de ? 'Jetzt' : 'Now'), sun: K.text('☀') }],
  [de ? 'Die Wetterzeile zeigt Temperatur, Wolken, Sonnenstrahlung und Wind für Stuttgart. Ist {weather} an, berücksichtigen Schatten- und Sonnenrouten die Wolken. {info} erklärt die Werte und die Quelle.' : 'The weather line shows temperature, clouds, sunshine and wind for Stuttgart. With {weather} on, shade and sun routes take the clouds into account. {info} explains the values and the source.', { weather: K.text(de ? 'Wetter' : 'Weather'), info: K.text('i') }],
  [de ? '{credits} unten rechts auf der Karte zeigt die Kartenquellen.' : '{credits} at the bottom right of the map shows the map sources.', { credits: K.text('i') }],
  [de ? '{lang} oben stellt die Sprache auf Englisch oder Deutsch um.' : '{lang} at the top switches between English and German.', { lang: K.text(de ? 'EN' : 'DE') }],
 ]));

 const panes = [[de ? 'Route planen' : 'Plan a route', route], [de ? 'Entdecken' : 'Explore', explore], [de ? 'Karte & Zeit' : 'Map & time', tools]];
 const tabs = el('div', 'segmented guide-tabs'), box = el('div');
 tabs.setAttribute('role', 'tablist');
 panes.forEach(([label, pane], i) => {
  const b = el('button', i ? '' : 'selected', label); b.type = 'button'; b.setAttribute('role', 'tab'); b.setAttribute('aria-selected', String(!i)); pane.hidden = i > 0;
  b.onclick = () => { panes.forEach(([, p], j) => { p.hidden = j !== i; tabs.children[j].classList.toggle('selected', j === i); tabs.children[j].setAttribute('aria-selected', String(j === i)); }); };
  tabs.append(b); box.append(pane);
 });
 const intro = el('p', 'guide-intro', de ? 'Sonnenpfad findet Fußwege in ganz Stuttgart: mit mehr Schatten, mehr Sonne oder passend zu deinen Bedürfnissen. So geht’s:' : 'Sonnenpfad finds walking routes across Stuttgart: with more shade, more sun or suited to your needs. Here is how:');
 const fragment = document.createDocumentFragment(); fragment.append(intro, tabs, box); return fragment;
}
