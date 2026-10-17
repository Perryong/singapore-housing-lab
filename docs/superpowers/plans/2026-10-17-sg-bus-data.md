# sg-bus-data Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A new public repo `sg-bus-data` that republishes LTA DataMall bus stops/services as documented JSON, refreshed
weekly by a GitHub Action, and BTOlab reading its bus data from it instead of from LTA.

**Architecture:** `scripts/transform.py` (pure: LTA rows → the four `data/` files) and `scripts/update.py` (fetch, check,
write only on change) in the new repo; a scheduled workflow runs tests then the update and commits `data/` when it
changed. BTOlab's `tools/fetch_transit.py` gains a converter from those files back to the LTA-row lists
`tools/build_commute.py` already reads.

**Tech Stack:** Python 3.12, httpx, pytest, uv; GitHub Actions (`astral-sh/setup-uv`); BTOlab's existing Python tools.

**Spec:** `docs/superpowers/specs/2026-10-17-sg-bus-data-design.md`

## Global Constraints
- **No commits, pushes or remote repos** in either repo until the user asks. New repo lives at
  `/Users/perry/Code/sg-bus-data` (`git init`, no commits).
- Never read, print, log or write the value of `LTA_KEY`. The controller places the key line in the new repo's
  git-ignored `.env` for the local real run; tests use a fake key.
- LTA: `https://datamall2.mytransport.sg/ltaodataservice/<Dataset>?$skip=N`, headers `AccountKey`,
  `accept: application/json`, 500 rows a page, stop on an empty page, timeout 60 s, **3 retries** per page with backoff.
- Checks: ≥ **4,500** stops, ≥ **500** distinct services, ≥ **20,000** route rows; route rows whose stop is missing
  from BusStops are dropped, and more than **1%** dropped fails the run. Any failure exits non-zero and writes nothing.
- Output: compact JSON `separators=(",", ":")`, `sort_keys=True`, UTF-8, trailing newline; lists in the defined order;
  lat/lon rounded to 6 dp; LTA frequency and time strings verbatim.
- File shapes exactly as the spec's Part 1 (`stops.json`, `services.json`, `first_last.json`, `meta.json`);
  `meta.json` only rewritten when another data file changed; `updated` ISO with `+08:00`.
- Workflow: cron `0 19 * * 0` + `workflow_dispatch`; `permissions: contents: write`; `concurrency` group; commit message
  `data: update YYYY-MM-DD` as `github-actions[bot]`.
- BTOlab reads the files from `https://raw.githubusercontent.com/Perryong/sg-bus-data/main/data/<file>` (fresher than
  jsDelivr's branch cache; the README lists both URLs). `--lta` keeps the direct fetch; `--osm` unchanged.
- Attribution: "Contains information from LTA DataMall, made available under the Singapore Open Data Licence".
- Natural service order: (leading integer, suffix), non-numeric last — same rule as sg-bus-api's `natural_key`.

## Review Focus
1. **Duplicate rows across LTA pages** (paging overlap when LTA updates mid-fetch) → deduplicated by
   (ServiceNo, Direction, StopSequence) / stop code, never doubled stops in a route — test in Task 1.
2. **A service with route rows but no BusServices row** (or the reverse) → still published, `freq` values `"-"`,
   `category`/`operator` from whichever source has them — test in Task 1.
3. **One page fails after retries mid-fetch** → nothing written, previous files untouched — test in Task 2.
4. **The Action pushes after another commit landed** (manual run during a scheduled one, or a code push) →
   `concurrency` prevents overlap and the job rebases before pushing — checked in Task 3's workflow test.
5. **The key appearing in Action logs** via an exception message → only dataset names and HTTP status are printed —
   test in Task 2.

---

### Task 1: Transform LTA rows into the published files

**Files (new repo `/Users/perry/Code/sg-bus-data`):**
- Create: `pyproject.toml`, `.gitignore` (`.env`, `.venv/`, `__pycache__/`, `.pytest_cache/`), `scripts/__init__.py`,
  `scripts/transform.py`, `tests/test_transform.py`, `tests/fixtures/` (small LTA-row JSON fixtures)

**Interfaces:**
- Produces: `natural_key(no: str) -> tuple`; `build(stops: list, routes: list, services: list) -> dict[str, object]`
  returning `{"stops.json": [...], "services.json": {...}, "first_last.json": {...}}` (not meta);
  `check(stops, routes, services) -> tuple[list, int]` returning the route rows kept and the number dropped, raising
  `ValueError("<reason>")` on any floor or the 1% rule; `dumps(obj) -> str` (the exact output encoding).

- [ ] **Step 1:** Scaffold with uv (`uv init --bare`, `uv add httpx`, `uv add --dev pytest`), `git init`.
- [ ] **Step 2: Failing tests** with a fixture of 3 stops, 2 services (`"10"`, `"2"`; one with two directions, one loop),
  route rows and service rows:
  - `build(...)["stops.json"]` equals the expected list (sorted by code, 6 dp).
  - `services.json` keys in order `["2", "10"]`; a direction's `stops` is `[["01012", 0.0], ["01013", 0.6], …]` in
    StopSequence order; `from`/`to` codes; `loop` from `LoopDesc` or `""`; `freq` verbatim.
  - `first_last.json["10/1"]["01012"] == {"wd": ["0500", "2300"], "sat": [...], "sun": [...]}`.
  - Review Focus 1: duplicated route and stop rows produce identical output to the de-duplicated fixture.
  - Review Focus 2: a route-only service has `freq` all `"-"`; a services-only service with no route rows is omitted
    (nothing to publish) — assert both.
  - `check`: 4,499 stops → `ValueError`; 2 of 100 rows with unknown stops → `ValueError`; 1 of 100 → kept 99,
    dropped 1 (use small floors via parameters `check(..., floors=(…))` so fixtures stay small; defaults are the
    constraint values).
  - `dumps` is compact, sorted, ends with `"\n"`; `dumps(build(x)) == dumps(build(x))` for shuffled input rows.
- [ ] **Step 3: Run** `uv run pytest -q` → FAIL. **Step 4: Implement.** **Step 5: Run** → pass. Leave uncommitted.

### Task 2: Fetch, write-on-change, README, real local run

**Files (new repo):**
- Create: `scripts/update.py`, `tests/test_update.py`, `README.md`, `LICENSE` (MIT), `.env.example` (`LTA_KEY=`)

**Interfaces:**
- Consumes: Task 1's `build`, `check`, `dumps`.
- Produces: `lta_key() -> str | None` (env, then `.env`; quotes and `export ` tolerated); `fetch_all(dataset, key) -> list`
  (paging, 3 retries with backoff, raises `RuntimeError(f"{dataset}: HTTP {status}")` or `RuntimeError(f"{dataset}: network")`);
  `main(argv) -> int` with `--from-dir DIR` (read cached `BusStops.json`/`BusRoutes.json`/`BusServices.json` instead of
  fetching — used for the BTOlab round-trip and offline runs) and `--out DIR` (default `data/`).

- [ ] **Step 1: Failing tests** (fetch faked by monkeypatching the HTTP call):
  - paging stops on an empty page; a page failing twice then succeeding is retried; failing 4 times → `main` returns 1,
    `data/` untouched (Review Focus 3);
  - missing key → returns 1 with message `set LTA_KEY`;
  - files written byte-identical to `dumps(build(...))`; a second run with the same rows changes no file and does not
    rewrite `meta.json` (compare mtime/content); changed rows rewrite the changed file and `meta.json`;
  - Review Focus 5: run with key `"SECRET-KEY-123"` against a fake HTTP 500 and capture stdout/stderr → the key string
    appears nowhere; nor in any written file.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → pass.
- [ ] **Step 5: README** per spec Part 1 (purpose, each file with a small example, both URLs, schedule, attribution,
  local run `uv run python scripts/update.py`, `--from-dir`, not affiliated with LTA).
- [ ] **Step 6: Real run** (the controller has placed the key line in `.env`): `uv run python scripts/update.py` → prints
  counts only; `data/` holds four files; report their sizes and counts. Then
  `uv run python scripts/update.py --from-dir /Users/perry/Code/BTOlab/reference/transit --out /tmp/<scratch>/from-btolab`
  succeeds (used by Task 4). Leave uncommitted.

### Task 3: GitHub Actions workflow

**Files (new repo):**
- Create: `.github/workflows/update.yml`, `tests/test_workflow.py`

**Interfaces:**
- Consumes: `scripts/update.py` (Task 2).

- [ ] **Step 1: Failing test** `tests/test_workflow.py` (add `pyyaml` as a dev dependency) parsing the workflow:
  triggers include `schedule` with cron `0 19 * * 0` and `workflow_dispatch`; `permissions.contents == "write"`;
  a `concurrency` group is set; the steps run `uv run pytest -q` before `uv run python scripts/update.py`; the update
  step's env has `LTA_KEY: ${{ secrets.LTA_KEY }}` and no other secret; the commit step only commits when
  `git status --porcelain data/` is non-empty, uses `github-actions[bot]`, message starts `data: update `, and runs
  `git pull --rebase` before `git push` (Review Focus 4).
- [ ] **Step 2: Run** → FAIL. **Step 3: Write the workflow** (`actions/checkout@v4`, `astral-sh/setup-uv@v6` with
  Python 3.12). **Step 4: Run** → pass. Leave uncommitted.

### Task 4: BTOlab reads bus data from sg-bus-data

**Files (BTOlab):**
- Modify: `tools/fetch_transit.py`, `README.md` (setup step for bus data)
- Test: `test/commute_test.py`

**Interfaces:**
- Consumes: the published file shapes (spec Part 1).
- Produces: `from_sgbusdata(stops: list, services: dict, first_last: dict) -> tuple[list, list, list]` returning
  `(BusStops rows, BusRoutes rows, BusServices rows)` with the LTA field names `build_commute.py` reads
  (`BusStopCode, Description, RoadName, Latitude, Longitude`; `ServiceNo, Direction, StopSequence` (1-based),
  `BusStopCode, Distance, WD_/SAT_/SUN_FirstBus/LastBus`; `ServiceNo, Direction, Operator, Category, OriginCode,
  DestinationCode, AM_Peak_Freq, AM_Offpeak_Freq, PM_Peak_Freq, PM_Offpeak_Freq, LoopDesc`).
  `fetch_transit.py` default: download the three files from the raw URL, convert, write
  `reference/transit/BusStops.json` etc., then the OSM step; `--lta` = today's LTA path; `--osm` unchanged.

- [ ] **Step 1: Failing tests:** a small fixture in the sg-bus-data shape converts to the expected LTA rows exactly.
  Round trip (skips with a note when `/tmp/<scratch>/from-btolab` from Task 2 is absent): convert those files, write
  them to a temp `reference/transit`, rebuild `projects/bishan-terraces` into a temp copy, and assert its
  `commute` block (ignoring `asOf`) and `transit.json` equal the committed ones byte-for-byte. Point the builder at the
  temp dir via a small seam (e.g. an env var `BTOLAB_TRANSIT_DIR` read in `build_commute.py`'s `load()`), the only
  change allowed in `build_commute.py`.
- [ ] **Step 2: Run** `PYTHONPATH=. python3 test/commute_test.py` → FAIL. **Step 3: Implement.** **Step 4: Run** →
  `ok`; `npm test` all ok.
- [ ] **Step 5:** `python3 tools/fetch_transit.py` (default path) is NOT run against the network until the repo is
  published; instead run the converter path against the local `/Users/perry/Code/sg-bus-data/data/` via a
  `--from-local DIR` option and confirm `tools/build_commute.py projects/bishan-terraces/` prints the same hub minutes
  as before. Leave uncommitted.
