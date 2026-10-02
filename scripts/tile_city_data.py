#!/usr/bin/env python3
"""Write compact citywide routing data and lazy obstacle tiles for static hosting."""

from __future__ import annotations

import argparse
import collections
import json
import math
import pathlib
import shutil
import struct


ROOT = pathlib.Path(__file__).resolve().parents[1]
NODE_STRUCT = struct.Struct("<ff")
EDGE_STRUCT = struct.Struct("<IIfffffbbbbHBBHHHBBxxxx")


def dump_json(path: pathlib.Path, value) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, separators=(",", ":"), ensure_ascii=False), encoding="utf-8")


def split_binary(path: pathlib.Path, chunk_bytes: int) -> list[str]:
    """Split a binary asset into Git/Workers-friendly immutable parts."""
    data = path.read_bytes()
    parts = []
    for index, offset in enumerate(range(0, len(data), chunk_bytes)):
        part = path.with_name(f"{path.stem}-{index:03d}{path.suffix}")
        part.write_bytes(data[offset:offset + chunk_bytes])
        parts.append(f"network/{part.name}")
    path.unlink()
    return parts


def dump_mapping_chunks(directory: pathlib.Path, stem: str, value: dict, keys_per_chunk: int) -> list[str]:
    items = sorted(value.items())
    files = []
    for index, offset in enumerate(range(0, len(items), keys_per_chunk)):
        name = f"{stem}-{index:03d}.json"
        dump_json(directory / name, dict(items[offset:offset + keys_per_chunk]))
        files.append(f"network/{name}")
    return files


def tile_key(point, size: int) -> str:
    return f"{math.floor(point[0] / size)}_{math.floor(point[1] / size)}"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input_dir", type=pathlib.Path)
    parser.add_argument("--output-dir", type=pathlib.Path, default=ROOT / "dist" / "city")
    parser.add_argument("--obstacle-grid", type=int, default=1000)
    parser.add_argument("--snap-grid", type=int, default=500)
    parser.add_argument("--binary-chunk-bytes", type=int, default=524288)
    parser.add_argument("--snap-index-keys", type=int, default=200)
    args = parser.parse_args()

    source = args.input_dir.resolve()
    output = args.output_dir.resolve()
    if output.exists():
        shutil.rmtree(output)
    output.mkdir(parents=True)

    network = json.loads((source / "network.json").read_text(encoding="utf-8"))
    obstacles = json.loads((source / "obstacles.json").read_text(encoding="utf-8"))
    meta = json.loads((source / "meta.json").read_text(encoding="utf-8"))

    network_dir = output / "network"
    network_dir.mkdir()
    with (network_dir / "nodes.bin").open("wb") as stream:
        for x, y in network["nodes"]:
            stream.write(NODE_STRUCT.pack(x, y))

    snap_index: dict[str, list[int]] = collections.defaultdict(list)
    with (network_dir / "edges.bin").open("wb") as stream, (output / "slope-directions.bin").open("wb") as slope_stream, (output / "step-flags.bin").open("wb") as step_stream, (output / "structure-flags.bin").open("wb") as structure_stream:
        for index, edge in enumerate(network["edges"]):
            flags = (1 if edge["steps"] else 0) | (2 if edge["covered"] else 0)
            mobility = (
                (1 if edge["tactile"] else 0)
                | (2 if edge["handrail"] else 0)
                | (4 if edge["ramp"] else 0)
                | (8 if edge["escalator"] else 0)
            )
            signed = edge["sf"] if edge["sf"] is not None else math.nan
            slope_stream.write(struct.pack("<b", 1 if signed > 0 else -1 if signed < 0 else 0))
            step_stream.write(struct.pack("<B", 1 if edge["steps"] else 0))
            structure_stream.write(struct.pack("<B", (1 if edge.get("bridge") else 0) | (2 if edge.get("tunnel") else 0)))
            stream.write(EDGE_STRUCT.pack(
                edge["a"], edge["b"], edge["l"], edge["s"], signed,
                edge["z0"], edge["z1"], edge["dir"], flags, edge["sq"], 0,
                mobility, edge["surface"], edge["way"],
                min(65535, round(edge["width"] * 10)), edge["bench"], edge["shelter"],
                edge["crossing"], edge["wheelchair"],
            ))
            a, b = edge["c"]
            x0, x1 = sorted((math.floor(a[0] / args.snap_grid), math.floor(b[0] / args.snap_grid)))
            y0, y1 = sorted((math.floor(a[1] / args.snap_grid), math.floor(b[1] / args.snap_grid)))
            for x in range(x0, x1 + 1):
                for y in range(y0, y1 + 1):
                    snap_index[f"{x}_{y}"].append(index)
    snap_files = dump_mapping_chunks(network_dir, "snap-index", snap_index, args.snap_index_keys)
    node_files = split_binary(network_dir / "nodes.bin", args.binary_chunk_bytes)
    edge_files = split_binary(network_dir / "edges.bin", args.binary_chunk_bytes)

    tiles: dict[str, dict[str, list]] = collections.defaultdict(
        lambda: {"buildings": [], "trees": [], "lines": [], "edgeIds": [], "themes": [], "pois": []}
    )
    for edge_id, edge in enumerate(network["edges"]):
        a, b = edge["c"]
        tile = tiles[tile_key([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], args.obstacle_grid)]
        tile["lines"].append(edge["c"])
        tile["edgeIds"].append(edge_id)
        tile["themes"].append(edge["theme"])
    for building in obstacles["buildings"]:
        exterior = building["r"][0]
        center = [sum(p[0] for p in exterior) / len(exterior), sum(p[1] for p in exterior) / len(exterior)]
        tiles[tile_key(center, args.obstacle_grid)]["buildings"].append(building)
    large_trees = 0
    for tree in obstacles["trees"]:
        display = dict(tree)
        if tree["h"] >= 15:
            display["dh"] = round(tree["h"] * 0.8, 1)
            display["dr"] = round(tree["r"] * 0.8, 1)
            large_trees += 1
        tiles[tile_key(tree["p"], args.obstacle_grid)]["trees"].append(display)
    for poi in obstacles.get("pois", []):
        tiles[tile_key(poi["p"], args.obstacle_grid)]["pois"].append(poi)

    tile_manifest = {}
    poi_counts = collections.Counter()
    crossing_class_counts = collections.Counter()
    for key in sorted(tiles):
        payload = tiles[key]
        display_relative = f"display/{key}.json"
        shade_relative = f"shade/{key}.json"
        dump_json(output / display_relative, {
            name: payload[name] for name in ("lines", "edgeIds", "themes", "pois")
        })
        dump_json(output / shade_relative, {
            name: payload[name] for name in ("buildings", "trees")
        })
        tile_manifest[key] = {
            "displayFile": display_relative,
            "shadeFile": shade_relative,
            "buildings": len(payload["buildings"]),
            "trees": len(payload["trees"]),
            "lines": len(payload["lines"]),
            "edgeIds": len(payload["edgeIds"]),
            "themes": len(payload["themes"]),
            "pois": len(payload["pois"]),
        }
        poi_counts.update(item["k"] for item in payload["pois"])
        crossing_class_counts.update(item.get("q", 0) for item in payload["pois"] if item["k"] == 1)

    manifest = {
        "version": 5,
        "scope": "city",
        "origin": meta["origin"],
        "scale": meta["scale"],
        "bounds": meta["bounds"],
        "sourceDate": meta["sourceDate"],
        "sourceSha256": meta["sourceSha256"],
        "network": {
            "nodes": node_files, "nodeCount": len(network["nodes"]), "nodeStride": NODE_STRUCT.size,
            "edges": edge_files, "edgeCount": len(network["edges"]), "edgeStride": EDGE_STRUCT.size,
            "snapIndex": snap_files, "snapGrid": args.snap_grid,
        },
        "obstacles": {"grid": args.obstacle_grid, "paddingTiles": 1, "tiles": tile_manifest},
        "visual": {"slopeDirections": "slope-directions.bin", "stepFlags": "step-flags.bin", "structureFlags": "structure-flags.bin", "count": len(network["edges"])},
        "counts": {
            "buildings": len(obstacles["buildings"]), "trees": len(obstacles["trees"]),
            "lines": len(network["edges"]), "largeTreesScaled": large_trees,
            "pois": sum(poi_counts.values()), "poiTypes": dict(sorted(poi_counts.items())),
        },
        "themes": ["slope", "surface", "shadeSummer", "shadeWinter", "utciSummer", "utciWinter", "noise", "wind"],
        "poiTypes": {"1": "crossing", "2": "elevator", "3": "ramp", "4": "escalator", "5": "stairs", "6": "barrier", "7": "loweredKerb", "8": "raisedKerb", "9": "bench", "10": "shelter"},
        "crossingAccessibility": {
            "fields": ["traffic_signals_sound", "traffic_signals_vibration", "tactile_paving"],
            "classes": {
                "3": {"key": "good", "color": "#2E7D32", "count": crossing_class_counts[3]},
                "2": {"key": "partial", "color": "#F9A825", "count": crossing_class_counts[2]},
                "1": {"key": "none", "color": "#C62828", "count": crossing_class_counts[1]},
                "0": {"key": "unknown", "color": "#9E9E9E", "count": crossing_class_counts[0]},
            },
        },
        "elevationQuality": meta["elevationQuality"],
        "profileFeatures": [
            "steps", "escalator", "signedSlope", "surface", "wayClass", "width",
            "wheelchair", "tactile", "handrail", "ramp", "benchDistance",
            "shelterDistance", "crossingSupport",
        ],
        "sourceLayers": meta.get("sourceLayers", {}),
    }
    dump_json(output / "manifest.json", manifest)
    total_bytes = sum(path.stat().st_size for path in output.rglob("*") if path.is_file())
    print(json.dumps({
        "nodes": len(network["nodes"]), "edges": len(network["edges"]), "tiles": len(tiles),
        "largeTreesScaled": large_trees, "bytes": total_bytes,
    }, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
