from __future__ import annotations

import importlib.util
import json
import sqlite3
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
CATALOG_PATH = ROOT / "config" / "data_catalog.json"
VALIDATOR_PATH = ROOT / "scripts" / "validate_source.py"

SPEC = importlib.util.spec_from_file_location("validate_source", VALIDATOR_PATH)
assert SPEC and SPEC.loader
VALIDATOR = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(VALIDATOR)


def sql_name(value: str) -> str:
    return '"' + value.replace('"', '""') + '"'


def create_fixture(path: Path, *, omit_layer: str | None = None) -> None:
    catalog = json.loads(CATALOG_PATH.read_text(encoding="utf-8"))
    connection = sqlite3.connect(path)
    try:
        connection.execute(
            "CREATE TABLE gpkg_geometry_columns ("
            "table_name TEXT, column_name TEXT, geometry_type_name TEXT, "
            "srs_id INTEGER, z INTEGER, m INTEGER)"
        )
        for layer in catalog["layers"]:
            name = layer["name"]
            if name == omit_layer:
                continue
            fields = list(dict.fromkeys(layer["required_fields"]))
            definitions = []
            for field in fields:
                column_type = "INTEGER" if field == "fid" else "BLOB" if field == "geom" else "TEXT"
                definitions.append(f"{sql_name(field)} {column_type}")
            connection.execute(f"CREATE TABLE {sql_name(name)} ({', '.join(definitions)})")
            connection.execute(
                "INSERT INTO gpkg_geometry_columns "
                "(table_name, column_name, geometry_type_name, srs_id, z, m) "
                "VALUES (?, 'geom', ?, 25832, 0, 0)",
                (name, layer["geometry"]),
            )
            values = {
                field: 1 if field == "fid" else sqlite3.Binary(b"fixture") if field == "geom" else "atlas-1"
                for field in fields
            }
            columns = ", ".join(sql_name(field) for field in fields)
            placeholders = ", ".join("?" for _ in fields)
            connection.execute(
                f"INSERT INTO {sql_name(name)} ({columns}) VALUES ({placeholders})",
                [values[field] for field in fields],
            )
        connection.commit()
    finally:
        connection.close()


class DataContractTests(unittest.TestCase):
    def test_catalog_has_expected_unique_layers(self) -> None:
        catalog = json.loads(CATALOG_PATH.read_text(encoding="utf-8"))
        names = [layer["name"] for layer in catalog["layers"]]
        self.assertEqual(21, len(names))
        self.assertEqual(len(names), len(set(names)))
        self.assertEqual(catalog["baseline"]["feature_layer_count"], len(names))

    def test_contract_accepts_valid_fixture(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            source = Path(temporary) / "valid.gpkg"
            create_fixture(source)
            report = VALIDATOR.validate(source, CATALOG_PATH, strict_baseline=False)
            self.assertEqual("pass", report["status"])

    def test_contract_rejects_missing_layer(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            source = Path(temporary) / "invalid.gpkg"
            create_fixture(source, omit_layer="Trees")
            report = VALIDATOR.validate(source, CATALOG_PATH, strict_baseline=False)
            self.assertEqual("fail", report["status"])
            failed = {check["name"] for check in report["checks"] if check["status"] == "fail"}
            self.assertIn("layer:Trees", failed)


if __name__ == "__main__":
    unittest.main()
