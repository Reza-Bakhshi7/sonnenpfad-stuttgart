import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {buildAdj, route} from './core.mjs';

const root=path.resolve(import.meta.dirname,'..');
const source=fs.readFileSync(path.join(root,'scripts/app.source.mjs'),'utf8');
const styles=fs.readFileSync(path.join(root,'dist/style.css'),'utf8');
const manifest=JSON.parse(fs.readFileSync(path.join(root,'dist/city/manifest.json'),'utf8'));
const steps=fs.readFileSync(path.join(root,'dist/city',manifest.visual.stepFlags));
const poiDetails=JSON.parse(fs.readFileSync(path.join(root,'dist/city',manifest.visual.poiDetails),'utf8'));

assert.equal([...steps].filter(Boolean).length,7893,'stairs must follow the atlas display class, not the broad historic/current union');
assert(source.includes("display_class == \"steps\"")===false,'Python staircase rule must not be accidentally embedded in the client');
assert(source.includes("fill-extrusion-opacity':.74"),'3D trees must remain see-through');
assert(source.includes('tree.r*.7')&&source.includes('tree.h*.7'),'fallback tree dimensions must be 30% smaller');
assert(source.includes("slices=zoom<15.6?8:zoom<16.4?10:12"),'tree crowns must use rounded multi-slice geometry');
assert(source.includes('function installFeatureCards'),'desktop feature cards must be installed');
assert(source.includes('poiDetails[key]||{}'),'compact POI details must enrich existing visual tiles');
assert(source.includes("innerWidth<=800||!matchMedia('(hover:hover) and (pointer:fine)').matches"),'feature cards must stay disabled on mobile/coarse pointers');
assert(source.includes('Quelle: Fußgängeratlas Stuttgart')&&source.includes('Source: Stuttgart Pedestrian Atlas'),'detail cards must expose provenance');
assert(styles.includes('.feature-card')&&styles.includes('.feature-hover'),'feature card styling is required');

let poiCount=0;
for(const tile of Object.values(manifest.obstacles.tiles)){
  const display=JSON.parse(fs.readFileSync(path.join(root,'dist/city',tile.displayFile),'utf8'));
  for(const poi of display.pois){
    assert(!Object.hasOwn(poi,'n'),'meaningless POI names must not be exported');
    assert(poi.src,'each POI must expose its source');
    poiCount++;
  }
  const shade=JSON.parse(fs.readFileSync(path.join(root,'dist/city',tile.shadeFile),'utf8'));
  for(const tree of shade.trees){
    assert(Math.abs(tree.dh-tree.h*.7)<=.051);
    assert(Math.abs(tree.dr-tree.r*.7)<=.051);
  }
}
assert.equal(poiCount,manifest.counts.pois);
assert(Object.keys(poiDetails).length>=manifest.counts.pois-10,'coordinate-identical POIs may share one detail record, but coverage must exceed 99.9%');

const network={nodes:[[0,0],[100,0]],edges:[{a:0,b:1,c:[[0,0],[100,0]],l:100,s:0,sf:0,dz:0,z0:250,z1:250,steps:false,escalator:false,dir:0,surface:1,way:1,width:2,wheelchair:1}]};
const adj=buildAdj(network);
assert.equal(route(network,adj,[0],[50,31],[80,0]).error,'outside','default snapping must reject invented access links beyond 30 m');
assert(!route(network,adj,[0],[50,30],[80,0]).error,'the documented 30 m access limit must remain inclusive');

console.log(`Optimisation verification passed: ${steps.filter(Boolean).length} stair subedges, ${poiCount} sourced POIs, 30% smaller transparent trees.`);
