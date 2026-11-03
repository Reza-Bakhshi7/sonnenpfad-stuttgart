// Benches, shelters and signal crossings from the city display tiles for the Stage-2 engine.
//   node scripts/export_poi_points.mjs   writes services/profile-api-v1/poi_points.json
// Positions are converted back from the app's local metres to WGS84; the engine projects them.
import fs from 'node:fs';
import path from 'node:path';

const root=path.resolve(import.meta.dirname,'..'),city=path.join(root,'dist/city'),manifest=JSON.parse(fs.readFileSync(path.join(city,'manifest.json'),'utf8'));
const kinds={1:'crossing',9:'bench',10:'shelter'},seen=new Set(),points=[];
for(const tile of Object.values(manifest.obstacles.tiles)){
 if(!tile.displayFile)continue;
 for(const poi of JSON.parse(fs.readFileSync(path.join(city,tile.displayFile),'utf8')).pois||[]){
  if(!kinds[poi.k])continue;
  const key=`${poi.k}:${poi.p[0]}:${poi.p[1]}`;if(seen.has(key))continue;seen.add(key);// tiles overlap
  points.push([poi.k,poi.k===1?poi.q||0:0,+(manifest.origin[0]+poi.p[0]/manifest.scale[0]).toFixed(8),+(manifest.origin[1]+poi.p[1]/manifest.scale[1]).toFixed(8)]);
 }
}
points.sort((a,b)=>a[0]-b[0]||a[2]-b[2]||a[3]-b[3]);
const counts=Object.fromEntries(Object.entries(kinds).map(([k,name])=>[name,points.filter(p=>p[0]===+k).length]));
fs.writeFileSync(path.join(root,'services/profile-api-v1/poi_points.json'),JSON.stringify({version:1,source:'dist/city display tiles',sourceDate:manifest.sourceDate,columns:['kind','crossing_class','lon','lat'],kinds,counts,points}));
console.log(counts);
