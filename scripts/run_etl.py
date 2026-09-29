#!/usr/bin/env python3
"""Run the atlas publication pipeline from one validated GeoPackage."""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SCRIPTS = ROOT / "scripts"


def run(command: list[str]) -> None:
    print("+", " ".join(command), flush=True)
    subprocess.run(command, cwd=ROOT, check=True)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path, help="Final atlas GeoPackage")
    parser.add_argument(
        "--allow-compatible-source",
        action="store_true",
        help="Accept a contract-compatible source whose checksum differs from the release baseline",
    )
    parser.add_argument("--skip-terrain", action="store_true", help="Skip Terrain-RGB generation")
    parser.add_argument("--skip-app-tests", action="store_true", help="Skip npm test")
    parser.add_argument("--scope", choices=("pilot", "city"), default="pilot")
    args = parser.parse_args()

    source = args.source.resolve()
    if not source.is_file():
        parser.error(f"source does not exist: {source}")

    build_dir = ROOT / ("build_city" if args.scope == "city" else "build_data")
    build_dir.mkdir(parents=True, exist_ok=True)
    report = build_dir / "source-validation.json"
    validation = [
        sys.executable,
        str(SCRIPTS / "validate_source.py"),
        str(source),
        "--report",
        str(report),
    ]
    if not args.allow_compatible_source:
        validation.append("--strict-baseline")

    catalog = json.loads((ROOT / "config" / "data_catalog.json").read_text(encoding="utf-8"))
    source_date = catalog["baseline"]["source_date"]

    run(validation)
    run(
        [
            sys.executable,
            str(SCRIPTS / "prepare_data.py"),
            str(source),
            "--source-date",
            source_date,
            "--scope",
            args.scope,
            "--output-dir",
            str(build_dir),
        ]
    )
    if not args.skip_terrain:
        run([sys.executable, str(SCRIPTS / "generate_terrain.py"), "--input-dir", str(build_dir)])
    if args.scope == "city":
        city_dir = ROOT / "dist" / "city"
        run([sys.executable, str(SCRIPTS / "tile_city_data.py"), str(build_dir), "--output-dir", str(city_dir)])
        run([sys.executable, str(SCRIPTS / "check_city_tiles.py"), str(city_dir)])
    else:
        run([sys.executable, str(SCRIPTS / "chunk_data.py")])
    if not args.skip_app_tests:
        run(["npm", "test"])

    print("ETL completed successfully.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
