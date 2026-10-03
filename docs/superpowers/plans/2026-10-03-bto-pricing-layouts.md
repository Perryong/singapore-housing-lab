# BTO Pricing and Unit Layouts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show HDB's official price range per flat type and the selected stack's own floor plan in the unit card.

**Architecture:** Two offline tools write new keys into each `projects/<slug>/project.json` (`prices`,
`resaleComparables`, `layouts`) and PNGs into `projects/<slug>/layouts/`. The static web app reads them; no server.

**Tech Stack:** Python 3 + poppler (`pdftotext`, `pdftoppm`) + OpenCV for tools; vanilla JS ES modules + three.js app;
`node:test`-free plain `node:assert` scripts for JS tests; Playwright MCP for the sweep.

**Spec:** `docs/superpowers/specs/2026-10-03-bto-pricing-layouts-design.md`

## Global Constraints

- Pricing = official HDB figures only; no per-unit estimates; never use the Singpass-gated Flat Portal.
- Layout shown for a stack must be that stack's own crop; if missing show exactly "Layout not available in HDB brochure".
- Upcoming projects show exactly "Prices and layouts are released at HDB's sales launch."
- Flat-type codes: 2RF1, 2RF2, 3RM, 4RM, 5RM, 3GEN, CCA (RENT has no price). Two 2-room Flexi rows in the annex: smaller floor area = 2RF1.
- BTOlab is not a git repo: skip commit steps (do not `git init` unless the user asks).
- Run all commands from `~/Code/BTOlab`. Blender is not involved.

## Review Focus

- A project whose annex row spans a page break or wraps the name ("Chencharu\n Grove~") must still be matched — Task 1 test covers Chencharu Grove.
- Prime/Plus projects grouped in one annex price row (e.g. "Redhill Peaks / Berlayar Residences" share Table 3 lines) must each get their own `prices` from Table A(1)(a) — Task 1 asserts Berlayar Residences 4RM.
- A brochure where one block has separate "2ND STOREY" and "3RD TO 30TH STOREY" pages: `typical` must be the multi-storey page — Task 2 asserts on Kebun Baru Breeze 248A.
- A unit label that appears on two pages (lowest + typical) must not create two different `typical` crops — Task 2 asserts one entry per stack.
- Selecting a stack whose layout is missing must not show the previous stack's image — Task 3 Playwright step checks the image src changes / placeholder text.

---

### Task 1: Price extraction from launch annexes

**Files:**
- Create: `tools/fetch_prices.py`
- Create: `test/prices_test.py`
- Downloads (no code): `reference/hdb/annex-feb26.pdf`, `reference/hdb/annex-jun26.pdf` (Annex A links on the HDB press-release pages for Feb 2026 and Jun 2026 launches; Jun: `https://www.hdb.gov.sg/-/media/hdb-pulse/news/2026/20260617-HDB-Launches-6952-Flats-Across-7-Projects-in-June-2026-BTO-Sales-Exercise/Annex-A.pdf`; Oct 2025 already at `reference/hdb/oct25-Annex-ABTO-sales-exercise-Oct-2025.pdf`)

**Interfaces:**
- Produces: `parse_annex(pdf_path: str) -> dict[str, dict]` mapping project display name -> `{"prices": {code: {"min","max","sqm","internalSqm","units","waitingMonths"}}, "resaleComparables": {code: {"min","max"}}}`; CLI `python3 tools/fetch_prices.py <annex.pdf>...` writes `prices`/`resaleComparables` into matching `projects/*/project.json` (match `P["name"]` case-insensitively, ignoring `~`, `@` spacing) and prints unmatched names.
- `afterGrantsFrom`: computed as `min - grant` with the press-release illustrative EHG per flat type (2RF 120000; 3RM 105000 Standard / 90000 Plus&Prime; 4RM 80000 Standard / 55000 Plus&Prime; 5RM/3GEN 55000 Standard only; CCA: omit), using `P["classification"]`.

- [ ] **Step 1: Write failing test** `test/prices_test.py`:
```python
from tools.fetch_prices import parse_annex
A = parse_annex('reference/hdb/oct25-Annex-ABTO-sales-exercise-Oct-2025.pdf')
assert A['Ping Yi Court']['prices']['4RM'] == {'min': 498000, 'max': 624000, 'sqm': 93, 'internalSqm': 90, 'units': 294, 'waitingMonths': 33}
assert A['Ping Yi Court']['prices']['2RF1']['sqm'] == 40 and A['Ping Yi Court']['prices']['2RF2']['sqm'] == 48
assert A['Ping Yi Court']['resaleComparables']['4RM'] == {'min': 745000, 'max': 845000}
assert set(A['Mount Pleasant Crest']['prices']) >= {'2RF1', '2RF2', '3RM', '4RM'}
assert 'Chencharu Grove' in A and A['Chencharu Grove']['prices']['5RM']['units'] == 236
assert A['Berlayar Residences']['prices']['4RM']['min'] > 0
print('ok')
```
- [ ] **Step 2: Run** `PYTHONPATH=. python3 test/prices_test.py` — Expected: ImportError.
- [ ] **Step 3: Implement `parse_annex`** — `pdftotext -layout`; Table A(1)(a): rows carry flat type + floor area + internal area + units + `$a - $b`; project name and waiting months appear on one of the rows of their block (carry forward until the next name). Comparables tables: header "Prices of <name> and Resale Comparables Nearby", two `$a - $b` per flat-type row (first = BTO, second = resale).
- [ ] **Step 4: Run test** — Expected: `ok`.
- [ ] **Step 5: Download Feb/Jun annexes, run CLI on all three** — Expected: summary lists 22 projects with prices (Redhill Peaks II has no project folder → listed as unmatched), zero other unmatched.

### Task 2: Stack layout extraction from brochures

**Files:**
- Create: `tools/extract_layouts.py`
- Create: `test/layouts_test.py`
- Cache: `reference/hdb/brochures/<slug>.pdf` (URL `https://btohq.sgp1.cdn.digitaloceanspaces.com/bto/<launch>/<slug>.pdf`, launch from `reference/hdb/launched.json`; `curl -A "Mozilla/5.0"`)

**Interfaces:**
- Produces: `extract(slug: str) -> dict[str, dict]` = `{stack: {"typical": "layouts/<stack>.png", "lowest"?: "layouts/<stack>-low.png", "page": int}}`; writes PNGs and `project.json["layouts"]`; CLI `python3 tools/extract_layouts.py <slug>...` prints `<slug>: N/M stacks` and the missing stack numbers.

- [ ] **Step 1: Write failing test** `test/layouts_test.py`:
```python
import json
from tools.extract_layouts import extract
L = extract('kebun-baru-breeze')
P = json.load(open('projects/kebun-baru-breeze/project.json'))
assert set(L) == {str(s['no']) for s in P['stacks']}          # every stack, once
assert 'lowest' in L['239'] and L['239']['typical'] != L['239']['lowest']   # 248A has 2ND and 3RD-30TH pages
from PIL import Image
w, h = Image.open('projects/kebun-baru-breeze/' + L['201']['typical']).size
assert 250 < w < 1600 and 250 < h < 1600                      # one unit, not the whole page
print('ok')
```
- [ ] **Step 2: Run** `PYTHONPATH=. python3 test/layouts_test.py` — Expected: ImportError.
- [ ] **Step 3: Implement** — floor-plan pages: text matches `BLOCK\s+(\S+)\s*\|\s*(.+?)\s+FLOOR PLAN`; storey span parsed from "2ND STOREY" (1 floor) vs "3RD TO 30TH STOREY" (range) — the widest range is `typical`, a page whose range starts at the block's lowest storey and is narrower is `lowest`. Unit labels from `pdftotext -bbox-layout` words `UNIT` followed by a number. Crop: render page at 200 dpi; around each label take the cell of a Voronoi-style split between neighbouring labels, then shrink to the bounding box of non-white pixels in that cell connected to the drawing nearest the label (unit labels sit outside the plan, next to it). Pad 12 px.
- [ ] **Step 4: Run test** — Expected: `ok`. Open three crops (`201`, `219`, `239`) and confirm each shows exactly one unit with its "UNIT nnn" label.
- [ ] **Step 5: Run CLI on all 22 launched projects; record per-project N/M in `docs/superpowers/progress.md`.** Expected: every project ≥ 95% stacks; list the rest.

### Task 3: App — price block, layout modal, table column

**Files:**
- Modify: `web/app.js` (`renderUnitCard`, `renderTable`, hasLayout branch), `web/index.html` (add `<dialog id="layoutDlg">`), `web/style.css`
- Create: `test/format_test.mjs`, `web/format.js`

**Interfaces:**
- Consumes: `P.prices`, `P.resaleComparables`, `P.layouts` from Tasks 1–2.
- Produces: `web/format.js` exports `money(n: number) -> string` ("$592k", "$1.2m") and `range(min, max) -> string` ("$592k–$810k").

- [ ] **Step 1: Failing test** `test/format_test.mjs`:
```js
import assert from 'node:assert/strict';
import { money, range } from '../web/format.js';
assert.equal(money(592000), '$592k'); assert.equal(money(1200000), '$1.2m'); assert.equal(money(1038000), '$1.04m');
assert.equal(range(592000, 810000), '$592k–$810k');
console.log('ok');
```
- [ ] **Step 2: Run** `node test/format_test.mjs` — Expected: module not found.
- [ ] **Step 3: Implement `format.js`**; then in the unit card add a "Price" block (`range(min,max)` "HDB launch range", "from <money(afterGrantsFrom)> after grants" when present, `sqm` and `waitingMonths`, "Resale nearby <range>" when present) and a layout thumbnail (`<img>` of `layouts[stack].typical`) opening `#layoutDlg` with a Typical/Lowest toggle when `lowest` exists; missing → the exact placeholder text. Table: add "Price" column = `range` of the stack's flat type (RENT → "—"). Upcoming projects: the exact upcoming text in `#upcomingCard`.
- [ ] **Step 4: Run** `node test/format_test.mjs && node test/sun.test.js` — Expected: `ok` and the Thomson parity line.
- [ ] **Step 5: Playwright sweep** (server on :8782): for each launched project select the first table row → assert card text contains "HDB launch range" and `img` `naturalWidth > 0`; open dialog, press Escape, dialog closed; then select a stack with no layout (if any) and assert the placeholder text and no `img`. Upcoming projects: card contains the upcoming text. Expected: all pass, no page errors.
