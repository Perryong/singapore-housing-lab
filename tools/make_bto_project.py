"""Assemble projects/<slug>/project.json for an HDB BTO project.

usage: python3 tools/make_bto_project.py <slug>

Inputs: reference/hdb/launched.json (catalogue entry), projects/<slug>/project.json as written by
trace_siteplan.py (plan, blocks, stacks), OneMap (block addresses -> georeference), fetch_context.py.

Georeference: the plan's scale and north come from the sheet; its position comes from OneMap block
addresses when HDB has published them (plan block centroid <-> address coordinates, averaged), else from
the catalogue's map pin placed at the centroid of the traced stacks (good to a few tens of metres).
"""
import json, math, subprocess, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / 'tools'))
from fetch_context import fetch, local_xz   # noqa: E402

slug = sys.argv[1]
DIR = ROOT / 'projects' / slug
cat = {p['slug']: p for p in json.loads((ROOT / 'reference/hdb/launched.json').read_text())}[slug]
P = json.loads((DIR / 'project.json').read_text())

LAUNCH = {'oct-2025-bto': 'Oct 2025', 'feb-2026-bto': 'Feb 2026', 'jun-2026-bto': 'Jun 2026'}
CATEGORIES = {   # HDB brochure colours, typical internal floor areas (sqm, sq ft)
    '2RF': {'name': '2-room Flexi', 'col': '#F2A07B', 'size': [42, 452]},
    '3RM': {'name': '3-room', 'col': '#9FCB72', 'size': [66, 710]},
    '4RM': {'name': '4-room', 'col': '#EFE05A', 'size': [90, 969]},
    '5RM': {'name': '5-room', 'col': '#7FA9D9', 'size': [110, 1184]},
    '3GEN': {'name': '3Gen', 'col': '#B48AD0', 'size': [115, 1238]},
    'CCA': {'name': 'Community Care Apartment', 'col': '#E59AB8', 'size': [36, 388]},
    'RENT': {'name': 'Rental (not for sale)', 'col': '#E8D6AE', 'size': [36, 388]},
}
SIZE_OVERRIDES = {'2RF1': [38, 409], '2RF2': [46, 495]}

used = {s['type'] for s in P['stacks']}
P.update({
    'id': slug, 'name': cat['name'], 'kind': 'bto', 'status': 'launched', 'launch': LAUNCH[cat['launch']],
    'town': P.get('town') or cat.get('town', ''), 'classification': cat['type'], 'address': cat['address'],
    'units': cat['units'],
    'tagline': f"{cat['type']} BTO · {LAUNCH[cat['launch']]} launch · {cat['address']}",
    'site': {'lat': cat['lat'], 'lon': cat['lon'], 'tz': 8, 'floorHeight': 2.8},
    'categories': {k: v for k, v in CATEGORIES.items() if any(u.startswith(k) for u in used)},
    'sizeOverrides': {k: v for k, v in SIZE_OVERRIDES.items() if k in used},
    'notes': ("Blocks and unit stacks are traced from HDB's published site plan, oriented with its north arrow and "
              "scaled to its scale bar; each stack's window directions are the sides of the unit that face open "
              "ground on the plan (corner units get two). Grey blocks are existing HDB flats within 900 m from "
              "data.gov.sg. Shading counts them and the new blocks, not private buildings, trees or terrain. "
              "Storeys follow HDB's block table; stepped blocks use the tallest part unless noted. Check HDB's "
              "sales brochure before choosing a unit."),
})


def plan_xy_to_world(px, py):
    pl = P['plan']
    lx, lz = (px - pl['origin'][0]) / pl['pxPerM'], (py - pl['origin'][1]) / pl['pxPerM']
    c, s = math.cos(math.radians(pl['upBearing'])), math.sin(math.radians(pl['upBearing']))
    return lx * c - lz * s, lx * s + lz * c


# origin at the traced stacks' centroid so the map pin lands mid-site
P['plan']['origin'] = [sum(s['px'] for s in P['stacks']) / len(P['stacks']),
                       sum(s['py'] for s in P['stacks']) / len(P['stacks'])]

# georeference from OneMap block addresses if HDB has published them
q = cat['name'].replace('@', ' ').replace(' ', '%20')
try:
    res = json.loads(subprocess.run(['curl', '-sf', '--max-time', '20',
                                     f'https://www.onemap.gov.sg/api/common/elastic/search?searchVal={q}&returnGeom=Y&getAddrDetails=Y&pageNum=1'],
                                    capture_output=True, check=True).stdout).get('results', [])
except Exception:
    res = []
pairs = []
for r in res:
    blk = r['BLK_NO']
    ss = [s for s in P['stacks'] if s['block'] == blk]
    if ss and cat['name'].upper().replace('@ ', '') in r['ADDRESS'].replace('@ ', ''):
        wx, wz = plan_xy_to_world(sum(s['px'] for s in ss) / len(ss), sum(s['py'] for s in ss) / len(ss))
        pairs.append((wx, wz, float(r['LATITUDE']), float(r['LONGITUDE'])))
# existing HDB blocks drawn on the plan: exact footprint centroids from HDB open data (by postal code)
if P.get('anchors'):
    feats = {f['properties']['POSTAL_COD']: f for f in
             json.loads((ROOT / 'reference/hdb/hdb-buildings.geojson').read_text())['features']}
    for a in P['anchors']:
        f = feats.get(a['postal'])
        if not f:
            print('  anchor postal not found:', a['postal'])
            continue
        g = f['geometry']
        ring = g['coordinates'][0] if g['type'] == 'Polygon' else max((q[0] for q in g['coordinates']), key=len)
        lon, lat = sum(q[0] for q in ring) / len(ring), sum(q[1] for q in ring) / len(ring)
        wx, wz = plan_xy_to_world(*a['px'])
        pairs.append((wx, wz, lat, lon))
if pairs:
    # pick lat0/lon0 so that each block's address lands on its traced position (mean over blocks)
    lat0 = sum(la + wz / 110_574.0 for _, wz, la, _ in pairs) / len(pairs)
    lon0 = sum(lo - wx / (111_320.0 * math.cos(math.radians(la))) for wx, _, la, lo in pairs) / len(pairs)
    P['site'].update(lat=round(lat0, 7), lon=round(lon0, 7))
    P['georef'] = f'{len(pairs)} reference points (OneMap block addresses / HDB footprints on the plan)'
    spread = [math.hypot((la - lat0) * 110_574 + wz, (lo - lon0) * 111_320 * math.cos(math.radians(la)) - wx)
              for wx, wz, la, lo in pairs]
    print(f'  georef residuals (m): {[round(x) for x in spread]}')
else:
    P['georef'] = 'map pin at site centroid (approximate)'

# context is slow to fetch (OneMap rate limit): keep it when the site barely moved; --refetch forces it
prev = P.get('contextSite')
if '--refetch' in sys.argv or not P.get('context') or not prev or \
        math.hypot((prev[0] - P['site']['lat']) * 110_574, (prev[1] - P['site']['lon']) * 111_320) > 30:
    P['context'] = fetch(P['site']['lat'], P['site']['lon'])
    P['contextSite'] = [P['site']['lat'], P['site']['lon']]
(DIR / 'project.json').write_text(json.dumps(P, separators=(',', ':')))
print(f"{slug}: {len(P['stacks'])} stacks, {len(P['blocks'])} blocks, {len(P['context'])} context, georef: {P['georef']}")
