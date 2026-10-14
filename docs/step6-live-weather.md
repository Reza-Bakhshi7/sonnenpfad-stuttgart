# Weather service — version 0.12

The weather display is a model forecast for a fixed central Stuttgart reference
point (48.778 N, 9.180 E), separate from Atlas UTCI and wind-exposure snapshots.
It is not a street-level observation or a medical heat-risk model.

`/api/weather` is a same-origin Cloudflare Worker with a 10-minute shared cache.
A stale but usable forecast is returned immediately while the Worker refreshes
in the background. Valid data is retained for up to 48 hours, with its original
retrieval timestamp and a visible cached marker. Browser local storage provides
another cache; refresh never clears existing values.

Open-Meteo is the primary source. Its DWD endpoint is tried after primary failure;
MET Norway Locationforecast starts after 1.8 seconds if the primary has not yet
returned. The first valid response wins, with a bounded upstream timeout and
identifiable application User-Agent for MET. The service respects MET's supplied
Expires time. Concurrent requests within an isolate share an upstream job.

The browser retries on reconnect, return to the foreground and after failed
refreshes. Routing and map display never wait for weather. In a total provider or
network outage, no temperatures or live radiation are invented; valid saved data
remains visible, otherwise the service retries and the clear-sky routing model
remains usable. Neither provider offers unconditional availability.

Open-Meteo direct radiation scales the optional sun/shade preference by
`clamp((directRadiation - 40) / 450, 0, 1)`. MET has no compatible direct-radiation
field in the compact response: that value stays null, and a labelled cloud-cover
heuristic `(1 - cloudCover / 100) ** 1.5` supplies optional solar influence. This
never changes mobility exclusions or Atlas heights. Coarser MET forecast hours
are shown with their actual validity time, rather than relabelled as measurements.

Both sources use CC BY 4.0 and are credited in the app. Validity/retrieval time,
source, cloud estimation and cached state are visible in the weather details.
No route endpoints or device location are sent to either weather provider.

Tests cover both provider contracts, Berlin time conversion, missing values,
independent fallback, fresh/stale shared cache, client cache paint before fetch,
and retention during failure. HTTP packaging is checked with Wrangler dry-run;
live endpoint behaviour and browser pixels require preview smoke testing.
