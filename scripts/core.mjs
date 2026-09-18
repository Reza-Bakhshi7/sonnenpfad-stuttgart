// Geometry and routing engine. Units: local metres. No synthetic connections.
export const RAD=Math.PI/180;
export function sunPosition(date,lat=48.777,lon=9.18){
 const jd=date.getTime()/86400000+2440587.5,n=jd-2451545;
 const L=(280.46+.9856474*n)%360,g=(357.528+.9856003*n)*RAD;
 const lambda=(L+1.915*Math.sin(g)+.020*Math.sin(2*g))*RAD,eps=(23.439-.0000004*n)*RAD;
 const ra=Math.atan2(Math.cos(eps)*Math.sin(lambda),Math.cos(lambda));
 const dec=Math.asin(Math.sin(eps)*Math.sin(lambda));
 const gmst=(280.46061837+360.98564736629*n)*RAD;
 const H=gmst+lon*RAD-ra,phi=lat*RAD;
 const altitude=Math.asin(Math.sin(phi)*Math.sin(dec)+Math.cos(phi)*Math.cos(dec)*Math.cos(H));
 const azimuth=(Math.atan2(Math.sin(H),Math.cos(H)*Math.sin(phi)-Math.tan(dec)*Math.cos(phi))+Math.PI+2*Math.PI)%(2*Math.PI);
 return {altitude:altitude/RAD,azimuth:azimuth/RAD};
}
export function insideRing(p,r){let c=false;for(let i=0,j=r.length-1;i<r.length;j=i++){const a=r[i],b=r[j];if((a[1]>p[1])!==(b[1]>p[1])&&p[0]<(b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1])+a[0])c=!c;}return c;}
export function insidePolygon(p,rings){return insideRing(p,rings[0])&&!rings.slice(1).some(r=>insideRing(p,r));}
export function makeShadows(obstacles,sun,leafOn=true){
 if(sun.altitude<=2)return [];
 const a=sun.azimuth*RAD,t=1/Math.tan(sun.altitude*RAD),polys=[];
 for(const b of obstacles.buildings){
  const dx=-Math.sin(a)*b.h*t,dy=-Math.cos(a)*b.h*t;
  polys.push(b.r.map(r=>r.map(p=>[p[0]+dx,p[1]+dy])));
  // Swept vertical walls plus roof projection preserve concave footprints.
  for(const r of b.r)for(let i=1;i<r.length;i++){
   const p=r[i-1],q=r[i];polys.push([[p,q,[q[0]+dx,q[1]+dy],[p[0]+dx,p[1]+dy],p]]);
  }
 }
 for(const b of obstacles.trees){
  if(!leafOn&&!b.evergreen)continue;
  const r=b.r,cy=Math.max(r,b.h-r),dx=-Math.sin(a)*cy*t,dy=-Math.cos(a)*cy*t;
  const major=r/Math.sin(sun.altitude*RAD),ring=[];
  for(let j=0;j<=16;j++){const u=2*Math.PI*j/16,along=major*Math.cos(u),cross=r*Math.sin(u);ring.push([b.p[0]+dx+along*Math.sin(a)+cross*Math.cos(a),b.p[1]+dy+along*Math.cos(a)-cross*Math.sin(a)]);}
  polys.push([ring]);
 }
 return polys;
}
export function shadowIndex(polys){const cells=new Map(),size=50;
 polys.forEach((r,i)=>{const p=r[0];let x0=Infinity,y0=Infinity,x1=-Infinity,y1=-Infinity;for(const [x,y] of p){x0=Math.min(x0,x);y0=Math.min(y0,y);x1=Math.max(x1,x);y1=Math.max(y1,y);}
 for(let x=Math.floor(x0/size);x<=Math.floor(x1/size);x++)for(let y=Math.floor(y0/size);y<=Math.floor(y1/size);y++){const k=x+','+y;if(!cells.has(k))cells.set(k,[]);cells.get(k).push(i);}});
 return p=>(cells.get(Math.floor(p[0]/size)+','+Math.floor(p[1]/size))||[]).some(i=>insidePolygon(p,polys[i]));
}
export function edgeShades(edges,polys,night=false){
 const hit=shadowIndex(polys);
 return edges.map(e=>{if(e.covered||night)return 1;let yes=0,total=0;for(let i=1;i<e.c.length;i++){const a=e.c[i-1],b=e.c[i],len=Math.hypot(b[0]-a[0],b[1]-a[1]),n=Math.max(1,Math.ceil(len/4));for(let j=0;j<n;j++){const t=(j+.5)/n;if(hit([a[0]+t*(b[0]-a[0]),a[1]+t*(b[1]-a[1])]))yes+=len/n;total+=len/n;}}return total?yes/total:0;});
}
class Heap{constructor(){this.a=[];}push(v){const a=this.a;let i=a.length;a.push(v);while(i){const p=(i-1)>>1;if(a[p][0]<=v[0])break;a[i]=a[p];i=p;}a[i]=v;}pop(){const a=this.a,v=a[0],last=a.pop();if(a.length){let i=0;while(i*2+1<a.length){let c=i*2+1;if(c+1<a.length&&a[c+1][0]<a[c][0])c++;if(a[c][0]>=last[0])break;a[i]=a[c];i=c;}a[i]=last;}return v;}get length(){return this.a.length;}}
export function buildAdj(network){const adj=network.nodes.map(()=>[]);network.edges.forEach((e,i)=>{if(e.dir!==-1)adj[e.a].push([e.b,i,1]);if(e.dir!==1)adj[e.b].push([e.a,i,-1]);});return adj;}
export function buildComponents(network,avoidSteps=false){
 const links=network.nodes.map(()=>[]);network.edges.forEach(e=>{if(avoidSteps&&e.steps)return;links[e.a].push(e.b);links[e.b].push(e.a);});
 const ids=new Int32Array(network.nodes.length).fill(-1);let id=0;
 for(let start=0;start<links.length;start++){if(ids[start]>=0||!links[start].length)continue;ids[start]=id;const q=[start];while(q.length){const u=q.pop();for(const v of links[u])if(ids[v]<0){ids[v]=id;q.push(v);}}id++;}
 return ids;
}
function edgeProjection(e,p){
 const a=e.c[0],b=e.c[e.c.length-1],dx=b[0]-a[0],dy=b[1]-a[1],den=dx*dx+dy*dy;
 const t=den?Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dy)/den)):0;
 const q=[a[0]+t*dx,a[1]+t*dy];return {t,p:q,distance:Math.hypot(p[0]-q[0],p[1]-q[1])};
}
export function nearestEdge(network,p,avoidSteps=false){
 let best={i:-1,t:0,p:null,distance:Infinity};
 for(let i=0;i<network.edges.length;i++){
  const e=network.edges[i];if(avoidSteps&&e.steps)continue;
  const projection=edgeProjection(e,p);if(projection.distance<best.distance)best={i,...projection};
 }
 return best;
}
function nearestByComponent(network,p,components,avoidSteps){
 const best=new Map();for(let i=0;i<network.edges.length;i++){const e=network.edges[i];if(avoidSteps&&e.steps)continue;const component=components[e.a];if(component<0)continue;const projection=edgeProjection(e,p),old=best.get(component);if(!old||projection.distance<old.distance)best.set(component,{i,component,...projection});}return best;
}
export function route(network,adj,shades,start,end,options={}){
 const {preference='balanced',avoidSteps=false,gentle=false}=options,components=options.components||buildComponents(network,avoidSteps),maxSnap=200;
 const starts=nearestByComponent(network,start,components,avoidSteps),ends=nearestByComponent(network,end,components,avoidSteps);let a=null,b=null,bestSnap=Infinity;
 for(const [component,sa] of starts){const sb=ends.get(component);if(!sb||sa.distance>maxSnap||sb.distance>maxSnap)continue;const score=sa.distance+sb.distance;if(score<bestSnap){bestSnap=score;a=sa;b=sb;}}
 if(!a||!b)return {error:'outside'};
 const penalty=i=>{const e=network.edges[i],exposure=preference==='shade'?1-shades[i]:preference==='sun'?shades[i]:0;return 1+exposure*1.6+(gentle?Math.min(4,Math.abs(e.s)/6):0);};
 const ae=network.edges[a.i],be=network.edges[b.i];
 if(a.i===b.i){
  const forward=b.t>=a.t,allowed=forward?ae.dir!==-1:ae.dir!==1,frac=Math.abs(b.t-a.t);
  if(allowed){if(frac*ae.l<.01)return {error:'same'};return finish([{i:a.i,forward,frac,t0:a.t,t1:b.t,coords:[a.p,b.p]}],a,b);}
 }
 const d=new Float64Array(network.nodes.length).fill(Infinity),prev=new Int32Array(d.length).fill(-1),pe=new Int32Array(d.length).fill(-1),heap=new Heap(),seedPart=new Map(),finalPart=new Map();
 const seed=(node,part)=>{const cost=network.edges[part.i].l*part.frac*penalty(part.i);if(cost<d[node]){d[node]=cost;seedPart.set(node,part);heap.push([cost,node]);}};
 if(ae.dir!==1)seed(ae.a,{i:a.i,forward:false,frac:a.t,t0:a.t,t1:0,coords:[a.p,network.nodes[ae.a]]});
 if(ae.dir!==-1)seed(ae.b,{i:a.i,forward:true,frac:1-a.t,t0:a.t,t1:1,coords:[a.p,network.nodes[ae.b]]});
 const addFinal=(node,part)=>{const cost=network.edges[part.i].l*part.frac*penalty(part.i),old=finalPart.get(node);if(!old||cost<old.cost)finalPart.set(node,{cost,part});};
 if(be.dir!==-1)addFinal(be.a,{i:b.i,forward:true,frac:b.t,t0:0,t1:b.t,coords:[network.nodes[be.a],b.p]});
 if(be.dir!==1)addFinal(be.b,{i:b.i,forward:false,frac:1-b.t,t0:1,t1:b.t,coords:[network.nodes[be.b],b.p]});
 let best=Infinity,target=-1,targetPart=null;
 while(heap.length){const [cost,u]=heap.pop();if(cost!==d[u])continue;if(cost>=best)break;const fin=finalPart.get(u);if(fin&&cost+fin.cost<best){best=cost+fin.cost;target=u;targetPart=fin.part;}for(const [v,i] of adj[u]){const e=network.edges[i];if(avoidSteps&&e.steps)continue;const nd=cost+e.l*penalty(i);if(nd<d[v]){d[v]=nd;prev[v]=u;pe[v]=i;heap.push([nd,v]);}}}
 if(target<0)return {error:'outside'};
 const full=[];let u=target;while(prev[u]>=0){const i=pe[u],forward=network.edges[i].b===u;full.push({i,forward,frac:1,t0:forward?0:1,t1:forward?1:0,coords:null});u=prev[u];}full.reverse();
 const parts=[seedPart.get(u),...full,targetPart].filter(Boolean);
 return finish(parts,a,b);
 function finish(parts,a,b){
  let length=0,shaded=0,ascent=0,descent=0,steps=0,currentZ=null;const coords=[],profile=[];
  for(const part of parts){const e=network.edges[part.i],len=e.l*part.frac,t0=part.t0??(part.forward?0:1),t1=part.t1??(part.forward?1:0),raw0=Number.isFinite(e.z0)?e.z0:0,raw1=Number.isFinite(e.z1)?e.z1:raw0+e.dz,dz=(raw1-raw0)*(t1-t0),segment=part.coords||(part.forward?e.c:e.c.slice().reverse());if(currentZ===null){currentZ=raw0+(raw1-raw0)*t0;profile.push([0,currentZ]);}length+=len;currentZ+=dz;profile.push([length,currentZ]);shaded+=len*shades[part.i];ascent+=Math.max(0,dz);descent+=Math.max(0,-dz);if(e.steps&&len>.01)steps++;for(const p of segment)if(!coords.length||Math.hypot(coords.at(-1)[0]-p[0],coords.at(-1)[1]-p[1])>.001)coords.push(p);}
  return {path:parts,coords,profile,length,shade:length?shaded/length:0,ascent,descent,steps,minutes:Math.ceil(length/75+ascent/10),snaps:[a.p,b.p],snapDistances:[a.distance,b.distance]};
 }
}
