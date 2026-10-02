import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const cityRoot = path.join(root, 'dist', 'city');
const manifest = JSON.parse(fs.readFileSync(path.join(cityRoot, 'manifest.json'), 'utf8'));
const appSource = fs.readFileSync(path.join(root, 'scripts', 'app.source.mjs'), 'utf8');
const appStyles = fs.readFileSync(path.join(root, 'dist', 'style.css'), 'utf8');
const appHtml = fs.readFileSync(path.join(root, 'dist', 'index.html'), 'utf8');
const expected = { 0: 2092, 1: 251, 2: 1216, 3: 702 };
const counts = { 0: 0, 1: 0, 2: 0, 3: 0 };

for (const tile of Object.values(manifest.obstacles.tiles)) {
  const payload = JSON.parse(fs.readFileSync(path.join(cityRoot, tile.displayFile || tile.file), 'utf8'));
  for (const poi of payload.pois) {
    if (poi.k !== 1) continue;
    assert.ok(Object.hasOwn(counts, poi.q), `Unknown crossing class: ${poi.q}`);
    for (const field of ['q', 'a', 'v', 't', 'w', 'c', 'b']) {
      assert.ok(Number.isInteger(poi[field]), `Crossing ${field} must be a compact integer`);
    }
    counts[poi.q] += 1;
  }
}

assert.deepEqual(counts, expected);
assert.equal(Object.values(counts).reduce((sum, value) => sum + value, 0), 4261);
for (const color of ['#2E7D32', '#F9A825', '#C62828', '#9E9E9E']) {
  assert.ok(appSource.includes(color), `Missing atlas crossing colour ${color}`);
}
assert.ok(appSource.includes("const CROSSING_CLASSES="));
assert.ok(appSource.includes("['match',['get','q'],3,'poi-1-q3',2,'poi-1-q2',1,'poi-1-q1','poi-1-q0']"));
assert.ok(appSource.includes('Rollstuhleignung'));
assert.ok(appStyles.includes('.poi-toggle[data-kind="1"] .poi-symbol'));
assert.ok(appHtml.includes('id="crossing-legend"'));

console.log(`Crossing accessibility verified: ${JSON.stringify(counts)}`);
