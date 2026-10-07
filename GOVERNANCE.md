# Governance

## Responsibilities

| Role | Current responsibility |
| --- | --- |
| Repository owner | Mohammadreza Bakhshi |
| Technical maintainer | Mohammadreza Bakhshi |
| Backup administrator | Not assigned |
| Data owner | Determined per source dataset; no ownership is implied by this repository |

## Decision process

- Product and data-policy decisions require the repository owner.
- Changes to routing costs, accessibility interpretation, scientific claims, privacy behaviour or source attribution require review in a pull request.
- Routine dependency, documentation and presentation changes may be merged after CI passes.
- Public releases require the checklist in `docs/release-process.md`.

## Repository policy

- `main` represents the deployed production state.
- Work is prepared on a focused branch and merged through a pull request.
- CI must pass before merge.
- Source GeoPackages, credentials and personal data must never be committed.
- Production incidents and material data-quality defects are recorded as GitHub issues.

## Continuity

The access checklist is maintained in `docs/access-and-secrets.md`. No shared password or personal API token may be used as the continuity mechanism.
