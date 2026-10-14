// A shared smooth sphere mesh, drawn once with instances. No sliced extrusions,
// camera-facing impostors, per-frame GeoJSON or third-party renderer is needed.
export function sphereMesh(longitudes=16,latitudes=10){
 const vertices=[],indices=[];
 for(let y=0;y<=latitudes;y++){const phi=y*Math.PI/latitudes;for(let x=0;x<=longitudes;x++){const theta=x*2*Math.PI/longitudes;vertices.push(Math.sin(phi)*Math.cos(theta),Math.sin(phi)*Math.sin(theta),Math.cos(phi));}}
 for(let y=0;y<latitudes;y++)for(let x=0;x<longitudes;x++){const a=y*(longitudes+1)+x,b=a+longitudes+1;if(y>0)indices.push(a,b,a+1);if(y<latitudes-1)indices.push(a+1,b,b+1);}
 return {vertices:new Float32Array(vertices),indices:new Uint16Array(indices)};
}
export function createSphereTreeLayer({toLngLat,dimensions}){
 let map,glContext,program,vao,vertexBuffer,indexBuffer,instanceBuffer,indexCount=0,instances=[],dirty=true,lastTerrain=-1;
 const vertex=`#version 300 es
 precision highp float;
 layout(location=0) in vec3 unitSphere;
 layout(location=1) in vec4 tree;
 layout(location=2) in vec3 tint;
 uniform mat4 matrix;
 out vec3 normal;out vec3 colour;
 void main(){normal=unitSphere;colour=tint;gl_Position=matrix*vec4(tree.xyz+tree.w*unitSphere,1.0);}`;
 const fragment=`#version 300 es
 precision highp float;
 in vec3 normal;in vec3 colour;out vec4 outputColour;
 void main(){vec3 n=normalize(normal);float light=.60+.40*max(0.0,dot(n,normalize(vec3(-.4,-.5,1.0))));outputColour=vec4(colour*light*.74,.74);}`;
 const compile=(gl,type,source)=>{const shader=gl.createShader(type);gl.shaderSource(shader,source);gl.compileShader(shader);if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS)){const error=gl.getShaderInfoLog(shader);gl.deleteShader(shader);throw Error(error);}return shader;};
 const layer={id:'tree-spheres',type:'custom',renderingMode:'3d',terrainRevision:0,
  setTrees(trees){instances=trees;dirty=true;map?.triggerRepaint();},
  onAdd(current,gl){map=current;glContext=gl;if(!gl.drawElementsInstanced)throw Error('Sphere crowns require WebGL2');
   const vs=compile(gl,gl.VERTEX_SHADER,vertex),fs=compile(gl,gl.FRAGMENT_SHADER,fragment);program=gl.createProgram();gl.attachShader(program,vs);gl.attachShader(program,fs);gl.linkProgram(program);gl.deleteShader(vs);gl.deleteShader(fs);if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(program));
   const mesh=sphereMesh();indexCount=mesh.indices.length;vao=gl.createVertexArray();vertexBuffer=gl.createBuffer();indexBuffer=gl.createBuffer();instanceBuffer=gl.createBuffer();gl.bindVertexArray(vao);
   gl.bindBuffer(gl.ARRAY_BUFFER,vertexBuffer);gl.bufferData(gl.ARRAY_BUFFER,mesh.vertices,gl.STATIC_DRAW);gl.enableVertexAttribArray(0);gl.vertexAttribPointer(0,3,gl.FLOAT,false,12,0);
   gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,indexBuffer);gl.bufferData(gl.ELEMENT_ARRAY_BUFFER,mesh.indices,gl.STATIC_DRAW);
   gl.bindBuffer(gl.ARRAY_BUFFER,instanceBuffer);for(const [index,size,offset]of [[1,4,0],[2,3,16]]){gl.enableVertexAttribArray(index);gl.vertexAttribPointer(index,size,gl.FLOAT,false,28,offset);gl.vertexAttribDivisor(index,1);}gl.bindVertexArray(null);
  },
  render(gl,args){if(!instances.length)return;const matrix=args.defaultProjectionData?.mainMatrix;if(!matrix||matrix.length!==16)return;
   if(dirty||lastTerrain!==layer.terrainRevision){const values=[];for(const tree of instances.slice().reverse()){const ll=toLngLat(tree.p),{r,h}=dimensions(tree),ground=map.queryTerrainElevation(ll)||0,altitude=ground+Math.max(r+.5,h-r),point=maplibregl.MercatorCoordinate.fromLngLat(ll,altitude),scale=point.meterInMercatorCoordinateUnits();values.push(point.x,point.y,point.z,r*scale,...(tree.evergreen?[.16,.40,.27]:[.28,.53,.35]));}gl.bindBuffer(gl.ARRAY_BUFFER,instanceBuffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(values),gl.DYNAMIC_DRAW);dirty=false;lastTerrain=layer.terrainRevision;}
   const depthMask=gl.getParameter(gl.DEPTH_WRITEMASK),blend=gl.isEnabled(gl.BLEND),cull=gl.isEnabled(gl.CULL_FACE),frontFace=gl.getParameter(gl.FRONT_FACE),cullMode=gl.getParameter(gl.CULL_FACE_MODE);
   gl.useProgram(program);gl.bindVertexArray(vao);gl.uniformMatrix4fv(gl.getUniformLocation(program,'matrix'),false,matrix);gl.enable(gl.DEPTH_TEST);gl.depthMask(false);gl.enable(gl.CULL_FACE);gl.frontFace(gl.CCW);gl.cullFace(gl.BACK);gl.enable(gl.BLEND);gl.blendFunc(gl.ONE,gl.ONE_MINUS_SRC_ALPHA);
   gl.drawElementsInstanced(gl.TRIANGLES,indexCount,gl.UNSIGNED_SHORT,0,instances.length);
   gl.depthMask(depthMask);gl.frontFace(frontFace);gl.cullFace(cullMode);if(!blend)gl.disable(gl.BLEND);if(!cull)gl.disable(gl.CULL_FACE);gl.bindVertexArray(null);
  },
  onRemove(){const gl=glContext;if(gl){for(const buffer of [vertexBuffer,indexBuffer,instanceBuffer])gl.deleteBuffer(buffer);gl.deleteVertexArray(vao);gl.deleteProgram(program);}map=null;}
 };
 return layer;
}
