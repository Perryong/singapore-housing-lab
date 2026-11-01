# Weather simulation page, Phase 1: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A live, full-screen Singapore weather map at `web/weather.html`: wind trails, rain radar, temperature, humidity and clickable BTO project pins.

**Architecture:** A static page with no backend. `web/weather.js` is pure and runs in Node (queue, parsing, blending). `web/weather-page.js` holds everything that touches the map and DOM.

**Tech Stack:** Leaflet 1.9.4 from cdnjs, OneMap tiles, 2D canvas, NEA real-time API without a key.

**Spec:** `docs/superpowers/specs/2026-11-02-weather-sim-design.md`, "Part 1" and "Phase 1".

## Global Constraints

- Every NEA call goes through one queue at one call per 1,700 ms, so at most 6 in any 10 seconds.
- No API key anywhere in the repo or page.
- Wind speed arrives in knots. Blend wind as vectors, never as angles.
- Rainfall is a 5-minute total: multiply by 12 for mm/h.
- Credit: "Map: OneMap © SLA · Weather: NEA via data.gov.sg (Open Data Licence)".
- Page wording: "Measured at NEA stations and estimated between them."
- Reduced motion: no moving trails, static arrows at stations instead.
- The timeline is Phase 2, not here.

## Review Focus

1. A feed returns no readings, or stations with no value: skip them, keep other layers working.
2. Rate limited on open, by status 429 or body `code: 24`: hold 10 s, retry, then report that layer unavailable.
3. Radar beta fails or has no records: rain falls back to wet-gauge dots.
4. Tab left hidden, then reopened: no calls while hidden, and old readings show their age until refreshed.
5. Pins and readout by keyboard: pins take focus, Enter opens the card, Esc closes it.

---

### Task 1: Pure weather module

**Files:** Create `web/weather.js`. Test `test/weather_test.mjs`.

**Produces:** `WX_API`, `GAP_MS`, `makeQueue(gap, wait, now)` with `.run(fn)` and `.hold(ms)`; `fetchFeed(path, { queue, signal, base, fetchFn })`; `stations(data)`; `windPoints(speed, dir)`; `blend(points, f, lat, lon)`; `windAt(points, lat, lon)`; `fromBearing(u, v)`; `nearest(points, lat, lon)`; `radarFrame(data)`; `forecastAt(data, lat, lon)`; `rampColour(stops, v)`; `minutesOld(iso, nowMs)`; `readout(pin, feeds)`; `STOPS`; `RAIN_COLOURS`.

- [x] Write failing tests: knots, 350° and 10° blending to north, missing values skipped, queue window, 429 and `code: 24` handling, radar parsing, empty feeds, and readout with missing feeds.
- [x] Run `node test/weather_test.mjs`. Expected: FAIL, module not found.
- [x] Implement `web/weather.js`.
- [x] Run `node test/weather_test.mjs`. Expected: `ok`.

### Task 2: Project coordinates and page registration

**Files:** Modify `tools/make_index.js`, `tools/build_seo.js`, `test/seo_test.mjs`, `web/index.html`. Regenerate `projects/index.json`, `bto/`, `sitemap.xml`.

- [x] Add a test that every `index.json` entry has numeric `lat` and `lon`, and that the sitemap has `/web/weather.html` and `INDEX.length + 3` entries.
- [x] Add `lat: P.site.lat, lon: P.site.lon` to `make_index.js`, and the URL to `build_seo.js`.
- [x] Run both tools and `node test/seo_test.mjs`. Expected: `ok`, with a diff limited to these additions.
- [x] Add a "Weather" link to the header in `web/index.html`.

### Task 3: The page

**Files:** Create `web/weather.html`, `web/weather-page.js`. Test `test/weather_ui_test.py`.

**Consumes:** everything from Task 1, `lat` and `lon` from Task 2.

- [x] Write a Playwright test with mocked NEA responses:
  - Layers toggle, and Temperature replaces the colour field.
  - A pin opens a card with its readings and an "Open in 3D" link, and Esc closes it.
  - A failed radar shows gauge dots.
  - No more than 6 NEA calls in any 10 seconds.
  - No calls while the tab is hidden.
  - Reduced motion runs no trail frames.
- [x] Run it. Expected: FAIL, page missing.
- [x] Build the page.
- [x] Run it. Expected: `ok`.

### Task 4: Verify

- [x] Run `npm test`. Expected: all pass.
- [x] Open the page against live NEA data, on desktop and at phone width. Check the console for errors and the network log for call pacing.
