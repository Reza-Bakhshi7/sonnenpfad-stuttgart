import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const cityRoot = path.join(root, 'dist', 'city');
const manifest = JSON.parse(fs.readFileSync(path.join(cityRoot, 'manifest.json'), 'utf8'));
const expectedThemes = ['slope', 'surface', 'shadeSummer', 'shadeWinter', 'utciSummer', 'utciWinter', 'noise', 'wind'];

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
