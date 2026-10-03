"""In-project facilities from an HDB site plan: numbered black discs on the plan + the legend that names them.

usage: python3 tools/trace_facilities.py projects/<slug> [--debug out.png]

Legend: every disc in the legend panel (right of planBox) is OCR'd for its number, and the text to its right for the
facility name. Plan: every disc inside planBox is OCR'd for its number and placed in world coordinates.
Writes project.json["facilities"] = [{"n": 1, "name": "Children playground", "x": .., "z": ..}, ...].
"""
import json, math, re, subprocess, sys, tempfile
from pathlib import Path

import cv2
import numpy as np

D = Path(sys.argv[1])
T = json.loads((D / 'trace.json').read_text())
P = json.loads((D / 'project.json').read_text())
img = cv2.imread(T['image'])
gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
H, W = gray.shape
x0, y0, x1, y1 = T['planBox']


def ocr(im, psm, wl=None):
    with tempfile.NamedTemporaryFile(suffix='.png') as f:
        cv2.imwrite(f.name, im)
        cmd = ['tesseract', f.name, '-', '--psm', str(psm)] + (['-c', f'tessedit_char_whitelist={wl}'] if wl else [])
        return subprocess.run(cmd, capture_output=True, text=True).stdout.strip()


def discs(region):
    """Filled dark discs (number markers) in a region: (cx, cy, r) in full-image coords."""
    rx0, ry0, rx1, ry1 = region
    g = gray[ry0:ry1, rx0:rx1]
    m = (g < 70).astype(np.uint8)
    m = cv2.morphologyEx(m, cv2.MORPH_CLOSE, np.ones((5, 5), np.uint8))     # fill the white digit
    n, lbl, st, cen = cv2.connectedComponentsWithStats(m, 8)
    out = []
    for i in range(1, n):
        w, h, a = st[i, 2], st[i, 3], st[i, 4]
        if 14 <= w <= 70 and 0.8 < w / h < 1.25 and a / (math.pi * (w / 2) * (h / 2)) > 0.8:
            out.append((cen[i][0] + rx0, cen[i][1] + ry0, (w + h) / 4))
    return out


def digit(cx, cy, r):
    """White digit on a black disc: binarise inside the disc, OCR at a few scales, majority vote."""
    from collections import Counter
    k = int(r * 1.15)
    c = gray[int(cy) - k:int(cy) + k, int(cx) - k:int(cx) + k]
    if c.shape[0] < 2 * k or c.shape[1] < 2 * k:
        return None
    yy, xx = np.mgrid[:c.shape[0], :c.shape[1]]
    b0 = (c > 140).astype(np.uint8) * 255
    b0[(xx - k) ** 2 + (yy - k) ** 2 > (r * 0.82) ** 2] = 0
    b0 = 255 - b0
    votes = []
    for sc in (60, 100):
        for th in (0, 1):
            b = cv2.resize(b0, None, fx=sc / c.shape[0], fy=sc / c.shape[0], interpolation=cv2.INTER_NEAREST)
            if th:
                b = cv2.erode(b, np.ones((3, 3), np.uint8))
            b = cv2.copyMakeBorder(b, 30, 30, 30, 30, cv2.BORDER_CONSTANT, value=255)
            t = re.sub(r'\D', '', ocr(b, 10, '0123456789'))
            if t and 0 < int(t) < 30:
                votes.append(int(t))
    return Counter(votes).most_common(1)[0][0] if votes else None


# legend: discs to the right of the plan, name = text in the strip right of the disc
VOCAB = ['Children playground', 'Adult fitness station', 'Elderly fitness station', 'Hardcourt', 'Precinct pavilion',
         'Heritage gallery / precinct pavilion', 'Drop-off porch', 'Space reserved for future community use', 'Preschool',
         "Residents' network centre", 'Future amenities / facilities', 'Eating house', 'Shops', 'Supermarket', 'Minimart',
         'Senior care centre', 'Plaza', 'Entrance plaza', 'Kidney dialysis centre', 'Restaurant', 'Cafe', 'Community garden']


def canonical(txt):
    """Snap OCR text to the standard HDB facility name; keep an 'at 1st storey'-style suffix; drop unreadable text."""
    from difflib import SequenceMatcher
    t = re.sub(r'[’`]', "'", txt.lower()).replace('pavillion', 'pavilion').replace('pre-school', 'preschool').replace('mini-mart', 'minimart')
    t = re.sub(r'preschoolat', 'preschool at', t)
    best, score = None, 0
    for v in VOCAB:
        sc = SequenceMatcher(None, t[:len(v) + 2], v.lower()).ratio()
        if sc > score:
            best, score = v, sc
    if score < 0.72:
        return None
    m = re.search(r'at (1st|2nd|1st and 2nd)\s*stor', t)
    return best + (f' (at {m.group(1)} storey)' if m else '')


legend = {}
LD = discs((x1 + 10, 0, W, H))
for cx, cy, r in LD:
    n = digit(cx, cy, r)
    if n is None:
        continue
    # text runs right of the disc until the next legend disc on the same row (two-column legends)
    right = [ox_ for ox_, oy_, _ in LD if ox_ > cx + r and abs(oy_ - cy) < r]
    xe = int(min(right) - r * 1.3) if right else int(min(W, cx + r * 1.4 + 0.42 * (W - x1)))
    strip = gray[int(cy - r * 1.15):int(cy + r * 1.15), int(cx + r * 1.4):xe]
    if strip.size == 0:
        continue
    strip = cv2.resize(strip, None, fx=2, fy=2, interpolation=cv2.INTER_CUBIC)
    txt = ' '.join(ocr(strip, 7).split())
    txt = re.sub(r'^[^A-Za-z]+', '', txt)
    txt = re.sub(r'(\s+\S{1,2})+$', '', txt).strip(' .,;:/-')        # trailing OCR crumbs
    name = canonical(txt)
    if name and n not in legend:
        legend[n] = name

# plan: discs inside the drawing; world position via the plan georeference
pl = P['plan']; PX = pl['pxPerM']; ox, oy = pl['origin']; b = math.radians(pl['upBearing'])
fac = []
def plan_discs(r0):
    """Markers on the plan often touch dark linkways, so find circles of the legend's size and check the core is black."""
    g = cv2.medianBlur(gray[y0:y1, x0:x1], 3)
    # plan markers are drawn at 0.45-1.3x the legend disc size depending on the sheet
    cs = cv2.HoughCircles(g, cv2.HOUGH_GRADIENT, dp=1, minDist=max(8, r0 * 0.45), param1=120, param2=11,
                          minRadius=max(6, int(r0 * 0.45)), maxRadius=int(r0 * 1.3))
    out = []
    for cx, cy, r in (cs[0] if cs is not None else []):
        yy, xx = np.mgrid[-int(r):int(r) + 1, -int(r):int(r) + 1]
        ring = (xx ** 2 + yy ** 2 <= (r * 0.85) ** 2)
        patch = gray[y0 + int(cy) - int(r):y0 + int(cy) + int(r) + 1, x0 + int(cx) - int(r):x0 + int(cx) + int(r) + 1]
        if patch.shape != ring.shape:
            continue
        v = patch[ring]
        dk = (v < 70).mean()
        if dk > 0.65 and (v > 170).mean() > 0.03:                     # black disc with a white digit
            out.append((dk, float(cx) + x0, float(cy) + y0, float(r)))
    # keep the darkest of overlapping candidates
    keep = []
    for dk, cx, cy, r in sorted(out, reverse=True):
        if all(math.hypot(cx - a, cy - b) > max(r, rb) for a, b, rb in keep):
            keep.append((cx, cy, r))
    return keep


R0 = float(np.median([r for *_, r in LD])) if LD else 20.0
for cx, cy, r in plan_discs(R0):
    n = digit(cx, cy, r)
    if n is None or n not in legend:
        continue
    lx, lz = (cx - x0 - ox) / PX, (cy - y0 - oy) / PX
    fac.append({'n': n, 'name': legend[n], 'x': round(lx * math.cos(b) - lz * math.sin(b), 1),
                'z': round(lx * math.sin(b) + lz * math.cos(b), 1), 'px': [round(cx), round(cy)]})
P['facilities'] = fac
(D / 'project.json').write_text(json.dumps(P, separators=(',', ':')))
print(f"{D.name}: legend {len(legend)} {dict(sorted(legend.items()))}; {len(fac)} markers on plan "
      f"{sorted(f['n'] for f in fac)}")

if '--debug' in sys.argv:
    dbg = img.copy()
    for f in fac:
        cv2.circle(dbg, tuple(f['px']), 26, (255, 0, 255), 3)
        cv2.putText(dbg, str(f['n']), (f['px'][0] + 26, f['px'][1]), 0, 0.9, (255, 0, 255), 2)
    cv2.imwrite(sys.argv[sys.argv.index('--debug') + 1], dbg)
