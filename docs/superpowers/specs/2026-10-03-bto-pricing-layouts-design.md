# BTO pricing and unit layouts — design (sub-project A)

Approved in chat 2026-10-03. Sub-project B (HDB resale information) follows separately.

## Goal
When a buyer selects a unit in a launched BTO project, show what HDB officially published about its price and the
exact floor plan of that stack.

## Decisions
- **Pricing = official HDB figures only.** Per flat type: launch price range, starting price after the illustrative
  Enhanced CPF Housing Grant, floor area, estimated waiting time, and HDB's nearby resale comparables. No per-unit
  estimates (HDB's unit-level prices are only on the Singpass-gated Flat Portal during booking; not used).
- **Layout = the clicked stack's own floor plan**, cropped from the block floor-plan pages of the project's HDB sales
  brochure, so orientation and mirroring are correct. No variant matching by hand.
- HDB owns copyright in brochure plans; BTOlab is a local/personal tool. Publishing it publicly would need HDB's
  permission or linking out instead of embedding plans.

## Sources
- Launch annexes (PDF, hdb.gov.sg press releases): Oct 2025, Feb 2026, Jun 2026 — "Table A(1)(a) Flat Supply and
  Pricing Details" (project, waiting time, flat type, floor area, internal floor area, units, price range) and
  "Prices of <project> and Resale Comparables Nearby" tables. Grant-adjusted starting prices from the press release
  text / Table 3.
- Sales brochures (PDF, one per project; mirror on btohq CDN, already used for site plans): block floor-plan pages
  titled "BLOCK <blk> | <storeys> FLOOR PLAN" with each unit labelled "UNIT <stack>" in vector text.

## Data model (project.json additions)
```
"prices": {"4RM": {"min": 592000, "max": 810000, "afterGrantsFrom": 537000, "sqm": 93, "internalSqm": 90,
                    "waitingMonths": 49, "units": 1100}, ...},          // keyed by our flat-type codes
"resaleComparables": {"4RM": {"min": 848000, "max": 1200000}, ...},   // absent where HDB lists none
"layouts": {"219": {"typical": "layouts/219.png", "lowest": "layouts/219-low.png", "page": 12}}
```
Flat-type mapping: 2-room Flexi (Type 1/2) -> 2RF1/2RF2 (annex lists the two by floor area: smaller = Type 1),
3-room -> 3RM, 4-room -> 4RM, 5-room -> 5RM, 3Gen -> 3GEN, Community Care Apartment -> CCA. Rental has no price.

## Components
1. `tools/fetch_prices.py <annex.pdf>...` — pdftotext -layout, parse the supply/pricing table and the per-project
   comparables tables; match project names to catalogue slugs (exact name, case-insensitive); write `prices` and
   `resaleComparables`. Prints a per-project summary; unmatched rows are listed, not dropped silently.
2. `tools/extract_layouts.py projects/<slug>` — download brochure (cache in reference/hdb/brochures/), find pages whose
   text matches `BLOCK <blk> | ... FLOOR PLAN`; on each, locate `UNIT <n>` words via `pdftotext -bbox`; crop the
   unit drawing around the label (bounded by the neighbouring units' labels and the drawing frame) from a 200 dpi
   render; save PNG; prefer the page covering the most storeys as `typical`, a separate lowest-storey page as
   `lowest`. Report stacks with no label found.
3. App (`web/app.js`, `web/style.css`, `web/index.html`):
   - Unit card: "Price" block (range, after-grants, sqm, waiting time, resale nearby) and a layout thumbnail that
     opens a full-size modal (`<dialog>`, Esc/backdrop closes, typical vs lowest-storey toggle when both exist).
   - Stack table: "Price" column with the flat type's range (e.g. "$592–810k").
   - Upcoming projects: card text "Prices and layouts are released at HDB's sales launch."
   - Missing data for a stack: show "Layout not available in HDB brochure" — never another stack's plan.

## Testing
- `test/prices.test.js`: parse the Oct 2025 annex; assert Ping Yi Court 4-room = $498,000–$624,000, 93 sqm, 294
  units; Mount Pleasant Crest present with 2RF1/2RF2/3RM/4RM.
- Extraction report: per project, stacks with a layout / total stacks; target 100% for every launched project,
  failures listed in docs/superpowers/progress.md.
- Playwright sweep over all launched projects: select first stack; card shows a price and a loaded layout image;
  modal opens and closes; no console errors.

## Out of scope
Per-unit price estimates; resale transactions (sub-project B); interior 3D of layouts.
