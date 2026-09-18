# Architecture

Sonnenpfad Stuttgart is currently a static, browser-computed prototype.

## Runtime

- Cloudflare Workers Static Assets serves the application and terrain tiles.
- MapLibre GL JS renders the 2D/3D map, terrain, buildings, trees and routes.
- Routing, solar geometry and shadow calculation run locally in a Web Worker.
- Prepared atlas data is split into immutable JSON chunks for independent caching.
- No route, selected location or device position is persisted by the application.

## Build and deployment

GitHub is the source of truth. Pull requests and pushes to `main` run the same engine verification used locally. Cloudflare Builds executes `npm run build` and deploys the generated `dist/` directory through Wrangler.

The source GeoPackage is never committed. The Python pipeline reads it locally and exports only the fields and geometries needed by the application.

## Planned backend boundary

Cloudflare Workers will later provide small, cacheable adapters for live weather and public-transport feeds. Large geospatial artifacts belong in R2. D1 is reserved for lightweight metadata and release manifests; it is not the spatial routing engine.
