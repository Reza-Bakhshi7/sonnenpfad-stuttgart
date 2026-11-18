"""Export the analysis layer of explore mode: the thesis working network, cut at the borders of the
23 districts (Stadtbezirke) and 69 sub-districts (Stadtteile), with every filterable attribute.

Input: the analysis GeoPackage (Netz_Arbeitsbestand_Stadtbezirke, EPSG:25832, one row per piece
inside one district) and the municipal boundaries (KLGL_BRUTTO_STADTBEZIRK / _STADTTEIL).
Output: dist/city/planner/districts.json (schema, areas, boundaries) and one columnar file per district.
"""
from __future__ import annotations

import argparse
import json
import math
import pathlib
import re
import sqlite3

from pyproj import Transformer
from shapely import STRtree, wkb

# Above this gradient a non-stair value is a terrain-model error (e.g. 200 m paths at 200 %);
# the value is dropped and the piece counts as "value missing".
SLOPE_CAP = 30.0
STAIRS_CLASS = "05_Treppen"
TO_WGS84 = Transformer.from_crs(25832, 4326, always_xy=True)

# Numeric attributes: key, source column, unit, decimals, label de, label en.
NUMERIC = [
    ("slope", "slope_pct", "%", 1, "Steigung", "Gradient"),
    ("shadeSummer", "shadow_pct", "%", 0, "Schatten Sommer", "Shade summer"),
    ("shadeWinter", "shadow_pct_winter", "%", 0, "Schatten Winter", "Shade winter"),
    ("utciSummer", "utci_avg", "°C", 1, "UTCI Sommer (Wärmebelastung)", "UTCI summer (heat stress)"),
    ("utciWinter", "utci_avg_winter", "°C", 1, "UTCI Winter (Kältebelastung)", "UTCI winter (cold stress)"),
    ("noise", "noise_db", "dB", 1, "Lärm", "Noise"),
    ("wind", "wind_exposure_index", "", 2, "Windexposition (0–1)", "Wind exposure (0–1)"),
    ("width", "width", "m", 1, "Wegbreite", "Path width"),
    ("length", None, "m", 1, "Abschnittslänge", "Section length"),
]
# Categorical attributes: key, labels, ordered categories (code, de, en, source values).
CATEGORICAL = [
    ("way", "Wegtyp", "Way type", [
        ("footway", "Fußweg", "Footway", {"footway"}), ("pedestrian", "Fußgängerzone", "Pedestrian zone", {"pedestrian"}),
        ("path", "Pfad", "Path", {"path", "bridleway"}), ("steps", "Treppe", "Steps", {"steps"}),
        ("living_street", "Verkehrsberuhigt", "Living street", {"living_street"}), ("residential", "Wohnstraße", "Residential street", {"residential"}),
        ("service", "Erschließungsweg", "Service road", {"service"}), ("track", "Feld-/Waldweg", "Track", {"track", "track_grade1", "track_grade2", "track_grade3", "track_grade4", "track_grade5"}),
        ("cycleway", "Radweg", "Cycleway", {"cycleway"}),
        ("road", "Hauptstraße", "Main road", {"primary", "primary_link", "secondary", "secondary_link", "tertiary", "tertiary_link", "trunk", "trunk_link", "unclassified", "motorway_link"}),
    ]),
    ("stairs", "Treppe", "Stairs", [("yes", "Ja", "Yes", None), ("no", "Nein", "No", None)]),
    ("surfaceQuality", "Oberflächenqualität", "Surface quality", [
        ("good", "Gut", "Good", {"good"}), ("medium", "Mittel", "Medium", {"medium"}), ("poor", "Schlecht", "Poor", {"poor"})]),
    ("surface", "Belag", "Surface material", [
        ("asphalt", "Asphalt", "Asphalt", {"asphalt"}), ("paving", "Pflaster/Platten", "Paving stones", {"paving_stones", "paving_stones:30", "tiles", "grass_paver"}),
        ("concrete", "Beton", "Concrete", {"concrete", "concrete:plates", "concrete:lanes"}),
        ("sett", "Kopfstein/Naturstein", "Sett / cobblestone", {"sett", "cobblestone", "unhewn_cobblestone", "pebblestone", "stone"}),
        ("gravel", "Kies/Schotter", "Gravel", {"gravel", "fine_gravel", "compacted"}),
        ("natural", "Naturboden", "Natural ground", {"dirt", "ground", "earth", "grass", "unpaved", "rock", "sand", "mud", "woodchips"}),
        ("paved", "Befestigt (ohne Angabe)", "Paved (unspecified)", {"paved"}),
        ("other", "Sonstiges", "Other", None)]),
    ("smoothness", "Ebenheit", "Smoothness", [
        ("excellent", "Sehr gut", "Excellent", {"excellent"}), ("good", "Gut", "Good", {"good"}), ("intermediate", "Mittel", "Intermediate", {"intermediate"}),
        ("bad", "Schlecht", "Bad", {"bad"}), ("very_bad", "Sehr schlecht", "Very bad", {"very_bad", "horrible", "very_horrible", "impassable"})]),
    ("wheelchair", "Rollstuhleignung", "Wheelchair suitability", [
        ("yes", "Ja", "Yes", {"yes"}), ("limited", "Eingeschränkt", "Limited", {"limited"}), ("no", "Nein", "No", {"no"})]),
    ("lit", "Beleuchtung", "Lighting", [
        ("yes", "Ja", "Yes", {"yes", "24/7", "automatic", "button_operated", "light_switch", "sunset-sunrise"}), ("no", "Nein", "No", {"no", "disused"})]),
    ("handrail", "Handlauf", "Handrail", [("yes", "Ja", "Yes", {"yes", "both", "left", "right"}), ("no", "Nein", "No", {"no", "none"})]),
    ("tactile", "Taktile Leitlinien", "Tactile paving", [
        ("yes", "Ja", "Yes", {"yes"}), ("partial", "Teilweise/fehlerhaft", "Partial/incorrect", {"partial", "incorrect"}), ("no", "Nein", "No", {"no"})]),
    ("ramp", "Rampe", "Ramp", [("yes", "Ja", "Yes", {"yes", "separate", "separat"}), ("no", "Nein", "No", {"no"})]),
    ("access", "Zugang laut OSM", "Access (OSM)", [
        ("permitted", "Erlaubnis erfasst", "Permission recorded", {"1_Erlaubnis_erfasst"}), ("tolerated", "Geduldet", "Tolerated", {"2_Geduldet_erfasst"}),
        ("special", "Sonderangabe", "Special access", {"5_Sonderangabe_pruefen"}), ("unstated", "Keine Angabe", "Not stated", {"6_Keine_explizite_Angabe"})]),
    ("bridge", "Brücke", "Bridge", [("yes", "Ja", "Yes", None), ("no", "Nein", "No", None)]),
    ("tunnel", "Tunnel", "Tunnel", [("yes", "Ja", "Yes", None), ("no", "Nein", "No", None)]),
]


def geometry(blob):
    envelope = (blob[3] >> 1) & 7
    return wkb.loads(blob[8 + {0: 0, 1: 32, 2: 48, 3: 48, 4: 64}[envelope]:])


def number(value, digits=1):
    try:
        value = float(value)
    except (TypeError, ValueError):
        return None
    return round(value, digits) if math.isfinite(value) else None


def truth(value) -> bool:
    return str(value or "").strip().lower() in {"t", "yes", "true", "1"}


def lonlat(coords):
    xs, ys = zip(*[(x, y) for x, y, *_ in coords])
    lon, lat = TO_WGS84.transform(xs, ys)
    return [[round(a, 6), round(b, 6)] for a, b in zip(lon, lat)]


def lines_of(shape):
    if shape.is_empty:
        return []
    if shape.geom_type == "LineString":
        return [shape]
    if hasattr(shape, "geoms"):
        return [part for geom in shape.geoms for part in lines_of(geom)]
    return []


def category(spec, raw):
    """Code index of a raw value; None = value missing. A catch-all category (values None) takes the rest."""
    value = str(raw or "").strip().lower()
    if not value:
        return None
    rest = None
    for index, (_, _, _, sources) in enumerate(spec):
        if sources is None:
            rest = index
        elif value in {source.lower() for source in sources}:
            return index
    return rest


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--network", type=pathlib.Path, default=pathlib.Path("C:/Thesis/Analyse/Netz_Arbeitsbestand_Stadtbezirke.gpkg"))
    parser.add_argument("--districts", type=pathlib.Path, default=pathlib.Path("C:/Thesis/FSG/Projekt/Daten/Sonstige/BaseLayers/OpenData-KLGL-Generalsisiert/OpenData_KLGL_GENERALISIERT.gpkg"))
    parser.add_argument("--subdistricts", action="store_true", help="cut at Stadtteil borders (needs a complete, named Stadtteil layer)")
    parser.add_argument("--output", type=pathlib.Path, default=pathlib.Path(__file__).resolve().parents[1] / "dist/city/planner")
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    categories = {key: spec for key, _, _, spec in CATEGORICAL}

    polygons = sqlite3.connect(args.districts)
    districts, boundary_features, by_number = {}, [], {}
    for blob, name, nr in polygons.execute("SELECT SHAPE, STADTBEZIRKNAME, STADTBEZIRKNR FROM KLGL_BRUTTO_STADTBEZIRK ORDER BY STADTBEZIRKNR"):
        shape = geometry(blob).simplify(4)
        rings = [[lonlat(polygon.exterior.coords)] + [lonlat(hole.coords) for hole in polygon.interiors] for polygon in getattr(shape, "geoms", [shape])]
        flat = [point for polygon in rings for point in polygon[0]]
        district_id = int(nr)
        districts[name] = by_number[district_id] = {
            "id": district_id, "name": name, "file": f"d-{district_id:02d}.json",
            "bbox": [min(p[0] for p in flat), min(p[1] for p in flat), max(p[0] for p in flat), max(p[1] for p in flat)],
            "label": lonlat(shape.representative_point().coords)[0], "subdistricts": [],
            "lines": [], "a": [], "nm": [], "s": [], "n": {key: [] for key, *_ in NUMERIC}, "c": {key: [] for key in categories}}
        boundary_features.append({"type": "Feature", "id": district_id, "properties": {"id": district_id, "name": name, "level": "district"},
                                  "geometry": {"type": "MultiPolygon", "coordinates": rings}})
    assert len(districts) == 23, len(districts)

    # Sub-districts: original geometry for cutting, simplified outline for display.
    sub_shapes, sub_ids, sub_district = [], [], []
    sub_features = []
    for blob, district_nr, nr, name in polygons.execute("SELECT SHAPE, STADTBEZIRKNR, STADTTEILNR, STADTTEILNAME FROM KLGL_BRUTTO_STADTTEIL ORDER BY STADTTEILNR"):
        shape, sub_id, district = geometry(blob), int(nr), by_number[int(district_nr)]
        sub_shapes.append(shape)
        sub_ids.append(sub_id)
        sub_district.append(district["id"])
        display = shape.simplify(4)
        rings = [[lonlat(polygon.exterior.coords)] + [lonlat(hole.coords) for hole in polygon.interiors] for polygon in getattr(display, "geoms", [display])]
        district["subdistricts"].append({"id": sub_id, "name": name, "label": lonlat(display.representative_point().coords)[0]})
        sub_features.append({"type": "Feature", "id": 1000 + sub_id, "properties": {"id": sub_id, "district": district["id"], "name": name, "level": "subdistrict"},
                             "geometry": {"type": "MultiPolygon", "coordinates": rings}})
    if not args.subdistricts:
        sub_features = []
        for district in by_number.values():
            district["subdistricts"] = []
    tree = STRtree(sub_shapes)

    network = sqlite3.connect(args.network)
    network.row_factory = sqlite3.Row
    removed = 0
    for row in network.execute('SELECT * FROM "Netz_Arbeitsbestand_Stadtbezirke" ORDER BY atlas_id, fid'):
        district = districts[row["bez_STADTBEZIRKNAME"]]
        stairs = row["steigung_karte"] == STAIRS_CLASS
        slope = number(row["slope_pct"])
        if slope is not None:
            slope = abs(slope)
            if not stairs and slope > SLOPE_CAP:
                slope, removed = None, removed + 1
        numeric = {key: (slope if key == "slope" else number(row[column], digits) if column else None) for key, column, _, digits, *_ in NUMERIC}
        coded = {
            "way": category(categories["way"], row["fclass"]),
            "stairs": 0 if stairs else 1,
            "surfaceQuality": category(categories["surfaceQuality"], row["surface_class"]),
            "surface": category(categories["surface"], row["surface"]),
            "smoothness": category(categories["smoothness"], row["smoothness"]),
            "wheelchair": category(categories["wheelchair"], row["wheelchair"]),
            "lit": category(categories["lit"], row["lit"]),
            "handrail": category(categories["handrail"], row["handrail"]),
            "tactile": category(categories["tactile"], row["tactile_paving"]),
            "ramp": category(categories["ramp"], row["ramp"]),
            "access": category(categories["access"], row["zugang_status"]),
            "bridge": 0 if truth(row["bridge"]) else 1,
            "tunnel": 0 if truth(row["tunnel"]) else 1,
        }
        if numeric["width"] is not None and numeric["width"] <= 0:
            numeric["width"] = None
        name = re.sub(r"\s*\[FID \d+\]$", "", row["display_name"] or row["name"] or "")
        piece = geometry(row["geom"])
        cuts = [(index, piece.intersection(sub_shapes[index])) for index in tree.query(piece, predicate="intersects")] if args.subdistricts else [(None, piece)]
        for index, cut in cuts:
            if index is not None and sub_district[index] != district["id"]:
                continue  # a piece already belongs to one district; slivers along its border are ignored
            for part in lines_of(cut):
                if part.length < 0.05:
                    continue
                district["lines"].append(lonlat(part.simplify(0.5).coords))
                district["a"].append(row["atlas_id"])
                district["nm"].append(name)
                district["s"].append(sub_ids[index] if index is not None else None)
                for key in district["n"]:
                    district["n"][key].append(round(part.length, 1) if key == "length" else numeric[key])
                for key in district["c"]:
                    district["c"][key].append(coded[key])

    index = []
    for district in districts.values():
        payload = {key: district[key] for key in ("lines", "a", "nm", "s", "n", "c")}
        (args.output / district["file"]).write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
        index.append({key: district[key] for key in ("id", "name", "file", "bbox", "label", "subdistricts")}
                     | {"pieces": len(district["a"]), "km": round(sum(district["n"]["length"]) / 1000, 2)})
    index.sort(key=lambda item: item["name"])
    complete = lambda key, group: all(value is not None for district in districts.values() for value in district[group][key])
    manifest = {
        "version": 2,
        "source": "Fußgängeratlas Stuttgart, Arbeitsbestand der Bezirksauswertung (Netz_Arbeitsbestand_Stadtbezirke)",
        "boundarySource": "Landeshauptstadt Stuttgart, Stadtmessungsamt, Kleinräumige Gliederung (generalisiert), CC BY 4.0",
        "crs": "EPSG:4326", "simplification_m": 0.5,
        "slopeCap": SLOPE_CAP, "slopeRemoved": removed,
        # "complete": the attribute is recorded for every section (no "without value" option needed).
        "attributes": [{"key": key, "type": "number", "unit": unit, "de": de, "en": en, "complete": complete(key, "n")} for key, _, unit, _, de, en in NUMERIC]
                      + [{"key": key, "type": "category", "de": de, "en": en, "complete": complete(key, "c"),
                          "categories": [{"code": code, "de": cde, "en": cen} for code, cde, cen, _ in spec]} for key, de, en, spec in CATEGORICAL],
        "districts": index,
        "boundaries": {"type": "FeatureCollection", "features": boundary_features + sub_features},
    }
    (args.output / "districts.json").write_text(json.dumps(manifest, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(json.dumps({"districts": len(index), "subdistricts": len(sub_features), "pieces": sum(d["pieces"] for d in index),
                      "km": round(sum(d["km"] for d in index), 1), "slopeRemoved": removed}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
