"""The Python shadow port must reproduce the browser core on a real city tile (shade_fixture.json)."""
import json
import pathlib
import unittest

import numpy as np

from shadows import Footprints, corridor_tiles, edge_shades, sun_position, tree_crowns

FIXTURE = json.loads(pathlib.Path(__file__).with_name('shade_fixture.json').read_text(encoding='utf-8'))


class BrowserParity(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        lines = FIXTURE['lines']
        cls.coords = np.array([p for line in lines for p in line['c']], dtype=float)
        cls.offsets = np.cumsum([0] + [len(line['c']) for line in lines])
        cls.covered = np.array([line['covered'] for line in lines])
        cls.footprints = Footprints(FIXTURE['obstacles']['buildings'])

    def test_sun_position_is_identical(self):
        for case in FIXTURE['cases']:
            altitude, azimuth = sun_position(case['epochMs'], 48.777, 9.18)
            self.assertAlmostEqual(altitude, case['sun']['altitude'], places=9)
            self.assertAlmostEqual(azimuth, case['sun']['azimuth'], places=9)

    def test_edge_shades_match_browser(self):
        for case in FIXTURE['cases']:
            altitude, azimuth = case['sun']['altitude'], case['sun']['azimuth']
            crowns = tree_crowns(FIXTURE['obstacles']['trees'], altitude, azimuth, case['leafOn'])
            actual = edge_shades(self.coords, self.offsets, range(len(FIXTURE['lines'])), self.covered, self.footprints, crowns, altitude, azimuth)
            expected = np.array(case['shades'])
            difference = np.abs(actual - expected)
            # Only boundary samples (measure zero) may differ: tiny on average, no edge visibly off.
            self.assertLess(difference.mean(), 1e-3, case['iso'])
            self.assertLess(difference.max(), .05, case['iso'])

    def test_corridor_matches_route_tile_rule(self):
        available = {f'{x}_{y}' for x in range(-3, 4) for y in range(-3, 4)}
        keys = corridor_tiles([100, 100], [1900, 100], 1000, available)
        self.assertEqual(sorted(keys), sorted(f'{x}_{y}' for x in range(-2, 4) for y in range(-2, 3)))


if __name__ == '__main__':
    unittest.main(verbosity=2)
