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

from pyproj import Transformer
from shapely import wkb


ROOT = pathlib.Path(__file__).resolve().parents[1]
ORIGIN = [9.18, 48.777]
BOUNDS = [9.162, 48.765, 9.198, 48.790]


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
            (BOUNDS[0] - ORIGIN[0]) * sx - pad <= point[0] <= (BOUNDS[2] - ORIGIN[0]) * sx + pad
            and (BOUNDS[1] - ORIGIN[1]) * sy - pad <= point[1] <= (BOUNDS[3] - ORIGIN[1]) * sy + pad
        )

    def number(value, default=0):
        try:
            converted = float(value)
            return converted if math.isfinite(converted) else default
        except (TypeError, ValueError):
            return default

    nodes, edges = [], []
    node_index = {}
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
        slope = number(row["slope_pct"])
        z0, z1 = number(row["elev_start"], math.nan), number(row["elev_end"], math.nan)
        valid0, valid1 = math.isfinite(z0) and z0 >= 100, math.isfinite(z1) and z1 >= 100
        if not valid0 and valid1:
            z0 = z1 - slope * length / 100
        elif valid0 and not valid1:
            z1 = z0 + slope * length / 100
        elif not valid0 and not valid1:
            z0, z1 = 250, 250 + slope * length / 100
        direction = str(tags.get("oneway:foot", "no")).lower() if isinstance(tags, dict) else "no"
        edges.append({
            "a": node(coords[0]), "b": node(coords[-1]), "c": coords, "l": round(length, 2),
            "s": slope, "dz": round(z1 - z0, 2), "z0": round(z0, 2), "z1": round(z1, 2),
            "steps": highway == "steps" or row["fclass"] == "steps",
            "covered": str(row["covered_current"] or "").lower() == "yes"
            or str(row["tunnel"] or "").lower() in ("t", "yes", "true", "1"),
            "dir": 1 if direction == "yes" else -1 if direction == "-1" else 0,
            "name": row["display_name"] or row["name"] or "", "id": row["atlas_id"],
        })

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
        "origin": ORIGIN, "scale": [sx, sy], "bounds": BOUNDS, "sourceDate": args.source_date,
        "nodes": len(nodes), "edges": len(edges), "buildings": len(buildings), "trees": len(trees),
        "components": sorted(component_sizes, reverse=True), "treeHeightFallbacks": tree_default,
        "buildingHeightFallbacks": estimated, "excluded": dict(rejected), "sourceSha256": sha256(source),
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
