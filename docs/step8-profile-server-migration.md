# Server profile preparation and remaining installation

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
