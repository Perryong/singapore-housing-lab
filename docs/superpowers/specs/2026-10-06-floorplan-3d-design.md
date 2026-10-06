# 3D floor plan — design

Approved in chat 2026-10-06.

## Goal
When a user expands a stack's floor plan, let them see that stack's own flat as a 3D "dollhouse" so they can feel
the space: how big the rooms are and how they connect.

## Decisions
- Purpose: feel the space (dollhouse). Not furnished, no ceilings, no interior sunlight (possible later).
- Coverage: every stack that has a floor-plan crop, generated automatically. A stack whose extraction fails a quality
  check gets no 3D model and keeps the 2D image. Never show another stack's flat.
- Build: Blender (headless) turns each stack's extracted geometry into a GLB. Blender MCP is used during
  development to design and check the look on pilot stacks.
- Same copyright position as the published crops: derived from HDB's floor plans, credited "Floor plan © HDB".

## What the user sees
- The floor-plan pop-up gets a **2D | 3D** toggle; it opens on 3D when the stack has a model, else 2D (as today).
- 3D view: walls 2.8 m high, no ceiling; window openings with sill 1.0 m and head 2.1 m; doorways as gaps; floors
  tinted by room type; room names floating above each room; a small north arrow. Orbit, zoom, pan; "Reset view"
  returns to a three-quarter view from above.
- While the GLB loads: "Building 3D view…". If it fails to load: fall back to 2D silently.
- Rental stacks show no floor plan (unchanged).

## Room types and colours
`bedroom` (incl. main bedroom), `living` (living/dining), `kitchen`, `bath` (bath/WC), `yard` (service yard),
`shelter` (household shelter), `ledge` (air-con ledge), `other` (study, store, unnamed). One muted colour each,
defined once in `blender/build_plan3d.py`.

## Data
`projects/<id>/plans3d/<stack>.json` (committed):
```
{ "stack": "584", "page": 13, "bboxPx": [x0, y0, x1, y1],
  "scale": {"pxPerM": 33.3, "source": "scale bar" | "floor area", "targetSqm": 86, "areaSqm": 82.2},
  "rooms": [{"type": "bedroom", "name": "MAIN BEDROOM", "poly": [[x, z], ...], "label": [x, z]}],
  "walls": [{"rect": [x0, z0, x1, z1], "kind": "solid" | "window" | "partition"}],
  "north": 359.1 }
```
Coordinates in metres, origin at the flat's centre, x right and z down the page. Walls are axis-aligned rectangles
covering the drawn wall pixels. `north` = compass bearing of page-up, from fitting the page's unit labels onto the
same stacks on the georeferenced site plan (fallback: the stack's window side and `faces`). Scale from the page's
"SCALE 0 … 10 METRES" bar when present (then floor area must be within 15% of HDB's internal sqm), else from floor
area (then within 12% of the page's median scale). Unnamed coloured regions are rooms of type `other`.
`projects/<id>/plans3d/<stack>.glb` (committed): walls + floors, floor meshes named `room:<type>:<i>`.
`project.json["plans3d"]`: list of stacks with a model.

## Components
1. `tools/extract_plan3d.py <id>...`
   - Render the stack's typical-plan page (`layouts[stack].page`) at 300 DPI from the local brochure.
   - Line mask = dark pixels; region labelling of the non-line area gives rooms.
   - Keep the rooms whose centroids are nearest this stack's `UNIT <no>` label among the unit labels on that row
     (labels from `pdftotext -bbox`, OCR fallback as in `tools/extract_layouts.py`).
   - Room names: text inside each room; type from keywords (BEDROOM, LIVING, DINING, KITCHEN, BATH, WC, YARD,
     SHELTER, LEDGE).
   - Walls: thick dark runs = `solid`; thin parallel double lines on the flat's outer edge = `window`; thin interior
     lines = `partition`; dashed door swings ignored.
   - Scale: pxPerM so that the sum of room areas (excluding the ledge) equals `prices[code].internalSqm`.
   - Quality gate, any failure means no JSON and a printed reason: the stack's pxPerM differs by more than 12% from
     the median pxPerM of the other stacks on the same page (one drawing scale per page, so a bad region shows up
     as an outlier); required rooms missing (bedrooms per type: 2RF 1, 3RM 2, 4RM 3, 5RM 3, 3GEN 4; plus living,
     kitchen, bath); region touches the page edge.
2. `blender/build_plan3d.py <json> <glb>` (headless, `blender -b --factory-startup -P`): extrude walls, cut window
   openings, floor slabs with room colours, bake ambient occlusion into vertex colours, export GLB.
3. `tools/build_plan3d.js projects/<id>`: runs 1 and 2 for every stack of a project and writes `project.json["plans3d"]`.
4. App: `web/plan3d.js` (a small three.js viewer in its own renderer and canvas inside `#layoutDlg`), wiring in
   `web/app.js` (toggle, loading/fallback), styles in `web/style.css`.

## Testing
- `test/plan3d_test.py` (skips without the brochure): Kim Keat Crest 584 has 3 bedrooms, living, kitchen, 2 baths,
  yard and shelter; 584 and 586 (mirror pair) have the same scale; the split lies on the shared living-room wall;
  page-up is north; a scanned page returns plans or reasons without raising.
- Blender check: the pilot GLB loads; wall height 2.8 m ± 0.05; floor area within 2% of the JSON.
- Playwright sweep: for each stack with a model, opening its plan shows a 3D canvas and no page errors; stacks
  without one show the 2D image. Screenshots of the pilots: KKC 584 (4-room), a 3-room, a 2-room Flexi, a corner 5-room.
- Coverage report per project in `docs/superpowers/progress.md`: stacks with 3D / stacks with a plan, failure
  reasons. Target ≥ 70% overall; scanned brochures may be lower.

## Out of scope
Furniture, ceilings, interior sunlight, stacks without a 2D plan, rental flats.
