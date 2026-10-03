"""Georeference a project from existing HDB blocks whose numbers are printed on its site plan.

usage: python3 tools/anchor_fit.py projects/<id> 269:298,964 265:824,1450 [...]
       (block number : plan-crop pixel of its label, which sits inside the block's outline)

Each label is matched to the nearest HDB open-data footprint with that block number within 1.5 km of the site;
the mean offset between label positions and footprint centroids shifts `context` (and the site lat/lon).
Run tools/register_context.py --range 25 --apply afterwards to snap the fit onto the drawn outlines.
"""
import json, math, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / 'tools'))
from fetch_context import local_xz   # noqa: E402

D = Path(sys.argv[1])
P = json.loads((D / 'project.json').read_text())
pl = P['plan']; PX = pl['pxPerM']; ox, oy = pl['origin']; b = math.radians(pl['upBearing'])
lat0, lon0 = P['site']['lat'], P['site']['lon']


def p2w(px, py):
    lx, lz = (px - ox) / PX, (py - oy) / PX
    return lx * math.cos(b) - lz * math.sin(b), lx * math.sin(b) + lz * math.cos(b)


feats = json.loads((ROOT / 'reference/hdb/hdb-buildings.geojson').read_text())['features']
offsets = []
for arg in sys.argv[2:]:
    blk, xy = arg.split(':')
    px, py = map(float, xy.split(','))
    wx, wz = p2w(px, py)
    cands = []
    for f in feats:
        if f['properties']['BLK_NO'].upper() != blk.upper():
            continue
        g = f['geometry']
        ring = g['coordinates'][0] if g['type'] == 'Polygon' else max((q[0] for q in g['coordinates']), key=len)
        cx, cz = (sum(v) / len(ring) for v in zip(*[local_xz(lat0, lon0, lon, lat) for lon, lat in ring]))
        if math.hypot(cx, cz) < 1500:
            cands.append((math.hypot(cx - wx, cz - wz), cx, cz, f['properties']['POSTAL_COD']))
    if not cands:
        print(f'  {blk}: not found near site'); continue
    d, cx, cz, postal = min(cands)
    offsets.append((wx - cx, wz - cz))
    print(f'  {blk} ({postal}): label ({wx:.0f},{wz:.0f}) footprint ({cx:.0f},{cz:.0f}) offset {d:.0f} m')

sx = sum(o[0] for o in offsets) / len(offsets); sz = sum(o[1] for o in offsets) / len(offsets)
spread = max(math.hypot(o[0] - sx, o[1] - sz) for o in offsets)
print(f'{D.name}: shift ({sx:+.1f}, {sz:+.1f}) m, anchor spread {spread:.0f} m')
P['context'] = [{**c, 'p': [[round(x + sx, 1), round(z + sz, 1)] for x, z in c['p']]} for c in P['context']]
P['site']['lat'] = round(lat0 + sz / 110_574.0, 7)
P['site']['lon'] = round(lon0 - sx / (111_320.0 * math.cos(math.radians(lat0))), 7)
P['contextSite'] = [P['site']['lat'], P['site']['lon']]
P['georef'] = f'{len(offsets)} block labels on the site plan'
(D / 'project.json').write_text(json.dumps(P, separators=(',', ':')))
