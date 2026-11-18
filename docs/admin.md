# Admin area

`https://sonnenpfad-stuttgart.de/admin/` (link "Verwaltung" in *About Sonnenpfad*).

## Protection

1. **Cloudflare Access** in front of `/admin*` and `/api/admin/*`: only the owner's e-mail address, login via GitHub
   (GitHub's two-factor authentication applies) or one-time PIN; session limit set in Access.
2. **Worker check** (`services/platform.mjs`, `verifyAccess`): every admin request is verified again — RS256
   signature against the Access certificates, audience, issuer, expiry and e-mail. Without configuration the area
   stays closed (503); failed attempts are logged (hashed, no IP address).
3. Settings changes need same-origin JSON with a custom header (CSRF), all values are validated; the dashboard
   writes text only with `textContent` (no HTML injection); `X-Frame-Options: DENY`, no caching.
4. The dashboard logs out after 30 minutes without interaction.

No credential is stored in the repository or the page. Worker secrets: `ADMIN_EMAIL`, `ACCESS_TEAM_DOMAIN`,
`ACCESS_AUD`, `OPS_TOKEN`; variable `OPS_URL`.

## Usage statistics (privacy)

The app sends anonymous events to `/api/event` (`scripts/usage.mjs`) on the production hosts only, never with Do Not
Track or Global Privacy Control. Stored in Cloudflare D1 (`migrations/0001_platform.sql`):

- `counts`: daily totals per event and dimension (feature names, districts, 1 km map cells, device class, browser and
  system family, language, hour, weekday) — no IP addresses, locations, route points or user agents.
- `visitors`: for the current day only, a hash of a random daily salt + IP + browser. Every night (Worker cron) it
  becomes plain numbers (visitors, sessions, duration) and is deleted together with the salt. Returning visitors
  across days are therefore not measurable — by design.
- Retention of daily totals: 760 days by default, adjustable in the dashboard (30–760).

Nothing is stored on the visitor's device, so no consent banner is needed (§ 25 TDDDG); the short processing of the
IP address for the daily estimate rests on legitimate interest (Art. 6 (1) f GDPR). The privacy text in the About
dialog describes this; have it checked legally before relying on it.

## Server health

`/usr/local/sbin/sonnenpfad-metrics` (every 5 minutes, [ops/metrics](../ops/metrics)) writes CPU, memory, disk,
network, uptime, services, database size and connections, routing-API requests, latency and errors (from an IP-free
timing log) and the backup result. Nginx serves it at `https://138.2.184.1/ops/metrics` only with the `X-Ops-Token`
header (otherwise 404); the token lives in `/etc/sonnenpfad-ops/token` (root only).

## Controls

- Maintenance mode: visitors see a maintenance page; admin stays reachable.
- Emergency browser routing: overrides `serverRouting` in `/city-config.json` without a Git change.
- Statistics retention.

## One-time setup

1. `npx wrangler login` (owner signs in in the browser).
2. `npx wrangler d1 create sonnenpfad-platform` → add the binding `DB` with its id to `wrangler.jsonc`,
   then `npx wrangler d1 migrations apply sonnenpfad-platform --remote`.
3. Cloudflare Zero Trust → Access → Applications → *Self-hosted*: domain `sonnenpfad-stuttgart.de`, paths `admin`
   and `api/admin`; policy *Allow* for the owner's e-mail; login method GitHub (or one-time PIN). Copy the
   *Application Audience (AUD) tag* and the team domain (`<team>.cloudflareaccess.com`).
4. Secrets (values are typed or piped, never printed):
   `npx wrangler secret put ADMIN_EMAIL`, `… ACCESS_TEAM_DOMAIN`, `… ACCESS_AUD`,
   `ssh sonnenpfad-vm 'sudo cat /etc/sonnenpfad-ops/token' | npx wrangler secret put OPS_TOKEN`;
   variable `OPS_URL` = `https://138.2.184.1/ops/metrics` in `wrangler.jsonc` (`vars`).
