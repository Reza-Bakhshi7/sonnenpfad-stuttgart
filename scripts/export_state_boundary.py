"""Export the Baden-Württemberg outline (BKG VG25, land and Lake Constance share) as a light GeoJSON
for the map context mask. Routing and analysis stay limited to Stuttgart."""
import json, pathlib, sqlite3, sys
from pyproj import Transformer
from shapely import wkb
from shapely.ops import unary_union, transform

source = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else "C:/Thesis/FSG/Projekt/Daten/Sonstige/vg25/DE_VG25.gpkg")
output = pathlib.Path(__file__).resolve().parents[1] / "dist/city/bw-boundary.json"
db = sqlite3.connect(source)
def geometry(blob):
    envelope = (blob[3] >> 1) & 7
    return wkb.loads(blob[8 + {0: 0, 1: 32, 2: 48, 3: 48, 4: 64}[envelope]:])
parts = [geometry(blob) for (blob,) in db.execute("SELECT geom FROM vg25_lan WHERE GEN LIKE 'Baden-W%'")]
assert len(parts) == 3, len(parts)
state = unary_union(parts).buffer(1).buffer(-1).simplify(80)  # closes slivers between parts, ~80 m detail
to_wgs = Transformer.from_crs(25832, 4326, always_xy=True).transform
state = transform(to_wgs, state)
polygons = list(state.geoms) if state.geom_type == "MultiPolygon" else [state]
polygons = [p for p in polygons if p.area > 1e-5]  # drop tiny exclaves below map resolution
coords = [[[[round(x, 5), round(y, 5)] for x, y in ring.coords] for ring in [p.exterior, *p.interiors]] for p in polygons]
feature = {"type": "Feature", "properties": {"name": "Baden-Württemberg", "source": "© BKG (2026) VG25, CC BY 4.0, simplified"},
           "geometry": {"type": "MultiPolygon", "coordinates": coords}}
output.write_text(json.dumps(feature, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
print(len(coords), "polygons", output.stat().st_size, "bytes", [round(v, 3) for v in state.bounds])
