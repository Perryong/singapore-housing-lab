# Realtime bus arrivals (design)

Approved direction in chat 2026-10-16. Adds live arrival minutes to the Commute tab's selected bus stop. This reverses
the "static only" decision of `2026-10-15-commute-lens-design.md` for this one feature: BTOlab stays a static site, and
a separate small API holds the LTA key.

## Decisions
| Decision | Why |
|---|---|
| Arrival minutes only, for the selected stop | What the user asked for; crowding, bus type, live positions and all-stops polling are out of scope. |
| Separate repo `sg-bus-api`: FastAPI on Vercel | The LTA key must stay server-side; LTA sends no CORS header, so browsers cannot call it. A separate repo keeps BTOlab static and lets other apps reuse the API. |
| Browser calls the API directly, CORS allowlist | One base-URL constant in BTOlab; repos deploy independently. |
| Poll every 30 s, CDN cache 20 s | Arrivals change on that scale; Vercel's CDN collapses many viewers into ~1 LTA call per stop per 20 s. |
| Not modelled on `cheeaun/sgbusdata` | That repo is static data built by a scheduled Action, with no server or live data; nothing is taken from it. |

## Part 1 — `sg-bus-api` (new repo)
- Python 3.12, FastAPI, `httpx`; tests with `pytest`. Vercel Python runtime, entry `api/index.py` exporting `app`;
  `vercel.json` routes every path to it.
- `GET /arrivals/{stop}`:
  - `stop` must match `^\d{5}$`, else **422**.
  - Calls `https://datamall2.mytransport.sg/ltaodataservice/v3/BusArrival?BusStopCode=<stop>` with header
    `AccountKey: $LTA_KEY`, `accept: application/json`, timeout **5 s**.
  - Response **200**: `{"stop": "52031", "at": "<server time, ISO 8601 +08:00>", "services": [{"no": "88",
    "arrivals": ["<EstimatedArrival>", ...]}]}` — for each service, the non-empty `EstimatedArrival` of `NextBus`,
    `NextBus2`, `NextBus3` in order (≤ 3), services sorted naturally by number (`"2" < "10" < "10e"`), services with
    no arrivals omitted.
  - Header `Cache-Control: public, s-maxage=20, stale-while-revalidate=10`.
  - LTA error, non-JSON or timeout → **502** `{"error": "upstream"}` with `Cache-Control: no-store`.
  - `LTA_KEY` unset → **500** `{"error": "config"}`.
  - The key never appears in a response body, header or log line.
- `GET /health` → `{"ok": true}` (does not call LTA).
- CORS: `ALLOWED_ORIGINS` env var, comma-separated; default
  `https://singapore-housing-lab.vercel.app,http://localhost:8781,http://127.0.0.1:8781`; methods `GET` only;
  no credentials.
- Local run: `uvicorn api.index:app --reload --port 8010`, reading `LTA_KEY` from the environment or the repo's
  git-ignored `.env` (same `.env` parsing rules as BTOlab's `tools/fetch_transit.py`: quotes and `export ` tolerated).
- README: what it is, the endpoint, env vars, local run, deploy steps (create repo, import into Vercel, set
  `LTA_KEY` and optionally `ALLOWED_ORIGINS`), data credit "Contains information from LTA DataMall".
- Tests (`pytest`, LTA faked by replacing the HTTP call): trimmed shape and ≤ 3 arrivals; natural sort; empty
  services omitted; 422 on `"5203"`/`"abcde"`; 502 on upstream 500, timeout and non-JSON; 500 when the key is unset;
  CORS header present for an allowed origin and absent for another; cache header on 200 and `no-store` on 502; the
  key string absent from every response.

## Part 2 — BTOlab
- `web/live.js` (pure, no three.js):
  - `API` = `http://127.0.0.1:8010` when `location.hostname` is `localhost` or `127.0.0.1`, else the production URL
    `https://sg-bus-api.vercel.app` (deployed 2026-10-16; `sg-bus-arrivals.vercel.app` belongs to an unrelated app). With an empty constant, live arrivals are hidden outside localhost.
  - `minutesUntil(iso, nowMs) -> number` (whole minutes, floored at 0).
  - `liveChip(arrivals, nowMs) -> string`: `"Arr"` when the first bus is < 1 min, else `"<n>′"`; `"–"` when none.
  - `liveLine(updatedMs, nowMs, failed) -> string`: `"Live · updated <s> s ago"`, or when failed
    `"Live times unavailable, showing the timetable"`.
  - `fetchArrivals(stop, signal) -> Promise<object>` (rejects on non-200).
- `web/transit.js` / `web/commute.js`: when live data for the selected stop exists, each chip at that stop reads
  `<no> · <liveChip>`; the open service card adds `Next buses: 3 min · 9 min · 15 min` (or `Arriving` for < 1 min);
  the stop shows `liveLine` under its name. Other stops are unchanged.
- `web/app.js`: when `pick.stop` is set and the Commute tab is open and `document.visibilityState === 'visible'`,
  fetch immediately, then every **30 s**; abort and stop polling when the stop is deselected, the tab changes, the
  page is hidden, or the project changes. The "updated … s ago" text refreshes each second from the last success.
  On failure keep the last good data for up to 90 s, then show the unavailable line; retry on the next tick.
- All API strings escaped as today; service numbers matched to chips by exact `no`.

## Error handling
- API down / CORS blocked / 502: unavailable line; chips fall back to plain service numbers; timetable band still
  shown in the card.
- A service at the stop absent from the live response (not running now): its chip shows `–`.

## Testing
- `sg-bus-api`: the pytest list above; plus a manual smoke against real LTA with the real key locally.
- BTOlab: `test/live_test.mjs` for `minutesUntil`, `liveChip` (`Arr`, minutes, `–`), `liveLine`, escaping;
  Playwright with `page.route` faking the API: chips update, card lists next buses, a 502 shows the unavailable line,
  polling stops after switching to the Sun tab (no further requests), no console errors.

## What the user must do
Create the GitHub repo `sg-bus-api`, import it into Vercel, and set `LTA_KEY` (and `ALLOWED_ORIGINS` if the
BTOlab domain differs) in Vercel's project settings. Claude prepares the code and can create the repo with `gh` only
with explicit permission.

## Out of scope
Crowding, bus type, live bus positions, arrivals for stops other than the selected one, push updates.
