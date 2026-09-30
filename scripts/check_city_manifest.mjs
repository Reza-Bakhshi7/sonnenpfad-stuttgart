import assert from 'node:assert/strict';
import { parseCityManifest } from './app-data.mjs';

const valid = {
  version: 5,
  scope: 'city',
  origin: [9.03, 48.69],
  scale: [73000, 111000],
  bounds: [9.03, 48.69, 9.32, 48.87],
  network: {
    nodes: 'network/nodes.bin',
    nodeCount: 224121,
    edges: 'network/edges.bin',
    edgeCount: 248725,
    edgeStride: 48,
    snapIndex: 'network/snap-index.json',
  },
  obstacles: { grid: 1000, tiles: {} },
  themes: ['slope', 'surface', 'shadeSummer', 'shadeWinter', 'utciSummer', 'utciWinter', 'noise', 'wind'],
  poiTypes: {1:'crossing',2:'elevator',3:'ramp',4:'escalator',5:'stairs',6:'barrier',7:'loweredKerb',8:'raisedKerb',9:'bench',10:'shelter'},
};

assert.deepEqual(parseCityManifest(JSON.stringify(valid)), valid);
const chunked = { ...valid, network: { ...valid.network, nodes: ['network/nodes-000.bin', 'network/nodes-001.bin'], edges: ['network/edges-000.bin'], snapIndex: ['network/snap-index-000.json'] } };
assert.deepEqual(parseCityManifest(JSON.stringify(chunked)), chunked);
assert.equal(parseCityManifest('<!doctype html><title>Sonnenpfad</title>'), null);
assert.equal(parseCityManifest('{"scope":"city"'), null);
assert.equal(parseCityManifest(JSON.stringify({ ...valid, network: { edgeCount: 1 } })), null);
assert.equal(parseCityManifest(JSON.stringify({ ...valid, scope: 'pilot' })), null);
assert.equal(parseCityManifest(JSON.stringify({ ...valid, version: 4 })), null);
assert.equal(parseCityManifest(JSON.stringify({ ...valid, themes: [] })), null);

console.log('City manifest fallback verification passed');
