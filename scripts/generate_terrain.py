"""Build local Mapbox Terrain-RGB tiles from atlas network elevations.

The source GeoPackage is not shipped with the app and contains no raster layer.
This script reconstructs a smooth display surface from the DEM-derived z values
stored at pedestrian-network segment endpoints. The result is for visualisation,
not for surveying or terrain-aware shadow calculations.
"""

from __future__ import annotations

import json
import math
from collections import defaultdict
from pathlib import Path

import numpy as np
from PIL import Image
from scipy.ndimage import gaussian_filter
from scipy.spatial import cKDTree


ROOT = Path(__file__).resolve().parents[1]
NETWORK_PATH = ROOT / "build_data/network.json"
META_PATH = ROOT / "build_data/meta.json"
OUTPUT = ROOT / "dist/dem"
ZOOMS = (12, 13, 14)
TILE_SIZE = 256
VIEW_BOUNDS = (9.151, 48.755, 9.209, 48.800)


def lonlat_to_world_pixel(lon: np.ndarray, lat: np.ndarray, zoom: int):
    size = TILE_SIZE * 2**zoom
    x = (lon + 180.0) / 360.0 * size
    clipped = np.clip(lat, -85.05112878, 85.05112878)
    sin_lat = np.sin(np.radians(clipped))
    y = (0.5 - np.log((1 + sin_lat) / (1 - sin_lat)) / (4 * np.pi)) * size
    return x, y


def tile_range(bounds, zoom: int):
    west, south, east, north = bounds
    xs, ys = lonlat_to_world_pixel(np.array([west, east]), np.array([north, south]), zoom)
    maximum = 2**zoom - 1
    return (
        max(0, int(math.floor(xs.min() / TILE_SIZE)) - 1),
        min(maximum, int(math.floor(xs.max() / TILE_SIZE)) + 1),
        max(0, int(math.floor(ys.min() / TILE_SIZE)) - 1),
        min(maximum, int(math.floor(ys.max() / TILE_SIZE)) + 1),
    )


def elevation_points(meta, network):
    samples = defaultdict(list)
    for edge in network["edges"]:
        for point, elevation in ((edge["c"][0], edge.get("z0")), (edge["c"][-1], edge.get("z1"))):
            if elevation is None or not math.isfinite(elevation):
                continue
            samples[(round(point[0], 2), round(point[1], 2))].append(float(elevation))

    local_x, local_y, elevation = [], [], []
    for (x, y), values in samples.items():
        local_x.append(x)
        local_y.append(y)
        elevation.append(sum(values) / len(values))

    lon = meta["origin"][0] + np.asarray(local_x) / meta["scale"][0]
    lat = meta["origin"][1] + np.asarray(local_y) / meta["scale"][1]
    return lon, lat, np.asarray(elevation, dtype=np.float32)


def interpolate_surface(lon, lat, elevation, zoom: int, bounds):
    min_x, max_x, min_y, max_y = tile_range(bounds, zoom)
    source_x, source_y = lonlat_to_world_pixel(lon, lat, zoom)
    tree = cKDTree(np.column_stack((source_x, source_y)))

    width = (max_x - min_x + 1) * TILE_SIZE
    height = (max_y - min_y + 1) * TILE_SIZE
    surface = np.empty((height, width), dtype=np.float32)
    x_coords = min_x * TILE_SIZE + np.arange(width, dtype=np.float32) + 0.5

    batch_rows = 128
    for row in range(0, height, batch_rows):
        count = min(batch_rows, height - row)
        y_coords = min_y * TILE_SIZE + np.arange(row, row + count, dtype=np.float32) + 0.5
        grid_x, grid_y = np.meshgrid(x_coords, y_coords)
        query = np.column_stack((grid_x.ravel(), grid_y.ravel()))
        distances, indices = tree.query(query, k=8)
        distances = np.maximum(distances, 0.35)
        weights = 1.0 / distances**2
        values = (elevation[indices] * weights).sum(axis=1) / weights.sum(axis=1)
        surface[row : row + count] = values.reshape(count, width)

    # Remove tiny artefacts from irregularly spaced street samples while
    # preserving Stuttgart's broad valley and hillside structure.
    surface = gaussian_filter(surface, sigma=2.0, mode="nearest")
    return surface, (min_x, max_x, min_y, max_y)


def terrain_rgb(surface: np.ndarray):
    encoded = np.clip(np.rint((surface + 10000.0) * 10.0), 0, 16777215).astype(np.uint32)
    return np.stack(
        ((encoded >> 16) & 255, (encoded >> 8) & 255, encoded & 255), axis=-1
    ).astype(np.uint8)


def main():
    meta = json.loads(META_PATH.read_text())
    network = json.loads(NETWORK_PATH.read_text())
    lon, lat, elevation = elevation_points(meta, network)
    OUTPUT.mkdir(parents=True, exist_ok=True)

    summary = {
        "encoding": "mapbox",
        "tileSize": TILE_SIZE,
        "minzoom": min(ZOOMS),
        "maxzoom": max(ZOOMS),
        "bounds": list(VIEW_BOUNDS),
        "samples": int(elevation.size),
        "minElevation": round(float(elevation.min()), 1),
        "maxElevation": round(float(elevation.max()), 1),
        "method": "8-neighbour inverse-distance interpolation of network endpoint elevations",
        "tiles": {},
    }

    for zoom in ZOOMS:
        surface, (min_x, max_x, min_y, max_y) = interpolate_surface(
            lon, lat, elevation, zoom, VIEW_BOUNDS
        )
        rgb = terrain_rgb(surface)
        count = 0
        for tile_y in range(min_y, max_y + 1):
            for tile_x in range(min_x, max_x + 1):
                x0 = (tile_x - min_x) * TILE_SIZE
                y0 = (tile_y - min_y) * TILE_SIZE
                path = OUTPUT / str(zoom) / str(tile_x) / f"{tile_y}.png"
                path.parent.mkdir(parents=True, exist_ok=True)
                Image.fromarray(rgb[y0 : y0 + TILE_SIZE, x0 : x0 + TILE_SIZE], "RGB").save(
                    path, optimize=True
                )
                count += 1
        summary["tiles"][str(zoom)] = {
            "count": count,
            "range": [min_x, max_x, min_y, max_y],
        }
        print(f"z{zoom}: {count} tiles ({rgb.shape[1]} x {rgb.shape[0]} pixels)")

    (OUTPUT / "metadata.json").write_text(json.dumps(summary, indent=2) + "\n")
    print(f"{elevation.size} elevation samples, {elevation.min():.1f}–{elevation.max():.1f} m")


if __name__ == "__main__":
    main()
