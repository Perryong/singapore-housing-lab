# 3D Floor Plan Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Each stack with a floor plan gets a 3D "dollhouse" of its own flat, shown in the floor-plan pop-up.

**Architecture:** A Python tool reads the stack's brochure page (300 DPI render + PDF text) into rooms and wall
polygons in metres (`plans3d/<stack>.json`); headless Blender extrudes that into a GLB; the app's floor-plan dialog
gets a 2D | 3D toggle with a small three.js viewer.

**Tech Stack:** Python 3 + OpenCV/numpy (as `tools/extract_layouts.py`), pdftotext/pdftoppm/tesseract, Blender 5.2
headless (+ Blender MCP for look-dev), three.js 0.170, Playwright MCP.

**Spec:** `docs/superpowers/specs/2026-10-06-floorplan-3d-design.md`

## Global Constraints

- Never show another stack's flat: a stack gets a model only from its own `layouts[no].page` and its own `UNIT <no>` label.
- Walls 2.8 m; window openings sill 1.0 m, head 2.1 m; no ceiling.
- Room types: `bedroom`, `living`, `kitchen`, `bath`, `yard`, `shelter`, `ledge`, `other`.
- Bedrooms required per flat type: 2RF1/2RF2 1, 3RM 2, 4RM 3, 5RM 3, 3GEN 4; plus living, kitchen, bath. CCA/RENT: no model.
- Scale gate: a stack's pxPerM within 12% of the median pxPerM of the stacks on its page.
- Pop-up credit text: `Floor plan © HDB`. Loading text: `Building 3D view…`.
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Brochure PDFs stay out of git.

## Review Focus

- Mirrored neighbours sharing one fill (KKC 584/586): rooms must split at the party wall — Task 1 test.
- Scanned brochure pages (no text layer, e.g. Bishan Terraces p.14): extraction returns a plan or a reason string, never raises — Task 1 test.
- Two rows of units on one page (labels above the top row, below the bottom row): a label claims only the fill region adjacent to it — Task 1 test on KKC page 13 (stacks in both rows).
- Rapid open/close or switching stacks while a GLB loads: old viewer disposed, at most one live WebGL viewer, no errors — Task 4 Playwright step.
- Door swing arcs drawn as solid lines would become walls: small or thin curved components are dropped — Task 2 Blender MCP look check on the pilots (visible as stray walls).

---

### Task 1: Extract rooms and walls from the brochure

**Files:**
- Create: `tools/extract_plan3d.py`, `test/plan3d_test.py`
- Modify: `docs/superpowers/specs/2026-10-06-floorplan-3d-design.md` (walls as polygons; test wording)

**Interfaces:**
- Consumes: `tools/extract_layouts.py` — `brochure(slug) -> Path`, `pages(pdf) -> [(page_no, w_pt, h_pt, words)]`,
  `ocr_words(png, k) -> words`; `project.json` `layouts`, `stacks` (`no`, `type`, `faces`), `prices[code].internalSqm`.
- Produces:
  - `extract_page(slug: str, page: int) -> dict[str, dict | str]` — every stack whose `layouts[no].page == page`
    maps to a plan dict or a failure-reason string.
  - Plan dict: `{"stack", "page", "bboxPx": [x0,y0,x1,y1] (300 DPI page px), "scale": {"pxPerM", "targetSqm"},
    "rooms": [{"type", "name", "poly": [[x,z]...], "label": [x,z]}], "walls": [{"poly": [[x,z]...], "kind": "solid"|"window"|"partition"}],
    "north": float}` — metres, origin at bbox centre, x right, z down the page; `north` = compass bearing of page-up.
  - `extract_project(slug: str) -> (int, dict[str, str])` — writes `projects/<slug>/plans3d/<no>.json` for passing
    stacks, deletes stale JSONs, returns (count written, {stack: reason}).
  - CLI: `python3 tools/extract_plan3d.py <slug>...` prints `<slug>: <n>/<with plan> stacks` and reasons.

- [ ] **Step 1: Failing test** `test/plan3d_test.py` (skip if `reference/hdb/brochures/kim-keat-crest.pdf` missing):
```python
R = extract_page('kim-keat-crest', 13)
p, q = R['584'], R['586']
assert isinstance(p, dict) and isinstance(q, dict), (p if isinstance(p, str) else q)
types = [r['type'] for r in p['rooms']]
assert types.count('bedroom') == 3 and types.count('bath') == 2
assert {'living', 'kitchen', 'yard', 'shelter'} <= set(types)
assert abs(p['bboxPx'][2] - 850) < 15 and abs(q['bboxPx'][0] - 850) < 15     # split on the shared living-room wall
assert abs(p['scale']['pxPerM'] - q['scale']['pxPerM']) / p['scale']['pxPerM'] < 0.03   # mirror pair, same scale
assert p['north'] == 180                                                     # windows (page-up side) face 180°
assert any(w['kind'] == 'window' for w in p['walls']) and any(w['kind'] == 'solid' for w in p['walls'])
assert all(isinstance(v, (dict, str)) for v in R.values()) and len(R) >= 4   # both rows of units on the page
S = extract_page('bishan-terraces', 14)                                      # scanned page: plan or reason, no exception
assert S and all(isinstance(v, (dict, str)) for v in S.values())
print('ok')
```
- [ ] **Step 2: Run** `PYTHONPATH=. python3 test/plan3d_test.py` — Expected: ImportError.
- [ ] **Step 3: Implement** `extract_page` / `extract_project` / CLI. Algorithm:
  1. `pdftoppm -r 300` the page into `reference/hdb/brochures/.render/plan3d-<slug>-<page>.png`; words from
     `pages()` scaled by 300/72, or `ocr_words` when the page has no `UNIT` words.
  2. Line mask = pixels with V < 110 (HSV). Fill mask = coloured, non-line pixels (S > 40, V > 150).
  3. For each `UNIT <no>` label: the fill component (8-connected, area > 20k px) whose nearest pixel is within
     150 px of the label box, above or below. Labels sharing a component: split that component's rooms (regions of
     fill bounded by the line mask, area > 400 px) by nearest label x-centre.
  4. Rooms: name = PDF/OCR words inside the room polygon joined; type by keywords
     (BEDROOM→bedroom, LIVING|DINING→living, KITCHEN→kitchen, BATH|WC→bath, YARD→yard, SHELTER→shelter,
     LEDGE→ledge, else other). Unit mask = union of the stack's rooms, closed with a 15 px kernel (fills walls).
  5. Walls = line mask ∩ unit mask dilated 12 px. Distance transform: stroke ≥ 9 px → `solid`; thinner on the
     unit mask's outer ring → `window`; thinner inside → `partition`. Drop components < 150 px (dashed swings).
     Polygons via `cv2.findContours` + `approxPolyDP(eps=1.5)`.
  6. pxPerM = sqrt(area(unit mask minus ledge rooms) / internalSqm) of the stack's flat type
     (`catOf`-style: stack `type` → `prices[type]`); gate vs page median (Global Constraints); required rooms
     per type; bbox touching the page edge → reason.
  7. `north`: side of the bbox with the most `window` length is the window side; page-up bearing =
     `faces[0] - {top: 0, right: 90, bottom: 180, left: 270}[side]` mod 360.
  Update the spec's Data section (walls are polygons with `kind`) and Testing line (mirror-pair scale instead of area).
- [ ] **Step 4: Run test** — Expected: `ok`. Run CLI on `kim-keat-crest` and look at one debug overlay
  (`--debug` writes `.render/plan3d-<slug>-<no>.png` with rooms tinted, walls by kind).
- [ ] **Step 5: Commit** `tools/extract_plan3d.py test/plan3d_test.py docs/superpowers/specs/2026-10-06-floorplan-3d-design.md` — "feat: extract rooms and walls of each stack's floor plan".

### Task 2: Blender model per stack

**Files:**
- Create: `blender/build_plan3d.py`, `test/plan3d_glb_test.py`

**Interfaces:**
- Consumes: Task 1 plan JSON.
- Produces: `blender -b --factory-startup -P blender/build_plan3d.py -- <in.json> <out.glb>`; GLB in Y-up metres,
  origin at plan centre, floors named `room:<type>:<i>` (slab 0.05 m), walls one mesh `walls` (window walls as
  0–1.0 m and 2.1–2.8 m pieces), vertex colours with baked AO, room colour per type defined once in this file.

- [ ] **Step 1: Failing test** `test/plan3d_glb_test.py`: builds the KKC 584 JSON with Blender into a temp GLB, reads
  the GLB JSON chunk, asserts: a node named `walls`; ≥ 8 nodes starting `room:`; walls accessor max y in
  [2.75, 2.85]; walls x/z extent within 2% of the JSON's room-polygon extent. Skips if `blender` isn't on PATH.
- [ ] **Step 2: Run** — Expected: FAIL (script missing).
- [ ] **Step 3: Implement** with bmesh extrusion (as `blender/build_model.py`); AO bake to a colour attribute; glTF
  export with `export_vertex_color`. Use Blender MCP on the four pilots (KKC 584 4RM, a 3RM, a 2RF, a corner 5RM)
  to tune colours, wall tone and camera framing; check with viewport screenshots; fix stray walls from Task 1.
- [ ] **Step 4: Run test** — Expected: `ok`.
- [ ] **Step 5: Commit** `blender/build_plan3d.py test/plan3d_glb_test.py` — "feat: Blender dollhouse model per stack".

### Task 3: Batch for all projects + coverage

**Files:**
- Create: `tools/build_plan3d.js`
- Modify: `projects/*/project.json` (`plans3d`), `projects/*/plans3d/*`, `docs/superpowers/progress.md`, `.github/workflows/test.yml`

**Interfaces:**
- Consumes: Task 1 CLI, Task 2 Blender script.
- Produces: `node tools/build_plan3d.js projects/<id>...` → runs extraction, builds a GLB per JSON (skips when GLB is
  newer than JSON), sets `project.json["plans3d"] = [stack numbers as strings]`, prints counts.

- [ ] **Step 1: Run** on all 22 launched projects. Expected: every project prints; overall stacks with 3D / stacks
  with a plan ≥ 70%.
- [ ] **Step 2: Record** the per-project table and top failure reasons in `docs/superpowers/progress.md`.
- [ ] **Step 3: CI** — add `test/plan3d_test.py` (self-skipping) to the Python step.
- [ ] **Step 4: Commit** the tool, data, GLBs, progress — "feat: 3D floor plans for all projects".

### Task 4: App — 2D | 3D in the floor-plan dialog

**Files:**
- Create: `web/plan3d.js`
- Modify: `web/index.html` (toggle, canvas holder, credit), `web/app.js` (`openLayout`), `web/style.css`

**Interfaces:**
- Consumes: `project.json["plans3d"]`, `projects/<id>/plans3d/<no>.glb`.
- Produces: `export function openPlan3d(holder: HTMLElement, url: string, north: number): Promise<{reset(): void, dispose(): void}>`
  (own WebGLRenderer + OrbitControls, hemisphere + soft directional light, north arrow, rejects on load failure);
  `window.__plan3dViewers` = live viewer count (test hook).

- [ ] **Step 1: Implement** — `openLayout(no)`: if `plans3d` has the stack, show the 3D tab active with
  `Building 3D view…` until resolved; on reject switch to 2D. Toggle buttons `2D` / `3D`, `Reset view`. Closing the
  dialog or opening another stack disposes the viewer. Credit `Floor plan © HDB` under both views. Bump `?v=`.
- [ ] **Step 2: Playwright sweep** (server :8782): for every stack in `plans3d` across all projects, open its plan →
  3D canvas present within 5 s, no page errors; one stack per project without a model → 2D image shown; open/close
  the dialog 20 times on KKC 584 → `__plan3dViewers <= 1`, no errors. Screenshot the four pilots.
- [ ] **Step 3: Commit** `web/plan3d.js web/app.js web/index.html web/style.css` — "feat: 3D floor plan view".
