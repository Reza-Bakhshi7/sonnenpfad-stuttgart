# Server profile preparation and remaining installation

## Local API transport preparation, 2 November 2026

The installed stage-1 source was supplied by the owner and verified as SHA256
`ad44b2c11b0d6e851f63e49fc929da78c6fb547316268d0e007e7ff008a06b70`.
It supports Standard, wheelchair and power wheelchair with balanced/Direct only.
The SQL and component-check improvements remain unchanged in the reviewed snapshot
under `services/profile-api-v1/`.

The prepared FastAPI transport uses `127.0.0.1:8002` and the browser's versioned
request format. `scripts/profile-routing-v1.mjs` checks explicit preview versus
production acceptance, effective criteria, geometry, missing values and profile
times. It is deliberately absent from `build-cloudflare.mjs`: no UI request or
production behavior changes merely by committing this preparation.

`python scripts/build_profile_v2_installer.py` generates the single-file installer.
It verifies the installed core and two dependency-module hashes, tests only the
new transport, and creates a separate stage-2 directory and systemd unit. It
changes no Nginx configuration, firewall rules, existing API service or database
schema. Its loopback acceptance uses three new-transport requests and compares
Standard against API 0.2. Those VM checks have not yet been run. The final
read-only column inventory supports planning the remaining profile attributes.

The 11 ASGI transport tests, 6 isolated installer boundary tests and actual
Python/JavaScript exchange checks pass locally. Existing core runtime acceptance
is recorded separately; it is not a claim that the new service is installed.

Publication is explicitly on hold at the owner's request. Public HTTPS exposure,
browser integration and citywide acceptance remain separate work. Do not replace
`production_ready: false` merely to satisfy an older capability predicate.

## Earlier migration contract and remaining profile work

Current production API 0.2 supports shortest only. No SSH was used for this change.
The audited server graph remains authoritative for standard Direct. Other profiles
continue to use the existing browser graph until server implementation is installed.

`scripts/server-profile-contract.mjs` prepares versioned requests for Direct, Shade,
Sun, standard, wheelchair, power wheelchair, walking aid, vision, stroller and custom.
It reuses `resolvedOptions`, `relaxationTiers`, `edgeAllowed` and the extracted
`edgeCostMultiplier` from the existing routing engine. Directed pgRouting costs use
the same rules: `-1` excludes an edge; reverse cost respects the original direction.
Unknown attributes retain the existing uncertainty penalties. Missing shadow
fractions are rejected rather than treated as zero shade.

Before enabling this adapter on Ubuntu:

1. Expose `/capabilities` with `profile_contract_version: 1`,
   `topology: audited-osm-nodes`, `segment_metadata_version: 1`, supported
   `preferences`, `mobility_profiles`, and `shadow_model: geometric-time-aware`
   for Shade/Sun. The frontend capability predicate is implemented but not connected
   to API 0.2. Capability advertisement alone is not a migration or acceptance test.
2. Add a versioned POST route endpoint accepting `buildProfileRequest` output.
   Enforce access, barriers, layers and OSM direction before optional profile costs.
   Enrich audited pieces with Atlas attributes, crossing guidance and comfort POIs.
   Preserve partial start/end piece costs and oriented elevation metadata.
3. For Shade/Sun, compute geometric exposure per directed piece for the supplied time,
   date and leaf state; apply solarWeight. Do not substitute snapshot theme values for
   actual modelled shadows. Cache time buckets and bound route-search work.
4. Apply the shared relaxation tiers, report every relaxed criterion and unknown
   attribute coverage. Compare every mobility profile on known stairs, slopes,
   inaccessible links and disconnected networks before enabling the frontend gate.
5. Return the existing segment contract plus requested profile, effective options,
   relaxed criteria and distance-weighted assessment. Update `adaptServerRoute`
   to read these fields when the server implementation exists.

## Version 0.12 browser and display boundary

The preview no longer fetches original obstacles for city display, constructs
Atlas building meshes or loads DEM for the camera. Native OpenFreeMap buildings
and separately generated minimal tree files replace that path. Standard Direct
renders the Oracle response immediately. Balanced browser profiles no longer
wait for shade tiles/calculation. Atlas obstacles still drive Shade/Sun costs and
explicit Explore shadow display; their inputs and calculation heights are intact.

The remaining expensive first-load path is the city graph for nonstandard
profiles. The correct next Oracle installation is the profile API described at
the top of this document, not hosting JavaScript or another copy of the basemap.
Before that installation, obtain the current API service source/service name,
PostgreSQL/PostGIS connection configuration and routing graph schema on the VM.
Keep credentials there. Then implement and validate `/capabilities` and the
versioned profile POST endpoint against the existing engine contract. Require
known barrier, directed partial-edge, relaxation and shadow-time fixture parity
before enabling frontend capability negotiation. No profile capability has been
advertised or enabled without that server implementation.

Optional server attribute endpoints should be keyed by immutable Atlas element
ID or visible tile; return only a requested object's attributes. Current static
click shards already remove the eager full-detail transfer, so this endpoint is
not a prerequisite for the new preview. Immutable elevations belong beside the
routing graph, with prepared public display files at the CDN. Raw high-resolution
DEM does not belong in the navigation rendering critical path.
