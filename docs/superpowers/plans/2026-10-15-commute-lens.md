# Commute Tab Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A third right-panel tab, **Commute**, showing door-to-hub times per block, a 15/30/45-min reach map and the
nearest bus stops, all precomputed offline from LTA data.

**Architecture:** `tools/fetch_transit.py` caches LTA DataMall bus data; `tools/build_commute.py` builds an all-island
bus + rail graph, runs a Dijkstra from each block, and writes `project.json["commute"]`. The browser only renders it:
`web/commute.js` (pure HTML/SVG strings) wired into the existing tab switcher in `web/app.js`.

**Tech Stack:** Python 3 (stdlib + numpy/OpenCV already used by the pipeline), plain ES modules, `node:assert` tests.

**Spec:** `docs/superpowers/specs/2026-10-15-commute-lens-design.md`

## Global Constraints
- **Do not commit.** The user asked for no commits; every task ends with the work left in the working tree.
- The LTA key lives only in `.env` (git-ignored, `LTA_KEY=...`) or the environment. Never print it, write it to
  `reference/`, `projects/`, the plan, logs or tests. Fail with "set LTA_KEY (see .env)" when it is missing.
- `reference/transit/` and `.env` are git-ignored (already added to `.gitignore`).
- Scenario fixed to **weekday 08:00**. Hubs, in this order: Raffles Place, one-north, Changi Airport, Jurong East,
  Woodlands (match `all.json` names `"<Hub> MRT Station"`).
- Constants (each with a `shortcut:` comment): bus 18 km/h; rail 40 km/h + 0.5 min dwell; walk `d * 1.3 / 80` min
  (same as `web/nearby.js` `walkMin`); transfer walk ≤ 400 m; access walk ≤ 500 m; same-station line change 2 min;
  wait = headway / 2; MRT headway 3, LRT headway 4; search cut-off 60 min.
- World coordinates: `local_xz(lat0, lon0, lon, lat)` from `tools/fetch_context.py` — x east, z **south**, metres,
  site centre at (0, 0). SVG draws x right, z down directly.
- Test files follow the repo pattern so `npm test` picks them up: `test/*_test.py`, `test/*.mjs`.
  (The spec said `commute.test.mjs`; use `test/commute_ui_test.mjs` to match `value_ui_test.mjs`.)
- `project.json["commute"]` ≤ 40 KB per project.
- Deviation from spec: the reach outline uses `cv2.findContours` (OpenCV is already a pipeline dependency) instead of
  hand-rolled tracing; "stdlib only" otherwise holds.

## Review Focus
1. **A hub is unreachable within 60 min** (e.g. Changi Airport from Tengah) → row shows "over 60 min", not `null`/NaN
   — test in Task 4.
2. **Services not running at 08:00** (night/express-only, `WD_FirstBus` after 0800 or `WD_LastBus` before 0800, or
   `AM_Peak_Freq` `"-"`) → never used for boarding — test in Task 2.
3. **Bus routes whose `Distance` decreases or repeats** (loop services restart at 0) → no negative/zero-time edges —
   test in Task 2.
4. **Upcoming project with no blocks** → hubs keyed `"site"`, tab says "from the site centre" — tests in Tasks 3 and 4.
5. **Hostile or odd names** (`<`, `&` in an LTA stop description) → escaped in HTML and SVG — test in Task 4.

---

### Task 1: Fetch and cache LTA bus data

**Files:**
- Create: `tools/fetch_transit.py`
- Test: `test/commute_test.py` (created here, extended in Tasks 2–3)

**Interfaces:**
- Produces: `reference/transit/BusStops.json`, `BusRoutes.json`, `BusServices.json` (plain JSON lists of the API rows);
  `headway(band: str) -> float | None` (`"06-09"` → 7.5, `"10"` → 10.0, `"-"`/`""` → None);
  `lta_key() -> str` (env `LTA_KEY`, else parse `ROOT/.env`, else `SystemExit("set LTA_KEY (see .env)")`).

- [ ] **Step 1: Write the failing test** in `test/commute_test.py` (style: top-level asserts, `print('ok')`, like
  `test/value_test.py`):
  ```python
  from tools.fetch_transit import headway
  assert headway('06-09') == 7.5 and headway('10') == 10.0
  assert headway('-') is None and headway('') is None
  ```
- [ ] **Step 2: Run** `PYTHONPATH=. python3 test/commute_test.py` → FAIL (`ModuleNotFoundError`).
- [ ] **Step 3: Implement** `headway`, `lta_key`, and a `__main__` that pages
  `https://datamall2.mytransport.sg/ltaodataservice/<Dataset>?$skip=N` (header `AccountKey`, 500 rows a page, stop
  on an empty page) for the three datasets and writes each list to `reference/transit/<Dataset>.json`. Print only row
  counts. Use `urllib.request`.
- [ ] **Step 4: Run** the test → `ok`. Then `python3 tools/fetch_transit.py` → three counts, roughly BusStops ≈ 5,000,
  BusRoutes ≈ 26,000, BusServices ≈ 700 (non-zero is the pass condition).
- [ ] **Step 5:** Leave uncommitted.

### Task 2: Transit graph and time search

**Files:**
- Create: `tools/build_commute.py` (graph + search parts only)
- Test: `test/commute_test.py`

**Interfaces:**
- Consumes: `headway` from Task 1; `local_xz` from `tools/fetch_context.py`.
- Produces:
  - `build_graph(stops: list, routes: list, services: list, stations: list) -> dict` with keys
    `pos: {node: (lat, lon)}` and `adj: {node: [(to, minutes, svc | None, headway | None)]}`.
    Nodes: `"b:<BusStopCode>"`, `"r:<code>"` (e.g. `"r:NS17"`). `svc`: `"bus:<ServiceNo>/<Direction>"` or
    `"rail:<prefix>"` (e.g. `"rail:NS"`); `None` = walk. `stations` = the `cat in ('mrt','lrt')` rows of
    `reference/amenities/all.json` (one row per exit, `lines` like `"NS17 CC15"`); a code's position is its station's
    exits.
  - `search(G: dict, starts: list[tuple[str, float]], limit: float = 60) -> dict[str, tuple[float, list]]`
    — best (minutes, legs) per node; legs like `[["walk", 7], ["rail", "NS"], ["walk", 2]]` (walk minutes rounded,
    consecutive same-service edges merged, bus legs carry the service number).
  - `access(G, x, z, lat0, lon0, radius=500) -> list[tuple[str, float]]` — start list for an origin at world (x, z):
    every bus stop and station code with an exit ≤ 500 m, at walk minutes.

- [ ] **Step 1: Write failing tests** — a toy network built from fake rows (2 rail lines `AA1–AA3`, `BB1–BB2` sharing
  station "X" as `AA2 BB1`; one bus service `7` dir 1 with `AM_Peak_Freq "08-12"` over 3 stops, `Distance` 0, 1.8, 3.6):
  ```python
  G = build_graph(toy_stops, toy_routes, toy_services, toy_stations)
  r = search(G, [('r:AA1', 0)])
  assert r['r:AA2'][0] == approx(1.5 + ride(AA1, AA2))      # wait 3/2, then ride
  assert r['r:BB2'][0] == approx(r['r:AA2'][0] + 2 + 1.5 + ride(BB1, BB2))   # line change 2 + wait
  b = search(G, [('b:S1', 0)])
  assert b['b:S3'][0] == approx(5 + 2 * 6)                   # wait 10/2, 1.8 km at 18 km/h = 6 min each hop
  assert [l[0] for l in b['b:S3'][1]] == ['bus'] and b['b:S3'][1][0][1] == '7'
  far = search(G, [('b:S1', 55)]); assert 'b:S3' not in far  # past the 60-min cut-off
  ```
  plus Review Focus 2–3: a service with `WD_FirstBus "0900"` and one with `AM_Peak_Freq "-"` add no bus edges; a
  route whose `Distance` goes 5.0 → 0.0 (loop restart) yields no edge with minutes ≤ 0.
- [ ] **Step 2: Run** → FAIL (`ImportError`).
- [ ] **Step 3: Implement.**
  - Bus edges: consecutive `StopSequence` per (ServiceNo, Direction), minutes = Δ`Distance` km ÷ 18 × 60; skip
    Δ ≤ 0 and services filtered by Review Focus 2.
  - Rail edges, both directions: codes per prefix sorted by (number, suffix) (`TE22A` after `TE22`); minutes =
    straight-line distance between station centroids ÷ 40 km/h + 0.5. Extra links where numbering is not enough —
    check each code against `all.json` and drop any that is absent: `EW4–CG1`, `CG1–CG2`, `CC4–CE1`, `CE1–CE2`,
    `BP6–BP7`, `BP13–BP6`, `STC–SE1`, `SE5–STC`, `STC–SW1`, `SW8–STC`, `PTC–PE1`, `PE7–PTC`, `PTC–PW1`, `PW7–PTC`.
    Headway 3 for `NS EW CG NE CC CE DT TE`, 4 otherwise.
  - Same station, different codes: walk edges of 2 min both ways. Transfer walks between any bus stop / station exit
    ≤ 400 m apart: bucket positions on a 400 m grid so this stays fast (~5,600 points).
  - Search: Dijkstra over state `(node, svc)`; boarding an edge whose `svc` differs from the current one adds
    `headway / 2`; walking sets `svc` to `None`; drop states past `limit`. Keep the best per node for the result.
- [ ] **Step 4: Run** → `ok`.
- [ ] **Step 5:** Leave uncommitted.

### Task 3: Hubs, reach outlines, stops — write `project.json["commute"]`

**Files:**
- Modify: `tools/build_commute.py` (add `__main__` and the functions below)
- Test: `test/commute_test.py`

**Interfaces:**
- Consumes: `build_graph`, `search`, `access` (Task 2); `simplify` from `tools/fetch_surround.py`.
- Produces `P["commute"]` exactly as in the spec:
  `{"asOf":"YYYY-MM","at":"weekday 08:00","hubs":{"<blk>"|"site":[[min,legs]|null ×5]},"hubPts":[[name,x,z]×5],
  "reach":{"15":[ring...],"30":[...],"45":[...]},"stops":[{"code","name","d","svc":[[no,first,last]...]}]}`
  with `hubs` keys **ordered nearest-to-site-centre first** (the browser uses the first as the default), rings as
  `[[x, z], ...]` rounded to whole metres. Functions:
  - `block_centres(P) -> dict[str, tuple[float, float]]` — mean world (x, z) of each block's stacks, using the
    plan→world transform in `tools/anchor_fit.py` `p2w` (copy the 3 lines; that script runs on import). Empty when
    `P` has no `stacks`.
  - `reach(times: dict, G, lat0, lon0) -> dict` — for T in 15/30/45: on a 100 m grid, mark cells within
    `(T - t) * 80 / 1.3` m of every node reached at t < T (and of the origin); `cv2.findContours` on the mask (outer
    rings only, `RETR_EXTERNAL`), then `simplify(ring, tol=50)`; drop rings with fewer than 4 points.
  - `commute_for(P, G, stops_by_code, routes) -> dict`.
  Also renames `P["amenities"]` bus rows from `"Bus stop <code>"` to the LTA `Description`.

- [ ] **Step 1: Write failing tests:**
  ```python
  C = commute_for(P_bishan, G, ...)                     # real data: projects/bishan-terraces
  first = next(iter(C['hubs'].values()))
  assert 22 <= first[0][0] <= 30, first[0]              # Raffles Place on the NS line
  assert set(C['reach']) == {'15', '30', '45'} and all(C['reach'][k] for k in C['reach'])
  assert len(C['stops']) == 4 and all(s['name'] and s['svc'] for s in C['stops'])
  U = commute_for(P_upcoming, G, ...)                   # projects/bedok-bayshore-i-oct-2026 (no stacks)
  assert list(U['hubs']) == ['site']
  for f in Path('projects').glob('*/project.json'):     # after the build, size budget
      c = json.loads(f.read_text()).get('commute')
      assert c is None or len(json.dumps(c, separators=(',', ':'))) <= 40_000, f
  ```
  Skip the real-data asserts with a printed note when `reference/transit/` is missing (CI has no LTA key), as other
  tests do for raw data.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** the functions and `__main__` (`python3 tools/build_commute.py projects/<id> [...]`: build
  the graph once, then for each project compute and write `project.json` compactly as `fetch_amenities.py` does;
  print `<id>: hubs <first block's 5 minutes>, commute <KB> KB`).
- [ ] **Step 4: Run** `python3 tools/build_commute.py projects/*/` then the test → `ok`. Sanity-read the printed
  minutes: none negative, Raffles Place mostly 15–50.
- [ ] **Step 5:** Leave uncommitted.

### Task 4: `web/commute.js` — tab HTML and reach SVG

**Files:**
- Create: `web/commute.js`
- Modify: `web/nearby.js` (export `LINE`)
- Test: `test/commute_ui_test.mjs`

**Interfaces:**
- Consumes: `P.commute` (Task 3); `esc` from `web/format.js`; `LINE`, `lineChips`, `walkMin` from `web/nearby.js`.
- Produces: `commuteHtml(P, stacks, selStack) -> string`, `reachSvg(C) -> string`.

- [ ] **Step 1: Write failing tests** (style of `test/value_ui_test.mjs`):
  ```js
  assert.match(commuteHtml({}, [], null), /No commute data for this project/);
  const P = { commute: fixture };                        // 2 blocks "100A","100B"; hub 3 = null; a stop named "A&B <Stn>"
  assert.match(commuteHtml(P, stacks, null), /Pick a unit to see its block/);       // first key = default block
  assert.match(commuteHtml(P, stacks, 301), /Blk 100B/);                           // stack 301 is in 100B
  assert.match(commuteHtml(P, stacks, 301), /over 60 min/);                        // null hub
  assert.match(commuteHtml(P, stacks, null), /A&amp;B &lt;Stn&gt;/);
  assert.match(commuteHtml({ commute: { ...fixture, hubs: { site: fixture.hubs['100A'] } } }, [], null), /from the site centre/);
  assert.match(reachSvg(fixture), /<svg[^>]*role="img"[^>]*aria-label="Within 30 min: [^"]+"/);
  ```
- [ ] **Step 2: Run** `node test/commute_ui_test.mjs` → FAIL.
- [ ] **Step 3: Implement.** Copy and order as the spec's "What the user sees". Leg chips: walk = grey chip
  `walk N`, rail = `LINE[prefix]` background, bus = `#2F6DB5` with the service number. SVG: viewBox fitted to the
  45-min rings plus hub points with 10% margin, north up, rings filled `var(--accent)` at opacities .45/.22/.12, hubs as
  dots labelled `name · N′`, site as a rotated square. Footer copy exactly: "Estimated from LTA timetables and service
  frequencies, not live data; times are to the hub's MRT platform; real trips vary."
- [ ] **Step 4: Run** `npm test` → all `ok`.
- [ ] **Step 5:** Leave uncommitted.

### Task 5: Wire the tab into the app and verify in the browser

**Files:**
- Modify: `web/index.html:102-103`, `web/app.js:269-281` (and `select`/`clear` near 406–420), `web/style.css`

**Interfaces:**
- Consumes: `commuteHtml` (Task 4).

- [ ] **Step 1:** `index.html`: add `<button role="tab" data-t="commute" aria-selected="false">Commute</button>` after
  Value, and `<div id="commutePanel" hidden></div>` after `#valuePanel`.
- [ ] **Step 2:** `app.js`: in `applyRTab()` treat `rtab !== 'sun'` where it now tests `v` for hiding Sun content;
  show `#valuePanel` only for `value` and `#commutePanel` only for `commute`; add `renderCommute()` =
  `$('#commutePanel').innerHTML = commuteHtml(P, stacks, selStack)`; call it from `applyRTab`, `select` and the
  `clear` action when `rtab === 'commute'`. `openResaleCard`/`setResaleMode` checks for `'value'` become
  `rtab !== 'sun'`.
- [ ] **Step 3:** `style.css`: leg chip and `.reach svg{width:100%;height:auto}` rules, reusing `.line`, `.rtable`,
  `.unit-meta`.
- [ ] **Step 4: Verify.** `npm test` → all `ok`. Serve `web/` locally and, with Playwright (system Chrome:
  `chromium.launch({ channel: 'chrome' })` if the MCP browser is locked), open Bishan Terraces → Commute: no console
  errors; the table shows 5 rows; picking a unit changes the block label; switching Sun → Commute → Value → Sun
  restores each panel. Screenshot at 1280×820 and 390×844; also open one upcoming project and check "from the site
  centre".
- [ ] **Step 5:** Leave uncommitted; report the screenshots to the user.
