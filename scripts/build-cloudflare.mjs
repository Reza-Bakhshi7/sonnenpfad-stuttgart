import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

const core = read('scripts/core.mjs')
  .replaceAll('export const ', 'const ')
  .replaceAll('export function ', 'function ')
  .replaceAll('export class ', 'class ');
const worker = read('scripts/worker.mjs').split('\n').slice(1).join('\n');
const appData = read('scripts/app-data.mjs').replaceAll('export function ', 'function ');
const weather = read('scripts/weather.mjs')
  .replaceAll('export const ', 'const ')
  .replaceAll('export function ', 'function ');
const mapInteractions = read('scripts/map-interactions.mjs').replaceAll('export function ', 'function ');
const application = `${mapInteractions}\n${read('scripts/app.source.mjs')}`;
const workerSource = `${core}\n${worker}`;

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

