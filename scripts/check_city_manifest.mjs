import assert from 'node:assert/strict';
import { parseCityManifest } from './app-data.mjs';

const valid = {
  version: 2,
  scope: 'city',
  origin: [9.03, 48.69],
  scale: [73000, 111000],
  bounds: [9.03, 48.69, 9.32, 48.87],
  network: {
    nodes: 'network/nodes.bin',
    nodeCount: 224121,
    edges: 'network/edges.bin',
    edgeCount: 248725,
    snapIndex: 'network/snap-index.json',
  },
  obstacles: { grid: 1000, tiles: {} },
};

assert.deepEqual(parseCityManifest(JSON.stringify(valid)), valid);
assert.equal(parseCityManifest('<!doctype html><title>Sonnenpfad</title>'), null);
assert.equal(parseCityManifest('{"scope":"city"'), null);
assert.equal(parseCityManifest(JSON.stringify({ ...valid, network: { edgeCount: 1 } })), null);
assert.equal(parseCityManifest(JSON.stringify({ ...valid, scope: 'pilot' })), null);

console.log('City manifest fallback verification passed');
