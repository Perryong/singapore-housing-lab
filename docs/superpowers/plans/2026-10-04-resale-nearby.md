# Resale Nearby Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show HDB resale transactions within 1 km (last 24 months) around every project, on the map and in a panel.

**Architecture:** An offline Python tool links each nearby HDB building footprint to its resale transactions and writes
`project.json["resale"]`. The static three.js app adds a "Resale nearby" colour mode with per-block overlay meshes,
a block card, a summary panel with an inline-SVG trend, and a resale line in the BTO price block.

**Tech Stack:** Python 3 stdlib (+ curl via subprocess, as `tools/fetch_context.py` does); vanilla JS ES modules +
three.js; `node:assert` scripts; Playwright MCP.

**Spec:** `docs/superpowers/specs/2026-10-04-resale-nearby-design.md`

## Global Constraints

- Window: within **900 m** of the site centre (world origin), **last 24 months** counted back from the newest
  `month` in the dataset (inclusive of that month). Medians need **≥ 3 sales**, else "too few sales".
- Never place an unlinked block at a guessed location; count it.
- Dataset `d_8b84c4ee58e3cfc0ece0d773c8ca6abc`, cached at `reference/resale/resale.csv` (git-ignored).
- BTO code -> resale type: 2RF1/2RF2 -> "2 ROOM", 3RM -> "3 ROOM", 4RM -> "4 ROOM", 5RM -> "5 ROOM",
  3GEN -> "MULTI-GENERATION"; CCA/RENT none.
- Source line text exactly: `HDB resale transactions, data.gov.sg, up to <asOf>`.
- Commit after each task with the `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` trailer; do not push.

## Review Focus

- Street name variants between the resale data ("ANG MO KIO AVE 5") and OneMap roads ("ANG MO KIO AVENUE 5") — must link; Task 1 test asserts Blk 179 near Kebun Baru Ridge.
- A block with sales of several flat types: colouring must use only the selected type; blocks without that type stay grey — Task 2 Playwright step switches type and counts coloured blocks change.
- A flat type with 1–2 sales nearby: summary shows "too few sales", never a median of 1 — Task 1 test.
- Upcoming projects (no `prices`): panel shows resale only, no BTO comparison line and no error — Task 2 sweep covers an upcoming project.
- Switching back from "Resale nearby" to another mode must restore the stack table and hide overlays — Task 2 Playwright step.

---

### Task 1: Resale data tool

**Files:**
- Create: `tools/fetch_resale.py`, `test/resale_test.py`

**Interfaces:**
- Consumes: `tools/fetch_context.py` — `norm(street) -> str`, `local_xz(lat0, lon0, lon, lat) -> (x, z)`,
  `onemap_road(postal, cache) -> str|None`, cache file `reference/hdb/onemap-cache.json`;
  `reference/hdb/hdb-buildings.geojson` (BLK_NO, POSTAL_COD), `reference/hdb/hdb-property.csv`
  (blk_no, street, max_floor_lvl).
- Produces:
  - `aggregate(rows: list[dict], blocks: dict[tuple[str,str], dict], as_of: str) -> dict` — `rows` are CSV dicts
    (dataset columns, strings); `blocks` maps `(block, norm(street))` -> `{"x","z","ctx"|None,"storeys","lease"}`
    for footprints within 900 m; returns the spec's `resale` object (asOf, radiusM=900, months=24, blocks,
    summary, trend, sales ≤300 newest first). `psm` = price / floor_area_sqm rounded to int; medians via
    `statistics.median` rounded to int; `leaseLeft` = median integer years from `remaining_lease`.
  - `nearby_blocks(P: dict, radius=1000) -> (dict, int)` — the `blocks` map for a project plus the count of
    footprints within radius whose road could not be resolved (`unlinked`); `ctx` = index into `P["context"]` whose
    polygon centroid is within 3 m of the footprint centroid, else None.
  - CLI `python3 tools/fetch_resale.py [--refresh] projects/<id>...` writes `P["resale"]` (+ `linked`, `unlinked`)
    and prints `<id>: <blocks with sales> blocks, <sales> sales, linked <a>/<a+u> footprints`.

- [ ] **Step 1: Failing test** `test/resale_test.py`:
```python
from tools.fetch_resale import aggregate, nearby_blocks
from tools.fetch_context import norm
R = lambda m, b, s, t, sqm, p, left='60 years 01 month': dict(month=m, block=b, street_name=s, flat_type=t,
    storey_range='04 TO 06', floor_area_sqm=str(sqm), flat_model='Model A', lease_commence_date='1990',
    remaining_lease=left, resale_price=str(p), town='X')
B = {('1', norm('FOO ST 1')): dict(x=10, z=0, ctx=0, storeys=12, lease=1990),
     ('2', norm('FOO ST 1')): dict(x=20, z=0, ctx=None, storeys=10, lease=1985)}
rows = [R('2026-10', '1', 'FOO ST 1', '4 ROOM', 90, 900000), R('2026-09', '1', 'FOO ST 1', '4 ROOM', 90, 810000),
        R('2026-01', '1', 'FOO ST 1', '4 ROOM', 100, 1000000), R('2024-10', '1', 'FOO ST 1', '4 ROOM', 90, 1),  # 25th month back -> excluded
        R('2026-05', '2', 'FOO ST 1', '3 ROOM', 70, 500000), R('2026-05', '9', 'OTHER RD', '4 ROOM', 90, 2)]       # unknown block -> excluded
A = aggregate(rows, B, '2026-10')
assert A['summary']['4 ROOM'] == {'n': 3, 'median': 900000, 'psm': 10000, 'leaseLeft': 60}
assert A['summary']['3 ROOM']['n'] == 1 and 'median' not in A['summary']['3 ROOM']        # too few sales
assert [s['price'] for s in A['sales']] == [900000, 810000, 500000, 1000000]                # newest first
assert {b['blk'] for b in A['blocks']} == {'1', '2'} and A['radiusM'] == 1000 and A['months'] == 24
import json
P = json.load(open('projects/kebun-baru-ridge/project.json'))
blocks, unlinked = nearby_blocks(P)
assert ('179', norm('ANG MO KIO AVE 5')) in blocks      # resale spelling "AVE" must link to OneMap "AVENUE"
assert blocks[('179', norm('ANG MO KIO AVE 5'))]['storeys'] > 0
print('ok')
```
- [ ] **Step 2: Run** `PYTHONPATH=. python3 test/resale_test.py` — Expected: ImportError.
- [ ] **Step 3: Implement** `aggregate`, `nearby_blocks`, download (`api-open.data.gov.sg/v1/public/api/datasets/<id>/poll-download`, retry with backoff as `tools/build_amenities.py` does), CLI. Footprints come from the geojson (centroid within radius via `local_xz` from `P["site"]`); storeys from hdb-property.csv by `(blk_no, norm(street))`; lease from the newest row's `lease_commence_date`. Trend: per type per month with ≥3 sales, median psm, last 24 months ascending.
- [ ] **Step 4: Run test** — Expected: `ok`.
- [ ] **Step 5: Run CLI on all 29 projects** (launched + upcoming). Expected: every project prints; linked/(linked+unlinked) ≥ 95% per project — record the per-project line in `docs/superpowers/progress.md`; list any below 95%.
- [ ] **Step 6: Commit** `tools/fetch_resale.py test/resale_test.py projects/*/project.json docs/superpowers/progress.md` — "feat: resale transactions near each project".

### Task 2: App — "Resale nearby" mode, block card, panel, BTO line

**Files:**
- Create: `web/resale.js`, `test/resale_ui_test.mjs`
- Modify: `web/app.js`, `web/index.html`, `web/style.css`

**Interfaces:**
- Consumes: `P.resale` (Task 1), `P.context`, `P.prices`, `money`/`range` from `web/format.js`.
- Produces (`web/resale.js`, pure, no three.js):
  - `RESALE_TYPE = {'2RF1':'2 ROOM','2RF2':'2 ROOM','3RM':'3 ROOM','4RM':'4 ROOM','5RM':'5 ROOM','3GEN':'MULTI-GENERATION'}`
  - `defaultType(resale) -> string` — "4 ROOM" if `summary["4 ROOM"].n >= 3`, else the type with the most sales.
  - `psmRamp(v: number, min: number, max: number) -> string` — hex colour on a light->dark blue ramp `#DCEBFA`..`#0B3C7A` (clamped).
  - `trendSvg(points: [string, number][], w=300, h=90) -> string` — `<svg>` with one polyline and first/last month labels; `''` when < 2 points.
- In `web/app.js`: overlay meshes built once from `P.resale.blocks` with `ctx != null` (extrude `P.context[ctx].p` to its `h` + 0.3 m, `userData.resale = block`), visible only in mode `resale`; picking in `resale` mode raycasts these meshes first (spec's footprint-polygon picking, done with one mesh per footprint — record as Ruling).

- [ ] **Step 1: Failing test** `test/resale_ui_test.mjs`:
```js
import assert from 'node:assert/strict';
import { RESALE_TYPE, defaultType, psmRamp, trendSvg } from '../web/resale.js';
assert.equal(RESALE_TYPE['2RF2'], '2 ROOM');
assert.equal(defaultType({ summary: { '4 ROOM': { n: 2 }, '3 ROOM': { n: 9 } } }), '3 ROOM');
assert.equal(defaultType({ summary: { '4 ROOM': { n: 3 }, '3 ROOM': { n: 9 } } }), '4 ROOM');
assert.equal(psmRamp(0, 5, 10).toLowerCase(), '#dcebfa'); assert.equal(psmRamp(99, 5, 10).toLowerCase(), '#0b3c7a');
assert.equal(trendSvg([['2026-01', 1]]), '');
assert.match(trendSvg([['2026-01', 9000], ['2026-02', 9500]]), /<polyline[^>]+points=/);
console.log('ok');
```
- [ ] **Step 2: Run** `node test/resale_ui_test.mjs` — Expected: module not found.
- [ ] **Step 3: Implement `web/resale.js`**, then wire the app:
  mode button `<button class="mode wide" data-m="resale">Resale nearby</button>`; type chips `#resaleTypes`
  (types present in `summary`); legend = ramp gradient with min/max psm of the selected type; in mode `resale` the
  right panel shows `#resalePanel` (summary table: type, sales, median, $/sqm, median years left — "too few sales"
  where no median; BTO line `This BTO <type>: <range> · Resale nearby median <money> (<leaseLeft> yrs left)` only
  when `P.prices` has a code mapping to the type; `trendSvg(P.resale.trend[type])`; recent sales list sortable by
  date/price; source line per Global Constraints) and hides the stack table; clicking an overlay opens
  `#resaleCard` (`Blk <blk> <street> · <lease> lease (<years> years left)`, per-type rows, last 10 sales of that
  block from `P.resale.sales`); leaving the mode restores the table and hides overlays/card. Unit card price
  block: add `Resale nearby (same type, 1 km): median <money>` when `summary[RESALE_TYPE[code]].median` exists.
  Bump `?v=` on app.js/style.css in `index.html`.
- [ ] **Step 4: Run** `node test/resale_ui_test.mjs && node test/format_test.mjs && node test/sun.test.js` — Expected: all `ok`.
- [ ] **Step 5: Playwright sweep** (server :8782, 29 projects): click `[data-m=resale]`; if `resale.blocks` has
  any `ctx != null`, assert ≥1 overlay visible (expose count via `window.__resaleOverlays` set in app.js), click one
  overlay (project its centroid to screen via the camera) and assert `#resaleCard` contains its `Blk <blk>`;
  assert `#resalePanel svg` exists when the default type has ≥2 trend points; switch type chip → coloured count
  changes or stays ≥0 without error; click `[data-m=now]` → stack table visible (launched) and overlays hidden;
  upcoming project → panel has no "This BTO" line; no page errors.
- [ ] **Step 6: Commit** `web/resale.js web/app.js web/index.html web/style.css test/resale_ui_test.mjs` — "feat: resale nearby mode".
