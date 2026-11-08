# Sonnenpfad routing server (Stage 2)

FastAPI service on `127.0.0.1:8002`, published by Nginx at `/profile-v2/` (`health`, `capabilities`, `v1/route` only). It routes every profile and preference of the app.

- `engine.py`: in-memory graph (`routing.walk_edges` plus the restored atlas ways in `gap_supplement.json`), profile rules, directional gradients, relaxation tiers, search radii 50 m to 5 km and per-segment `profile_violations`.
- `shadows.py` with `shade_tiles.zip`: the browser's shadow model, so shade and sun routes match the app exactly.
- `poi_points.json`: benches, shelters and signalised crossings used by the profile costs.
- `app.py`: request contract (`contract_version: 1`), strict validation, 16 KB body limit, two routes at a time with a 10 s queue, no access log.
- `profile_api.py`, `routing_core.py`, `sonnenpfad_profile_rules.py`: read-only database session, reference SQL engine and the rule set shared with `scripts/core.mjs`.
- Tests: `test_engine.py`, `test_adapter.py`, `test_shadows.py` (CI), `smoke_v2.py` (after every server update).

The database is only read. Updates are built with `scripts/build_profile_v2_update.py`; the updater tests in a staging copy, swaps, restarts, runs the smoke test and rolls back automatically on failure. Operation, limits and the emergency switch are described in [docs/server-routing-release.md](../../docs/server-routing-release.md).
