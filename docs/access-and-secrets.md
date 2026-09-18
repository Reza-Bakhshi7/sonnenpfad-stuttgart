# Access and secrets runbook

## Required administrators

Two individually named administrators are required before organizational handover:

1. Mohammadreza Bakhshi.
2. One NVBW/MobiData BW backup administrator (not yet assigned).

Both administrators need access to the private GitHub repository and the Cloudflare project. Shared accounts are not permitted.

## Access inventory

| System | Purpose | Minimum backup access | Current state |
| --- | --- | --- | --- |
| GitHub repository | Source, issues, CI and releases | Maintain/admin according to NVBW policy | Owner configured; backup open |
| Cloudflare project | Builds, deployment and domains | Administrator or scoped deployment role | Owner configured; backup open |
| External data providers | Future weather and traffic feeds | Read-only service credential where required | Not configured |

## Secret rules

- Prefer services that do not require a client-side secret.
- Store server-side credentials as encrypted Cloudflare secrets.
- Store CI-only credentials as GitHub Actions secrets.
- Document only the secret name, owner, purpose and rotation date; never the value.
- Review access every three months and whenever responsibilities change.

## Handover checklist

- [ ] Backup administrator named and invited to GitHub.
- [ ] Backup administrator named and invited to Cloudflare.
- [ ] Backup administrator confirms access using their own account.
- [ ] Recovery and billing contacts are organizationally controlled.
- [ ] Deployment, rollback and incident procedures are rehearsed.
- [ ] Personal credentials are removed when Mohammadreza Bakhshi leaves the role.

