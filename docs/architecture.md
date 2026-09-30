# Architecture

Sonnenpfad Stuttgart is currently a static, browser-computed prototype.

## Runtime

- Cloudflare Workers Static Assets serves the application and terrain tiles.
- MapLibre GL JS renders the 2D/3D map, terrain, buildings, trees and routes.
- Routing and exact shadow calculation run locally in a Web Worker. A matching lightweight solar-position function runs in the UI thread so the clock and compass respond immediately during interaction.
- Prepared atlas data is split into immutable binary network arrays and 1 km JSON tiles for independent caching. Each visual tile reuses one line geometry array with a parallel eight-value theme array and contains compact POI records. A one-byte-per-edge direction asset drives uphill arrows without duplicating geometry.
- A 500 m spatial index restricts endpoint snapping to nearby network edges.
- Mobility profiles use a three-state safety model: explicit known barriers are removed from the graph, less suitable known attributes receive costs, and missing attributes remain routable with an uncertainty penalty. Profile constraints apply consistently to connectivity, snapping, partial edges and directional expansion; the result reports relevant attribute coverage instead of claiming certified accessibility.
- Both map modes stay within Stuttgart; outside areas are masked. In 3D, a bounded level-of-detail window prioritises nine tiles around and ahead of the camera. Zoom-dependent budgets cap extruded buildings and rounded tree crowns, invariant sources are retained where possible, and a view signature prevents rebuilding unchanged tile sets.
- Panning and zooming request a silent 512 px shadow preview only when the visible tile set changes. These background updates never disable the route action or replace its status. Manual time changes and playback update the solar UI continuously; a 1,024 px route-aware calculation is committed after interaction stops.
- No route, selected location or device position is persisted by the application.

## Build and deployment

GitHub is the source of truth. Pull requests and pushes to `main` run the same engine verification used locally. Cloudflare Builds executes `npm run build` and deploys the generated `dist/` directory through Wrangler.

The source GeoPackage is never committed. The Python pipeline reads it locally and exports only the fields and geometries needed by the application. Contract version 5 retains the fixed 48-byte routing edge record and the eight visual themes plus ten POI types. It adds compact signal-crossing accessibility fields without duplicating geometry.

Signal crossings use the historical four-class atlas rule based only on `traffic_signals_sound`, `traffic_signals_vibration` and `tactile_paving`: at least two `yes` values are good support, exactly one is partial support, three explicit `no` values are no documented support, and every other combination is unknown/incomplete. Wheelchair suitability and kerb form remain separate attributes and do not silently alter the historical colour class.

## Service boundary

The recommended free-tier layout keeps the HTML, CSS, JavaScript and small manifests in Cloudflare Workers Static Assets. Large immutable city and terrain tiles belong in Cloudflare R2 under the same public hostname or a dedicated asset hostname. Route calculation remains in the browser, so tile requests do not invoke dynamic Worker compute. Photon is used only as a replaceable geocoding service for place search; its public demo has no availability guarantee and must be replaced by a contracted or self-hosted provider when traffic becomes material.

Cloudflare Workers may later provide small, cacheable adapters for live weather and public-transport feeds. D1 is reserved for lightweight metadata and release manifests; it is not the spatial routing engine. Adding a second generic compute host is deliberately avoided until measurements demonstrate a compute bottleneck: the present workload is dominated by cacheable static downloads and client-side work, so another application server would add CORS, latency and operational failure modes without reducing browser rendering cost.
