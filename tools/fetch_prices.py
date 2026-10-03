"""HDB launch prices per flat type from the press-release Annex A PDFs -> project.json "prices" / "resaleComparables".

usage: python3 tools/fetch_prices.py <annex.pdf>...

Table A(1)(a) "Flat Supply and Pricing Details": per row flat type, floor area, internal area, units, price range;
project name and waiting months sit in the left columns of each project's block of rows.
Tables "Prices of <project> and Resale Comparables Nearby": BTO range and nearby resale range per flat type.
"""
import json, re, subprocess, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RANK = {'CCA': 0, '2RF': 1, '3RM': 2, '4RM': 3, '5RM': 4, '3GEN': 5}
TYPE_RE = re.compile(r'\b(CCA|3Gen|[2-5]-room)\b')
PRICE_RE = re.compile(r'\$([\d,]+)\s*-\s*\$([\d,]+)')
GRANT = {  # illustrative Enhanced CPF Housing Grant used in HDB's launch press releases
    '2RF': 120000, '3RM': {'Standard': 105000, 'Plus': 90000, 'Prime': 90000},
    '4RM': {'Standard': 80000, 'Plus': 55000, 'Prime': 55000}, '5RM': {'Standard': 55000}, '3GEN': {'Standard': 55000}}


def norm(s):
    return re.sub(r'[^a-z0-9]', '', s.lower())


def code_of(tok):
    t = tok.lower()
    return 'CCA' if t == 'cca' else '3GEN' if t == '3gen' else {'2': '2RF', '3': '3RM', '4': '4RM', '5': '5RM'}[t[0]]


def money(s):
    return int(s.replace(',', ''))


def known_names():
    return [p['name'] for p in json.loads((ROOT / 'reference/hdb/launched.json').read_text())]


def parse_annex(pdf):
    text = subprocess.run(['pdftotext', '-layout', pdf, '-'], capture_output=True, text=True).stdout
    supply, rest = text, ''
    m = re.search(r'COMPARISON OF NEW FLATS', text)
    if m:
        supply, rest = text[:m.start()], text[m.start():]
    supply = supply.split('Note:')[0] if 'Table A(1)(a)' in supply else supply
    lines = supply.split('\n')

    # data rows: lines with a price range and the three numbers before it
    rows = []
    for i, ln in enumerate(lines):
        pm = PRICE_RE.search(ln)
        if not pm:
            continue
        nums = re.findall(r'(?<![\d,$])(\d{2,4})(?![\d,])', ln[:pm.start()])
        if len(nums) < 3:
            continue
        sqm, internal, units = map(int, nums[-3:])
        typ = None
        for j in (i, i - 1, i + 1, i - 2):            # label on the row, or wrapped above/below it
            if 0 <= j < len(lines):
                t = TYPE_RE.findall(lines[j])
                if t:
                    typ = code_of(t[0]); break
        typecol = min((mm.start() for j in range(max(0, i - 2), min(len(lines), i + 2))
                       for mm in TYPE_RE.finditer(lines[j])), default=pm.start())
        rows.append({'i': i, 'type': typ, 'sqm': sqm, 'internalSqm': internal, 'units': units,
                     'min': money(pm.group(1)), 'max': money(pm.group(2)), 'col': typecol})

    # split into project blocks: flat-type order resets at each new project (two 2-room Flexi rows are allowed)
    blocks, cur = [], []
    for r in rows:
        if cur and r['type'] and cur[-1]['type'] and RANK[r['type']] <= RANK[cur[-1]['type']] and \
                not (r['type'] == '2RF' and cur[-1]['type'] == '2RF' and sum(x['type'] == '2RF' for x in cur) < 2):
            blocks.append(cur); cur = []
        cur.append(r)
    if cur:
        blocks.append(cur)

    # project names, in document order, from the left-hand column text
    left = []
    for i, ln in enumerate(lines):
        cut = min((m.start() for m in TYPE_RE.finditer(ln)), default=None)
        nm = re.search(r'\d', ln)
        seg = ln[:cut] if cut is not None else ln[:30]
        left.append((i, seg))
    letters = lambda s: re.sub(r'[^a-z]', '', s.lower())          # waiting-time digits sit inside wrapped names
    stream = ''.join(letters(s) for _, s in left)
    found = sorted((stream.find(letters(n)), n) for n in known_names() if stream.find(letters(n)) >= 0)
    names = [n for _, n in found]
    # waiting months: first 2-digit number in the left column within the block's line span
    out = {}
    if len(names) != len(blocks):
        raise ValueError(f'{pdf}: {len(names)} project names but {len(blocks)} price blocks — refusing to pair by order')
    for name, blk in zip(names, blocks):
        wait = None
        # the block's own row span first (a wider window reaches the previous project's waiting time)
        for lo, hi in ((blk[0]['i'], blk[-1]['i'] + 1), (blk[0]['i'] - 2, blk[-1]['i'] + 3)):
            for i, seg in left[max(0, lo):hi]:
                m = re.search(r'(?<![\d$,.])(\d{2})(?![\d,])', re.sub(r'\(.*?\)', '', seg))
                if m:
                    wait = int(m.group(1)); break
            if wait is not None:
                break
        prices = {}
        rf = sorted((r for r in blk if r['type'] == '2RF'), key=lambda r: r['sqm'])
        for r in blk:
            code = r['type']
            if code == '2RF':
                code = '2RF1' if (len(rf) > 1 and r is rf[0]) else ('2RF2' if len(rf) > 1 else '2RF2')
            prices[code] = {k: r[k] for k in ('min', 'max', 'sqm', 'internalSqm', 'units')}
            prices[code]['waitingMonths'] = wait
        out[name] = {'prices': prices, 'resaleComparables': {}}

    # resale comparables tables
    for m in re.finditer(r'Prices of (.+?) and Resale\s+Comparables\s+Nearby(.*?)(?=Table A|\Z)', rest, re.S):
        title = re.sub(r'\(Excluding Grants\)', '', ' '.join(m.group(1).split())).strip()
        target = next((n for n in out if norm(n) == norm(title)), None)
        if not target:
            continue
        tl = m.group(2).split('Note:')[0].split('\n')
        for i, ln in enumerate(tl):
            ps = PRICE_RE.findall(ln)
            if len(ps) < 2:
                continue
            typ = None
            for j in (i, i + 1, i - 1, i + 2):
                if 0 <= j < len(tl):
                    t = TYPE_RE.findall(tl[j])
                    if t:
                        typ = code_of(t[0]); break
            if not typ:
                continue
            rng = {'min': money(ps[1][0]), 'max': money(ps[1][1])}
            if typ == '2RF':
                for c in ('2RF1', '2RF2'):
                    if c in out[target]['prices']:
                        out[target]['resaleComparables'][c] = rng
            else:
                out[target]['resaleComparables'][typ] = rng
    return out


def after_grants(code, minp, cls):
    g = GRANT.get(code[:3] if code.startswith('2RF') else code)
    if isinstance(g, dict):
        g = g.get(cls)
    return minp - g if g else None


if __name__ == '__main__':
    by_name = {}
    for f in (ROOT / 'projects').glob('*/project.json'):
        P = json.loads(f.read_text())
        if P.get('status') == 'launched':
            by_name[(norm(P['name']), P['launch'])] = f
    for pdf in sys.argv[1:]:
        txt = subprocess.run(['pdftotext', '-l', '1', pdf, '-'], capture_output=True, text=True).stdout
        launch = re.search(r'Table A\(1\)\(a\):\s*(\w{3} \d{4})', txt).group(1)   # e.g. "Oct 2025"
        for name, d in parse_annex(pdf).items():
            f = by_name.get((norm(name), launch))     # same name can recur across launches (Redhill Peaks)
            if not f:
                print(f'  unmatched: {name} ({launch})'); continue
            P = json.loads(f.read_text())
            for code, p in d['prices'].items():
                ag = after_grants(code, p['min'], P.get('classification', 'Standard'))
                if ag:
                    p['afterGrantsFrom'] = ag
            P['prices'], P['resaleComparables'] = d['prices'], d['resaleComparables']
            f.write_text(json.dumps(P, separators=(',', ':')))
            summary = ', '.join(f"{c} ${p['min'] // 1000}-{p['max'] // 1000}k" for c, p in d['prices'].items())
            wait = next(iter(d['prices'].values()))['waitingMonths']
            print(f"{name}: {summary} | resale {len(d['resaleComparables'])} | wait {wait}m")
