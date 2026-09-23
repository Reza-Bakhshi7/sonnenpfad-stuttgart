#!/usr/bin/env python3
"""Validate a Pedestrian Atlas GeoPackage without modifying it."""

from __future__ import annotations

import argparse
import hashlib
import json
import sqlite3
import sys
from pathlib import Path
from typing import Any


LAYER_ALIASES = {
    "Pedestrian_Network": ("Pedestrian_Network", "Strassen"),
    "Buildings": ("Buildings", "Gebaeude"),
    "Trees": ("Trees", "Baeume"),
    "Stuttgart_Municipality": ("Stuttgart_Municipality", "Gemeinde_Stuttgart"),
    "Surface": ("Surface", "Strassen_Bodenbelag"),
    "Noise": ("Noise", "Strassen_Laerm"),
    "Shade_Summer": ("Shade_Summer", "Strassen_Schatten"),
    "Shade_Winter": ("Shade_Winter", "Strassen_Schatten_Winter"),
    "UTCI_Summer": ("UTCI_Summer", "Strassen_UTCI"),
    "UTCI_Winter": ("UTCI_Winter", "Strassen_UTCI_Winter"),
    "Wind": ("Wind", "Strassen_Wind"),
    "Signalized_Crossings": ("Signalized_Crossings", "Ampeluebergaenge"),
    "Elevators": ("Elevators", "Aufzuege"),
    "Escalators": ("Escalators", "Rolltreppen"),
    "Ramps": ("Ramps", "Rampen"),
    "Stairs": ("Stairs", "Treppen"),
    "Barriers_and_Gates": ("Barriers_and_Gates", "Barrieren_Tore"),
    "Lowered_Curbs": ("Lowered_Curbs", "Bordstein_abgesenkt"),
    "Raised_Curbs": ("Raised_Curbs", "Bordstein_erhoeht"),
    "Shelters": ("Shelters", "Unterstande"),
    "Benches": ("Benches", "Sitzbaenke"),
}


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def quoted(identifier: str) -> str:
    return '"' + identifier.replace('"', '""') + '"'


def add_check(report: dict[str, Any], name: str, ok: bool, details: Any) -> None:
    report["checks"].append({"name": name, "status": "pass" if ok else "fail", "details": details})
    if not ok:
        report["status"] = "fail"


def table_columns(connection: sqlite3.Connection, table: str) -> set[str]:
    return {row[1] for row in connection.execute(f"PRAGMA table_info({quoted(table)})")}


def validate(source: Path, catalog_path: Path, strict_baseline: bool) -> dict[str, Any]:
    catalog = json.loads(catalog_path.read_text(encoding="utf-8"))
    report: dict[str, Any] = {
        "validator_version": 1,
        "source": str(source.resolve()),
        "catalog": str(catalog_path.resolve()),
        "strict_baseline": strict_baseline,
        "status": "pass",
        "checks": [],
    }

    source_hash = sha256(source)
    report["source_sha256"] = source_hash
    expected_hash = catalog["baseline"]["sha256"]
    add_check(
        report,
        "baseline_sha256",
        (source_hash == expected_hash) if strict_baseline else True,
        {"actual": source_hash, "expected": expected_hash, "enforced": strict_baseline},
    )

    uri = f"file:{source.resolve().as_posix()}?mode=ro&immutable=1"
    connection = sqlite3.connect(uri, uri=True)
    try:
        connection.execute("PRAGMA query_only=ON")
        integrity = connection.execute("PRAGMA integrity_check").fetchall()
        add_check(report, "sqlite_integrity", integrity == [("ok",)], integrity)

        foreign_keys = connection.execute("PRAGMA foreign_key_check").fetchall()
        add_check(report, "foreign_keys", not foreign_keys, foreign_keys)

        geometry_rows = {
            row[0]: {"column": row[1], "geometry": row[2], "srs_id": row[4]}
            for row in connection.execute(
                "SELECT table_name, column_name, geometry_type_name, z, srs_id "
                "FROM gpkg_geometry_columns"
            )
        }
        expected_layer_count = catalog["baseline"]["feature_layer_count"]
        add_check(
            report,
            "feature_layer_count",
            len(geometry_rows) == expected_layer_count,
            {"actual": len(geometry_rows), "expected": expected_layer_count},
        )

        network_ids: set[str] | None = None
        layer_reports: list[dict[str, Any]] = []
        for layer in catalog["layers"]:
            name = layer["name"]
            candidates = (name,) if strict_baseline else LAYER_ALIASES.get(name, (name,))
            physical_name = next((candidate for candidate in candidates if candidate in geometry_rows), None)
            exists = physical_name is not None
            layer_report: dict[str, Any] = {
                "name": name, "physical_name": physical_name, "exists": exists
            }
            layer_reports.append(layer_report)
            if not exists:
                add_check(report, f"layer:{name}", False, "missing")
                continue

            geometry = geometry_rows[physical_name]
            columns = table_columns(connection, physical_name)
            missing_fields = sorted(set(layer["required_fields"]) - columns)
            count = connection.execute(f"SELECT COUNT(*) FROM {quoted(physical_name)}").fetchone()[0]
            null_ids = connection.execute(
                f"SELECT COUNT(*) FROM {quoted(physical_name)} WHERE atlas_id IS NULL OR TRIM(atlas_id) = ''"
            ).fetchone()[0]
            duplicate_ids = connection.execute(
                f"SELECT COUNT(*) FROM (SELECT atlas_id FROM {quoted(physical_name)} "
                "WHERE atlas_id IS NOT NULL AND TRIM(atlas_id) <> '' "
                "GROUP BY atlas_id HAVING COUNT(*) > 1)"
            ).fetchone()[0]

            layer_report.update(
                {
                    "feature_count": count,
                    "baseline_count": layer["baseline_count"],
                    "geometry": geometry["geometry"],
                    "srs_id": geometry["srs_id"],
                    "missing_fields": missing_fields,
                    "null_atlas_ids": null_ids,
                    "duplicate_atlas_ids": duplicate_ids,
                }
            )

            layer_ok = (
                geometry["column"] == catalog["rules"]["geometry_column"]
                and geometry["geometry"] == layer["geometry"]
                and geometry["srs_id"] == catalog["baseline"]["crs"]
                and not missing_fields
                and null_ids == 0
                and duplicate_ids == 0
                and (count == layer["baseline_count"] if strict_baseline else count > 0)
            )
            add_check(report, f"layer:{name}", layer_ok, layer_report)

            if name == "Pedestrian_Network":
                network_ids = {
                    row[0]
                    for row in connection.execute(
                        f"SELECT atlas_id FROM {quoted(physical_name)} WHERE atlas_id IS NOT NULL"
                    )
                }
            elif layer.get("must_match_network_atlas_ids"):
                if network_ids is None:
                    add_check(report, f"atlas_id_set:{name}", False, "network IDs unavailable")
                else:
                    theme_ids = {
                        row[0]
                        for row in connection.execute(
                            f"SELECT atlas_id FROM {quoted(physical_name)} WHERE atlas_id IS NOT NULL"
                        )
                    }
                    add_check(
                        report,
                        f"atlas_id_set:{name}",
                        theme_ids == network_ids,
                        {
                            "missing_from_theme": len(network_ids - theme_ids),
                            "extra_in_theme": len(theme_ids - network_ids),
                        },
                    )

        report["layers"] = layer_reports
    finally:
        connection.close()

    return report


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path, help="Path to the final atlas GeoPackage")
    parser.add_argument(
        "--catalog",
        type=Path,
        default=Path(__file__).resolve().parents[1] / "config" / "data_catalog.json",
    )
    parser.add_argument("--strict-baseline", action="store_true")
    parser.add_argument("--report", type=Path)
    args = parser.parse_args()

    if not args.source.is_file():
        parser.error(f"source does not exist: {args.source}")
    if not args.catalog.is_file():
        parser.error(f"catalog does not exist: {args.catalog}")

    report = validate(args.source, args.catalog, args.strict_baseline)
    rendered = json.dumps(report, ensure_ascii=False, indent=2) + "\n"
    if args.report:
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(rendered, encoding="utf-8")
    print(rendered, end="")
    return 0 if report["status"] == "pass" else 1


if __name__ == "__main__":
    sys.exit(main())
