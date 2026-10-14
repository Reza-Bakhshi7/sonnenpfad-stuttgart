// Object heights come from immutable DEM assets, never the renderer's transient
// visible-tile cache. A missing/failed tile is an error, not a sea-level sample.
export function terrainTilePoint(lngLat, zoom=14) {
 const [lon,lat]=lngLat,n=2**zoom,sin=Math.sin(lat*Math.PI/180);
 const x=(lon+180)/360*n,y=(.5-Math.log((1+sin)/(1-sin))/(4*Math.PI))*n;
 return {x:Math.floor(x),y:Math.floor(y),u:x-Math.floor(x),v:y-Math.floor(y)};
}
export function interpolateDEMTile(tile,u,v) {
 const x=Math.max(0,Math.min(tile.width-1,u*tile.width)),y=Math.max(0,Math.min(tile.height-1,v*tile.height)),a=Math.floor(x),b=Math.floor(y),tx=x-a,ty=y-b;
 const at=(i,j)=>tile.heights[Math.min(j,tile.height-1)*tile.width+Math.min(i,tile.width-1)];
 return at(a,b)*(1-tx)*(1-ty)+at(a+1,b)*tx*(1-ty)+at(a,b+1)*(1-tx)*ty+at(a+1,b+1)*tx*ty;
}
export async function decodeDEMPNG(blob) {
 const image=await createImageBitmap(blob,{colorSpaceConversion:'none',premultiplyAlpha:'none'});
 const canvas=typeof OffscreenCanvas==='function'?new OffscreenCanvas(image.width,image.height):Object.assign(document.createElement('canvas'),{width:image.width,height:image.height});
 const context=canvas.getContext('2d',{willReadFrequently:true});context.drawImage(image,0,0);image.close();
 const rgba=context.getImageData(0,0,canvas.width,canvas.height).data,heights=new Float32Array(canvas.width*canvas.height);
 for(let i=0;i<heights.length;i++){const p=i*4;heights[i]=-10000+(rgba[p]*65536+rgba[p+1]*256+rgba[p+2])*.1;}
 return {width:canvas.width,height:canvas.height,heights};
}
export function createTerrainHeightfield({baseURL,zoom=14,exaggeration=1.3,loadTile,maxTiles=96,concurrency=6}) {
 const tiles=new Map(),pending=new Map(),samples=new Map(),queue=[];let active=0;
 const pump=()=>{while(active<concurrency&&queue.length){const {task,resolve,reject}=queue.shift();active++;Promise.resolve().then(task).then(resolve,reject).finally(()=>{active--;pump();});}};
 const schedule=task=>new Promise((resolve,reject)=>{queue.push({task,resolve,reject});pump();});
 const readTile=loadTile||(async(x,y)=>{const response=await fetch(new URL(`${zoom}/${x}/${y}.png`,baseURL),{signal:AbortSignal.timeout(12000)});if(!response.ok)throw Error(`Terrain tile ${x}/${y}: ${response.status}`);return decodeDEMPNG(await response.blob());});
 const getTile=(x,y)=>{const key=`${x}/${y}`;if(tiles.has(key)){const tile=tiles.get(key);tiles.delete(key);tiles.set(key,tile);return Promise.resolve(tile);}if(pending.has(key))return pending.get(key);
  const request=schedule(()=>readTile(x,y)).then(tile=>{if(!tile?.heights||!tile.width||!tile.height)throw Error('Invalid DEM tile');tiles.set(key,tile);while(tiles.size>maxTiles)tiles.delete(tiles.keys().next().value);return tile;}).finally(()=>pending.delete(key));pending.set(key,request);return request;};
 const keyFor=point=>point.map(value=>Number(value).toFixed(8)).join(':');
 return {
  async sample(point){const key=keyFor(point);if(samples.has(key))return samples.get(key);const p=terrainTilePoint(point,zoom),tile=await getTile(p.x,p.y),height=interpolateDEMTile(tile,p.u,p.v)*exaggeration;if(!Number.isFinite(height))throw Error('Non-finite DEM height');samples.set(key,height);if(samples.size>100000)samples.delete(samples.keys().next().value);return height;},
  sampleMany(points){return Promise.all(points.map(point=>this.sample(point)));},
  peek(point){const key=keyFor(point);if(samples.has(key))return samples.get(key);const p=terrainTilePoint(point,zoom),tile=tiles.get(`${p.x}/${p.y}`);return tile?interpolateDEMTile(tile,p.u,p.v)*exaggeration:undefined;},
  get stats(){return {tiles:tiles.size,pending:pending.size,samples:samples.size};}
 };
}
