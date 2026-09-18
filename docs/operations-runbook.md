# Operations runbook

## Production

- Application: `https://sonnenpfad-stuttgart.mohammadreza-bakhshi.workers.dev/`
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
6. Move the time slider and confirm shadow changes.
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

