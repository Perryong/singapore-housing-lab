# 3D structures for map features (design)

Approved direction in chat 2026-10-17. Today the 3D scene draws the project's own blocks, ~270 surrounding HDB blocks,
malls and MRT station buildings; every other map feature is a flat pin. This adds real 3D structures for the features
that have their own building or area in OpenStreetMap, tints the ground floor of the building that hosts point-only
features, and lets the new buildings block sun in the unit calculation.

## Decisions
| Decision | Why |
|---|---|
| Real footprints from OSM, not stylised models | Accurate to the site, like the existing mall/MRT extrusions. |
| Extend `tools/fetch_surround.py` / `P.surround` | Reuses the offline pipeline and merged-mesh drawing that keep the scene at 120 fps. |
| Point-only features tint their host's ground floor | Clinics, supermarkets and preschools usually sit in an HDB void deck or a mall, which is already 3D. |
| New buildings also block sun | User's choice: nearby schools, CCs and hawker centres can shade units. Some units' sun hours change. |
| Within the scene's 1.5 km only | Matches the existing surroundings radius; features farther away stay pins. |

## Data (offline)
- `tools/fetch_surround.py` adds one Overpass query (same User-Agent and mirror handling as today) for, within 1.5 km of
  the site:
  - school buildings (`building=school`, and buildings inside an `amenity=school` area) → kind `school`; the campus
    area itself → `campus`;
  - `amenity=community_centre` → `cc`; `amenity=library` → `library`; `amenity=marketplace|food_court` (areas) →
    `hawker`; `amenity=hospital|clinic` areas and polyclinics → `health`; `leisure=park` → `park`.
- Each becomes an entry in `P.surround` with the existing shape `{k, h, p}` (simplified with the existing `simplify`,
  same 1.5 km centre rule).
- Heights: OSM `height` or `building:levels × 4 m` when present; otherwise school 12 m, cc 10 m, library 12 m,
  hawker 8 m, health 20 m. `campus` and `park` are ground areas of 0.2 m.
- A new outline that overlaps an HDB block, mall or MRT outline already in `P.surround` by more than 50% of its area is
  dropped (no double drawing).
- Host tint: each amenity in `P.amenities` with category `clinic`, `supermarket` or `preschool` gets
  `host: <index into P.surround>` for the HDB block or mall outline that contains its point, else the nearest such
  outline within 15 m; no `host` when none qualifies.
- Shading: the new building kinds (`school`, `cc`, `library`, `hawker`, `health`, not `campus`/`park`) within the same
  radius the sun calculation uses for neighbouring HDB blocks are added to that same blocker set, in the same
  representation, so the existing ray test treats them like neighbouring blocks.
- Rerun for all 30 projects; `project.json` stays inside the existing size budget test.

## Browser
- `buildSurround` draws the new kinds as merged extrusions in the amenity legend colours from `web/nearby.js` `ACAT`
  (school/campus green, cc teal, library purple, hawker brown, health magenta, park green); `campus` and `park` as flat
  tinted ground just above the map tiles.
- Host tint: for each amenity with a `host`, a 4 m tall ring in the category colour, 0.3 m outside the host outline,
  drawn under the existing pin. All tints for one category are one merged mesh.
- The existing "Surrounding buildings (1.5 km)" toggle shows/hides all of it; the amenities legend gains the new
  swatches.
- The "How it works" text and README's shading description say that schools, community clubs, libraries, hawker
  centres and health buildings near the site now block sun too.

## Testing
- Python: the new kinds are parsed from a small Overpass fixture (heights from tags and defaults; overlap drop; 1.5 km
  rule); host assignment (inside, within 15 m, none); new buildings appear in the shading blocker set and campus/park
  do not.
- Sun regression: for one project, record which units' sun hours change after adding the new blockers, and assert that
  every change is a decrease (new blockers can only remove sun).
- JS: `buildSurround` returns one mesh per present kind; host rings are built only for amenities with a valid `host`.
- Performance: frame rate and `project.json` size budgets unchanged (existing tests).
- Playwright screenshots at 1280 and 390 px of a project with a school, a CC and a hawker centre nearby.

## Out of scope
Stylised models, bus stop shelters, estate facility models (playgrounds, pavilions), roofs/building detail,
features beyond 1.5 km.
