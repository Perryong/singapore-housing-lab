"""Drop context footprints that overlap the project's own traced stacks (demolished / redeveloped blocks).

usage: python3 tools/drop_overlaps.py projects/<id> [...]
"""
import json, sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / 'web'))
import math


def inside(x, z, poly):
    c = False
    for (x1, z1), (x2, z2) in zip(poly, poly[1:] + poly[:1]):
        if (z1 > z) != (z2 > z) and x < (x2 - x1) * (z - z1) / (z2 - z1) + x1:
            c = not c
    return c


for d in sys.argv[1:]:
    f = Path(d) / 'project.json'; P = json.loads(f.read_text())
    pl = P['plan']; PX = pl['pxPerM']; ox, oy = pl['origin']; b = math.radians(pl['upBearing'])
    pts = []
    for s in P['stacks']:
        lx, lz = (s['px'] - ox) / PX, (s['py'] - oy) / PX
        pts.append((lx * math.cos(b) - lz * math.sin(b), lx * math.sin(b) + lz * math.cos(b)))
    keep = [c for c in P['context'] if not any(inside(x, z, c['p']) for x, z in pts)]
    if len(keep) != len(P['context']):
        print(f"{Path(d).name}: dropped {len(P['context']) - len(keep)} footprint(s) under the new blocks")
        P['context'] = keep; f.write_text(json.dumps(P, separators=(',', ':')))
