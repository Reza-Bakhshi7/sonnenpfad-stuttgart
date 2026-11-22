# Admin area

`https://sonnenpfad-stuttgart.de/admin/` (link "Verwaltung" in *About Sonnenpfad*).

## Protection

1. **Login with password and TOTP code** (any authenticator app: Google/Microsoft Authenticator, 2FAS, Aegis …).
   One admin account only, no registration. The password is stored as a PBKDF2-SHA256 hash, the TOTP key and a
   session key as Cloudflare Worker secrets — never in the repository, the page or a log.
2. Every code works once (replay refused); 5 failed logins from one address or 20 overall within 15 minutes lock
   the login for 15 minutes; failures and logins are logged with a daily hashed address (no IP address).
3. Session: signed `__Host-` cookie (HttpOnly, Secure, SameSite=Strict), ends after 30 minutes without activity or
   8 hours at most; logout revokes it on the server. Every `/admin` page and `/api/admin/*` call is checked by the
   Worker; without configuration the area stays closed (503).
4. Login, logout and settings need same-origin JSON with a custom header (CSRF); all values are validated; the
   dashboard writes text only with `textContent` (no HTML injection); `X-Frame-Options: DENY`, no caching.

Worker secrets: `ADMIN_PASSWORD_HASH`, `ADMIN_TOTP_SECRET`, `ADMIN_SESSION_KEY`, `OPS_TOKEN`.

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
timing log) and the backup result, then posts it to `https://sonnenpfad-stuttgart.de/api/ops` with the `X-Ops-Token`
header (otherwise 404). The Worker keeps only the latest report in D1; after 15 minutes without one the dashboard
shows an outage. The server has to report itself because a Worker cannot fetch a bare IP address (Cloudflare error
1003). The token lives in `/etc/sonnenpfad-ops/token` (root only) and as the Worker secret `OPS_TOKEN`.

## Controls

- Maintenance mode: visitors see a maintenance page; admin stays reachable.
- Emergency browser routing: overrides `serverRouting` in `/city-config.json` without a Git change.
- Statistics retention.

## One-time setup (owner, in a terminal in the repository folder)

```sh
npx wrangler login
npm run admin-setup
```

The script creates the free D1 database `sonnenpfad-platform`, applies the migrations, asks for the new admin
password (hidden), shows the TOTP key for the authenticator app, checks a current code and stores the secrets
(including the server-health token, read from the VM without being shown). It adds the database binding
to `wrangler.jsonc`; that change is then published like any other release.

To change the password or the authenticator later, run `npm run admin-setup` again.
