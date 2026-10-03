"""Trace an HDB BTO site plan into project.json stacks.

usage: python3 tools/trace_siteplan.py projects/<id>     (reads projects/<id>/trace.json)

Hybrid: stack numbers and a rough point inside each unit are read off the plan by eye (OCR is unreliable
at brochure resolution); this script snaps each point to the exact unit shape by flood fill and derives the
box, orientation, flat type (nearest sampled colour) and window sides (edges that face open ground).

trace.json:
  image        full-resolution site plan
  planBox      [x0, y0, x1, y1] drawing area (also cropped out as siteplan.jpg)
  scale        {"p0": [x, y], "p1": [x, y], "metres": 200}  ends of the scale bar
  upBearing    compass bearing of "up" on the sheet (arrow straight up -> 0; arrow rotated θ anticlockwise -> θ)
  types        {"<code>": [x, y]}  a point inside one plan unit of each flat type (colour sample)
  blocks       {"<blk>": {"storeys": n, "first": 2, "units": {"<stack no>": [x, y] | "r12" | "r12.a", ...},
                          "types": {"<no>": "3RM"}  (optional override),
                          "storeysByStack": {"<no>": n}}}
  anchors      optional [{"postal": "560179", "px": [x, y]}]  an existing HDB block drawn on the plan (point inside
               its outline); its footprint centroid is matched to HDB open data to georeference the plan
All coordinates are full-image pixels. Writes plan/blocks/stacks into project.json (other keys kept),
siteplan.jpg and trace-debug.png (detected boxes + window arrows) for visual checking.
"""
import json, sys
from pathlib import Path

import cv2
import numpy as np

DIR = Path(sys.argv[1])
T = json.loads((DIR / 'trace.json').read_text())
img = cv2.imread(T['image'])
x0, y0, x1, y1 = T['planBox']
plan = img[y0:y1, x0:x1].copy()
lab = cv2.cvtColor(plan, cv2.COLOR_BGR2LAB).astype(np.float32)
H, W = plan.shape[:2]
(sx0, sy0), (sx1, sy1) = T['scale']['p0'], T['scale']['p1']
PX = float(np.hypot(sx1 - sx0, sy1 - sy0) / T['scale']['metres'])
UP = T.get('upBearing', 0)
gray = cv2.cvtColor(plan, cv2.COLOR_BGR2GRAY)


def fill_colour(px, py, r=10):
    """Median colour of the light (non-text, non-outline) pixels around a point."""
    win = lab[max(0, py - r):py + r + 1, max(0, px - r):px + r + 1].reshape(-1, 3)
    g = gray[max(0, py - r):py + r + 1, max(0, px - r):px + r + 1].reshape(-1)
    keep = win[g > np.percentile(g, 40)]
    return np.median(keep, axis=0)


lab_full = cv2.cvtColor(img, cv2.COLOR_BGR2LAB).astype(np.float32)


def sample_full(x, y, r=6):
    """Colour at a full-image point (legend swatches sit outside the plan crop)."""
    return np.median(lab_full[y - r:y + r + 1, x - r:x + r + 1].reshape(-1, 3), axis=0)


TYPES = {k: sample_full(*p) for k, p in T['types'].items()}
type_lab = np.stack(list(TYPES.values()))
W_LAB = np.array([0.5, 1.0, 1.0], np.float32)
dist = np.linalg.norm((lab[:, :, None, :] - type_lab[None, None, :, :]) * W_LAB, axis=3)
unit_any = dist.min(axis=2) < T.get('tolerance', 16)
L, A, B = lab[:, :, 0] * 100 / 255, lab[:, :, 1] - 128, lab[:, :, 2] - 128
chroma = np.hypot(A, B)
# units + white corridors + grey lift cores; the plans' soft drop-shadows are grey too but only a metre or
# two wide, so grey only counts once it survives an opening at ~2.5 m
_k = max(3, int(2.5 * PX)) | 1
grey = cv2.morphologyEx(((L > 55) & (L <= 80) & (chroma < 10)).astype(np.uint8), cv2.MORPH_OPEN, np.ones((_k, _k), np.uint8)) > 0
corridor = ((L > 80) & (chroma < 9)) | grey      # + traced unit shapes, added after snapping (lawn can match unit colours)
dark = gray < T.get('outline', 95)                              # outlines and text


def snap(px, py, tol=None, outline=None):
    """Unit shape containing (px, py): same-colour region bounded by outlines."""
    c = fill_colour(px, py)
    d = np.linalg.norm((lab - c) * W_LAB, axis=2)
    edge = dark if outline is None else gray < outline
    region = ((d < (tol or T.get('fillTolerance', 18))) & ~edge).astype(np.uint8)
    region = cv2.morphologyEx(region, cv2.MORPH_OPEN, np.ones((2, 2), np.uint8))
    n, lbl = cv2.connectedComponents(region, connectivity=4)
    # the point may sit on the stack number: take the region that dominates a small window around it
    win = lbl[max(0, py - 16):py + 17, max(0, px - 16):px + 17]
    vals, counts = np.unique(win[win > 0], return_counts=True)
    if not len(vals):
        return None
    comp = (lbl == vals[counts.argmax()]).astype(np.uint8)
    comp = cv2.morphologyEx(comp, cv2.MORPH_CLOSE, np.ones((9, 9), np.uint8))   # absorb the number text
    cnts, _ = cv2.findContours(comp, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    cnt = max(cnts, key=cv2.contourArea)
    (cx, cy), (w, h), ang = cv2.minAreaRect(cnt)
    code = list(TYPES)[int(np.argmin(np.linalg.norm((type_lab - c) * W_LAB, axis=1)))]
    return {'cx': cx, 'cy': cy, 'w': w + 2, 'h': h + 2, 'ang': ang, 'area': cv2.contourArea(cnt), 'code': code, 'cnt': cnt}


def side_samples(d):
    """Each rect side: outward normal (image coords), fraction of open ground beyond it, side length."""
    rad = np.deg2rad(d['ang'])
    u, v = np.array([np.cos(rad), np.sin(rad)]), np.array([-np.sin(rad), np.cos(rad)])
    c = np.array([d['cx'], d['cy']])
    out = []
    for nrm, half_n, half_t, t in ((u, d['w'] / 2, d['h'] / 2, v), (-u, d['w'] / 2, d['h'] / 2, v),
                                   (v, d['h'] / 2, d['w'] / 2, u), (-v, d['h'] / 2, d['w'] / 2, u)):
        # a window side looks out over open ground: march 1-6 m out; any unit/corridor/core in the way blocks it
        ext = tot = 0
        for s in np.linspace(-0.8, 0.8, 9):
            hits = 0
            for m in np.arange(1.0, T.get('clearM', 6.0) + 0.01, 0.5):
                p = c + nrm * (half_n + m * PX) + t * (s * half_t)
                xi, yi = int(round(p[0])), int(round(p[1]))
                if 0 <= yi < H and 0 <= xi < W and interior[yi, xi]:
                    hits += 1
            tot += 1
            ext += hits < 2                                         # tolerate a stray pixel or two
        out.append((nrm, ext / tot, 2 * half_t))
    return out


def bearing(nrm):
    return round((np.degrees(np.arctan2(nrm[0], -nrm[1])) + UP) % 360)


SQM_BY = {'2RF1': 38, '2RF2': 46, '3RM': 66, '4RM': 90, '5RM': 110, '3GEN': 115, 'CCA': 36, 'RENT': 40}


def detect_regions():
    """Every unit-coloured, box-like region on the plan (seed-independent)."""
    out = []
    nearest = dist.argmin(axis=2)
    for ki, code in enumerate(TYPES):
        m = ((dist[:, :, ki] < T.get('tolerance', 16)) & (nearest == ki) & ~dark).astype(np.uint8)
        m = cv2.morphologyEx(m, cv2.MORPH_CLOSE, np.ones((3, 3), np.uint8))   # bridge the stack-number text
        n, lbl, stats, _ = cv2.connectedComponentsWithStats(m, connectivity=4)
        exp = SQM_BY.get(code, 70) * 1.2 * PX * PX
        for i in range(1, n):
            area = stats[i, cv2.CC_STAT_AREA]
            if not (0.4 * exp < area < 2.6 * exp):
                continue
            cnts, _ = cv2.findContours((lbl == i).astype(np.uint8), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
            cnt = max(cnts, key=cv2.contourArea)
            (cx, cy), (w, h), ang = cv2.minAreaRect(cnt)
            if w * h == 0 or cv2.contourArea(cv2.convexHull(cnt)) / (w * h) < 0.65 or max(w, h) / min(w, h) > 3.5:
                continue
            out.append({'cx': cx, 'cy': cy, 'w': w + 2, 'h': h + 2, 'ang': ang, 'area': float(area), 'code': code,
                        'cnt': cnt, 'cap': 2 if area > 1.6 * exp else 1})
    return out


if '--regions' in sys.argv:
    # labelling aid: number every detected region so trace.json can name units by region id ("r12")
    img_r = (plan * 0.6 + 255 * 0.4).astype(np.uint8)
    REGIONS_ALL = detect_regions()
    for i, r in enumerate(REGIONS_ALL):
        cv2.drawContours(img_r, [r['cnt']], -1, (0, 110, 0), 1)
        cv2.putText(img_r, f'r{i}', (int(r['cx']) - 10, int(r['cy']) + 4), cv2.FONT_HERSHEY_SIMPLEX, 0.36, (180, 0, 0), 1)
    cv2.imwrite(str(DIR / 'regions.png'), img_r)
    print(f'{len(REGIONS_ALL)} regions -> {DIR / "regions.png"}')
    sys.exit()

# match read-off points to detected regions one-to-one (nearest first): tolerant of points read a few metres off
REGIONS_ALL = REGIONS = detect_regions()


def _pt(v):
    if isinstance(v, str):                       # "r12" region id from regions.png; "r12.a"/"r12.b" = left/right half
        rid, _, half = v[1:].partition('.')
        r = REGIONS_ALL[int(rid)]
        cx, cy = r['cx'], r['cy']
        if half:
            rad = np.deg2rad(r['ang'])
            ax = np.array([np.cos(rad), np.sin(rad)]) if r['w'] >= r['h'] else np.array([-np.sin(rad), np.cos(rad)])
            ax = ax if ax[0] >= 0 else -ax       # 'a' = the half further left on the sheet
            off = max(r['w'], r['h']) / 4 * (-1 if half == 'a' else 1)
            cx, cy = cx + ax[0] * off, cy + ax[1] * off
        return cx + x0, cy + y0
    return v
seeds = [(blk, no, int(round(_pt(v)[0] - x0)), int(round(_pt(v)[1] - y0)))
         for blk, info in T['blocks'].items() for no, v in info['units'].items()]
named = {int(v[1:].partition('.')[0]) for info in T['blocks'].values() for v in info['units'].values() if isinstance(v, str)}
pairs = sorted(((np.hypot(r['cx'] - sx, r['cy'] - sy), si, ri) for si, (blk, no, sx, sy) in enumerate(seeds)
                if not isinstance(T['blocks'][blk]['units'][no], str)
                for ri, r in enumerate(REGIONS) if ri not in named), key=lambda t: t[0])
match, used = {}, {}
for dd, si, ri in pairs:
    if dd > T.get('matchM', 7) * PX or si in match or used.get(ri, 0) >= REGIONS[ri]['cap']:
        continue
    match[si] = ri
    used[ri] = used.get(ri, 0) + 1

def region_unit(v):
    """A unit named by region id: the whole region, or one half of it along its long side."""
    rid, _, half = v[1:].partition('.')
    r = {k: val for k, val in REGIONS_ALL[int(rid)].items() if k != 'cap'}
    if half:
        rad = np.deg2rad(r['ang'])
        long_w = r['w'] >= r['h']
        ax = np.array([np.cos(rad), np.sin(rad)]) if long_w else np.array([-np.sin(rad), np.cos(rad)])
        ax = ax if ax[0] >= 0 else -ax
        L = max(r['w'], r['h'])
        r['cx'], r['cy'] = r['cx'] + ax[0] * L / 4 * (-1 if half == 'a' else 1), r['cy'] + ax[1] * L / 4 * (-1 if half == 'a' else 1)
        if long_w:
            r['w'] = L / 2
        else:
            r['h'] = L / 2
        r['area'] /= 2
        r['cnt'] = cv2.boxPoints(((r['cx'], r['cy']), (r['w'], r['h']), r['ang'])).astype(np.int32).reshape(-1, 1, 2)
        r['halved'] = True
    return r


stacks, problems = [], []
for si, (blk, no, sx, sy) in enumerate(seeds):
    info = T['blocks'][blk]
    px, py = sx + x0, sy + y0
    v = info['units'][no]
    if isinstance(v, str):
        d = region_unit(v)
        d.update(no=int(no), blk=blk, seed=np.array([sx, sy], float), floors=info.get('storeysByStack', {}).get(no))
        stacks.append(d)
        continue
    if si in match:
        d = {k: v for k, v in REGIONS[match[si]].items() if k != 'cap'}
        d.update(no=int(no), blk=blk, seed=np.array([sx, sy], float), floors=info.get('storeysByStack', {}).get(no))
        stacks.append(d)
        continue
    if True:   # no detected region nearby: snap from the read-off point
        d = snap(px - x0, py - y0)
        expect = 60 * PX * PX
        ok = lambda d: d is not None and 0.35 * expect < d['area'] < 2.6 * expect
        for tol in (26, 34):                        # light fills (peach 2-room) drift in colour: widen and retry
            if d is None or d['area'] < 0.4 * expect:
                d = snap(px - x0, py - y0, tol) or d
        for tol, outl in ((12, 120), (9, 140)):     # leaked through a thin outline (small-scale sheets): tighten
            if d is not None and d['area'] > 2.6 * expect:
                d = snap(px - x0, py - y0, tol, outl) or d
        if not ok(d):
            problems.append(f"{blk}/{no}: {'no region' if d is None else 'area %.0f m2' % (d['area'] / PX / PX)} -> fallback box")
            c = fill_colour(px - x0, py - y0)
            code = list(TYPES)[int(np.argmin(np.linalg.norm((type_lab - c) * W_LAB, axis=1)))]
            d = {'cx': float(px - x0), 'cy': float(py - y0), 'code': code, 'fallback': True}
        rad = np.deg2rad(d.get('ang', 0))
        d.update(no=int(no), blk=blk, seed=np.array([px - x0, py - y0], float),
                 floors=info.get('storeysByStack', {}).get(no))
        stacks.append(d)

for d in stacks:                                 # flat types read off the plan override colour matching
    t = T['blocks'][d['blk']].get('types', {}).get(str(d['no']))
    if t:
        d['code'] = t

for d in [d for d in stacks if d.get('fallback')]:
    good = [g for g in stacks if g['blk'] == d['blk'] and not g.get('fallback')]
    # rect angles are only defined mod 90: fold to [0, 90) before taking the median
    d['ang'] = float(np.median([g['ang'] % 90 for g in good])) if good else 0.0
    a_m2 = SQM_BY.get(d['code'], 70) * 1.25                 # drawn footprint includes walls / household shelter
    d['w'], d['h'] = np.sqrt(a_m2 * 1.5) * PX, np.sqrt(a_m2 / 1.5) * PX
    d['area'] = d['w'] * d['h']
    d['cnt'] = cv2.boxPoints(((d['cx'], d['cy']), (d['w'], d['h']), d['ang'])).astype(np.int32).reshape(-1, 1, 2)

# units that share an outline can flood into one region: split it along its long side between their seeds
groups = {}
for d in (d for d in stacks if not d.get('fallback') and not d.get('halved')):
    groups.setdefault((round(d['cx'] / 3), round(d['cy'] / 3), round(d['w'] / 3), round(d['h'] / 3)), []).append(d)
for g in (g for g in groups.values() if len(g) > 1):
    d0 = g[0]
    rad = np.deg2rad(d0['ang'])
    u, v = np.array([np.cos(rad), np.sin(rad)]), np.array([-np.sin(rad), np.cos(rad)])
    long_u = d0['w'] >= d0['h']
    ax = u if long_u else v
    span = d0['w'] if long_u else d0['h']
    c0 = np.array([d0['cx'], d0['cy']])
    g.sort(key=lambda d: float((d['seed'] - c0) @ ax))
    k = len(g)
    for i, d in enumerate(g):
        off = (-span / 2 + span * (i + 0.5) / k)
        d['cx'], d['cy'] = (c0 + ax * off).tolist()
        if long_u:
            d['w'] = span / k
        else:
            d['h'] = span / k
        d['cnt'] = cv2.boxPoints(((d['cx'], d['cy']), (d['w'], d['h']), d['ang'])).astype(np.int32).reshape(-1, 1, 2)
    print(f"  split shared region into stacks {[d['no'] for d in g]}")

umask = np.zeros((H, W), np.uint8)
cv2.drawContours(umask, [d['cnt'] for d in stacks], -1, 1, -1)
interior = corridor | (cv2.dilate(umask, np.ones((3, 3), np.uint8)) > 0)
for d in stacks:
    sides = sorted(side_samples(d), key=lambda s: -s[1] * s[2])
    win = [s for s in sides if s[1] >= 0.5][:2] or sides[:1]
    rad = np.deg2rad(d['ang'])
    d.update(win=win, faces=[bearing(s[0]) for s in win], axis=bearing(np.array([np.cos(rad), np.sin(rad)])))


def outline_centroid(px, py):
    """Centroid of the white footprint enclosed by an existing block's thin outline."""
    g = gray.copy()
    mask = np.zeros((H + 2, W + 2), np.uint8)
    # the label box inside the outline is also white: fill through it, stop at the outline strokes
    cv2.floodFill(g, mask, (px, py), 0, loDiff=40, upDiff=40, flags=4 | cv2.FLOODFILL_MASK_ONLY | (255 << 8))
    m = mask[1:-1, 1:-1] > 0
    ys, xs = np.nonzero(m)
    return float(xs.mean()), float(ys.mean()), int(m.sum())


anchors = []
for a in T.get('anchors', []):
    cx, cy, area = outline_centroid(a['px'][0] - x0, a['px'][1] - y0)
    anchors.append({'postal': a['postal'], 'px': [round(cx, 1), round(cy, 1)], 'areaM2': round(area / PX / PX)})
    print(f"  anchor {a['postal']}: centroid ({cx:.0f},{cy:.0f}) footprint {area / PX / PX:.0f} m2")

pf = DIR / 'project.json'
P = json.loads(pf.read_text()) if pf.exists() else {}
P['plan'] = {'pxPerM': round(PX, 4), 'upBearing': UP, 'origin': [W / 2, H / 2],
             'image': {'file': 'siteplan.jpg', 'x0': 0, 'y0': 0, 'w': W, 'h': H}}
P['blocks'] = {blk: {'floors': info['storeys']} for blk, info in T['blocks'].items()}
P['anchors'] = anchors
P['stacks'] = [{'no': d['no'], 'block': d['blk'], 'px': round(d['cx'], 1), 'py': round(d['cy'], 1),
                'faces': d['faces'], 'type': d['code'], 'first': T['blocks'][d['blk']].get('first', 2),
                'axis': d['axis'], 'size': [round(d['w'] / PX / 2, 2), round(d['h'] / PX / 2, 2)],
                **({'floors': d['floors']} if d['floors'] else {})}
               for d in sorted(stacks, key=lambda d: d['no'])]
pf.write_text(json.dumps(P, separators=(',', ':')))
cv2.imwrite(str(DIR / 'siteplan.jpg'), plan, [cv2.IMWRITE_JPEG_QUALITY, 85])

dbg = (plan * 0.5 + 255 * 0.5).astype(np.uint8)
for d in stacks:
    box = cv2.boxPoints(((d['cx'], d['cy']), (d['w'], d['h']), d['ang'])).astype(np.int32)
    cv2.polylines(dbg, [box], True, (0, 120, 0), 2)
    for nrm, _, _ in d['win']:
        p0 = (int(d['cx']), int(d['cy']))
        cv2.arrowedLine(dbg, p0, (int(d['cx'] + nrm[0] * 5 * PX), int(d['cy'] + nrm[1] * 5 * PX)), (230, 80, 0), 2, tipLength=0.3)
    cv2.putText(dbg, f"{d['no']} {d['code']}", (int(d['cx']) - 22, int(d['cy']) + 4), cv2.FONT_HERSHEY_SIMPLEX, 0.38, (0, 0, 160), 1)
cv2.imwrite(str(DIR / 'trace-debug.png'), dbg)

types = {}
for d in stacks:
    types[d['code']] = types.get(d['code'], 0) + 1
print(f"px/m {PX:.3f}; {len(stacks)} stacks; types {types}")
for p in problems:
    print('  check', p)
