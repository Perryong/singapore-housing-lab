# Resale value model

The Value tab estimates what a BTO unit would resell for today. Numbers below were produced by
`tools/eval_value.py` and are stored in [`eval.json`](eval.json).

## Data

- **Sales:** every HDB resale transaction from Jan 2017 to Oct 2026 (data.gov.sg), about 242,000 sales.
- **Location:** each block's coordinates come from OneMap (`tools/geocode_resale.py`). Every sale was matched to a location; none were dropped.
- **Amenities:** MRT/LRT stations, malls, hawker centres and primary schools (`reference/amenities/all.json`).

## Features

| Group | Features |
|---|---|
| Unit | flat type, flat model, floor area, middle of the storey range, remaining lease |
| Time | sale month (so the model learns the market trend) |
| Location | town, distance to the nearest MRT/LRT station, mall and hawker centre, distance to Raffles Place, number of primary schools within 1 km |

## Model

- **Algorithm:** gradient-boosted trees (scikit-learn `HistGradientBoostingRegressor`, 500 iterations, native categorical splits). The target is `log(price)`, so errors are relative.
- **Price range:** an 80% range built with split conformal prediction plus a drift allowance (see *Calibrating the
  price range* below).

## Validation: time-based split

Training uses every sale up to the cut-off. Testing uses the **6 months after** the cut-off. This is the way the model is
used in practice (it prices the future from the past). A random split would leak each block's own recent sales into
training and make the error look smaller than it is.

**Latest test window: 11,878 sales the model never saw.**

| Method | Median absolute % error |
|---|---|
| **Gradient-boosted model** | **3.0%** |
| Linear model (Ridge, same features) | 6.5% |
| Town × flat-type median price (last 12 months) | 9.2% |
| Town × flat-type median $/sqm × floor area | 9.6% |

- 71% of estimates are within 5% of the actual price, and 93% are within 10%.
- The calibrated price range contains the actual price **80.5%** of the time. The target is 80%.

![Estimate vs actual](pred-vs-actual.svg)

## Calibrating the price range

The range is the band of `log(actual / estimate)` measured on sales the model never saw: months 1–3 after the training
cut-off set the band, and months 4–6 check it.

A plain 10th–90th percentile band held only **77%** of the later sales. Prices spread out more in the months after
the calibration window than within it, so a band fitted on months 1–3 is too narrow for months 4–6. Re-centring the
band or fitting one band per flat type didn't help (77.2–77.3%).

**The fix: split conformal prediction with a drift allowance (`tools/train_value.py`).**
1. On 4 earlier windows (cut-offs 6, 12, 18 and 24 months before the latest), find the tail level whose months-1–3
   band holds 80% of months 4–6. The levels were 7.0%, 8.0%, 9.25% and 9.0%.
2. Use their mean (8.3%) on the latest window, and check it on that window's months 4–6. The latest window played
   no part in choosing the level.

| Band | Holds (latest months 4–6) | Median width |
|---|---|---|
| Plain 10–90% | 77.2% | 12.0% of the estimate |
| **Drift-adjusted (8.3–91.7%)** | **80.5%** | 13.2% of the estimate |

The estimates themselves are unchanged; only the ranges are wider. `test/model_eval_test.py` fails the build if the
coverage leaves 78–85%.

**Still uneven:** coverage was lower for 5-room (72%) and Executive (74%) flats than for 4-room (81%), measured with
the plain band. A per-type drift allowance would need more sales per window than these types have.

## Stable over time (backtest)

The same split was repeated at earlier cut-offs. Each run trains a fresh model that never sees its 6 test months.

| Test window | Sales | Median % error |
|---|---|---|
| Nov 2023 – Apr 2024 | 13,292 | 3.3% |
| May 2024 – Oct 2024 | 14,631 | 3.7% |
| Nov 2024 – Apr 2025 | 12,641 | 3.2% |
| May 2025 – Oct 2025 | 12,803 | 2.9% |
| Nov 2025 – Apr 2026 | 11,657 | 2.9% |
| May 2026 – Oct 2026 (latest) | 11,878 | 3.0% |

The error stays between 2.9% and 3.7% in every window: the model does not depend on one lucky period.

## Where it is weaker

| Segment | Median % error | Why |
|---|---|---|
| Marine Parade, Bukit Timah, Central Area | 5.0–5.5% | Few sales (27–87 in the window) and very mixed blocks |
| Bukit Merah | 4.1% | Old and new blocks side by side |
| Multi-generation flats | 11.6% | Only 5 sales in the window |
| Tampines, Pasir Ris, Choa Chu Kang | 2.4–2.6% | Many similar sales |

By flat type the error is 2.9–3.3% for 2-room to Executive. By floor it is 3.0–3.2% for every band from low to 25+ floors.
The full table is in `eval.json`.

## Limits

- A BTO unit has no sales history of its own. The model prices a similar resale flat in the same place, valued as if
  it were sold today with a full lease. It is not a forecast of the price after the 5-year minimum occupation period.
- Missing features: the view, noise, renovation and exact orientation. The town median of these is absorbed into the town feature.
- Towns with no resale history (for example Tengah) borrow the nearest town that has sales (`tools/train_value.py`).

## Reproduce

```bash
python3 tools/train_value.py train      # model + value-metrics.json
python3 tools/eval_value.py             # baselines, segments, backtest -> docs/model/
```

`eval_value.py` takes about 2 minutes on a laptop, because it trains 6 models of about 230k rows each.
