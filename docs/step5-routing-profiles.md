# Step 5: Routing profiles, restrictions and accessibility

Status: implementation preview, 30 September 2026.

## Safety model

The app separates three concepts that must not be conflated:

1. **Known hard barrier:** an atlas attribute explicitly conflicts with the selected profile. The edge is removed before routing.
2. **Known but less suitable:** the edge remains available with a transparent cost penalty.
3. **Unknown:** the edge remains available so missing data cannot silently disconnect large parts of Stuttgart. It receives an uncertainty penalty and reduces the coverage shown in the route assessment.

The result wording is deliberately “known profile criteria satisfied”, never “barrier-free”. Point POIs such as barriers and raised/lowered kerbs are not topologically linked to a specific network edge. They are therefore reported as advisory features within a 12 m route corridor and are not used as hard exclusions.

## Presets

| Profile | Hard exclusions from known data | Soft preferences | Time assumption |
|---|---|---|---|
| Standard | none beyond the cleaned public pedestrian network | direct route | 75 m/min + 1 min per 10 m ascent |
| Manual wheelchair | stairs, escalators, poor surface, `wheelchair=no`, width below 0.90 m, absolute gradient above 6% | smoother, wider and better-classified ways | 60 m/min + 1.4 min per 10 m ascent |
| Power wheelchair | same explicit barriers, width below 0.90 m, absolute gradient above 10% | smoother and wider ways | 75 m/min + 0.5 min per 10 m ascent |
| Cane or walker | stairs, escalators, poor surface, width below 0.80 m, absolute gradient above 10% | gentle ways near benches and shelters | 50 m/min + 1.6 min per 10 m ascent |
| Blind or low vision | no categorical stair/escalator exclusion | supported signal crossings; handrails and tactile guidance on stairs; quieter pedestrian ways | 65 m/min + 1.1 min per 10 m ascent |
| Pushchair | stairs, escalators, poor surface, width below 0.90 m, absolute gradient above 12% | wider, gentler ways | 65 m/min + 1.2 min per 10 m ascent |

The 0.90 m and 6% values are traceable accessibility indicators, not a claim that this routing model implements DIN 18040-3 in full. The Bundesfachstelle Barrierefreiheit checklist treats usable widths below 0.90 m and path gradients above 6% as barriers for wheelchair use. The higher limits for power wheelchairs, walking aids and pushchairs are explicit prototype assumptions that require user and field validation.

Primary reference: [Bundesfachstelle Barrierefreiheit – Systematik zur Erfassung und zum Abbau baulicher Barrieren](https://www.bundesfachstelle-barrierefreiheit.de/SharedDocs/Downloads/DE/Veroeffentlichungen/checkliste-paragraf-8-bgg.pdf?__blob=publicationFile&v=5).

### Signal-crossing accessibility classes

The map keeps one `Signal crossings` layer control and renders its 4,261 points with the historical Pedestrian Atlas classification:

| Class | Exact atlas rule | Colour | City count |
|---|---|---:|---:|
| Good support | at least two of `traffic_signals_sound`, `traffic_signals_vibration`, `tactile_paving` equal `yes` | `#2E7D32` | 702 |
| Partial support | exactly one of the three fields equals `yes` | `#F9A825` | 1,216 |
| No documented support | all three fields explicitly equal `no` | `#C62828` | 251 |
| Unknown / incomplete | every remaining combination | `#9E9E9E` | 2,092 |

The popup reports those three class inputs plus wheelchair suitability, kerb form and button operation. The separate wheelchair fields are intentionally not used to change the historical colour class.

## Custom profile

Custom settings support independent hard filters for stairs, escalators, poor surfaces and explicit `wheelchair=no`, plus known-width limits of 0.80/0.90/1.20 m and known-gradient limits of 6/10/12/15%. Uphill/downhill/both remains a soft preference and is intentionally separate from the absolute hard gradient limit.

All custom state is included in the share URL.

## Route assessment

Each successful route returns and displays:

- maximum known uphill and downhill gradient;
- ascent and descent metres;
- share of route length with known surface, slope, width and wheelchair attributes where relevant;
- minimum known width;
- poor-surface share;
- stair and escalator segment counts;
- nearby barrier and kerb POIs in a 12 m advisory corridor;
- a warning when relevant data coverage is below 80%.

Estimated duration now uses the selected profile's documented speed and ascent assumptions. The distance comparison remains against the direct route under the same hard profile restrictions, so shade/sun preferences never override safety exclusions.

## Engine guarantees

- Hard exclusions apply during component building, endpoint snapping, partial-edge seeding, directional graph expansion and final-edge attachment.
- The Web Worker component cache key includes every hard restriction; changing profile criteria cannot reuse an incompatible connectivity cache.
- If an ordinary network connection exists but none satisfies the selected profile, the UI returns a dedicated `profileBlocked` message instead of incorrectly reporting the point as outside Stuttgart.
- Unknown attributes are never interpreted as proof that an edge is accessible.

## Data audit

The bundled city network contains 248,725 subedges. The Step 5 audit found 16,162 stair subedges, 143 escalator subedges, 23,529 poor-surface subedges, 695 explicit `wheelchair=no` subedges, 5,639 known widths below 0.90 m and 47,542 known slopes above 6%. Width is unknown on 195,319 subedges and surface on 91,360, which is why unknown values must remain visible and cannot safely be converted into hard exclusions.

## Verification

- `scripts/check_step5.mjs` verifies every hard barrier, unknown-data behavior, vision-profile stair behavior, assessment output and the dedicated blocked-profile error.
- `scripts/audit_step5_city.mjs` decodes the real 48-byte city edge contract, reports field coverage and checks that sample routes never contain an edge forbidden by their selected profile.
- `npm test` builds the production bundle and runs Step 5 together with all prior data, map, slope, mobility, engine and governance checks.

## Remaining validation work

- Conduct field checks with wheelchair/rollator users and accessibility specialists before any public safety claim.
- Topologically link barriers, kerbs, elevators and ramps to the correct network nodes/edges before using these point features as hard routing constraints.
- Validate the profile-specific time assumptions with observed travel data.
- Add turn-by-turn instructions only after crossings, entrances and multi-level topology are reliable.
