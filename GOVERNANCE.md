# Governance

Sonnenpfad Stuttgart is an experimental MobiData BW/NVBW showroom data application. Concept and development are attributed to Mohammadreza Bakhshi. The product communication does not reference a master's thesis.

## Responsibilities

| Role | Current responsibility |
| --- | --- |
| Product owner | Mohammadreza Bakhshi until a formal NVBW handover |
| Technical maintainer | Mohammadreza Bakhshi |
| Backup administrator | To be assigned from NVBW/MobiData BW |
| Data owner | Determined per source dataset; no ownership is implied by this repository |

The backup administrator must have access to the GitHub repository and the Cloudflare project before production ownership is transferred.

## Decision process

- Product and data-policy decisions require the product owner or an appointed NVBW successor.
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

The handover checklist is maintained in `docs/access-and-secrets.md`. No shared password or personal API token may be used as the continuity mechanism.

