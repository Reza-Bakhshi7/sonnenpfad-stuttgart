"""Read-only export of the Stage-2 routing graph for the browser's emergency routing.

Run on the VM in the Stage-2 directory as sonnenpfad_api (read-only session):
  python3 -B export_server_network.py OUT_DIR ORIGIN_LON ORIGIN_LAT SCALE_X SCALE_Y
ORIGIN/SCALE are the app's local metre frame (dist/city/manifest.json). The graph is
exactly the one the server routes on (walk_edges plus gap supplement, blocked edges
left out, one-way rules kept); each server edge becomes straight browser pieces
between its vertices, with length, gradient, heights and attributes of that edge.
"""
import contextlib
import json
import math
import pathlib
import struct
import sys

import numpy as np

import engine
import profile_api as core

NODE = struct.Struct('<ff')
EDGE = struct.Struct('<IIfffffbbbbHBBHHHBBxxxx')  # the browser format (tile_city_data.py)
CHUNK, SNAP_GRID, SNAP_KEYS = 524288, 500, 200

QUERY = core.NORMALIZED.replace('__EDGES__', core.edges_cte(), 1) + '''
SELECT n.id,n.source,n.target,n.cost,n.reverse_cost,n.length_m,n.steps,n.escalator,n.surface,n.wheelchair,n.way,n.sf,
 sign(COALESCE(n.elev_end-n.elev_start,0)),
 ST_LineLocatePoint(n.atlas_geom,ST_StartPoint(n.geom))<=ST_LineLocatePoint(n.atlas_geom,ST_EndPoint(n.geom)),
 a.handrail,a.tactile_paving,a.width,
 lower(COALESCE(a.covered_current,''))='yes' OR lower(COALESCE(a.tunnel,'')) IN ('t','yes','true','1'),
 ST_X(ST_LineInterpolatePoint(n.geom,.5)),ST_Y(ST_LineInterpolatePoint(n.geom,.5)),
 n.elev_start,n.elev_end,
 (SELECT array_agg(ST_X(ST_Transform(d.geom,4326)) ORDER BY d.path) FROM ST_DumpPoints(n.geom) d),
 (SELECT array_agg(ST_Y(ST_Transform(d.geom,4326)) ORDER BY d.path) FROM ST_DumpPoints(n.geom) d),
 (SELECT array_agg(ST_LineLocatePoint(n.atlas_geom,d.geom) ORDER BY d.path) FROM ST_DumpPoints(n.geom) d)
FROM normalized n JOIN routing.atlas_network a ON a.fid=n.atlas_fid ORDER BY n.id'''


def valid_height(value):
    return value is not None and math.isfinite(value) and value >= 100


def main():
    out, lon0, lat0, sx, sy = pathlib.Path(sys.argv[1]), *map(float, sys.argv[2:6])
    out.mkdir(parents=True, exist_ok=True)
    with contextlib.closing(core.connect()) as connection, connection.cursor() as cursor:
        cursor.execute('SHOW transaction_read_only')
        assert cursor.fetchone()[0] == 'on', 'session must be read-only'
        cursor.execute('SET statement_timeout=600000')
        cursor.execute(QUERY)
        rows = cursor.fetchall()
        cursor.execute('SELECT max(routing_reference_timestamp) FROM routing.atlas_network')
        reference = cursor.fetchone()[0]
        pois = json.loads(engine.POI_PATH.read_text(encoding='utf-8'))['points']
        cursor.execute('''SELECT ST_X(g),ST_Y(g) FROM (SELECT ord,ST_Transform(ST_SetSRID(ST_MakePoint(x,y),4326),25832) g
          FROM unnest(%s::float8[],%s::float8[]) WITH ORDINALITY AS t(x,y,ord)) s ORDER BY ord''', ([p[2] for p in pois], [p[3] for p in pois]))
        poi_xy = np.array(cursor.fetchall(), dtype=float)
    # Same POI distances as the server engine (bench/shelter 1 km, crossing class 30 m).
    mid = np.array([[r[18], r[19]] for r in rows], dtype=float)
    kinds, classes = np.array([p[0] for p in pois]), np.array([p[1] for p in pois])
    bench, _ = engine.nearest_poi(mid, poi_xy[kinds == 9], classes[kinds == 9], 1000)
    shelter, _ = engine.nearest_poi(mid, poi_xy[kinds == 10], classes[kinds == 10], 1000)
    _, crossing = engine.nearest_poi(mid, poi_xy[kinds == 1], classes[kinds == 1], 30)

    node_index, nodes, edges, snap = {}, [], [], {}
    def node(key, xy):
        if key not in node_index:
            node_index[key] = len(nodes)
            nodes.append(xy)
        return node_index[key]
    for k, r in enumerate(rows):
        (eid, source, target, cost, reverse, length, steps, escalator, surface, wheelchair, way, sf, dz_sign, forward_on_atlas,
         handrail, tactile, width, covered, _, _, elev_start, elev_end, lons, lats, ts) = r
        fwd, rev = cost >= 0, reverse >= 0
        if not (fwd or rev) or not lons:
            continue
        # Signed gradient source->target like engine.Engine; unknown stays NaN.
        signed = math.nan if sf is None else 0.0 if sf == 0 else float(sf) * (1 if forward_on_atlas else -1) * float(dz_sign)
        heights = valid_height(elev_start) and valid_height(elev_end)
        pts = [((lon - lon0) * sx, (lat - lat0) * sy) for lon, lat in zip(lons, lats)]
        keep = [0] + [i for i in range(1, len(pts)) if math.dist(pts[i], pts[i - 1]) > 1e-3]
        if len(keep) < 2:
            keep = [0, len(pts) - 1]
        keep[-1] = len(pts) - 1
        pieces = [math.dist(pts[keep[j]], pts[keep[j + 1]]) for j in range(len(keep) - 1)]
        total = sum(pieces) or 1.0
        ids = [node(('n', source), pts[0])] + [node(('v', eid, i), pts[i]) for i in keep[1:-1]] + [node(('n', target), pts[-1])]
        flags = (1 if steps else 0) | (2 if covered else 0)
        mobility = (1 if engine.truthy(tactile) else 0) | (2 if engine.truthy(handrail) else 0) | (8 if escalator else 0)
        w = engine.number_or_nan(width)
        for j, piece in enumerate(pieces):
            a, b = ids[j], ids[j + 1]
            z = [elev_start + (elev_end - elev_start) * ts[keep[j + m]] if heights else math.nan for m in (0, 1)]
            index = len(edges)
            edges.append(EDGE.pack(a, b, float(length) * (piece / total if sum(pieces) else 1 / len(pieces)), abs(signed) if not math.isnan(signed) else math.nan,
                                   signed, z[0], z[1], 0 if fwd and rev else 1 if fwd else -1, flags, 0, 0, mobility, surface, way,
                                   0 if math.isnan(w) else min(65535, round(w * 10)),
                                   int(min(bench[k], 65535)), int(min(shelter[k], 65535)), int(crossing[k]), wheelchair))
            (xa, ya), (xb, yb) = nodes[a], nodes[b]
            for x in range(math.floor(min(xa, xb) / SNAP_GRID), math.floor(max(xa, xb) / SNAP_GRID) + 1):
                for y in range(math.floor(min(ya, yb) / SNAP_GRID), math.floor(max(ya, yb) / SNAP_GRID) + 1):
                    snap.setdefault(f'{x}_{y}', []).append(index)

    def chunks(stem, data):
        names = []
        for n, offset in enumerate(range(0, len(data), CHUNK)):
            (out / f'{stem}-{n:03d}.bin').write_bytes(data[offset:offset + CHUNK])
            names.append(f'routing/{stem}-{n:03d}.bin')
        return names
    items, snap_files = sorted(snap.items()), []
    for n, offset in enumerate(range(0, len(items), SNAP_KEYS)):
        (out / f'snap-index-{n:03d}.json').write_text(json.dumps(dict(items[offset:offset + SNAP_KEYS]), separators=(',', ':')), encoding='utf-8')
        snap_files.append(f'routing/snap-index-{n:03d}.json')
    manifest = {'nodes': chunks('nodes', b''.join(NODE.pack(*p) for p in nodes)), 'nodeCount': len(nodes), 'nodeStride': 8,
                'edges': chunks('edges', b''.join(edges)), 'edgeCount': len(edges), 'edgeStride': 48,
                'snapIndex': snap_files, 'snapGrid': SNAP_GRID,
                'source': {'graph': 'routing.walk_edges + gap_supplement (Stage 2)', 'serverEdges': len(rows), 'routingReference': reference}}
    (out / 'routing.json').write_text(json.dumps(manifest, indent=1), encoding='utf-8')
    print(json.dumps({k: manifest[k] for k in ('nodeCount', 'edgeCount')} | {'serverEdges': len(rows)}))


if __name__ == '__main__':
    main()
