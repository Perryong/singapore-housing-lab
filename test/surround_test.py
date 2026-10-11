# Simple 3D surroundings: malls, MRT/LRT station buildings and outer-ring HDB blocks (tools/fetch_surround.py).
import json, math, sys
from pathlib import Path
from tools.fetch_surround import simplify, surround

sq = [[0, 0], [5, 0], [10, 0], [10, 0.1], [10, 10], [5, 10.05], [0, 10]]           # square with near-collinear extras
assert simplify(sq) == [[0, 0], [10, 0], [10, 10], [0, 10]], simplify(sq)

if not Path('reference/hdb/hdb-buildings.geojson').exists():
    sys.exit(print('skipped: HDB footprints not present'))
P = json.load(open('projects/kim-keat-crest/project.json'))
S = surround(P)
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
