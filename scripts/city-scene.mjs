import * as THREE from '../dist/vendor/three.mjs';

export function createCityFrame(origin) {
 const earth=40075016.68557849;
 const mercator=([lon,lat])=>{const sin=Math.sin(lat*Math.PI/180);return [(lon+180)/360,.5-Math.log((1+sin)/(1-sin))/(4*Math.PI)];};
 const [x,y]=mercator(origin),unit=1/(earth*Math.cos(origin[1]*Math.PI/180));
 return {x,y,unit,point(point,height=0){const [px,py]=mercator(point),scale=1/(earth*Math.cos(point[1]*Math.PI/180));return [(px-x)/unit,(y-py)/unit,height*scale/unit];},radius(point,radius){return radius/(earth*Math.cos(point[1]*Math.PI/180))/unit;}};
}

// North-positive scene metres keep Three's right-handed coordinates. The
// model matrix flips Y once into Mercator, as in the SDK's Three examples.
// Only trees live in this layer. MapLibre draws vector buildings and the route.
// Flat display ground never waits for DEM. Computational elevations are separate.
export function createCitySceneLayer({origin,toLngLat,dimensions,rendererFactory,treeCap=4000}) {
 const frame=createCityFrame(origin),scene=new THREE.Scene(),camera=new THREE.Camera(),objects=new THREE.Group();scene.add(objects);
 const ambient=new THREE.AmbientLight(0xfff9eb,1.35),sun=new THREE.DirectionalLight(0xffffff,.55);sun.position.set(-400,600,900);scene.add(ambient,sun);
 const crownGeometry=new THREE.SphereGeometry(1,24,16),trunkGeometry=new THREE.CylinderGeometry(1,1,1,8);trunkGeometry.rotateX(Math.PI/2);
 // A closed opaque shell avoids the unsortable surfaces of blended instances.
 const crownMaterial=new THREE.MeshLambertMaterial({color:0xffffff,transparent:false,opacity:1,depthWrite:true,side:THREE.FrontSide}),trunkMaterial=new THREE.MeshLambertMaterial({color:0x967345});
 const crowns=new THREE.InstancedMesh(crownGeometry,crownMaterial,treeCap),trunks=new THREE.InstancedMesh(trunkGeometry,trunkMaterial,treeCap);crowns.count=trunks.count=0;crowns.frustumCulled=trunks.frustumCulled=false;objects.add(crowns,trunks);
 const trees=new Map(),instance=new THREE.Object3D(),colour=new THREE.Color(),raycaster=new THREE.Raycaster();
 const localMatrix=new THREE.Matrix4().makeTranslation(frame.x,frame.y,0).scale(new THREE.Vector3(frame.unit,-frame.unit,frame.unit)),projection=new THREE.Matrix4();
 let map,renderer,visible=false,disposed=false,selected=[],selectionKey='',lastMatrix=null;
 const keyFor=point=>point.map(value=>Number(value).toFixed(2)).join(':');
 const layer={id:'city-scene-3d',type:'custom',renderingMode:'3d',
  onAdd(current,gl){map=current;renderer=rendererFactory?rendererFactory(current,gl):new THREE.WebGLRenderer({canvas:map.getCanvas(),context:gl,antialias:true});renderer.autoClear=false;},
  setVisible(value){visible=Boolean(value);map?.triggerRepaint();},
  setSun(value){if(!value)return;const az=value.azimuth*Math.PI/180,alt=Math.max(.3,value.altitude*Math.PI/180);sun.position.set(Math.sin(az)*Math.cos(alt)*1000,Math.cos(az)*Math.cos(alt)*1000,Math.sin(alt)*1000);sun.intensity=value.altitude>0?.55:.2;map?.triggerRepaint();},
  setTrees(input,centre){
   if(disposed)return;const distance=p=>Math.hypot(p[0]-centre[0],p[1]-centre[1]);
   for(const tree of input){if(!tree.p?.every(Number.isFinite)||!Number.isFinite(tree.r)||!Number.isFinite(tree.h))continue;const key=keyFor(tree.p);if(!trees.has(key))trees.set(key,{tree,key,ll:toLngLat(tree.p)});}
   for(const [key,record] of trees)if(distance(record.tree.p)>3400)trees.delete(key);
   const next=[...trees.values()].filter(record=>distance(record.tree.p)<2200).sort((a,b)=>distance(a.tree.p)-distance(b.tree.p)||a.key.localeCompare(b.key)).slice(0,treeCap),signature=next.map(record=>record.key).sort().join('|');
   if(signature===selectionKey)return;selectionKey=signature;selected=next;
   for(const [index,record] of selected.entries()){
    const {r,h}=dimensions(record.tree),radius=frame.radius(record.ll,Math.max(.5,Math.min(r,h*.46))),height=frame.radius(record.ll,Math.max(2,h)),[x,y]=frame.point(record.ll),canopyCentre=Math.max(radius+.35,height-radius),trunkHeight=Math.max(.6,canopyCentre-radius*.65),trunkRadius=Math.max(.12,Math.min(.28,r*.13));
    instance.position.set(x,y,canopyCentre);instance.scale.setScalar(radius);instance.updateMatrix();crowns.setMatrixAt(index,instance.matrix);
    const variation=((Math.round(record.tree.p[0]*10)*31+Math.round(record.tree.p[1]*10))>>>0)%4,palette=record.tree.evergreen?[0x3f8057,0x4c8854,0x528c60,0x458653]:[0x79a34c,0x69a255,0x86aa57,0x76a85b];colour.set(palette[variation]);crowns.setColorAt(index,colour);
    instance.position.set(x,y,trunkHeight/2);instance.scale.set(trunkRadius,trunkRadius,trunkHeight);instance.updateMatrix();trunks.setMatrixAt(index,instance.matrix);
   }
   crowns.count=trunks.count=selected.length;crowns.boundingSphere=trunks.boundingSphere=null;crowns.instanceMatrix.needsUpdate=trunks.instanceMatrix.needsUpdate=true;if(crowns.instanceColor)crowns.instanceColor.needsUpdate=true;map?.triggerRepaint();
  },
  pickTree(point){
   if(!visible||!lastMatrix||!selected.length)return null;const canvas=map.getCanvas(),x=point.x/canvas.clientWidth*2-1,y=1-point.y/canvas.clientHeight*2,near=new THREE.Vector3(x,y,-1).applyMatrix4(camera.projectionMatrixInverse),far=new THREE.Vector3(x,y,1).applyMatrix4(camera.projectionMatrixInverse);
   raycaster.set(near,far.sub(near).normalize());scene.updateMatrixWorld(true);const hit=raycaster.intersectObject(crowns,false)[0];return hit?selected[hit.instanceId]:null;
  },
  render(gl,args){if(!visible||!renderer)return;const matrix=args.defaultProjectionData?.mainMatrix;if(!matrix||matrix.length!==16)return;lastMatrix=matrix;camera.projectionMatrix.copy(projection.fromArray(matrix).multiply(localMatrix));camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();renderer.resetState();renderer.render(scene,camera);renderer.resetState();},
  snapshot(){return {trees:selected.map(record=>({p:record.tree.p,ground:0})),instances:crowns.count,visible,cached:trees.size};},
  onRemove(){disposed=true;for(const value of [crownGeometry,trunkGeometry,crownMaterial,trunkMaterial])value.dispose();renderer?.dispose();trees.clear();selected=[];map=null;}
 };return layer;
}
