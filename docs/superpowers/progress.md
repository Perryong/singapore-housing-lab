# BTO catalogue — progress

Project moved to ~/Code/BTOlab (2026-10-03): ~/Documents is macOS-protected and launching Blender there
revoked the session's access.

## Pipeline per launched project
(small-scale sheets: `trace_siteplan.py <dir> --regions` → regions.png; name units by region id "r12" / "r12.a|b"
 in trace.json, points only for undetected units, "types" overrides for those)
1. `python3 tools/find_scalebar.py <plan> x0 y0 x1 y1` → scale p0/p1
2. read stack numbers + a point in each unit from `tools/grid_tiles.py` tiles → `projects/<slug>/trace.json`
3. `python3 tools/trace_siteplan.py projects/<slug>` → check `trace-debug.png`; flat-type counts vs HDB block table
4. `python3 tools/make_bto_project.py <slug>` (OneMap georef + context; slow: OneMap rate limit)
5. `node tools/build.js projects/<slug>`; `node tools/make_index.js`; check in browser

## Status
| project | launch | traced | assembled | model | checked |
|---|---|---|---|---|---|
| mount-pleasant-crest | Oct 2025 | ✓ 50 | ✓ (pin georef) | ✓ | ✓ |
| berlayar-rise | Jun 2026 | ✓ 48 (types = HDB table) | ✓ (6 pts, ≤14 m) | ✓ | ✓ Playwright |
| lakeview-cascadia | Jun 2026 | ✓ 47 (types = table) | ✓ (pin) | ✓ | |
| kebun-baru-breeze | Jun 2026 | ✓ 22 (types = table) | ✓ (2 pts) | ✓ | |
| kebun-baru-ridge | Jun 2026 | ✓ 26 (types = table) | ✓ (5 pts) | ✓ | |
| sembawang-portico | Jun 2026 | ✓ 37 (types = table) | ✓ (3 pts) | ✓ | |
| sembawang-brook | Jun 2026 | ✓ 48 (types = table) | ✓ | ✓ | |
| woodgrove-acres | Jun 2026 | ✓ 58 (types = table) | running | | |
| Feb 2026 ×6, Oct 2025 ×9 | | | | | |
| 7 upcoming (Oct 2026) | | n/a | ✓ | ✓ context | ✓ Playwright |

## Known gaps
- Stepped blocks (e.g. MPC 105A 15/40): all stacks at max height; HDB table doesn't say which stacks step down.
- redhill-peaks-2 site plan URL failed (404) — find on btohq page.

## 2026-10-03 status (usage limit stop)
Built + in catalogue: mount-pleasant-crest, berlayar-rise, lakeview-cascadia, kebun-baru-breeze, kebun-baru-ridge,
sembawang-portico, sembawang-brook, woodgrove-acres, tampines-nova, tampines-bliss, kim-keat-crest, sembawang-deck,
sembawang-voyage, redhill-peaks, berlayar-residences, bishan-terraces, oak-ville-amk (last 3 builds were running in background —
re-run `python3 tools/make_bto_project.py <slug> && node tools/build.js projects/<slug>` if model.glb is missing), 7 upcoming.
Next: teban-heights (trace.json has scale+legend; run --regions and name units), yishun-glade, ping-yi-court,
chencharu-grove, fernvale-plains. redhill-peaks-2: site plan 403 on btohq CDN — needs another source.
Then: node tools/make_index.js; Playwright pass over every project; update README.
Gotcha: points read from regions.png are plan-crop coords — add planBox x0,y0 before putting them in trace.json.

## 2026-10-03 complete
All 22 available launched BTOs (Oct 2025, Feb 2026, Jun 2026) traced, georeferenced, built; 7 upcoming Oct 2026
sites as "Layout not released"; Thomson Reserve reference. Playwright sweep: 30/30 load without errors, correct
badge, stack table rows = traced stacks. Outstanding: redhill-peaks-2 (site plan 403 at source).

## 2026-10-03 neighbour alignment fix
User reported neighbouring HDB blocks misaligned with the site plan. Cause: site lat/lon from map pins/addresses
off by up to ~250 m. Fitted context to plan linework (register_context.py) for 11 projects, anchored Kim Keat
Crest / Teban Heights by printed block numbers, re-placed Woodgrove Acres from OneMap. Remaining projects have no
existing blocks on their sheets (nothing to conflict). All 22 models rebuilt; Thomson Reserve untouched (test ok).

## 2026-10-03 amenities + UX
Thomson Reserve dropped from the catalogue (kept for the regression test). Selected unit: rest dimmed, flat in blue
with pulsing box, beam + label, camera eases to it, card/row highlighted. OneMap Grey base map (~1.2 km) under every
site. Estate facilities OCR'd from each site plan (tools/trace_facilities.py); nearby amenities from data.gov.sg
(tools/build_amenities.py + fetch_amenities.py). Playwright sweep: 29/29 load, selection works, 22-41 amenities each.

## 2026-10-04 layout extraction coverage (for-sale stacks)
- berlayar-residences: 24/24
- berlayar-rise: 48/48
- bishan-terraces: 7/14 missing 300, 302, 306, 320, 324, 326, 328
- chencharu-grove: 51/63 missing 301, 303, 305, 307, 319, 321, 357, 359, 361, 363, 399, 401
- fernvale-plains: 29/43 missing 414, 416, 418, 420, 438, 440, 460, 462, 464, 466, 468, 486, 488, 498
- kebun-baru-breeze: 20/20
- kebun-baru-ridge: 26/26
- kim-keat-crest: 34/42 missing 640, 642, 644, 650, 652, 654, 656, 658
- lakeview-cascadia: 45/47 missing 319, 321
- mount-pleasant-crest: 33/41 missing 125, 127, 147, 171, 173, 195, 197, 199
- oak-ville-amk: 64/66 missing 251, 365
- ping-yi-court: 58/62 missing 577, 579, 603, 607
- redhill-peaks: 25/25
- sembawang-brook: 0/40 missing 100, 102, 104, 106, 108, 110, 112, 114, 116, 118, 120, 122, 124, 126, 128, 130, 132, 134, 136, 154, 156, 158, 160, 162, 164, 166, 168, 170, 172, 174, 176, 178, 180, 182, 184, 186, 188, 190, 192, 194
- sembawang-deck: 23/35 missing 308, 310, 328, 330, 332, 338, 350, 352, 354, 356, 366, 368
- sembawang-portico: 28/35 missing 425, 427, 443, 445, 447, 449, 469
- sembawang-voyage: 44/44
- tampines-bliss: 28/32 missing 309, 311, 333, 335
- tampines-nova: 21/21
- teban-heights: 11/18 missing 700, 702, 704, 720, 722, 732, 734
- woodgrove-acres: 41/41
- yishun-glade: 38/41 missing 132, 134, 136
- TOTAL 698/828 (84%) of for-sale stacks
- After final review: block guard removed 3 wrong-stack crops (Ping Yi Court 601/605, Fernvale Plains 482) -> 695/828; Kebun Baru Breeze waiting time corrected to 52 months.

## Resale nearby — coverage (900 m, 24 months, data.gov.sg up to 2026-10)

| Project | Blocks with sales | Sales | Footprints linked |
|---|---|---|---|
| bedok-bayshore-i-oct-2026 | 33 | 154 | 44/44 (100%) |
| bedok-bayshore-ii-oct-2026 | 21 | 103 | 31/31 (100%) |
| berlayar-residences | 45 | 305 | 68/68 (100%) |
| berlayar-rise | 47 | 315 | 70/70 (100%) |
| bishan-terraces | 148 | 621 | 207/207 (100%) |
| chencharu-grove | 106 | 364 | 125/125 (100%) |
| fernvale-plains | 55 | 543 | 89/89 (100%) |
| geylang-oct-2026 | 84 | 461 | 115/115 (100%) |
| kebun-baru-breeze | 51 | 322 | 80/80 (100%) |
| kebun-baru-ridge | 86 | 439 | 108/108 (100%) |
| kim-keat-crest | 131 | 722 | 207/207 (100%) |
| lakeview-cascadia | 15 | 74 | 19/19 (100%) |
| mount-pleasant-crest | 46 | 402 | 78/78 (100%) |
| oak-ville-amk | 69 | 379 | 95/95 (100%) |
| ping-yi-court | 93 | 560 | 129/129 (100%) |
| redhill-peaks | 75 | 416 | 143/143 (100%) |
| sembawang-brook | 35 | 243 | 49/49 (100%) |
| sembawang-deck | 80 | 426 | 109/109 (100%) |
| sembawang-oct-2026 | 78 | 434 | 104/104 (100%) |
| sembawang-portico | 51 | 322 | 71/71 (100%) |
| sembawang-voyage | 53 | 313 | 75/75 (100%) |
| tampines-bliss | 232 | 950 | 265/266 (100%) |
| tampines-nova | 212 | 1264 | 293/296 (99%) |
| teban-heights | 52 | 245 | 63/63 (100%) |
| tengah-oct-2026 | 95 | 717 | 217/217 (100%) |
| toa-payoh-caldecott-oct-2026 | 85 | 603 | 131/131 (100%) |
| woodgrove-acres | 76 | 353 | 111/111 (100%) |
| yishun-chencharu-oct-2026 | 54 | 156 | 66/66 (100%) |
| yishun-glade | 159 | 954 | 243/244 (100%) |

All projects ≥ 95% (target met).

## 3D floor plans — coverage (2026-10-06)

| Project | Stacks with 3D / with a floor plan | % |
|---|---|---|
| berlayar-residences | 24/24 | 100% |
| berlayar-rise | 48/48 | 100% |
| bishan-terraces | 0/7 | 0% |
| chencharu-grove | 43/51 | 84% |
| fernvale-plains | 1/21 | 5% |
| kebun-baru-breeze | 13/20 | 65% |
| kebun-baru-ridge | 14/26 | 54% |
| kim-keat-crest | 32/34 | 94% |
| lakeview-cascadia | 39/45 | 87% |
| mount-pleasant-crest | 22/33 | 67% |
| oak-ville-amk | 44/64 | 69% |
| ping-yi-court | 7/56 | 12% |
| redhill-peaks | 2/25 | 8% |
| sembawang-brook | 0/40 | 0% |
| sembawang-deck | 0/23 | 0% |
| sembawang-portico | 26/28 | 93% |
| sembawang-voyage | 24/44 | 55% |
| tampines-bliss | 23/28 | 82% |
| tampines-nova | 2/21 | 10% |
| teban-heights | 10/11 | 91% |
| woodgrove-acres | 32/41 | 78% |
| yishun-glade | 1/38 | 3% |

Overall 407/728 (56%), below the 70% target. Brochures with real text: 90–100%. Scanned brochures
(Bishan Terraces, Fernvale Plains, Ping Yi Court, Redhill Peaks, Sembawang Brook, Sembawang Deck, Tampines Nova,
Yishun Glade): 0–7 stacks each — room names are outlined glyphs that OCR reads only partly, and some units are drawn
rotated (walls are extracted axis-aligned). Those stacks keep the 2D floor plan.
