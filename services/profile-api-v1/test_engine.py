"""Engine rules without a database: the same scenarios as the browser checks (core.mjs)."""
import unittest

import numpy as np

from engine import Engine, nearest_poi
from sonnenpfad_profile_rules import resolved_options, relaxation_tiers


def row(edge_id, a, b, length, slope=0.0, rising=1, **extra):
    # id, source, target, cost, reverse, length, steps, escalator, surface, wheelchair, way,
    # sf, dz_sign, forward_on_atlas, handrail, tactile, width, covered, midpoint x, y
    values = dict(steps=False, escalator=False, surface=1, wheelchair=1, way=1, handrail=None, tactile=None, width=None, covered=False, x=0.0, y=0.0) | extra
    cost = extra.get('cost', length)
    return (edge_id, a, b, cost, extra.get('reverse', length), length, values['steps'], values['escalator'], values['surface'],
            values['wheelchair'], values['way'], abs(slope) if slope is not None else None, (1 if rising > 0 else -1) if slope else 0, True,
            values['handrail'], values['tactile'], values['width'], values['covered'], values['x'], values['y'])


def snap(edge_id, fraction, distance=1.0):
    return dict(id=edge_id, fraction=fraction, distance=distance, point={'coordinates': [0, 0]})


def edge_ids(engine, result):
    return sorted(int(engine.edge_id[i]) for i, _, _ in result['parts'])


class SlopeModes(unittest.TestCase):
    """scripts/check_slope_modes.mjs: 0-1 flat, 1-2-4 rising 12 %, 1-3-4 falling 12 %, 4-5 flat."""
    def setUp(self):
        self.engine = Engine([row(0, 0, 1, 5), row(1, 1, 2, 5, 12, 1), row(2, 2, 4, 10, 12, 1),
                              row(3, 1, 3, 12, 12, -1), row(4, 3, 4, 12, 12, -1), row(5, 4, 5, 5)])
        self.west, self.east = [snap(0, .2)], [snap(5, .8)]

    def route(self, starts, ends, mode):
        return edge_ids(self.engine, self.engine.route(starts, ends, {'slopeMode': mode}, 30))

    def test_directional_slope_matches_browser(self):
        self.assertEqual(self.route(self.west, self.east, 'none'), [0, 1, 2, 5])
        self.assertEqual(self.route(self.west, self.east, 'uphill'), [0, 3, 4, 5])
        self.assertEqual(self.route(self.west, self.east, 'downhill'), [0, 1, 2, 5])
        self.assertEqual(self.route(self.east, self.west, 'uphill'), [0, 1, 2, 5])
        self.assertEqual(self.route(self.east, self.west, 'downhill'), [0, 3, 4, 5])

    def test_unknown_gradient_is_avoided_not_flat(self):
        engine = Engine([row(0, 0, 1, 5), row(1, 1, 2, 5, None), row(2, 2, 4, 10, None),
                         row(3, 1, 3, 12, 0), row(4, 3, 4, 12, 0), row(5, 4, 5, 5)])
        self.assertEqual(edge_ids(engine, engine.route([snap(0, .2)], [snap(5, .8)], {'slopeMode': 'uphill'}, 30)), [0, 3, 4, 5])


class Mobility(unittest.TestCase):
    """scripts/check_mobility_profiles.mjs: a short stair shortcut 1-2 and a detour 1-3-4-5."""
    def setUp(self):
        self.rows = [row(0, 0, 1, 10), row(1, 1, 2, 10, steps=True), row(2, 2, 5, 10),
                     row(3, 1, 3, 10), row(4, 3, 4, 10), row(5, 4, 5, 10)]
        self.engine = Engine(self.rows)

    def options(self, profile):
        return resolved_options({'mobilityProfile': profile, 'preference': 'balanced'})

    def test_wheelchair_avoids_stairs_standard_uses_them(self):
        starts, ends = [snap(0, .1)], [snap(2, .9)]
        self.assertIn(1, edge_ids(self.engine, self.engine.route(starts, ends, self.options('standard'), 30)))
        self.assertNotIn(1, edge_ids(self.engine, self.engine.route(starts, ends, self.options('wheelchair'), 30)))

    def test_only_stairs_block_until_relaxed(self):
        engine = Engine(self.rows[:3])
        tiers = relaxation_tiers(self.options('wheelchair'))
        # Separate components without stairs: 'outside', which calculate() reports as profile-blocked (core.mjs).
        self.assertEqual(engine.route([snap(0, .1)], [snap(2, .9)], tiers[0]['options'], 30)['error'], 'outside')
        self.assertIn(1, edge_ids(engine, engine.route([snap(0, .1)], [snap(2, .9)], tiers[-1]['options'], 30)))

    def test_relaxed_route_reports_what_it_breaks(self):
        engine = Engine(self.rows[:3])
        tiers = relaxation_tiers(self.options('wheelchair'))
        parts = engine.route([snap(0, .1)], [snap(2, .9)], tiers[-1]['options'], 30)['parts']
        flagged = {int(engine.edge_id[i]): engine.violations(i, 1 if t1 >= t0 else -1, tiers[0]['options']) for i, t0, t1 in parts}
        self.assertEqual(flagged, {0: [], 1: ['steps'], 2: []})
        steep = Engine([row(0, 0, 1, 10, 9, 1)])
        self.assertEqual(steep.violations(0, 1, self.options('wheelchair')), ['maxSlope'])
        self.assertEqual(steep.violations(0, 1, self.options('powerWheelchair')), [])

    def test_bench_at_zero_metres_is_best(self):
        engine = Engine([row(0, 0, 1, 10)])
        options = self.options('walkingAid')
        engine.bench[:] = 0; at_zero = engine.multiplier(options, 1)[0]
        engine.bench[:] = 1000; far = engine.multiplier(options, 1)[0]
        self.assertLess(at_zero, far)

    def test_one_way_and_same_edge(self):
        engine = Engine([row(0, 0, 1, 100, reverse=-1)])
        self.assertEqual(engine.route([snap(0, .2)], [snap(0, .8)], {}, 30)['parts'], [(0, .2, .8)])
        self.assertEqual(engine.route([snap(0, .8)], [snap(0, .2)], {}, 30)['error'], 'disconnected')
        self.assertEqual(engine.route([snap(0, .5)], [snap(0, .50001)], {}, 30)['error'], 'same')

    def test_snap_beyond_radius_is_outside(self):
        self.assertEqual(self.engine.route([snap(0, .1, 40)], [snap(2, .9)], {}, 30)['error'], 'outside')


class Pois(unittest.TestCase):
    def test_nearest_within_radius_only(self):
        edges = np.array([[0.0, 0.0], [5000.0, 0.0]])
        distance, value = nearest_poi(edges, np.array([[30.0, 40.0]]), np.array([2]), 100)
        self.assertEqual(distance[0], 50.0); self.assertEqual(value[0], 2)
        self.assertTrue(np.isinf(distance[1])); self.assertEqual(value[1], 0)


if __name__ == '__main__':
    unittest.main(verbosity=2)
