import * as THREE from '../dist/vendor/three.mjs';
import {densifyRoute} from './route-experience.mjs';

// Keep all city geometry in metres around one origin. Convert the origin in the
// camera matrix, in double precision, before sending that matrix to the GPU.
export function createCityFrame(origin) {
 const earth=40075016.68557849;
 const mercator=([lon,lat])=>{const sin=Math.sin(lat*Math.PI/180);return [(lon+180)/360,.5-Math.log((1+sin)/(1-sin))/(4*Math.PI)];};
 const [x,y]=mercator(origin),unit=1/(earth*Math.cos(origin[1]*Math.PI/180));
 return {x,y,unit,point(point,height=0){const [px,py]=mercator(point),scale=1/(earth*Math.cos(point[1]*Math.PI/180));return [(px-x)/unit,(py-y)/unit,height*scale/unit];},radius(point,radius){return radius/(earth*Math.cos(point[1]*Math.PI/180))/unit;}};
}

export function mergeCityGeometry(geometries) {
 const result=new THREE.BufferGeometry();
 for(const name of ['position','normal']) {
  const count=geometries.reduce((sum,geometry)=>sum+geometry.getAttribute(name).array.length,0),data=new Float32Array(count);let offset=0;
  for(const geometry of geometries){const array=geometry.getAttribute(name).array;data.set(array,offset);offset+=array.length;}
  result.setAttribute(name,new THREE.BufferAttribute(data,3));
 }
 result.computeBoundingSphere();return result;
}

export function cityBuildingGeometry(building,frame,toLngLat,heights) {
 const rings=building.r.map(ring=>ring.map(point=>frame.point(toLngLat(point))));
 if(rings[0]?.length<4)return null;
 const shape=new THREE.Shape(rings[0].map(point=>new THREE.Vector2(point[0],point[1])));
 for(const ring of rings.slice(1))if(ring.length>=4)shape.holes.push(new THREE.Path(ring.map(point=>new THREE.Vector2(point[0],point[1]))));
 // Extend walls down to the lowest footprint sample, while keeping the roof
 // level and above the highest sample on sloping streets.
 const low=Math.min(...heights)-1,high=Math.max(...heights)+Math.max(2,Number(building.h)||8);
 const geometry=new THREE.ExtrudeGeometry(shape,{depth:high-low,bevelEnabled:false,steps:1});geometry.translate(0,0,low);geometry.deleteAttribute('uv');geometry.clearGroups();
 return geometry;
}

export function createCitySceneLayer({origin,toLngLat,dimensions,terrain,rendererFactory,treeCap=5000}) {
 const frame=createCityFrame(origin),scene=new THREE.Scene(),camera=new THREE.Camera(),objects=new THREE.Group();scene.add(objects);
 const ambient=new THREE.AmbientLight(0xffffff,.65),sun=new THREE.DirectionalLight(0xffffff,2);sun.position.set(-400,-600,900);scene.add(ambient,sun);
 const crownGeometry=new THREE.SphereGeometry(1,24,16),trunkGeometry=new THREE.CylinderGeometry(1,1,1,8);trunkGeometry.rotateX(Math.PI/2);
 const crownMaterial=new THREE.MeshLambertMaterial({color:0xffffff,transparent:true,opacity:.82,depthWrite:true}),trunkMaterial=new THREE.MeshLambertMaterial({color:0x795b3e,depthWrite:true}),buildingMaterial=new THREE.MeshLambertMaterial({color:0xe2e7e7,side:THREE.DoubleSide});
 const crowns=new THREE.InstancedMesh(crownGeometry,crownMaterial,treeCap),trunks=new THREE.InstancedMesh(trunkGeometry,trunkMaterial,treeCap);crowns.count=trunks.count=0;crowns.frustumCulled=trunks.frustumCulled=false;objects.add(crowns,trunks);
 const trees=new Map(),buildings=new Map(),pending=new Map(),batches=new Map(),dirtyBuckets=new Set(),instance=new THREE.Object3D(),colour=new THREE.Color();
 const localMatrix=new THREE.Matrix4().makeTranslation(frame.x,frame.y,0).scale(new THREE.Vector3(frame.unit,frame.unit,frame.unit)),projection=new THREE.Matrix4();
 let map,renderer,visible=false,disposed=false,rebuildQueued=false,route=null,routeVersion=0,routeSignature='',centre=[0,0],lastError=null,lastInput=null,retryTimer=null,retryAttempts=0,updateVersion=0;
 const geometryQueue=[];let geometryTimer=null;
 const buildBatch=()=>{geometryTimer=null;const started=performance.now();let count=0;while(geometryQueue.length&&count++<12&&performance.now()-started<6){const item=geometryQueue.shift();try{item.resolve(disposed?null:item.task());}catch(error){item.reject(error);}}if(geometryQueue.length)geometryTimer=setTimeout(buildBatch,0);};
 const buildGeometry=task=>new Promise((resolve,reject)=>{geometryQueue.push({task,resolve,reject});if(geometryTimer===null)geometryTimer=setTimeout(buildBatch,0);});
 const keyFor=point=>point.map(value=>Number(value).toFixed(2)).join(':');
 const bucketFor=point=>`${Math.floor(point[0]/500)}:${Math.floor(point[1]/500)}`;
 const queueRebuild=()=>{if(rebuildQueued||disposed)return;rebuildQueued=true;queueMicrotask(()=>{rebuildQueued=false;if(disposed)return;rebuild();map?.triggerRepaint();});};
 function rebuild() {
  let index=0;
  const visibleTrees=[...trees.values()].sort((a,b)=>distance(a.tree.p)-distance(b.tree.p));
  for(const record of visibleTrees) {
   if(index===treeCap)break;
   const {r,h}=dimensions(record.tree),radius=Math.max(.3,frame.radius(record.ll,Math.min(r,h*.48))),height=Math.max(radius*2,frame.radius(record.ll,h)),ground=record.ground;
   const canopyCentre=ground+Math.max(radius+.35,height-radius),trunkHeight=Math.max(.6,canopyCentre-ground-radius*.65),trunkRadius=Math.max(.12,Math.min(.28,r*.13));
   instance.position.set(record.xy[0],record.xy[1],canopyCentre);instance.scale.setScalar(radius);instance.updateMatrix();crowns.setMatrixAt(index,instance.matrix);
   colour.set(record.tree.evergreen?0x37694c:0x5c9164);crowns.setColorAt(index,colour);
   instance.position.set(record.xy[0],record.xy[1],ground+trunkHeight/2);instance.scale.set(trunkRadius,trunkRadius,trunkHeight);instance.updateMatrix();trunks.setMatrixAt(index,instance.matrix);index++;
  }
  crowns.count=trunks.count=index;crowns.instanceMatrix.needsUpdate=trunks.instanceMatrix.needsUpdate=true;if(crowns.instanceColor)crowns.instanceColor.needsUpdate=true;
  const grouped=new Map();for(const record of buildings.values())if(dirtyBuckets.has(record.bucket)){if(!grouped.has(record.bucket))grouped.set(record.bucket,[]);grouped.get(record.bucket).push(record.geometry);}
  for(const bucket of dirtyBuckets) {
   const old=batches.get(bucket);if(old){objects.remove(old);old.geometry.dispose();batches.delete(bucket);}
   const geometries=grouped.get(bucket)||[];
   if(geometries.length){const mesh=new THREE.Mesh(mergeCityGeometry(geometries),buildingMaterial);mesh.frustumCulled=false;objects.add(mesh);batches.set(bucket,mesh);}
  }
  dirtyBuckets.clear();
 }
 const distance=point=>Math.hypot(point[0]-centre[0],point[1]-centre[1]);
 function prune() {
  for(const [key,record] of trees)if(distance(record.tree.p)>2600)trees.delete(key);
  for(const [key,record] of buildings)if(distance(record.p)>3200){record.geometry.dispose();dirtyBuckets.add(record.bucket);buildings.delete(key);}
 }
 const runOnce=(key,task)=>{if(pending.has(key))return pending.get(key);const request=task().finally(()=>pending.delete(key));pending.set(key,request);return request;};
 const retryFailed=version=>{if(retryTimer!==null||!visible||disposed||!lastInput||retryAttempts>=4)return;retryTimer=setTimeout(()=>{retryTimer=null;if(visible&&!disposed&&version===updateVersion){retryAttempts++;layer.setObjects(lastInput.data,lastInput.center,{retry:true});}},500*2**retryAttempts);};
 const layer={id:'city-scene-3d',type:'custom',renderingMode:'3d',
  onAdd(current,gl){map=current;renderer=rendererFactory?rendererFactory(current,gl):new THREE.WebGLRenderer({canvas:map.getCanvas(),context:gl,antialias:true});renderer.autoClear=false;},
  setVisible(value){visible=Boolean(value);if(!visible){clearTimeout(retryTimer);retryTimer=null;}else if(lastError)retryFailed(updateVersion);map?.triggerRepaint();},
  setSun(value){if(!value)return;const az=value.azimuth*Math.PI/180,alt=Math.max(.1,value.altitude*Math.PI/180);sun.position.set(Math.sin(az)*Math.cos(alt)*1000,-Math.cos(az)*Math.cos(alt)*1000,Math.sin(alt)*1000);sun.intensity=value.altitude>0?2:0;ambient.intensity=value.altitude>0?.65:.85;map?.triggerRepaint();},
  async setObjects(data,center,{retry=false}={}){
   if(!retry){updateVersion++;retryAttempts=0;clearTimeout(retryTimer);retryTimer=null;lastInput={data,center};}const version=updateVersion;
   centre=center;prune();const tasks=[];
   for(const tree of data.trees) {
    const key=keyFor(tree.p);if(trees.has(key)||distance(tree.p)>2600)continue;
    tasks.push(runOnce('t:'+key,async()=>{const ll=toLngLat(tree.p),height=await terrain.sample(ll);if(disposed||distance(tree.p)>2600)return;const point=frame.point(ll,height);trees.set(key,{tree,ll,xy:point,ground:point[2]});}));
   }
   for(const building of data.buildings) {
    const p=building.r?.[0]?.[0];if(!p||building.r[0].length<4||distance(p)>3200)continue;
    const key=JSON.stringify(building.r)+':'+building.h;if(buildings.has(key))continue;
    tasks.push(runOnce('b:'+key,async()=>{const footprint=building.r[0],locations=footprint.map(toLngLat),heights=await terrain.sampleMany(locations);if(disposed||distance(p)>3200)return;const sceneHeights=locations.map((ll,index)=>frame.point(ll,heights[index])[2]),geometry=await buildGeometry(()=>cityBuildingGeometry(building,frame,toLngLat,sceneHeights));if(!geometry)return;if(disposed||distance(p)>3200){geometry.dispose();return;}const bucket=bucketFor(p);buildings.set(key,{p,bucket,geometry});dirtyBuckets.add(bucket);}));
   }
   const results=await Promise.allSettled(tasks);const failure=results.find(result=>result.status==='rejected');if(version===updateVersion){if(failure){lastError=String(failure.reason);console.warn('Some 3D objects await their DEM tile:',failure.reason);retryFailed(version);}else lastError=null;}
   if(!disposed){queueRebuild();}return !failure;
  },
  async setRoute(coordinates) {
   const signature=coordinates.map(point=>point.join(':')).join('|');if(signature===routeSignature)return;routeSignature=signature;const version=++routeVersion;
   if(!coordinates.length){if(route){objects.remove(route);route.geometry.dispose();route.material.dispose();route=null;}map?.triggerRepaint();return;}
   try {
    coordinates=densifyRoute(coordinates);
    const ll=coordinates.map(toLngLat),heights=await terrain.sampleMany(ll);if(version!==routeVersion||disposed)return;
    const points=ll.map((point,index)=>new THREE.Vector3(...frame.point(point,heights[index]+1.2))),path=new THREE.CurvePath();
    for(let i=1;i<points.length;i++)if(points[i].distanceTo(points[i-1])>.01)path.add(new THREE.LineCurve3(points[i-1],points[i]));
    if(!path.curves.length)return;
    const segments=Math.min(4096,Math.max(points.length*2,Math.ceil(path.getLength()/2))),geometry=new THREE.TubeGeometry(path,segments,1.4,6,false),material=new THREE.MeshBasicMaterial({color:0xd7191c,depthTest:false,depthWrite:false});
    if(route){objects.remove(route);route.geometry.dispose();route.material.dispose();}route=new THREE.Mesh(geometry,material);route.renderOrder=10;route.frustumCulled=false;objects.add(route);map?.triggerRepaint();
   }catch(error){if(version===routeVersion){routeSignature='';console.warn('3D route height unavailable:',error);}}
  },
  render(gl,args){if(!visible||!renderer)return;const matrix=args.defaultProjectionData?.mainMatrix;if(!matrix||matrix.length!==16)return;camera.projectionMatrix.copy(projection.fromArray(matrix).multiply(localMatrix));camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();renderer.resetState();renderer.render(scene,camera);renderer.resetState();},
  // Used by geometry/lifecycle regression tests; no renderer internals exposed.
  snapshot(){return {trees:[...trees.values()].map(record=>({p:record.tree.p,ground:record.ground})),buildings:buildings.size,batches:batches.size,instances:crowns.count,visible,pending:pending.size,error:lastError,route:!!route};},
  onRemove(){disposed=true;clearTimeout(retryTimer);routeVersion++;for(const record of buildings.values())record.geometry.dispose();for(const mesh of batches.values())mesh.geometry.dispose();for(const value of [crownGeometry,trunkGeometry,crownMaterial,trunkMaterial,buildingMaterial])value.dispose();if(route){route.geometry.dispose();route.material.dispose();}renderer?.dispose();trees.clear();buildings.clear();batches.clear();map=null;}
 };
 return layer;
}
