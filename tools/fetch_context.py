"""Neighbouring HDB blocks around a site, from data.gov.sg open data.

usage: python3 tools/fetch_context.py <lat> <lon> [radius_m]  -> JSON list [{h, p:[[x,z]...], blk, street}] on stdout

Footprints: "HDB Existing Building" (BLK_NO, POSTAL_COD); storeys: "HDB Property Information"
(blk_no, street, max_floor_lvl). They share no key, so postal code -> road name comes from OneMap search
(cached in reference/hdb/onemap-cache.json). World axes match the app: +x east, -z north, metres.
"""
import csv, json, math, subprocess, sys, time
from pathlib import Path

REF = Path(__file__).resolve().parent.parent / 'reference' / 'hdb'
CACHE = REF / 'onemap-cache.json'
STOREY_M = 2.8      # HDB floor-to-floor
ROOF_M = 3.0
ABBR = {'ROAD': 'RD', 'STREET': 'ST', 'AVENUE': 'AVE', 'DRIVE': 'DR', 'CRESCENT': 'CRES', 'CENTRAL': 'CTRL',
        'NORTH': 'NTH', 'SOUTH': 'STH', 'UPPER': 'UPP', 'LORONG': 'LOR', 'JALAN': 'JLN', 'BUKIT': 'BT',
        'TANJONG': 'TG', 'KAMPONG': 'KG', 'PLACE': 'PL', 'CLOSE': 'CL', 'TERRACE': 'TER', 'HEIGHTS': 'HTS',
        'GARDENS': 'GDNS', 'PARK': 'PK', 'COMMONWEALTH': "C'WEALTH", 'MARKET': 'MKT', 'SAINT': 'ST.',
        'NORTHEAST': 'NE', 'INDUSTRIAL': 'IND', 'EAST': 'EAST', 'WEST': 'WEST', 'LINK': 'LINK', 'WALK': 'WALK'}


def norm(street):
    return ' '.join(ABBR.get(w, w) for w in street.upper().replace(',', ' ').split())


def onemap_road(postal, cache):
    if postal not in cache:
        url = f'https://www.onemap.gov.sg/api/common/elastic/search?searchVal={postal}&returnGeom=N&getAddrDetails=Y&pageNum=1'
        for attempt in range(6):
            time.sleep(0.6 + 4 * attempt)   # OneMap rate-limits bursts with HTTP 429; back off and retry
            try:
                # curl, not urllib: python.org builds on macOS ship without the system CA store
                out = subprocess.run(['curl', '-sf', '--max-time', '20', url], capture_output=True, check=True).stdout
                res = json.loads(out).get('results', [])
                break
            except Exception:
                continue
        else:
            return None
        cache[postal] = res[0]['ROAD_NAME'] if res else ''
    return cache[postal] or None


def local_xz(lat0, lon0, lon, lat):
    k = 111_320.0
    return ((lon - lon0) * k * math.cos(math.radians(lat0)), -(lat - lat0) * 110_574.0)


def fetch(lat0, lon0, radius=900):
    feats = json.load(open(REF / 'hdb-buildings.geojson'))['features']
    floors = {}
    for r in csv.DictReader(open(REF / 'hdb-property.csv')):
        if r['residential'] == 'Y' or r['multistorey_carpark'] == 'Y':
            floors[(r['blk_no'].upper(), norm(r['street']))] = int(r['max_floor_lvl'])
    cache = json.loads(CACHE.read_text()) if CACHE.exists() else {}
    out, misses = [], 0
    for f in feats:
        g = f['geometry']
        ring = g['coordinates'][0] if g['type'] == 'Polygon' else max((p[0] for p in g['coordinates']), key=len)
        pts = [local_xz(lat0, lon0, lon, lat) for lon, lat in ring]
        cx, cz = sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts)
        if math.hypot(cx, cz) > radius:
            continue
        p = f['properties']
        road = onemap_road(p['POSTAL_COD'], cache) if p.get('POSTAL_COD') else None
        n = floors.get((p['BLK_NO'].upper(), norm(road))) if road else None
        if n is None:
            misses += 1
            n = 12   # ponytail: typical HDB height when the join fails; flagged via 'est'
        out.append({'h': round(n * STOREY_M + ROOF_M, 1), 'p': [[round(x, 1), round(z, 1)] for x, z in pts],
                    'blk': p['BLK_NO'], 'street': road or '', **({'est': True} if n == 12 and road is None else {})})
    CACHE.write_text(json.dumps(cache))
    print(f'{len(out)} blocks within {radius} m, {misses} without storey data', file=sys.stderr)
    return out


if __name__ == '__main__':
    lat, lon = float(sys.argv[1]), float(sys.argv[2])
    json.dump(fetch(lat, lon, float(sys.argv[3]) if len(sys.argv) > 3 else 900), sys.stdout, separators=(',', ':'))
