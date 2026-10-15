# Commute tab: LTA bus data fetch and cache (tools/fetch_transit.py).
from tools.fetch_transit import headway

assert headway('06-09') == 7.5 and headway('10') == 10.0
assert headway('-') is None and headway('') is None

# lta_key reads .env: quotes and a leading `export` are tolerated (the env var, when set, wins)
import os, tempfile
from pathlib import Path
import tools.fetch_transit as ft
_root, _env = ft.ROOT, os.environ.pop('LTA_KEY', None)
with tempfile.TemporaryDirectory() as d:
    ft.ROOT = Path(d)
    for line in ['LTA_KEY=abc+1==', 'export LTA_KEY="abc+1=="', "  LTA_KEY='abc+1=='  "]:
        (Path(d) / '.env').write_text(f'# c\n{line}\n')
        assert ft.lta_key() == 'abc+1==', line
ft.ROOT = _root
if _env is not None:
    os.environ['LTA_KEY'] = _env
# Task 2: transit graph + time search on a toy network.
import math
from tools.build_commute import access, build_graph, search
from tools.fetch_context import local_xz

def approx(a, b): return abs(a - b) < 0.01
def ride(p, q):  # rail: straight line at 40 km/h + 0.5 min dwell
    x, z = local_xz(p[0], p[1], q[1], q[0]); return math.hypot(x, z) / 1000 / 40 * 60 + 0.5

AA1, AA2, AA3, BB2 = (1.30, 103.80), (1.31, 103.80), (1.32, 103.80), (1.31, 103.82)
toy_stations = [{'cat': 'mrt', 'name': n, 'lat': p[0], 'lon': p[1], 'exit': 'A', 'lines': l} for n, p, l in
                [('A1', AA1, 'BP1'), ('X', AA2, 'BP2 SE1'), ('A3', AA3, 'BP3'), ('B2', BB2, 'SE2')]]
toy_stops = [{'BusStopCode': f'S{i}', 'Latitude': 1.40 + i * 0.0162, 'Longitude': 103.70} for i in (1, 2, 3)] + \
            [{'BusStopCode': f'T{i}', 'Latitude': 1.45, 'Longitude': 103.75 + i * 0.01} for i in (1, 2)]
def rows(svc, codes, dists, first='0500', last='2300'):
    return [{'ServiceNo': svc, 'Direction': 1, 'StopSequence': i + 1, 'BusStopCode': c, 'Distance': d,
             'WD_FirstBus': first, 'WD_LastBus': last} for i, (c, d) in enumerate(zip(codes, dists))]
toy_routes = rows('7', ['S1', 'S2', 'S3'], [0, 1.8, 3.6]) + rows('8', ['T1', 'T2'], [0, 1.0], first='0900') + \
             rows('9', ['T1', 'T2'], [0, 1.0]) + rows('5', ['T2', 'T1'], [5.0, 0.0])
toy_services = [{'ServiceNo': '7', 'Direction': 1, 'AM_Peak_Freq': '08-12'},
                {'ServiceNo': '8', 'Direction': 1, 'AM_Peak_Freq': '08-12'},
                {'ServiceNo': '9', 'Direction': 1, 'AM_Peak_Freq': '-'},
                {'ServiceNo': '5', 'Direction': 1, 'AM_Peak_Freq': '08-12'}]
G = build_graph(toy_stops, toy_routes, toy_services, toy_stations)
r = search(G, [('r:BP1', 0)])
assert approx(r['r:BP2'][0], 2 + ride(AA1, AA2)), r['r:BP2']   # BP/SE are LRT: headway 4, wait 2
assert approx(r['r:SE2'][0], r['r:BP2'][0] + 2 + 2 + ride(AA2, BB2)), r['r:SE2']
assert [l[0] for l in r['r:SE2'][1]] == ['rail', 'walk', 'rail'], r['r:SE2'][1]
assert approx(r['r:BP3'][0], 2 + ride(AA1, AA2) + ride(AA2, AA3))   # stays aboard: one wait
b = search(G, [('b:S1', 0)])
assert approx(b['b:S3'][0], 5 + 2 * 6), b['b:S3']                     # wait 10/2, 1.8 km at 18 km/h each hop
assert [l[0] for l in b['b:S3'][1]] == ['bus'] and b['b:S3'][1][0][1] == '7'
far = search(G, [('b:S1', 55)]); assert 'b:S3' not in far             # past the 60-min cut-off
bus = [e for es in G['adj'].values() for e in es if e[2] and e[2].startswith('bus:')]
assert {e[2] for e in bus} == {'bus:7/1'}, bus                         # 8 starts 0900, 9 has no AM peak, 5 decreases
assert all(e[1] > 0 for es in G['adj'].values() for e in es)
ax, az = local_xz(1.30, 103.80, 103.80, 1.302)                       # 0.002 deg north of AA1 (~221 m)
acc = dict(access(G, ax, az, 1.30, 103.80))
assert set(acc) == {'r:BP1'} and approx(acc['r:BP1'], 0.002 * 110_574 * 1.3 / 80), acc
# a bus stop beside an interchange must not undercut the 2-min line change (exit -> stop -> exit)
G2 = build_graph(toy_stops + [{'BusStopCode': 'SX', 'Latitude': AA2[0] + 0.0001, 'Longitude': AA2[1]}],
                 toy_routes, toy_services, toy_stations)
assert approx(search(G2, [('r:BP1', 0)])['r:SE2'][0], r['r:SE2'][0])
assert search(G, [('r:BP1', 3)])['r:BP2'][1][0] == ['walk', 3]          # access walk leads the legs
assert search(G2, [('r:BP1', 3)])['r:SE2'][1] == [['walk', 3], ['rail', 'BP'], ['walk', 2], ['rail', 'SE']]
# extra link EW4-CG1 belongs to the branch: boarding it from the trunk pays the CG wait (headway 3 -> 1.5)
E3, E4, C1, C2 = (1.33, 103.94), (1.33, 103.95), (1.335, 103.96), (1.34, 103.97)
br = build_graph([], [], [], [{'cat': 'mrt', 'name': c, 'lat': p[0], 'lon': p[1], 'exit': 'A', 'lines': c}
                              for c, p in [('EW3', E3), ('EW4', E4), ('CG1', C1), ('CG2', C2)]])
rb = search(br, [('r:EW3', 0)])
assert approx(rb['r:CG1'][0], 1.5 + ride(E3, E4) + 1.5 + ride(E4, C1)), rb['r:CG1']
assert rb['r:CG2'][1] == [['rail', 'EW'], ['rail', 'CG']], rb['r:CG2']
# unbuilt lines (Cross Island Line codes are already in all.json) get no rail edge
cr = build_graph([], [], [], [{'cat': 'mrt', 'name': c, 'lat': p[0], 'lon': p[1], 'exit': 'A', 'lines': c}
                              for c, p in [('CR5', E3), ('CR6', E4)]])
assert not any(e[2] for es in cr['adj'].values() for e in es), cr['adj']
# Task 3: per-project commute block (real LTA data; skipped when reference/transit/ is missing, as in CI).
import json
from pathlib import Path
if not Path('reference/transit/BusRoutes.json').exists():
    print('skipped real-data commute checks: reference/transit/ missing (needs LTA_KEY, see tools/fetch_transit.py)')
else:
    from tools.build_commute import commute_for, load
    G, stops_by_code, routes = load()
    Pb = json.loads(Path('projects/bishan-terraces/project.json').read_text())
    C = commute_for(Pb, G, stops_by_code, routes)
    first = next(iter(C['hubs'].values()))
    assert 22 <= first[0][0] <= 30, first[0]                            # Raffles Place on the NS line
    assert len(C['hubs']) > 1 and all(len(v) == 5 for v in C['hubs'].values()), C['hubs']
    assert [h[0] for h in C['hubPts']] == ['Raffles Place', 'one-north', 'Changi Airport', 'Jurong East', 'Woodlands']
    assert set(C['reach']) == {'15', '30', '45'} and all(C['reach'][k] for k in C['reach'])
    assert all(len(r) >= 4 and all(isinstance(v, int) for p in r for v in p) for k in C['reach'] for r in C['reach'][k])
    assert len(C['stops']) == 4 and all(s['name'] and s['svc'] for s in C['stops']), C['stops']
    assert all(len(v) == 3 and v[1][2] == ':' for s in C['stops'] for v in s['svc'])
    assert C['at'] == 'weekday 08:00' and len(C['asOf']) == 7
    assert not any(a['name'].startswith('Bus stop ') for a in Pb['amenities'] if a['cat'] == 'bus')
    U = commute_for(json.loads(Path('projects/bedok-bayshore-i-oct-2026/project.json').read_text()), G, stops_by_code, routes)
    assert list(U['hubs']) == ['site'] and U['near'] == 'site'
    from tools.build_commute import block_centres
    assert C['near'] == min(block_centres(Pb).items(), key=lambda kv: math.hypot(*kv[1]))[0], C['near']
    assert C['near'] in C['hubs']
    import cv2, numpy as np                                               # no specks: every ring >= 4 grid cells
    assert all(cv2.contourArea(np.array(r, np.float32)) >= 40_000 for k in C['reach'] for r in C['reach'][k])
for f in Path('projects').glob('*/project.json'):                         # committed files (runs in CI): size budget
    c = json.loads(f.read_text()).get('commute')
    assert c is None or len(json.dumps(c, separators=(',', ':'))) <= 40_000, f

# Task 1: chain joins out-of-order / reversed OSM ways into one continuous path
from tools.fetch_transit import chain
a, b, c = [(0,0),(0,1)], [(0,2),(0,1)], [(0,2),(0,3)]          # b reversed
assert chain([a, b, c]) == [(0,0),(0,1),(0,2),(0,3)]
assert chain([b, a]) == [(0,2),(0,1),(0,0)]                     # starts at b's free end
assert chain([a]) == a and chain([]) == []
assert chain([[]]) == [] and chain([[], a]) == a and chain([[(1,1)]]) == [(1,1)]
assert chain([[(0,0),(0,1)], [(0,5),(0,4)]]) == [(0,0),(0,1),(0,4),(0,5)]   # gap: nearest-end orientation
# Task 2 (bus/MRT): match OSM bus relations to LTA services by ref + end stops; rail line order
from tools.build_commute import match_relation, route_path, rail_order
A, B = (1.30, 103.80), (1.35, 103.85)
def rel(ref, s0, s1, ways=()):
    return {'tags': {'ref': ref}, 'members':
            [{'type': 'node', 'role': 'platform', 'lat': s0[0], 'lon': s0[1]}] +
            [{'type': 'way', 'role': '', 'geometry': [{'lat': p[0], 'lon': p[1]} for p in w]} for w in ways] +
            [{'type': 'node', 'role': 'stop', 'lat': s1[0], 'lon': s1[1]}]}
fwd = rel('88', A, B, [[A, (1.32, 103.82)], [B, (1.32, 103.82)]])
back = rel('88', B, A)                                          # other direction: must not match A -> B
short = rel('88', A, (B[0] - 0.009, B[1]))                      # short-working, ~1 km before B
assert match_relation([back, short, fwd], '88', A, B) is fwd
assert match_relation([back, short], '88', A, B) is None
assert match_relation([fwd], '99', A, B) is None
assert route_path(fwd, [A, B]) == ([A, (1.32, 103.82), B], True)
assert route_path(None, [A, B]) == ([A, B], False)
tail = rel('88', A, B, [[(1.29, 103.79), A, (1.32, 103.82), B, (1.36, 103.86)]])   # runs past both end stops
assert route_path(tail, [A, B]) == ([A, (1.32, 103.82), B], True)
loop = rel('88', A, A, [[(1.29, 103.79), A, (1.32, 103.82), (1.30, 103.801)]])          # first == last stop
assert route_path(loop, [A, (1.32, 103.82), A])[0] == [(1.29, 103.79), A, (1.32, 103.82), (1.30, 103.801)]
off = [A, (1.34, 103.80), B]                                    # OSM relation out of date: a stop ~2.6 km off its path
assert route_path(fwd, off) == (off, False)
mid = [A, (1.31, 103.81), B]                                    # mid-segment stop, far from every vertex: still on the road
assert route_path(fwd, mid) == ([A, (1.32, 103.82), B], True)
st = lambda codes: [{'lat': 1.3 + i / 100, 'lon': 103.8, 'lines': c} for i, c in enumerate(codes)]
assert rail_order(st(['NS3', 'NS1', 'NS2'])) == {'NS': ['NS1', 'NS2', 'NS3']}
assert rail_order(st(['TE23', 'TE22A', 'TE22']))['TE'] == ['TE22', 'TE22A', 'TE23']
# Task 3 (bus/MRT): transit.json per project + web/rail.json
from tools.build_commute import transit_ctx, transit_for, rail_json, OPEN
L = {f'L{i}': (1.30 + i * 0.001, 103.80) for i in (1, 2, 3)}             # ~110 m apart, all near the site
lstops = [{'BusStopCode': c, 'Description': f'Stop <{c}>', 'Latitude': p[0], 'Longitude': p[1]} for c, p in L.items()]
lroutes = rows('3', ['L1', 'L2', 'L3', 'L1'], [0, 1, 2, 3]) + rows('4', ['L1', 'L2'], [0, 1]) + \
          [dict(r, Direction=2) for r in rows('4', ['L3', 'L2', 'L1'], [0, 1, 2])]
lsvc = [{'ServiceNo': n, 'Direction': d, 'AM_Peak_Freq': '05-08'} for n, d in [('3', 1), ('4', 1), ('4', 2)]] + \
       [{'ServiceNo': '6', 'Direction': 1, 'AM_Peak_Freq': '-'}]            # no AM-peak band: never listed
lroutes += rows('6', ['L1', 'L2'], [0, 1]) + rows('7', ['L2', 'L3'], [0, 1])   # 7: no BusServices row
lstops.append({'BusStopCode': 'L9', 'Description': 'only 6', 'Latitude': 1.3005, 'Longitude': 103.8001})
lroutes += [dict(r, BusStopCode='L9', StopSequence=9) for r in rows('6', ['L9'], [2])]
lG = build_graph(lstops, lroutes, lsvc, [])
lctx = transit_ctx(lG, {s['BusStopCode']: s for s in lstops}, lroutes, lsvc, [])
LT = transit_for({'site': {'lat': 1.30, 'lon': 103.80}}, lctx)
s1 = next(s for s in LT['stops'] if s['code'] == 'L1')
assert s1['svc'] == ['3', '4'] and list(s1['walk']) == ['site'], s1    # loop stop: each number once
assert list(LT['services']) == ['3/1', '4/1', '4/2'], list(LT['services'])
l3 = LT['services']['3/1']
assert l3['from'] == l3['to'] == 'Stop <L1>' and l3['n'] == 4 and l3['band'] == '05-08' and l3['road'] is False
assert l3['times']['L1'] == ['05:00', '23:00'] and set(l3['times']) == {'L1', 'L2', 'L3'}
pt = [s1['x'], s1['z']]                                                # UI picks the direction reaching the stop first
assert LT['services']['4/1']['stopPts'].index(pt) < LT['services']['4/2']['stopPts'].index(pt)
assert LT['stations'] == []
assert 'L9' not in {s['code'] for s in LT['stops']} and not any(n in s['svc'] for s in LT['stops'] for n in '67')
from tools.build_commute import line
sq = [(0, 0), (100, 0), (100, 100), (0, 100), (0, 0)]                  # closed loop keeps its corners
assert line(sq, 25) == sq and line([(0, 0), (50, 1), (100, 0)], 25) == [(0, 0), (100, 0)]
rst = [{'name': n, 'lat': 1.30, 'lon': 103.80 + i * 0.01, 'exit': 'Exit A', 'lines': l}
       for i, (n, l) in enumerate([('P', 'NS1'), ('Q', 'NS2 CR1'), ('R', 'NS3')])]
def rrel(lons, stops):
    return {'members': [{'type': 'node', 'role': 'stop', 'lat': 1.30, 'lon': o} for o in stops] +
            [{'type': 'way', 'role': '', 'geometry': [{'lat': 1.30, 'lon': o} for o in lons]}]}
ns, sn = rrel([103.80, 103.82], [103.80, 103.81, 103.82]), rrel([103.82, 103.80], [103.82, 103.81, 103.80])
future = rrel([103.81, 103.81, 103.81], [103.81, 103.85, 103.86])     # 1 of 3 stops open (interchange): dropped
RJ = rail_json([future, ns, sn], rst)
assert list(RJ) == ['NS'] and RJ['NS']['paths'] == [[[1.3, 103.8], [1.3, 103.82]]], RJ
if not Path('reference/transit/osm_bus.json').exists():
    print('skipped real-data transit checks: reference/transit/osm_*.json missing (python3 tools/fetch_transit.py --osm)')
else:
    from tools.build_commute import load
    G, stops_by_code, routes = load()
    rj = lambda n: json.loads(Path(f'reference/transit/{n}.json').read_text())
    ctx = transit_ctx(G, stops_by_code, routes, rj('BusServices'), rj('osm_bus')['elements'])
    T = transit_for(json.loads(Path('projects/bishan-terraces/project.json').read_text()), ctx)
    assert T['stops'] and T['stops'][0]['walk']['100B'] >= 1
    assert any(s['code'] == '52031' and '88' in s['svc'] for s in T['stops'])
    k = next(k for k in T['services'] if k.startswith('88/'))
    assert T['services'][k]['from'] == 'Pasir Ris Int' and T['services'][k]['to'] == 'Toa Payoh Int'
    assert any(v['road'] for v in T['services'].values())
    st = next(s for s in T['stations'] if s['name'].startswith('Bishan'))
    ns = next(l for l in st['lines'] if l['code'] == 'NS17')
    assert (ns['prev'], ns['next']) == ('Ang Mo Kio', 'Braddell') and 'Raffles Place' in ns['hubs']
    assert sorted(e['exit'] for e in st['exits']) == ['A', 'B', 'C', 'D', 'E']
    assert all(len({e['exit'] for e in s['exits']}) == len(s['exits']) for s in T['stations'])
    U = transit_for(json.loads(Path('projects/ping-yi-court/project.json').read_text()), ctx)   # Bedok North: two 'Exit B' rows; 7A/1 band '-'
    assert all(len({e['exit'] for e in s['exits']}) == len(s['exits']) for s in U['stations'])
    assert all(v['band'] != '-' for v in U['services'].values())
    R = rail_json(rj('osm_rail')['elements'], G['stations'])
    assert R and all(OPEN.match(p + '1') for p in R) and 'NS' in R and 'CC' in R, list(R)
    assert 'BP' not in R and len(R['NS']['paths']) == 1 and all(len(p) > 4 for v in R.values() for p in v['paths']), R
for f in Path('projects').glob('*/transit.json'): assert f.stat().st_size <= 120_000, f
if Path('web/rail.json').exists():
    R = json.loads(Path('web/rail.json').read_text())
    assert R and all(OPEN.match(p + '1') for p in R), list(R)
    assert Path('web/rail.json').stat().st_size <= 80_000
print('ok')
