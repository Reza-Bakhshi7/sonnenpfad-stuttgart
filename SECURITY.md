# Security policy

## Supported version

Only the current production release on `main` is supported.

## Reporting

Do not publish credentials, private source data, precise personal locations or security-sensitive logs in a public issue. Report a suspected vulnerability directly to the repository owner or the appointed NVBW technical administrator.

## Secrets

- Secrets belong in Cloudflare or GitHub secret stores, never in source files.
- Use scoped service tokens with the minimum permissions and an expiry or rotation date.
- Never share passwords, one-time codes or API tokens in chat, issues or documentation.
- Revoke credentials immediately when a maintainer leaves the project.

## Application privacy

Standard Direct routing sends selected endpoint coordinates over verified HTTPS to the Sonnenpfad Oracle service. Other profiles currently run in the browser. The API must allow the exact production origin; do not replace that allowlist with a wildcard. The application does not intentionally persist selected routes or device positions. Shared route URLs contain coordinates and must be treated as location data. External map and live-data providers receive normal network request metadata.

## Incident response

1. Stop or roll back the affected deployment.
2. Revoke exposed credentials.
3. Preserve relevant logs without copying unnecessary personal data.
4. Document impact, timeline and remediation.
5. Release and verify the fix before restoring normal operation.

