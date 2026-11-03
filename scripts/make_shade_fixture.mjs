// Reference shade values from the browser core for the Stage-2 port (services/profile-api-v1/test_shadows.py).
//   node scripts/make_shade_fixture.mjs   writes services/profile-api-v1/shade_fixture.json
import fs from 'node:fs';
import path from 'node:path';
import {sunPosition,makeShadows,edgeShades} from './core.mjs';

const root=path.resolve(import.meta.dirname,'..'),city=path.join(root,'dist/city'),manifest=JSON.parse(fs.readFileSync(path.join(city,'manifest.json'),'utf8'));
const key='0_0',tile=manifest.obstacles.tiles[key],obstacles=JSON.parse(fs.readFileSync(path.join(city,tile.shadeFile),'utf8'));
const read=files=>Buffer.concat(files.map(name=>fs.readFileSync(path.join(city,name))));
const nodes=read(manifest.network.nodes),edges=read(manifest.network.edges),stride=manifest.network.edgeStride;
const node=i=>[nodes.readFloatLE(i*8),nodes.readFloatLE(i*8+4)];
const display=JSON.parse(fs.readFileSync(path.join(city,tile.displayFile),'utf8'));
const chosen=display.edgeIds.filter((_,i)=>i%Math.ceil(display.edgeIds.length/400)===0).slice(0,400);
const lines=chosen.map(i=>({c:[node(edges.readUInt32LE(i*stride)),node(edges.readUInt32LE(i*stride+4))],covered:Boolean(edges.readUInt8(i*stride+29)&2)}));
const cases=[['2026-06-21T11:00:00Z',true],['2026-06-21T05:30:00Z',true],['2026-12-21T11:00:00Z',false],['2026-09-16T16:30:00Z',true]].map(([iso,leafOn])=>{
 const sun=sunPosition(new Date(iso),48.777,9.18),polys=makeShadows(obstacles,sun,leafOn);
 return {iso,epochMs:Date.parse(iso),leafOn,sun,shades:edgeShades(lines,polys,sun.altitude<=0)};
});
fs.writeFileSync(path.join(root,'services/profile-api-v1/shade_fixture.json'),JSON.stringify({tile:key,obstacles,lines,cases}));
console.log(`fixture: ${obstacles.buildings.length} buildings, ${obstacles.trees.length} trees, ${lines.length} edges, ${cases.length} times`);
