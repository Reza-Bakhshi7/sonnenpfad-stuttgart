// One instanced draw: analytic, smooth spheres instead of extruded polygon slices.
// The camera-facing disk is shaded as a sphere; depth is written at its surface.
export function createSphereTreeLayer({toLngLat,dimensions}) {
 let map,program,vao,buffer,glContext,instances=[],dirty=true,lastTerrain=-1;
 const vertex=`#version 300 es
 precision highp float;
 layout(location=0) in vec4 tree;
 layout(location=1) in vec3 tint;
 uniform mat4 matrix;
 uniform vec3 rightVector,upVector;
 out vec2 disk;out vec3 colour;out vec3 centre;out float radius;
 const vec2 corners[6]=vec2[6](vec2(-1,-1),vec2(1,-1),vec2(-1,1),vec2(-1,1),vec2(1,-1),vec2(1,1));
 void main(){disk=corners[gl_VertexID];colour=tint;centre=tree.xyz;radius=tree.w;
 gl_Position=matrix*vec4(tree.xyz+tree.w*(rightVector*disk.x+upVector*disk.y),1.0);}`;
 const fragment=`#version 300 es
 precision highp float;
 in vec2 disk;in vec3 colour;in vec3 centre;in float radius;
 uniform mat4 matrix;uniform vec3 rightVector,upVector,eyeVector;
 out vec4 outputColour;
 void main(){float rr=dot(disk,disk);if(rr>1.0)discard;float z=sqrt(1.0-rr);
 vec3 normal=normalize(rightVector*disk.x+upVector*disk.y+eyeVector*z);
 vec4 clip=matrix*vec4(centre+radius*normal,1.0);gl_FragDepth=(clip.z/clip.w)*0.5+0.5;
 float light=.62+.38*max(0.0,dot(normal,normalize(vec3(-.4,-.5,1.0))));
 outputColour=vec4(colour*light*.74,.74);}`;
 const compile=(gl,type,source)=>{const shader=gl.createShader(type);gl.shaderSource(shader,source);gl.compileShader(shader);if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(shader));return shader;};
 const layer={id:'tree-spheres',type:'custom',renderingMode:'3d',
  setTrees(trees){instances=trees;dirty=true;map?.triggerRepaint();},
  onAdd(current,gl){map=current;glContext=gl;if(!gl.drawArraysInstanced)throw Error('Sphere crowns require WebGL2');
   const vs=compile(gl,gl.VERTEX_SHADER,vertex),fs=compile(gl,gl.FRAGMENT_SHADER,fragment);program=gl.createProgram();gl.attachShader(program,vs);gl.attachShader(program,fs);gl.linkProgram(program);gl.deleteShader(vs);gl.deleteShader(fs);if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(program));
   vao=gl.createVertexArray();buffer=gl.createBuffer();gl.bindVertexArray(vao);gl.bindBuffer(gl.ARRAY_BUFFER,buffer);
   for(const [index,size,offset] of [[0,4,0],[1,3,16]]){gl.enableVertexAttribArray(index);gl.vertexAttribPointer(index,size,gl.FLOAT,false,28,offset);gl.vertexAttribDivisor(index,1);}gl.bindVertexArray(null);
  },
  render(gl,args){if(!instances.length)return;
   // Re-anchor when DEM tiles arrive. queryTerrainElevation returns exaggerated height.
   if(dirty||lastTerrain!==layer.terrainRevision){const values=[];for(const tree of instances.slice().reverse()){const ll=toLngLat(tree.p),{r,h}=dimensions(tree),ground=map.queryTerrainElevation(ll)||0,altitude=ground+Math.max(r+.5,h-r),point=maplibregl.MercatorCoordinate.fromLngLat(ll,altitude),scale=point.meterInMercatorCoordinateUnits();values.push(point.x,point.y,point.z,r*scale,...(tree.evergreen?[.16,.40,.27]:[.28,.53,.35]));}gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(values),gl.DYNAMIC_DRAW);dirty=false;lastTerrain=layer.terrainRevision;}
   const matrix=args.defaultProjectionData?.mainMatrix||args.defaultProjectionData?.fallbackMatrix||args;
   const bearing=map.getBearing()*Math.PI/180,pitch=map.getPitch()*Math.PI/180,right=[Math.cos(bearing),Math.sin(bearing),0],up=[Math.sin(bearing)*Math.cos(pitch),-Math.cos(bearing)*Math.cos(pitch),Math.sin(pitch)],eye=[-Math.sin(bearing)*Math.sin(pitch),Math.cos(bearing)*Math.sin(pitch),Math.cos(pitch)];
   // Mercator's z points up; camera is above the ground.
   eye[2]=Math.cos(pitch);up[2]=Math.sin(pitch);
   gl.useProgram(program);gl.bindVertexArray(vao);gl.uniformMatrix4fv(gl.getUniformLocation(program,'matrix'),false,matrix);
   for(const [name,value]of [['rightVector',right],['upVector',up],['eyeVector',eye]])gl.uniform3fv(gl.getUniformLocation(program,name),value);
   const depthMask=gl.getParameter(gl.DEPTH_WRITEMASK),blend=gl.isEnabled(gl.BLEND),cull=gl.isEnabled(gl.CULL_FACE);
   gl.enable(gl.DEPTH_TEST);gl.depthMask(false);gl.disable(gl.CULL_FACE);gl.enable(gl.BLEND);gl.blendFunc(gl.ONE,gl.ONE_MINUS_SRC_ALPHA);gl.drawArraysInstanced(gl.TRIANGLES,0,6,instances.length);
   gl.depthMask(depthMask);if(!blend)gl.disable(gl.BLEND);if(cull)gl.enable(gl.CULL_FACE);gl.bindVertexArray(null);
  },terrainRevision:0,
  onRemove(){const gl=glContext;if(gl){gl.deleteBuffer(buffer);gl.deleteVertexArray(vao);gl.deleteProgram(program);}map=null;}
 };
 return layer;
}
