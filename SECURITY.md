# Security policy

## Supported version

Only the current production release on `main` is supported.

## Reporting

Do not publish credentials, private source data, precise personal locations or security-sensitive logs in a public issue. Report a suspected vulnerability privately to the repository owner (GitHub: Reza-Bakhshi7), not in a public issue.

## Secrets

- Secrets belong in Cloudflare or GitHub secret stores, never in source files.
- Use scoped service tokens with the minimum permissions and an expiry or rotation date.
- Never share passwords, one-time codes or API tokens in chat, issues or documentation.
- Revoke credentials immediately when a maintainer leaves the project.

## Application privacy

Every route request sends start, destination, profile and time over verified HTTPS to the Sonnenpfad Oracle service, which keeps no access log and stores no routes. The API must allow the exact production origin; do not replace that allowlist with a wildcard. The application does not intentionally persist selected routes or device positions. Shared route URLs contain coordinates and must be treated as location data. External map and live-data providers receive normal network request metadata.

## Incident response

1. Stop or roll back the affected deployment.
2. Revoke exposed credentials.
3. Preserve relevant logs without copying unnecessary personal data.
4. Document impact, timeline and remediation.
5. Release and verify the fix before restoring normal operation.

