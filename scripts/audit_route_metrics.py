"""Independent length audit. Python standard library only; no app engine imports.

GPKG lengths: sum Euclidean distances directly in the source EPSG:25832.
Live GeoJSON: independent WGS84->UTM32 forward series (sub-cm locally),
then compare the polyline with reported lengths and rederive partial elevations.
"""
import argparse,hashlib,json,math,sqlite3,struct
from pathlib import Path

def line_points(blob):
    envelope=(blob[3]>>1)&7
    offset=8+{0:0,1:32,2:48,3:48,4:64}[envelope]
    endian='<' if blob[offset] else '>'
    kind=struct.unpack_from(endian+'I',blob,offset+1)[0]
    dims=2+int(kind//1000 in (1,3))+int(kind//1000 in (2,3))
    assert kind%1000==2,kind
    count=struct.unpack_from(endian+'I',blob,offset+5)[0]
    return [struct.unpack_from(endian+'d'*dims,blob,offset+9+i*dims*8)[:2] for i in range(count)]

def length(points):
    return sum(math.hypot(b[0]-a[0],b[1]-a[1]) for a,b in zip(points,points[1:]))

def utm32(point):
    lon,lat=map(math.radians,point[:2]);a=6378137.;f=1/298.257223563;e2=f*(2-f);ep=e2/(1-e2);k=.9996
    n=a/math.sqrt(1-e2*math.sin(lat)**2);t=math.tan(lat)**2;c=ep*math.cos(lat)**2;A=math.cos(lat)*(lon-math.radians(9))
    M=a*((1-e2/4-3*e2**2/64-5*e2**3/256)*lat-(3*e2/8+3*e2**2/32+45*e2**3/1024)*math.sin(2*lat)+(15*e2**2/256+45*e2**3/1024)*math.sin(4*lat)-35*e2**3/3072*math.sin(6*lat))
    return (500000+k*n*(A+(1-t+c)*A**3/6+(5-18*t+t*t+72*c-58*ep)*A**5/120),k*(M+n*math.tan(lat)*(A*A/2+(5-t+9*c+4*c*c)*A**4/24+(61-58*t+t*t+600*c-330*ep)*A**6/720)))

def summary(values):
    values=sorted(values)
    return {'count':len(values),'median':values[len(values)//2] if values else None,'p95':values[int((len(values)-1)*.95)] if values else None,'max':values[-1] if values else None}

def main():
    ap=argparse.ArgumentParser();ap.add_argument('--gpkg',type=Path);ap.add_argument('--route',type=Path);ap.add_argument('--output',type=Path,required=True);args=ap.parse_args();report={'date':'2026-10-15','method':'independent source-geometry and UTM32 length audit'}
    if args.gpkg:
        c=sqlite3.connect(f'file:{args.gpkg}?mode=ro',uri=True);rows=c.execute('select fid,geom,length_m,elev_start,elev_end from Strassen');errors=[];rel=[];total=stored=0;missing=0;bad=[]
        for fid,blob,l,z0,z1 in rows:
            calc=length(line_points(blob));total+=calc
            if l is None:missing+=1;continue
            stored+=l;err=abs(l-calc);errors.append(err)
            if calc>0:rel.append(err/calc*100)
            if err>.01:bad.append({'fid':fid,'stored_m':l,'geometry_m':calc,'error_m':err})
        report['source']={'sha256':hashlib.sha256(args.gpkg.read_bytes()).hexdigest(),'crs':'EPSG:25832','geometry_total_m':total,'stored_total_m':stored,'missing_lengths':missing,'absolute_error_m':summary(errors),'relative_error_percent':summary(rel),'over_1cm':len(bad),'largest_differences':sorted(bad,key=lambda b:b['error_m'],reverse=True)[:5]}
    if args.route:
        data=json.loads(args.route.read_text());p=data['properties'];segments=p['segments'];independent=length([utm32(point) for point in data['features'][0]['geometry']['coordinates']]);ascent=descent=0;known=True;segment_errors=[]
        for s in segments:
            segment_errors.append(abs(s['length_m']-length([utm32(point) for point in s['geometry']['coordinates']])))
            attrs=s['atlas_attributes'];z0=attrs.get('elev_start');z1=attrs.get('elev_end')
            if not isinstance(z0,(float,int)) or not isinstance(z1,(float,int)):known=False;continue
            dz=(z1-z0)*(s['atlas_t1']-s['atlas_t0']);ascent+=max(0,dz);descent+=max(0,-dz)
        report['live_route']={'sha256':hashlib.sha256(args.route.read_bytes()).hexdigest(),'parts':len(segments),'reported_m':p['distance_m'],'sum_parts_m':sum(s['length_m'] for s in segments),'independent_utm32_m':independent,'reported_minus_independent_m':p['distance_m']-independent,'part_errors_m':summary(segment_errors),'heights_complete':known,'ascent_m':ascent if known else None,'descent_m':descent if known else None,'estimated_minutes_at_75mpm_plus_1min_per_10m_ascent':math.ceil(p['distance_m']/75+ascent/10) if known else None,'access_links_included':False}
    args.output.write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report,indent=2))
if __name__=='__main__':main()
