"""Simple 3D surroundings for the map: malls and MRT/LRT station buildings (OpenStreetMap) and HDB blocks out to 1.5 km.

usage: python3 tools/fetch_surround.py projects/<id>...   -> project.json["surround"] = [{k: hdb|mall|mrt, h, p, n?}]

Footprints are measured from the project's site point, the same reference the registered `context` uses, so they line
up with the existing neighbours. HDB blocks already in `context` are skipped. Heights: HDB storeys from HDB property
data (road via the cached OneMap lookups only; 12 storeys when unknown); OSM height / building:levels, else defaults.
Malls/stations come from one island-wide Overpass query cached at reference/amenities/osm-buildings.raw.
"""
import csv, json, math, subprocess, sys, time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / 'tools'))
from fetch_context import local_xz, norm, CACHE, REF, STOREY_M, ROOF_M   # noqa: E402

RADIUS, LEVEL_M, DEFAULT_H = 1500, 4.0, {'mall': 16.0, 'mrt': 12.0}
OSM = ROOT / 'reference/amenities/osm-buildings.raw'
_feats = _floors = None


def simplify(pts, tol=0.5):
    """Ramer-Douglas-Peucker on a closed ring (metres): drop points within tol of the line through their neighbours."""
    def rdp(seg):
        (ax, az), (bx, bz) = seg[0], seg[-1]
        L = math.hypot(bx - ax, bz - az) or 1e-9
        d = [abs((bx - ax) * (az - z) - (ax - x) * (bz - az)) / L for x, z in seg[1:-1]]
        if not d or max(d) <= tol:
            return [seg[0], seg[-1]]
        i = d.index(max(d)) + 1
        return rdp(seg[:i + 1])[:-1] + rdp(seg[i:])
    far = max(range(len(pts)), key=lambda i: math.dist(pts[0], pts[i]))       # split the ring at its farthest point
    out = rdp(pts[:far + 1] + [])[:-1] + rdp(pts[far:] + [pts[0]])[:-1]
    return out


def inside(x, z, poly):                                          # as tools/drop_overlaps.py (that one runs on import)
    c = False
    for (x1, z1), (x2, z2) in zip(poly, poly[1:] + poly[:1]):
        if (z1 > z) != (z2 > z) and x < (x2 - x1) * (z - z1) / (z2 - z1) + x1:
            c = not c
    return c


def _load():
    global _feats, _floors
    if _feats is None:
        _feats = json.load(open(REF / 'hdb-buildings.geojson'))['features']
        _floors = {(r['blk_no'].upper(), norm(r['street'])): int(r['max_floor_lvl'])
                   for r in csv.DictReader(open(REF / 'hdb-property.csv')) if r['residential'] == 'Y' or r['multistorey_carpark'] == 'Y'}


def raw_hdb(P, radius=RADIUS):
    """Every HDB footprint within radius of the site, in site-local metres, with a height."""
    _load()
    lat0, lon0 = P['site']['lat'], P['site']['lon']
    cache = json.loads(CACHE.read_text()) if CACHE.exists() else {}
    out = []
    for f in _feats:
        g = f['geometry']
        ring = g['coordinates'][0] if g['type'] == 'Polygon' else max((q[0] for q in g['coordinates']), key=len)
        pts = [local_xz(lat0, lon0, lon, lat) for lon, lat in ring]
        if math.hypot(sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts)) > radius:
            continue
        pr, road = f['properties'], cache.get(f['properties'].get('POSTAL_COD') or '')
        n = _floors.get((pr['BLK_NO'].upper(), norm(road))) if road else None   # shortcut: cache-only roads, 12 storeys otherwise
        out.append({'k': 'hdb', 'h': round((n or 12) * STOREY_M + ROOF_M, 1), 'p': [[round(x, 1), round(z, 1)] for x, z in pts[:-1]]})
    return out


def osm_buildings():
    if not OSM.exists():
        q = ('[out:json][timeout:170];(way["shop"="mall"](1.2,103.6,1.47,104.05);relation["shop"="mall"](1.2,103.6,1.47,104.05);'
             'way["building"="train_station"](1.2,103.6,1.47,104.05);'
             'way["railway"="station"]["building"](1.2,103.6,1.47,104.05););out geom tags;')
        for t in range(6):                                         # public Overpass servers are often busy: retry, alternate
            time.sleep(20 * t)
            url = ('https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter')[t % 2]
            r = subprocess.run(['curl', '-sf', '--max-time', '180', '-A', 'BTOlab/1.0 (personal project)', url,
                                '--data-urlencode', f'data={q}'], capture_output=True, text=True)
            if r.returncode == 0 and r.stdout.lstrip().startswith('{'):
                OSM.write_text(r.stdout); break
        else:
            raise SystemExit('Overpass unavailable; try again later')
    return json.loads(OSM.read_text())['elements']


def height(t, kind):
    try:
        h = float(str(t.get('height', '')).replace('m', '').strip())
        if h > 0:
            return h
    except ValueError:
        pass
    lv = t.get('building:levels') or ''
    return float(lv) * LEVEL_M if lv.replace('.', '').isdigit() and float(lv) > 0 else DEFAULT_H[kind]   # '0' tags are common


def surround(P):
    lat0, lon0 = P['site']['lat'], P['site']['lon']
    cen = lambda p: (sum(q[0] for q in p) / len(p), sum(q[1] for q in p) / len(p))
    ctx = P.get('context', [])
    # outer ring only: inside the context's extent, blocks were curated (demolished ones under the BTO were dropped)
    edge = max((math.hypot(*cen(c['p'])) for c in ctx), default=0)
    out = [s for s in raw_hdb(P) if math.hypot(*cen(s['p'])) > edge
           and not any(inside(*cen(s['p']), c['p']) for c in ctx)]
    for e in osm_buildings():
        t, geom = e.get('tags', {}), e.get('geometry') or []
        if e['type'] == 'relation':                                # multipolygon mall: its largest outer ring
            geom = max((m.get('geometry') or [] for m in e.get('members', []) if m.get('role') == 'outer'), key=len, default=[])
        if len(geom) < 4:
            continue
        kind = 'mall' if t.get('shop') == 'mall' else 'mrt'
        pts = [local_xz(lat0, lon0, g['lon'], g['lat']) for g in geom][:-1]
        if math.hypot(*cen(pts)) > RADIUS:
            continue
        out.append({'k': kind, 'h': round(height(t, kind), 1), 'p': [[round(x, 1), round(z, 1)] for x, z in pts],
                    **({'n': t['name']} if t.get('name') else {})})
    for s in out:
        s['p'] = simplify(s['p'])
    return [s for s in out if len(s['p']) >= 3 and math.hypot(*cen(s['p'])) <= RADIUS]   # after simplify: same centre the app sees


if __name__ == '__main__':
    for d in sys.argv[1:]:
        f = Path(d) / 'project.json'
        P = json.loads(f.read_text())
        P['surround'] = surround(P)
        f.write_text(json.dumps(P, separators=(',', ':')))
        c = {k: sum(1 for s in P['surround'] if s['k'] == k) for k in ('hdb', 'mall', 'mrt')}
        print(f"{Path(d).name}: {c}, +{len(json.dumps(P['surround'], separators=(',', ':'))) // 1024} KB")
