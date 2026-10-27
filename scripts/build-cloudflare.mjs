import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {buildDisplayAssets} from './build-display-assets.mjs';

const root = path.resolve(import.meta.dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

const core = read('scripts/core.mjs')
  .replaceAll('export const ', 'const ')
  .replaceAll('export function ', 'function ')
  .replaceAll('export class ', 'class ');
const worker = read('scripts/worker.mjs').split('\n').filter(line=>!line.startsWith('import ')).join('\n');
const serverRouting = read('scripts/server-routing.mjs').replaceAll('export const ', 'const ').replaceAll('export function ', 'function ').replaceAll('export async function ', 'async function ');
const appData = read('scripts/app-data.mjs').replaceAll('export function ', 'function ');
const weather = read('scripts/weather.mjs')
  .replaceAll('export const ', 'const ')
  .replaceAll('export function ', 'function ')
  .replaceAll('export async function ', 'async function ');
const experience = ['aerial-cache.mjs','shadow-display.mjs','terrain-heightfield.mjs','route-experience.mjs','display-data.mjs','basemap-style.mjs','city-scene.mjs','boundary-projection.mjs'].map(name=>read('scripts/'+name).replace(/^import .*$/gm,'').replaceAll('export const ', 'const ').replaceAll('export function ', 'function ').replaceAll('export async function ', 'async function ')).join('\n');
const application = `${experience}\n${serverRouting}\n${read('scripts/app.source.mjs')}\n${read('scripts/map-experience.mjs')}`;
const workerSource = `${core}\n${serverRouting}\n${worker}`;

fs.mkdirSync(path.join(root, 'dist/vendor'), { recursive: true });
fs.writeFileSync(
  path.join(root, 'dist/app-v7.mjs'),
  `import * as maplibregl from './vendor/maplibre-gl.mjs';\nlet THREE;\nmaplibregl.setWorkerUrl(new URL('./vendor/maplibre-gl-worker.mjs',import.meta.url).href);\n${appData}\n${weather}\nconst BUNDLED_DISPLAY_WORKER=${JSON.stringify(core+'\n'+read('scripts/shadow-display.mjs').replaceAll('export function ','function ')+'\n'+read('scripts/shadow-worker.mjs').replace(/^import .*$/gm,''))};\nconst BUNDLED_WORKER=${JSON.stringify(workerSource)};\nconst BUNDLED_POI_ICONS=${read('dist/poi-icons.json')};\n${application}`,
);
// A new source revision must not reuse a cached app/style URL on the branch
// preview alias. The index itself is always revalidated.
const assetHash=filename=>crypto.createHash('sha256').update(fs.readFileSync(path.join(root,filename))).digest('hex').slice(0,16);
const index=read('dist/index.html').replace(/app-v7\.mjs\?v=[^"\s]+/g,`app-v7.mjs?v=${assetHash('dist/app-v7.mjs')}`).replace(/style\.css\?v=[^"\s]+/g,`style.css?v=${assetHash('dist/style.css')}`);
fs.writeFileSync(path.join(root,'dist/index.html'),index);

const vendors=JSON.parse(read('assets/vendor/versions.json'));
for(const [name,definition] of Object.entries(vendors.files)){
 const bytes=Buffer.concat(definition.parts.map(part=>fs.readFileSync(path.join(root,'assets/vendor',part))));
 if(crypto.createHash('sha256').update(bytes).digest('hex')!==definition.sha256)throw Error(`Vendor integrity failed: ${name}`);
 fs.writeFileSync(path.join(root,'dist/vendor',name),bytes);
}

for (const required of [
  'dist/index.html',
  'dist/style.css',
  'dist/city-config.json',
  'dist/data/manifest.json',
  'dist/dem/metadata.json',
  'dist/vendor/maplibre-gl.css',
]) {
  if (!fs.existsSync(path.join(root, required))) throw new Error(`Missing required asset: ${required}`);
}

console.log(`Cloudflare bundle ready (MapLibre ${vendors.maplibre}, Three.js ${vendors.three}).`);
const display=buildDisplayAssets(path.join(root,'dist/city'));
console.log(`Display assets ${display.revision}: tree tiles ${(display.stats.sceneBytes/1e6).toFixed(2)} MB instead of ${(display.stats.oldSceneBytes/1e6).toFixed(2)} MB of shadow obstacles; details are click-only.`);
