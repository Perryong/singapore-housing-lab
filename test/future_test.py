# Future BTO scoring rules on hand-made parcels near Bishan (no downloads needed).
import math, sys
sys.path.insert(0, 'tools')
from future_score import (outer_rings, ring_area_m2, contains, gpr_num, Grid, coverage, is_candidate, score, band,  # noqa: E402
                          backtest)

LAT, LON = 1.35, 103.82
M_LAT, M_LON = 1 / 110_574, 1 / (111_320 * math.cos(math.radians(LAT)))


def at(dn, de):                       # metres north/east of the origin -> (lat, lon)
    return LAT + dn * M_LAT, LON + de * M_LON


def square(dn, de, half):             # GeoJSON ring [lon, lat], closed
    pts = [at(dn - half, de - half), at(dn - half, de + half), at(dn + half, de + half), at(dn + half, de - half)]
    return [[lo, la] for la, lo in pts + pts[:1]]


# geometry
assert len(outer_rings({'type': 'Polygon', 'coordinates': [square(0, 0, 50)]})) == 1
mp = outer_rings({'type': 'MultiPolygon', 'coordinates': [[square(0, 0, 5)], [square(0, 500, 50)]]})
assert len(mp) == 2 and abs(ring_area_m2(mp[0]) - 10_000) < 100, 'largest ring first'
assert abs(ring_area_m2(square(0, 0, 50)) - 10_000) < 100
assert contains([square(0, 0, 50)], *at(10, 10)) and not contains([square(0, 0, 50)], *at(80, 0))

# GPR text from URA: numbers, codes or nothing
assert gpr_num('2.8') == 2.8 and gpr_num('EVA') is None and gpr_num(None) is None

# candidates
assert is_candidate('RESIDENTIAL', 12_000, 0.05, False)
assert not is_candidate('RESIDENTIAL', 9_000, 0.05, False)
assert not is_candidate('RESIDENTIAL', 12_000, 0.2, False)
assert not is_candidate('RESIDENTIAL', 12_000, 0.05, True)
assert not is_candidate('ROAD', 12_000, 0.05, False)

# coverage: building footprint area whose centroid is inside, over parcel area
blds = Grid([(*at(0, 0), 600.0), (*at(20, 20), 400.0), (*at(400, 0), 9_999.0)])
assert abs(coverage([square(0, 0, 50)], 10_000, blds) - 0.1) < 1e-9

# grid
g = Grid([(*at(0, 300), 'b'), (*at(0, 100), 'a'), (*at(0, 2000), 'far')])
assert [p for _, p in g.near(LAT, LON, 500)] == ['a', 'b']

# score
KRANJI = {'name': 'Kranji', 'lat': LAT, 'lon': LON, 'radiusM': 1000, 'homes': 14000, 'announced': 2025,
          'firstLaunch': 2029, 'source': 'https://www.ura.gov.sg/'}
ctx = lambda areas=(), stations=(), hdb=(), asOf=2026: {  # noqa: E731
    'asOf': asOf, 'areas': list(areas), 'stations': Grid([(*at(*s[:2]), {'name': s[2], 'opens': s[3]}) for s in stations]),
    'hdb': Grid([(*at(*h), None) for h in hdb])}
P = {'lat': LAT, 'lon': LON, 'area': 20_000, 'lu': 'RESIDENTIAL', 'gpr': '3.0', 'rezoned': True}

s = score(P, ctx([KRANJI], [(300, 0, 'Bishan', None)], [(0, 200)]))
assert s['score'] == 100 and s['band'] == 'likely' and s['horizon'] == 'near', s
assert len(s['reasons']) == 5 and sum(p for _, p in s['reasons']) == 100
assert s['reasons'][0] == ['In announced growth area: Kranji (~14,000 homes)', 40]
assert s['name'] == 'Kranji' and s['announced'] and s['source'] == 'https://www.ura.gov.sg/'
assert ['Rezoned to residential since MP2019', 20] in s['reasons']
assert ['HDB block within 500 m', 15] in s['reasons']
assert ['GPR 3.0 (2.8 or higher)', 10] in s['reasons']
assert any(t.startswith('Bishan MRT ') and t.endswith(' m') and '(opens' not in t for t, _ in s['reasons'])

s = score({**P, 'rezoned': False}, ctx(stations=[(5000, 0, 'Far', None)], hdb=[(0, 200)]))
assert s['score'] == 25 and s['band'] == 'longshot' and s['horizon'] == 'far', s
assert s['name'] == 'Unannounced · near Far' and not s['announced'] and s['source'] is None

assert not any(t.startswith('GPR') for t, _ in score({**P, 'gpr': 'SDP'}, ctx())['reasons'])

# overlapping growth areas: nearest centre names it, points once
near_a = {**KRANJI, 'name': 'Near', 'lat': at(100, 0)[0]}
far_a = {**KRANJI, 'name': 'Far', 'lat': at(600, 0)[0]}
s = score(P, ctx([far_a, near_a]))
assert s['name'] == 'Near' and sum(p for t, p in s['reasons'] if t.startswith('In announced')) == 40

for fl, want in ((2029, 'near'), (2033, 'far'), (None, 'far')):
    assert score(P, ctx([{**KRANJI, 'firstLaunch': fl}]))['horizon'] == want, fl

assert not any('MRT' in t for t, _ in score(P, ctx(stations=[(300, 0, 'Later', 2040)]))['reasons'])
assert any(t.startswith('Soon MRT (opens 2030) ') for t, _ in score(P, ctx(stations=[(300, 0, 'Soon', 2030)]))['reasons'])
assert score(P, ctx())['mrtM'] == math.inf

assert (band(70), band(69), band(40), band(39)) == ('likely', 'possible', 'possible', 'longshot')

# backtest: 20 parcels 1 km apart; the 2 best-scored hold 2 of 3 launch sites, the 3rd is outside all
ranked = [{'rings': [square(0, i * 1000, 50)], 'score': 100 - i, 'mrtM': (20 - i) * 100} for i in range(20)]
sites = [at(0, 0), at(0, 1000), at(5000, 5000)]
assert backtest(ranked, sites) == {'n': 3, 'topDecile': 0.667, 'mrtOnly': 0.0, 'random': 0.067, 'inCandidates': 0.667}

# hand-kept growth areas: schema of the committed file
import contextlib, datetime as dt, io, json, re, tempfile  # noqa: E402
from future_score import load_ref  # noqa: E402

doc = json.load(open('reference/ura/growth-areas.json'))
dt.date.fromisoformat(doc['reviewed'])
assert len(doc['items']) >= 8
for a in doc['items']:
    assert isinstance(a['name'], str) and a['name'], a
    assert 1.15 < a['lat'] < 1.48 and 103.6 < a['lon'] < 104.1, a
    assert a['radiusM'] > 0 and (a['homes'] is None or isinstance(a['homes'], int)), a
    assert isinstance(a['announced'], int) and (a['firstLaunch'] is None or isinstance(a['firstLaunch'], int)), a
    assert re.match(r'^https://', a['source']), a

# load_ref warns once the review is over 90 days old
with tempfile.NamedTemporaryFile('w', suffix='.json', delete=False) as f:
    json.dump({'reviewed': str(dt.date.today() - dt.timedelta(days=100)), 'items': [{'x': 1}]}, f)
err = io.StringIO()
with contextlib.redirect_stderr(err):
    assert load_ref(f.name) == [{'x': 1}]
assert 'over 90 days ago' in err.getvalue(), err.getvalue()
err = io.StringIO()
with contextlib.redirect_stderr(err):
    load_ref('reference/ura/growth-areas.json')
assert err.getvalue() == ''

print('ok: future scoring rules')
