"""In-memory routing engine for Stage 2.

The audited graph (routing.walk_edges plus the gap supplement) is read once, read-only.
Costs, access rules, components, snapping choice, Dijkstra and relaxation follow the
browser core (scripts/core.mjs) and sonnenpfad_profile_rules.py, vectorised with numpy.
The database still answers nearest-edge and geometry queries; it is never modified.
"""
import collections
import contextlib
import heapq
import json
import math
import pathlib
import threading

import numpy as np

import profile_api as core
import shadows
from sonnenpfad_profile_rules import relaxation_tiers, resolved_options

POI_PATH = pathlib.Path(__file__).with_name('poi_points.json')
SHADE_PATH = pathlib.Path(__file__).with_name('shade_tiles.zip')
SNAP_CANDIDATES = 64
_LOCK = threading.Lock()
_ENGINE = None


def truthy(value):
    return str(value or '').strip().lower() in ('yes', 'true', '1', 'both', 'left', 'right')


def number_or_nan(value):
    try:
        value = float(value)
    except (TypeError, ValueError):
        return math.nan
    return value if math.isfinite(value) else math.nan


class EngineError(Exception):
    def __init__(self, code):
        super().__init__(code)
        self.code = code


def nearest_poi(edge_xy, poi_xy, values, radius, cell=500.0):
    """Nearest POI within radius per edge midpoint (grid cells + numpy), like prepare_data.nearest."""
    distance = np.full(len(edge_xy), np.inf)
    value = np.zeros(len(edge_xy), dtype=np.int16)
    if not len(poi_xy):
        return distance, value
    reach = int(math.ceil(radius / cell))
    ecell = np.floor(edge_xy / cell).astype(np.int64)
    pcell = np.floor(poi_xy / cell).astype(np.int64)
    buckets = {}
    for index, key in enumerate(map(tuple, pcell)):
        buckets.setdefault(key, []).append(index)
    order = np.lexsort((ecell[:, 1], ecell[:, 0]))
    keys, starts = np.unique(ecell[order], axis=0, return_index=True)
    bounds = list(starts) + [len(order)]
    for k, (cx, cy) in enumerate(keys):
        members = order[bounds[k]:bounds[k + 1]]
        near = [i for dx in range(-reach, reach + 1) for dy in range(-reach, reach + 1) for i in buckets.get((cx + dx, cy + dy), ())]
        if not near:
            continue
        near = np.array(near)
        d = np.hypot(edge_xy[members, None, 0] - poi_xy[None, near, 0], edge_xy[members, None, 1] - poi_xy[None, near, 1])
        best = d.argmin(axis=1)
        distance[members] = d[np.arange(len(members)), best]
        value[members] = values[near[best]]
    value[distance > radius] = 0
    distance[distance > radius] = np.inf
    return distance, value


def load_engine(connection):
    """Read the graph and project the POIs (read-only session)."""
    with connection.cursor() as cursor:
        cursor.execute('SET statement_timeout=180000')
        cursor.execute(Engine.load_sql())
        rows = cursor.fetchall()
        pois = json.loads(POI_PATH.read_text(encoding='utf-8')) if POI_PATH.exists() else {'points': [], 'counts': {}}
        points = pois['points']
        poi_xy = np.zeros((0, 2))
        if points:
            cursor.execute('''SELECT ST_X(g),ST_Y(g) FROM (SELECT ord,ST_Transform(ST_SetSRID(ST_MakePoint(x,y),4326),25832) g
              FROM unnest(%s::float8[],%s::float8[]) WITH ORDINALITY AS t(x,y,ord)) s ORDER BY ord''',
                           ([p[2] for p in points], [p[3] for p in points]))
            poi_xy = np.array(cursor.fetchall(), dtype=float)
    store = shadows.ShadeTiles(SHADE_PATH) if SHADE_PATH.exists() else None
    return Engine(rows, points, poi_xy, pois.get('counts', {}), store)


class Engine:
    def __init__(self, rows, points=(), poi_xy=np.zeros((0, 2)), poi_counts=None, shade_store=None):
        """rows: load_sql() columns (geometry WKB optional); points: [kind, crossing_class, lon, lat]."""
        columns = list(zip(*rows))
        (ids, sources, targets, cost, reverse, length, steps, escalator, surface, wheelchair, way,
         sf, dz_sign, forward_on_atlas, handrail, tactile, width, covered, mx, my) = columns[:20]
        self.shade_store = shade_store
        if shade_store is not None and len(columns) > 20:
            # Edge lines in the app's local metre frame, where the browser shadow model works.
            import shapely
            lines = shapely.from_wkb([bytes(w) for w in columns[20]])
            xy, owner = shapely.get_coordinates(lines, return_index=True)
            x, y = shade_store.local(xy[:, 0], xy[:, 1])
            self.coords = np.column_stack([x, y])
            self.offsets = np.concatenate([[0], np.cumsum(np.bincount(owner, minlength=len(ids)))])
            first, last = self.coords[self.offsets[:-1]], self.coords[self.offsets[1:] - 1]
            grid = shade_store.meta['grid']
            cells = np.floor((first + last) / 2 / grid).astype(int)
            self.tile = np.array([f'{cx}_{cy}' for cx, cy in cells.tolist()], dtype=object)
        self.shade_cache = collections.OrderedDict()
        self.cache_lock = threading.Lock()  # two routes may run at once
        self.edge_id = np.array(ids, dtype=np.int64)
        self.index = {int(e): i for i, e in enumerate(self.edge_id)}
        nodes, compact = np.unique(np.concatenate([np.array(sources, dtype=np.int64), np.array(targets, dtype=np.int64)]), return_inverse=True)
        self.node_id = nodes
        n = len(ids)
        self.src, self.dst = compact[:n].astype(np.int64), compact[n:].astype(np.int64)
        self.length = np.array(length, dtype=float)
        self.fwd_ok = np.array(cost, dtype=float) >= 0
        self.rev_ok = np.array(reverse, dtype=float) >= 0
        self.steps = np.array(steps, dtype=bool)
        self.escalator = np.array(escalator, dtype=bool)
        self.surface = np.array(surface, dtype=np.int8)
        self.wheelchair = np.array(wheelchair, dtype=np.int8)
        self.way = np.array(way, dtype=np.int8)
        # Signed gradient along source->target; NaN is unknown (never treated as flat).
        magnitude = np.array([math.nan if v is None else float(v) for v in sf])
        direction = np.where(np.array(forward_on_atlas, dtype=bool), 1.0, -1.0) * np.array(dz_sign, dtype=float)
        self.sf = np.where(magnitude == 0, 0.0, magnitude * direction)
        self.handrail = np.array([truthy(v) for v in handrail])
        self.tactile = np.array([truthy(v) for v in tactile])
        self.width = np.array([number_or_nan(v) for v in width])
        self.covered = np.array(covered, dtype=bool)
        midpoints = np.column_stack([np.array(mx, dtype=float), np.array(my, dtype=float)])
        kinds = np.array([p[0] for p in points], dtype=np.int16)
        classes = np.array([p[1] for p in points], dtype=np.int16)
        bench, _ = nearest_poi(midpoints, poi_xy[kinds == 9], classes[kinds == 9], 1000)
        shelter, _ = nearest_poi(midpoints, poi_xy[kinds == 10], classes[kinds == 10], 1000)
        _, crossing = nearest_poi(midpoints, poi_xy[kinds == 1], classes[kinds == 1], 30)
        self.bench = np.where(np.isfinite(bench), np.round(bench), 65535.0)
        self.shelter = np.where(np.isfinite(shelter), np.round(shelter), 65535.0)
        self.crossing = crossing
        self.poi_counts = poi_counts or {}
        # Undirected incidence lists; direction rules are applied per request.
        incident = [[] for _ in range(len(nodes))]
        for i, (a, b) in enumerate(zip(self.src.tolist(), self.dst.tolist())):
            incident[a].append((i, b, 1))
            incident[b].append((i, a, -1))
        self.incident = incident
        self.components = {}

    @staticmethod
    def load_sql():
        # The same normalisation as the SQL engine; only routable edges are loaded.
        prefix = core.NORMALIZED.replace('__EDGES__', core.edges_cte(), 1)
        return prefix + '''
SELECT n.id,n.source,n.target,n.cost,n.reverse_cost,n.length_m,n.steps,n.escalator,n.surface,n.wheelchair,n.way,n.sf,
 sign(COALESCE(n.elev_end-n.elev_start,0)),
 ST_LineLocatePoint(n.atlas_geom,ST_StartPoint(n.geom))<=ST_LineLocatePoint(n.atlas_geom,ST_EndPoint(n.geom)),
 a.handrail,a.tactile_paving,a.width,
 lower(COALESCE(a.covered_current,''))='yes' OR lower(COALESCE(a.tunnel,'')) IN ('t','yes','true','1'),
 ST_X(ST_LineInterpolatePoint(n.geom,.5)),ST_Y(ST_LineInterpolatePoint(n.geom,.5)),
 ST_AsBinary(ST_Transform(n.geom,4326))
FROM normalized n JOIN routing.atlas_network a ON a.fid=n.atlas_fid'''

    # --- shadows (browser model, shadows.py) ------------------------------------------------
    def shades(self, start, end, epoch_ms, leaf_on, edges=None):
        """Shade fraction per edge for the route corridor (app routeTileKeys) or the given edges.

        Edges outside the corridor stay 0, exactly as in the browser's route-aware shading.
        """
        store = self.shade_store
        lon, lat = (start[0] + end[0]) / 2, (start[1] + end[1]) / 2
        altitude, azimuth = shadows.sun_position(epoch_ms, lat, lon)
        a, b = [tuple(map(float, store.local(*p))) for p in (start, end)]
        keys = shadows.corridor_tiles(a, b, store.meta['grid'], store.available)
        cache_key = (tuple(sorted(keys)), epoch_ms, leaf_on, None if edges is None else tuple(sorted(set(edges))))
        with self.cache_lock:
            if cache_key in self.shade_cache:
                return self.shade_cache[cache_key], (altitude, azimuth)
        tiles = [store.tile(key) for key in keys]
        footprints = shadows.Footprints.combine([t[0] for t in tiles])
        crowns = shadows.tree_crowns([tree for t in tiles for tree in t[1]], altitude, azimuth, leaf_on)
        if edges is None:
            edges = np.flatnonzero(np.isin(self.tile, keys))
        edges = np.asarray(sorted(set(int(e) for e in edges)), dtype=int)
        result = np.zeros(len(self.length))
        result[edges] = shadows.edge_shades(self.coords, self.offsets, edges, self.covered, footprints, crowns, altitude, azimuth)
        with self.cache_lock:
            self.shade_cache[cache_key] = result
            while len(self.shade_cache) > 6:
                self.shade_cache.popitem(last=False)
        return result, (altitude, azimuth)

    # --- rules (vectorised port of sonnenpfad_profile_rules / core.mjs) -------------------
    def allowed(self, options, direction):
        ok = np.ones(len(self.length), dtype=bool)
        if options.get('avoidSteps'):
            ok &= ~self.steps
        if options.get('avoidEscalators'):
            ok &= ~self.escalator
        if options.get('avoidPoorSurface'):
            ok &= self.surface != 3
        if options.get('avoidWheelchairNo'):
            ok &= self.wheelchair != 3
        if options.get('maxSlope'):
            directed = self.sf * direction
            ok &= np.isnan(directed) | (np.abs(directed) <= options['maxSlope'])
        return ok

    def multiplier(self, options, direction, shade=None):
        preference = options.get('preference', 'balanced')
        solar = options.get('solarWeight')
        solar = max(0.0, min(1.0, solar if isinstance(solar, (int, float)) and math.isfinite(solar) else 1.0))
        shade = np.zeros(len(self.length)) if shade is None else shade
        exposure = 1 - shade if preference == 'shade' else shade if preference == 'sun' else 0.0
        cost = 1 + exposure * 1.6 * solar + np.zeros(len(self.length))
        directed = self.sf * direction
        unknown = np.isnan(directed)
        mode = options.get('slopeMode') or ('both' if options.get('gentle') else 'none')
        if mode != 'none':
            value = np.abs(directed) if mode == 'both' else np.maximum(0, directed if mode == 'uphill' else -directed)
            factor = options.get('slopeFactor')
            cost += np.minimum(5, np.where(unknown, 24.0, value) / 6) * (1 if factor is None else factor)
        if options.get('downhillFactor'):
            cost += np.where(unknown, 0.0, np.minimum(3, np.maximum(0, -directed) / 8)) * options['downhillFactor']
        if options.get('surfaceFactor'):
            cost += np.select([self.surface == 3, self.surface == 2], [2.5, .7], 0.0) * options['surfaceFactor']
        if options.get('wayFactor'):
            cost += np.select([self.way == 3, self.way == 2], [1.7, .35], 0.0) * options['wayFactor']
        if options.get('wheelchairFactor'):
            cost += np.select([self.wheelchair == 3, self.wheelchair == 2], [4.0, 1.3], 0.0) * options['wheelchairFactor']
        if options.get('crossingFactor'):
            cost += np.select([self.crossing == 1, self.crossing == 2], [2.4, .55], 0.0) * options['crossingFactor']
        if options.get('stairGuidanceFactor'):
            cost += np.where(self.steps, np.where(self.handrail, 0.0, 1.2) + np.where(self.tactile, 0.0, 1.2), 0.0)
        if options.get('benchFactor'):
            cost += np.minimum(2, np.maximum(0, (np.minimum(self.bench, 1000) - 100) / 450)) * options['benchFactor']
        if options.get('shelterFactor'):
            cost += np.minimum(1.2, np.maximum(0, (np.minimum(self.shelter, 1000) - 200) / 650)) * options['shelterFactor']
        if options.get('unknownFactor'):
            count = (self.surface == 0).astype(float) + np.isnan(self.sf)
            if options.get('avoidWheelchairNo'):
                count += self.wheelchair == 0
            cost += count * options['unknownFactor']
        return cost

    def costs(self, options, shade=None):
        """Per-edge travel cost forwards and backwards; inf where not permitted."""
        forward = np.where(self.fwd_ok & self.allowed(options, 1), self.length * self.multiplier(options, 1, shade), np.inf)
        backward = np.where(self.rev_ok & self.allowed(options, -1), self.length * self.multiplier(options, -1, shade), np.inf)
        return forward, backward

    def component_ids(self, options):
        key = tuple(str(options.get(k) or False) for k in ('avoidSteps', 'avoidEscalators', 'avoidPoorSurface', 'avoidWheelchairNo', 'maxSlope'))
        if key not in self.components:
            usable = (self.allowed(options, 1) & self.fwd_ok) | (self.allowed(options, -1) & self.rev_ok)
            ids = np.full(len(self.node_id), -1, dtype=np.int64)
            next_id = 0
            usable_list = usable.tolist()
            for start in range(len(ids)):
                if ids[start] >= 0 or not any(usable_list[e] for e, _, _ in self.incident[start]):
                    continue
                ids[start] = next_id
                stack = [start]
                while stack:
                    u = stack.pop()
                    for e, v, _ in self.incident[u]:
                        if usable_list[e] and ids[v] < 0:
                            ids[v] = next_id
                            stack.append(v)
                next_id += 1
            self.components[key] = ids
        return self.components[key]

    # --- one tier, like core.mjs route() ----------------------------------------------------
    def route(self, start_candidates, end_candidates, options, max_snap, shade=None):
        forward, backward = self.costs(options, shade)
        components = self.component_ids(options)
        def best_by_component(candidates):
            best = {}
            for c in candidates:
                i = self.index.get(int(c['id']))
                if i is None or c['distance'] > max_snap or not (forward[i] < np.inf or backward[i] < np.inf):
                    continue
                component = int(components[self.src[i]])
                if component < 0:
                    continue
                if component not in best or c['distance'] < best[component][1]['distance']:
                    best[component] = (i, c)
            return best
        starts, ends = best_by_component(start_candidates), best_by_component(end_candidates)
        pair = min(((starts[k], ends[k]) for k in starts.keys() & ends.keys()), key=lambda p: p[0][1]['distance'] + p[1][1]['distance'], default=None)
        if pair is None:
            return {'error': 'outside', 'any_snap': bool(start_candidates and end_candidates)}
        (ai, a), (bi, b) = pair
        ta, tb = min(1.0, max(0.0, float(a['fraction']))), min(1.0, max(0.0, float(b['fraction'])))
        fw, bw, length = forward.tolist(), backward.tolist(), self.length.tolist()
        direct = None
        if ai == bi:
            go = tb >= ta
            cost = (fw if go else bw)[ai] * abs(tb - ta)
            if cost < math.inf:
                if abs(tb - ta) * length[ai] < .01:
                    return {'error': 'same'}
                direct = (cost, [(ai, ta, tb)])
        src, dst = int(self.src[ai]), int(self.dst[ai])
        dist, prev = {}, {}
        heap = []
        def seed(node, cost, part):
            if cost < dist.get(node, math.inf):
                dist[node] = cost; prev[node] = ('seed', part); heapq.heappush(heap, (cost, node))
        if ta < 1e-12 or bw[ai] < math.inf:
            seed(src, bw[ai] * ta if ta >= 1e-12 else 0.0, (ai, ta, 0.0))
        if 1 - ta < 1e-12 or fw[ai] < math.inf:
            seed(dst, fw[ai] * (1 - ta) if 1 - ta >= 1e-12 else 0.0, (ai, ta, 1.0))
        finals = {}
        def final(node, cost, part):
            if cost < finals.get(node, (math.inf,))[0]:
                finals[node] = (cost, part)
        bsrc, bdst = int(self.src[bi]), int(self.dst[bi])
        if tb < 1e-12 or fw[bi] < math.inf:
            final(bsrc, fw[bi] * tb if tb >= 1e-12 else 0.0, (bi, 0.0, tb))
        if 1 - tb < 1e-12 or bw[bi] < math.inf:
            final(bdst, bw[bi] * (1 - tb) if 1 - tb >= 1e-12 else 0.0, (bi, 1.0, tb))
        best, target = (direct[0] if direct else math.inf), None
        incident = self.incident
        while heap:
            cost, u = heapq.heappop(heap)
            if cost != dist.get(u) or cost >= best:
                if cost >= best:
                    break
                continue
            if u in finals and cost + finals[u][0] < best:
                best, target = cost + finals[u][0], u
            for e, v, direction in incident[u]:
                step = fw[e] if direction == 1 else bw[e]
                if step == math.inf:
                    continue
                nd = cost + step
                if nd < dist.get(v, math.inf):
                    dist[v] = nd; prev[v] = (e, direction, u); heapq.heappush(heap, (nd, v))
        if target is None:
            if direct:
                return {'parts': direct[1], 'cost': direct[0], 'snaps': (a, b)}
            return {'error': 'disconnected'}
        parts, u = [finals[target][1]], target
        while prev[u][0] != 'seed':
            e, direction, u0 = prev[u]
            parts.append((e, 0.0, 1.0) if direction == 1 else (e, 1.0, 0.0))
            u = u0
        parts.append(prev[u][1])
        parts.reverse()
        return {'parts': [p for p in parts if abs(p[1] - p[2]) > 1e-12], 'cost': best, 'snaps': (a, b)}


SUPPORTED = ('standard', 'wheelchair', 'powerWheelchair', 'walkingAid', 'vision', 'stroller', 'custom')
CUSTOM_FLAGS = ('avoidSteps', 'avoidEscalators', 'avoidPoorSurface', 'avoidWheelchairNo')
# Exactly what the app sends for "custom" (app.source.mjs routeOptions); nothing else is accepted.
CUSTOM_FIXED = dict(unknownFactor=.45, speedMpm=75, ascentMinutesPer10m=1)


def restricted(options):
    return any(options.get(k) for k in ('avoidSteps', 'avoidEscalators', 'avoidPoorSurface', 'avoidWheelchairNo', 'maxSlope'))


def snap_candidates(cursor, point, radius):
    """Nearest routable edges (walk_edges plus nearby supplement), ordered by distance."""
    edges = core.scope_supplement(core.edges_cte(), 'ST_DWithin(a.geom,ST_Transform(ST_SetSRID(ST_MakePoint(%r,%r),4326),25832),%r)'
                                  % (float(point[0]), float(point[1]), float(radius)))
    cursor.execute('WITH ' + edges.replace('%', '%%') + ''', point AS (SELECT ST_Transform(ST_SetSRID(ST_MakePoint(%s,%s),4326),25832) AS geom)
SELECT e.id,ST_LineLocatePoint(e.geom,p.geom) AS fraction,ST_Distance(e.geom,p.geom) AS distance,
 ST_AsGeoJSON(ST_Transform(ST_ClosestPoint(e.geom,p.geom),4326),9)::jsonb AS point
FROM all_edges e CROSS JOIN point p
WHERE (e.cost>=0 OR e.reverse_cost>=0) AND ST_DWithin(e.geom,p.geom,%s)
ORDER BY ST_Distance(e.geom,p.geom),e.id LIMIT %s''', (*point, radius, SNAP_CANDIDATES))
    return [dict(row) for row in cursor.fetchall()]


def route_segments(cursor, engine, parts):
    """Oriented pieces with atlas attributes, in the segment format of the SQL engine."""
    ids = [int(engine.edge_id[i]) for i, _, _ in parts]
    edges = core.scope_supplement(core.edges_cte(), 's.id IN (' + ','.join(map(str, sorted(set(ids)))) + ')')
    values = ','.join('(%d,%d,%r,%r)' % (seq, edge, float(t0), float(t1)) for seq, (edge, (_, t0, t1)) in enumerate(zip(ids, parts)))
    cursor.execute('WITH ' + edges.replace('%', '%%') + ''', parts(seq,id,t0,t1) AS (VALUES ''' + values + '''),
pieces AS (SELECT p.seq,p.id,e.atlas_fid,CASE WHEN p.t0<=p.t1 THEN ST_LineSubstring(e.geom,p.t0,p.t1)
  ELSE ST_Reverse(ST_LineSubstring(e.geom,p.t1,p.t0)) END AS g FROM parts p JOIN all_edges e ON e.id=p.id)
SELECT s.seq,s.id,s.atlas_fid,ST_Length(s.g) AS length_m,ST_AsGeoJSON(ST_Transform(s.g,4326),9)::jsonb AS geometry,
 ST_LineLocatePoint(a.geom,ST_StartPoint(s.g)) AS atlas_t0,ST_LineLocatePoint(a.geom,ST_EndPoint(s.g)) AS atlas_t1,
 jsonb_build_object('atlas_id',a.atlas_id,'name',a.name,'display_name',a.display_name,
 'fclass',a.fclass,'fclass_display',a.fclass_display,'elev_start',a.elev_start,'elev_end',a.elev_end,
 'slope_pct',a.slope_pct,'surface',a.surface,'surface_class',a.surface_class,
 'width',a.width,'wheelchair',a.wheelchair,'bridge',a.bridge,'tunnel',a.tunnel,
 'osm_tags_current',a.osm_tags_current,'routing_osm_tags',a.routing_osm_tags) AS atlas_attributes
FROM pieces s JOIN routing.atlas_network a ON a.fid=s.atlas_fid ORDER BY s.seq''')
    rows = [dict(row) for row in cursor.fetchall()]
    if len(rows) != len(parts):
        raise core.RouteError(500, 'incomplete_metadata', 'Route metadata is incomplete; no partial route returned')
    segments, coords = [], []
    for row in rows:
        points = row['geometry']['coordinates']
        if coords:
            if math.hypot(coords[-1][0] - points[0][0], coords[-1][1] - points[0][1]) > 1e-7:
                raise core.RouteError(500, 'invalid_geometry', 'Routing geometry has a gap')
            coords.extend(points[1:])
        else:
            coords.extend(points)
        segments.append(dict(edge_id=int(row['id']), atlas_fid=int(row['atlas_fid']), length_m=float(row['length_m']),
                             atlas_t0=float(row['atlas_t0']), atlas_t1=float(row['atlas_t1']),
                             geometry=row['geometry'], atlas_attributes=row['atlas_attributes']))
    return segments, coords


def calculate(request):
    """Route one validated request (see app.validate_contract) with the in-memory engine."""
    from psycopg2.extras import RealDictCursor
    engine = get_engine()
    options, weight = dict(request['options']), request.get('solar_weight')
    tiers = relaxation_tiers(options)
    if not request['allow_relaxation']:
        tiers = tiers[:1]
    with contextlib.closing(core.connect()) as connection, connection.cursor(cursor_factory=RealDictCursor) as cursor:
        if core.SUPPLEMENT:
            cursor.execute('SELECT GREATEST(max(source),max(target)) AS max_node,max(id) AS max_edge FROM routing.walk_edges')
            maxima = cursor.fetchone()
            if (maxima['max_edge'], maxima['max_node']) != (core.SUPPLEMENT['baseMaxEdge'], core.SUPPLEMENT['baseMaxNode']):
                raise core.RouteError(503, 'gap_supplement_stale', 'Routing graph changed; the gap supplement must be regenerated')
        starts = snap_candidates(cursor, request['start'], request['max_snap_m'])
        ends = snap_candidates(cursor, request['end'], request['max_snap_m'])
        if not starts or not ends:
            raise core.RouteError(404, 'no_matching_snap', 'No walkable edge in snap radius; no route returned')
        when, leaf_on, preference = request.get('time_ms'), request.get('leaf_on', True), request.get('preference', 'balanced')
        shaded = sun = None
        if preference != 'balanced':
            if when is None or engine.shade_store is None:
                raise core.RouteError(422, 'unsupported_preference', 'Sun/shade routing needs a time and the shadow data')
            shaded, sun = engine.shades(request['start'], request['end'], when, leaf_on)
        profile_blocked = None
        for level, tier in enumerate(tiers):
            effective = dict(tier['options'])
            result = engine.route(starts, ends, effective | ({'solarWeight': weight} if weight is not None else {}), request['max_snap_m'], shaded)
            if 'parts' in result:
                segments, coords = route_segments(cursor, engine, result['parts'])
                metrics = core.route_metrics(segments, effective)
                if when is not None and engine.shade_store is not None:
                    parts = result['parts']
                    if shaded is None:
                        shaded, sun = engine.shades(request['start'], request['end'], when, leaf_on, [i for i, _, _ in parts])
                    sizes = [engine.length[i] * abs(t1 - t0) for i, t0, t1 in parts]
                    metrics['shade'] = round(float(sum(shaded[i] * size for (i, _, _), size in zip(parts, sizes)) / sum(sizes)), 4) if sum(sizes) else 0.0
                    metrics['sun_altitude_deg'] = round(sun[0], 2)
                a, b = result['snaps']
                return dict(type='FeatureCollection', features=[dict(type='Feature', geometry=dict(type='LineString', coordinates=coords), properties=dict(distance_m=metrics['distance_m']))],
                            properties=dict(**metrics, requested_profile=request['mobility_profile'], preference=preference, effective_options=effective,
                                            relaxed_criteria=tier['relaxed_criteria'], fallback_level=level, segments=segments, segment_metadata_version=1,
                                            snapped_start=a['point']['coordinates'], snapped_end=b['point']['coordinates'],
                                            start_snap_distance_m=round(a['distance'], 2), end_snap_distance_m=round(b['distance'], 2),
                                            engine='in-memory', experimental=True, reference_commit=core.REFERENCE_COMMIT))
            if result['error'] == 'same':
                raise core.RouteError(422, 'same_point', 'Start and destination snap to the same point')
            # Only a route blocked by the profile's own restrictions may try the next tier (core.mjs profileBlocked).
            if not restricted(effective):
                break
            if profile_blocked is None:
                free = {k: v for k, v in effective.items() if k not in ('avoidSteps', 'avoidEscalators', 'avoidPoorSurface', 'avoidWheelchairNo', 'maxSlope')}
                profile_blocked = 'parts' in engine.route(starts, ends, free, request['max_snap_m'], shaded)
            if not profile_blocked:
                break
        if result['error'] == 'outside' and not profile_blocked:
            raise core.RouteError(404, 'no_matching_snap', 'No mutually reachable walkable edges in snap radius')
        raise core.RouteError(404, 'no_route', 'No route with the permitted restrictions')


def get_engine():
    global _ENGINE
    with _LOCK:
        if _ENGINE is None:
            with contextlib.closing(core.connect()) as connection:
                _ENGINE = load_engine(connection)
        return _ENGINE
