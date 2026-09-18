# Contributing

## Development flow

1. Create a focused branch from `main`.
2. Make the smallest coherent change.
3. Run `npm ci` and `npm test`.
4. Update documentation and `CHANGELOG.md` when behaviour changes.
5. Open a pull request using the repository template.
6. Merge only after CI succeeds and review requirements are satisfied.

## Commit conventions

Use an imperative summary, for example `Improve WebGL failure message` or `Add weather adapter tests`.

## Data changes

- Treat the source GeoPackage as read-only.
- Record source, licence, retrieval date, CRS, spatial coverage and transformations.
- Export only fields required by the application.
- Validate geometry counts, bounds, identifiers and routing connectivity.
- Never commit the source GeoPackage or unreviewed personal data.

## Definition of done

A change is complete when tests pass, user-visible text is available in German and English, attribution is preserved, failure behaviour is documented and the change can be rolled back.

