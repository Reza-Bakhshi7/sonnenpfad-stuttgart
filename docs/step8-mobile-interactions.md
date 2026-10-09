# Step 8: explicit map selection and mobile detail cards

## Behaviour

- Map exploration is the default. Panning, pinching, double-tapping and holding do not create route endpoints.
- Activate the button beside Start or Destination, then tap the desired position. Each selection ends the mode; selecting the other endpoint requires its button.
- Press the active button again or Escape to cancel. Buttons expose their selected state through aria-pressed.
- Multi-pointer, moved and cancelled gestures cannot set an endpoint, even when selection is armed.
- Normal taps on POIs and paths open details on mobile. Hover remains limited to desktop fine pointers. Endpoint-selection events do not also open cards.
- Mobile controls have larger touch areas. Detail cards have bounded, scrollable content.

## Validation

`node scripts/check_map_interactions.mjs` executes the application selection and card handlers using map/DOM stubs. It checks unarmed clicks, one-shot selection, pan/pinch/cancel protection, Escape, mobile card taps, suppressed hover and event consumption. It runs as part of npm test.

Manual validation still required on Android Chrome and iOS Safari with WebGL: repeated pinch zoom and panning; selecting both endpoints; cancelling selection; inspecting POIs; switching 2D/3D; checking 320/390/430 px portrait and landscape layouts. The automated cloud browser currently cannot create a WebGL context. Its failure must not be counted as a real-device pass.

## Routing backend recommendation (not yet selected or deployed)

Recommend self-hosted PostgreSQL + PostGIS + pgRouting with a small API for the atlas network. Preserve atlas IDs and route restrictions; use request-specific directional costs for shade, slope and mobility. Validate data connectivity before switching routing engines. pgRouting does not calculate solar shadows or provide turn-by-turn navigation by itself. Dynamic shadow generation and request caching remain separate work.

The user has created an Oracle account only. No VM or server has been provisioned. Current Oracle documentation on 2026-10-09 lists A1 Always Free limits of 1,500 OCPU-hours and 9,000 GB-hours/month (2 OCPUs, 12 GB RAM), 200 GB combined boot/block storage in the home region. Check the account Console before creating resources; do not use older 4 OCPU/24 GB claims. Free resources can have capacity shortages and idle VMs can be reclaimed. Keep the existing browser engine available until backend correctness, performance and outage behaviour are verified.

Sources:
- https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm
- https://github.com/pgRouting/pgrouting
- https://docs.pgrouting.org/latest/en/migration.html
- https://github.com/graphhopper/graphhopper/blob/master/docs/core/custom-models.md
- https://valhalla.github.io/valhalla/sif/dynamic-costing/
- https://project-osrm.org/docs/v5.5.1/api/
