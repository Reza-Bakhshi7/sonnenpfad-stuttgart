// Clip in homogeneous camera space BEFORE dividing by w. Projecting vertices
// behind a tilted camera first turns the city polygon inside out.
export function multiplyPoint(matrix,point){
 const [x,y,z=0]=point;
 return [matrix[0]*x+matrix[4]*y+matrix[8]*z+matrix[12],matrix[1]*x+matrix[5]*y+matrix[9]*z+matrix[13],matrix[2]*x+matrix[6]*y+matrix[10]*z+matrix[14],matrix[3]*x+matrix[7]*y+matrix[11]*z+matrix[15]];
}
export function clipCameraPolygon(points){
 let polygon=points;
 // Include the near plane and all viewport edges. The far plane intentionally
 // does not clip a ground boundary; map terrain controls its own visibility.
 for(const distance of [p=>p[3]-1e-8,p=>p[2]+p[3],p=>p[0]+p[3],p=>p[3]-p[0],p=>p[1]+p[3],p=>p[3]-p[1]]){
  if(!polygon.length)break;const next=[];
  for(let i=0;i<polygon.length;i++){const a=polygon[i],b=polygon[(i+1)%polygon.length],da=distance(a),db=distance(b),insideA=da>=0,insideB=db>=0;if(insideA)next.push(a);if(insideA!==insideB){const f=da/(da-db);next.push(a.map((v,j)=>v+(b[j]-v)*f));}}
  polygon=next;
 }
 return polygon;
}
export function projectBoundaryPath(rings,matrix,width,height){
 let path='';
 for(const ring of rings){const clipped=clipCameraPolygon(ring.map(point=>multiplyPoint(matrix,point)));if(clipped.length<3)continue;path+=clipped.map((p,i)=>`${i?'L':'M'}${((p[0]/p[3]+1)*width/2).toFixed(2)} ${((1-p[1]/p[3])*height/2).toFixed(2)}`).join('')+'Z';}
 return path;
}
