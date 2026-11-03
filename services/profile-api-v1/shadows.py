"""Shadow model of the browser (scripts/core.mjs) for Stage 2.

Same sun formula, same obstacles (city shade tiles), same 4 m edge sampling, in the app's
local metre frame. A building's browser shadow (roof projection plus swept walls) is the
footprint swept along the shadow vector, so a point is shaded exactly when the segment from
it towards the sun, of length height * cot(altitude), meets the footprint. Tree crowns are
the browser's 16-point ellipses.
"""
import collections
import json
import math

import numpy as np
import shapely

RAD = math.pi / 180


def sun_position(epoch_ms, lat=48.777, lon=9.18):
    jd = epoch_ms / 86400000 + 2440587.5
    n = jd - 2451545
    L = math.fmod(280.46 + .9856474 * n, 360)
    g = (357.528 + .9856003 * n) * RAD
    lam = (L + 1.915 * math.sin(g) + .020 * math.sin(2 * g)) * RAD
    eps = (23.439 - .0000004 * n) * RAD
    ra = math.atan2(math.cos(eps) * math.sin(lam), math.cos(lam))
    dec = math.asin(math.sin(eps) * math.sin(lam))
    gmst = (280.46061837 + 360.98564736629 * n) * RAD
    H = gmst + lon * RAD - ra
    phi = lat * RAD
    altitude = math.asin(math.sin(phi) * math.sin(dec) + math.cos(phi) * math.cos(dec) * math.cos(H))
    azimuth = math.fmod(math.atan2(math.sin(H), math.cos(H) * math.sin(phi) - math.tan(dec) * math.cos(phi)) + math.pi + 2 * math.pi, 2 * math.pi)
    return altitude / RAD, azimuth / RAD


def tree_crowns(trees, altitude, azimuth, leaf_on=True, steps=16):
    """Browser crown ellipses as shapely polygons (makeShadows, tree branch)."""
    trees = [t for t in trees if leaf_on or t.get('evergreen')]
    if not trees or altitude <= 2:
        return np.array([], dtype=object)
    a, t = azimuth * RAD, 1 / math.tan(altitude * RAD)
    p = np.array([tree['p'] for tree in trees], dtype=float)
    r = np.array([tree['r'] for tree in trees], dtype=float)
    h = np.array([tree['h'] for tree in trees], dtype=float)
    cy = np.maximum(r, h - r)
    dx, dy = -math.sin(a) * cy * t, -math.cos(a) * cy * t
    major = r / math.sin(altitude * RAD)
    u = 2 * math.pi * np.arange(steps + 1) / steps
    along, cross = major[:, None] * np.cos(u), r[:, None] * np.sin(u)
    x = p[:, 0, None] + dx[:, None] + along * math.sin(a) + cross * math.cos(a)
    y = p[:, 1, None] + dy[:, None] + along * math.cos(a) - cross * math.sin(a)
    return shapely.polygons(np.stack([x, y], axis=-1))


class Footprints:
    """Building footprints of a set of shade tiles, with one spatial index."""
    def __init__(self, buildings=(), polygons=None, heights=None):
        if polygons is None:
            polygons, heights = [], []
            for b in buildings:
                rings = b['r']
                polygon = shapely.Polygon(rings[0], rings[1:])
                if not polygon.is_valid:
                    polygon = shapely.make_valid(polygon)
                polygons.append(polygon); heights.append(float(b['h']))
        self.polygons = np.array(polygons, dtype=object)
        self.heights = np.array(heights, dtype=float)
        shapely.prepare(self.polygons)
        self._bands = None

    def bands(self, limits=(8, 15, 25, 40, 70)):
        """(member indices, spatial index) per height band, built once."""
        if self._bands is None:
            edges = (0,) + limits + (math.inf,)
            self._bands = []
            for low, high in zip(edges, edges[1:]):
                members = np.flatnonzero((self.heights > low) & (self.heights <= high)) if low else np.flatnonzero(self.heights <= high)
                if len(members):
                    self._bands.append((members, shapely.STRtree(self.polygons[members])))
        return self._bands

    @classmethod
    def combine(cls, parts):
        parts = [p for p in parts if len(p.polygons)]
        if not parts:
            return cls()
        return cls(polygons=np.concatenate([p.polygons for p in parts]), heights=np.concatenate([p.heights for p in parts]))


class ShadeTiles:
    """Shade tiles from shade_tiles.zip, parsed on demand (scripts/export_shade_tiles.py)."""
    def __init__(self, path, cache=48):
        import zipfile
        self.archive = zipfile.ZipFile(path)
        self.meta = json.loads(self.archive.read('meta.json'))
        self.available = set(self.meta['tiles'])
        self.cache, self.size = collections.OrderedDict(), cache

    def tile(self, key):
        if key in self.cache:
            self.cache.move_to_end(key)
            return self.cache[key]
        data = json.loads(self.archive.read(key + '.json'))
        value = (Footprints(data.get('buildings', [])), data.get('trees', []))
        self.cache[key] = value
        while len(self.cache) > self.size:
            self.cache.popitem(last=False)
        return value

    def local(self, lon, lat):
        origin, scale = self.meta['origin'], self.meta['scale']
        return (np.asarray(lon) - origin[0]) * scale[0], (np.asarray(lat) - origin[1]) * scale[1]


def shaded_points(points, footprints, crowns, altitude, azimuth):
    """Boolean per sample point: inside a building shadow or a crown shadow."""
    hit = np.zeros(len(points), dtype=bool)
    if altitude <= 2 or not len(points):
        return hit
    a, t = azimuth * RAD, 1 / math.tan(altitude * RAD)
    towards = np.array([math.sin(a), math.cos(a)]) * t  # per metre of height, towards the sun
    # Height bands keep the search segment short: one tower must not lengthen every query.
    for members, tree in footprints.bands():
        open_points = np.flatnonzero(~hit)
        if not len(open_points):
            break
        reach = points[open_points] + towards * footprints.heights[members].max()
        candidates = tree.query(shapely.linestrings(np.stack([points[open_points], reach], axis=1)), predicate='intersects')
        if candidates.shape[1]:
            pi, bi = open_points[candidates[0]], members[candidates[1]]
            exact = shapely.linestrings(np.stack([points[pi], points[pi] + towards * footprints.heights[bi, None]], axis=1))
            hit[pi[shapely.intersects(exact, footprints.polygons[bi])]] = True
    if len(crowns):
        rest = np.flatnonzero(~hit)
        if len(rest):
            inside = shapely.STRtree(crowns).query(shapely.points(points[rest]), predicate='within')
            hit[rest[inside[0]]] = True
    return hit


def repeat_ranges(counts):
    """0..count-1 for every count, concatenated."""
    return np.arange(counts.sum()) - np.repeat(np.cumsum(counts) - counts, counts)


def sample_edges(coords, offsets, edges):
    """4 m samples (core.mjs edgeShades) for the given edges: points, weights, position of the owning edge."""
    edges = np.asarray(edges, dtype=int)
    starts, counts = offsets[edges], offsets[edges + 1] - offsets[edges] - 1
    counts = np.maximum(counts, 0)
    segment_owner = np.repeat(np.arange(len(edges)), counts)
    first = np.repeat(starts, counts) + repeat_ranges(counts)
    a, b = coords[first], coords[first + 1]
    length = np.hypot(*(b - a).T)
    n = np.maximum(1, np.ceil(length / 4)).astype(int)
    segment = np.repeat(np.arange(len(length)), n)
    f = (repeat_ranges(n) + .5) / n[segment]
    points = a[segment] + (b[segment] - a[segment]) * f[:, None]
    return points, (length / n)[segment], segment_owner[segment]


def edge_shades(coords, offsets, edges, covered, footprints, crowns, altitude, azimuth):
    """Shaded length fraction per edge, like core.mjs edgeShades (covered edges and night count as 1)."""
    edges = np.asarray(edges, dtype=int)
    if altitude <= 0:
        return np.ones(len(edges))
    points, weights, owners = sample_edges(coords, offsets, edges)
    hit = shaded_points(points, footprints, crowns, altitude, azimuth)
    total = np.bincount(owners, weights, minlength=len(edges))
    shaded = np.bincount(owners, weights * hit, minlength=len(edges))
    fraction = np.divide(shaded, total, out=np.zeros(len(edges)), where=total > 0)
    return np.where(np.asarray(covered)[edges], 1.0, fraction)


def corridor_tiles(a, b, grid, available, padding=2):
    """Tile keys along start->end with padding, as app.source.mjs routeTileKeys (local metres)."""
    distance = math.hypot(b[0] - a[0], b[1] - a[1])
    steps = max(1, math.ceil(distance / (grid * .65)))
    keys = []
    for i in range(steps + 1):
        f = i / steps
        x, y = math.floor((a[0] + (b[0] - a[0]) * f) / grid), math.floor((a[1] + (b[1] - a[1]) * f) / grid)
        for dx in range(-padding, padding + 1):
            for dy in range(-padding, padding + 1):
                key = f'{x + dx}_{y + dy}'
                if key in available and key not in keys:
                    keys.append(key)
    return keys
