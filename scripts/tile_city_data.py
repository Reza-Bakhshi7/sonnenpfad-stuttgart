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
EDGE_STRUCT = struct.Struct("<IIfffffbbbb")


def dump_json(path: pathlib.Path, value) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, separators=(",", ":"), ensure_ascii=False), encoding="utf-8")


def tile_key(point, size: int) -> str:
    return f"{math.floor(point[0] / size)}_{math.floor(point[1] / size)}"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input_dir", type=pathlib.Path)
    parser.add_argument("--output-dir", type=pathlib.Path, default=ROOT / "dist" / "city")
    parser.add_argument("--obstacle-grid", type=int, default=1000)
    parser.add_argument("--snap-grid", type=int, default=500)
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
    with (network_dir / "edges.bin").open("wb") as stream:
        for index, edge in enumerate(network["edges"]):
            flags = (1 if edge["steps"] else 0) | (2 if edge["covered"] else 0)
            signed = edge["sf"] if edge["sf"] is not None else math.nan
            stream.write(EDGE_STRUCT.pack(
                edge["a"], edge["b"], edge["l"], edge["s"], signed,
                edge["z0"], edge["z1"], edge["dir"], flags, edge["sq"], 0,
            ))
            a, b = edge["c"]
            x0, x1 = sorted((math.floor(a[0] / args.snap_grid), math.floor(b[0] / args.snap_grid)))
            y0, y1 = sorted((math.floor(a[1] / args.snap_grid), math.floor(b[1] / args.snap_grid)))
            for x in range(x0, x1 + 1):
                for y in range(y0, y1 + 1):
                    snap_index[f"{x}_{y}"].append(index)
    dump_json(network_dir / "snap-index.json", snap_index)

    tiles: dict[str, dict[str, list]] = collections.defaultdict(lambda: {"buildings": [], "trees": [], "lines": []})
    for edge in network["edges"]:
        a, b = edge["c"]
        tiles[tile_key([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], args.obstacle_grid)]["lines"].append(edge["c"])
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

    tile_manifest = {}
    for key in sorted(tiles):
        payload = tiles[key]
        relative = f"obstacles/{key}.json"
        dump_json(output / relative, payload)
        tile_manifest[key] = {
            "file": relative,
            "buildings": len(payload["buildings"]),
            "trees": len(payload["trees"]),
            "lines": len(payload["lines"]),
        }

    manifest = {
        "version": 2,
        "scope": "city",
        "origin": meta["origin"],
        "scale": meta["scale"],
        "bounds": meta["bounds"],
        "sourceDate": meta["sourceDate"],
        "sourceSha256": meta["sourceSha256"],
        "network": {
            "nodes": "network/nodes.bin", "nodeCount": len(network["nodes"]), "nodeStride": NODE_STRUCT.size,
            "edges": "network/edges.bin", "edgeCount": len(network["edges"]), "edgeStride": EDGE_STRUCT.size,
            "snapIndex": "network/snap-index.json", "snapGrid": args.snap_grid,
        },
        "obstacles": {"grid": args.obstacle_grid, "paddingTiles": 1, "tiles": tile_manifest},
        "counts": {"buildings": len(obstacles["buildings"]), "trees": len(obstacles["trees"]), "lines": len(network["edges"]), "largeTreesScaled": large_trees},
        "elevationQuality": meta["elevationQuality"],
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
