# Commute tab — door-to-hub times and reach map (design)

Approved direction in chat 2026-10-15: a unit-first "commute lens", inspired by the *idea* of RailRouter SG and
BusRouter SG (cheeaun) but not a network explorer. No code, data or visual style is reused from those projects:
transit data comes straight from LTA, and every view starts from the selected unit, not from the network.

## Goal
For a BTO unit, answer "how well connected is my front door?": door-to-door times to five fixed hubs, how far you can
get in 15/30/45 minutes, and which buses stop nearby. Every project is measured the same way, so projects compare.

## Decisions
| Decision | Why |
|---|---|
| Static only, no live arrivals | Most of these BTOs complete in 2029–2031; today's arrivals mean nothing. The site stays static with no API key in the browser. |
| One scenario: weekday 8 am | The commute that matters for most buyers; one number per hub keeps projects comparable. |
| Precompute offline in Python | Same rule as the Blender models: the browser downloads results, not a graph (the bus graph alone would break the ~1 MB/project budget). |
| LTA DataMall, not `sgbusdata` | Keeps the data pipeline independent of the RailRouter/BusRouter author. |
| Reach map is 2D in the panel | The 3D scene covers 1.5 km; the 45-min outline is 10+ km. |

## What the user sees
- The right panel gets a third tab, **Commute**, after Sun and Value.
- **Door to hub, weekday 8 am**: a table with one row per hub — Raffles Place, one-north, Changi Airport, Jurong East,
  Woodlands — showing minutes and the legs as chips (`walk 7 › NS › walk 2`; rail chips in LTA line colours, bus chips
  blue with the service number).
  - Times are for the selected stack's block. With no selection: the block nearest the site centre, with the note
    "Pick a unit to see its block". Upcoming projects (no blocks): the site centre, labelled "from the site centre".
- **Reach map**: inline SVG, north up, 15/30/45-min outlines shaded in the accent colour, hubs as dots with their
  times, the site as a diamond. Has a text alternative ("Within 30 min: Raffles Place, Woodlands, …").
- **Nearest bus stops**: up to 4, each with its LTA name, distance and walk time, service numbers, and the weekday
  first/last bus of each service at that stop.
- Footer: "Estimated from LTA timetables and service frequencies, not live data; times are to the hub's MRT
  platform; real trips vary."
- The left panel's amenity list shows bus stop names instead of "Bus stop 53419".
- Phone (≤820 px): the tab is a single column like Value; the SVG scales to the panel width.

## Data
- `reference/transit/` (git-ignored like other raw data), fetched by `tools/fetch_transit.py`:
  - LTA DataMall `BusStops`, `BusRoutes`, `BusServices` (paged, 500 rows a call). Key from env `LTA_KEY`; used only
    offline, never shipped.
  - Rail: existing `reference/amenities/stations.raw` (station codes such as `NS17`, exits with coordinates).
- Rail order: stations sorted by number within each line prefix. A small table in the tool covers what numbering
  cannot: CG (Tanah Merah → Changi Airport branch), CE (Promenade → Marina Bay), and the BP, SK, PG LRT loops.

## Pipeline: `tools/build_commute.py projects/<id> [...]`
Standard library only, like the other tools. Reuses `local_xz` (`tools/fetch_context.py`) and `simplify`
(`tools/fetch_surround.py`).

1. **Graph** (built once per run, all-island):
   - Bus: consecutive stops of each service and direction; ride time = `Distance` difference ÷ 18 km/h.
   - Rail: consecutive stations on each line; ride time = straight-line distance ÷ 40 km/h + 30 s dwell.
   - Transfers: walk between any stops/station exits ≤ 400 m apart, at 80 m/min × 1.3 (same as `walkMin`);
     changing lines inside one station costs 2 min.
   - Waiting when boarding: half the headway. Bus headway = midpoint of the `AM_Peak_Freq` band (e.g. "06-09" → 7.5,
     so a 3.75 min wait); MRT 3 min, LRT 4 min (`shortcut:` comments). Services whose weekday first bus is after
     08:00 or last bus before 08:00 are dropped.
2. **Search**: Dijkstra from each origin (each block's centre; the site centre for upcoming projects), with an initial
   walk to every stop/station exit ≤ 500 m. The state is (node, current service), so staying on a bus or train costs
   no extra wait. Cut off at 60 min.
3. **Hubs**: fixed points — Raffles Place, one-north, Changi Airport, Jurong East, Woodlands MRT stations. Time =
   earliest arrival at that station; the trip ends on the platform, so the footer reads "…times are to the hub's
   MRT platform".
4. **Reach** (site centre only): every node reached at time t contributes a disc of radius `(T − t) × 80 / 1.3` m for
   T in 15/30/45; rasterise onto a 100 m grid, trace each outline, `simplify` it to ~50 m, store in local x/z metres.
5. **Stops**: the 4 nearest bus stops to the site centre, with LTA description, services, and first/last bus.
6. Writes `project.json["commute"]`:
   ```json
   {"asOf":"2026-10","at":"weekday 08:00",
    "hubs":{"<blk>":[[minutes,[["walk",7],["rail","NS"],["walk",2]]], ...5 in hub order]},
    "reach":{"15":[[[x,z],...]],"30":[...],"45":[...]},
    "hubPts":[["Raffles Place",x,z],...],
    "stops":[{"code":"53419","name":"...","d":75,"svc":[["88","05:41","00:23"],...]}]}
   ```
   `hubs` is keyed by block (`"site"` for upcoming projects); an unreachable hub is `null`. It also renames bus entries
   in `P.amenities` to their LTA name.

## Browser
- `web/commute.js` (pure, no three.js): `commuteHtml(P, stacks, selStack)` and `reachSvg(C)`. Exports `LINE` and
  `lineChips` from `nearby.js` instead of copying them.
- `web/index.html`: a `data-t="commute"` button in `.rtabs`, and `<div id="commutePanel" hidden>`.
- `web/app.js`: `applyRTab()` hides the Sun content for `commute` as it does for `value`, and shows `#commutePanel`;
  `select`/`clear` call `renderCommute()` when the tab is open. Projects with no `P.commute` show
  "No commute data for this project."
- `web/style.css`: a few rules for leg chips and the SVG; reuses `.line`, `.rtable`, `.unit-meta`.

## Testing
- `test/commute_test.py`:
  - Toy network (2 rail lines, 1 bus route, 1 interchange): exact expected times for a direct ride, a transfer
    (+2 min), a bus boarding (+half the headway), and a destination past 60 min (`null`).
  - Real data: Bishan Terraces → Raffles Place within 22–30 min.
  - Every project's `commute` block ≤ 40 KB.
- `test/commute.test.mjs`: `commuteHtml` with no selection, a selected stack, an upcoming project, and no
  `P.commute`; hub and stop names are escaped.
- Both run under the existing `npm test` loop; the CI size budget is unchanged.
- After building: Playwright screenshots of the tab at 1280 px and 390 px.

## Out of scope
Live arrivals and crowding, user-chosen destinations, departure times other than weekday 8 am, station exits and
indoor layouts, a network-wide map.
