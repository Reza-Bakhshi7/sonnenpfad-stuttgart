import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {DISPLAY_THEME_KEYS,DISPLAY_THEME_NAMES} from './display-data.mjs';

// Run against the checked-out authoritative assets on every build. The original
// manifest, graph, DEM, POI details and shadow tiles are deliberately immutable.
export function buildDisplayAssets(cityDirectory) {
 const manifest=JSON.parse(fs.readFileSync(path.join(cityDirectory,'manifest.json'),'utf8'));
 const read=file=>JSON.parse(fs.readFileSync(path.join(cityDirectory,file),'utf8'));
 const bytes=file=>file?fs.readFileSync(path.join(cityDirectory,file)):new Uint8Array();
 const directions=bytes(manifest.visual?.slopeDirections),steps=bytes(manifest.visual?.stepFlags),structures=bytes(manifest.visual?.structureFlags),poiDetails=manifest.visual?.poiDetails?read(manifest.visual.poiDetails):{};
 const out=path.join(cityDirectory,'visual');fs.rmSync(out,{recursive:true,force:true});fs.mkdirSync(out,{recursive:true});
 const hash=crypto.createHash('sha256'),stats={paths:0,trees:0,pois:0,detailRecords:0,displayBytes:0,sceneBytes:0,oldSceneBytes:0,themeBytes:0,detailBytes:0},tiles={};
 const write=(file,data)=>{const content=JSON.stringify(data),filename=path.join(cityDirectory,file);fs.mkdirSync(path.dirname(filename),{recursive:true});fs.writeFileSync(filename,content);hash.update(file).update(content);return Buffer.byteLength(content);};
 for(const [key,definition] of Object.entries(manifest.obstacles.tiles)) {
  const display=read(definition.displayFile||definition.file),shade=read(definition.shadeFile||definition.file),edgeIds=display.edgeIds||[],themes=display.themes||[],pathsFile=`visual/paths/${key}.json`,sceneFile=`visual/scene/${key}.json`,poiFile=`visual/pois/${key}.json`,detailFile=`visual/details/${key}.json`,themeFiles={};
  const flags=edgeIds.map(id=>[structures[id]||0,steps[id]||0,directions[id]||0]);
  stats.displayBytes+=write(pathsFile,{lines:display.lines||[],edgeIds,flags});stats.paths+=edgeIds.length;
  const trees=(shade.trees||[]).map(({p,r,h,evergreen})=>({p,r,h,...(evergreen?{evergreen:true}:{})}));
  stats.sceneBytes+=write(sceneFile,{trees});stats.trees+=trees.length;stats.oldSceneBytes+=fs.statSync(path.join(cityDirectory,definition.shadeFile||definition.file)).size;
  const poi=(display.pois||[]).map(({p,k,q})=>({p,k,...(q!==undefined?{q}:{}),detailKey:`${k}:${p[0].toFixed(2)}:${p[1].toFixed(2)}`}));
  stats.displayBytes+=write(poiFile,{pois:poi});stats.pois+=poi.length;
  for(const [index,name] of DISPLAY_THEME_NAMES.entries()){const file=`visual/themes/${name}/${key}.json`;themeFiles[name]=file;stats.themeBytes+=write(file,themes.map(values=>values[index]??null));}
  const detailPois=Object.fromEntries(poi.map(item=>[item.detailKey,poiDetails[item.detailKey]||{}]));
  const detailLines=Object.fromEntries(edgeIds.map((id,index)=>[id,{...Object.fromEntries(DISPLAY_THEME_KEYS.map((name,j)=>[name,themes[index]?.[j]??null])),st:flags[index][0],steps:flags[index][1]}]));
  stats.detailBytes+=write(detailFile,{pois:detailPois,lines:detailLines});stats.detailRecords+=Object.keys(detailPois).length;
  tiles[key]={pathsFile,sceneFile,poiFile,detailFile,themeFiles,trees:trees.length,pois:poi.length};
 }
 const visual={version:1,revision:hash.digest('hex').slice(0,16),grid:manifest.obstacles.grid,tiles,stats};
 fs.writeFileSync(path.join(out,'manifest.json'),JSON.stringify(visual));return visual;
}
