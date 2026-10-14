import fs from 'node:fs';
import path from 'node:path';

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
const experience = ['route-experience.mjs','sphere-trees.mjs','boundary-projection.mjs'].map(name=>read('scripts/'+name).replaceAll('export function ', 'function ')).join('\n');
const application = `${experience}\n${serverRouting}\n${read('scripts/app.source.mjs')}\n${read('scripts/map-experience.mjs')}`;
const workerSource = `${core}\n${serverRouting}\n${worker}`;

fs.mkdirSync(path.join(root, 'dist/vendor'), { recursive: true });
fs.writeFileSync(
  path.join(root, 'dist/app-v7.mjs'),
  `${appData}\n${weather}\nconst BUNDLED_WORKER=${JSON.stringify(workerSource)};\n${application}`,
);

const vendorParts = fs.readdirSync(path.join(root, 'assets/vendor'))
  .filter(name => name.startsWith('maplibre-v3.js.part-'))
  .sort();
if (!vendorParts.length) throw new Error('MapLibre source chunks are missing.');
fs.writeFileSync(
  path.join(root, 'dist/vendor/maplibre-v3.js'),
  vendorParts.map(name => fs.readFileSync(path.join(root, 'assets/vendor', name))).reduce((all, part) => Buffer.concat([all, part]), Buffer.alloc(0)),
);

for (const required of [
  'dist/index.html',
  'dist/style.css',
  'dist/city-config.json',
  'dist/data/manifest.json',
  'dist/dem/metadata.json',
  'dist/vendor/maplibre-v3.css',
]) {
  if (!fs.existsSync(path.join(root, required))) throw new Error(`Missing required asset: ${required}`);
}

console.log(`Cloudflare bundle ready (${vendorParts.length} vendor chunks).`);
