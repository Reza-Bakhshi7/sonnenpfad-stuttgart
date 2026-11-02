#!/usr/bin/env python3
"""Loopback-only experimental routing API. No installation or DB mutations.

Transport uses Python's HTTP server for isolated testing only, not public hosting.
PostgreSQL integration and complete route parity must be tested on the VM.
"""
import argparse
import contextlib
import itertools
import json
import math
import socket
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from routing_core import split_snapped_edges, values_sql, assemble_coordinates, describe_segments
from sonnenpfad_profile_rules import resolved_options, relaxation_tiers, finite, REFERENCE_COMMIT

SUPPORTED = ('standard', 'wheelchair', 'powerWheelchair')
CANDIDATES = 8
MAX_PAIRS = 8
MAX_BODY = 16384
REQUEST_SECONDS = 30
SLOTS = threading.BoundedSemaphore(1)


class RouteError(Exception):
    def __init__(self, status, code, message):
        super().__init__(message)
        self.status, self.code = status, code


def validate_request(body):
    if not isinstance(body, dict):
        raise RouteError(422, 'invalid_request', 'Expected a JSON object')
    allowed = {'start', 'end', 'mobility_profile', 'preference', 'max_snap_m', 'allow_relaxation'}
    if set(body) - allowed:
        raise RouteError(422, 'unsupported_fields', 'Unsupported request fields; no options are silently ignored')
    for name in ('start', 'end'):
        point = body.get(name)
        if not isinstance(point, list) or len(point) != 2 or not all(finite(x) for x in point):
            raise RouteError(422, 'invalid_coordinates', 'Endpoints must be finite [longitude, latitude] arrays')
        if not (-180 <= point[0] <= 180 and -90 <= point[1] <= 90):
            raise RouteError(422, 'invalid_coordinates', 'Coordinates outside allowed range')
    profile = body.get('mobility_profile', 'standard')
    if profile not in SUPPORTED:
        raise RouteError(422, 'unsupported_profile', 'Only standard, wheelchair and powerWheelchair are available in this test')
    if body.get('preference', 'balanced') != 'balanced':
        raise RouteError(422, 'unsupported_preference', 'Sun/shade routing is not implemented by this test API')
    radius = body.get('max_snap_m', 30)
    if not finite(radius) or not 0 < radius <= 50:
        raise RouteError(422, 'invalid_snap_radius', 'max_snap_m must be greater than 0 and at most 50')
    relax = body.get('allow_relaxation', False)
    if not isinstance(relax, bool):
        raise RouteError(422, 'invalid_relaxation', 'allow_relaxation must be a JSON boolean')
    return dict(start=body['start'], end=body['end'], mobility_profile=profile,
                max_snap_m=radius, allow_relaxation=relax, preference='balanced')


def policy_sql(options):
    """Compile only fixed reviewed profile rules; no caller-supplied SQL values.

    Inputs are normalized columns surface/wheelchair/way/steps/escalator/sf.
    Absolute slopes are sufficient for these three profiles (both directions).
    """
    if options.get('mobilityProfile', 'standard') not in SUPPORTED:
        raise ValueError('Unsupported SQL policy')
    forbidden = ('downhillFactor', 'crossingFactor', 'stairGuidanceFactor', 'benchFactor', 'shelterFactor')
    if any(options.get(key) for key in forbidden) or options.get('slopeMode', 'none') not in ('none', 'both'):
        raise ValueError('Policy needs unsupported data or directional slope weighting')
    def number(key, default=0):
        value = options.get(key, default)
        if not finite(value) or value < 0:
            raise ValueError('Invalid fixed policy number')
        return repr(float(value))
    filters = []
    for key, expression in [('avoidSteps', 'NOT steps'), ('avoidEscalators', 'NOT escalator'),
                             ('avoidPoorSurface', 'surface <> 3'), ('avoidWheelchairNo', 'wheelchair <> 3')]:
        if options.get(key):
            filters.append(expression)
    if options.get('maxSlope'):
        filters.append('(sf IS NULL OR ABS(sf) <= ' + number('maxSlope') + ')')
    terms = ['1.0']
    if options.get('slopeMode', 'none') != 'none':
        terms.append('(LEAST(5.0, COALESCE(ABS(sf),24.0)/6.0)*' + number('slopeFactor', 1) + ')')
    for key, expression in [
        ('surfaceFactor', 'CASE surface WHEN 3 THEN 2.5 WHEN 2 THEN 0.7 ELSE 0.0 END'),
        ('wayFactor', 'CASE way WHEN 3 THEN 1.7 WHEN 2 THEN 0.35 ELSE 0.0 END'),
        ('wheelchairFactor', 'CASE wheelchair WHEN 3 THEN 4.0 WHEN 2 THEN 1.3 ELSE 0.0 END')]:
        if options.get(key):
            terms.append('((' + expression + ')*' + number(key) + ')')
    if options.get('unknownFactor'):
        unknown = ['CASE WHEN surface=0 THEN 1 ELSE 0 END', 'CASE WHEN sf IS NULL THEN 1 ELSE 0 END']
        if options.get('avoidWheelchairNo'):
            unknown.append('CASE WHEN wheelchair=0 THEN 1 ELSE 0 END')
        terms.append('((' + '+'.join('(' + x + ')' for x in unknown) + ')*' + number('unknownFactor') + ')')
    return ' AND '.join(filters) or 'TRUE', '(' + '+'.join(terms) + ')'


# Preserve the audited graph and its direction restrictions. Normalization is
# explicit; source strings and unknown classes are never interpreted as "good".
# The display class is authoritative for stairs, with fclass as fallback.
# Current source tags follow the existing exporter: JSON or semicolon key=value.
NORMALIZED = r'''
WITH raw AS (
 SELECT e.*,a.elev_start,a.elev_end,a.slope_pct,a.geom AS atlas_geom,
  lower(trim(COALESCE(NULLIF(trim(a.fclass_display),''),a.fclass,''))) AS display_class,
  lower(COALESCE(NULLIF(a.highway_current,''),a.fclass,'')) AS highway,
  lower(COALESCE(a.surface_class,'')) AS surface_text,
  lower(COALESCE(a.wheelchair,'')) AS wheelchair_text,
  lower(COALESCE(NULLIF(a.osm_tags_current,''),a.routing_osm_tags,'')) AS tags
 FROM routing.walk_edges e
 JOIN routing.atlas_network a ON a.fid=e.atlas_fid
 WHERE e.cost>=0 OR e.reverse_cost>=0
), flags AS (
 SELECT raw.*,
  tags ~ '(^|[;,{ ])"?conveying"?[[:space:]]*(=>|=|:)[[:space:]]*"?(yes|forward|backward|reversible)("|;|,|}|[[:space:]]|$)' AS escalator,
  CASE surface_text WHEN 'good' THEN 1 WHEN 'medium' THEN 2 WHEN 'poor' THEN 3 ELSE 0 END AS surface,
  CASE wheelchair_text WHEN 'yes' THEN 1 WHEN 'limited' THEN 2 WHEN 'no' THEN 3 ELSE 0 END AS wheelchair,
  CASE WHEN highway IN ('footway','pedestrian','living_street') THEN 1
   WHEN highway IN ('path','cycleway','track','service','residential','unclassified') OR highway LIKE 'track\_%' ESCAPE '\' THEN 2
   WHEN highway IN ('primary','secondary','tertiary','trunk','primary_link','secondary_link','tertiary_link','trunk_link') THEN 3
   ELSE 0 END AS way,
  CASE WHEN slope_pct IS NULL OR slope_pct IN ('NaN'::float8,'Infinity'::float8,'-Infinity'::float8) THEN NULL
   WHEN ABS(slope_pct)=0 THEN 0.0
   WHEN elev_start>=100 AND elev_end>=100
    AND elev_start NOT IN ('NaN'::float8,'Infinity'::float8,'-Infinity'::float8)
    AND elev_end NOT IN ('NaN'::float8,'Infinity'::float8,'-Infinity'::float8)
    AND ABS(elev_end-elev_start)>0.01 THEN ABS(slope_pct)
   ELSE NULL END AS sf
 FROM raw
), normalized AS (
 SELECT flags.*,display_class='steps' AND NOT escalator AS steps FROM flags
)
'''


def weighted_sql(options):
    allowed, multiplier = policy_sql(options)
    return NORMALIZED + ''' , weighted AS (
 SELECT id,source,target,atlas_fid,geom,length_m,steps,escalator,surface,wheelchair,way,sf,
  CASE WHEN cost<0 OR NOT (''' + allowed + ''') THEN -1.0 ELSE cost*''' + multiplier + ''' END AS cost,
  CASE WHEN reverse_cost<0 OR NOT (''' + allowed + ''') THEN -1.0 ELSE reverse_cost*''' + multiplier + ''' END AS reverse_cost
 FROM normalized
)
'''


def search_graph_sql(prefix, virtual, replaced, optimize=False):
    if optimize:
        # Only the full graph scan is materialized. Endpoint candidate queries
        # retain their original index-friendly plan. Project narrow rows so no
        # geometry, source tags or unused Atlas columns enter the temporary CTE.
        changes = [
            ('normalized AS (\n SELECT flags.*,',
             'normalized AS MATERIALIZED (\n SELECT id,source,target,cost,reverse_cost,surface,wheelchair,way,sf,escalator,'),
            ('SELECT id,source,target,atlas_fid,geom,length_m,steps,escalator,surface,wheelchair,way,sf,',
             'SELECT id,source,target,'),
            (', weighted AS (', ', weighted AS MATERIALIZED ('),
        ]
        for old, new in changes:
            if prefix.count(old) != 1:
                raise ValueError('Unexpected graph SQL; optimization not applied')
            prefix = prefix.replace(old, new, 1)
    blocked = ','.join(str(int(x)) for x in replaced)
    return prefix + ', virtual(id,parent_id,source,target,f0,f1,cost,reverse_cost) AS (VALUES ' + values_sql(virtual) + ''')
 SELECT id,source,target,cost,reverse_cost FROM weighted
 WHERE (cost>=0 OR reverse_cost>=0) AND id NOT IN (''' + blocked + ''')
 UNION ALL SELECT id,source,target,cost::double precision,reverse_cost::double precision FROM virtual'''


def connect():
    import psycopg2
    connection = psycopg2.connect('dbname=sonnenpfad user=sonnenpfad_api host=/var/run/postgresql',
        connect_timeout=3, application_name='sonnenpfad-profile-test',
        options='-c statement_timeout=10000 -c lock_timeout=2000 -c jit=off -c work_mem=64MB')
    connection.set_session(isolation_level='REPEATABLE READ', readonly=True)
    return connection


def candidates(cursor, prefix, point, radius, limit=CANDIDATES):
    # psycopg2 consumes percent signs when parameters are provided; the nested
    # pgRouting graph string is instead passed as a parameter unchanged.
    query = prefix.replace('%', '%%') + ''' , point AS (
 SELECT ST_Transform(ST_SetSRID(ST_MakePoint(%s,%s),4326),25832) AS geom
)
SELECT e.id,e.source,e.target,e.cost,e.reverse_cost,
 ST_LineLocatePoint(e.geom,p.geom) AS fraction,ST_Distance(e.geom,p.geom) AS distance,
 ST_AsGeoJSON(ST_Transform(ST_ClosestPoint(e.geom,p.geom),4326),9)::jsonb AS point
FROM weighted e CROSS JOIN point p
WHERE (e.cost>=0 OR e.reverse_cost>=0) AND ST_DWithin(e.geom,p.geom,%s)
ORDER BY ST_Distance(e.geom,p.geom),e.id LIMIT %s'''
    cursor.execute(query, (*point, radius, limit + 1))
    rows = [dict(row) for row in cursor.fetchall()]
    return rows[:limit], len(rows) > limit


def geometry_rows(cursor, virtual, path):
    ids = [int(step['edge']) for step in path if step['edge'] != -1]
    query = '''WITH virtual(id,parent_id,source,target,f0,f1,cost,reverse_cost) AS (VALUES ''' + values_sql(virtual) + '''),
parts AS (
 SELECT e.id,e.id AS parent_id,e.source,e.target,e.atlas_fid,e.geom
 FROM routing.walk_edges e WHERE e.id=ANY(%s)
 UNION ALL
 SELECT v.id,e.id,v.source,v.target,e.atlas_fid,ST_LineSubstring(e.geom,v.f0,v.f1)
 FROM virtual v JOIN routing.walk_edges e ON e.id=v.parent_id WHERE v.id=ANY(%s)
)
SELECT p.id,p.parent_id,p.source,p.target,p.atlas_fid,ST_Length(p.geom) AS length_m,
 ST_AsGeoJSON(ST_Transform(p.geom,4326),9)::jsonb AS geometry,
 ST_LineLocatePoint(a.geom,ST_StartPoint(p.geom)) AS atlas_f0,
 ST_LineLocatePoint(a.geom,ST_EndPoint(p.geom)) AS atlas_f1,
 jsonb_build_object('atlas_id',a.atlas_id,'name',a.name,'display_name',a.display_name,
 'fclass',a.fclass,'fclass_display',a.fclass_display,'elev_start',a.elev_start,'elev_end',a.elev_end,
 'slope_pct',a.slope_pct,'surface',a.surface,'surface_class',a.surface_class,
 'width',a.width,'wheelchair',a.wheelchair,'bridge',a.bridge,'tunnel',a.tunnel,
 'osm_tags_current',a.osm_tags_current,'routing_osm_tags',a.routing_osm_tags) AS atlas_attributes
FROM parts p LEFT JOIN routing.atlas_network a ON a.fid=p.atlas_fid'''
    cursor.execute(query, (ids, ids))
    records = {int(row['id']): dict(row) for row in cursor.fetchall()}
    if len(records) != len(set(ids)) or any(records[i]['atlas_f0'] is None for i in ids):
        raise RouteError(500, 'incomplete_metadata', 'Route metadata is incomplete; no partial route returned')
    return records


def route_metrics(segments, options):
    length = sum(segment['length_m'] for segment in segments)
    ascent = descent = 0.0
    heights_complete = True
    profile = []
    travelled = 0.0
    known = dict(surface=0.0, width=0.0, wheelchair=0.0, elevation=0.0)
    for segment in segments:
        a = segment['atlas_attributes']
        size = segment['length_m']
        z0, z1 = a.get('elev_start'), a.get('elev_end')
        if finite(z0) and finite(z1) and z0 >= 100 and z1 >= 100:
            first = z0 + (z1 - z0) * segment['atlas_t0']
            last = z0 + (z1 - z0) * segment['atlas_t1']
            ascent += max(0, last - first)
            descent += max(0, first - last)
            profile.extend([[travelled, first], [travelled + size, last]])
            known['elevation'] += size
        else:
            heights_complete = False
        if str(a.get('surface_class') or '').lower() in ('good','medium','poor'):
            known['surface'] += size
        if str(a.get('wheelchair') or '').lower() in ('yes','limited','no'):
            known['wheelchair'] += size
        try:
            width = float(a.get('width'))
            if math.isfinite(width) and width > 0:
                known['width'] += size
        except (ValueError, TypeError):
            pass
        travelled += size
    return dict(distance_m=round(length, 2), ascent_m=round(ascent, 2) if heights_complete else None,
        descent_m=round(descent, 2) if heights_complete else None,
        elevation_profile=profile if heights_complete else [],
        estimated_minutes=math.ceil(length/options['speedMpm'] + ascent/10*options['ascentMinutesPer10m']) if heights_complete else None,
        attribute_coverage={key: value/length if length else 0 for key,value in known.items()},
        time_is_estimated=True, shade=None, accessibility_certified=False)



def candidates_disconnected(cursor, prefix, request, graph):
    starts, start_limited = candidates(
        cursor, prefix, request['start'], request['max_snap_m'], limit=128)
    ends, end_limited = candidates(
        cursor, prefix, request['end'], request['max_snap_m'], limit=128)
    if start_limited or end_limited or not starts or not ends:
        return False
    nodes = sorted({
        int(row[key]) for row in starts + ends
        for key in ('source', 'target')
    })
    cursor.execute(
        'SELECT node,component FROM pgr_connectedComponents(%s) '
        'WHERE node=ANY(%s::bigint[])', (graph, nodes))
    components = {
        int(row['node']): int(row['component'])
        for row in cursor.fetchall()
    }
    if any(node not in components for node in nodes):
        return False
    start_components = {
        components[int(row[key])]
        for row in starts for key in ('source', 'target')
    }
    end_components = {
        components[int(row[key])]
        for row in ends for key in ('source', 'target')
    }
    return start_components.isdisjoint(end_components)


def calculate_route(body):
    request = validate_request(body)
    started = time.monotonic()
    def budget():
        if time.monotonic() - started > REQUEST_SECONDS:
            raise RouteError(503, 'search_budget_exceeded', 'Experimental search budget reached; no reachability claim')
    from psycopg2.extras import RealDictCursor
    options = dict(mobilityProfile=request['mobility_profile'], preference='balanced')
    tiers = relaxation_tiers(options)
    if not request['allow_relaxation']:
        tiers = tiers[:1]
    with contextlib.closing(connect()) as connection, connection.cursor(cursor_factory=RealDictCursor) as cursor:
        cursor.execute('SELECT GREATEST(max(source),max(target)) AS max_node,max(id) AS max_edge FROM routing.walk_edges')
        maxima = cursor.fetchone()
        if maxima['max_node'] is None:
            raise RouteError(503, 'empty_graph', 'Routing graph unavailable')
        for level, tier in enumerate(tiers):
            budget()
            prefix = weighted_sql(tier['options'])
            starts, start_limited = candidates(cursor, prefix, request['start'], request['max_snap_m'])
            ends, end_limited = candidates(cursor, prefix, request['end'], request['max_snap_m'])
            pairs = sorted(itertools.product(starts, ends), key=lambda pair: (pair[0]['distance']+pair[1]['distance'],pair[0]['id'],pair[1]['id']))
            attempted = 0
            disconnected = False
            connectivity_checked = False
            for start, end in pairs[:MAX_PAIRS]:
                budget()
                attempted += 1
                snaps = dict(start=start,end=end)
                endpoints, virtual, replaced = split_snapped_edges(snaps,maxima['max_node'],maxima['max_edge'])
                if endpoints['start'] == endpoints['end']:
                    raise RouteError(422, 'same_point', 'Start and destination snap to the same point')
                cursor.execute('SELECT seq,node,edge,cost,agg_cost FROM pgr_dijkstra(%s,%s::bigint,%s::bigint,true) ORDER BY seq',
                    (search_graph_sql(prefix,virtual,replaced,optimize=request['mobility_profile']!='standard'),endpoints['start'],endpoints['end']))
                path = [dict(row) for row in cursor.fetchall()]
                if not path:
                    if not connectivity_checked:
                        budget()
                        connectivity_checked = True
                        disconnected = candidates_disconnected(
                            cursor, prefix, request,
                            search_graph_sql(prefix,virtual,replaced,optimize=True))
                        budget()
                        if disconnected:
                            break
                    continue
                records = geometry_rows(cursor,virtual,path)
                coords = assemble_coordinates(path,records)
                if len(coords) < 2:
                    raise RouteError(500, 'invalid_geometry', 'Incomplete route geometry')
                segments = describe_segments(path,records)
                metrics = route_metrics(segments,tier['options'])
                return dict(type='FeatureCollection',features=[dict(type='Feature',geometry=dict(type='LineString',coordinates=coords),properties=dict(distance_m=metrics['distance_m']))],
                    properties=dict(**metrics, requested_profile=request['mobility_profile'], effective_options=tier['options'],
                        relaxed_criteria=tier['relaxed_criteria'], fallback_level=level,
                        segments=segments,segment_metadata_version=1,
                        snapped_start=start['point']['coordinates'],snapped_end=end['point']['coordinates'],
                        start_snap_distance_m=round(start['distance'],2),end_snap_distance_m=round(end['distance'],2),
                        attempted_snap_pairs=attempted,calculation_ms=round((time.monotonic()-started)*1000,1),
                        experimental=True,reference_commit=REFERENCE_COMMIT))
            if disconnected:
                continue
            # Limited directed candidate search is not proof of disconnection.
            # Never relax physical constraints on this inconclusive result.
            if starts and ends and (start_limited or end_limited or len(pairs)>MAX_PAIRS):
                raise RouteError(409,'candidate_search_limited','Candidate budget reached; not proof that no compliant route exists')
        if not starts or not ends:
            raise RouteError(404,'no_matching_snap','No profile-compatible edge in snap radius; no route returned')
        raise RouteError(404,'no_route','No route between tested candidates with permitted restrictions')


def capabilities():
    # Intentionally NOT the frontend's profile_contract_version=1 capability.
    # The public app must not auto-enable an unaccepted experimental adapter.
    return dict(experimental_api_version=1,production_ready=False,route_parity_verified=False,
        mobility_profiles=list(SUPPORTED),preferences=['balanced'],strict_by_default=True,
        topology='audited-osm-nodes',segment_metadata_version=1,shadow_model=None,
        reference_commit=REFERENCE_COMMIT)


class Handler(BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.0'
    def setup(self):
        super().setup()
        self.connection.settimeout(40)

    def log_message(self, *_args):
        pass  # Do not log endpoints or request bodies.

    def respond(self, status, body):
        payload = json.dumps(body,ensure_ascii=False,allow_nan=False).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type','application/json; charset=utf-8')
        self.send_header('Content-Length',str(len(payload)))
        self.send_header('Cache-Control','no-store')
        self.send_header('X-Content-Type-Options','nosniff')
        self.end_headers()
        self.wfile.write(payload)

    def do_GET(self):
        if self.path == '/capabilities':
            self.respond(200,capabilities())
        elif self.path == '/health':
            self.respond(200,dict(status='test-service-running',database_checked=False,production_ready=False))
        else:
            self.respond(404,dict(error='not_found'))

    def do_POST(self):
        if self.path != '/v1/route':
            self.respond(404,dict(error='not_found'))
            return
        acquired = False
        try:
            if self.headers.get('Transfer-Encoding'):
                raise RouteError(400,'unsupported_encoding','Transfer-Encoding is not supported')
            try:
                length = int(self.headers.get('Content-Length','0'))
            except ValueError:
                raise RouteError(400,'invalid_length','Invalid Content-Length')
            if not 0 < length <= MAX_BODY:
                raise RouteError(413,'body_size','Request body missing or too large')
            if self.headers.get('Content-Type','').split(';')[0].strip().lower() != 'application/json':
                raise RouteError(415,'content_type','Use application/json')
            data = self.rfile.read(length)
            if len(data) != length:
                raise RouteError(400,'incomplete_body','Incomplete body')
            try:
                body = json.loads(data,parse_constant=lambda _: (_ for _ in ()).throw(ValueError('Non-finite JSON')))
            except (ValueError,UnicodeDecodeError):
                raise RouteError(400,'invalid_json','Invalid JSON')
            validate_request(body)
            acquired = SLOTS.acquire(blocking=False)
            if not acquired:
                raise RouteError(503,'busy','One test calculation is already running')
            result = self.server.calculator(body)
            self.respond(200,result)
        except RouteError as error:
            self.respond(error.status,dict(error=error.code,message=str(error)))
        except (socket.timeout,TimeoutError):
            self.respond(408,dict(error='timeout'))
        except Exception as error:
            # No DSN, SQL text, coordinates or exception details in responses.
            code = getattr(error,'pgcode',None)
            self.respond(504 if code=='57014' else 503,dict(error='database_timeout' if code=='57014' else 'test_calculation_failed'))
            diagnostic = getattr(getattr(error,'diag',None),'message_primary','') if code else ''
            print('Test request failed: '+type(error).__name__+' '+str(code or '')+' '+str(diagnostic)[:200],flush=True)
        finally:
            if acquired:
                SLOTS.release()


def serve(port=8001, calculator=calculate_route):
    server = ThreadingHTTPServer(('127.0.0.1',port),Handler)
    server.daemon_threads = True
    server.calculator = calculator
    return server


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--self-test',action='store_true')
    parser.add_argument('--serve',action='store_true')
    args = parser.parse_args()
    if args.self_test:
        import unittest
        suite = unittest.defaultTestLoader.discover('.',pattern='test_*.py')
        if not suite.countTestCases():
            raise SystemExit('No tests discovered; run from api-stage1 directory')
        if not unittest.TextTestRunner(verbosity=2).run(suite).wasSuccessful():
            return 1
    if args.serve:
        import psycopg2  # Fail before binding if the known server dependency is absent.
        server = serve()
        print('Experimental API: http://127.0.0.1:8001 ; stop with Ctrl+C. Public API unchanged.',flush=True)
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass
        finally:
            server.server_close()
    if not (args.self_test or args.serve):
        parser.print_help()
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
