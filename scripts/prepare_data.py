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
LAYER_ALIASES = {
    "Pedestrian_Network": ("Pedestrian_Network", "Strassen"),
    "Buildings": ("Buildings", "Gebaeude"),
    "Trees": ("Trees", "Baeume"),
    "Signalized_Crossings": ("Signalized_Crossings", "Ampeluebergaenge"),
    "Benches": ("Benches", "Sitzbaenke"),
    "Shelters": ("Shelters", "Unterstande"),
    "Elevators": ("Elevators", "Aufzuege"),
    "Ramps": ("Ramps", "Rampen"),
    "Escalators": ("Escalators", "Rolltreppen"),
    "Stairs": ("Stairs", "Treppen"),
    "Barriers_and_Gates": ("Barriers_and_Gates", "Barrieren_Tore"),
    "Lowered_Curbs": ("Lowered_Curbs", "Bordstein_abgesenkt"),
    "Raised_Curbs": ("Raised_Curbs", "Bordstein_erhoeht"),
}


def quoted(identifier: str) -> str:
    return '"' + identifier.replace('"', '""') + '"'


def layer_table(connection: sqlite3.Connection, logical_name: str) -> str:
    existing = {row[0] for row in connection.execute("SELECT table_name FROM gpkg_contents")}
    for candidate in LAYER_ALIASES.get(logical_name, (logical_name,)):
        if candidate in existing:
            return candidate
    raise RuntimeError(f"Required layer missing: {logical_name}")


def parse_tags(value) -> dict[str, str]:
    if not value:
        return {}
    try:
        parsed = json.loads(value)
        if isinstance(parsed, dict):
            return {str(key): str(item) for key, item in parsed.items()}
    except (TypeError, json.JSONDecodeError):
        pass
    tags = {}
    for item in str(value).split(";"):
        if "=" in item:
            key, content = item.split("=", 1)
            tags[key.strip()] = content.strip()
    return tags


def truth(value) -> bool:
    return str(value or "").strip().lower() in {"yes", "true", "1", "both", "left", "right"}


def surface_quality(value) -> int:
    return {"good": 1, "medium": 2, "poor": 3}.get(str(value or "").lower(), 0)


def wheelchair_quality(value) -> int:
    return {"yes": 1, "limited": 2, "no": 3}.get(str(value or "").lower(), 0)


def way_class(value) -> int:
    value = str(value or "").lower()
    if value in {"footway", "pedestrian", "living_street"}:
        return 1
    if value in {"path", "cycleway", "track", "service", "residential", "unclassified"} or value.startswith("track_"):
        return 2
    if value in {"primary", "secondary", "tertiary", "trunk", "primary_link", "secondary_link", "tertiary_link", "trunk_link"}:
        return 3
    return 0


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
    network_table = layer_table(db, "Pedestrian_Network")
    buildings_table = layer_table(db, "Buildings")
    trees_table = layer_table(db, "Trees")
    crossings_table = layer_table(db, "Signalized_Crossings")
    benches_table = layer_table(db, "Benches")
    shelters_table = layer_table(db, "Shelters")
    poi_tables = {
        1: crossings_table,
        2: layer_table(db, "Elevators"),
        3: layer_table(db, "Ramps"),
        4: layer_table(db, "Escalators"),
        5: layer_table(db, "Stairs"),
        6: layer_table(db, "Barriers_and_Gates"),
        7: layer_table(db, "Lowered_Curbs"),
        8: layer_table(db, "Raised_Curbs"),
        9: benches_table,
        10: shelters_table,
    }
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

    def optional_number(value, digits=1):
        try:
            converted = float(value)
            return round(converted, digits) if math.isfinite(converted) else None
        except (TypeError, ValueError):
            return None

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

    for row in db.execute(f"SELECT * FROM {quoted(network_table)} ORDER BY atlas_id"):
        shape = geometry(row["geom"])
        coords = ring(shape.coords)
        if not all(inside(point) for point in coords):
            continue
        tags = parse_tags(row["osm_tags_current"])
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
        direction = str(tags.get("oneway:foot", "no")).lower()
        escalator = str(tags.get("conveying", "")).lower() in {"yes", "forward", "backward", "reversible"}
        width = max(0, number(row["width"]))
        edges.append({
            "a": node(coords[0]), "b": node(coords[-1]), "c": coords, "l": round(length, 2),
            "s": round(slope, 3), "_z0": z0, "_z1": z1,
            "_valid0": valid0, "_valid1": valid1,
            "steps": (highway == "steps" or row["fclass"] == "steps") and not escalator,
            "escalator": escalator,
            "covered": str(row["covered_current"] or "").lower() == "yes"
            or str(row["tunnel"] or "").lower() in ("t", "yes", "true", "1"),
            "surface": surface_quality(row["surface_class"]),
            "way": way_class(highway),
            "width": round(width, 2),
            "wheelchair": wheelchair_quality(row["wheelchair"]),
            "tactile": truth(row["tactile_paving"]),
            "handrail": truth(row["handrail"]),
            "ramp": truth(row["ramp"]) or truth(row["ramp_wheelchair"]),
            "dir": 1 if direction == "yes" else -1 if direction == "-1" else 0,
            "name": row["display_name"] or row["name"] or "", "id": row["atlas_id"],
            # Compact, parallel visual-theme contract. Null stays distinct from a measured zero.
            "theme": [
                optional_number(row["slope_pct"]), surface_quality(row["surface_class"]),
                optional_number(row["shadow_pct"]), optional_number(row["shadow_pct_winter"]),
                optional_number(row["utci_avg"]), optional_number(row["utci_avg_winter"]),
                optional_number(row["noise_db"]), optional_number(row["wind_exposure_index"], 2),
            ],
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
    for row in db.execute(f"SELECT geom, hoehe_m FROM {quoted(buildings_table)} ORDER BY atlas_id"):
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
    for row in db.execute(f"SELECT * FROM {quoted(trees_table)} ORDER BY atlas_id"):
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

    def point_features(table: str, value=None):
        features = []
        for row in db.execute(f"SELECT * FROM {quoted(table)} ORDER BY atlas_id"):
            shape = geometry(row["geom"])
            point = local(shape.x, shape.y)
            if inside(point, 250):
                features.append((point, value(row) if value else 1))
        return features

    benches = point_features(benches_table)
    shelters = point_features(shelters_table)

    def crossing_support(row):
        positives = sum(truth(row[name]) for name in (
            "traffic_signals_sound", "traffic_signals_vibration", "tactile_paving"
        ))
        explicit = sum(row[name] is not None for name in (
            "traffic_signals_sound", "traffic_signals_vibration", "tactile_paving"
        ))
        return 3 if positives >= 2 else 2 if positives == 1 else 1 if explicit == 3 else 0

    crossings = point_features(crossings_table, crossing_support)

    pois = []
    for kind, table in poi_tables.items():
        for row in db.execute(f"SELECT * FROM {quoted(table)} ORDER BY atlas_id"):
            shape = geometry(row["geom"])
            point = local(shape.x, shape.y)
            if not inside(point, 250):
                continue
            keys = set(row.keys())
            name = ""
            for candidate in ("name", "stop_name", "hst_name", "connection", "barrier", "shelter_type"):
                if candidate in keys and row[candidate]:
                    name = str(row[candidate]).strip()
                    break
            pois.append({"p": point, "k": kind, "n": name[:80]})

    def spatial_index(features, cell=200):
        index = collections.defaultdict(list)
        for point, value in features:
            index[(math.floor(point[0] / cell), math.floor(point[1] / cell))].append((point, value))
        return index

    bench_index, shelter_index, crossing_index = map(spatial_index, (benches, shelters, crossings))

    def nearest(index, point, radius, cell=200):
        best_distance, best_value = radius + 1, 0
        reach = math.ceil(radius / cell)
        cx, cy = math.floor(point[0] / cell), math.floor(point[1] / cell)
        for x in range(cx - reach, cx + reach + 1):
            for y in range(cy - reach, cy + reach + 1):
                for candidate, value in index.get((x, y), ()):
                    distance = math.dist(point, candidate)
                    if distance < best_distance:
                        best_distance, best_value = distance, value
        return (round(best_distance) if best_distance <= radius else 65535), best_value

    for edge in edges:
        midpoint = [(edge["c"][0][0] + edge["c"][1][0]) / 2, (edge["c"][0][1] + edge["c"][1][1]) / 2]
        edge["bench"], _ = nearest(bench_index, midpoint, 1000)
        edge["shelter"], _ = nearest(shelter_index, midpoint, 1000)
        crossing_distance, edge["crossing"] = nearest(crossing_index, midpoint, 30)
        if crossing_distance > 30:
            edge["crossing"] = 0

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
        "sourceLayers": {
            "network": network_table, "buildings": buildings_table, "trees": trees_table,
            "crossings": crossings_table, "benches": benches_table, "shelters": shelters_table,
            "pois": {str(kind): table for kind, table in poi_tables.items()},
        },
        "pois": collections.Counter(point["k"] for point in pois),
    }
    payloads = {
        "network": {"nodes": nodes, "edges": edges},
        "obstacles": {"buildings": buildings, "trees": trees, "pois": pois}, "meta": meta,
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
