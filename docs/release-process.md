# Release process

## Release criteria

A production release requires:

- a focused pull request;
- successful `npm test` in GitHub Actions;
- review of German and English user-visible text;
- verified source attribution and licences for changed data;
- documented limitations and privacy impact;
- a rollback commit or previous release reference;
- a live smoke test after Cloudflare deployment.

## Versioning

- Patch: fixes without intended feature changes.
- Minor: backward-compatible features or data-coverage increments.
- Major: incompatible behaviour, public API or data-model changes.

While the product is experimental, versions remain below `1.0.0`.

## Procedure

1. Update `package.json` and `CHANGELOG.md`.
2. Run `npm ci` and `npm test` locally.
3. Open and review a pull request.
4. Merge after CI succeeds.
5. Confirm the Cloudflare production deployment.
6. Test page load, data load, routing, 2D/3D, time controls and both languages.
7. Create the GitHub release/tag for the merged commit.
8. Record any incident or rollback.

## Rollback

Revert the release pull request on `main`. Cloudflare will rebuild the restored state automatically. If automatic deployment is unavailable, redeploy the last verified commit through the documented Cloudflare project.

