"""Score land likely to become BTO -> web/future.json, and backtest the rules on the 2019 Master Plan.

usage: python3 tools/predict_future.py        (inputs: python3 tools/fetch_landuse.py)

2026 run: MP2025 parcels, all announced growth areas, MP2025 rail stations, today's buildings and HDB blocks.
2019 run: MP2019 parcels, growth areas announced by 2019, MP2019 rail stations, and buildings / HDB blocks less those
completed since 2020. Its top-ranked parcels are checked against HDB blocks finished 2022-26 and our launched BTOs.
"""
import csv, datetime as dt, gzip, json, math, re, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / 'tools'))
from fetch_context import local_xz            # noqa: E402
from fetch_surround import simplify           # noqa: E402
from geocode_resale import geo_key            # noqa: E402
from future_score import (CANDIDATE_LU, MIN_AREA_M2, Grid, PolyIndex, backtest, centroid, contains, coverage, is_candidate,  # noqa: E402
                          load_ref, outer_rings, rezoned, score)

URA, OUT = ROOT / 'reference/ura', ROOT / 'web/future.json'
PLAN = {2026: ('mp2025.geojson', 'rail2025.geojson'), 2019: ('mp2019.geojson', 'rail2019.geojson')}
NEW_SINCE, SITES_SINCE, SITE_M, NEW_BUILDING_M, PLANNED_M = 2020, 2025, 200, 90, 300
# SITES_SINCE: blocks finished 2025-26 were launched from about 2020, after the 2019 plan; earlier completions were
# mostly Tengah flats sold in 2018-19 and would credit the rules with what was already known
# NEW_BUILDING_M: a new block's address point can sit 30-60 m from its slab's centre, and its car park and pavilions
# are nearby but not in the list; 90 m clears them (87 of 93 later sites read vacant in 2019, vs 17 at 30 m)
K_LAT = 110_574


def features(name):
    return json.loads((URA / name).read_text())['features']


def block_years():
    return {geo_key(r['blk_no'], r['street']): int(r['year_completed'])
            for r in csv.DictReader(open(ROOT / 'reference/hdb/hdb-property.csv')) if r['residential'] == 'Y'}


def stations(name):
    exits = Grid([(e['lat'], e['lon'], None) for e in json.loads((ROOT / 'reference/amenities/all.json').read_text())
                  if e['cat'] == 'mrt'])
    out = []
    for f in features(name):
        p = f['properties']
        if p.get('RAIL_TYPE') != 'MRT':
            continue
        lat, lon = centroid(outer_rings(f['geometry'])[0])
        raw = (p.get('NAME') or '').strip()
        named = raw and raw != 'PENDING' and not re.fullmatch(r'[A-Z]{2}\d+', raw)      # URA placeholders: DE1, NS6
        nm = raw.title().replace(' Interchange', '') if named else None
        out.append((lat, lon, {'name': nm, 'opens': None, 'planned': not exits.near(lat, lon, PLANNED_M)}))
    return Grid(out, cell_m=2000)


def buildings(skip_near=None):
    out = []
    for e in json.loads((URA / 'osm-buildings.raw').read_text())['elements']:
        b = e.get('bounds')
        if not b:
            continue
        lat, lon = (b['minlat'] + b['maxlat']) / 2, (b['minlon'] + b['maxlon']) / 2
        if skip_near and skip_near.near(lat, lon, NEW_BUILDING_M):
            continue                          # an HDB block completed since 2020: not there in 2019
        area = (b['maxlat'] - b['minlat']) * K_LAT * (b['maxlon'] - b['minlon']) * 111_320 * math.cos(math.radians(lat))
        out.append((lat, lon, area))
    return Grid(out)


def ring_out(ring, lat0, lon0):
    pts = [local_xz(lat0, lon0, lon, lat) for lon, lat in ring[:-1]]
    k_lon = 111_320.0 * math.cos(math.radians(lat0))
    return [[round(lat0 - z / K_LAT, 5), round(lon0 + x / k_lon, 5)] for x, z in simplify(pts, 5)]


def run(as_of):
    years = block_years()
    new = {k: v for k, v in json.loads((URA / 'new-blocks.json').read_text()).items() if v}
    geo = {k: v for k, v in json.loads((ROOT / 'reference/resale/geocode.json').read_text()).items() if v}
    if as_of < NEW_SINCE:
        hdb = Grid([(*v, None) for k, v in geo.items() if years.get(k, 0) < NEW_SINCE and k not in new])
        blds = buildings(skip_near=Grid([(*v, None) for v in new.values()], cell_m=200))
    else:
        hdb = Grid([(*v, None) for v in {**geo, **new}.values()])
        blds = buildings()
    areas = [a for a in load_ref(URA / 'growth-areas.json') if a['announced'] <= as_of]
    ctx = {'asOf': as_of, 'areas': areas, 'stations': stations(PLAN[as_of][1]), 'hdb': hdb}
    projects = Grid([(p['lat'], p['lon'], p['id']) for p in json.loads((ROOT / 'projects/index.json').read_text())])
    res19 = None
    if as_of > 2019:
        res19 = PolyIndex((i, outer_rings(f['geometry'])) for i, f in enumerate(features('mp2019.geojson'))
                          if 'RESIDENTIAL' in f['properties']['LU_DESC'])
    out = []
    for f in features(PLAN[as_of][0]):
        p = f['properties']
        if p['LU_DESC'] not in CANDIDATE_LU or (p['SHAPE.AREA'] or 0) < MIN_AREA_M2:
            continue
        if as_of < NEW_SINCE and str(p['FMEL_UPD_D'])[:4] >= str(NEW_SINCE):
            continue                          # URA amended this parcel after 2019: the 2019 plan didn't have it
        rings = outer_rings(f['geometry'])
        area, (lat, lon) = p['SHAPE.AREA'], centroid(rings[0])
        reach = math.sqrt(area / math.pi) * 3
        # our projects launched from Oct 2025; in 2019 their parcels were open land the rules could pick
        holds = as_of >= NEW_SINCE and any(contains(rings, la, lo) for la, lo, _ in projects.within(lat, lon, reach))
        cover = coverage(rings, area, blds)
        if not is_candidate(p['LU_DESC'], area, cover, holds):
            continue
        rz = bool(res19) and rezoned(p['LU_DESC'], bool(res19.at(lat, lon)))
        s = score({'lat': lat, 'lon': lon, 'area': area, 'lu': p['LU_DESC'], 'gpr': p['GPR'], 'rezoned': rz}, ctx)
        out.append({'id': p['OBJECTID'], 'rings': rings, 'lat': lat, 'lon': lon, 'areaHa': round(area / 10_000, 1),
                    'lu': p['LU_DESC'], 'gpr': p['GPR'], **s})
    out.sort(key=lambda q: (-q['score'], q['mrtM']))
    if as_of >= NEW_SINCE:
        return out, {}
    return out, {**backtest(out, backtest_sites()), 'dropped': ['rezoned']}


def backtest_sites():
    """Where HDB built after the 2019 plan: blocks finished since SITES_SINCE grouped into sites, plus our BTO projects."""
    years = block_years()
    sites = []
    for k, (lat, lon) in ((k, v) for k, v in json.loads((URA / 'new-blocks.json').read_text()).items() if v):
        if years.get(k, 0) >= SITES_SINCE and not any(math.hypot(*local_xz(lat, lon, b, a)) < SITE_M for a, b in sites):
            sites.append((lat, lon))
    return sites + [(p['lat'], p['lon']) for p in json.loads((ROOT / 'projects/index.json').read_text())]


if __name__ == '__main__':
    parcels, _ = run(2026)
    _, bt = run(2019)
    doc = {'asOf': str(dt.date.today()), 'reviewed': {'growthAreas': json.loads((URA / 'growth-areas.json').read_text())['reviewed']},
           'backtest': bt,
           'parcels': [{'id': q['id'], 'name': q['name'], 'ring': ring_out(q['rings'][0], q['lat'], q['lon']), 'score': q['score'],
                        'band': q['band'], 'horizon': q['horizon'], 'reasons': q['reasons'], 'areaHa': q['areaHa'], 'lu': q['lu'],
                        'gpr': q['gpr'], 'announced': q['announced'], 'source': q['source']} for q in parcels]}
    OUT.write_text(json.dumps(doc, separators=(',', ':'), ensure_ascii=False))
    count = {}
    for q in parcels:
        count[q['band'], q['horizon']] = count.get((q['band'], q['horizon']), 0) + 1
    print(len(parcels), 'parcels', dict(sorted(count.items())))
    print('backtest', bt)
    print(f'{OUT.name}: {len(gzip.compress(OUT.read_bytes(), 6)) // 1024} KB gzipped')
