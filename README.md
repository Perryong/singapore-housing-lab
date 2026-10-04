# singapore-housing-lab

Interactive sun study for Singapore HDB BTO projects: which stacks get
morning or afternoon sun, hour by hour. The header always shows which project and launch is on screen;
"Change project" opens the catalogue (grouped by launch, upcoming on top, searchable).

Covered: every BTO launched in Oct 2025, Feb 2026 and Jun 2026 (except Redhill Peaks II — site plan not
available), and the 7 upcoming Oct 2026 sites ("Layout not released": site pin + existing HDB blocks only).

```
projects/index.json          catalogue (node tools/make_index.js)
projects/<id>/project.json   site, plan scale/north, blocks, stacks, unit types, neighbouring blocks
projects/<id>/trace.json     what was read off HDB's site plan (BTOs)
projects/<id>/siteplan.jpg   site plan laid on the ground
projects/<id>/model.glb      generated — do not edit (node tools/build.js projects/<id>)
web/                         the app (no build step): open /web/ or /web/?p=<id>
blender/build_model.py       layout.json -> study model GLB (unit bodies carry a _UNIT attribute for colouring)
tools/                       derive, build, trace_siteplan, find_scalebar, grid_tiles, fetch_context,
                             make_bto_project, make_upcoming, make_index
test/sun.test.js             ported logic must reproduce the original Thomson Reserve table (kept out of the catalogue)
```

## Run

```
python3 -m http.server 8781          # then open http://localhost:8781/web/
node test/sun.test.js
```

## Add a launched BTO

1. Put HDB's site plan in `reference/hdb/siteplans/<slug>.jpg` and an entry in `reference/hdb/launched.json`.
2. `python3 tools/find_scalebar.py <plan> x0 y0 x1 y1` → scale bar ends; write `projects/<slug>/trace.json`
   (planBox, scale, legend swatch points per flat type).
3. `python3 tools/trace_siteplan.py projects/<slug> --regions` → `regions.png`; name each stack by region id
   (`"r12"`, or `"r12.a"`/`"r12.b"` for the left/right half of a shared region) or a full-image point; add
   `types` overrides where colour matching is ambiguous. Run without `--regions` and check `trace-debug.png` and
   the flat-type counts against HDB's block table.
4. `python3 tools/make_bto_project.py <slug>` (approximate georeference + neighbouring HDB blocks from data.gov.sg/OneMap).
5. Align the neighbours to the plan: `python3 tools/register_context.py projects/<slug> --apply` fits the footprints onto
   the existing blocks drawn on the sheet (accepted only when ≥65% of on-sheet edges land on drawn outlines). If it
   can't, pin with printed block numbers — `python3 tools/anchor_fit.py projects/<slug> 269:298,964 266:329,1436`
   (block : plan pixel of its label) — then `register_context.py --range 25 --apply`. Check with
   `python3 tools/overlay_context.py projects/<slug> out.png`; `python3 tools/drop_overlaps.py projects/<slug>` removes
   demolished blocks under the new towers.
6. Amenities: `python3 tools/trace_facilities.py projects/<slug>` reads the numbered estate facilities off the site plan
   (legend + markers, OCR); `python3 tools/fetch_amenities.py projects/<slug>` adds nearby MRT/LRT, bus stops,
   schools, preschools, hawker centres, supermarkets, clinics, parks, libraries and CCs from
   `reference/amenities/all.json` (built by `python3 tools/build_amenities.py` from data.gov.sg + OneMap).
7. `node tools/build.js projects/<slug>`, `node tools/make_index.js`.

Projects live outside `~/Documents`: macOS revokes access when Blender is launched on files there.

## Limits

- Shading is tested against simple boxes (as in the original), not the balcony detail in the GLB.
- Stepped blocks are modelled at their tallest height; HDB's plans don't say which stacks step down.
- Neighbouring blocks are fitted to the plan where the sheet draws them; greenfield sheets (e.g. Sembawang, Mount
  Pleasant) show none, so those sites keep their address/pin placement (typically within ~20 m).
- Base map: OneMap Grey tiles © Singapore Land Authority, loaded live around each site.
- Amenity distances are straight-line from the site centre, not walking routes; facility numbers are OCR'd from the
  site plan and can occasionally be misread.

## Data not in this repo
HDB's site plans, sales brochures and launch annexes are not committed. After cloning, re-create them locally:
download site plans (`reference/hdb/launched.json` lists the projects), then run `tools/trace_siteplan.py` (writes
`siteplan.jpg`). Until then the app runs without the site-plan overlay. Open data (HDB buildings / property
information, amenity layers, resale prices) is re-downloaded from data.gov.sg by the tools.

Each stack's floor-plan crop (`projects/<id>/layouts/`, cut from HDB's sales brochure by `tools/extract_layouts.py`)
is committed so the deployed site can show it; the unit card also links to the page in HDB's own published brochure
(`project.json["brochure"]`, assets.hdb.gov.sg). Floor plans © Housing & Development Board.
