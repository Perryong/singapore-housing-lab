# Commute tab — bus routes and MRT detail (design)

Approved direction in chat 2026-10-16, building on `2026-10-15-commute-lens-design.md`. Adds the *kind* of view
BusRouter SG and RailRouter SG offer (stops → services → whole route; lines, stations, exits), but kept unit-first
and inside BTOlab's own 3D scene and Commute tab. No code, data or visual style is taken from those projects: bus
data comes from LTA DataMall, shapes and exits from OpenStreetMap.

## Decisions
| Decision | Why |
|---|---|
| Shown in the 3D scene and the Commute tab | Uses BTOlab's 3D view; a separate network map would be a BusRouter clone. |
| Routes follow roads (OSM `route=bus` relations), straight stop-to-stop fallback | Straight lines cut through blocks in 3D. OSM has 596 of LTA's 601 services. |
| Per-project `transit.json` + shared `web/rail.json`, fetched when Commute opens | Keeps first load and Lighthouse unchanged; island-wide bus shapes would be MBs. |
| Operating lines only | Same allowlist as the hub-time routing (`OPEN` in `tools/build_commute.py`); future lines out of scope. |
| Static only | As in the first spec: no live arrivals or crowding. |

## What the user sees
- **Commute tab**, after the hub table and before the reach map: **Bus stops near Blk X** — every stop within 500 m
  of the shown block (the selected stack's block, else `near`), nearest first, each with its LTA name, code, distance,
  walk minutes and one chip per service running at 08:00.
  - Tapping a chip selects that service: a **service card** under the stop shows `<no> · <origin> → <destination> ·
    <n> stops`, "Here <first>–<last>", and "every <band> min at 8 am" (AM-peak band). Tapping the chip again, or
    another stop, clears it.
  - The selected route is drawn **blue on the island map** and as a **blue ribbon on the 3D ground**.
- **Island map** (the existing reach SVG): adds the operating MRT/LRT lines in LTA colours under the hubs, and the
  selected bus route with small stop dots and "from <origin>" / "to <destination>" labels. Legend line:
  "15/30/45 min reach · coloured lines = MRT · blue = selected bus".
- **Nearest stations** list (in the tab, under the stops): each station within 1 km, its line chips and the walk to
  its nearest exit. Tapping one opens the **station card**: for each line, `‹ previous · next ›` station names, the
  hubs reachable on that line with no change, and every exit sorted by walk time from the shown block
  ("A 8′ · C 8′ · E 9′ …", "Nearest: Exit A, 540 m").
- **3D scene**:
  - Bus stop pins already shown become tappable: tapping one switches to the Commute tab and scrolls to that stop.
  - **Exit pins** for stations within 1 km: red, "Exit A · 8′" (walk minutes from the shown block). Tapping one opens
    that station's card. Shown only while the Commute tab is open, so the Sun view stays uncluttered.
  - The selected bus route as a blue ribbon a little above the ground, clipped to the scene's 1.5 km.
- Footer and credits unchanged apart from the existing OSM and LTA lines.
- Phone: the same content in the single-column panel; pins work by tap.

## Data
- `tools/fetch_transit.py` additionally writes (git-ignored, `reference/transit/`):
  - `osm_bus.json`: OSM `route=bus` relations in Singapore with member ways' geometry and member stops
    (`out geom`; User-Agent header as `tools/geocode_resale.py`; retry on the second Overpass mirror like
    `tools/fetch_surround.py`).
  - `osm_rail.json`: OSM `route=subway|light_rail|train` relations for operating lines, with geometry.
- `tools/build_commute.py` additionally writes:
  - `projects/<id>/transit.json`:
    ```json
    {"stops":[{"code","name","x","z","walk":{"<blk>":min},"svc":["88","13",...]}],
     "services":{"88/1":{"no":"88","from":"Pasir Ris Int","to":"Toa Payoh Int","n":51,"band":"08-12",
                  "times":{"52031":["06:24","00:30"]},"path":[[x,z],...],"stopPts":[[x,z],...],"road":true}},
     "stations":[{"name","codes":["NS17","CC15"],
                  "lines":[{"code":"NS17","prev":"Ang Mo Kio","next":"Braddell","hubs":["Raffles Place"]}],
                  "exits":[{"exit":"A","x","z","walk":{"<blk>":min}}]}]}
    ```
    `stops` within 500 m of any block (site centre for upcoming projects); `services` keyed `<no>/<direction>`,
    only the direction serving a listed stop; `path` in local x/z metres, simplified with `simplify` at 25 m;
    `road:false` when no OSM relation matched and the path is stop-to-stop. `stations` within 1 km.
  - `web/rail.json`: `{"<prefix>": {"colour":"#D42E12","paths":[[[x,z]...]]}}` in **lat/lon** (shared across
    projects; the browser projects it with the same formula as `local_xz`), simplified at 50 m.
- **Matching OSM to LTA**: a relation matches service `<no>/<dir>` when `ref == no` and its first/last stop are
  nearest to LTA's first/last stop for that direction (≤ 300 m each); otherwise fall back to stop-to-stop.
- Budgets (tests): `transit.json` ≤ 120 KB, `rail.json` ≤ 80 KB.

## Browser
- `web/transit.js` (pure, no three.js): `stopsHtml(T, blk, sel)`, `serviceCard(T, key, stopCode)`,
  `stationCard(T, name, blk, hubs)`, and SVG helpers `railSvg(R, project)` / `routeSvg(svc)` used by `reachSvg`.
- `web/commute.js`: `commuteHtml` takes the optional transit data and selected service/station and inserts the
  sections; `reachSvg` draws rail lines and the selected route.
- `web/app.js`: on first Commute open, fetch `transit.json` and `rail.json` (once per page; on failure the tab shows
  the existing content plus "Bus and MRT details unavailable"). Selection state `selSvc`, `selStation`. Exit pins and
  the route ribbon are a three.js group shown only while `rtab === 'commute'`; reuse `makeLabel` and the amenity
  sprite click handling.

## Error handling
- No `transit.json` (older build, fetch error): tab works as today, with the one-line notice.
- A service with no OSM match: drawn stop-to-stop, card says "route shape approximate".
- A stop with no service running at 08:00 is not listed (as in the first spec).

## Testing
- `test/commute_test.py`: OSM/LTA matching on a toy relation (match within 300 m; mismatch falls back to
  `road:false`); `transit.json` shape and budget for every project; `rail.json` contains only operating prefixes.
- `test/commute_ui_test.mjs`: stops list nearest-first for the shown block; chip toggles the service card; station
  card prev/next and exits sorted by walk; every LTA/OSM string escaped; missing `T` shows the notice.
- Playwright (system Chrome) screenshots at 1280 and 390 px with a service and a station selected, no console errors.

## Out of scope
Live arrivals and crowding, future lines, exploring stops outside the project, platform/indoor layouts.
