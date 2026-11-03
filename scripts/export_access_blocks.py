"""Read-only export of browser edges that the audited server graph blocks in both directions.

Run on the VM in the Stage-2 directory as sonnenpfad_api (read-only session):
  python3 -B export_access_blocks.py < points.txt > blocks.json
points.txt comes from `node scripts/access_blocks.mjs points`. A browser edge is
blocked when every walk_edge within 0.3 m of its midpoint is blocked both ways;
mixed matches stay open and are counted as ambiguous.
"""
import collections
import contextlib
import json
import sys

from profile_api import connect

QUERY = """WITH p AS (
  SELECT i, ST_Transform(ST_SetSRID(ST_MakePoint(x, y), 4326), 25832) g
  FROM unnest(%s::int[], %s::float8[], %s::float8[]) AS t(i, x, y))
SELECT p.i,
  bool_or(e.cost < 0 AND e.reverse_cost < 0),
  bool_or(NOT (e.cost < 0 AND e.reverse_cost < 0)),
  min(coalesce(e.forward_reason, e.node_reason, e.backward_reason)) FILTER (WHERE e.cost < 0 AND e.reverse_cost < 0)
FROM p JOIN routing.walk_edges e ON ST_DWithin(e.geom, p.g, 0.3)
GROUP BY p.i"""


def main():
    points = [line.split() for line in sys.stdin if line.strip()]
    blocked, reasons, ambiguous = [], collections.Counter(), 0
    with contextlib.closing(connect()) as connection, connection.cursor() as cursor:
        cursor.execute('SHOW transaction_read_only')
        assert cursor.fetchone()[0] == 'on', 'session must be read-only'
        cursor.execute("SELECT max(routing_reference_timestamp) FROM routing.atlas_network")
        timestamp = cursor.fetchone()[0]
        for start in range(0, len(points), 20000):
            chunk = points[start:start + 20000]
            cursor.execute(QUERY, ([int(p[0]) for p in chunk], [float(p[1]) for p in chunk], [float(p[2]) for p in chunk]))
            for index, any_blocked, any_open, reason in cursor.fetchall():
                if any_blocked and any_open:
                    ambiguous += 1
                elif any_blocked:
                    blocked.append(index)
                    reasons[reason] += 1
    json.dump({'edgeCount': len(points), 'blocked': sorted(blocked), 'ambiguous': ambiguous,
               'source': {'table': 'routing.walk_edges', 'rule': 'cost<0 and reverse_cost<0 within 0.3 m',
                          'routingReference': timestamp, 'reasons': dict(reasons.most_common())}},
              sys.stdout)


if __name__ == '__main__':
    main()
