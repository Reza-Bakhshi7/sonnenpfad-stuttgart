# Operations runbook

## Production

- Application: `https://sonnenpfad-stuttgart.de/`
- Cloudflare alias: `https://sonnenpfad-stuttgart.mohammadreza-bakhshi.workers.dev/`
- Source: GitHub repository `Reza-Bakhshi7/sonnenpfad-stuttgart`
- Production branch: `main`
- Build: `npm run build`
- Deploy: `npx wrangler deploy`

## Routine verification

1. Confirm GitHub Actions completed successfully for the deployed commit.
2. Open the production URL in a WebGL-capable browser.
3. Confirm the Stuttgart basemap and pilot data load.
4. Calculate a named-place route for Direct, Shade and Sun.
5. Check the elevation profile and 2D/3D switch.
6. Confirm that 2D stays shadow-free; switch to 3D, move the time slider and confirm one shadow update after release.
7. Switch between German and English.
8. Check a narrow mobile viewport.

## Failure modes

| Symptom | First check | Response |
| --- | --- | --- |
| Blank or old site | Cloudflare deployment and browser cache | Verify deployed commit; retry without cached assets |
| Data loading error | `dist/data/manifest.json` and chunk requests | Rebuild chunks and redeploy |
| Map unavailable | WebGL and external basemap request | Show the device-specific message; verify hardware acceleration |
| Routing unavailable | Worker console error and engine test | Roll back or repair the worker bundle |
| Basemap unavailable | OpenFreeMap availability | Keep atlas layers usable and display the existing warning |

## Incident record

Record start/end time, affected version, user impact, evidence, mitigation, root cause and follow-up action in a GitHub issue without including secrets or unnecessary personal data.

## Custom-domain Standard routing repair

The current browser calls the legacy Oracle HTTPS `/route` endpoint directly. It requires `Access-Control-Allow-Origin: https://sonnenpfad-stuttgart.de` on the API response. The old workers.dev origin alone does not cover the custom domain.

`scripts/repair_custom_domain_cors.py` is an administrator-run Oracle repair. It recognises only an explicit Nginx `map $http_origin` entry for the existing workers.dev origin; adds the exact custom domain without removing existing origins; saves a root-only backup; checks `nginx -t`; reloads Nginx; and validates a real HTTPS route response and its CORS header. Unsupported configuration is left untouched and reported. A failed verification restores the original configuration and reloads it. No database writes, API replacement or profile-capability change is performed. Run this reviewed script with system Python and sudo on the Oracle VM; it is not part of the Cloudflare build. Keep its backup on the VM.

Cloudflare Workers cannot fetch an IP-address URL directly (see https://developers.cloudflare.com/workers/platform/known-issues/#fetch-to-ip-addresses). A future same-origin proxy requires a real API hostname with a valid certificate first. The IP-based proxy preview was not promoted.

Keep production port 8000 and the test profile API on 8001 separate. Passing self-tests alone does not replace database integration checks or make the versioned profile API production-ready.
