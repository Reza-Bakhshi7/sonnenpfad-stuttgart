"""Rebuild the pilot from the user's GeoPackage; never modifies the source.
Usage: python scripts/prepare_data.py /path/to/atlas.gpkg
Requires shapely and pyproj. Public outputs contain only selected map fields.
"""
import sys,sqlite3,json,math,pathlib,collections,hashlib
from shapely import wkb
from shapely.geometry import box,LineString
from pyproj import Transformer
ROOT=pathlib.Path(__file__).resolve().parents[1]; OUT=ROOT/'build_data';OUT.mkdir(exist_ok=True,parents=True)
source=pathlib.Path(sys.argv[1]);db=sqlite3.connect('file:'+str(source)+'?mode=ro',uri=True);db.row_factory=sqlite3.Row
tr=Transformer.from_crs(25832,4326,always_xy=True);origin=[9.18,48.777];sx=111320*math.cos(math.radians(origin[1]));sy=111320
bounds=[9.162,48.765,9.198,48.790]
def local(x,y):
 lon,lat=tr.transform(x,y);return [round((lon-origin[0])*sx,2),round((lat-origin[1])*sy,2)]
def geo(blob):
 code=(blob[3]>>1)&7;return wkb.loads(blob[8+{0:0,1:32,2:48,3:48,4:64}[code]:])
def ring(coords):return [local(x,y) for x,y,*_ in coords]
def inside(p,pad=0):return (bounds[0]-origin[0])*sx-pad<=p[0]<=(bounds[2]-origin[0])*sx+pad and (bounds[1]-origin[1])*sy-pad<=p[1]<=(bounds[3]-origin[1])*sy+pad
def number(x,default=0):
 try:
  v=float(x);return v if math.isfinite(v) else default
 except:return default
nodes=[];node_index={};edges=[];reject=collections.Counter()
def node(p):
 k=tuple(p)
 if k not in node_index:node_index[k]=len(nodes);nodes.append(p)
 return node_index[k]
for r in db.execute('select * from Pedestrian_Network'):
 g=geo(r['geom']);coords=ring(g.coords)
 if not all(inside(p) for p in coords):continue
 tags={}
 try:tags=json.loads(r['osm_tags_current'] or '{}')
 except:pass
 access=str(r['access_current'] or '').lower();foot=str(r['foot_current'] or '').lower();highway=r['highway_current'] or r['fclass']
 if foot in ('no','private') or (access in ('no','private') and foot not in ('yes','designated','permissive')) or highway in ('motorway','motorway_link','trunk','trunk_link','construction','proposed') or str(r['indoor_current']).lower()=='yes':reject['restricted']+=1;continue
 length=sum(math.dist(a,b) for a,b in zip(coords,coords[1:]))
 if length<.05:continue
 a=node(coords[0]);b=node(coords[-1]);slope=number(r['slope_pct'])
 z0=number(r['elev_start'],math.nan);z1=number(r['elev_end'],math.nan)
 valid0=math.isfinite(z0) and z0>=100;valid1=math.isfinite(z1) and z1>=100
 if not valid0 and valid1:z0=z1-slope*length/100
 elif valid0 and not valid1:z1=z0+slope*length/100
 elif not valid0 and not valid1:z0=250;z1=z0+slope*length/100
 dz=z1-z0
 steps=highway=='steps' or r['fclass']=='steps'
 covered=str(r['covered_current'] or '').lower()=='yes' or str(r['tunnel'] or '').lower() in ('t','yes','true','1')
 direction=str(tags.get('oneway:foot','no')).lower() if isinstance(tags,dict) else 'no'
 edges.append({'a':a,'b':b,'c':coords,'l':round(length,2),'s':slope,'dz':round(dz,2),'z0':round(z0,2),'z1':round(z1,2),'steps':steps,'covered':covered,'dir':1 if direction=='yes' else -1 if direction=='-1' else 0,'name':r['display_name'] or r['name'] or '', 'id':r['atlas_id']})
buildings=[];estimated=0
for r in db.execute('select geom,hoehe_m from Buildings'):
 g=geo(r['geom'])
 if not inside(local(g.centroid.x,g.centroid.y),350):continue
 h=number(r['hoehe_m'],9)
 if h<=0:h=9;estimated+=1
 for poly in g.geoms:
  if poly.area<2 or not inside(local(poly.centroid.x,poly.centroid.y),350):continue
  poly=poly.simplify(.25,preserve_topology=True)
  buildings.append({'r':[ring(poly.exterior.coords)]+[ring(q.coords) for q in poly.interiors],'h':round(h,1)})
trees=[];tree_default=0
for r in db.execute('select * from Trees'):
 g=geo(r['geom']);p=local(g.x,g.y)
 if not inside(p,150):continue
 h=number(r['height_calculated']) or number(r['height']) or number(r['est_height'])
 if not h:h=8;tree_default+=1
 trees.append({'p':p,'h':round(h,1),'r':round(max(1,number(r['crown_radius'],2)),1),'evergreen':str(r['leaf_cycle'] or '').lower()=='evergreen'})
# Split at every existing geometry vertex, preserving provenance and direction.
# This connects shared OSM vertices inside lines, without noding grade-separated crossings.
original=edges;edges=[]
for e in original:
 total=sum(math.dist(a,b) for a,b in zip(e['c'],e['c'][1:]));travelled=0
 for p,q in zip(e['c'],e['c'][1:]):
  length=math.dist(p,q)
  if length<.01:continue
  t0=travelled/total;t1=(travelled+length)/total
  z0=e['z0']+(e['z1']-e['z0'])*t0;z1=e['z0']+(e['z1']-e['z0'])*t1
  edges.append({**e,'a':node(p),'b':node(q),'c':[p,q],'l':round(length,3),'dz':round(z1-z0,3),'z0':round(z0,2),'z1':round(z1,2)})
  travelled+=length
# Connectivity inventory: keep components; do not invent links across gaps.
adj=[[] for _ in nodes]
for e in edges:adj[e['a']].append(e['b']);adj[e['b']].append(e['a'])
seen=set();sizes=[]
for start in range(len(nodes)):
 if start in seen:continue
 q=[start];seen.add(start);n=0
 while q:
  a=q.pop();n+=1
  for b in adj[a]:
   if b not in seen:seen.add(b);q.append(b)
 sizes.append(n)
meta={'origin':origin,'scale':[sx,sy],'bounds':bounds,'sourceDate':'2026-09-15','nodes':len(nodes),'edges':len(edges),'buildings':len(buildings),'trees':len(trees),'components':sorted(sizes,reverse=True),'treeHeightFallbacks':tree_default,'buildingHeightFallbacks':estimated,'excluded':dict(reject),'sourceSha256':hashlib.sha256(source.read_bytes()).hexdigest()}
for name,data in [('network',{'nodes':nodes,'edges':edges}),('obstacles',{'buildings':buildings,'trees':trees}),('meta',meta)]:
 (OUT/(name+'.json')).write_text(json.dumps(data,separators=(',',':'),ensure_ascii=False))
print(json.dumps({k:v for k,v in meta.items() if k!='components'},indent=2));print('Largest components:',meta['components'][:8])
