"""Each stack's own flat as rooms and walls in metres, for the 3D floor plan (blender/build_plan3d.py).

usage: python3 tools/extract_plan3d.py [--debug] <slug>...

Reads the stack's typical-plan page (project.json layouts[no].page) of the HDB sales brochure at 300 DPI:
- unit blob: coloured fill near the "UNIT <no>" label (fills bridged across walls); a blob shared by several labels
  is split room by room, each room going to the nearest label along x;
- rooms: the fill grown from each room-name label (BEDROOM, KITCHEN, ...) up to the drawn lines;
- walls: dark lines around the unit; thick = solid, thin on the outside = window, thin inside = partition;
- scale: the page's "SCALE 0 ... 10 METRES" bar, else floor area = HDB's internal sqm.
A stack that fails a check (scale vs HDB floor area, required rooms, page edge) gets no JSON; the reason is printed.
Writes projects/<slug>/plans3d/<no>.json.
"""
import cmath, json, math, re, subprocess, sys
from collections import deque
from functools import lru_cache
from pathlib import Path

import cv2
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
from extract_layouts import brochure, ocr_words, pages   # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
DPI = 300
K = DPI / 72                                     # px per pt
BEDROOMS = {'2RF1': 1, '2RF2': 1, '3RM': 2, '4RM': 3, '5RM': 3, '3GEN': 4}
KIND = [('bedroom', r'BEDROOM'), ('living', r'LIVING|DINING'), ('kitchen', r'KITCHEN'), ('bath', r'BATH|\bWC\b'),
        ('yard', r'YARD'), ('shelter', r'SHELTER'), ('ledge', r'LEDGE'), ('other', r'STUDY|STORE')]
AREA_TOL, PAGE_TOL = 0.15, 0.12


@lru_cache(maxsize=None)
def _pages(slug):
    return pages(brochure(slug))


def render(slug, page):
    png = ROOT / 'reference/hdb/brochures/.render' / f'plan3d-{slug}-{page}.png'
    if not png.exists():
        png.parent.mkdir(parents=True, exist_ok=True)
        subprocess.run(['pdftoppm', '-r', str(DPI), '-f', str(page), '-l', str(page), '-png', '-singlefile',
                        str(brochure(slug)), str(png.with_suffix(''))], check=True)
    return png


def ocr_tiles(slug, page):
    """OCR at 600 DPI in overlapping tiles (small outlined room names need the resolution), as 300-DPI px words."""
    big = ROOT / 'reference/hdb/brochures/.render' / f'plan3d-{slug}-{page}-600.png'
    if not big.exists():
        subprocess.run(['pdftoppm', '-r', '600', '-f', str(page), '-l', str(page), '-png', '-singlefile',
                        str(brochure(slug)), str(big.with_suffix(''))], check=True)
    img = cv2.imread(str(big)); H, W = img.shape[:2]
    T, O, k = 1600, 250, 600 / 72
    out, seen = [], set()
    tile = big.with_name(big.stem + '-tile.png')
    for y in range(0, H, T - O):
        for x in range(0, W, T - O):
            cv2.imwrite(str(tile), img[y:y + T, x:x + T])
            for t, x0, y0, x1, y1 in ocr_words(str(tile), k):
                key = (t, round((x0 * k + x) / 40), round((y0 * k + y) / 40))     # same word seen in two tiles
                if key not in seen:
                    seen.add(key)
                    out.append((t, (x0 * k + x) / 2, (y0 * k + y) / 2, (x1 * k + x) / 2, (y1 * k + y) / 2))
    tile.unlink(missing_ok=True)
    return out                                                     # 300-DPI px


def words_px(slug, page, png):
    w = [(t, x0 * K, y0 * K, x1 * K, y1 * K) for t, x0, y0, x1, y1 in _pages(slug)[page - 1][3]]
    if not any(re.search(r'BEDROOM|KITCHEN', t.upper()) for t, *_ in w):      # room names drawn as outlines: OCR
        o = ocr_tiles(slug, page)
        w = o if not any(t.upper() == 'UNIT' for t, *_ in w) else w + [x for x in o if not re.fullmatch(r'UNIT|\d{2,4}[A-Z]?', x[0].upper())]
    return w


def unit_labels(words):
    out = {}
    for t, x0, y0, x1, y1 in words:
        if t.upper() != 'UNIT':
            continue
        nxt = [w for w in words if re.fullmatch(r'\d{2,4}[A-Z]?', w[0]) and abs(w[2] - y0) < 15 and 0 <= w[1] - x1 < 40]
        if nxt:
            n = min(nxt, key=lambda w: w[1])
            out[n[0]] = (x0, y0, n[3], n[4])
    return out


def scale_bar(words):
    """px per metre from 'SCALE 0 2 4 6 8 10 METRES', or None."""
    m = [w for w in words if w[0].upper().startswith('METRE')]
    if not m:
        return None
    y = m[0][2]
    nums = {w[0]: (w[1] + w[3]) / 2 for w in words if abs(w[2] - y) < 15 and w[0] in ('0', '10') and w[1] < m[0][1]}
    return (nums['10'] - nums['0']) / 10 if len(nums) == 2 and nums['10'] > nums['0'] else None


def room_seeds(words, fill):
    """Room-name word groups inside the fill: [(type, name, x, y)]."""
    w = [x for x in words if re.search(r'[A-Z]{2}', x[0].upper()) and not re.fullmatch(r'W\d|UNIT|ROOM', x[0].upper())]
    used, out = set(), []
    for i, a in enumerate(w):
        if i in used:
            continue
        grp, used_i = [a], {i}
        for j, b in enumerate(w):                                  # stacked lines of one label ("MAIN" / "BEDROOM")
            if j not in used_i and j not in used and any(abs(b[1] - g[1]) < 25 and 0 < b[2] - g[4] < 12 for g in grp):
                grp.append(b); used_i.add(j)
        used |= used_i
        name = ' '.join(g[0] for g in grp).upper()
        typ = next((k for k, rx in KIND if re.search(rx, name)), None)
        cx, cy = (min(g[1] for g in grp) + max(g[3] for g in grp)) / 2, (min(g[2] for g in grp) + max(g[4] for g in grp)) / 2
        if typ and fill[int(cy), int(cx)] or (typ and fill[int(cy) - 6:int(cy) + 7, int(cx) - 6:int(cx) + 7].any()):
            out.append((typ, name, cx, cy))
    return out


def grow(passable, seeds):
    """Multi-source BFS from the seeds through passable pixels: label image (0 = none, i+1 = seed i)."""
    h, w = passable.shape
    lab = np.zeros((h, w), np.int32)
    q = deque()
    for i, (_, _, x, y) in enumerate(seeds):
        ys, xs = np.nonzero(passable[max(0, int(y) - 8):int(y) + 9, max(0, int(x) - 8):int(x) + 9])
        if len(xs):
            k = np.argmin((xs - 8) ** 2 + (ys - 8) ** 2)
            p = (max(0, int(y) - 8) + ys[k], max(0, int(x) - 8) + xs[k])
            lab[p] = i + 1; q.append(p)
    while q:
        y, x = q.popleft()
        v = lab[y, x]
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            yy, xx = y + dy, x + dx
            if 0 <= yy < h and 0 <= xx < w and passable[yy, xx] and not lab[yy, xx]:
                lab[yy, xx] = v; q.append((yy, xx))
    return lab


def rects(mask):
    """Axis-aligned rectangles covering a mask: row runs merged down while identical. [(x0, y0, x1, y1)] px."""
    out, open_ = [], {}
    for y in range(mask.shape[0] + 1):
        runs = set()
        if y < mask.shape[0]:
            row = np.concatenate(([0], mask[y].astype(np.int8), [0]))
            d = np.flatnonzero(np.diff(row))
            runs = set(zip(d[::2], d[1::2]))
        for r in list(open_):
            if r not in runs:
                out.append((r[0], open_.pop(r), r[1], y))
        for r in runs:
            open_.setdefault(r, y)
    return out


def page_north(P, labels):
    """Compass bearing of page-up: rotation that maps the unit labels on the page onto the same stacks on the
    georeferenced site plan (stack px/py + plan.upBearing). None when fewer than 3 stacks or a poor fit."""
    S = {str(s['no']): s for s in P['stacks']}
    ids = [n for n in labels if n in S and 'px' in S[n]]
    if len(ids) < 3 or not P.get('plan'):
        return None
    pg = [complex((labels[n][0] + labels[n][2]) / 2, (labels[n][1] + labels[n][3]) / 2) for n in ids]
    st = [complex(S[n]['px'], S[n]['py']) for n in ids]
    cp, cs = sum(pg) / len(pg), sum(st) / len(st)
    rot = sum((a - cp).conjugate() * (b - cs) for a, b in zip(pg, st))
    k = rot / sum(abs(a - cp) ** 2 for a in pg)
    resid = sum(abs((a - cp) * k - (b - cs)) for a, b in zip(pg, st)) / len(ids)
    if resid > 0.35 * sum(abs(b - cs) for b in st) / len(ids):
        return None
    return round((P['plan']['upBearing'] + math.degrees(cmath.phase(rot))) % 360, 1)


def extract_page(slug, page):
    P = json.loads((ROOT / 'projects' / slug / 'project.json').read_text())
    stacks = {str(s['no']): s for s in P['stacks']}
    mine = [no for no, l in (P.get('layouts') or {}).items() if l['page'] == page]
    png = render(slug, page)
    img = cv2.imread(str(png))
    H, W = img.shape[:2]
    hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
    line = (hsv[..., 2] < 110).astype(np.uint8)
    fill = ((hsv[..., 1] > 40) & (hsv[..., 2] > 150)).astype(np.uint8)
    words = words_px(slug, page, png)
    labels, bar = unit_labels(words), scale_bar(words)
    pnorth = page_north(P, labels)
    blob_n, blob = cv2.connectedComponents(cv2.morphologyEx(fill, cv2.MORPH_CLOSE, np.ones((25, 25), np.uint8)))
    # each label claims the blob nearest to it (within 150 px above or below)
    owner = {}
    for no, (x0, y0, x1, y1) in labels.items():
        ya, yb = max(0, int(y0) - 150), min(H, int(y1) + 150)
        win = blob[ya:yb, max(0, int(x0) - 20):min(W, int(x1) + 20)]
        ids, cnt = np.unique(win[win > 0], return_counts=True)
        if len(ids):
            owner.setdefault(int(ids[np.argmax(cnt)]), []).append(no)
    seeds = room_seeds(words, fill)
    passable = fill.astype(bool) & ~line.astype(bool)
    lab = grow(passable, seeds)
    # coloured regions no room name reached (stores, lobbies): unnamed rooms, so they count towards the flat
    n, cc, stats, cent = cv2.connectedComponentsWithStats((passable & (lab == 0)).astype(np.uint8), connectivity=4)
    for i in range(1, n):
        if stats[i][4] > 400:
            seeds.append(('other', '', float(cent[i][0]), float(cent[i][1])))
            lab[cc == i] = len(seeds)
    out, scales = {}, {}
    for no in mine:
        st = stacks.get(no)
        if not st or st['type'] not in BEDROOMS:
            out[no] = f"no 3D model for flat type {st and st['type']}"; continue
        if no not in labels:
            out[no] = 'unit label not found on page'; continue
        b = next((k for k, v in owner.items() if no in v), None)
        if b is None:
            out[no] = 'no coloured plan next to the unit label'; continue
        lx = {n: (labels[n][0] + labels[n][2]) / 2 for n in owner[b]}
        rooms = [i for i, (_, _, x, y) in enumerate(seeds) if blob[int(y), int(x)] == b
                 and min(lx, key=lambda n: abs(lx[n] - x)) == no and (lab == i + 1).any()]
        types = [seeds[i][0] for i in rooms]
        need = {'living', 'kitchen', 'bath'} - set(types)
        if types.count('bedroom') != BEDROOMS[st['type']] or need:
            out[no] = f"rooms found {sorted(types)} don't match a {st['type']}"; continue
        unit = np.isin(lab, [i + 1 for i in rooms]).astype(np.uint8)
        unit_c = cv2.morphologyEx(unit, cv2.MORPH_CLOSE, np.ones((15, 15), np.uint8))
        ys, xs = np.nonzero(unit_c)
        x0, y0, x1, y1 = int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1
        if x0 < 5 or y0 < 5 or x1 > W - 5 or y1 > H - 5:
            out[no] = 'plan touches the page edge'; continue
        floor = cv2.morphologyEx(np.isin(lab, [i + 1 for i in rooms if seeds[i][0] != 'ledge']).astype(np.uint8),
                                 cv2.MORPH_CLOSE, np.ones((15, 15), np.uint8))
        target = (P.get('prices') or {}).get(st['type'], {}).get('internalSqm')
        if not target:
            out[no] = 'no HDB floor area for this flat type'; continue
        ppm_area = (floor.sum() / target) ** 0.5
        ppm = bar or ppm_area
        if bar and abs((floor.sum() / bar ** 2) / target - 1) > AREA_TOL:
            out[no] = f'floor area at the drawn scale {floor.sum() / bar ** 2:.0f} sqm vs HDB {target} sqm'; continue
        scales[no] = ppm_area
        # walls around the unit, by stroke width and position
        near = cv2.dilate(unit_c, np.ones((25, 25), np.uint8)).astype(bool)
        wl = (line.astype(bool) & near).astype(np.uint8)
        n, cc, stats, _ = cv2.connectedComponentsWithStats(wl)
        wl[np.isin(cc, [i for i in range(1, n) if max(stats[i][2], stats[i][3]) < 25])] = 0   # dashed door swings: short dashes
        solid = cv2.morphologyEx(wl, cv2.MORPH_OPEN, np.ones((7, 7), np.uint8))
        thin = wl & (1 - solid)
        inner = cv2.erode(unit_c, np.ones((9, 9), np.uint8)).astype(bool)
        window = (thin.astype(bool) & ~inner).astype(np.uint8)
        part = (thin.astype(bool) & inner).astype(np.uint8)
        cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
        m = lambda x, y: [round((x - cx) / ppm, 3), round((y - cy) / ppm, 3)]
        walls = [{'rect': m(a, b) + m(c, d), 'kind': k} for k, mk in (('solid', solid), ('window', window), ('partition', part))
                 for a, b, c, d in rects(mk)]
        room_out = []
        for i in rooms:
            r = (lab == i + 1).astype(np.uint8)
            c = max(cv2.findContours(r, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)[0], key=cv2.contourArea)
            c = cv2.approxPolyDP(c, 1.5, True)[:, 0]
            room_out.append({'type': seeds[i][0], 'name': seeds[i][1], 'poly': [m(x, y) for x, y in c],
                             'label': m(seeds[i][2], seeds[i][3])})
        # window side = the side of the plan with most "W1"-style window tags just outside it
        tags = [((a + c) / 2, (b + d) / 2) for t, a, b, c, d in words
                if re.fullmatch(r'W\d', t.upper()) and x0 - 60 < a and c < x1 + 60 and y0 - 60 < b and d < y1 + 60]
        dist = lambda x, y: {'top': y - y0, 'bottom': y1 - y, 'left': x - x0, 'right': x1 - x}
        sides = [min(dist(x, y).items(), key=lambda kv: kv[1])[0] for x, y in tags] or ['top']
        side = max(set(sides), key=sides.count)
        north = pnorth if pnorth is not None else (st['faces'][0] - {'top': 0, 'right': 90, 'bottom': 180, 'left': 270}[side]) % 360
        out[no] = {'stack': no, 'page': page, 'bboxPx': [x0, y0, x1, y1],
                   'scale': {'pxPerM': round(ppm, 2), 'source': 'scale bar' if bar else 'floor area', 'targetSqm': target,
                             'areaSqm': round(float(floor.sum()) / ppm ** 2, 1)},
                   'rooms': room_out, 'walls': walls, 'north': north}
    if not bar and scales:                                       # no scale bar: one drawing scale per page
        med = float(np.median(list(scales.values())))
        for no, s in scales.items():
            if abs(s / med - 1) > PAGE_TOL:
                out[no] = f'scale {s:.1f} px/m is off the page median {med:.1f}'
    return out


def debug_png(slug, plan, path):
    img = cv2.imread(str(render(slug, plan['page'])))
    x0, y0, x1, y1 = plan['bboxPx']
    ppm, cx, cy = plan['scale']['pxPerM'], (x0 + x1) / 2, (y0 + y1) / 2
    px = lambda p: (int(p[0] * ppm + cx), int(p[1] * ppm + cy))
    col = {'solid': (0, 0, 200), 'window': (200, 120, 0), 'partition': (0, 160, 0)}
    for w in plan['walls']:
        cv2.rectangle(img, px(w['rect'][:2]), px(w['rect'][2:]), col[w['kind']], -1)
    for r in plan['rooms']:
        cv2.polylines(img, [np.array([px(p) for p in r['poly']])], True, (255, 0, 255), 2)
        cv2.putText(img, r['type'], px(r['label']), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 0, 255), 2)
    cv2.imwrite(str(path), img[max(0, y0 - 40):y1 + 40, max(0, x0 - 40):x1 + 40])


def extract_project(slug, debug=False):
    D = ROOT / 'projects' / slug
    P = json.loads((D / 'project.json').read_text())
    out_dir = D / 'plans3d'
    out_dir.mkdir(exist_ok=True)
    res = {}
    for page in sorted({l['page'] for l in (P.get('layouts') or {}).values()}):
        res.update(extract_page(slug, page))
    for f in out_dir.glob('*.json'):
        if not isinstance(res.get(f.stem), dict):
            f.unlink()
    for no, v in res.items():
        if isinstance(v, dict):
            (out_dir / f'{no}.json').write_text(json.dumps(v, separators=(',', ':')))
            if debug:
                debug_png(slug, v, ROOT / 'reference/hdb/brochures/.render' / f'plan3d-{slug}-{no}.png')
    return sum(isinstance(v, dict) for v in res.values()), {k: v for k, v in res.items() if isinstance(v, str)}


if __name__ == '__main__':
    debug = '--debug' in sys.argv
    for slug in [a for a in sys.argv[1:] if not a.startswith('--')]:
        n, why = extract_project(slug, debug)
        total = n + len(why)
        print(f'{slug}: {n}/{total} stacks')
        for no, r in sorted(why.items(), key=lambda kv: int(re.sub(r'\D', '', kv[0]) or 0)):
            print(f'  {no}: {r}')
