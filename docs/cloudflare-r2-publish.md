# Publishing the full-city tiles with Cloudflare R2

The application shell remains a Workers Static Assets deployment. The generated
`dist/city/` directory is an immutable data release and should be published to a
Cloudflare R2 Standard bucket rather than committed to Git.

## Recommended layout

- Worker Static Assets: HTML, CSS, bundled JavaScript, pilot fallback and small metadata.
- R2 public/custom domain: `city/manifest.json`, network binaries and 1 km obstacle tiles.
- Browser Web Worker: snapping, route calculation and visible-area shadow calculation.
- Photon demo API: replaceable low-volume place search only.

This layout keeps static asset delivery cacheable and does not add a routing
server. It also prevents normal map movement from consuming dynamic Worker CPU.

## Release procedure

1. Run the compatible-source validation and full-city ETL documented in
   `docs/DATA_PIPELINE.md`.
2. Confirm that `scripts/check_city_tiles.py dist/city` succeeds.
3. Create an R2 Standard bucket such as `sonnenpfad-city`.
4. Upload the *contents* of `dist/city/` below a versioned prefix, for example
   `releases/2026-09-15-v3/`.
5. Expose that prefix through an R2 custom domain or public development URL.
6. Configure CORS for `GET` and `HEAD` from the branch-preview and production
   origins. Do not allow write methods from browsers.
7. Set `dist/city-config.json` `base` to the absolute public release URL ending
   in `/`, commit it on the release branch, and verify the preview.
8. Check the response headers and content type for the manifest, `.bin` files
   and JSON tiles. Cache versioned objects for a long duration; keep the small
   configuration file short-lived.
9. Promote only after a desktop/mobile smoke test. Rollback consists of pointing
   `city-config.json` at the previously validated immutable prefix.

The public Photon endpoint is explicitly a demo service without an SLA. Cache
search responses in the browser, debounce input, and migrate to a contracted or
self-hosted geocoder before sustained production traffic.
