# sg-bus-data — self-updating Singapore bus data (design)

Approved direction in chat 2026-10-17. A new public repo that republishes LTA DataMall's static bus data as clean,
documented JSON, refreshed weekly by a GitHub Action, and becomes BTOlab's source for bus data. Inspired by the idea of
`cheeaun/sgbusdata` (a data repo kept fresh by an Action) but with its own scripts, format and docs; nothing is copied.

## Decisions
| Decision | Why |
|---|---|
| BTOlab first, public too | BTOlab no longer needs an LTA key or a local fetch; others (and sg-bus-api) can reuse it. |
| Bus stops + services only (LTA) | What the user chose. OSM bus route shapes and the MRT/LRT network stay in BTOlab's own pipeline. |
| Weekly Action commits `data/` when changed | Public URLs via raw.githubusercontent/jsDelivr; git is the change history; no extra hosting. |
| Completeness floors before writing | A half-failed LTA download must never replace good published data. |
| Deterministic output | Unchanged data → byte-identical files → no commit. |

## Part 1 — repo `sg-bus-data` (public)
- Python 3.12, `httpx`, tests with `pytest`, managed with `uv`. Code MIT; data credited "Contains information from
  LTA DataMall, made available under the Singapore Open Data Licence".
- `scripts/update.py`:
  - Fetches LTA DataMall `BusStops`, `BusRoutes`, `BusServices` (`https://datamall2.mytransport.sg/ltaodataservice/<Dataset>?$skip=N`,
    headers `AccountKey`, `accept: application/json`, 500 rows a page, stop on an empty page, timeout 60 s, 3 retries
    with backoff per page). Key from env `LTA_KEY` (or a git-ignored `.env`, same parsing rules as BTOlab's
    `tools/fetch_transit.py`). The key never appears in output, logs or files.
  - Checks before writing: ≥ 4,500 stops, ≥ 500 services (distinct ServiceNo), ≥ 20,000 route rows; every route row's
    stop exists in BusStops (rows with unknown stops are dropped and counted; > 1% dropped fails the run).
  - Writes `data/` as compact JSON (`separators=(",", ":")`, keys sorted, lists in a defined order), UTF-8, trailing
    newline:
    - `stops.json`: `[{"code","name","road","lat","lon"}]` sorted by code; lat/lon rounded to 6 dp.
    - `services.json`: `{"<ServiceNo>": {"operator","category","directions":[{"dir","from","to","loop",
      "stops":[["<code>", <distance_km>], …],"freq":{"am_peak","am_off","pm_peak","pm_off"}}]}}` — services in natural
      order, directions by `dir`, stops in `StopSequence` order; `from`/`to` are stop codes; `loop` is LTA's `LoopDesc`
      or `""`; frequency bands are LTA's strings verbatim (e.g. `"06-09"`, `"-"`).
    - `first_last.json`: `{"<ServiceNo>/<dir>": {"<code>": {"wd":[first,last],"sat":[…],"sun":[…]}}}` with LTA's
      `"HHMM"` or `"-"` strings verbatim.
    - `meta.json`: `{"updated": "<ISO +08:00>", "counts": {"stops","services","route_rows"}, "source": "LTA DataMall",
      "licence": "Singapore Open Data Licence"}` — rewritten only when any other data file changed.
  - Exits non-zero (writing nothing) on any fetch or check failure.
- README: what it is, file formats with a small example of each, stable URLs
  (`https://cdn.jsdelivr.net/gh/Perryong/sg-bus-data@main/data/<file>` and the raw.githubusercontent equivalent),
  update schedule, attribution, how to run locally (`uv run python scripts/update.py`), not affiliated with LTA.
- Tests (no network; LTA faked): transform of a small fixture into each file exactly; natural sort; completeness
  floors fail; unknown-stop rows dropped and the 1% rule; deterministic output (two runs byte-identical); meta not
  rewritten when data unchanged; key never in any written file.

## Part 2 — `.github/workflows/update.yml`
- Triggers: `schedule: cron "0 19 * * 0"` (Monday 03:00 SGT) and `workflow_dispatch`.
- Job: checkout → set up uv → `uv run pytest -q` → `uv run python scripts/update.py` with `LTA_KEY: ${{ secrets.LTA_KEY }}`
  → if `git status --porcelain data/` is non-empty, commit `data: update YYYY-MM-DD` as `github-actions[bot]` and push.
- `permissions: contents: write`; no other secrets; `concurrency` so two runs never overlap.
- Failure: job fails, nothing committed, last good data stays published; GitHub notifies the owner.

## Part 3 — BTOlab reads from sg-bus-data
- `tools/fetch_transit.py`: default source becomes sg-bus-data (the three JSON files from jsDelivr), converted back into
  the LTA-row lists `tools/build_commute.py` already reads (`reference/transit/BusStops.json`, `BusRoutes.json`,
  `BusServices.json`): every field the builder uses — `BusStopCode`, `Description`, `RoadName`, `Latitude`,
  `Longitude`; `ServiceNo`, `Direction`, `StopSequence` (1-based index), `BusStopCode`, `Distance`,
  `WD_FirstBus`/`WD_LastBus` (+ SAT/SUN); `AM_Peak_Freq` etc. `build_commute.py` is unchanged.
- `--lta` keeps today's direct LTA fetch (needs `LTA_KEY`); `--osm` unchanged. The OSM download still runs in the default
  refresh.
- Round-trip test: converting sg-bus-data files built from the current LTA rows gives rows that make
  `build_commute.py` produce byte-identical `project.json["commute"]` and `transit.json` for one project
  (bishan-terraces); plus a small fixture test of the converter.
- README: BTOlab's setup step says no LTA key is needed for bus data any more.

## What the user does
Create the GitHub repo `sg-bus-data` (or ask Claude to with `gh`), add the `LTA_KEY` repository secret (a separate
DataMall key is safer), and press "Run workflow" once to publish the first data.

## Out of scope
OSM route shapes, MRT/LRT data, live arrivals (sg-bus-api), change logs beyond git history, a website.
