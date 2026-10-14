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

## Performance changes prepared in the browser

The old graph is downloaded/decoded only on the first browser routing or route-shade
job. It is not needed for map exploration or standard server Direct. Visible tile
fetches deduplicate pending requests, with six parallel tile tasks. 3D loads its full
viewport tile selection instead of nine tiles and displays buildings intersecting
the viewport instead of keeping the first 1,800–4,500 arbitrary buildings. 3D has a
14.5 minimum zoom to keep the building view bounded. Sphere crowns are analytic
instanced WebGL2 surfaces; trunks retain compact extrusion geometry.

Route preview uses the already computed route at 18 m/s, with eased bearings and
manual stop. It throttles tile refreshes and suppresses shadow recalculation during
playback. It is a visual preview, not live navigation.

Longer term, prepare clipped building vector tiles/meshes and DEM tiles offline,
then serve them through a CDN. Moving raw JSON to the Oracle VM would not remove
browser parsing or drawing costs. No new subscription or storage service is required
by this change.

## Verification limits

Automated checks cover graph loading, profile costs, map-pick mode and route-point
interpolation. Actual desktop/mobile WebGL rendering, sphere depth and terrain-boundary
projection must still be verified in a real browser. Local historical asset copies
do not match all current repository data counts; full data checks must use CI's
current checkout. This change is a review/preview candidate until those checks pass.
