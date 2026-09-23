#!/usr/bin/env python3
"""Validate the generated static full-city data contract."""

from __future__ import annotations

import argparse
import json
import math
import pathlib


def asset_size(root: pathlib.Path, value: str | list[str]) -> int:
    files = value if isinstance(value, list) else [value]
    assert files and all(isinstance(item, str) for item in files)
    return sum((root / item).stat().st_size for item in files)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("directory", type=pathlib.Path)
    args = parser.parse_args()
    root = args.directory.resolve()
    manifest = json.loads((root / "manifest.json").read_text(encoding="utf-8"))
    assert manifest["version"] == 3
    assert manifest["scope"] == "city"
    assert manifest["network"]["nodeStride"] == 8
    assert manifest["network"]["edgeStride"] == 48
    assert asset_size(root, manifest["network"]["nodes"]) == manifest["network"]["nodeCount"] * 8
    assert asset_size(root, manifest["network"]["edges"]) == manifest["network"]["edgeCount"] * 48
    assert "crossingSupport" in manifest["profileFeatures"]
    snap_files = manifest["network"]["snapIndex"] if isinstance(manifest["network"]["snapIndex"], list) else [manifest["network"]["snapIndex"]]
    snap = {}
    for file in snap_files:
        snap.update(json.loads((root / file).read_text(encoding="utf-8")))
    assert snap and all(isinstance(indices, list) and indices for indices in snap.values())
    buildings = trees = lines = scaled = 0
    for tile in manifest["obstacles"]["tiles"].values():
        payload = json.loads((root / tile["file"]).read_text(encoding="utf-8"))
        assert len(payload["buildings"]) == tile["buildings"]
        assert len(payload["trees"]) == tile["trees"]
        assert len(payload["lines"]) == tile["lines"]
        assert len(payload["edgeIds"]) == tile["edgeIds"] == tile["lines"]
        assert all(isinstance(edge_id, int) for edge_id in payload["edgeIds"])
        buildings += tile["buildings"]
        trees += tile["trees"]
        lines += tile["lines"]
        for tree in payload["trees"]:
            if tree["h"] >= 15:
                scaled += 1
                assert math.isclose(tree["dh"], round(tree["h"] * 0.8, 1))
                assert math.isclose(tree["dr"], round(tree["r"] * 0.8, 1))
            else:
                assert "dh" not in tree and "dr" not in tree
    assert buildings == manifest["counts"]["buildings"]
    assert trees == manifest["counts"]["trees"]
    assert lines == manifest["counts"]["lines"]
    assert scaled == manifest["counts"]["largeTreesScaled"]
    print(json.dumps({"passed": True, "tiles": len(manifest["obstacles"]["tiles"]), "lines": lines, "buildings": buildings, "trees": trees, "largeTreesScaled": scaled}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
