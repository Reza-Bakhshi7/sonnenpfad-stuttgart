#!/usr/bin/env python3
"""Preparatory profile-rule port, NOT an installed routing API.

Reference: Sonnenpfad main dbee3295afc0cc429d8f9b1d23fa95bd6c342227.
Costs consume normalized edges, not raw database strings. Existing negative
direction costs must remain excluded by the API adapter. No production writes.
"""
import argparse
import json
import math
import sys
import unittest

REFERENCE_COMMIT = 'dbee3295afc0cc429d8f9b1d23fa95bd6c342227'
PROFILES = {
    'standard': dict(slopeMode='none', speedMpm=75, ascentMinutesPer10m=1),
    'wheelchair': dict(avoidSteps=True, avoidEscalators=True, avoidPoorSurface=True, avoidWheelchairNo=True, maxSlope=6, slopeMode='both', slopeFactor=.9, surfaceFactor=1.3, wayFactor=1.1, wheelchairFactor=1.4, unknownFactor=.65, speedMpm=60, ascentMinutesPer10m=1.4),
    'powerWheelchair': dict(avoidSteps=True, avoidEscalators=True, avoidPoorSurface=True, avoidWheelchairNo=True, maxSlope=10, slopeMode='both', slopeFactor=.55, surfaceFactor=1, wayFactor=1, wheelchairFactor=1.1, unknownFactor=.5, speedMpm=75, ascentMinutesPer10m=.5),
    'walkingAid': dict(avoidSteps=True, avoidEscalators=True, avoidPoorSurface=True, maxSlope=10, slopeMode='both', slopeFactor=.65, surfaceFactor=.9, wayFactor=.7, benchFactor=1.2, shelterFactor=.35, unknownFactor=.45, speedMpm=50, ascentMinutesPer10m=1.6),
    'vision': dict(slopeMode='none', wayFactor=.9, crossingFactor=1.5, stairGuidanceFactor=1.2, unknownFactor=.25, speedMpm=65, ascentMinutesPer10m=1.1),
    'stroller': dict(avoidSteps=True, avoidEscalators=True, avoidPoorSurface=True, maxSlope=12, slopeMode='both', slopeFactor=.7, downhillFactor=.25, surfaceFactor=1, wayFactor=1.2, benchFactor=.35, unknownFactor=.4, speedMpm=65, ascentMinutesPer10m=1.2),
}


def finite(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def resolved_options(options=None):
    options = dict(options or {})
    profile = options.get('mobilityProfile') or 'standard'
    if profile not in (*PROFILES, 'custom'):
        raise ValueError('Unsupported mobility profile')
    if options.get('preference', 'balanced') not in ('balanced', 'shade', 'sun'):
        raise ValueError('Unsupported preference')
    return {**({} if profile == 'custom' else PROFILES[profile]), **options}


def signed_slope(edge, forward=True):
    raw = edge.get('sf')
    if not finite(raw):
        dz = edge.get('dz')
        raw = math.copysign(abs(edge.get('s', 0)), dz) if finite(dz) and abs(dz) > .01 else None
    return None if raw is None else raw if forward else -raw


def edge_allowed(edge, options, forward=True):
    if options.get('avoidSteps') and edge.get('steps'):
        return False
    if options.get('avoidEscalators') and edge.get('escalator'):
        return False
    if options.get('avoidPoorSurface') and edge.get('surface') == 3:
        return False
    if options.get('avoidWheelchairNo') and edge.get('wheelchair') == 3:
        return False
    slope = signed_slope(edge, forward)
    return not (options.get('maxSlope') and slope is not None and abs(slope) > options['maxSlope'])


def cost_multiplier(edge, options, shade=0, forward=True):
    preference = options.get('preference', 'balanced')
    exposure = 1 - shade if preference == 'shade' else shade if preference == 'sun' else 0
    solar = options.get('solarWeight')
    solar = max(0, min(1, solar if finite(solar) else 1))
    directed = signed_slope(edge, forward)
    mode = options.get('slopeMode') or ('both' if options.get('gentle') else 'none')
    cost = 1 + exposure * 1.6 * solar
    if mode != 'none':
        slope = 24 if directed is None else max(0, directed) if mode == 'uphill' else max(0, -directed) if mode == 'downhill' else abs(directed)
        factor = options.get('slopeFactor')
        cost += min(5, slope / 6) * (1 if factor is None else factor)
    if options.get('downhillFactor') and directed is not None:
        cost += min(3, max(0, -directed) / 8) * options['downhillFactor']
    if options.get('surfaceFactor'):
        cost += (2.5 if edge.get('surface') == 3 else .7 if edge.get('surface') == 2 else 0) * options['surfaceFactor']
    if options.get('wayFactor'):
        cost += (1.7 if edge.get('way') == 3 else .35 if edge.get('way') == 2 else 0) * options['wayFactor']
    if options.get('wheelchairFactor'):
        cost += (4 if edge.get('wheelchair') == 3 else 1.3 if edge.get('wheelchair') == 2 else 0) * options['wheelchairFactor']
    if options.get('crossingFactor') and edge.get('crossing'):
        cost += (2.4 if edge['crossing'] == 1 else .55 if edge['crossing'] == 2 else 0) * options['crossingFactor']
    if options.get('stairGuidanceFactor') and edge.get('steps'):
        # Preserve the current core formula exactly (not multiplied by factor).
        cost += (0 if edge.get('handrail') else 1.2) + (0 if edge.get('tactile') else 1.2)
    if options.get('benchFactor'):
        cost += min(2, max(0, (min(edge.get('bench') or 1000, 1000) - 100) / 450)) * options['benchFactor']
    if options.get('shelterFactor'):
        cost += min(1.2, max(0, (min(edge.get('shelter') or 1000, 1000) - 200) / 650)) * options['shelterFactor']
    if options.get('unknownFactor'):
        unknown = int(edge.get('surface') == 0) + int(not finite(edge.get('sf')))
        unknown += int(bool(options.get('avoidWheelchairNo')) and edge.get('wheelchair') == 0)
        cost += unknown * options['unknownFactor']
    return cost


def directed_costs(edge, options=None, shade=None):
    if not finite(edge.get('l')) or edge['l'] <= 0:
        raise ValueError('Invalid edge length')
    options = resolved_options(options)
    if options.get('preference') in ('shade', 'sun') and (not finite(shade) or not 0 <= shade <= 1):
        raise ValueError('Shadow fraction is required; unknown is not zero')
    def cost(forward):
        if (forward and edge.get('dir') == -1) or (not forward and edge.get('dir') == 1):
            return -1
        if not edge_allowed(edge, options, forward):
            return -1
        return edge['l'] * cost_multiplier(edge, options, shade or 0, forward)
    return dict(cost=cost(True), reverse_cost=cost(False))


def relaxation_tiers(options=None):
    current = resolved_options(options)
    tiers = [dict(options=dict(current), relaxed_criteria=[])]
    relaxed = []
    for key, label, value in [('maxSlope', 'maxSlope', 0), ('avoidPoorSurface', 'poorSurface', False), ('avoidWheelchairNo', 'wheelchairNo', False), ('avoidEscalators', 'escalators', False), ('avoidSteps', 'steps', False)]:
        if current.get(key):
            current[key] = value
            relaxed.append(label)
            tiers.append(dict(options=dict(current), relaxed_criteria=list(relaxed)))
    return tiers


def audit_database():
    """Aggregate-only preflight. Does not load credentials or mutate any data."""
    import contextlib
    import psycopg2
    with contextlib.closing(psycopg2.connect(
        'dbname=sonnenpfad user=sonnenpfad_api host=/var/run/postgresql',
        connect_timeout=3, options='-c statement_timeout=20000',
        application_name='sonnenpfad-profile-preflight',
    )) as conn:
        conn.set_session(readonly=True)
        with conn.cursor() as cur:
            cur.execute('''SELECT fclass_display, fclass, surface_class, count(*)
              FROM routing.atlas_network
              GROUP BY fclass_display, fclass, surface_class
              ORDER BY count(*) DESC LIMIT 25''')
            classes = cur.fetchall()
            cur.execute('''SELECT table_schema,table_name,column_name
              FROM information_schema.columns
              WHERE table_schema NOT IN ('pg_catalog','information_schema')
                AND (column_name ILIKE '%%bench%%' OR column_name ILIKE '%%shelter%%'
                     OR column_name ILIKE '%%crossing%%')
              ORDER BY 1,2,3''')
            additional = cur.fetchall()
            cur.execute('''SELECT count(*),
              count(*) FILTER (WHERE a.fid IS NULL),
              count(*) FILTER (WHERE a.elev_start IS NULL OR a.elev_end IS NULL),
              count(*) FILTER (WHERE e.cost>=0 AND e.reverse_cost<0),
              count(*) FILTER (WHERE e.reverse_cost>=0 AND e.cost<0)
              FROM routing.walk_edges e
              LEFT JOIN routing.atlas_network a ON a.fid=e.atlas_fid
              WHERE e.cost>=0 OR e.reverse_cost>=0''')
            counts = cur.fetchone()
            conn.rollback()
    print(json.dumps(dict(reference_commit=REFERENCE_COMMIT, mode='read-only; no API activation',
        edge_counts=dict(zip(['routable','without_atlas','missing_elevation','forward_only','reverse_only'],counts)),
        atlas_classes=classes, additional_poi_columns=additional,
        warning='No route-level parity or server capability is certified by this preflight.'), ensure_ascii=False, indent=2))


class RulesTests(unittest.TestCase):
    def edge(self, **changes):
        return dict(l=100, dir=0, sf=0, s=0, dz=0, surface=1, way=1,
                    wheelchair=1, steps=False, escalator=False, **changes)

    def test_stairs_and_relaxation(self):
        edge = self.edge(); edge['steps'] = True
        options = dict(mobilityProfile='wheelchair')
        self.assertEqual(directed_costs(edge, options)['cost'], -1)
        tiers = relaxation_tiers(options)
        self.assertEqual(tiers[-1]['relaxed_criteria'], ['maxSlope','poorSurface','wheelchairNo','escalators','steps'])
        self.assertGreater(directed_costs(edge, tiers[-1]['options'])['cost'], 0)

    def test_unknown_remains_routable(self):
        edge = self.edge(); edge.update(sf=None, surface=0, wheelchair=0)
        self.assertGreater(directed_costs(edge, dict(mobilityProfile='wheelchair'))['cost'], 100)

    def test_directions_remain_blocked(self):
        edge = self.edge(); edge['dir'] = 1
        for tier in relaxation_tiers(dict(mobilityProfile='wheelchair')):
            self.assertEqual(directed_costs(edge, tier['options'])['reverse_cost'], -1)

    def test_gradient(self):
        edge = self.edge(); edge['sf'] = 7
        self.assertEqual(directed_costs(edge, dict(mobilityProfile='wheelchair'))['cost'], -1)
        self.assertGreater(directed_costs(edge, dict(mobilityProfile='powerWheelchair'))['cost'], 0)

    def test_sun_requires_real_fraction(self):
        for shade in (None, float('nan'), -1, 2):
            with self.assertRaises(ValueError):
                directed_costs(self.edge(), dict(preference='shade'), shade)

    def test_partial_cost_scales(self):
        full = directed_costs(self.edge(), dict(mobilityProfile='wheelchair'))
        edge = self.edge(); edge['l'] = 25
        self.assertAlmostEqual(directed_costs(edge, dict(mobilityProfile='wheelchair'))['cost'], full['cost'] / 4)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--self-test', action='store_true')
    parser.add_argument('--audit-db', action='store_true')
    parser.add_argument('--json', action='store_true', help=argparse.SUPPRESS)
    args = parser.parse_args()
    if args.json:
        cases = json.load(sys.stdin)
        print(json.dumps([dict(costs=directed_costs(c['edge'], c['options'], c.get('shade')),
            tiers=relaxation_tiers(c['options'])) for c in cases]))
        return 0
    if args.self_test:
        result = unittest.TextTestRunner(verbosity=2).run(unittest.defaultTestLoader.loadTestsFromTestCase(RulesTests))
        if not result.wasSuccessful():
            return 1
    if args.audit_db:
        try:
            audit_database()
        except ImportError:
            print('psycopg2 fehlt in diesem Python. Keine Installation vornehmen; Ausgabe melden.', file=sys.stderr)
            return 2
        except Exception:
            print('Datenbank-Vorpruefung fehlgeschlagen. Keine Zugangsdaten ausgeben; Dienstzugang separat pruefen.', file=sys.stderr)
            return 3
    if not (args.self_test or args.audit_db or args.json):
        parser.print_help()
    return 0


if __name__ == '__main__':
    raise SystemExit(main())

