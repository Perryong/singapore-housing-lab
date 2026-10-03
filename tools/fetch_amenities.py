"""Nearby amenities for each project -> project.json["amenities"] (straight-line distance from the site centre).

usage: python3 tools/fetch_amenities.py projects/<id> [...]    (needs reference/amenities/all.json)
"""
import json, math, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / 'tools'))
from fetch_context import local_xz   # noqa: E402

ALL = json.loads((ROOT / 'reference/amenities/all.json').read_text())
# category: (search radius m, how many to keep)
RULES = {'mrt': (1500, 3), 'lrt': (1000, 2), 'bus': (400, 4), 'primary': (2000, 6), 'secondary': (2000, 3),
         'preschool': (800, 5), 'hawker': (1500, 3), 'supermarket': (1000, 3), 'clinic': (800, 3),
         'polyclinic': (3000, 1), 'park': (1000, 3), 'library': (3000, 1), 'cc': (1500, 1)}

for d in sys.argv[1:]:
    f = Path(d) / 'project.json'
    P = json.loads(f.read_text())
    lat0, lon0 = P['site']['lat'], P['site']['lon']
    best = {}
    for a in ALL:
        if a['cat'] not in RULES:
            continue
        x, z = local_xz(lat0, lon0, a['lon'], a['lat'])
        dist = math.hypot(x, z)
        if dist > RULES[a['cat']][0]:
            continue
        key = (a['cat'], a['name'])                     # MRT: one entry per station (nearest exit)
        if key not in best or dist < best[key]['d']:
            best[key] = {'cat': a['cat'], 'name': a['name'], 'x': round(x, 1), 'z': round(z, 1), 'd': round(dist)}
    out = []
    for cat, (_, k) in RULES.items():
        out += sorted((v for v in best.values() if v['cat'] == cat), key=lambda v: v['d'])[:k]
    P['amenities'] = out
    f.write_text(json.dumps(P, separators=(',', ':')))
    near = {c: min((a['d'] for a in out if a['cat'] == c), default=None) for c in ('mrt', 'primary', 'hawker')}
    print(f"{Path(d).name}: {len(out)} amenities; nearest {near}")
