// Language contract: every interface text exists in German and English and lives in a dictionary,
// never as an inline `de ? '…' : '…'` choice in interface code.
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {UI_TEXT,OSM_VALUES,tr,mapLibreLocale} from './i18n.mjs';

const read=file=>fs.readFileSync(new URL(file,import.meta.url),'utf8');
const placeholders=text=>[...String(text).matchAll(/\{(\w+)\}/g)].map(match=>match[1]).sort().join(',');

// 1. Central dictionary: same keys, no empty texts, identical {placeholders} in both languages.
assert.deepEqual(Object.keys(UI_TEXT.de).sort(),Object.keys(UI_TEXT.en).sort(),'UI_TEXT de/en keys differ');
for(const key of Object.keys(UI_TEXT.de)){
 for(const language of ['de','en'])assert(String(UI_TEXT[language][key]).trim(),`empty ${language} text for ${key}`);
 assert.equal(placeholders(UI_TEXT.de[key]),placeholders(UI_TEXT.en[key]),`placeholders differ for ${key}`);
}
assert.deepEqual(Object.keys(OSM_VALUES.de).filter(key=>!(key in OSM_VALUES.en)&&!/^[a-z_]+$/.test(key)),[],'OSM value without English display name');
assert.equal(tr('plannerSections',{count:3,km:'1,2',parts:'',gaps:''},'en'),'3 sections · 1,2 km');
assert.equal(Object.values(mapLibreLocale('de')).every(Boolean),true);

// 2. Legacy `strings` table in app.source.mjs: German and English carry the same keys.
const app=read('./app.source.mjs');
const legacy=app.split('\n').filter(line=>/^(const strings=|Object\.assign\(strings\.(de|en)|strings\.(de|en)\.)/.test(line)||/^Object\.assign\(strings\.de,.*\);Object\.assign\(strings\.en/.test(line)).join('\n');
const context={};vm.runInNewContext(legacy+';this.strings=strings;',context);
const missing=language=>Object.keys(context.strings[language==='de'?'en':'de']).filter(key=>!(key in context.strings[language]));
assert.deepEqual(missing('de'),[],'strings.de lacks keys');assert.deepEqual(missing('en'),[],'strings.en lacks keys');
const known=key=>key in UI_TEXT.de||key in context.strings.de;

// 3. Interface modules choose no language inline and only use existing keys.
const modules=['./app.source.mjs','./map-experience.mjs','./mobile-experience.mjs','./planner.mjs','./navigation.mjs'];
for(const file of modules){
 const source=read(file);
 const inline=[...source.matchAll(/(?<![\w$.])(?:lang\s*===?\s*'de'|de)\s*\?\s*['"`]/g)].map(match=>source.slice(match.index,match.index+60));
 assert.deepEqual(inline,[],`${file}: inline language choice, move the text to i18n.mjs`);
 for(const [,key] of source.matchAll(/\btr\('(\w+)'[,)]/g))assert(key in UI_TEXT.de,`${file}: unknown tr key ${key}`);
}

// 4. Static page: every data-i* key resolves; visible German texts carry a key.
const html=read('../dist/index.html');
for(const [,key] of html.matchAll(/data-i(?:-aria|-title|-placeholder)?="(\w+)"/g))assert(known(key),`index.html: unknown key ${key}`);
// German wording (umlauts or common interface words) in an attribute needs its own key on the same tag.
const germanWords=/[äöüßÄÖÜ]|(Karte|Mein|Standort|Schatten|Route|Rollstuhl|Kinderwagen|Steigung|Bergauf|Bergab|Stock|Blind|Eigene|Start|Ziel|Kartenebenen|Sonnen|Schließen|Auswahl)/;
for(const tag of html.match(/<[a-z][^>]*>/gi))for(const [attribute,key] of [['placeholder','placeholder'],['title','title'],['aria-label','aria']]){
 const value=tag.match(new RegExp(` ${attribute}="([^"]*)"`))?.[1];
 if(value&&germanWords.test(value))assert(tag.includes(`data-i-${key}=`),`index.html: ${attribute}="${value}" has no data-i-${key} key`);
}

console.log(`Language contract verified: ${Object.keys(UI_TEXT.de).length} dictionary texts and ${Object.keys(context.strings.de).length} legacy texts in German and English, no inline language choices in the interface code.`);
