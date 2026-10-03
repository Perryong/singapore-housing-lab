"""Each stack's own floor plan, cropped from the block floor-plan pages of the project's HDB sales brochure.

usage: python3 tools/extract_layouts.py <slug>...

Pages titled "BLOCK <blk> | <storeys> FLOOR PLAN" draw every unit with a "UNIT <stack>" label beside it. The crop is
centred on the label, as wide as the gap to the neighbouring labels on the same row, and extends into the drawing
(the side of the label with ink) until the white common corridor. The page covering the most storeys is the stack's
"typical" plan; a narrower page starting at a lower storey is kept as "lowest".
Writes projects/<slug>/layouts/<stack>.png (+ <stack>-low.png) and project.json["layouts"].
"""
import json, re, subprocess, sys
from pathlib import Path
from xml.etree import ElementTree as ET

import cv2
import numpy as np

ROOT = Path(__file__).resolve().parent.parent
DPI = 200
ORD = r'(\d+)(?:ST|ND|RD|TH)'


def brochure(slug):
    f = ROOT / 'reference/hdb/brochures' / f'{slug}.pdf'
    if not f.exists():
        launch = {p['slug']: p['launch'] for p in json.loads((ROOT / 'reference/hdb/launched.json').read_text())}[slug]
        f.parent.mkdir(parents=True, exist_ok=True)
        subprocess.run(['curl', '-sfL', '-A', 'Mozilla/5.0', '-o', str(f),
                        f'https://btohq.sgp1.cdn.digitaloceanspaces.com/bto/{launch}/{slug}.pdf'], check=True)
    return f


def pages(pdf):
    """[(page_no, width_pt, height_pt, [words (text, x0, y0, x1, y1)])] via pdftotext -bbox-layout."""
    xml = subprocess.run(['pdftotext', '-bbox-layout', str(pdf), '-'], capture_output=True, text=True).stdout
    xml = re.sub(r'<!DOCTYPE[^>]*>', '', xml).replace('xmlns="http://www.w3.org/1999/xhtml"', '')
    out = []
    for i, pg in enumerate(ET.fromstring(xml).iter('page'), 1):
        words = [(w.text or '', *(float(w.get(k)) for k in ('xMin', 'yMin', 'xMax', 'yMax'))) for w in pg.iter('word')]
        out.append((i, float(pg.get('width')), float(pg.get('height')), words))
    return out


def storeys(title):
    """(lowest storey, number of storeys covered) for titles like '3RD TO 16TH & 18TH TO 28TH STOREY'."""
    lo, n = None, 0
    for part in re.split(r'&|,|AND', title.upper()):
        m = re.search(ORD + r'\s+TO\s+' + ORD, part) or re.search(ORD, part)
        if m:
            a, b = int(m.group(1)), int(m.group(m.lastindex))
            lo = a if lo is None else min(lo, a)
            n += b - a + 1
    return (lo or 0), n


def ocr_words(png, k):
    """Text drawn as outlines: tesseract word boxes, converted to pt."""
    tsv = subprocess.run(['tesseract', png, '-', '--psm', '11', 'tsv'], capture_output=True).stdout.decode('utf-8', 'ignore')
    out = []
    for ln in tsv.splitlines()[1:]:
        f = ln.split('\t')
        if len(f) == 12 and f[11].strip() and float(f[10]) > 40:
            x, y, w, h = (int(v) / k for v in f[6:10])
            t = f[11].strip()
            if re.fullmatch(r'[\dlIO|]{2,4}', t) and re.search(r'\d', t):     # OCR digit confusions
                t = t.translate(str.maketrans('lI|O', '1110'))
            out.append((t, x, y, x + w, y + h))
    return out


def metres_per_pt(words):
    """Scale bar '0 2 4 6 8 10 METERS': distance between the '0' and '10' ticks."""
    for i, w in enumerate(words):
        if w[0].upper().startswith('METRE') or w[0].upper().startswith('METER'):
            row = [x for x in words if abs(x[2] - w[2]) < 3]
            z = [x for x in row if x[0] == '0']; t = [x for x in row if x[0] == '10']
            if z and t:
                return 10 / (((t[0][1] + t[0][3]) / 2) - ((z[0][1] + z[0][3]) / 2))
    return None


def crop_unit(img, k, label, sqm, m_per_pt, others=()):
    """Box around one unit: sized from its floor area, placed on the side of the label where the coloured
    drawing is. img: BGR page render; k: px per pt; label: (x0,y0,x1,y1) pt."""
    H, W = img.shape[:2]
    x0, y0, x1, y1 = label
    lx, ly = (x0 + x1) / 2 * k, (y0 + y1) / 2 * k
    side = (sqm ** 0.5) * 1.8 / m_per_pt * k                 # px; generous: units are not square
    hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
    col = (hsv[:, :, 1] > 60) & (hsv[:, :, 2] > 120)            # unit fills (yellow / orange / green ...)
    R = int(side * 0.9)
    ys, xs = np.nonzero(col[max(0, int(ly) - R):int(ly) + R, max(0, int(lx) - R):int(lx) + R])
    if not len(xs):
        return None
    dx, dy = xs.mean() + max(0, int(lx) - R) - lx, ys.mean() + max(0, int(ly) - R) - ly
    n = max(1e-6, (dx * dx + dy * dy) ** 0.5)
    cx, cy = lx + dx / n * side * 0.55, ly + dy / n * side * 0.55
    l, r = int(min(cx - side / 2, x0 * k - 4)), int(max(cx + side / 2, x1 * k + 4))
    t, b = int(min(cy - side / 2, (y0 - 22) * k)), int(max(cy + side / 2, y1 * k + 4))
    # neighbouring units' labels on the same row bound the crop halfway between the two labels
    l0, r0 = l, r
    for ox0, oy0, ox1, oy1 in others:
        ocx, ocy = (ox0 + ox1) / 2 * k, (oy0 + oy1) / 2 * k
        if abs(ocy - ly) < 15 * k:
            g = abs(lx - ocx)                                 # labels aren't centred over their units:
            if ocx < lx:                                      # allow 20% of the gap past the midpoint
                l = max(l, int((ocx + lx) / 2 - 0.2 * g))
            elif ocx > lx:
                r = min(r, int((ocx + lx) / 2 + 0.2 * g))
    l, r = min(l, int(x0 * k) - 8), max(r, int(x1 * k) + 8)   # never cut into this stack's own label
    if r - l < 0.6 * side:                                    # dense rows: a strip is useless, keep the full box
        l, r = l0, r0
    out = img[max(0, t):min(H, b), max(0, l):min(W, r)].copy()
    # outline this stack's own label so it is unmistakable which unit the plan is for
    cv2.rectangle(out, (int(x0 * k) - 6 - max(0, l), int(y0 * k) - 4 - max(0, t)),
                  (int(x1 * k) + 6 - max(0, l), int(y1 * k) + 4 - max(0, t)), (255, 127, 43), 3)
    return out


def extract(slug):
    D = ROOT / 'projects' / slug
    P = json.loads((D / 'project.json').read_text())
    pdf = brochure(slug)
    found = {}                                                # stack -> [(span, lo, page, crop)]
    first = subprocess.run(['pdftotext', '-l', '6', str(pdf), '-'], capture_output=True, text=True).stdout
    if re.sub(r'[^a-z]', '', P['name'].lower()) not in re.sub(r'[^a-z]', '', first.lower()):
        print(f"  {slug}: brochure at source is not {P['name']}'s (source error) — skipped")
        P['layouts'] = {}
        (D / 'project.json').write_text(json.dumps(P, separators=(',', ':')))
        return {}
    stack_set = {str(s['no']) for s in P['stacks']}
    block_of = {str(s['no']): str(s['block']).upper() for s in P['stacks']}
    blocks_of = set(block_of.values())
    for pno, pw, ph, words in pages(pdf):
        text = ' '.join(w[0] for w in words)
        has_units = sum(w[0].upper() == 'UNIT' for w in words) >= 2
        if not has_units and not re.search(r'\b(BEDROOM|KITCHEN)\b', text) and len(words) > 60:
            continue                                          # a text page; drawing-only pages are OCR'd below
        png = ROOT / 'reference/hdb/brochures/.render' / f'{slug}-{pno}'
        png.parent.mkdir(exist_ok=True)
        subprocess.run(['pdftoppm', '-f', str(pno), '-l', str(pno), '-r', str(DPI), '-png', '-singlefile', str(pdf), str(png)], check=True)
        img = cv2.imread(str(png) + '.png')
        k = img.shape[1] / pw
        TITLE = re.compile(r'(?:BLOCKS?|BLK)\s+(\w+)\s*[|Il]?\s*(.{3,90}?STOREYS?)\s*(?:FLOOR\s+)?PLAN', re.I)
        t = TITLE.search(text)
        if not t or not has_units:
            ocr = ocr_words(str(png) + '.png', k)              # titles / labels drawn as outlines
            if not t:
                t = TITLE.search(' '.join(w[0] for w in words + ocr))
            if not has_units:                                 # real text labels exist: OCR only reads the title
                words = words + ocr
        # unreadable title: still use the page, ranked below any titled page for the same stack
        lo, span = storeys(t.group(2)) if t else (999, 0)
        labels = []
        nums = [w for w in words if re.fullmatch(r'\d{2,4}', w[0])]
        for a in (w for w in words if w[0].upper() == 'UNIT'):     # rotated wings interleave words: pair by position
            near = [b for b in nums if (abs(a[2] - b[2]) < 8 and 0 <= b[1] - a[3] < 12) or        # beside
                    (0 < b[2] - a[4] < 10 and abs((a[1] + a[3]) / 2 - (b[1] + b[3]) / 2) < 15)]    # below
            if near:
                b = min(near, key=lambda b: abs(b[1] - a[3]) + abs(b[2] - a[2]))
                labels.append((b[0], (a[1], min(a[2], b[2]), b[3], max(a[4], b[4]))))
        mpp = metres_per_pt(words) or 0.125                   # typical HDB brochure block-plan scale
        labels = [l for l in labels if l[0] in stack_set]
        # a plan page belongs to one block: drop labels of other blocks' stacks (OCR misreads, e.g. 501 -> 601)
        page_blk = t.group(1).upper() if t else None
        if page_blk not in blocks_of:
            seen = {block_of[no] for no, _ in labels}
            page_blk = seen.pop() if len(seen) == 1 else None  # untitled page: only if its labels agree
        labels = [l for l in labels if page_blk and block_of[l[0]] == page_blk]
        if not labels:
            continue
        for no, bb in labels:
            code = next((s['type'] for s in P['stacks'] if str(s['no']) == no), '4RM')
            sqm = (P.get('prices', {}).get(code) or {}).get('sqm') or {'2RF1': 40, '2RF2': 48, '3RM': 68, '4RM': 92, '5RM': 113, '3GEN': 120}.get(code, 90)
            c = crop_unit(img, k, bb, sqm, mpp, [o for n2, o in labels if n2 != no])
            if c is not None and c.size:
                found.setdefault(no, []).append((span, lo, pno, c, page_blk))
    out_dir = D / 'layouts'
    out_dir.mkdir(exist_ok=True)
    layouts = {}
    stack_nos = {str(s['no']) for s in P['stacks']}
    for no, opts in found.items():
        if no not in stack_nos:
            continue
        opts.sort(key=lambda o: (-o[0], o[1]))
        span, lo, pno, crop, pblk = opts[0]
        cv2.imwrite(str(out_dir / f'{no}.png'), crop)
        layouts[no] = {'typical': f'layouts/{no}.png', 'page': pno, 'pageBlock': pblk}
        low = [o for o in opts[1:] if o[1] < lo]
        if low:
            cv2.imwrite(str(out_dir / f'{no}-low.png'), low[0][3])
            layouts[no].update(lowest=f'layouts/{no}-low.png', lowestPage=low[0][2], lowestBlock=low[0][4])
    P['layouts'] = layouts
    (D / 'project.json').write_text(json.dumps(P, separators=(',', ':')))
    return layouts


if __name__ == '__main__':
    for slug in sys.argv[1:]:
        P = json.loads((ROOT / 'projects' / slug / 'project.json').read_text())
        L = extract(slug)
        miss = sorted({str(s['no']) for s in P['stacks']} - set(L), key=int)
        print(f"{slug}: {len(L)}/{len(P['stacks'])} stacks" + (f"  missing {miss}" if miss else ''))
