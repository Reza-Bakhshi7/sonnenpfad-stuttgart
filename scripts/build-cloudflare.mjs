import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

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
  .replaceAll('export function ', 'function ');
const experience = ['route-experience.mjs','terrain-heightfield.mjs','city-scene.mjs','boundary-projection.mjs'].map(name=>read('scripts/'+name).replace(/^import .*$/gm,'').replaceAll('export function ', 'function ').replaceAll('export async function ', 'async function ')).join('\n');
const application = `${experience}\n${serverRouting}\n${read('scripts/app.source.mjs')}\n${read('scripts/map-experience.mjs')}`;
const workerSource = `${core}\n${serverRouting}\n${worker}`;

fs.mkdirSync(path.join(root, 'dist/vendor'), { recursive: true });
fs.writeFileSync(
  path.join(root, 'dist/app-v7.mjs'),
  `import * as maplibregl from './vendor/maplibre-gl.mjs';\nlet THREE;\nmaplibregl.setWorkerUrl(new URL('./vendor/maplibre-gl-worker.mjs',import.meta.url).href);\n${appData}\n${weather}\nconst BUNDLED_WORKER=${JSON.stringify(workerSource)};\n${application}`,
);

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
