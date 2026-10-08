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
    assert manifest["version"] == 5
    assert manifest["scope"] == "city"
    assert manifest["network"]["nodeStride"] == 8
    assert manifest["network"]["edgeStride"] == 48
    slope_directions = root / manifest["visual"]["slopeDirections"]
    assert slope_directions.stat().st_size == manifest["network"]["edgeCount"] == manifest["visual"]["count"]
    assert asset_size(root, manifest["network"]["nodes"]) == manifest["network"]["nodeCount"] * 8
    assert asset_size(root, manifest["network"]["edges"]) == manifest["network"]["edgeCount"] * 48
    assert "crossingSupport" in manifest["profileFeatures"]
    snap_files = manifest["network"]["snapIndex"] if isinstance(manifest["network"]["snapIndex"], list) else [manifest["network"]["snapIndex"]]
    snap = {}
    for file in snap_files:
        snap.update(json.loads((root / file).read_text(encoding="utf-8")))
    assert snap and all(isinstance(indices, list) and indices for indices in snap.values())
    assert manifest["themes"] == ["slope", "surface", "shadeSummer", "shadeWinter", "utciSummer", "utciWinter", "noise", "wind"]
    assert len(manifest["poiTypes"]) == 10
    buildings = trees = lines = pois = scaled = 0
    crossing_classes = {0: 0, 1: 0, 2: 0, 3: 0}
    for tile in manifest["obstacles"]["tiles"].values():
        display = json.loads((root / tile["displayFile"]).read_text(encoding="utf-8"))
        shade = json.loads((root / tile["shadeFile"]).read_text(encoding="utf-8"))
        assert len(shade["buildings"]) == tile["buildings"]
        assert len(shade["trees"]) == tile["trees"]
        assert len(display["lines"]) == tile["lines"]
        assert len(display["edgeIds"]) == tile["edgeIds"] == tile["lines"]
        assert len(display["themes"]) == tile["themes"] == tile["lines"]
        assert len(display["pois"]) == tile["pois"]
        assert all(isinstance(edge_id, int) for edge_id in display["edgeIds"])
        assert all(isinstance(theme, list) and len(theme) == 8 for theme in display["themes"])
        assert all(isinstance(poi.get("k"), int) and len(poi.get("p", [])) == 2 for poi in display["pois"])
        for poi in display["pois"]:
            assert "n" not in poi, "POI names must not be exported to public detail cards"
            assert poi.get("src"), "Every POI must expose a source or source layer"
            if poi["k"] == 1:
                assert all(isinstance(poi.get(field), int) for field in ("q", "a", "v", "t", "w", "c", "b"))
                crossing_classes[poi["q"]] += 1
        buildings += tile["buildings"]
        trees += tile["trees"]
        lines += tile["lines"]
        pois += tile["pois"]
        for tree in shade["trees"]:
            assert math.isclose(tree["dh"], round(tree["h"] * 0.7, 1))
            assert math.isclose(tree["dr"], round(tree["r"] * 0.7, 1))
            if tree["h"] >= 15:
                scaled += 1
    assert buildings == manifest["counts"]["buildings"]
    assert trees == manifest["counts"]["trees"]
    assert lines == manifest["counts"]["lines"]
    assert pois == manifest["counts"]["pois"]
    assert scaled == manifest["counts"]["largeTreesScaled"]
    assert crossing_classes == {0: 2092, 1: 251, 2: 1216, 3: 702}
    print(json.dumps({"passed": True, "tiles": len(manifest["obstacles"]["tiles"]), "lines": lines, "buildings": buildings, "trees": trees, "pois": pois, "largeTreesScaled": scaled}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
