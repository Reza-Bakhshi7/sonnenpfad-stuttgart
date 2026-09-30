# Architecture

Sonnenpfad Stuttgart is currently a static, browser-computed prototype.

## Runtime

- Cloudflare Workers Static Assets serves the application and terrain tiles.
- MapLibre GL JS renders the 2D/3D map, terrain, buildings, trees and routes.
- Routing, solar geometry and shadow calculation run locally in a Web Worker.
- Prepared atlas data is split into immutable binary network arrays and 1 km JSON tiles for independent caching. Each visual tile reuses one line geometry array with a parallel eight-value theme array and contains compact POI records. A one-byte-per-edge direction asset drives uphill arrows without duplicating geometry.
- A 500 m spatial index restricts endpoint snapping to nearby network edges.
- Both map modes stay within Stuttgart; outside areas are masked. In 3D, a bounded level-of-detail window prioritises ten tiles around and ahead of the camera. Zoom-dependent budgets cap extruded buildings and rounded tree crowns, and a view signature prevents rebuilding unchanged tile sets.
- No route, selected location or device position is persisted by the application.

## Build and deployment

GitHub is the source of truth. Pull requests and pushes to `main` run the same engine verification used locally. Cloudflare Builds executes `npm run build` and deploys the generated `dist/` directory through Wrangler.

The source GeoPackage is never committed. The Python pipeline reads it locally and exports only the fields and geometries needed by the application. Contract version 4 retains the version-3 fixed 48-byte routing edge record and adds validated visual themes plus ten POI types without duplicating line geometry.

## Service boundary

The recommended free-tier layout keeps the HTML, CSS, JavaScript and small manifests in Cloudflare Workers Static Assets. Large immutable city and terrain tiles belong in Cloudflare R2 under the same public hostname or a dedicated asset hostname. Route calculation remains in the browser, so tile requests do not invoke dynamic Worker compute. Photon is used only as a replaceable geocoding service for place search; its public demo has no availability guarantee and must be replaced by a contracted or self-hosted provider when traffic becomes material.

Cloudflare Workers may later provide small, cacheable adapters for live weather and public-transport feeds. D1 is reserved for lightweight metadata and release manifests; it is not the spatial routing engine. Adding a second generic compute host is deliberately avoided until measurements demonstrate a compute bottleneck: the present workload is dominated by cacheable static downloads and client-side work, so another application server would add CORS, latency and operational failure modes without reducing browser rendering cost.
