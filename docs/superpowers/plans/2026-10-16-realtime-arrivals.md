# Realtime Bus Arrivals Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Live arrival minutes for the selected bus stop in BTOlab's Commute tab, served by a new FastAPI repo
`sg-bus-api` on Vercel that holds the LTA key.

**Architecture:** `sg-bus-api` exposes `GET /arrivals/{stop}` (trimmed LTA `v3/BusArrival`, CDN-cached 20 s,
CORS allowlist). BTOlab gets a pure `web/live.js` (fetch + formatting), renders live minutes on the selected stop's
chips and service card, and polls every 30 s from `web/app.js` only while it is useful.

**Tech Stack:** Python 3.12+ with FastAPI, httpx, pytest (managed with `uv`); Vercel Python runtime; BTOlab's plain
ES modules and `node:assert` tests; Playwright (system Chrome) for the browser check.

**Spec:** `docs/superpowers/specs/2026-10-16-realtime-arrivals-design.md`

## Global Constraints
- **Do not commit, push, or create remote repos.** The user forbade commits; `sg-bus-api` is created as a local
  directory `/Users/perry/Code/sg-bus-api` with `git init` and no commits. Creating the GitHub repo, importing
  into Vercel and setting env vars are the user's steps.
- Never read, print, log or copy the value of `LTA_KEY`. BTOlab's key lives in `/Users/perry/Code/BTOlab/.env`; the
  new repo reads its own git-ignored `.env` (the user copies the line) or the environment.
- LTA endpoint: `https://datamall2.mytransport.sg/ltaodataservice/v3/BusArrival?BusStopCode=<stop>`, headers
  `AccountKey`, `accept: application/json`, timeout **5 s**.
- API response 200: `{"stop", "at", "services": [{"no", "arrivals": [≤ 3 ISO strings]}]}`; services sorted naturally,
  empty ones omitted; `Cache-Control: public, s-maxage=20, stale-while-revalidate=10`.
- Errors: invalid stop (`^\d{5}$` fails) → 422; upstream failure/timeout/non-JSON → 502 `{"error":"upstream"}` with
  `Cache-Control: no-store`; key unset → 500 `{"error":"config"}`.
- CORS: `ALLOWED_ORIGINS` (comma-separated), default
  `https://singapore-housing-lab.vercel.app,http://localhost:8781,http://127.0.0.1:8781`; GET only; no credentials.
- BTOlab API base: `http://127.0.0.1:8010` when `location.hostname` is `localhost` or `127.0.0.1`, else the constant
  `PROD_API` = `https://sg-bus-api.vercel.app` (deployed 2026-10-16; `sg-bus-arrivals.vercel.app` belongs to an
  unrelated app). With `''` outside localhost, live arrivals are not requested and no live line is shown.
- Polling: every **30 s**, only while Commute is open, `pick.stop` is set and the page is visible; keep last good
  data **90 s** after failures.
- Copy, exact: chip `<no> · <n>′` / `<no> · Arr` / `<no> · –`; card `Next buses: 3 min · 9 min · 15 min`
  (`Arriving` for < 1 min); `Live · updated <s> s ago`; `Live times unavailable, showing the timetable`.
- BTOlab tests: `test/live_test.mjs` (runs under `npm test`); existing tests must keep passing.

## Review Focus
1. **Device clock wrong by minutes** → minutes must come from the server's `at`, not `Date.now()` alone
   (`now = Date.now() + (atMs − receivedMs)`) — test in Task 3.
2. **User switches stop while a request is in flight** → the late response for the old stop is ignored, never shown
   on the new stop — Playwright check in Task 5.
3. **LTA `NextBus` objects with `EstimatedArrival: ""`** (common late at night) → dropped, service omitted when all
   three are empty — test in Task 1.
4. **Page hidden then visible again** → polling stops while hidden and resumes immediately on return — Playwright
   check in Task 5.
5. **An arrival time already in the past** (LTA lag) → shows `Arr`, never negative minutes — test in Task 3.

---

### Task 1: `sg-bus-api` API with tests

**Files (new repo `/Users/perry/Code/sg-bus-api`):**
- Create: `api/index.py`, `api/__init__.py` (empty), `tests/test_arrivals.py`, `pyproject.toml`, `.gitignore`
  (`.env`, `.venv/`, `__pycache__/`, `.vercel/`, `.pytest_cache/`)

**Interfaces:**
- Produces: `app: FastAPI`; `trim(lta: dict, stop: str, now: datetime) -> dict` (pure, the 200 body);
  `natural_key(no: str) -> tuple`; `lta_key() -> str | None` (env first, then `.env` next to the repo root; quotes
  and `export ` tolerated); module-level `fetch_lta(stop: str, key: str) -> dict` that tests replace.

- [ ] **Step 1: Scaffold** with `uv init --bare` (or a hand-written `pyproject.toml`), `uv add fastapi httpx`,
  `uv add --dev pytest`; `git init` (no commit).
- [ ] **Step 2: Failing tests** in `tests/test_arrivals.py` using FastAPI's `TestClient` and monkeypatching
  `api.index.fetch_lta` and `LTA_KEY`:
  - 200 shape: services `["2","10","10e"]` sorted naturally; each `arrivals` ≤ 3; a service whose three
    `EstimatedArrival` are `""` is omitted (Review Focus 3); `body["stop"] == "52031"`; `at` parses as ISO with
    `+08:00`.
  - Cache header on 200 equals `public, s-maxage=20, stale-while-revalidate=10`.
  - 422 for `5203` and `abcde`.
  - 502 `{"error":"upstream"}` + `no-store` when `fetch_lta` raises `httpx.HTTPStatusError`, `httpx.TimeoutException`,
    or `ValueError` (non-JSON).
  - 500 `{"error":"config"}` when the key is unset.
  - CORS: `Origin: http://localhost:8781` → `access-control-allow-origin` echoed; `Origin: https://evil.example` →
    header absent.
  - The fake key string (e.g. `"SECRET-KEY-123"`) appears in no response body or header across all cases.
  - `GET /health` → `{"ok": true}` without calling `fetch_lta`.
- [ ] **Step 3: Run** `uv run pytest -q` → FAIL (import error).
- [ ] **Step 4: Implement** `api/index.py` per the Interfaces and Global Constraints (`CORSMiddleware` with
  `allow_methods=["GET"]`, `allow_credentials=False`; `httpx.get` with `timeout=5`; times in `Asia/Singapore`).
- [ ] **Step 5: Run** `uv run pytest -q` → all pass.
- [ ] **Step 6:** Leave uncommitted.

### Task 2: Vercel config, README, real-LTA smoke

**Files (new repo):**
- Create: `vercel.json`, `requirements.txt`, `README.md`, `.env.example` (`LTA_KEY=`)

**Interfaces:**
- Consumes: `app` (Task 1).

- [ ] **Step 1:** `vercel.json` routes every path to `api/index.py`
  (`{"rewrites":[{"source":"/(.*)","destination":"/api/index.py"}]}`); `requirements.txt` lists `fastapi` and `httpx`
  (Vercel installs from it).
- [ ] **Step 2:** README: purpose (live arrivals proxy for BTOlab), endpoint and response example, env vars
  (`LTA_KEY`, `ALLOWED_ORIGINS`), local run `uv run uvicorn api.index:app --reload --port 8010`, deploy steps (create
  GitHub repo, import into Vercel, set env vars), credit "Contains information from LTA DataMall".
- [ ] **Step 3: Smoke (real LTA, not a test):** the controller copies the `LTA_KEY=` line from BTOlab's `.env` into
  the new repo's `.env` without printing it; run `uv run uvicorn api.index:app --port 8010` in the background, then
  `curl -s -i -H 'Origin: http://localhost:8781' http://127.0.0.1:8010/arrivals/52031` → 200, ≥ 1 service, CORS header;
  `curl -s -i http://127.0.0.1:8010/arrivals/99999` → 200 with `services: []` or 502 (report which); stop the server.
- [ ] **Step 4:** `uv run pytest -q` still passes. Leave uncommitted.

### Task 3: BTOlab `web/live.js`

**Files:**
- Create: `web/live.js`, `test/live_test.mjs`

**Interfaces:**
- Produces: `API` (string, per Global Constraints); `fetchArrivals(stop, signal) -> Promise<{data, offsetMs}>` where
  `offsetMs = Date.parse(data.at) − Date.now()` at receipt (rejects on non-200 or network error);
  `minutesUntil(iso, nowMs) -> number` (floor, ≥ 0); `liveChip(arrivals, nowMs) -> 'Arr' | '<n>′' | '–'`;
  `nextBuses(arrivals, nowMs) -> string` (`3 min · 9 min · 15 min`, `Arriving` for < 1 min);
  `liveLine(updatedMs, nowMs, failed) -> string`.
  Callers pass `nowMs = Date.now() + offsetMs` (Review Focus 1).

- [ ] **Step 1: Failing tests** (`test/live_test.mjs`, style of `test/value_ui_test.mjs`): `minutesUntil` of +3.5 min →
  3, of −40 s → 0 (Review Focus 5); `liveChip([])` → `–`, first < 60 s → `Arr`, else `7′`; `nextBuses` with
  [+30 s, +6 min, +14 min] → `Arriving · 6 min · 14 min`; `liveLine(now−12000, now, false)` →
  `Live · updated 12 s ago`; `liveLine(x, now, true)` → `Live times unavailable, showing the timetable`;
  a clock-offset case: with device clock 5 min fast and `offsetMs = −300000`, a bus at server+4 min reads `4′`.
  `apiFor('localhost')` and `apiFor('127.0.0.1')` → `http://127.0.0.1:8010`; `apiFor('singapore-housing-lab.vercel.app')`
  → `PROD_API` (`''` today), and `fetchArrivals` is never called when the base is `''`.
- [ ] **Step 2: Run** `node test/live_test.mjs` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm test` → all `ok`. Leave uncommitted.

### Task 4: Render live minutes in the stop list and service card

**Files:**
- Modify: `web/transit.js` (`stopsHtml`, `serviceCard`), `web/commute.js` (`commuteHtml` passes live state)
- Test: `test/commute_ui_test.mjs`

**Interfaces:**
- Consumes: `liveChip`, `nextBuses`, `liveLine` (Task 3).
- Produces: `commuteHtml(P, stacks, selStack, T, R, pick, live = null)` where
  `live = {stop, data | null, updatedMs | null, failed: boolean, nowMs}`; `stopsHtml(T, blk, selSvc, selStop, live)`;
  `serviceCard(svc, stopCode, live)`. Only the stop whose code === `live.stop` changes.

- [ ] **Step 1: Failing tests:** with `live` for stop `52031` holding `88` at +3 min and nothing for `13`: the `88`
  chip at 52031 reads `88 · 3′`, `13` reads `13 · –`, chips at other stops unchanged; the 88 card shows
  `Next buses: 3 min · …`; the stop shows `Live · updated 5 s ago`; with `failed: true` and no data the stop shows the
  unavailable line and chips are plain numbers; `live = null` output is byte-identical to today's; service numbers
  from the live data are matched exactly and escaped.
- [ ] **Step 2: Run** `node test/commute_ui_test.mjs` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm test` → all `ok`. Leave uncommitted.

### Task 5: Poll from the app; verify in the browser

**Files:**
- Modify: `web/app.js` (near `renderCommute`, chip click handling ~269, `applyRTab`), `web/style.css` (live line and
  chip suffix, scoped under `#commutePanel`)

**Interfaces:**
- Consumes: `fetchArrivals`, `commuteHtml(..., live)` (Tasks 3–4).

- [ ] **Step 1:** State `live = {stop, data, updatedMs, failed, offsetMs}` and one `AbortController`. `syncLive()`
  starts polling (immediate fetch, then `setInterval` 30 s) when Commute is open, `pick.stop` is set and the page is
  visible; otherwise aborts and clears the interval. Call it from chip clicks, `applyRTab`, `select`/`clear`, and a
  `visibilitychange` listener (Review Focus 4). A response is applied only if its stop still equals `pick.stop`
  (Review Focus 2). On failure keep data younger than 90 s, else set `failed`. A 1 s ticker re-renders only the live
  line text (not the whole panel) while data exists.
- [ ] **Step 2:** CSS for the live line and chip suffix.
- [ ] **Step 3: Verify.** `npm test` → all `ok`. Serve BTOlab on 8781 and use Playwright (scripts in the session
  scratchpad, which has `node_modules/playwright`; `chromium.launch({channel:'chrome', args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']})`)
  with `page.route('http://127.0.0.1:8010/arrivals/*', …)` faking responses (no real API needed): tap 88 at 52031 →
  chips show minutes and the card lists next buses; count requests over 65 s with fake timers or a shortened
  interval hook (`window.__liveInterval`) → polling cadence holds; switch to Sun → no further requests; hide/show the
  page (`page.evaluate` dispatching `visibilitychange` with a stubbed `document.visibilityState`) → stops and resumes;
  a delayed response for an old stop after switching stops is not shown; a 502 → the unavailable line; zero console
  errors. Optionally repeat once against the real local API from Task 2 if it is running. Screenshot 1280×820 with
  live minutes visible.
- [ ] **Step 4:** Leave uncommitted; report the screenshot.
