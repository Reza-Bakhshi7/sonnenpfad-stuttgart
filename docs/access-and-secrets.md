# Access and secrets runbook

## Current access responsibility

1. Mohammadreza Bakhshi is the current repository and deployment account owner.
2. A backup administrator is not assigned.

Shared accounts are not permitted.

## Access inventory

| System | Purpose | Minimum backup access | Current state |
| --- | --- | --- | --- |
| GitHub repository | Source, issues, CI and releases | Maintain/admin only when required | Owner configured; backup not assigned |
| Cloudflare project | Builds, deployment and domains | Administrator or scoped deployment role | Owner configured; backup not assigned |
| External data providers | Future weather and traffic feeds | Read-only service credential where required | Not configured |

## Secret rules

- Prefer services that do not require a client-side secret.
- Store server-side credentials as encrypted platform secrets.
- Store CI-only credentials as GitHub Actions secrets.
- Document only the secret name, owner, purpose and rotation date; never the value.
- Review access every three months and whenever responsibilities change.

## Continuity checklist

- [ ] A backup administrator is named only when needed.
- [ ] The backup administrator uses an individual account.
- [ ] Required GitHub and deployment access is granted with minimum permissions.
- [ ] Recovery and billing contacts are controlled by the current account owner.
- [ ] Deployment, rollback and incident procedures are rehearsed.
- [ ] Credentials are updated whenever responsibility changes.
