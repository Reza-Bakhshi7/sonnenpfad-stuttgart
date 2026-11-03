# Server-only routing: state and release procedure

## What runs where

- **Stage 2** (`sonnenpfad-profile-v2.service`, 127.0.0.1:8002, public via Nginx `/profile-v2/`) routes every profile and option in memory (`services/profile-api-v1/engine.py`) on the audited graph (`routing.walk_edges`) plus the restored atlas ways (`gap_supplement.json`), with the browser's shadow model (`shadows.py`, `shade_tiles.zip`). The database is only read.
- **Preview hosts** always route on Stage 2 and never in the browser; failures are shown as errors.
- **Production hosts** keep Oracle API 0.2 (Standard Direct) and the browser until Stage 2 reports `production_ready: true` and `deployment_stage: "production"` in `/capabilities`. The app checks this once at start; until then nothing changes.
- Capacity: two routes compute at once, further requests queue up to 10 s (`SLOTS`, `QUEUE_SECONDS` in `app.py`). Measured: 12 simultaneous mixed requests all answered within 10 s. Nginx limits `/profile-v2/` to 2 requests/s per IP (burst 8).

## Verification already in place

- `npm test`, `test_adapter`, `test_engine`, `test_shadows`, updater/installer tests (CI runs them; the Python service tests also run in the updater's staging step).
- `smoke_v2.py` after every update: all seven profiles, engine equal to the SQL/pgRouting engine, sun/shade shares, Standard equal to API 0.2 or shorter only via restored ways.
- Shadow parity with the browser on a real tile at four sun positions (`make_shade_fixture.mjs` → `shade_fixture.json`).

## Release order (only after an explicit "Freigabe")

1. Set `PRODUCTION_READY = True` in `services/profile-api-v1/app.py`, bump `VERSION`, build and run the updater (`python scripts/build_profile_v2_update.py`, upload, `sudo /usr/bin/python3 update_sonnenpfad_profile_v2.py`). The current production app does not call Stage 2, so this changes nothing for users yet.
2. Merge the branch to `main` with the version and changelog update; Cloudflare deploys.
3. Live check on both production hosts: routes in all profiles, sun/shade, "Berechnet auf dem Sonnenpfad-Server", no Oracle `/route` requests.
4. Rollback: revert the merge on `main` (browser and API 0.2 return), or set `PRODUCTION_READY = False` and update Stage 2 (production falls back to the previous behaviour at the next page load).

## Known limits

- One VM: if it is down, server-only hosts cannot route (deliberate: no browser fallback).
- The gap supplement and access blocks depend on the current `routing.walk_edges`; after a rebuild, regenerate `gap_supplement.json` (`scripts/export_gap_supplement.py`) and `access-blocked.bin`. Stage 2 stops with `gap_supplement_stale` instead of routing on mismatched ids.
- Shade outside the route corridor (start–end line plus 2 km) counts as 0, exactly as in the browser.
- The vision profile cannot tell crossings without equipment data from no crossing (data limit, labelled in the app).
