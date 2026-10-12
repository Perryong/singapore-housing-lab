# Performance

Measured on the live site (https://singapore-housing-lab.vercel.app) on 11 Oct 2026, in Chromium on an Apple-silicon Mac.
The three.js library was already cached.

| Project | Downloaded | of which 3D model | First paint | Frame rate |
|---|---|---|---|---|
| Kim Keat Crest | 1.19 MB | 1.01 MB | 0.83 s | 120 fps |
| Tampines Nova | 0.84 MB | 0.69 MB | 0.33 s | 120 fps |
| Yishun Glade | 1.36 MB | 1.16 MB | 0.35 s | 120 fps |

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

Open DevTools → Network on the live site. Alternatively, run `python3 test/budget_test.py` for the size check.
