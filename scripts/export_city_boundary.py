#!/usr/bin/env python3
"""Export Stuttgart's municipal boundary from the atlas GeoPackage as WGS84 GeoJSON."""

import argparse
import json
import math
import sqlite3
import struct
from pathlib import Path


def read_wkb(data: bytes, offset: int = 0):
    byte_order = data[offset]
    endian = "<" if byte_order == 1 else ">"
    geometry_type = struct.unpack_from(endian + "I", data, offset + 1)[0] & 0xFF
    offset += 5
    if geometry_type == 3:  # Polygon
        count = struct.unpack_from(endian + "I", data, offset)[0]
        offset += 4
        rings = []
        for _ in range(count):
            size = struct.unpack_from(endian + "I", data, offset)[0]
            offset += 4
            ring = [struct.unpack_from(endian + "dd", data, offset + i * 16) for i in range(size)]
            offset += size * 16
            rings.append(ring)
        return rings, offset
    if geometry_type == 6:  # MultiPolygon
        count = struct.unpack_from(endian + "I", data, offset)[0]
        offset += 4
        polygons = []
        for _ in range(count):
            polygon, offset = read_wkb(data, offset)
            polygons.append(polygon)
        return polygons, offset
    raise ValueError(f"Unsupported WKB geometry type: {geometry_type}")


def gpkg_wkb(blob: bytes) -> bytes:
    flags = blob[3]
    envelope_type = (flags >> 1) & 0b111
    envelope_sizes = {0: 0, 1: 32, 2: 48, 3: 48, 4: 64}
    return blob[8 + envelope_sizes[envelope_type] :]


def utm32_to_wgs84(easting: float, northing: float):
    # Inverse UTM, WGS84 ellipsoid, northern hemisphere, zone 32.
    a = 6378137.0
    ecc_sq = 0.00669437999014
    ecc_prime_sq = ecc_sq / (1 - ecc_sq)
    k0 = 0.9996
    x = easting - 500000.0
    y = northing
    m = y / k0
    mu = m / (a * (1 - ecc_sq / 4 - 3 * ecc_sq**2 / 64 - 5 * ecc_sq**3 / 256))
    e1 = (1 - math.sqrt(1 - ecc_sq)) / (1 + math.sqrt(1 - ecc_sq))
    j1 = 3 * e1 / 2 - 27 * e1**3 / 32
    j2 = 21 * e1**2 / 16 - 55 * e1**4 / 32
    j3 = 151 * e1**3 / 96
    j4 = 1097 * e1**4 / 512
    fp = mu + j1 * math.sin(2 * mu) + j2 * math.sin(4 * mu) + j3 * math.sin(6 * mu) + j4 * math.sin(8 * mu)
    sin_fp, cos_fp = math.sin(fp), math.cos(fp)
    tan_fp = math.tan(fp)
    c1 = ecc_prime_sq * cos_fp**2
    t1 = tan_fp**2
    n1 = a / math.sqrt(1 - ecc_sq * sin_fp**2)
    r1 = a * (1 - ecc_sq) / (1 - ecc_sq * sin_fp**2) ** 1.5
    d = x / (n1 * k0)
    lat = fp - (n1 * tan_fp / r1) * (
        d**2 / 2
        - (5 + 3 * t1 + 10 * c1 - 4 * c1**2 - 9 * ecc_prime_sq) * d**4 / 24
        + (61 + 90 * t1 + 298 * c1 + 45 * t1**2 - 252 * ecc_prime_sq - 3 * c1**2) * d**6 / 720
    )
    lon = (
        d
        - (1 + 2 * t1 + c1) * d**3 / 6
        + (5 - 2 * c1 + 28 * t1 - 3 * c1**2 + 8 * ecc_prime_sq + 24 * t1**2) * d**5 / 120
    ) / cos_fp
    return [round(math.degrees(lon) + 9, 7), round(math.degrees(lat), 7)]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("gpkg", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    with sqlite3.connect(args.gpkg) as db:
        blob = db.execute('SELECT geom FROM "Gemeinde_Stuttgart" LIMIT 1').fetchone()[0]
    geometry, _ = read_wkb(gpkg_wkb(blob))
    # Normalize Polygon and MultiPolygon, then transform EPSG:25832 to WGS84.
    if geometry and geometry[0] and isinstance(geometry[0][0][0], (int, float)):
        geometry = [geometry]
    coordinates = [[[utm32_to_wgs84(x, y) for x, y in ring] for ring in polygon] for polygon in geometry]
    feature = {"type": "Feature", "properties": {"name": "Stuttgart"}, "geometry": {"type": "MultiPolygon", "coordinates": coordinates}}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(feature, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")


if __name__ == "__main__":
    main()
