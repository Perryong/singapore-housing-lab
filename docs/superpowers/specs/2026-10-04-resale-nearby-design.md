# Resale nearby — design (sub-project B)

Approved in chat 2026-10-04. An island-wide resale explorer (B2) is a later, separate sub-project.

## Goal
In every project (launched and upcoming), show what HDB resale flats around the site actually sold for, so a buyer
can compare the BTO with buying resale nearby.

## Decisions
- Data is precomputed per project by an offline tool (static app, no live API calls).
- Window: transactions within **900 m** (changed from 1 km on 2026-10-04: OneMap throttling made the 900 m–1 km ring a ~2 h lookup; 900 m matches the drawn context) of the site centre in the **last 24 months** (relative to the newest month in
  the dataset). Medians need **≥ 3 sales**; otherwise show "too few sales".
- Blocks that cannot be linked to a building footprint are counted and reported, never placed at a guessed location.
- Source: data.gov.sg "Resale flat prices based on registration date from Jan-2017 onwards"
  (dataset `d_8b84c4ee58e3cfc0ece0d773c8ca6abc`; ~242k rows: month, town, flat_type, block, street_name,
  storey_range, floor_area_sqm, flat_model, lease_commence_date, remaining_lease, resale_price). Cached in
  `reference/resale/` (git-ignored, re-downloadable).

## Data model (project.json)
```
"resale": {
  "asOf": "2026-10", "radiusM": 900, "months": 24, "unlinked": 3, "linked": 1180,
  "blocks": [{"blk": "447", "street": "BRIGHT HILL DR", "x": .., "z": .., "ctx": 12, "storeys": 23,
              "lease": 1979, "types": {"4 ROOM": {"n": 7, "median": 905000, "psm": 9450,
                                                  "last": "2026-09", "lastPrice": 918000}}}],
  "summary": {"4 ROOM": {"n": 210, "median": 905000, "psm": 9400, "leaseLeft": 55}},
  "trend": {"4 ROOM": [["2024-11", 9100], ...]},           // monthly median $/sqm, months with >= 3 sales
  "sales": [{"m": "2026-10", "blk": "447", "street": "BRIGHT HILL DR", "type": "4 ROOM", "storey": "07 TO 09",
             "sqm": 92, "model": "Model A", "left": "55 years 02 months", "price": 918000}]   // 300 most recent
}
```
`ctx` = index into the project's `context` footprints (for colouring the drawn block); absent when the linked
building is outside the drawn context.

## Components
1. `tools/fetch_resale.py [--refresh] projects/<id>...` — download/cached CSV via data.gov.sg poll-download;
   link (block, street) -> HDB building footprint: normalise street abbreviations as in `tools/fetch_context.py`,
   match against footprints' (BLK_NO, OneMap road of POSTAL_COD) using the existing OneMap cache, fill gaps via
   OneMap search "<block> <street>" (cached); world x/z with `local_xz`; aggregate per the data model; print linked/
   unlinked counts per project.
2. App (`web/app.js`, `web/index.html`, `web/style.css`):
   - Mode button "Resale nearby" in "Colour units by". In this mode: context blocks with `resale` data coloured
     by median $/sqm for the selected flat type (sequential blue ramp, legend with min/max); others stay grey.
     Flat-type chips; default 4 ROOM, else the type with most sales.
   - Clicking a coloured block opens a resale card (block, street, lease year + years left, per-type table, last 10
     sales). Raycast picks context meshes — context is merged in one mesh in the GLB, so picking uses the 2D
     footprint polygons (point-in-polygon on the ground hit) rather than mesh identity.
   - Right panel in this mode: per-type summary; BTO vs resale line for the same flat type (launched projects:
     `prices` range vs resale median); 24-month trend as inline SVG; recent sales list (sortable by date / price);
     source line "HDB resale transactions, data.gov.sg, up to <asOf>".
   - BTO unit card price block: "Resale nearby (same type, 900 m): median $X" when the summary has that type.
   - Flat-type mapping BTO code -> resale type: 2RF* -> "2 ROOM", 3RM -> "3 ROOM", 4RM -> "4 ROOM", 5RM -> "5 ROOM",
     3GEN -> "MULTI-GENERATION"; CCA/RENT none.

## Testing
- `test/resale_test.py`: aggregation on a fixed in-memory sample (median, $/sqm, ≥3 rule, 900 m and 24-month filters,
  300-sale cap, newest-first); linking resolves Blk 179 Ang Mo Kio Ave 5 (resale spelling) to its footprint near Kebun Baru Ridge.
- Coverage report per project: linked / total nearby rows; target ≥ 95%, failures listed in progress.md.
- Playwright sweep (29 projects): enable "Resale nearby" -> ≥ 1 coloured block where `resale.blocks` non-empty;
  click a resale block -> card shows its block number; trend SVG present; no page errors.

## Out of scope
Island-wide explorer and existing-block sun study (B2); price predictions; private condo transactions.
