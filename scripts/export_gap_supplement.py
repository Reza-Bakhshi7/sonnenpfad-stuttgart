"""Read-only export of atlas ways that have no row in routing.walk_edges.

Run on the VM in the Stage-2 directory as sonnenpfad_api (read-only session):
  python3 -B export_gap_supplement.py > gap_supplement.json
Each missing atlas way is cut at graph vertices on it (<= 0.1 m, so crossings
without a shared vertex stay unconnected) and at ends of other missing ways.
Its ends join a graph vertex within 0.5 m, or the ends of other missing ways.
Pieces are walkable both ways with cost = length, like routing.walk_edges.
Profile rules (stairs, surface, wheelchair, slope) still apply via atlas data.
"""
import collections
import contextlib
import json
import sys

from profile_api import connect

INTERIOR, END, MERGE = 0.1, 0.5, 0.05
GAP = """WITH w AS (SELECT DISTINCT atlas_fid FROM routing.walk_edges)
 SELECT a.fid, a.geom, ST_Length(a.geom) len FROM routing.atlas_network a LEFT JOIN w ON w.atlas_fid=a.fid WHERE w.atlas_fid IS NULL"""


def main():
    with contextlib.closing(connect()) as connection, connection.cursor() as cursor:
        cursor.execute('SHOW transaction_read_only')
        assert cursor.fetchone()[0] == 'on', 'session must be read-only'
        cursor.execute('SET statement_timeout=300000')
        cursor.execute('SELECT max(id) FROM routing.walk_edges')
        max_edge = cursor.fetchone()[0]
        cursor.execute('SELECT max(id) FROM routing.osm_vertices')
        max_node = cursor.fetchone()[0]
        cursor.execute('SELECT max(routing_reference_timestamp) FROM routing.atlas_network')
        reference = cursor.fetchone()[0]
        cursor.execute(f'WITH gap AS ({GAP}) SELECT fid, len FROM gap ORDER BY fid')
        lengths = dict(cursor.fetchall())
        # Graph vertices on the interior of a missing way.
        cursor.execute(f'''WITH gap AS ({GAP})
          SELECT g.fid, v.id, ST_LineLocatePoint(g.geom, v.geom) FROM gap g
          JOIN routing.osm_vertices v ON ST_DWithin(v.geom, g.geom, %s)''', (INTERIOR,))
        on_line = cursor.fetchall()
        # Ends of missing ways: nearest graph vertex within END.
        cursor.execute(f'''WITH gap AS ({GAP}), ends AS (
            SELECT fid, 0 AS e, ST_StartPoint(geom) p FROM gap UNION ALL SELECT fid, 1, ST_EndPoint(geom) FROM gap)
          SELECT e.fid, e.e, (SELECT v.id FROM routing.osm_vertices v WHERE ST_DWithin(v.geom, e.p, %s)
            ORDER BY ST_Distance(v.geom, e.p), v.id LIMIT 1), ST_X(e.p), ST_Y(e.p) FROM ends e''', (END,))
        rows = cursor.fetchall()
        end_vertex = {(fid, e): vid for fid, e, vid, _, _ in rows}
        end_point = {(r[0], r[1]): (round(r[3], 3), round(r[4], 3)) for r in rows}
        # Ends of missing ways that lie on another missing way.
        cursor.execute(f'''WITH gap AS ({GAP}), ends AS (
            SELECT fid, 0 AS e, ST_StartPoint(geom) p FROM gap UNION ALL SELECT fid, 1, ST_EndPoint(geom) FROM gap)
          SELECT e.fid, e.e, g.fid, ST_LineLocatePoint(g.geom, e.p) FROM ends e
          JOIN gap g ON g.fid<>e.fid AND ST_DWithin(g.geom, e.p, %s)''', (END,))
        end_on_gap = cursor.fetchall()

    parent = {}
    def find(x):
        parent.setdefault(x, x)
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x
    def union(a, b):
        a, b = find(a), find(b)
        if a == b:
            return
        # A graph vertex (int) always represents its cluster.
        if isinstance(b, int) and not isinstance(a, int):
            a, b = b, a
        if isinstance(a, int) and isinstance(b, int) and a != b:
            raise ValueError(f'two graph vertices merged: {a}, {b}')
        parent[b] = a

    for (fid, e), vid in end_vertex.items():
        find(('end', fid, e))
        if vid is not None:
            union(int(vid), ('end', fid, e))
    cuts = collections.defaultdict(list)
    for fid in lengths:
        cuts[fid] += [(0.0, ('end', fid, 0)), (1.0, ('end', fid, 1))]
    for fid, vid, fraction in on_line:
        cuts[fid].append((fraction, int(vid)))
    for fid, e, other, fraction in end_on_gap:
        tolerance = END / lengths[other] if lengths[other] else 1
        if fraction <= tolerance:
            union(('end', other, 0), ('end', fid, e))
        elif fraction >= 1 - tolerance:
            union(('end', other, 1), ('end', fid, e))
        else:
            cuts[other].append((fraction, ('end', fid, e)))

    # Merge cut points closer than MERGE along each way, then give clusters ids.
    for fid, points in cuts.items():
        points.sort(key=lambda item: item[0])
        for (f0, a), (f1, b) in zip(points, points[1:]):
            if (f1 - f0) * lengths[fid] <= MERGE:
                try:
                    union(a, b)
                except ValueError:
                    pass  # two distinct graph vertices: keep both, the piece between them is kept
    ids, next_node, members = {}, max_node + 1, collections.defaultdict(list)
    for key in list(parent):
        if not isinstance(key, int):
            members[find(key)].append(key)
    def node(key):
        nonlocal next_node
        root = find(key)
        if isinstance(root, int):
            return root
        if root not in ids:
            ids[root], next_node = next_node, next_node + 1
        return ids[root]
    # A new node sits on the first (deterministic) way end of its cluster.
    def position(root):
        return end_point[min(members[root] or [root])[1:]]

    edges, next_edge, stats = [], max_edge + 1, collections.Counter()
    for fid in sorted(cuts):
        resolved = sorted({(round(f, 9), node(key)) for f, key in cuts[fid]})
        compact = []
        for fraction, nid in resolved:
            if compact and (fraction - compact[-1][0]) * lengths[fid] <= MERGE and compact[-1][1] == nid:
                continue
            compact.append((fraction, nid))
        for (f0, a), (f1, b) in zip(compact, compact[1:]):
            length = (f1 - f0) * lengths[fid]
            if length <= 0.01 or a == b:
                stats['dropped_tiny_or_loop'] += 1
                continue
            edges.append([next_edge, fid, round(f0, 9), round(f1, 9), a, b, round(length, 3)])
            next_edge += 1
    attached = {fid for fid in lengths if any(isinstance(find(key), int) for _, key in cuts[fid])}
    json.dump({'version': 1, 'routingReference': reference, 'baseMaxEdge': max_edge, 'baseMaxNode': max_node,
               'maxEdge': next_edge - 1, 'maxNode': next_node - 1,
               'columns': ['id', 'atlas_fid', 'f0', 'f1', 'source', 'target', 'length_m'], 'edges': edges,
               'nodeColumns': ['id', 'x', 'y'], 'srid': 25832,
               'nodes': sorted([nid, *position(root)] for root, nid in ids.items()),
               'stats': {'atlasWays': len(lengths), 'pieces': len(edges), 'newNodes': len(ids),
                         'waysTouchingGraph': len(attached), 'km': round(sum(lengths.values()) / 1000, 1), **stats}},
              sys.stdout, separators=(',', ':'))


if __name__ == '__main__':
    main()
