#!/usr/bin/env python3
"""Build deterministic public pilot data from a read-only atlas GeoPackage."""

from __future__ import annotations

import argparse
import collections
import hashlib
import json
import math
import pathlib
import sqlite3
import statistics

from pyproj import Transformer
from shapely import wkb


ROOT = pathlib.Path(__file__).resolve().parents[1]
ORIGIN = [9.18, 48.777]
PILOT_BOUNDS = [9.162, 48.765, 9.198, 48.790]
CITY_BOUNDS = [9.038567797048666, 48.69221214216576, 9.316378372618532, 48.86616944479957]


def valid_elevation(value) -> bool:
    """Return whether an atlas elevation can be used as a real Stuttgart height."""
    try:
        converted = float(value)
    except (TypeError, ValueError):
        return False
    return math.isfinite(converted) and converted >= 100


def signed_slope(magnitude: float, z0: float, z1: float, quality: int) -> float | None:
    """Attach direction to the curated magnitude without inventing missing height data."""
    magnitude = abs(magnitude)
    if magnitude == 0:
        return 0.0
    if quality >= 2 or math.isclose(z0, z1, abs_tol=0.01):
        return None
    return round(math.copysign(magnitude, z1 - z0), 3)


def sha256(path: pathlib.Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=pathlib.Path)
    parser.add_argument("--output-dir", type=pathlib.Path, default=ROOT / "build_data")
    parser.add_argument("--source-date", required=True, help="ISO date recorded in output metadata")
    parser.add_argument("--scope", choices=("pilot", "city"), default="pilot")
    args = parser.parse_args()
    source = args.source.resolve()
    if not source.is_file():
        parser.error(f"source does not exist: {source}")
    output = args.output_dir.resolve()
    output.mkdir(exist_ok=True, parents=True)

    db = sqlite3.connect(f"file:{source.as_posix()}?mode=ro&immutable=1", uri=True)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA query_only=ON")
    transform = Transformer.from_crs(25832, 4326, always_xy=True)
    bounds = CITY_BOUNDS if args.scope == "city" else PILOT_BOUNDS
    sx = 111320 * math.cos(math.radians(ORIGIN[1]))
    sy = 111320

    def local(x, y):
        lon, lat = transform.transform(x, y)
        return [round((lon - ORIGIN[0]) * sx, 2), round((lat - ORIGIN[1]) * sy, 2)]

    def geometry(blob):
        envelope = (blob[3] >> 1) & 7
        return wkb.loads(blob[8 + {0: 0, 1: 32, 2: 48, 3: 48, 4: 64}[envelope] :])

    def ring(coords):
        return [local(x, y) for x, y, *_ in coords]

    def inside(point, pad=0):
        return (
            (bounds[0] - ORIGIN[0]) * sx - pad <= point[0] <= (bounds[2] - ORIGIN[0]) * sx + pad
            and (bounds[1] - ORIGIN[1]) * sy - pad <= point[1] <= (bounds[3] - ORIGIN[1]) * sy + pad
        )

    def number(value, default=0):
        try:
            converted = float(value)
            return converted if math.isfinite(converted) else default
        except (TypeError, ValueError):
            return default

    nodes, edges = [], []
    node_index = {}
    node_heights = collections.defaultdict(list)
    rejected = collections.Counter()

    def node(point):
        key = tuple(point)
        if key not in node_index:
            node_index[key] = len(nodes)
            nodes.append(point)
        return node_index[key]

    for row in db.execute("SELECT * FROM Pedestrian_Network ORDER BY atlas_id"):
        shape = geometry(row["geom"])
        coords = ring(shape.coords)
        if not all(inside(point) for point in coords):
            continue
        try:
            tags = json.loads(row["osm_tags_current"] or "{}")
        except (TypeError, json.JSONDecodeError):
            tags = {}
        access = str(row["access_current"] or "").lower()
        foot = str(row["foot_current"] or "").lower()
        highway = row["highway_current"] or row["fclass"]
        restricted = foot in ("no", "private") or (
            access in ("no", "private") and foot not in ("yes", "designated", "permissive")
        )
        if restricted or highway in (
            "motorway", "motorway_link", "trunk", "trunk_link", "construction", "proposed"
        ) or str(row["indoor_current"]).lower() == "yes":
            rejected["restricted"] += 1
            continue
        length = sum(math.dist(a, b) for a, b in zip(coords, coords[1:]))
        if length < 0.05:
            continue
        slope = abs(number(row["slope_pct"]))
        z0, z1 = number(row["elev_start"], math.nan), number(row["elev_end"], math.nan)
        valid0, valid1 = valid_elevation(z0), valid_elevation(z1)
        if valid0:
            node_heights[tuple(coords[0])].append(z0)
        if valid1:
            node_heights[tuple(coords[-1])].append(z1)
        direction = str(tags.get("oneway:foot", "no")).lower() if isinstance(tags, dict) else "no"
        edges.append({
            "a": node(coords[0]), "b": node(coords[-1]), "c": coords, "l": round(length, 2),
            "s": round(slope, 3), "_z0": z0, "_z1": z1,
            "_valid0": valid0, "_valid1": valid1,
            "steps": highway == "steps" or row["fclass"] == "steps",
            "covered": str(row["covered_current"] or "").lower() == "yes"
            or str(row["tunnel"] or "").lower() in ("t", "yes", "true", "1"),
            "dir": 1 if direction == "yes" else -1 if direction == "-1" else 0,
            "name": row["display_name"] or row["name"] or "", "id": row["atlas_id"],
        })

    all_source_heights = [height for heights in node_heights.values() for height in heights]
    elevation_fallback = statistics.median(all_source_heights) if all_source_heights else 300.0
    elevation_quality = collections.Counter()
    for edge in edges:
        z0, z1 = edge.pop("_z0"), edge.pop("_z1")
        valid0, valid1 = edge.pop("_valid0"), edge.pop("_valid1")
        inferred = False
        if not valid0 and node_heights.get(tuple(edge["c"][0])):
            z0 = statistics.median(node_heights[tuple(edge["c"][0])])
            valid0, inferred = True, True
        if not valid1 and node_heights.get(tuple(edge["c"][-1])):
            z1 = statistics.median(node_heights[tuple(edge["c"][-1])])
            valid1, inferred = True, True
        if valid0 and valid1:
            quality = 1 if inferred else 0
        else:
            quality = 2
            if valid0:
                z1 = z0
            elif valid1:
                z0 = z1
            else:
                z0 = z1 = elevation_fallback
        edge["z0"], edge["z1"] = round(z0, 2), round(z1, 2)
        edge["dz"] = round(z1 - z0, 2)
        edge["sf"] = signed_slope(edge["s"], z0, z1, quality)
        edge["sq"] = quality
        elevation_quality[("source", "connected", "unknown")[quality]] += 1

    buildings, estimated = [], 0
    for row in db.execute("SELECT geom, hoehe_m FROM Buildings ORDER BY atlas_id"):
        shape = geometry(row["geom"])
        if not inside(local(shape.centroid.x, shape.centroid.y), 350):
            continue
        height = number(row["hoehe_m"], 9)
        if height <= 0:
            height, estimated = 9, estimated + 1
        for polygon in shape.geoms:
            if polygon.area < 2 or not inside(local(polygon.centroid.x, polygon.centroid.y), 350):
                continue
            polygon = polygon.simplify(0.25, preserve_topology=True)
            buildings.append({
                "r": [ring(polygon.exterior.coords)] + [ring(hole.coords) for hole in polygon.interiors],
                "h": round(height, 1),
            })

    trees, tree_default = [], 0
    for row in db.execute("SELECT * FROM Trees ORDER BY atlas_id"):
        shape = geometry(row["geom"])
        point = local(shape.x, shape.y)
        if not inside(point, 150):
            continue
        height = number(row["height_calculated"]) or number(row["height"]) or number(row["est_height"])
        if not height:
            height, tree_default = 8, tree_default + 1
        trees.append({
            "p": point, "h": round(height, 1),
            "r": round(max(1, number(row["crown_radius"], 2)), 1),
            "evergreen": str(row["leaf_cycle"] or "").lower() == "evergreen",
        })

    original_edges, edges = edges, []
    for edge in original_edges:
        total = sum(math.dist(a, b) for a, b in zip(edge["c"], edge["c"][1:]))
        travelled = 0
        for start, end in zip(edge["c"], edge["c"][1:]):
            length = math.dist(start, end)
            if length < 0.01:
                continue
            t0, t1 = travelled / total, (travelled + length) / total
            z0 = edge["z0"] + (edge["z1"] - edge["z0"]) * t0
            z1 = edge["z0"] + (edge["z1"] - edge["z0"]) * t1
            edges.append({
                **edge, "a": node(start), "b": node(end), "c": [start, end],
                "l": round(length, 3), "dz": round(z1 - z0, 3),
                "z0": round(z0, 2), "z1": round(z1, 2),
            })
            travelled += length

    adjacency = [[] for _ in nodes]
    for edge in edges:
        adjacency[edge["a"]].append(edge["b"])
        adjacency[edge["b"]].append(edge["a"])
    seen, component_sizes = set(), []
    for start in range(len(nodes)):
        if start in seen:
            continue
        queue, size = [start], 0
        seen.add(start)
        while queue:
            current, size = queue.pop(), size + 1
            for neighbour in adjacency[current]:
                if neighbour not in seen:
                    seen.add(neighbour)
                    queue.append(neighbour)
        component_sizes.append(size)

    meta = {
        "origin": ORIGIN, "scale": [sx, sy], "bounds": bounds, "scope": args.scope,
        "sourceDate": args.source_date,
        "nodes": len(nodes), "edges": len(edges), "buildings": len(buildings), "trees": len(trees),
        "components": sorted(component_sizes, reverse=True), "treeHeightFallbacks": tree_default,
        "buildingHeightFallbacks": estimated, "excluded": dict(rejected),
        "elevationQuality": dict(elevation_quality), "sourceSha256": sha256(source),
    }
    payloads = {
        "network": {"nodes": nodes, "edges": edges},
        "obstacles": {"buildings": buildings, "trees": trees}, "meta": meta,
    }
    for name, data in payloads.items():
        (output / f"{name}.json").write_text(
            json.dumps(data, separators=(",", ":"), ensure_ascii=False), encoding="utf-8"
        )
    db.close()
    print(json.dumps({key: value for key, value in meta.items() if key != "components"}, indent=2))
    print("Largest components:", meta["components"][:8])
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
