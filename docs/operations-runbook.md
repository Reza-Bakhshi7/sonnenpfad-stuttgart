# Operations runbook

## Production

- Application: `https://sonnenpfad-stuttgart.de/`
- Cloudflare alias: `https://sonnenpfad-stuttgart.mohammadreza-bakhshi.workers.dev/`
- Source: private GitHub repository `Reza-Bakhshi7/sonnenpfad-stuttgart`
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

## Standard routing on the custom domain

The browser calls `/api/route` on its current origin. The Cloudflare Worker validates bounded Stuttgart coordinates and the shortest/segment-metadata contract, then forwards only allowlisted parameters to `https://138.2.184.1/route`. Both TLS connections retain certificate validation. No client credentials or upstream cookies are forwarded and route responses use `Cache-Control: no-store`. The legacy Oracle API on port 8000 remains active. The profile test service on port 8001 must not replace it until the versioned contract is integrated and accepted.

If Direct fails, check that the response from `/api/route` is JSON, not the SPA HTML fallback. Then check the Worker build and fixed upstream availability. A 504 means the 12-second proxy deadline expired. Do not disable TLS validation or advertise unimplemented profile capabilities.

Rollback: revert the 0.13.1 pull request to restore commit `dbee3295afc0cc429d8f9b1d23fa95bd6c342227`; the previous direct cross-origin route path still needs the custom domain in the Oracle CORS allowlist.
