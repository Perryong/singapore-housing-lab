# Performance

Measured on the live site (https://singapore-housing-lab.vercel.app) on 11 Oct 2026, in Chromium on an Apple-silicon Mac.
The three.js library was already cached.

| Project | Downloaded | of which 3D model | First paint | Frame rate |
|---|---|---|---|---|
| Kim Keat Crest | 1.19 MB | 1.01 MB | 0.83 s | 120 fps |
| Tampines Nova | 0.84 MB | 0.69 MB | 0.33 s | 120 fps |
| Yishun Glade | 1.36 MB | 1.16 MB | 0.35 s | 120 fps |

## Lighthouse

Lighthouse 12.2.1 (headless Chrome) on the live Kim Keat Crest page, 13 Oct 2026. The table shows the median of 3 runs
for the "after" columns. The mobile preset simulates a slow 4G connection and a 4× slower CPU.

| | Before (desktop) | After (desktop) | After (mobile) |
|---|---|---|---|
| Performance | 29 | **95** | **84** |
| Accessibility | 98 | **100** | **100** |
| Best practices | 96 | **100** | **100** |
| SEO | 90 | **100** | **100** |
| First contentful paint | 2.1 s | 0.3 s | 2.6 s |
| Total blocking time | 760 ms | 20 ms | 210 ms |
| Cumulative layout shift | 0.334 | 0.003 | 0 |

What changed:
- **Layout shift (0.33 → 0.003):** the panels reserve the space that JavaScript fills in on load: the sun and moon
  card, the project description and the unit hint. On phones the header also keeps room for its second line.
- **First paint:** the font is now served from the site, so first paint no longer waits on two Google Fonts servers.
  three.js uses the minified build and is preloaded.
- **Blocking time:** the 3D model (about 1 MB) no longer blocks start-up. The map, the neighbouring blocks and the
  surroundings draw first, and the units are coloured when the model arrives.
- **Accessibility:** heading levels no longer skip a level, and the logo accent passes the 4.5:1 contrast ratio on phones.
- **Best practices:** the deployed site no longer requests HDB's site plans, which aren't published, so there are no
  "not found" errors in the console.
- **SEO:** added a meta description.

The remaining image warning is about OneMap's map tiles (PNG), which come from OneMap's own servers.

## Why it is light

- **No build step and no framework.** The app is plain ES modules. three.js loads from a CDN through an import map.
- **One mesh per kind of building.** The surroundings within 1.5 km (up to about 300 HDB blocks, malls and stations)
  are merged into one draw call per kind. Turning them on or off doesn't change the frame rate (120 fps either way).
- **Blender bakes the models offline.** `model.glb` is generated once per project and served compressed.
- **3D floor plans load on demand.** They use Draco compression and load only when a unit's floor plan is expanded.
- **Footprints are simplified.** The Ramer–Douglas–Peucker algorithm removes near-collinear points, to within 0.5 m.

## Budget enforced in CI

[`test/budget_test.py`](../test/budget_test.py) fails the build if any project gets too big:

| File (gzip) | Budget | Largest today |
|---|---|---|
| `project.json` | 300 KB | 208 KB (Tengah) |
| `model.glb` | 2 MB | 1.05 MB |

## Reproduce

`npx lighthouse@12.2.1 "https://singapore-housing-lab.vercel.app/web/?p=kim-keat-crest" --preset=desktop` (omit the
preset for mobile). Run `python3 test/budget_test.py` for the size check.
