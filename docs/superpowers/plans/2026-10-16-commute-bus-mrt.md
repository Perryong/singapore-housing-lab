# Commute Bus Routes and MRT Detail Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bus stops → services → road-following route (island map + 3D ribbon), MRT exit pins in 3D, a station card,
and operating MRT/LRT lines on the island map, all inside the existing Commute tab.

**Architecture:** Offline: `tools/fetch_transit.py` also caches OSM bus and rail relations; `tools/build_commute.py`
matches OSM bus relations to LTA services and writes `projects/<id>/transit.json` plus a shared `web/rail.json`.
Browser: `web/transit.js` (pure HTML/SVG strings) renders stops, service card, station card, rail and route SVG;
`web/app.js` lazily fetches both files on first Commute open and drives selection and the 3D pins/ribbon.

**Tech Stack:** Python 3 (stdlib + existing numpy/OpenCV), plain ES modules, three.js (already loaded), `node:assert`.

**Spec:** `docs/superpowers/specs/2026-10-16-commute-bus-mrt-design.md` (builds on
`docs/superpowers/specs/2026-10-15-commute-lens-design.md`)

## Global Constraints
- **Do not commit.** The user forbade commits; leave all work in the working tree. Never read or print `.env`.
- No code, data or styling copied from cheeaun's BusRouter/RailRouter (or `sgbusdata`). Data: LTA DataMall + OSM.
- Static only: no live arrivals or crowding. Operating lines only: reuse `OPEN` from `tools/build_commute.py`.
- Overpass: `curl`/urllib with User-Agent `BTOlab/1.0 (personal project)`, alternate `https://overpass-api.de/api/interpreter`
  and `https://overpass.kumi.systems/api/interpreter` on failure (as `tools/fetch_surround.py`), bbox
  `(1.15,103.6,1.48,104.1)`.
- World coordinates: `local_xz(lat0, lon0, lon, lat)` — x east, z south, metres from the site centre. The browser
  projects `rail.json` lat/lon with the same formula (`x=(lon-lon0)*111320*cos(lat0°)`, `z=-(lat-lat0)*110574`).
- Radii: bus stops within **500 m** of any block (site centre for upcoming projects); stations within **1 km**.
  Walk minutes per block with the existing `walk_min` (Python) / `walkMin` (JS) rule.
- Simplify: bus `path` at **25 m**, rail paths at **50 m** (reuse `simplify` from `tools/fetch_surround.py`).
- OSM↔LTA match: relation `ref == ServiceNo` and its first and last stop each within **300 m** of LTA's first/last
  stop for that direction; else `road:false`, stop-to-stop path.
- Budgets: `projects/<id>/transit.json` ≤ **120 KB**, `web/rail.json` ≤ **80 KB** (compact JSON).
- Colours: the browser colours rail lines with `LINE` from `web/nearby.js` (single source; deviation from the spec's
  per-line colour field in `rail.json`), LRT/unknown grey `#748477`; bus blue `#2F6DB5`; exits red `#D42E12`.
- Copy, exact: section heading "Bus stops near Blk <blk>" ("Bus stops near the site" for `"site"`); card
  "<no> · <from> → <to> · <n> stops", "Here <first>–<last>", "every <band> min at 8 am"; fallback note
  "route shape approximate"; fetch failure notice "Bus and MRT details unavailable"; legend
  "15/30/45 min reach · coloured lines = MRT · blue = selected bus".
- Tests: `test/commute_test.py` (Python, top-level asserts, `print('ok')`), `test/commute_ui_test.mjs` (JS); both
  already run under `npm test`. Real-data checks skip with a printed note when `reference/transit/osm_*.json` is absent.

## Review Focus
1. **An OSM relation for the right number but the other direction or a branch variant** (e.g. `88` loop vs `88`
   short-working) → must not be matched to the wrong direction; falls back to `road:false` — test in Task 2.
2. **OSM ways in a relation out of order or reversed** → the chained path is continuous (no zig-zag between way ends)
   — test in Task 1.
3. **A stop served by the same service in both directions** (stop on a loop) → both directions listed once each,
   chip opens the direction whose stop sequence contains the stop first — test in Task 3.
4. **Switching block, tab, or project with a service selected** → selection clears or follows the new block without
   errors; ribbon hidden outside the Commute tab — Playwright check in Task 5.
5. **Hostile names** (`<`, `&`, quotes in LTA/OSM names) → escaped in HTML and SVG, including `data-` attributes —
   test in Task 4.

---

### Task 1: Fetch OSM bus and rail relations; chain way geometry

**Files:**
- Modify: `tools/fetch_transit.py`
- Test: `test/commute_test.py`

**Interfaces:**
- Produces: `reference/transit/osm_bus.json`, `osm_rail.json` (Overpass `out geom` JSON, relations with `members`
  each carrying `type`, `role`, `geometry` [{lat,lon}] for ways, `lat/lon` for nodes, and `tags`);
  `chain(ways: list[list[tuple[float,float]]]) -> list[tuple[float,float]]` — joins way polylines into one path,
  reversing a way when its far end meets the path, starting from the first way's end that does not touch the second.
  `fetch_osm()` writes both files; `__main__` gains a `--osm` flag that fetches only OSM (no LTA key needed).

- [ ] **Step 1: Failing tests** in `test/commute_test.py`:
  ```python
  from tools.fetch_transit import chain
  a, b, c = [(0,0),(0,1)], [(0,2),(0,1)], [(0,2),(0,3)]          # b reversed
  assert chain([a, b, c]) == [(0,0),(0,1),(0,2),(0,3)]
  assert chain([b, a]) == [(0,2),(0,1),(0,0)]                     # starts at b's free end
  assert chain([a]) == a and chain([]) == []
  ```
- [ ] **Step 2: Run** `PYTHONPATH=. python3 test/commute_test.py` → FAIL (ImportError).
- [ ] **Step 3: Implement** `chain` and `fetch_osm`: queries
  `rel(BBOX)["type"="route"]["route"="bus"];out geom;` and
  `rel(BBOX)["type"="route"]["route"~"^(subway|light_rail|train)$"];out geom;` (timeout 170, see Global Constraints
  for UA and mirrors). A gap between ways > 50 m starts a new segment silently joined (straight) — `shortcut:` comment.
- [ ] **Step 4: Run** the test → `ok`; then `python3 tools/fetch_transit.py --osm` → prints relation counts
  (expect bus ≈ 900+, rail > 20).
- [ ] **Step 5:** Leave uncommitted.

### Task 2: Match OSM bus relations to LTA services; rail order helper

**Files:**
- Modify: `tools/build_commute.py`
- Test: `test/commute_test.py`

**Interfaces:**
- Consumes: `chain` (Task 1); existing `dist_m`, `OPEN`, `EXTRA`, `build_graph`.
- Produces:
  - `rail_order(stations: list) -> dict[str, list[str]]` — prefix → codes in line order, exactly the ordering
    `build_graph` uses today (refactor `build_graph` to call it; its tests must still pass).
  - `match_relation(rels: list, no: str, first: tuple, last: tuple) -> dict | None` — `first`/`last` are LTA stop
    (lat, lon); returns the relation (ref == no, its first and last `stop`/`platform`-role member each ≤ 300 m from
    `first`/`last`), preferring the smallest summed distance; `None` otherwise.
  - `route_path(rel: dict | None, stop_lls: list[tuple]) -> tuple[list[tuple], bool]` — chained way geometry of the
    relation (or `stop_lls` when `rel` is None) and `road` flag.

- [ ] **Step 1: Failing tests:** toy relations: one `ref:"88"` whose stops run A→B (matches LTA A→B), one `ref:"88"`
  running B→A (must not match A→B — Review Focus 1), one `ref:"88"` short-working ending 1 km before B (no match);
  `match_relation` returns the first; `route_path(None, [p, q]) == ([p, q], False)`; `rail_order` on a toy station
  list returns `{'NS': ['NS1','NS2','NS3']}` with `TE22A` after `TE22` in a TE toy.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** the three functions; refactor `build_graph` to use `rail_order`.
- [ ] **Step 4: Run** `PYTHONPATH=. python3 test/commute_test.py` → `ok` (all earlier tests too). Real-data smoke
  (not committed as a test): share of LTA (service, direction) pairs matched — report it; expect ≥ 85%.
- [ ] **Step 5:** Leave uncommitted.

### Task 3: Write `transit.json` per project and `web/rail.json`

**Files:**
- Modify: `tools/build_commute.py` (new `transit_for`, `rail_json`, `__main__` writes both)
- Test: `test/commute_test.py`

**Interfaces:**
- Consumes: Task 2 functions; existing `load`, `block_centres`, `running`, `walk_min`, `local_xz`, `simplify`, `HUBS`.
- Produces: `transit_for(P, ctx) -> dict` with exactly the spec's shape
  (`stops[] {code,name,x,z,walk:{blk:min},svc:[no...]}`, `services{"<no>/<dir>": {no,from,to,n,band,times:{code:[first,last]},path,stopPts,road}}`,
  `stations[] {name,codes,lines:[{code,prev,next,hubs}],exits:[{exit,x,z,walk:{blk:min}}]}`), coordinates rounded to
  whole metres, `walk` keyed like `P.commute.hubs` (block ids as strings, `"site"` for upcoming);
  `rail_json(osm_rail, stations) -> {"<prefix>": {"paths": [[[lat,lon]...]]}}` with lat/lon rounded to 5 dp,
  prefixes only where `OPEN` matches. `ctx` is whatever `load()` returns plus the OSM data — the implementer names it.
  Prefix of a rail relation = most common code prefix among its stop members matched by name to `all.json` stations.
  `stop.svc` lists services running at 08:00 at that stop; a stop on a loop served by both directions lists the number
  once and the service key chosen is the direction whose sequence reaches the stop first (Review Focus 3).
  `exit` is the letter/number after "Exit " in `all.json`'s `exit` field.

- [ ] **Step 1: Failing tests:**
  ```python
  T = transit_for(P_bishan, ctx)                         # real data; skip with note if osm_*.json missing
  assert T['stops'] and T['stops'][0]['walk']['100B'] >= 1
  assert any(s['code'] == '52031' and '88' in s['svc'] for s in T['stops'])
  k = next(k for k in T['services'] if k.startswith('88/'))
  assert T['services'][k]['from'] == 'Pasir Ris Int' and T['services'][k]['to'] == 'Toa Payoh Int'
  st = next(s for s in T['stations'] if s['name'].startswith('Bishan'))
  ns = next(l for l in st['lines'] if l['code'] == 'NS17')
  assert (ns['prev'], ns['next']) == ('Ang Mo Kio', 'Braddell') and 'Raffles Place' in ns['hubs']
  assert sorted(e['exit'] for e in st['exits']) == ['A', 'B', 'C', 'D', 'E']
  R = json.load(open('web/rail.json')); assert R and all(OPEN.match(p + '1') for p in R)
  for f in Path('projects').glob('*/transit.json'): assert f.stat().st_size <= 120_000, f
  assert Path('web/rail.json').stat().st_size <= 80_000
  ```
  plus a toy loop-stop case for Review Focus 3. Station names drop the " MRT Station"/" LRT Station" suffix in
  `prev`/`next` (as in the asserts).
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement**; `__main__` writes `projects/<id>/transit.json` next to each `project.json` and
  `web/rail.json` once, compact JSON. Print per project `<id>: <stops> stops, <services> services, <KB> KB`.
- [ ] **Step 4: Run** `python3 tools/build_commute.py projects/*/` then `npm test` → all `ok`.
- [ ] **Step 5:** Leave uncommitted.

### Task 4: `web/transit.js` and island-map additions

**Files:**
- Create: `web/transit.js`
- Modify: `web/commute.js` (`commuteHtml`, `reachSvg` accept transit data), `web/nearby.js` (export nothing new
  unless needed; `LINE` already exported)
- Test: `test/commute_ui_test.mjs`

**Interfaces:**
- Consumes: `transit.json` (Task 3), `rail.json` (Task 3), existing `esc`, `LINE`, `lineChips`.
- Produces:
  - `toXZ(site: {lat, lon}, lat, lon) -> [x, z]`
  - `stopsHtml(T, blk, selSvc: string|null) -> string` — stops sorted by `walk[blk]`, each a `.stop` with
    `data-stop="<code>"`; chips `<button class="svc" data-svc="<no>/<dir>">`; the selected one `aria-pressed="true"`
    followed by `serviceCard`.
  - `serviceCard(svc, stopCode) -> string` — exact copy from Global Constraints; adds "route shape approximate"
    when `road` is false.
  - `stationsHtml(T, blk, selStation: string|null) -> string` and `stationCard(st, blk) -> string` — exits sorted by
    `walk[blk]`, "Nearest: Exit <x>, <m> m".
  - `railSvg(R, site) -> string` (one `<polyline>` per path, `LINE[prefix]` or grey) and `routeSvg(svc) -> string`
    (blue polyline, stop dots, "from …"/"to …" labels sized like hub labels).
  - `commuteHtml(P, stacks, selStack, T = null, R = null, sel = {svc: null, station: null}) -> string` — inserts
    stops after the hub table and stations after the stops; when `T` is `null` because the fetch failed (caller passes
    `T === false`) shows "Bus and MRT details unavailable"; `reachSvg(C, R, svc)` draws rail under hubs and the route.

- [ ] **Step 1: Failing tests:** fixture `T` with 2 stops, 2 services (one `road:false`), 1 station with 3 exits;
  assert nearest-first order for a block, `aria-pressed="true"` on the selected chip and the card copy, "route shape
  approximate" only for the `road:false` one, station card exits sorted, notice when `T === false`, legend copy, rail
  polylines coloured from `LINE`, and escaping of `<`/`&`/`"` in stop names, service `to`, station names and
  `data-` attributes (Review Focus 5).
- [ ] **Step 2: Run** `node test/commute_ui_test.mjs` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm test` → all `ok`.
- [ ] **Step 5:** Leave uncommitted.

### Task 5: Wire into the app — lazy load, selection, 3D exit pins and route ribbon

**Files:**
- Modify: `web/app.js` (around `renderCommute` ~282, `applyRTab` ~271, pointerup ~465), `web/style.css`

**Interfaces:**
- Consumes: Task 4 exports.

- [ ] **Step 1:** State `T` (undefined → loading, object, or `false` on failure), `R`, `sel = {svc:null, station:null}`.
  On first `applyRTab()` to `commute`, `Promise.all` fetch `../projects/<id>/transit.json` and `rail.json` (paths as
  the app already builds them for `project.json`), then `renderCommute()`. `renderCommute()` passes `T, R, sel`.
- [ ] **Step 2:** Delegated clicks on `#commutePanel`: `.svc` toggles `sel.svc`, `.stop` header clears it,
  `[data-station]` toggles `sel.station`; each re-renders and calls `updateTransit3d()`. `select`/`clear` keep
  `sel.svc` only if the new block still lists that stop, else clear it (Review Focus 4).
- [ ] **Step 3:** `transitGroup` (THREE.Group, visible only while `rtab === 'commute'`): exit pins via
  `pinSprite('Exit ' + exit, '#D42E12')` + walk label via `makeLabel`, `userData = {tip, station}`, added to
  `pickables`; route ribbon = `THREE.Line` of `svc.path` at y = 2, blue, clipped to points within 1.5 km.
  On pointerup (before unit hit), if a visible pickable with `userData.station` is hit → open that station card;
  a bus amenity sprite within 30 m of a `T.stops` stop → switch to Commute, set that stop as scroll target.
- [ ] **Step 4:** CSS for `.stop`, `.svc` chips (reuse `.line` look, blue), service/station cards, scoped under
  `#commutePanel`.
- [ ] **Step 5: Verify.** `npm test` → all `ok`. Serve with `python3 -m http.server 8781 --bind 127.0.0.1` and use
  Playwright (system Chrome, `chromium.launch({channel:'chrome', args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']})`,
  scripts in the session scratchpad which has `node_modules/playwright`) on `?p=bishan-terraces`: open Commute, tap
  stop 52031 chip `88` → card shows "88 · Pasir Ris Int → Toa Payoh Int"; ribbon and blue route present; tap Bishan
  station → card with exits A–E; switch Sun → exit pins and ribbon hidden; pick another unit → no errors; open
  `?p=bedok-bayshore-i-oct-2026` → "Bus stops near the site". Zero console errors. Screenshots 1280×820 and 390×844
  saved to the SDD workspace; look at them and fix layout problems.
- [ ] **Step 6:** Leave uncommitted; report screenshots.
