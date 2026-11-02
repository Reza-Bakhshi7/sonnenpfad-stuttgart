# Access and secrets runbook

## Responsibility and access

Mohammadreza Bakhshi owns and administers the GitHub repository, Cloudflare project and Oracle routing service. Any future backup access is assigned by him through individual accounts. No institutional handover is assumed.

## Secret rules

- Prefer services that do not require a client-side secret.
- Store server-side credentials as encrypted Cloudflare secrets.
- Store CI-only credentials as GitHub Actions secrets.
- Document only the secret name, owner, purpose and rotation date; never the value.
- Review access every three months and whenever responsibilities change.

## Optional future handover

- The owner chooses the recipient and scope.
- Use separate accounts and scoped permissions.
- Verify deployment and rollback access before changing responsibilities.
- Retain owner-controlled recovery and billing contacts.
