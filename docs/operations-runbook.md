# Operations runbook

## Production

- Application: `https://sonnenpfad-stuttgart.de/` (Cloudflare alias `https://sonnenpfad-stuttgart.mohammadreza-bakhshi.workers.dev/`)
- Source: `Reza-Bakhshi7/sonnenpfad-stuttgart`, branch `main`; Cloudflare Workers Builds runs `npm run build` and `npx wrangler deploy` on every push to `main`.
- Routing: Sonnenpfad server (Oracle Always Free VM) behind Nginx at `https://138.2.184.1/profile-v2/`; details, limits and the update procedure in [server-routing-release.md](server-routing-release.md).
- Weather: Cloudflare Worker `/api/weather` (`services/weather-worker.mjs`), Open-Meteo with MET Norway fallback.

## Routine verification

1. GitHub Actions passed for the deployed commit.
2. The About dialog shows the expected version on both hosts.
3. A route in Direct, Shade and Sun and in a mobility profile; the result shows walking time, distance and shade.
4. `https://138.2.184.1/profile-v2/health` answers `running` with `production_ready: true`.
5. 2D/3D switch, time slider, both languages and a narrow mobile viewport.

## Failure modes

| Symptom | First check | Response |
| --- | --- | --- |
| Routes fail with a server message | `/profile-v2/health`, VM state in the Oracle console | Restart the VM or the service; if it stays broken, switch to browser routing (below) |
| VM stopped by Oracle (idle reclamation) | Oracle console, instance state | Start the instance; the app routes in the browser while the server is unreachable at start-up |
| Blank or old site | Cloudflare deployment and browser cache | Verify the deployed commit; reload without cache |
| Map unavailable | WebGL and the OpenFreeMap request | Check hardware acceleration; another base map can be selected |
| Weather missing | `/api/weather` response | The app keeps working without weather; the providers recover on their own |

## Emergency: browser routing

Set `"serverRouting": false` in `dist/city-config.json` and merge to `main`. About a minute later every route is calculated in the browser on an identical copy of the server graph. Set it back to `true` once the server is healthy.

## Rollback

Revert the release on `main` or redeploy the previous tag; Cloudflare rebuilds automatically. Server updates roll back automatically when their checks fail, see [server-routing-release.md](server-routing-release.md).

## Incident record

Record start and end, affected version, user impact, evidence, mitigation, root cause and follow-up in a GitHub issue, without secrets or unnecessary personal data.
