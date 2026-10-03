"""Georeference a traced project by fitting the HDB open-data footprints onto the existing blocks drawn on its site plan.

usage: python3 tools/register_context.py projects/<id> [--apply] [--range 250]

Chamfer match: distance transform of the plan's thin grey/black linework; search a world shift (and a small
north-arrow correction) that minimises the mean distance from footprint edge samples to that linework.
--apply shifts `context` by the fit, updates site lat/lon to match, and sets plan.upBearing.
"""
import json, math, sys
from pathlib import Path

import cv2
import numpy as np

D = Path(sys.argv[1])
P = json.loads((D / 'project.json').read_text())
RANGE = float(sys.argv[sys.argv.index('--range') + 1]) if '--range' in sys.argv else 400.0
img = cv2.imread(str(D / P['plan']['image']['file']))
H, W = img.shape[:2]
pl = P['plan']; PX = pl['pxPerM']; ox, oy = pl['origin']; up0 = pl['upBearing']

lab = cv2.cvtColor(img, cv2.COLOR_BGR2LAB).astype(np.float32)
gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
chroma = np.hypot(lab[:, :, 1] - 128, lab[:, :, 2] - 128)
lines = ((gray < 175) & (chroma < 14)).astype(np.uint8)          # grey/black linework (existing-building outlines)
lines = cv2.morphologyEx(lines, cv2.MORPH_OPEN, np.ones((1, 1), np.uint8))
dt = cv2.distanceTransform(1 - lines, cv2.DIST_L2, 3)

# edge samples every ~1 m along every context footprint, world coordinates
pts = []
for c in P['context']:
    p = np.array(c['p'], float)
    for a, b in zip(p, np.roll(p, -1, axis=0)):
        n = max(1, int(np.hypot(*(b - a))))
        t = np.linspace(0, 1, n, endpoint=False)[:, None]
        pts.append(a + (b - a) * t)
pts = np.concatenate(pts)


def score(sx, sz, up, tol=1.0):
    """Lower is better: minus the number of footprint edge samples lying within 1 m of drawn linework.
    Counting inliers (not averaging distance) stops the fit from pushing footprints off the sheet."""
    x, z = pts[:, 0] + sx, pts[:, 1] + sz
    r = math.radians(up)
    lx = x * math.cos(r) + z * math.sin(r); lz = -x * math.sin(r) + z * math.cos(r)
    px = (ox + lx * PX).astype(np.int32); py = (oy + lz * PX).astype(np.int32)
    ok = (px >= 0) & (px < W) & (py >= 0) & (py < H)
    d = dt[py[ok], px[ok]]
    inl = float((d < tol * PX).sum())
    return -(inl - 0.6 * (ok.sum() - inl)), int(ok.sum())   # inliers minus a penalty for on-sheet misses


def search(c, half, step, ups, tol=1.0):
    best = (1e9, 0, 0, up0, 0)
    for up in ups:
        for sx in np.arange(c[0] - half, c[0] + half + 1e-6, step):
            for sz in np.arange(c[1] - half, c[1] + half + 1e-6, step):
                s, n = score(sx, sz, up, tol)
                if s < best[0]:
                    best = (s, sx, sz, up, n)
    return best


base, nbase = score(0, 0, up0)
def frac(v): return -v / len(pts)
# HDB sheets are drawn north-up: search translation only (a rotation search just finds chance fits)
# coarse pass scores within 3 m so a 4 m grid can't step over a narrow true peak
if '--range' not in sys.argv and str(P.get('georef', '')).startswith(('OneMap', '2 ', '3 ', '4 ', '5 ', '6 ')):
    RANGE = 40.0      # already placed from block addresses: only allow a small correction
# multi-start: keep the 20 best coarse cells (3 m tolerance), refine each at 1 m, pick the best refined fit
grid = []
for sx in np.arange(-RANGE, RANGE + 1e-6, 4.0):
    for sz in np.arange(-RANGE, RANGE + 1e-6, 4.0):
        grid.append((score(sx, sz, up0, 3.0)[0], sx, sz))
grid.sort()
starts, seen = [], []
for g in grid:
    if all(abs(g[1] - a) > 12 or abs(g[2] - b) > 12 for a, b in seen):
        starts.append(g); seen.append((g[1], g[2]))
    if len(starts) == 20:
        break
refined = [search(search((x, z), 4, 1.0, [up0])[1:3], 1.5, 0.25, [up0]) for _, x, z in starts]
b3 = min(refined)
s, sx, sz, up, n = b3


def inliers(sx, sz, up):
    x, z = pts[:, 0] + sx, pts[:, 1] + sz
    r = math.radians(up)
    lx = x * math.cos(r) + z * math.sin(r); lz = -x * math.sin(r) + z * math.cos(r)
    px = (ox + lx * PX).astype(np.int32); py = (oy + lz * PX).astype(np.int32)
    ok = (px >= 0) & (px < W) & (py >= 0) & (py < H)
    return int((dt[py[ok], px[ok]] < PX).sum()), int(ok.sum())


base, _ = inliers(0, 0, up0); base = -base
s, n = inliers(sx, sz, up); s = -s
print(f"{D.name}: on-line samples {-base:.0f} -> {-s:.0f} ({-s / max(n, 1):.0%} of on-sheet) with shift ({sx:+.1f}, {sz:+.1f}) m, "
      f"north {up - up0:+.1f} deg, {n}/{len(pts)} samples on sheet")

# genuine fits put >=65% of on-sheet footprint edges on drawn outlines; chance fits on roads/text stay under ~55%
good = -s >= 300 and -s / max(n, 1) >= 0.65
print('  fit accepted' if good else '  no confident fit: placement kept')
if '--apply' in sys.argv and good:
    P['context'] = [{**c, 'p': [[round(x + sx, 1), round(z + sz, 1)] for x, z in c['p']]} for c in P['context']]
    lat0, lon0 = P['site']['lat'], P['site']['lon']
    # context world = local_xz(site) + s  <=>  site moved by -s
    P['site']['lat'] = round(lat0 + sz / 110_574.0, 7)
    P['site']['lon'] = round(lon0 - sx / (111_320.0 * math.cos(math.radians(lat0))), 7)
    P['contextSite'] = [P['site']['lat'], P['site']['lon']]
    P['plan']['upBearing'] = round(up, 2)
    P['georef'] = f'fitted to existing blocks on the site plan ({-s / max(n, 1):.0%} of on-sheet footprint edges on drawn outlines)'
    (D / 'project.json').write_text(json.dumps(P, separators=(',', ':')))
    print('  applied')
