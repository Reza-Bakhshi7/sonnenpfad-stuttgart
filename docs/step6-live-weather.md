# Step 6: live weather and cloud-aware sun/shade routing

## Scope

The Step 6 preview adds a weather adapter without changing the pedestrian-atlas safety model. The UI clearly separates three sources:

1. atlas themes such as snapshot UTCI and relative wind exposure;
2. geometric building/tree shadows calculated for the selected sun position;
3. an hourly weather-model forecast for a fixed central-Stuttgart reference point.

## Source and licence

The browser requests the Open-Meteo Forecast API for 48.778 N, 9.180 E. No API key is committed or required for the non-commercial prototype. Weather data is attributed to Open-Meteo under CC BY 4.0. The free endpoint has rate limits and no availability guarantee; a paid, self-hosted or institutionally approved service is required if the app becomes commercial or high-traffic.

The request contains a fixed Stuttgart coordinate, requested variables and ordinary HTTP metadata. Route endpoints and device location are never sent to the weather provider.

## Variables and time semantics

The adapter requests hourly temperature, apparent temperature, WMO weather code, total cloud cover, 10 m wind speed/direction/gusts, direct radiation, shortwave radiation and extraterrestrial/terrestrial reference radiation. The UI states:

- that values are model output, not station measurements;
- the forecast-valid hour;
- the browser retrieval time;
- whether a cached fallback is being shown.

The API does not expose a dependable model issue timestamp in this response, so the UI does not invent one. A selected hour is matched only within 31 minutes. Dates outside the returned forecast window use the documented clear-sky fallback.

## Cloud-aware routing rule

The geometric shadow share of every edge remains unchanged. Weather modifies only the optional sun/shade preference:

```text
solarWeight = clamp(direct_radiation_Wm2 / 500, 0, 1)
edgeCost = length * (1 + 1.6 * undesiredExposure * solarWeight + otherProfileCosts)
```

At zero direct radiation, sun/shade preference falls back to direct distance while mobility restrictions, surface costs, slope rules and uncertainty penalties stay fully active. At 500 W/m² or more, the previous sun/shade penalty is fully active. This is a transparent prototype heuristic, not a physiological heat model.

In 3D, the shadow raster opacity uses the same factor (0.16 to 0.55). The faster 2D map does not draw or calculate a map-wide shadow raster. Clouds do not change building or tree geometry and are not drawn as spatially varying polygons.

## Cache and failure behaviour

- successful responses are cached in `localStorage` for 10 minutes;
- if refresh fails, a cached response may be used for up to 6 hours and is marked as cached;
- after that, weather is unavailable and the clear-sky model remains usable;
- routing and map loading never depend on a successful weather response.

## Known limits

- one forecast grid/reference point represents all of Stuttgart;
- street-canyon wind and spatial cloud variation are not modelled;
- forecast accuracy and availability are not guaranteed;
- weather-aware preference is not UTCI, SOLWEIG or medical heat-risk advice;
- animated 3D clouds are not part of the first Step 6 preview.
