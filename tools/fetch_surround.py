"""Simple 3D surroundings for the map: malls and MRT/LRT station buildings (OpenStreetMap) and HDB blocks out to 1.5 km.

usage: python3 tools/fetch_surround.py projects/<id>...   -> project.json["surround"] = [{k, h, p, n?}], ["blockers"] = [{k, h, p}]

Kinds: hdb|mall|mrt, bto (other projects' stacks, so unbuilt BTOs show and shade), bldg (every other OSM building), plus OSM features school|campus|cc|library|hawker|health|park (cached at
reference/amenities/osm-features.raw). Feature buildings within 900 m (the context radius) also go to `blockers` for the
sun calculation; campus/park are flat ground areas.

Footprints are measured from the project's site point, the same reference the registered `context` uses, so they line
up with the existing neighbours. HDB blocks already in `context` are skipped. Heights: HDB storeys from HDB property
data (road via the cached OneMap lookups only; 12 storeys when unknown); OSM height / building:levels, else defaults.
Malls/stations come from one island-wide Overpass query cached at reference/amenities/osm-buildings.raw.
"""
import csv, json, math, re, subprocess, sys, time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / 'tools'))
from fetch_context import local_xz, norm, CACHE, REF, STOREY_M, ROOF_M   # noqa: E402

RADIUS, LEVEL_M, BLOCK_R = 1500, 4.0, 900
DEFAULT_H = {'mall': 16.0, 'mrt': 12.0, 'school': 12.0, 'cc': 10.0, 'library': 12.0, 'hawker': 8.0, 'health': 20.0, 'bldg': 10.0}
# shortcut: untagged heights are guesses by building type (about 2/3 of OSM buildings); fine for massing, refine per area if shade looks off
BLDG_H = {'apartments': 36.0, 'residential': 20.0, 'house': 9.0, 'detached': 9.0, 'semidetached_house': 9.0, 'terrace': 9.0,
          'bungalow': 7.0, 'industrial': 14.0, 'warehouse': 12.0, 'commercial': 14.0, 'office': 30.0, 'hotel': 40.0,
          'retail': 10.0, 'parking': 12.0, 'shed': 4.0, 'hut': 4.0, 'garage': 4.0, 'kiosk': 4.0}
HOMES = {'apartments', 'residential', 'house', 'detached', 'semidetached_house', 'terrace', 'bungalow', 'dormitory'}
SKIP_BLDG = {'roof', 'construction', 'no', 'ruins', 'canopy', 'carport', 'bridge'}
GROUND = ('campus', 'park')                                       # flat areas, 0.2 m, never blockers
CAMPUS_BLDG = {'yes', 'school', 'education', 'kindergarten', 'sports_hall', 'dormitory', 'service'}
OSM = ROOT / 'reference/amenities/osm-buildings.raw'
FEATURES = ROOT / 'reference/amenities/osm-features.raw'
_feats = _floors = _osmf = _projects = None
cen = lambda p: (sum(q[0] for q in p) / len(p), sum(q[1] for q in p) / len(p))


def rdp(seg, tol=0.5):
    """Ramer-Douglas-Peucker on an open polyline (metres), keeping both ends."""
    (ax, az), (bx, bz) = seg[0], seg[-1]
    L = math.hypot(bx - ax, bz - az) or 1e-9
    d = [abs((bx - ax) * (az - z) - (ax - x) * (bz - az)) / L for x, z in seg[1:-1]]
    if not d or max(d) <= tol:
        return [seg[0], seg[-1]]
    i = d.index(max(d)) + 1
    return rdp(seg[:i + 1], tol)[:-1] + rdp(seg[i:], tol)


def simplify(pts, tol=0.5):
    """Ramer-Douglas-Peucker on a closed ring (metres): drop points within tol of the line through their neighbours."""
    far = max(range(len(pts)), key=lambda i: math.dist(pts[0], pts[i]))       # split the ring at its farthest point
    out = rdp(pts[:far + 1] + [], tol)[:-1] + rdp(pts[far:] + [pts[0]], tol)[:-1]
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


def overpass(path, q):
    """Run one Overpass query once and cache the raw JSON at path; returns its elements."""
    if not path.exists():
        for t in range(6):                                         # public Overpass servers are often busy: retry, alternate
            time.sleep(20 * t)
            url = ('https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter')[t % 2]
            r = subprocess.run(['curl', '-sf', '--max-time', '180', '-A', 'BTOlab/1.0 (personal project)', url,
                                '--data-urlencode', f'data={q}'], capture_output=True, text=True)
            if r.returncode == 0 and r.stdout.lstrip().startswith('{'):
                path.write_text(r.stdout); break
        else:
            raise SystemExit('Overpass unavailable; try again later')
    return json.loads(path.read_text())['elements']


def osm_buildings():
    return overpass(OSM, '[out:json][timeout:170];(way["shop"="mall"](1.2,103.6,1.47,104.05);relation["shop"="mall"](1.2,103.6,1.47,104.05);'
                    'way["building"="train_station"](1.2,103.6,1.47,104.05);'
                    'way["railway"="station"]["building"](1.2,103.6,1.47,104.05););out geom tags;')


def osm_features():
    global _osmf
    if _osmf is None:
        b = '(1.2,103.6,1.47,104.05)'
        _osmf = overpass(FEATURES, f'[out:json][timeout:170];(way["amenity"="school"]{b};relation["amenity"="school"]{b};)->.s;'
                         '.s map_to_area->.a;(.s;way["building"](area.a);'      # buildings inside school grounds
                         + ''.join(f'way[{t}]{b};relation[{t}]{b};' for t in (
                             '"building"="school"', '"amenity"="community_centre"', '"amenity"="library"',
                             '"amenity"~"^(marketplace|food_court)$"', '"amenity"~"^(hospital|clinic)$"', '"leisure"="park"'))
                         + ');out geom tags;')
    return _osmf


def classify(t):
    a = t.get('amenity')
    if a == 'school':
        return 'school' if t.get('building') else None if t.get('leisure') or t.get('sport') else 'campus'
    return ({'community_centre': 'cc', 'library': 'library', 'marketplace': 'hawker', 'food_court': 'hawker',
             'hospital': 'health', 'clinic': 'health'}.get(a)
            or ('school' if t.get('building') == 'school' else 'park' if t.get('leisure') == 'park' else None))


def solid(t, kind):
    """Only real buildings are extruded and block sun; amenity grounds without a building tag stay flat."""
    return kind not in GROUND and bool(t.get('building'))


def campus_building(t):
    return t.get('building') in CAMPUS_BLDG and not (t.get('amenity') or t.get('religion') or t.get('leisure'))


def feature_height(t, kind):
    return height(t, kind) if solid(t, kind) else 0.2


def outline(e):
    """A way's ring, or a multipolygon's largest outer ring (inner rings and members without geometry ignored)."""
    # shortcut: a ring split over several member ways comes back partial (under-shades, the safe direction); stitch
    # the member ways if gaps show on the map
    if e['type'] == 'relation':
        return max((m.get('geometry') or [] for m in e.get('members', []) if m.get('role') == 'outer'), key=len, default=[])
    return e.get('geometry') or []


def stack_xz(P):
    """World (x, z) of each of P's stacks, in P.stacks order (plan -> world as p2w in tools/anchor_fit.py)."""
    if not P.get('stacks'):
        return []
    pl = P['plan']; PX = pl['pxPerM']; ox, oy = pl['origin']; b = math.radians(pl['upBearing'])
    out = []
    for s in P['stacks']:
        lx, lz = (s['px'] - ox) / PX, (s['py'] - oy) / PX
        out.append((lx * math.cos(b) - lz * math.sin(b), lx * math.sin(b) + lz * math.cos(b)))
    return out


def projects():
    global _projects
    _projects = _projects or [json.loads(f.read_text()) for f in sorted((ROOT / 'projects').glob('*/project.json'))]
    return _projects


def to_p(P, Q, x, z):
    """Q-local metres -> lat/lon -> P-local (inverse of local_xz)."""
    la, lo = Q['site']['lat'], Q['site']['lon']
    return local_xz(P['site']['lat'], P['site']['lon'], lo + x / (111_320.0 * math.cos(math.radians(la))), la - z / 110_574.0)


def all_stacks(P, others=None):
    """P's stacks plus every other project's (others: project dicts, default every projects/*/project.json), in P's
    site-local metres, within reach of P's features: OSM can still map what stood on any BTO site."""
    out = stack_xz(P)
    for Q in projects() if others is None else others:
        for x, z in stack_xz(Q):
            q = to_p(P, Q, x, z)
            if math.hypot(*q) <= RADIUS + 500:
                out.append(q)
    return out


def block_xz(P, others=None):
    """[(block number, P-local (x, z))] for every stack of P and of every other project."""
    out = []
    for Q in [P] + [Q for Q in (projects() if others is None else others) if Q.get('id') != P.get('id')]:
        for s, (x, z) in zip(Q.get('stacks', []), stack_xz(Q)):
            out.append((str(s['block']).upper(), (x, z) if Q is P else to_p(P, Q, x, z)))
    return out


def bto_neighbours(P, others=None):
    """Other projects' stacks within RADIUS as 'bto' boxes in P-local metres (as buildLayout in web/project.js): new BTO
    blocks are missing from the HDB footprint data until they are built."""
    out = []
    for Q in projects() if others is None else others:
        if Q.get('id') == P.get('id') or not Q.get('stacks') or 'plan' not in Q:
            continue
        for s, (x, z) in zip(Q['stacks'], stack_xz(Q)):
            B = Q['blocks'].get(str(s['block']), {})                 # str: JS-style key lookup (Thomson Reserve uses ints)
            axis = s.get('axis', B.get('axis'))
            hx, hz = s.get('size') or Q['stackSize']['corner' if len(s['faces']) > 1 else 'normal']
            a, b = math.radians(axis), math.radians(axis + 90)
            ax, az, fx, fz = math.sin(a), -math.cos(a), math.sin(b), -math.cos(b)
            pts = [to_p(P, Q, x + i * hx * ax + j * hz * fx, z + i * hx * az + j * hz * fz) for i, j in ((-1, -1), (1, -1), (1, 1), (-1, 1))]
            if math.hypot(*cen(pts)) <= RADIUS:
                out.append({'k': 'bto', 'h': round((s.get('floors') or B['floors']) * Q['site']['floorHeight'] + 1.5, 1),
                            'p': [[round(x, 1), round(z, 1)] for x, z in pts]})
    return out


def near(pt, poly, d):
    """pt inside poly or closer than d metres to its outline."""
    def seg(a, b):
        dx, dz = b[0] - a[0], b[1] - a[1]
        u = max(0.0, min(1.0, ((pt[0] - a[0]) * dx + (pt[1] - a[1]) * dz) / ((dx * dx + dz * dz) or 1e-9)))
        return math.hypot(pt[0] - a[0] - u * dx, pt[1] - a[1] - u * dz)
    return inside(*pt, poly) or any(seg(a, b) < d for a, b in zip(poly, poly[1:] + poly[:1]))


def overlap(p, others, step=5.0):
    """Share of p's area inside any of others: grid points every step metres inside p (centre if p is tiny)."""
    xs, zs = [q[0] for q in p], [q[1] for q in p]
    bb = lambda o: (min(q[0] for q in o), min(q[1] for q in o), max(q[0] for q in o), max(q[1] for q in o))
    near = [(b, o) for o in others for b in [bb(o)] if b[0] < max(xs) and b[2] > min(xs) and b[1] < max(zs) and b[3] > min(zs)]
    if not near:
        return 0.0
    g = [(min(xs) + step * (i + .5), min(zs) + step * (j + .5)) for i in range(int((max(xs) - min(xs)) / step) + 1)
         for j in range(int((max(zs) - min(zs)) / step) + 1)]
    g = [q for q in g if inside(*q, p)] or [cen(p)]
    return sum(any(b[0] <= x <= b[2] and b[1] <= z <= b[3] and inside(x, z, o) for b, o in near) for x, z in g) / len(g)


def features(P, elements=None, existing=None, others=None):
    """(surround entries, blockers) for the OSM feature kinds around P's site. existing: outlines already drawn
    (default: P.surround hdb/mall/mrt); P.context blocks always count too. others: projects whose stacks also drop
    stale features (default: every project, see all_stacks)."""
    lat0, lon0 = P['site']['lat'], P['site']['lon']
    if existing is None:
        existing = [s['p'] for s in P.get('surround', []) if s['k'] in ('hdb', 'mall', 'mrt')]
    existing = existing + [c['p'] for c in P.get('context', [])]
    items = []
    for e in osm_features() if elements is None else elements:
        geom = [g for g in outline(e) if g]
        if len(geom) >= 4:
            items.append((e.get('tags', {}), [local_xz(lat0, lon0, g['lon'], g['lat']) for g in geom][:-1]))
    campuses = [p for t, p in items if classify(t) == 'campus']
    stacks = all_stacks(P, others)
    dead = [q for q in campuses if any(inside(*st, q) for st in stacks)]
    out, blockers = [], []
    for t, pts in items:
        c = cen(pts)
        if math.hypot(*c) > RADIUS + 100:                           # far: skip early (final rule below, after simplify)
            continue
        kind = classify(t) or ('school' if campus_building(t) and any(inside(*c, q) for q in campuses) else None)
        if not kind:
            continue
        p = simplify([[round(x, 1), round(z, 1)] for x, z in pts])
        if len(p) < 3 or math.hypot(*cen(p)) > RADIUS or overlap(p, existing) > 0.5:
            continue
        if any(near(st, p, 5.0 if solid(t, kind) else 0.0) for st in stacks) or \
                (kind == 'school' and any(inside(*cen(p), q) for q in dead)):
            continue
        out.append({'k': kind, 'h': round(feature_height(t, kind), 1), 'p': p, **({'n': t['name']} if t.get('name') else {})})
        if solid(t, kind) and math.hypot(*cen(p)) <= BLOCK_R:
            blockers.append({k: out[-1][k] for k in 'khp'})
    return out, blockers


def osm_all(P):
    """Every OSM building within RADIUS + 100 m of P's site, cached per project (reference/amenities/osm-all-<id>.raw)."""
    lat, lon = P['site']['lat'], P['site']['lon']
    return overpass(ROOT / f"reference/amenities/osm-all-{P['id']}.raw",
                    f'[out:json][timeout:170];(way["building"](around:{RADIUS + 100},{lat},{lon});'
                    f'relation["building"](around:{RADIUS + 100},{lat},{lon}););out geom tags;')


def others(P, existing, elements=None):
    """(surround entries, blockers) of kind 'bldg': every other OSM building (condos, landed, industrial, shops...) not
    already drawn (>50% over an existing outline), nor on or within 5 m of a project's stack (stale OSM on a BTO site)."""
    lat0, lon0 = P['site']['lat'], P['site']['lon']
    stacks = all_stacks(P)
    named = block_xz(P)
    out, blockers = [], []
    for e in osm_all(P) if elements is None else elements:
        t = e.get('tags', {})
        geom = [g for g in outline(e) if g]
        if t.get('building') in SKIP_BLDG or len(geom) < 4:
            continue
        p = simplify([[round(x, 1), round(z, 1)] for x, z in (local_xz(lat0, lon0, g['lon'], g['lat']) for g in geom[:-1])])
        if len(p) < 3 or math.hypot(*cen(p)) > RADIUS or overlap(p, existing) > 0.5 or any(near(st, p, 5.0) for st in stacks):
            continue
        # OSM often maps a project's own blocks a few metres off our traced stacks: same block number nearby -> a duplicate
        hn = str(t.get('addr:housenumber', '')).upper()
        if hn and any(b == hn and math.dist(q, cen(p)) < 150 for b, q in named):
            continue
        out.append({'k': 'bldg', 'h': round(height(t, 'bldg'), 1), 'p': p})
        if math.hypot(*cen(p)) <= BLOCK_R:
            blockers.append(out[-1])
    return out, blockers


def height(t, kind):
    homes = kind == 'bldg' and t.get('building') in HOMES                 # flats/houses: ~3 m storeys, not 4 m
    for key, scale in (('height', 1.0), ('building:levels', 3.0 if homes else LEVEL_M)):
        m = re.match(r'\s*(\d+(?:\.\d+)?)', str(t.get(key, '')))   # first number of '12 m', '3;4'
        if m and float(m[1]) > 0:                                  # '0' tags are common
            return float(m[1]) * scale
    return BLDG_H.get(t.get('building'), DEFAULT_H['bldg']) if kind == 'bldg' else DEFAULT_H[kind]


def surround(P):
    """(P.surround entries, P.blockers)."""
    lat0, lon0 = P['site']['lat'], P['site']['lon']
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
    out = [s for s in out if len(s['p']) >= 3 and math.hypot(*cen(s['p'])) <= RADIUS]   # after simplify: same centre the app sees
    fs, blockers = features(P, existing=[s['p'] for s in out])
    bto = bto_neighbours(P)
    ob, obb = others(P, [s['p'] for s in out + fs + bto if s['h'] > 0.2] + [c['p'] for c in P.get('context', [])])
    return out + fs + bto + ob, blockers + [b for b in bto if math.hypot(*cen(b['p'])) <= BLOCK_R] + obb


def assign_hosts(P):
    """Set amenity.host = {"s": i} (P.surround hdb/mall) or {"c": i} (P.context) for clinic/supermarket/preschool pins:
    the smallest outline containing the point, else the nearest outline edge within 15 m; else no host. Returns count."""
    area = lambda p: abs(sum(a[0] * b[1] - b[0] * a[1] for a, b in zip(p, p[1:] + p[:1]))) / 2
    def edge(x, z, p):
        d = math.inf
        for (x1, z1), (x2, z2) in zip(p, p[1:] + p[:1]):
            L = (x2 - x1) ** 2 + (z2 - z1) ** 2 or 1e-9
            t = max(0, min(1, ((x - x1) * (x2 - x1) + (z - z1) * (z2 - z1)) / L))
            d = min(d, math.hypot(x - x1 - t * (x2 - x1), z - z1 - t * (z2 - z1)))
        return d
    hosts = [({'s': i}, s['p']) for i, s in enumerate(P.get('surround', [])) if s['k'] in ('hdb', 'mall')]
    hosts += [({'c': i}, c['p']) for i, c in enumerate(P.get('context', []))]
    n = 0
    for a in P.get('amenities', []):
        a.pop('host', None)
        if a.get('cat') not in ('clinic', 'supermarket', 'preschool'):
            continue
        x, z = a['x'], a['z']
        within = [(area(p), h) for h, p in hosts if inside(x, z, p)]
        near = [(edge(x, z, p), h) for h, p in hosts]
        near = [m for m in near if m[0] <= 15]
        best = min(within, key=lambda m: m[0], default=None) or min(near, key=lambda m: m[0], default=None)
        if best:
            a['host'] = best[1]
            n += 1
    return n


if __name__ == '__main__':
    for d in sys.argv[1:]:
        f = Path(d) / 'project.json'
        P = json.loads(f.read_text())
        P['surround'], P['blockers'] = surround(P)
        assign_hosts(P)                                            # indices refer to the final P.surround order
        f.write_text(json.dumps(P, separators=(',', ':')))
        c = {k: sum(1 for s in P['surround'] if s['k'] == k)
             for k in ('hdb', 'bto', 'bldg', 'mall', 'mrt', 'school', 'campus', 'cc', 'library', 'hawker', 'health', 'park')}
        c['blockers'] = len(P['blockers'])
        print(f"{Path(d).name}: {c}, +{len(json.dumps(P['surround'], separators=(',', ':'))) // 1024} KB")
