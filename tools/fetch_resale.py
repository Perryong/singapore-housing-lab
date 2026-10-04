"""HDB resale transactions near each project -> project.json["resale"].

usage: python3 tools/fetch_resale.py [--refresh] projects/<id>...

Source: data.gov.sg "Resale flat prices based on registration date from Jan-2017 onwards"
(d_8b84c4ee58e3cfc0ece0d773c8ca6abc), cached at reference/resale/resale.csv.
Linking: every HDB building footprint within 900 m of the site (reference/hdb/hdb-buildings.geojson) gets its road
from OneMap (postal code, cached) -> key (block, norm(street)), which is how resale rows name their block.
Footprints whose road cannot be resolved are counted as unlinked, never guessed.
"""
import csv, json, math, re, statistics, subprocess, sys, time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / 'tools'))
from fetch_context import local_xz, norm, CACHE   # noqa: E402

DATASET = 'd_8b84c4ee58e3cfc0ece0d773c8ca6abc'
CSV = ROOT / 'reference/resale/resale.csv'
RADIUS, MONTHS, MIN_SALES, MAX_SALES = 900, 24, 3, 300   # 900 m = the drawn context area


def months_back(as_of, n):
    """First month of an n-month window ending at as_of (inclusive), 'YYYY-MM'."""
    y, m = map(int, as_of.split('-'))
    k = y * 12 + (m - 1) - (n - 1)
    return f'{k // 12:04d}-{k % 12 + 1:02d}'


def years_left(s):
    m = re.match(r'(\d+)', s or '')
    return int(m.group(1)) if m else None


def aggregate(rows, blocks, as_of):
    start = months_back(as_of, MONTHS)
    keep = []
    for r in rows:
        key = (r['block'].upper(), norm(r['street_name']))
        if r['month'] < start or r['month'] > as_of or key not in blocks:
            continue
        price, sqm = int(float(r['resale_price'])), float(r['floor_area_sqm'])
        keep.append({**r, 'key': key, 'price': price, 'sqm': sqm, 'psm': price / sqm})

    def stats(rs, with_lease=False):
        out = {'n': len(rs)}
        if len(rs) >= MIN_SALES:
            out['median'] = round(statistics.median(r['price'] for r in rs))
            out['psm'] = round(statistics.median(r['psm'] for r in rs))
            if with_lease:
                yl = [y for y in (years_left(r['remaining_lease']) for r in rs) if y is not None]
                if yl:
                    out['leaseLeft'] = round(statistics.median(yl))
        return out

    by_type = {}
    for r in keep:
        by_type.setdefault(r['flat_type'], []).append(r)
    summary = {t: stats(rs, True) for t, rs in sorted(by_type.items())}

    trend = {}
    for t, rs in by_type.items():
        per = {}
        for r in rs:
            per.setdefault(r['month'], []).append(r['psm'])
        pts = [[m, round(statistics.median(v))] for m, v in sorted(per.items()) if len(v) >= MIN_SALES]
        if pts:
            trend[t] = pts

    out_blocks = []
    for key, info in blocks.items():
        rs = [r for r in keep if r['key'] == key]
        if not rs:
            continue
        rs.sort(key=lambda r: r['month'])
        types = {}
        for t in sorted({r['flat_type'] for r in rs}):
            tr = [r for r in rs if r['flat_type'] == t]
            types[t] = {**stats(tr), 'last': tr[-1]['month'], 'lastPrice': tr[-1]['price']}
        lease = rs[-1].get('lease_commence_date')
        out_blocks.append({'blk': key[0], 'street': rs[-1]['street_name'], 'x': info['x'], 'z': info['z'],
                           **({'ctx': info['ctx']} if info.get('ctx') is not None else {}),
                           'storeys': info.get('storeys'), 'lease': int(lease) if lease else info.get('lease'),
                           'types': types})

    keep.sort(key=lambda r: r['month'], reverse=True)              # stable: same-month rows keep input order
    sales = [{'m': r['month'], 'blk': r['block'], 'street': r['street_name'], 'type': r['flat_type'],
              'storey': r['storey_range'], 'sqm': r['sqm'], 'model': r['flat_model'],
              'left': r['remaining_lease'], 'price': r['price']} for r in keep[:MAX_SALES]]
    return {'asOf': as_of, 'radiusM': RADIUS, 'months': MONTHS, 'blocks': out_blocks,
            'summary': summary, 'trend': trend, 'sales': sales}


_FEATS = None
_PROP = None


def nearby_blocks(P, radius=RADIUS):
    global _FEATS, _PROP
    if _FEATS is None:
        _FEATS = json.loads((ROOT / 'reference/hdb/hdb-buildings.geojson').read_text())['features']
        _PROP = {}
        for r in csv.DictReader(open(ROOT / 'reference/hdb/hdb-property.csv')):
            _PROP[(r['blk_no'].upper(), norm(r['street']))] = (int(r['max_floor_lvl']), int(r['year_completed']))
    lat0, lon0 = P['site']['lat'], P['site']['lon']
    ctx_c = [(sum(q[0] for q in c['p']) / len(c['p']), sum(q[1] for q in c['p']) / len(c['p'])) for c in P.get('context', [])]
    cache = json.loads(CACHE.read_text()) if CACHE.exists() else {}
    blocks, unlinked = {}, 0
    for f in _FEATS:
        g = f['geometry']
        ring = g['coordinates'][0] if g['type'] == 'Polygon' else max((q[0] for q in g['coordinates']), key=len)
        pts = [local_xz(lat0, lon0, lon, lat) for lon, lat in ring]
        cx, cz = sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts)
        if math.hypot(cx, cz) > radius:
            continue
        p = f['properties']
        # cache only: everything within the context radius was resolved by fetch_context (OneMap throttles hard)
        road = cache.get(p['POSTAL_COD']) if p.get('POSTAL_COD') else None
        ctx = next((i for i, (x, z) in enumerate(ctx_c) if math.hypot(x - cx, z - cz) < 3), None)
        if not road and ctx is not None and P['context'][ctx].get('street'):
            road = P['context'][ctx]['street']                # the project's own context already named it
        if not road:
            unlinked += 1
            continue
        key = (p['BLK_NO'].upper(), norm(road))
        storeys, year = _PROP.get(key, (None, None))
        blocks[key] = {'x': round(cx, 1), 'z': round(cz, 1), 'ctx': ctx, 'storeys': storeys, 'lease': year}
    return blocks, unlinked


def download(refresh=False):
    if CSV.exists() and not refresh:
        return
    CSV.parent.mkdir(parents=True, exist_ok=True)
    for t in range(6):
        time.sleep(6 * t)
        out = subprocess.run(['curl', '-s', f'https://api-open.data.gov.sg/v1/public/api/datasets/{DATASET}/poll-download'],
                             capture_output=True, text=True).stdout
        try:
            url = json.loads(out)['data']['url']
            break
        except Exception:
            continue
    else:
        raise SystemExit('data.gov.sg download link unavailable (rate limited?) — try again later')
    subprocess.run(['curl', '-sfL', '-o', str(CSV), url], check=True)


if __name__ == '__main__':
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    download('--refresh' in sys.argv)
    rows = list(csv.DictReader(open(CSV)))
    as_of = max(r['month'] for r in rows)
    for d in args:
        f = Path(d) / 'project.json'
        P = json.loads(f.read_text())
        blocks, unlinked = nearby_blocks(P)
        R = aggregate(rows, blocks, as_of)
        R.update(linked=len(blocks), unlinked=unlinked)
        P['resale'] = R
        f.write_text(json.dumps(P, separators=(',', ':')))
        tot = len(blocks) + unlinked
        print(f"{Path(d).name}: {len(R['blocks'])} blocks, {sum(b['n'] for b in R['summary'].values())} sales, "
              f"linked {len(blocks)}/{tot} footprints ({len(blocks) / max(tot, 1):.0%})")
