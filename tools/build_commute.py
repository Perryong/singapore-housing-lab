"""Commute tab: weekday-08:00 transit graph (LTA bus + MRT/LRT) and door-to-door time search.

usage: python3 tools/build_commute.py projects/<id> [...]   -> project.json["commute"], <id>/transit.json, web/rail.json
(needs reference/transit/ from tools/fetch_transit.py and reference/amenities/all.json)
"""
import heapq, itertools, json, math, re, sys, time
from collections import Counter, defaultdict
from pathlib import Path

import cv2
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))   # repo root, so `python3 tools/build_commute.py` finds tools.*
from tools.fetch_context import local_xz
from tools.fetch_transit import chain, headway, transit_dir
from tools.fetch_surround import rdp, simplify, stack_xz   # import side effect: puts tools/ on sys.path, no I/O

ROOT = Path(__file__).resolve().parent.parent
HUBS = [('Raffles Place', 'Raffles Place MRT Station'), ('one-north', 'One-North MRT Station'),
        ('Changi Airport', 'Changi Airport MRT Station'), ('Jurong East', 'Jurong East MRT Station'),
        ('Woodlands', 'Woodlands MRT Station')]
CELL = 100            # shortcut: reach raster cell, metres; finer means bigger rings

BUS_KMH = 18          # shortcut: flat bus speed, no traffic or dwell model; upgrade with timetable data
RAIL_KMH = 40         # shortcut: straight-line rail at a flat speed; upgrade with track geometry
RAIL_DWELL = 0.5      # shortcut: flat per-hop dwell, minutes
WALK_FACTOR = 1.3     # shortcut: crow-flies × 1.3 at 80 m/min, same as web/nearby.js walkMin
TRANSFER_M = 400      # shortcut: transfer walk radius, metres
ACCESS_M = 500        # shortcut: door-to-stop walk radius, metres
LINE_CHANGE = 2       # shortcut: same-station line change, minutes
LIMIT = 60            # shortcut: search cut-off, minutes
NOW = '0800'          # shortcut: one scenario, weekday 08:00
MRT_LINES = {'NS', 'EW', 'CG', 'NE', 'CC', 'CE', 'DT', 'TE'}   # headway 3; LRT 4 (wait = headway / 2)
EXTRA = [('EW4', 'CG1'), ('CG1', 'CG2'), ('CC4', 'CE1'), ('CE1', 'CE2'), ('CC4', 'CC34'), ('BP6', 'BP7'), ('BP13', 'BP6'),
         ('STC', 'SE1'), ('SE5', 'STC'), ('STC', 'SW1'), ('SW8', 'STC'), ('PTC', 'PE1'), ('PE7', 'PTC'),
         ('PTC', 'PW1'), ('PW7', 'PTC')]
# shortcut: operating lines only (all.json already lists CR stations); add JRL (~2027) and CRL (~2030) when they open
OPEN = re.compile(r'(NS|EW|CG|NE|CC|CE|DT|TE|BP|SE|SW|PE|PW)\d')
O = (1.35, 103.82)    # fixed origin for island-wide planar metres


def dist_m(a, b):
    x, z = local_xz(a[0], a[1], b[1], b[0])
    return math.hypot(x, z)


def walk_min(d):
    # 1-min floor as in walkMin; also stops exit -> stop -> exit undercutting the 2-min line change
    return max(1, d * WALK_FACTOR / 80)


def running(first, last):
    """Service runs at NOW at this stop; '-' = none, last < first = runs past midnight."""
    if first == '-' or last == '-' or not first:
        return False
    return first <= NOW and (last >= NOW or last < first)


KEEP = {c for l in EXTRA for c in l}


def rail_codes(row):
    return [c for c in row['lines'].split() if OPEN.match(c) or c in KEEP]   # bare 'CG' is an alias


def code_key(c):
    m = re.match(r'([A-Z]+)(\d*)(.*)', c)
    return m[1], int(m[2] or 0), m[3]


def rail_order(stations):
    """prefix -> numbered codes in line order (NS1, NS2, ...; TE22 before TE22A). Codes without a number (STC, PTC)
    are left out: they join their lines only through EXTRA."""
    lines = defaultdict(set)
    for row in stations:
        for c in rail_codes(row):
            if re.search(r'\d', c):
                lines[code_key(c)[0]].add(c)
    return {p: sorted(cs, key=code_key) for p, cs in lines.items()}


def is_stop(m):
    return m['type'] == 'node' and m['role'].startswith(('platform', 'stop'))


def match_relation(rels, no, first, last):
    """The OSM relation for LTA service `no` whose first and last stops are each <= 300 m from LTA's first/last stop
    (so the other direction or a short-working variant never matches); smallest summed distance wins."""
    best, bd = None, math.inf
    for r in rels:
        ss = [(m['lat'], m['lon']) for m in r['members'] if is_stop(m)]
        if r.get('tags', {}).get('ref') != no or not ss:
            continue
        d0, d1 = dist_m(ss[0], first), dist_m(ss[-1], last)
        if d0 <= 300 and d1 <= 300 and d0 + d1 < bd:
            best, bd = r, d0 + d1
    return best


def route_path(rel, stop_lls):
    """(path, road): the relation's chained road geometry, else (no relation, or a stop > 300 m off it) the straight
    stop-to-stop line."""
    ways = [[(g['lat'], g['lon']) for g in m['geometry']] for m in (rel or {}).get('members', ())
            if m['type'] == 'way' and m['role'] in ('', 'forward', 'backward') and m.get('geometry')]
    path = chain(ways)
    if not path:
        return list(stop_lls), False
    a, b = stop_lls[0], stop_lls[-1]
    if dist_m(a, b) >= 300:   # not a loop: cut the tail past the end stops, keeping the stretch between them
        # a route can pass an end stop twice (71A, 20A, 980): start at the first pass of a, end at the last pass of b
        da, db = [dist_m(p, a) for p in path], [dist_m(p, b) for p in path]
        i = next(k for k, d in enumerate(da) if d <= min(da) + 50)
        j = max(k for k, d in enumerate(db) if d <= min(db) + 50)
        if i < j:
            path = path[i:j + 1]
    if any(off_path_m(path, s) > 300 for s in stop_lls):   # relation out of date mid-route: don't draw a wrong road
        return list(stop_lls), False
    return path, True


def off_path_m(path, p):
    """Metres from p to the nearest segment of path (lat, lon points), in p's local plane."""
    q = [local_xz(p[0], p[1], lon, lat) for lat, lon in path]
    def seg(a, b):
        dx, dz = b[0] - a[0], b[1] - a[1]
        t = max(0.0, min(1.0, -(a[0] * dx + a[1] * dz) / (dx * dx + dz * dz))) if dx or dz else 0.0
        return math.hypot(a[0] + t * dx, a[1] + t * dz)
    return min(seg(a, b) for a, b in zip(q, q[1:])) if len(q) > 1 else math.hypot(*q[0])


def build_graph(stops, routes, services, stations):
    pos, adj = {}, defaultdict(list)
    for s in stops:
        pos['b:' + s['BusStopCode']] = (s['Latitude'], s['Longitude'])

    hw = {(s['ServiceNo'], s['Direction']): headway(s['AM_Peak_Freq']) for s in services}
    seq = defaultdict(list)
    for r in routes:
        seq[r['ServiceNo'], r['Direction']].append(r)
    for (no, d), rs in seq.items():
        h = hw.get((no, d))
        if h is None:
            continue
        rs.sort(key=lambda r: r['StopSequence'])
        for a, b in zip(rs, rs[1:]):
            km = b['Distance'] - a['Distance']
            # shortcut: a Δ<=0 hop (loop restart) drops the edge, so riders re-board there (3 hops in real data)
            if km > 0 and running(a['WD_FirstBus'], a['WD_LastBus']):
                adj['b:' + a['BusStopCode']].append(('b:' + b['BusStopCode'], km / BUS_KMH * 60, f'bus:{no}/{d}', h))

    # Rail: a code's exits are every row naming it; codes sharing a row share a station.
    exits, same = defaultdict(list), set()
    for row in stations:
        codes = rail_codes(row)
        for c in codes:
            exits[c].append((row['lat'], row['lon']))
        same.update((a, b) for a in codes for b in codes if a != b)
    for c, ps in exits.items():
        pos['r:' + c] = (sum(p[0] for p in ps) / len(ps), sum(p[1] for p in ps) / len(ps))
    for a, b in same:
        adj['r:' + a].append(('r:' + b, LINE_CHANGE, None, None))

    links = [(p, cs[i], cs[i + 1]) for p, cs in rail_order(stations).items() for i in range(len(cs) - 1)]
    links += [(code_key(b)[0] if re.search(r'\d', b) else code_key(a)[0], a, b) for a, b in EXTRA if a in exits and b in exits]
    for p, a, b in links:
        m = dist_m(pos['r:' + a], pos['r:' + b]) / 1000 / RAIL_KMH * 60 + RAIL_DWELL
        h = 3 if p in MRT_LINES else 4
        adj['r:' + a].append(('r:' + b, m, 'rail:' + p, h))
        adj['r:' + b].append(('r:' + a, m, 'rail:' + p, h))

    # Transfer walks between bus stops and station exits <= TRANSFER_M apart, bucketed on a TRANSFER_M grid.
    pts = [(n, p) for n, p in pos.items() if n[0] == 'b'] + [('r:' + c, p) for c, ps in exits.items() for p in ps]
    xy = [local_xz(O[0], O[1], p[1], p[0]) for _, p in pts]
    grid = defaultdict(list)
    for i, (x, z) in enumerate(xy):
        grid[int(x // TRANSFER_M), int(z // TRANSFER_M)].append(i)
    best = {}
    for i, (x, z) in enumerate(xy):
        gx, gz = int(x // TRANSFER_M), int(z // TRANSFER_M)
        for j in (j for dx in (-1, 0, 1) for dz in (-1, 0, 1) for j in grid.get((gx + dx, gz + dz), ())):
            a, b = pts[i][0], pts[j][0]
            if a == b:
                continue
            d = math.hypot(x - xy[j][0], z - xy[j][1])
            if d <= TRANSFER_M and d < best.get((a, b), math.inf):
                best[a, b] = d
    for (a, b), d in best.items():
        if not (a[0] == b[0] == 'r' and (a[2:], b[2:]) in same):   # same station: LINE_CHANGE covers it
            adj[a].append((b, walk_min(d), None, None))
    return {'pos': pos, 'adj': dict(adj), 'exits': dict(exits)}


def access(G, x, z, lat0, lon0, radius=ACCESS_M):
    """Start list for an origin at world (x, z): bus stops and station codes with an exit <= radius, in walk minutes."""
    pts = [(n, p) for n, p in G['pos'].items() if n[0] == 'b'] + \
          [('r:' + c, p) for c, ps in G['exits'].items() for p in ps]
    best = {}
    for n, (lat, lon) in pts:
        px, pz = local_xz(lat0, lon0, lon, lat)
        d = math.hypot(px - x, pz - z)
        if d <= radius and d < best.get(n, math.inf):
            best[n] = d
    return [(n, walk_min(d)) for n, d in best.items()]


def search(G, starts, limit=LIMIT):
    """Dijkstra over (node, service). Boarding a new service costs headway / 2. -> {node: (minutes, legs)}."""
    dist, prev, heap, tie = {}, {}, [], itertools.count()   # tie: never compare None with a str svc
    for n, t in starts:
        if t <= limit and t < dist.get((n, None), math.inf):
            dist[n, None] = t
            heapq.heappush(heap, (t, next(tie), n, None))
    best = {}
    while heap:
        t, _, n, svc = heapq.heappop(heap)
        if t > dist[n, svc]:
            continue
        if n not in best:
            best[n] = (t, (n, svc))
        for to, m, s, h in G['adj'].get(n, ()):
            nt = t + m + (h / 2 if s and s != svc else 0)
            if nt <= limit and nt < dist.get((to, s), math.inf):
                dist[to, s] = nt
                prev[to, s] = ((n, svc), nt - t)
                heapq.heappush(heap, (nt, next(tie), to, s))
    t0 = {n: dist[n, None] for n, _ in starts if (n, None) in dist}
    return {n: (t, legs(prev, st, t0)) for n, (t, st) in best.items()}


def legs(prev, st, t0):
    """Walk back the parent chain; merge consecutive same-service edges; walk minutes rounded.
    The chain's root is a start; its start minutes (the access walk) lead the legs."""
    out = []
    while st in prev:
        (st, m), svc = prev[st], st[1]
        if out and out[-1][0] == svc:
            out[-1][1] += m
        else:
            out.append([svc, m])
    if t0.get(st[0], 0) > 0:
        if out and out[-1][0] is None:
            out[-1][1] += t0[st[0]]
        else:
            out.append([None, t0[st[0]]])
    res = []
    for svc, m in reversed(out):
        res.append(['walk', round(m)] if svc is None else [svc[:svc.index(':')], svc[svc.index(':') + 1:].split('/')[0]])
    return res


def load():
    """-> (G, stops_by_code, routes) from reference/transit/ and the mrt/lrt rows of reference/amenities/all.json."""
    T = transit_dir()
    stops, routes, services = (json.loads((T / f'{d}.json').read_text()) for d in ('BusStops', 'BusRoutes', 'BusServices'))
    stations = [r for r in json.loads((ROOT / 'reference/amenities/all.json').read_text()) if r['cat'] in ('mrt', 'lrt')]
    G = build_graph(stops, routes, services, stations)
    G['stations'] = stations
    return G, {s['BusStopCode']: s for s in stops}, routes


def block_centres(P):
    """Mean world (x, z) of each block's stacks (plan -> world as p2w in tools/anchor_fit.py)."""
    pts = defaultdict(list)
    for s, xz in zip(P.get('stacks') or [], stack_xz(P)):
        pts[s['block']].append(xz)
    return {k: (sum(p[0] for p in v) / len(v), sum(p[1] for p in v) / len(v)) for k, v in pts.items()}


def reach(times, G, lat0, lon0):
    """15/30/45-min outlines: discs of (T - t) walk metres around every node reached at t < T, rasterised and traced."""
    pts = [((0.0, 0.0), 0.0)] + [(local_xz(lat0, lon0, G['pos'][n][1], G['pos'][n][0]), t) for n, (t, _) in times.items()]
    out = {}
    for T in (15, 30, 45):
        ds = [(x, z, (T - t) * 80 / WALK_FACTOR) for (x, z), t in pts if t < T]
        x0 = min(x - r for x, z, r in ds) - CELL; z0 = min(z - r for x, z, r in ds) - CELL   # 1-cell empty border
        w = int((max(x + r for x, z, r in ds) - x0) // CELL) + 2; h = int((max(z + r for x, z, r in ds) - z0) // CELL) + 2
        m = np.zeros((h, w), np.uint8)
        for x, z, r in ds:
            c0, c1 = int((x - r - x0) // CELL), int((x + r - x0) // CELL) + 1
            r0, r1 = int((z - r - z0) // CELL), int((z + r - z0) // CELL) + 1
            cx = x0 + (np.arange(c0, c1 + 1) + 0.5) * CELL; cz = z0 + (np.arange(r0, r1 + 1) + 0.5) * CELL
            m[r0:r1 + 1, c0:c1 + 1] |= ((cx[None, :] - x) ** 2 + (cz[:, None] - z) ** 2 <= r * r)
        cs, _ = cv2.findContours(m, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        rings = [simplify([(x0 + (c + 0.5) * CELL, z0 + (r + 0.5) * CELL) for c, r in k[:, 0]], tol=50) for k in cs]
        rings = [[[round(x), round(z)] for x, z in g] for g in rings if len(g) >= 4]
        # drop specks (isolated stops' discs) under 4 grid cells: they clutter the map
        out[str(T)] = [g for g in rings if cv2.contourArea(np.array(g, np.float32)) >= 4 * CELL * CELL]
    return out


def svc_key(no):
    m = re.match(r'(\d*)(.*)', no)
    return int(m[1]) if m[1] else math.inf, m[2]


def commute_for(P, G, stops_by_code, routes):
    lat0, lon0 = P['site']['lat'], P['site']['lon']
    xz = lambda lat, lon: local_xz(lat0, lon0, lon, lat)

    hub_codes, hub_pts = [], []
    for label, name in HUBS:
        rows = [r for r in G['stations'] if r['name'] == name]
        assert rows, name
        hub_codes.append({'r:' + c for r in rows for c in r['lines'].split() if 'r:' + c in G['pos']})
        ps = [xz(r['lat'], r['lon']) for r in rows]
        hub_pts.append([label, round(sum(p[0] for p in ps) / len(ps)), round(sum(p[1] for p in ps) / len(ps))])

    origins = sorted(block_centres(P).items(), key=lambda kv: math.hypot(*kv[1])) or [('site', (0.0, 0.0))]
    hubs, site_times = {}, None
    for k, (x, z) in origins:
        times = search(G, access(G, x, z, lat0, lon0))
        row = []
        for codes in hub_codes:
            hit = min((times[c] for c in codes if c in times), default=None, key=lambda v: v[0])
            row.append(None if hit is None else [round(hit[0]), hit[1]])
        hubs[k] = row
        if k == 'site':
            site_times = times
    if site_times is None:
        site_times = search(G, access(G, 0, 0, lat0, lon0))

    at = defaultdict(dict)
    for r in routes:
        if running(r['WD_FirstBus'], r['WD_LastBus']):
            at[r['BusStopCode']].setdefault(r['ServiceNo'], [r['ServiceNo'], r['WD_FirstBus'][:2] + ':' + r['WD_FirstBus'][2:],
                                                             r['WD_LastBus'][:2] + ':' + r['WD_LastBus'][2:]])
    near = sorted((math.hypot(*xz(s['Latitude'], s['Longitude'])), c) for c, s in stops_by_code.items() if at.get(c))
    stops = [{'code': c, 'name': stops_by_code[c]['Description'], 'd': round(d),
              'svc': sorted(at[c].values(), key=lambda v: svc_key(v[0]))} for d, c in near[:4]]

    for a in P.get('amenities', []):
        code = a['name'][len('Bus stop '):]
        if a['cat'] == 'bus' and a['name'].startswith('Bus stop ') and code in stops_by_code:
            a['name'] = stops_by_code[code]['Description']

    as_of = time.strftime('%Y-%m', time.localtime((transit_dir() / 'BusRoutes.json').stat().st_mtime))
    # 'near' is explicit: JS reorders digit-string keys ("9","5" -> "5","9"), so hubs' key order is not kept
    return {'asOf': as_of, 'at': 'weekday 08:00', 'near': str(origins[0][0]), 'hubs': {str(k): v for k, v in hubs.items()}, 'hubPts': hub_pts,
            'reach': reach(site_times, G, lat0, lon0), 'stops': stops}


def hhmm(t):
    return t[:2] + ':' + t[2:]


def station_name(row):
    return row['name'].removesuffix(' MRT Station').removesuffix(' LRT Station')


def line(pts, tol):
    """rdp split at the point farthest from the start, so a closed loop (start == end) keeps its shape."""
    far = max(range(len(pts)), key=lambda i: math.dist(pts[0], pts[i]))
    return rdp(pts[:far + 1], tol) + (rdp(pts[far:], tol)[1:] if far < len(pts) - 1 else [])


def transit_ctx(G, stops_by_code, routes, services, bus_rels):
    """Indexes transit_for needs: each (no, dir)'s stop rows in order, AM-peak bands, OSM bus relations by ref."""
    seq = defaultdict(list)
    for r in routes:
        seq[r['ServiceNo'], r['Direction']].append(r)
    for rs in seq.values():
        rs.sort(key=lambda r: r['StopSequence'])
    rels = defaultdict(list)
    for r in bus_rels:
        rels[r.get('tags', {}).get('ref')].append(r)
    # no AM-peak band ('-'): not running at 08:00, as in build_graph
    band = {(s['ServiceNo'], s['Direction']): s['AM_Peak_Freq'] for s in services if headway(s['AM_Peak_Freq']) is not None}
    served = {r['BusStopCode'] for k, rs in seq.items() if k in band for r in rs if running(r['WD_FirstBus'], r['WD_LastBus'])}
    return {'G': G, 'stops': stops_by_code, 'seq': dict(seq), 'rels': rels, 'served': served,
            'band': band}


def transit_for(P, ctx):
    """Bus stops <= 500 m and stations <= 1 km of any block (site centre if no stacks) with
    services running at 08:00, those services' route shapes, and each station's line neighbours, hubs and exits.
    Walk minutes keyed like P.commute.hubs."""
    lat0, lon0 = P['site']['lat'], P['site']['lon']
    xz = lambda lat, lon: [round(v) for v in local_xz(lat0, lon0, lon, lat)]
    origins = {str(k): v for k, v in block_centres(P).items()} or {'site': (0.0, 0.0)}
    walk = lambda p: {k: round(walk_min(math.hypot(p[0] - x, p[1] - z))) for k, (x, z) in origins.items()}
    near = lambda p, r: min(math.hypot(p[0] - x, p[1] - z) for x, z in origins.values()) <= r

    stops = []
    for c, s in ctx['stops'].items():
        p = xz(s['Latitude'], s['Longitude'])
        if c in ctx['served'] and near(p, ACCESS_M):
            stops.append({'code': c, 'name': s['Description'], 'x': p[0], 'z': p[1], 'walk': walk(p), 'svc': []})
    stops.sort(key=lambda s: (min(s['walk'].values()), s['code']))
    listed = {s['code']: s for s in stops}

    services = {}
    for (no, d), rs in sorted(ctx['seq'].items(), key=lambda kv: (svc_key(kv[0][0]), kv[0][1])):
        times = {}
        for r in rs:   # a loop's first and last stop: the first visit's times
            if r['BusStopCode'] in listed and running(r['WD_FirstBus'], r['WD_LastBus']):
                times.setdefault(r['BusStopCode'], [hhmm(r['WD_FirstBus']), hhmm(r['WD_LastBus'])])
        if not times or (no, d) not in ctx['band']:
            continue
        for c in times:
            if no not in listed[c]['svc']:
                listed[c]['svc'].append(no)
        lls = [(ctx['stops'][r['BusStopCode']]['Latitude'], ctx['stops'][r['BusStopCode']]['Longitude'])
               for r in rs if r['BusStopCode'] in ctx['stops']]
        path, road = route_path(match_relation(ctx['rels'].get(no, ()), no, lls[0], lls[-1]), lls)
        path = line([local_xz(lat0, lon0, lon, lat) for lat, lon in path], 25) if len(path) > 1 else path
        name = lambda r: ctx['stops'].get(r['BusStopCode'], {}).get('Description', r['BusStopCode'])
        services[f'{no}/{d}'] = {'no': no, 'from': name(rs[0]), 'to': name(rs[-1]), 'n': len(rs), 'band': ctx['band'][no, d],
                                 'times': times, 'path': [[round(x), round(z)] for x, z in path],
                                 'stopPts': [xz(*ll) for ll in lls], 'road': road,
                                 'stops': [r['BusStopCode'] for r in rs if r['BusStopCode'] in ctx['stops']]}   # aligned with stopPts; names in T.names

    rows = ctx['G'].get('stations', [])
    order = rail_order(rows)
    name_of = {c: station_name(r) for r in rows for c in rail_codes(r)}
    hub_rows = [(label, {c for r in rows if r['name'] == full for c in rail_codes(r)}) for label, full in HUBS]
    by_name = defaultdict(list)
    for r in rows:
        if rail_codes(r):
            by_name[station_name(r)].append(r)
    stations = []
    for nm, rs in by_name.items():
        ex = [(r, xz(r['lat'], r['lon'])) for r in rs]
        if not any(near(p, 1000) for _, p in ex):
            continue
        codes = sorted({c for r in rs for c in rail_codes(r)}, key=code_key)
        lines = []
        for c in codes:
            pre, seq = code_key(c)[0], order.get(code_key(c)[0], [])
            i = seq.index(c) if c in seq else None
            lines.append({'code': c, 'prev': name_of[seq[i - 1]] if i else None,
                          'next': name_of[seq[i + 1]] if i is not None and i + 1 < len(seq) else None,
                          'hubs': [lb for lb, hc in hub_rows if lb.lower() != nm.lower() and any(code_key(h)[0] == pre for h in hc)]})
        lab = {}   # all.json repeats some exit labels: keep the one nearest the site centre
        for r, p in sorted(ex, key=lambda e: math.hypot(*e[1])):
            lab.setdefault(r.get('exit', '').removeprefix('Exit '), p)
        exits = sorted(({'exit': k, 'x': p[0], 'z': p[1], 'walk': walk(p)} for k, p in lab.items()), key=lambda e: e['exit'])
        stations.append({'name': nm, 'codes': codes, 'lines': lines, 'exits': exits})
    stations.sort(key=lambda s: min(min(e['walk'].values()) for e in s['exits']))
    names = {c: ctx['stops'][c]['Description'] for v in services.values() for c in v['stops']}   # once per stop: routes share stops
    return {'stops': stops, 'services': services, 'stations': stations, 'names': names}


def rail_json(rels, stations):
    """prefix -> {"paths": [[[lat, lon], ...]]} for operating lines. A relation's prefix is the OPEN code prefix held
    by at least half its stop nodes (stations: all.json exits <= 300 m), so a future line touching interchanges is
    dropped. Relations are taken longest first and kept only if they add a station to their prefix, so a line's
    reverse direction and loop variants are not drawn again."""
    ex = [(r, local_xz(O[0], O[1], r['lon'], r['lat'])) for r in stations]
    def nearest(m):
        p = local_xz(O[0], O[1], m['lon'], m['lat'])
        d, r = min(((math.dist(p, q), r) for r, q in ex), key=lambda t: t[0], default=(math.inf, None))
        return r if d <= 300 else None
    cands = []
    for rel in rels:
        ss = [m for m in rel['members'] if is_stop(m)]
        hits = [r for r in map(nearest, ss) if r]
        pre = Counter(p for r in hits for p in {code_key(c)[0] for c in r['lines'].split() if OPEN.match(c)}).most_common(1)
        if pre and pre[0][1] * 2 >= len(ss):   # e.g. not the Jurong Region Line (only its interchanges are open)
            cands.append((pre[0][0], {r['name'] for r in hits}, rel))
    out, seen = defaultdict(list), defaultdict(set)
    for pre, names, rel in sorted(cands, key=lambda c: -len(c[1])):
        if names <= seen[pre]:
            continue
        seen[pre] |= names
        path = chain([[(g['lat'], g['lon']) for g in m['geometry']] for m in rel['members']
                      if m['type'] == 'way' and m['role'] in ('', 'forward', 'backward') and m.get('geometry')])
        if len(path) < 2:
            continue
        k = 111_320 * math.cos(math.radians(O[0]))
        pts = line([local_xz(O[0], O[1], lon, lat) for lat, lon in path], 50)
        out[pre].append([[round(O[0] - z / 110_574, 5), round(O[1] + x / k, 5)] for x, z in pts])
    at = defaultdict(list)   # (prefix, name) -> exit lat/lons; a station sits at the mean of its exits
    for r in stations:
        for p in {code_key(c)[0] for c in r['lines'].split() if OPEN.match(c)} & out.keys():
            at[p, station_name(r)].append((r['lat'], r['lon']))
    sts = defaultdict(list)
    for (p, nm), ll in sorted(at.items()):
        sts[p].append([nm, round(sum(a for a, _ in ll) / len(ll), 5), round(sum(b for _, b in ll) / len(ll), 5)])
    return {p: {'paths': ps, 'stations': sts[p]} for p, ps in sorted(out.items())}


if __name__ == '__main__':
    G, stops_by_code, routes = load()
    T = transit_dir()
    services = json.loads((T / 'BusServices.json').read_text())
    osm = {n: json.loads((T / f'{n}.json').read_text())['elements'] for n in ('osm_bus', 'osm_rail')}
    ctx = transit_ctx(G, stops_by_code, routes, services, osm['osm_bus'])
    for d in sys.argv[1:]:
        f = Path(d) / 'project.json'
        P = json.loads(f.read_text())
        P['commute'] = C = commute_for(P, G, stops_by_code, routes)
        f.write_text(json.dumps(P, separators=(',', ':')))
        first = [h and h[0] for h in next(iter(C['hubs'].values()))]
        print(f"{Path(d).name}: hubs {first}, commute {len(json.dumps(C, separators=(',', ':'))) / 1024:.1f} KB")
        Tr = transit_for(P, ctx)
        out = json.dumps(Tr, separators=(',', ':'))
        (Path(d) / 'transit.json').write_text(out)
        print(f"{Path(d).name}: {len(Tr['stops'])} stops, {len(Tr['services'])} services, {len(out) / 1024:.1f} KB")
    rail = json.dumps(rail_json(osm['osm_rail'], G['stations']), separators=(',', ':'))
    (ROOT / 'web/rail.json').write_text(rail)
    print(f"web/rail.json: {', '.join(json.loads(rail))}, {len(rail) / 1024:.1f} KB")
