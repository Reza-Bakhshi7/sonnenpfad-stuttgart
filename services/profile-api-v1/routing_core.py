"""Request-local virtual vertices: split snapped edges without editing the database."""
import math

EPSILON=1e-9

def finite_number(value):
    value=float(value)
    if not math.isfinite(value): raise ValueError('Non-finite routing value')
    return value

def split_snapped_edges(snaps,max_node,max_edge):
    grouped={}
    for label,snap in snaps.items(): grouped.setdefault(int(snap['id']),[]).append((label,snap))
    virtual=[];endpoints={};next_node=int(max_node)+1;next_edge=int(max_edge)+1
    for edge_id,points in grouped.items():
        edge=points[0][1]
        cuts=[(0.0,int(edge['source']),[]),(1.0,int(edge['target']),[])]
        for label,snap in sorted(points,key=lambda pair:pair[1]['fraction']):
            fraction=finite_number(snap['fraction'])
            if fraction<-EPSILON or fraction>1+EPSILON: raise ValueError('Snap fraction outside edge')
            fraction=max(0,min(1,fraction))
            closest=next((cut for cut in cuts if abs(cut[0]-fraction)<=EPSILON),None)
            if closest:
                closest[2].append(label);endpoints[label]=closest[1]
            else:
                cuts.append((fraction,next_node,[label]));endpoints[label]=next_node;next_node+=1
        cuts.sort(key=lambda cut:cut[0])
        for left,right in zip(cuts,cuts[1:]):
            fraction=right[0]-left[0]
            if fraction<=0: raise ValueError('Non-positive virtual piece')
            cost=finite_number(edge['cost']);reverse=finite_number(edge['reverse_cost'])
            virtual.append({'id':next_edge,'parent_id':edge_id,'source':left[1],'target':right[1],
                            'f0':left[0],'f1':right[0],'cost':cost*fraction if cost>=0 else -1.0,
                            'reverse_cost':reverse*fraction if reverse>=0 else -1.0})
            next_edge+=1
    return endpoints,virtual,sorted(grouped)

def values_sql(virtual):
    columns=('id','parent_id','source','target','f0','f1','cost','reverse_cost')
    records=[]
    for record in virtual:
        numbers=[]
        for column in columns:
            value=record[column]
            numbers.append(str(int(value)) if column in ('id','parent_id','source','target') else repr(finite_number(value)))
        records.append('('+','.join(numbers)+')')
    return ','.join(records)

def routing_sql(virtual,replaced):
    blocked=','.join(str(int(value)) for value in replaced)
    return ('WITH virtual(id,parent_id,source,target,f0,f1,cost,reverse_cost) AS (VALUES '+values_sql(virtual)+') '
            'SELECT id,source,target,cost,reverse_cost FROM routing.walk_edges '
            'WHERE (cost>=0 OR reverse_cost>=0) AND id NOT IN ('+blocked+') '
            'UNION ALL SELECT id,source,target,cost::double precision,reverse_cost::double precision FROM virtual')

def assemble_coordinates(path,geometries):
    coordinates=[]
    for step in path:
        if step['edge']==-1:continue
        record=geometries[int(step['edge'])]
        points=record['geometry']['coordinates']
        if step['node']==record['target']:points=list(reversed(points))
        elif step['node']!=record['source']:raise ValueError('Path node does not belong to edge')
        if coordinates:
            gap=math.hypot(coordinates[-1][0]-points[0][0],coordinates[-1][1]-points[0][1])
            if gap>1e-7: raise ValueError('Routing geometry has a gap')
            coordinates.extend(points[1:])
        else:coordinates.extend(points)
    return coordinates


def describe_segments(path,geometries):
    """Ordered and oriented pieces; atlas fractions interpolate preserved attributes.

    Fractions project routing endpoints onto the original atlas geometry.
    They are approximations within the audit's matching tolerance, not a DEM
    resampling or a new elevation measurement. No atlas attribute is modified.
    """
    segments=[]
    for step in path:
        if step['edge']==-1:continue
        record=geometries[int(step['edge'])]
        reverse=step['node']==record['target']
        if not reverse and step['node']!=record['source']:
            raise ValueError('Path node does not belong to edge')
        coordinates=record['geometry']['coordinates']
        f0=finite_number(record['atlas_f0']);f1=finite_number(record['atlas_f1'])
        length=finite_number(record['length_m'])
        if not (0<=f0<=1 and 0<=f1<=1) or length<0:
            raise ValueError('Invalid atlas segment metadata')
        if reverse:coordinates=list(reversed(coordinates));f0,f1=f1,f0
        segments.append({'edge_id':int(record['id']),'atlas_fid':int(record['atlas_fid']),
                         'length_m':length,'atlas_t0':f0,'atlas_t1':f1,
                         'geometry':{'type':'LineString','coordinates':coordinates},
                         'atlas_attributes':record['atlas_attributes']})
    return segments

