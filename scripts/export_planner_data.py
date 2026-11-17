"""Export the district planner layer: the thesis working network, cut at the 23 district borders.

Input: the analysis GeoPackage (Netz_Arbeitsbestand_Stadtbezirke, EPSG:25832, one row per
piece inside one district) and the municipal district polygons (KLGL_BRUTTO_STADTBEZIRK).
Output: dist/city/planner/districts.json and one compact file per district.
"""
from __future__ import annotations

import argparse
import json
import math
import re
import pathlib
import sqlite3

from pyproj import Transformer
from shapely import wkb

# Above this gradient a non-stair value is a terrain-model error (e.g. 200 m paths at 200 %);
# the value is dropped and the piece counts as "value missing".
SLOPE_CAP = 30.0
STAIRS_CLASS = "05_Treppen"
TO_WGS84 = Transformer.from_crs(25832, 4326, always_xy=True)


def geometry(blob):
    envelope = (blob[3] >> 1) & 7
    return wkb.loads(blob[8 + {0: 0, 1: 32, 2: 48, 3: 48, 4: 64}[envelope]:])


def number(value, digits=1):
    try:
        value = float(value)
    except (TypeError, ValueError):
        return None
    return round(value, digits) if math.isfinite(value) else None


def surface_quality(value) -> int:
    return {"good": 1, "medium": 2, "poor": 3}.get(str(value or "").lower(), 0)


def truth(value) -> bool:
    return str(value or "").strip().lower() in {"t", "yes", "true", "1"}


def lonlat(coords):
    xs, ys = zip(*[(x, y) for x, y, *_ in coords])
    lon, lat = TO_WGS84.transform(xs, ys)
    return [[round(a, 6), round(b, 6)] for a, b in zip(lon, lat)]


def lines_of(shape):
    return list(shape.geoms) if shape.geom_type.startswith("Multi") else [shape]


def clean_slope(value, stairs):
    slope = number(value)
    if slope is None:
        return None
    slope = abs(slope)
    return None if not stairs and slope > SLOPE_CAP else slope


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--network", type=pathlib.Path, default=pathlib.Path("C:/Thesis/Analyse/Netz_Arbeitsbestand_Stadtbezirke.gpkg"))
    parser.add_argument("--districts", type=pathlib.Path, default=pathlib.Path("C:/Thesis/FSG/Projekt/Daten/Sonstige/BaseLayers/OpenData-KLGL-Generalsisiert/OpenData_KLGL_GENERALISIERT.gpkg"))
    parser.add_argument("--output", type=pathlib.Path, default=pathlib.Path(__file__).resolve().parents[1] / "dist/city/planner")
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)

    polygons = sqlite3.connect(args.districts)
    districts, boundary_features = {}, []
    for blob, name, nr in polygons.execute("SELECT SHAPE, STADTBEZIRKNAME, STADTBEZIRKNR FROM KLGL_BRUTTO_STADTBEZIRK ORDER BY STADTBEZIRKNR"):
        shape = geometry(blob).simplify(4)
        rings = [[lonlat(polygon.exterior.coords)] + [lonlat(hole.coords) for hole in polygon.interiors] for polygon in lines_of(shape)]
        flat = [point for polygon in rings for point in polygon[0]]
        district_id = int(nr)
        districts[name] = {"id": district_id, "name": name, "file": f"d-{district_id:02d}.json",
                           "bbox": [min(p[0] for p in flat), min(p[1] for p in flat), max(p[0] for p in flat), max(p[1] for p in flat)],
                           "label": lonlat(shape.representative_point().coords)[0],
                           "pieces": 0, "km": 0.0, "lines": [], "v": [], "k": [], "m": [], "a": [], "nm": []}
        boundary_features.append({"type": "Feature", "id": district_id, "properties": {"id": district_id, "name": name},
                                  "geometry": {"type": "MultiPolygon", "coordinates": rings}})
    assert len(districts) == 23, len(districts)

    network = sqlite3.connect(args.network)
    network.row_factory = sqlite3.Row
    removed = 0
    for row in network.execute('SELECT * FROM "Netz_Arbeitsbestand_Stadtbezirke" ORDER BY atlas_id, fid'):
        district = districts[row["bez_STADTBEZIRKNAME"]]
        stairs = row["steigung_karte"] == STAIRS_CLASS
        slope = clean_slope(row["slope_pct"], stairs)
        removed += slope is None and number(row["slope_pct"]) is not None
        kind = (1 if stairs else 0) | (2 if truth(row["bridge"]) else 0) | (4 if truth(row["tunnel"]) else 0)
        values = [slope, surface_quality(row["surface_class"]), number(row["shadow_pct"]), number(row["shadow_pct_winter"]),
                  number(row["utci_avg"]), number(row["utci_avg_winter"]), number(row["noise_db"]), number(row["wind_exposure_index"], 2)]
        for part in lines_of(geometry(row["geom"])):
            if part.length < 0.05:
                continue
            district["lines"].append(lonlat(part.simplify(0.5).coords))
            district["v"].append(values)
            district["k"].append(kind)
            district["m"].append(round(part.length, 1))
            district["a"].append(row["atlas_id"])
            district["nm"].append(re.sub(r"\s*\[FID \d+\]$", "", row["display_name"] or row["name"] or ""))

    index = []
    for district in districts.values():
        payload = {key: district[key] for key in ("lines", "v", "k", "m", "a", "nm")}
        (args.output / district["file"]).write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
        index.append({key: district[key] for key in ("id", "name", "file", "bbox", "label")} | {"pieces": len(district["m"]), "km": round(sum(district["m"]) / 1000, 2)})
    index.sort(key=lambda item: item["name"])
    manifest = {
        "version": 1,
        "source": "Fußgängeratlas Stuttgart, Arbeitsbestand der Bezirksauswertung (Netz_Arbeitsbestand_Stadtbezirke)",
        "boundarySource": "Landeshauptstadt Stuttgart, Kleinräumige Gliederung (generalisiert), Stadtbezirke",
        "themes": ["slope", "surface", "shadeSummer", "shadeWinter", "utciSummer", "utciWinter", "noise", "wind"],
        "kinds": {"1": "stairs", "2": "bridge", "4": "tunnel"},
        "slopeCap": SLOPE_CAP, "slopeRemoved": removed,
        "districts": index,
        "boundaries": {"type": "FeatureCollection", "features": boundary_features},
    }
    (args.output / "districts.json").write_text(json.dumps(manifest, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(json.dumps({"districts": len(index), "pieces": sum(d["pieces"] for d in index), "slopeRemoved": removed}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
