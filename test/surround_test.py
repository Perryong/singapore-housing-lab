# Simple 3D surroundings: malls, MRT/LRT station buildings and outer-ring HDB blocks (tools/fetch_surround.py).
import json, math, sys
from pathlib import Path
from tools.fetch_surround import simplify, surround

sq = [[0, 0], [5, 0], [10, 0], [10, 0.1], [10, 10], [5, 10.05], [0, 10]]           # square with near-collinear extras
assert simplify(sq) == [[0, 0], [10, 0], [10, 10], [0, 10]], simplify(sq)

# Feature outlines from a small Overpass fixture (no network): kinds, heights, overlap drop, 1.5 km and 900 m rules
from tools.fetch_surround import features, classify, feature_height
LAT0, LON0 = 1.35, 103.85
def geo(pts):                                                      # site-local metres -> closed Overpass geometry
    g = [{'lat': LAT0 - z / 110_574.0, 'lon': LON0 + x / (111_320.0 * math.cos(math.radians(LAT0)))} for x, z in pts]
    return g + g[:1]
box = lambda x0, z0, x1, z1: [(x0, z0), (x1, z0), (x1, z1), (x0, z1)]
way = lambda i, tags, pts: {'type': 'way', 'id': i, 'tags': tags, 'geometry': geo(pts)}
F = [way(1, {'amenity': 'school', 'name': 'Fixture Pri'}, box(-300, -300, -100, -100)),
     way(2, {'building': 'yes'}, box(-250, -250, -230, -230)),                 # inside the campus -> school
     way(3, {'building': 'yes'}, box(-50, -250, -30, -230)),                   # outside any campus -> ignored
     way(4, {'amenity': 'community_centre', 'building': 'yes', 'height': '15 m'}, box(100, 100, 140, 140)),
     {'type': 'relation', 'id': 5, 'tags': {'amenity': 'food_court', 'building': 'yes', 'type': 'multipolygon'}, 'members': [
         {'type': 'way', 'role': 'outer', 'geometry': geo(box(300, 300, 360, 360))},
         {'type': 'way', 'role': 'inner', 'geometry': geo(box(320, 320, 340, 340))},
         {'type': 'way', 'role': 'outer'}]},                                    # member without geometry: no crash
     way(6, {'leisure': 'park'}, box(-600, 400, -400, 600)),
     way(7, {'amenity': 'hospital', 'building': 'yes', 'building:levels': '5;6'}, box(500, -200, 560, -140)),
     way(8, {'amenity': 'library', 'building': 'yes'}, box(216, 0, 256, 40)),                      # 60% over the HDB block -> dropped
     way(9, {'amenity': 'library', 'building': 'yes'}, box(224, 0, 264, 40)),                      # 40% -> kept
     way(10, {'building': 'school'}, box(880, -10, 900, 10)),                   # centre 890 m -> blocker
     way(11, {'building': 'school'}, box(900, -10, 920, 10)),                   # centre 910 m -> drawn, not a blocker
     way(12, {'leisure': 'park'}, box(1590, -10, 1610, 10)),                    # centre 1,600 m -> not drawn
     way(13, {'amenity': 'clinic'}, box(-100, 600, -60, 640)),                  # 90% over a context block -> dropped
     way(14, {'shop': 'bakery'}, box(0, 0, 10, 10)),
     way(15, {'amenity': 'hospital'}, box(-400, -700, -340, -640)),             # grounds only: flat, never blocks
     way(16, {'amenity': 'place_of_worship', 'building': 'church'}, box(-290, -290, -270, -270)),   # in campus: not school
     way(17, {'building': 'roof'}, box(-150, -150, -130, -130)),               # covered walkway in campus: not school
     way(18, {'building': 'dormitory'}, box(-150, -290, -130, -270)),          # in campus -> school
     way(19, {'amenity': 'school', 'leisure': 'pitch'}, box(-900, 0, -800, 100)),   # sports ground: no campus
     way(20, {'amenity': 'school', 'sport': 'soccer'}, box(-900, 200, -800, 300))]
FP = {'site': {'lat': LAT0, 'lon': LON0}, 'surround': [{'k': 'hdb', 'h': 40, 'p': [list(q) for q in box(200, 0, 240, 40)]}],
      'context': [{'h': 40, 'p': [list(q) for q in box(-104, 600, -60, 640)]}]}
ctx0 = json.dumps(FP['context'])
FS, FB = features(FP, elements=F, others=[])
at = lambda x, z: [s for s in FS if abs(cen(s['p'])[0] - x) < 1 and abs(cen(s['p'])[1] - z) < 1]
cen = lambda p: (sum(q[0] for q in p) / len(p), sum(q[1] for q in p) / len(p))
kinds = sorted(s['k'] for s in FS)
assert kinds == sorted(['campus', 'school', 'school', 'cc', 'hawker', 'park', 'health', 'health', 'library', 'school', 'school']), kinds
assert [s['k'] for s in at(-200, -200)] == ['campus'] and at(-200, -200)[0]['h'] == 0.2 and at(-200, -200)[0]['n'] == 'Fixture Pri'
assert [(s['k'], s['h']) for s in at(-240, -240)] == [('school', 12.0)]                   # default school height
assert not at(-40, -240)                                                                   # building outside a campus
assert [(s['k'], s['h']) for s in at(120, 120)] == [('cc', 15.0)]                         # height tag
assert [(s['k'], s['h'], len(s['p'])) for s in at(330, 330)] == [('hawker', 8.0, 4)]      # outer ring only
assert [(s['k'], s['h']) for s in at(-500, 500)] == [('park', 0.2)]
assert [(s['k'], s['h']) for s in at(530, -170)] == [('health', 20.0)]                    # '5;6' levels -> 5 x 4 m
assert [(s['k'], s['h']) for s in at(-370, -670)] == [('health', 0.2)]                     # untagged grounds: flat
assert not at(-280, -280) and not at(-140, -140) and [s['k'] for s in at(-140, -280)] == ['school']
assert not at(-850, 50) and not at(-850, 250)                                              # leisure/sport campus dropped
assert not at(236, 20) and [s['k'] for s in at(244, 20)] == ['library']                   # >50% overlap dropped
assert not at(-80, 620) and json.dumps(FP['context']) == ctx0                              # context overlap; untouched
assert at(910, 0) and not at(1600, 0)                                                      # 1,500 m drawing rule
assert all(math.hypot(*cen(b['p'])) <= 900 for b in FB) and any(abs(cen(b['p'])[0] - 890) < 1 for b in FB)
assert not any(abs(cen(b['p'])[0] - 910) < 1 for b in FB)                                  # 900 m blocker rule by centre
assert all(set(b) == {'k', 'h', 'p'} and b['k'] not in ('campus', 'park') and b['h'] > 0.2 for b in FB)
assert sorted(b['k'] for b in FB) == ['cc', 'hawker', 'health', 'library', 'school', 'school', 'school'], sorted(b['k'] for b in FB)
assert classify({'shop': 'bakery'}) is None and classify({'building': 'school'}) == 'school'
assert classify({'amenity': 'school'}) == 'campus' and classify({'amenity': 'marketplace'}) == 'hawker'
# Stale OSM over the BTO site: buildings on or within 5 m of a stack centre, ground areas holding one, and the school
# buildings of a dropped campus are not drawn (plan 1 px/m, no rotation: stack px/py == world x/z)
FQ = dict(FP, plan={'pxPerM': 1, 'origin': [0, 0], 'upBearing': 0},
          stacks=[{'block': 'A', 'px': x, 'py': z} for x, z in ((50, -500), (150, -500), (250, -500), (-200, -200))])
QS, QB = features(FQ, others=[], elements=F + [way(30, {'amenity': 'library', 'building': 'yes'}, box(40, -510, 60, -490)),
                                    way(31, {'amenity': 'library', 'building': 'yes'}, box(154, -510, 174, -490)),
                                    way(32, {'amenity': 'library', 'building': 'yes'}, box(256, -510, 276, -490))])
qat = lambda x, z: [s for s in QS if abs(cen(s['p'])[0] - x) < 1 and abs(cen(s['p'])[1] - z) < 1]
assert not qat(50, -500) and not qat(164, -500) and qat(266, -500)                        # contains / 4 m / 6 m
assert not qat(-200, -200) and not qat(-240, -240) and not qat(-140, -280)                 # campus + its school buildings
assert any(abs(cen(b['p'])[0] - 266) < 1 for b in QB) and len(QS) == len(FS) - 3 + 1
# ...and over ANOTHER project's site: B sits 300 m east of FP (no stacks of its own), its stacks on FP's cc and campus
FR = {'site': {'lat': LAT0, 'lon': LON0 + 300 / (111_320.0 * math.cos(math.radians(LAT0)))},
      'plan': {'pxPerM': 1, 'origin': [0, 0], 'upBearing': 0}, 'stacks': [{'px': -180, 'py': 120}, {'px': -500, 'py': -200}]}
RS, RB = features(FP, elements=F, others=[FR])
rat = lambda x, z: [s for s in RS if abs(cen(s['p'])[0] - x) < 1 and abs(cen(s['p'])[1] - z) < 1]
assert not rat(120, 120) and not rat(-200, -200) and not rat(-240, -240) and not rat(-140, -280)   # cc, campus, its schools
assert rat(330, 330) and rat(530, -170) and len(RS) == len(FS) - 4, len(RS)
assert not any(abs(cen(b['p'])[0] - 120) < 1 for b in RB) and len(RB) == len(FB) - 3
assert feature_height({'height': '30'}, 'park') == 0.2 and feature_height({'building': 'yes'}, 'library') == 12.0
assert feature_height({}, 'library') == 0.2 and feature_height({'building': 'yes', 'height': '12 m'}, 'cc') == 12.0
assert feature_height({'building': 'yes', 'building:levels': '0'}, 'cc') == 10.0
assert feature_height({'building': 'yes', 'height': '3;4'}, 'cc') == 3.0


# Host assignment: clinic/supermarket/preschool pins -> the HDB block or mall they sit in
from tools.fetch_surround import assign_hosts
bx = lambda x0, z0, x1, z1: [[x0, z0], [x1, z0], [x1, z1], [x0, z1]]
HP = {'surround': [{'k': 'hdb', 'h': 40, 'p': bx(0, 0, 100, 100)}, {'k': 'mall', 'h': 16, 'p': bx(50, 50, 80, 80)},
                   {'k': 'park', 'h': 0.2, 'p': bx(300, 0, 400, 100)}, {'k': 'hdb', 'h': 40, 'p': bx(500, 0, 520, 20)}],
      'context': [{'h': 40, 'p': bx(-100, 0, -50, 50)}],
      'amenities': [{'cat': 'clinic', 'x': 10, 'z': 10}, {'cat': 'supermarket', 'x': -75, 'z': 25},
                    {'cat': 'preschool', 'x': 110, 'z': 50}, {'cat': 'clinic', 'x': 120, 'z': 50},
                    {'cat': 'clinic', 'x': 60, 'z': 60}, {'cat': 'park', 'x': 10, 'z': 10},
                    {'cat': 'clinic', 'x': 350, 'z': 50, 'host': {'s': 0}}, {'cat': 'clinic', 'x': 510, 'z': 10}]}
assert assign_hosts(HP) == 5
h = [a.get('host') for a in HP['amenities']]
assert h == [{'s': 0}, {'c': 0}, {'s': 0}, None, {'s': 1}, None, None, {'s': 3}], h        # smallest; <=15 m; stale cleared; park/surround-park never
assert 'host' not in HP['amenities'][3] and 'host' not in HP['amenities'][5] and 'host' not in HP['amenities'][6]
before = json.dumps(HP); assert assign_hosts(HP) == 5 and json.dumps(HP) == before         # idempotent

# every built project (committed project.json only, so this runs in CI): no blocker or ground feature contains any
# project's stack centre
from tools.fetch_surround import all_stacks, inside, GROUND
for f in sorted(Path('projects').glob('*/project.json')):
    Q = json.loads(f.read_text())
    st = all_stacks(Q)
    bad = [(b['k'], b['p'][0]) for b in Q.get('blockers', []) + [s for s in Q.get('surround', []) if s['k'] in GROUND]
           for x, z in st if inside(x, z, b['p'])]
    assert not bad, (f.parent.name, bad)
print('ok: no blocker or ground feature over any project\'s stacks')

if not Path('reference/hdb/hdb-buildings.geojson').exists():
    sys.exit(print('skipped: HDB footprints not present'))
P = json.load(open('projects/kim-keat-crest/project.json'))
S = surround(P)[0]
cen = lambda p: (sum(q[0] for q in p) / len(p), sum(q[1] for q in p) / len(p))
have = [cen(c['p']) for c in P['context']]
hdb = [s for s in S if s['k'] == 'hdb']
from tools.fetch_surround import inside
edge = max(math.hypot(*h) for h in have)
assert hdb and all(math.hypot(*cen(s['p'])) > edge for s in hdb)                         # outer ring only (curated inside)
assert not any(inside(*cen(s['p']), c['p']) for s in hdb for c in P['context'])           # never a duplicate of a neighbour
assert all(math.hypot(*cen(s['p'])) <= 1500 for s in S)
assert all(s['h'] > 0 and len(s['p']) >= 3 for s in S)
assert any(s['k'] == 'mall' and 'HDB Hub' in s.get('n', '') for s in S), [s.get('n') for s in S if s['k'] == 'mall']
# (The Poiz Centre is a point in OSM, no outline: it keeps only its pin)
# alignment: the raw footprint of an existing neighbour lands on it (same reference point as the registered context)
from tools.fetch_surround import raw_hdb
raw = raw_hdb(P, radius=1500)
import statistics as st
off = [min((math.dist(cen(r['p']), h) for r in raw)) for h in have]
assert st.median(off) < 1.0, st.median(off)                                               # same reference point as context
print('ok', {k: sum(1 for s in S if s['k'] == k) for k in ('hdb', 'mall', 'mrt')})
