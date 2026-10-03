# BTO catalogue — design (approved in chat 2026-10-03)

Goal: the sun study (see Thomson Reserve) for every HDB BTO project launched in the past 12 months, plus
upcoming projects, with an always-visible header so the user knows which project / launch is on screen.

## Agreed decisions
- Upcoming projects without a released layout: "Layout not released" view — ground, compass, sun path,
  real neighbouring HDB blocks around a site pin. No invented massing, no table.
- Launched projects: site plan traced by hand (vision) into project.json; the app's plan-under-model view
  is the alignment check, verified with Playwright screenshots (top-down) until blocks sit on outlines.
- Context blocks automated from data.gov.sg (HDB Existing Building footprints + HDB Property Information
  max_floor_lvl, 3 m/storey), within 900 m.
- If a project can't be traced reliably → shown as not released with the reason. Never guessed.
- If a source blocks automation / shows a CAPTCHA → stop and report, no circumvention.
- Thomson Reserve stays as the reference, tagged "Private condo".

## Catalogue & picker
projects/index.json: [{id, name, town, launch, status: launched|upcoming|reference, lat, lon, flatTypes,
units, hasLayout}]. Header: launch badge + name + town + "Change project". Picker grouped by launch,
newest first, upcoming on top, search, tags "3D sun study" / "Layout not released". ?p=<id>.

## Done criteria per project (loop until all met)
1. Appears in picker with correct launch/town/name/flat types/units (from HDB).
2. Launched: model.glb built; top-down Playwright screenshot shows blocks on the site-plan outlines;
   table + unit card populated; no console errors; trace-notes.md written.
3. Upcoming: context blocks + site pin render; "Layout not released" notice; no console errors.
4. test/sun.test.js still passes (Thomson Reserve parity).

## Progress
See docs/superpowers/progress.md.
