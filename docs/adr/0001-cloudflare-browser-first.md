# ADR 0001: Cloudflare hosting with browser-first geospatial processing

- Status: superseded in 0.15.0 (routing moved to the Sonnenpfad server; the browser keeps an identical emergency copy, see `docs/server-routing-release.md`)
- Date: 2026-09-18

## Context

The prototype needs low-cost hosting, reproducible deployment and a path toward weather and public-transport integration. The current Stuttgart-Mitte graph is small enough for local calculation.

## Decision

Use GitHub as the source of truth and Cloudflare Workers Static Assets for deployment. Keep routing, solar geometry and shadow calculation in a browser Web Worker. Introduce Cloudflare Workers only for cacheable live-data adapters, R2 for large geospatial artifacts and D1 for lightweight metadata.

## Consequences

- The prototype has no continuously running application server.
- Route selections and device positions are not persisted by default.
- Browser CPU, memory and WebGL capability remain operational constraints.
- Full-Stuttgart coverage must be measured before choosing server-side routing.
- Live provider credentials remain server-side and are never exposed to the browser.

