# Sonnenpfad Stuttgart data pipeline

## Purpose

This pipeline converts the final, portable Pedestrian Atlas GeoPackage into the selected browser assets used by Sonnenpfad Stuttgart. The GeoPackage is an external, read-only input and is never committed to this repository.

## Authoritative baseline

- Release: `v0.7.0`
- Source file: `Fussgaengeratlas_Stuttgart.gpkg`
- Dataset date: 15 September 2026
- CRS: EPSG:25832
- Feature layers: 21
- SHA-256: `ccc2e6b3f406e530547da73b7d1f7e02f01ea5ddb0ca3300996398603c34a1e7`

The baseline hash identifies the exact source used to produce the existing `v0.7.0` pilot assets. Future approved atlas versions may have different hashes and counts, but must satisfy the same data contract or introduce an explicitly versioned contract change.

## Current stages

1. `validate_source.py` validates the GeoPackage in SQLite read-only mode.
2. `prepare_data.py` extracts and transforms the selected pilot area.
3. `generate_terrain.py` creates display-only Terrain-RGB tiles.
4. `chunk_data.py` writes size-bounded JSON assets and a loading manifest.
5. `npm test` builds the app and runs engine and governance checks.

## Validation modes

Contract validation accepts a newer approved atlas when its layer names, CRS, geometry types, mandatory fields, stable IDs and cross-layer relationships remain valid:

```bash
python scripts/validate_source.py /path/to/Fussgaengeratlas_Stuttgart.gpkg
```

Strict baseline validation additionally requires the exact `v0.7.0` source hash and baseline feature counts:

```bash
python scripts/validate_source.py /path/to/Fussgaengeratlas_Stuttgart.gpkg --strict-baseline
```

Use strict validation when reproducing the released pilot. Use contract validation only for an explicitly approved successor dataset.

## One-command rebuild

Create an isolated Python environment and run the complete publication path
from the repository root:

```bash
python -m venv .venv-etl
.venv-etl/bin/pip install -r requirements-etl.txt
.venv-etl/bin/python scripts/run_etl.py /path/to/Fussgaengeratlas_Stuttgart.gpkg
```

The command validates the immutable release checksum by default, prepares the
pilot data in stable `atlas_id` order, generates Terrain-RGB tiles, creates the
size-bounded browser chunks, and runs the application tests. For an intentionally
new but contract-compatible source, add `--allow-compatible-source`; this is an
explicit review decision and is recorded by the validation report.

## Safety rules

- Open the source with `mode=ro`, `immutable=1` and `query_only=ON`.
- Never rewrite, rename or migrate tables inside the source GeoPackage.
- Never commit the GeoPackage, raw rasters or temporary build products to Git.
- Stop before transformation if any required layer, field, geometry, CRS or `atlas_id` rule fails.
- The seven network-theme layers must contain exactly the same `atlas_id` set as `Pedestrian_Network`.
- Public browser data must contain only fields required by the application.

## Known limitations carried by the baseline

- The wind exposure value is a relative indicator, not a physical wind speed.
- UTCI values are model approximations and are not coupled to live weather.
- Terrain tiles are interpolated from network endpoint elevations and are for visualisation only.
- Building and tree heights include documented fallback values.
- The current pilot is spatially limited to Stuttgart-Mitte.
