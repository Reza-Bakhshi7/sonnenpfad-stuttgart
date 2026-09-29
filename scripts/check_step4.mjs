import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const cityRoot = path.join(root, 'dist', 'city');
const manifest = JSON.parse(fs.readFileSync(path.join(cityRoot, 'manifest.json'), 'utf8'));
const appSource = fs.readFileSync(path.join(root, 'scripts', 'app.source.mjs'), 'utf8');
const expectedThemes = ['slope', 'surface', 'shadeSummer', 'shadeWinter', 'utciSummer', 'utciWinter', 'noise', 'wind'];

assert(!appSource.includes("getAttribute('aria-label')=t('layersTitle')"), 'Layer language setup must not assign to getAttribute().');
assert(appSource.includes("map.setMinZoom(is3D?15.25"), '3D zoom-out must be limited for performance.');
assert(appSource.includes('prepareRouteShade'), 'Long routes must load a complete shade corridor before routing.');
assert(appSource.includes('outsideLocation'), 'Out-of-city geolocation must use a dismissible message.');
assert(fs.existsSync(path.join(cityRoot, 'stuttgart-boundary.json')), 'Exact Stuttgart municipal boundary is required.');
const poiIcons = JSON.parse(fs.readFileSync(path.join(root, 'dist', 'poi-icons.json'), 'utf8'));
for (const icon of ['Signalized_Crossings.svg','Elevators.svg','Ramps.svg','Escalators.svg','Stairs.svg','Barriers_and_Gates.svg','Lowered_Curbs.svg','Raised_Curbs.svg','Benches.svg','Shelters.svg']) assert.match(poiIcons[icon], /^data:image\/svg\+xml;base64,/, `Missing embedded atlas POI icon: ${icon}`);
assert.equal(manifest.version, 4);
assert.deepEqual(manifest.themes, expectedThemes);
assert.equal(Object.keys(manifest.poiTypes).length, 10);

let lines = 0;
let pois = 0;
const poiTypes = new Set();
for (const tile of Object.values(manifest.obstacles.tiles)) {
  const payload = JSON.parse(fs.readFileSync(path.join(cityRoot, tile.file), 'utf8'));
  assert.equal(payload.lines.length, payload.edgeIds.length);
  assert.equal(payload.lines.length, payload.themes.length);
  assert.equal(payload.pois.length, tile.pois);
  for (const theme of payload.themes) assert.equal(theme.length, expectedThemes.length);
  for (const poi of payload.pois) {
    assert.equal(poi.p.length, 2);
    poiTypes.add(poi.k);
  }
  lines += payload.lines.length;
  pois += payload.pois.length;
}

assert.equal(lines, manifest.counts.lines);
assert.equal(pois, manifest.counts.pois);
assert.equal(poiTypes.size, 10);
assert.ok(pois > 13_000);
console.log(`Step 4 tile contract verified: ${lines} lines, ${pois} POIs, ${poiTypes.size} POI types`);
