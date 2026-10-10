# Value tab — machine-learning resale estimate (design)

Approved direction in chat 2026-10-10: estimate the resale value of the selected unit; show it in a new "Value" tab
in the side panel; gradient-boosted trees trained offline, estimates precomputed per stack and floor.

## Goal
For a BTO unit, answer "what would a flat like this sell for on the resale market today, once it can be sold?" and
show it next to HDB's launch price, with what drives the value and how accurate the estimate is.

## What the user sees
- The right panel gets two tabs: **Sun** (today's content: unit card, stack table) and **Value**. Upcoming projects
  (no stacks) show Value only for their flat types at the site, without per-stack detail.
- Value tab, with a unit selected:
  - **Estimated resale value** `$X` and a range `$low–$high` (10th–90th percentile models), labelled
    "a flat like this, resold today with ~94 years of lease left".
  - **Gap vs BTO**: estimate minus the launch range for the unit's flat type ("≈ $210k above the BTO price").
  - **What drives it**: three bars in dollars: *location* (this site vs the island-wide average flat of the same type),
    *floor* (this floor vs floor 8), *size* (this unit's sqm vs the type's typical sqm).
  - **Accuracy**: "Typical error ±N% on recent sales the model did not see" (from the validation below).
  - **Caveat** for Plus and Prime flats: "HDB Plus/Prime flats have a 10-year minimum occupation period and a subsidy
    clawback on resale; this estimate ignores both."
- Value tab without a selection: a table of every stack (stack, block, type, floor band, estimate) sortable by estimate,
  clicking a row selects the unit (same as the Sun table).
- Source line: "Model trained on HDB resale transactions (data.gov.sg), 2017–<asOf>. Estimate, not a valuation."

## Model
- **Data**: `reference/resale/resale.csv` (data.gov.sg `d_8b84c4ee58e3cfc0ece0d773c8ca6abc`; 241,920 sales,
  2017-01 to 2026-10; flat types 1-room to multi-generation).
- **Target**: log(resale price), adjusted to today's market by including `month` as a feature and predicting at
  `asOf`.
- **Features** (per sale):
  - flat type, floor area (sqm), flat model, storey (middle of the storey range), remaining lease (years), month index;
  - location of the block: distance to the nearest MRT/LRT station, to Raffles Place (CBD), to the nearest mall,
    nearest hawker centre, count of primary schools within 1 km, town.
- **Algorithm**: scikit-learn `HistGradientBoostingRegressor` (point estimate, squared error on log price) plus two
  quantile models (loss `quantile`, 0.1 and 0.9) for the range. scikit-learn is a new dependency of the offline tools
  only; the website loads nothing new.
- **Validation**: train on sales up to 6 months before `asOf`; test on the last 6 months. Report median absolute
  percentage error (MdAPE) and the share of test sales inside the 10–90 range. Targets: MdAPE ≤ 7%, coverage
  70–90%. Numbers are stored with the estimates and shown in the tab.
- **Estimates for BTO units**: for each stack × floor (`first`..`floors`), predict with: the stack's flat type, its
  HDB floor area (`prices[code].sqm`), flat model = the most common model among resale flats of that type with lease
  commencing 2015 or later, storey = floor,
  remaining lease 94 years, month = asOf, location features of the stack's block. Drivers come from re-predicting with
  one input changed (location features set to the island-wide median for that flat type; floor = 8; sqm = type median).

## Geocoding resale blocks
Location features need coordinates for the ~9,755 unique (block, street) pairs in the resale data.
- First pass: OpenStreetMap buildings with `addr:housenumber` + `addr:street` (Overpass), matched on normalised
  block + street (`norm()` from `tools/fetch_context.py`).
- Rest: OneMap search `"<block> <street>"`, polite rate with backoff, cached in `reference/resale/geocode.json`
  (git-ignored like the other raw data); run once in the background.
- Sales whose block cannot be geocoded are dropped from training and counted in the report.

## Components
1. `tools/geocode_resale.py` — builds `reference/resale/geocode.json` (OSM pass, then OneMap); resumable.
2. `tools/train_value.py` — features, training, validation; writes `reference/resale/value-model.pkl` (local) and
   `reference/resale/value-metrics.json`; then for every project writes `project.json["value"]`:
   `{asOf, metrics: {mdape, coverage, nTrain, nTest}, byStack: {"<stack>": {"<floor>": [est, lo, hi]}},
   drivers: {"<stack>": {location, floor, size}}, types: {"4 ROOM": [est, lo, hi], ...}}` (`types` = typical
   unit at the site for upcoming projects: floor 10, the type's median sqm among 2015+ leases).
3. App: `web/value.js` (pure helpers: format the gap, driver bars) + Value tab wiring in `web/app.js`,
   `web/index.html`, `web/style.css`.

## Testing
- `test/value_test.py` (skips without the resale CSV): feature builder on a fixed sample (storey midpoint, lease
  years, distances); a trained model on a small slice predicts within 15% on its own held-out rows; quantile range
  contains the point estimate.
- `test/value_ui_test.mjs`: gap and driver formatting.
- Metrics gate: MdAPE ≤ 7% and coverage 70–90% on the last 6 months; failing numbers are reported, not hidden.
- Playwright: every project's Value tab renders (estimate, range, gap where launched, accuracy line), selecting a row
  selects the unit, switching tabs keeps the selection, no page errors.

## Out of scope
Forecasting future prices; private property; valuing a specific resale flat entered by the user (any-flat calculator);
grants/clawback arithmetic.
