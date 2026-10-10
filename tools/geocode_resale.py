"""Coordinates for every HDB block in the resale data -> reference/resale/geocode.json (git-ignored, resumable).

usage: python3 tools/geocode_resale.py

Key: geo_key(block, street) = "<BLOCK>|<norm(street)>", value [lat, lon] or null (not found; never guessed).
First pass: OpenStreetMap buildings with addr:housenumber + addr:street (one Overpass query; skipped if it fails).
Rest: OneMap search "<block> <street>", first result whose BLK_NO is the block; 1.2 s apart, backoff on throttling.
"""
import csv, json, subprocess, sys, time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / 'tools'))
from fetch_context import norm   # noqa: E402

CSV, OUT = ROOT / 'reference/resale/resale.csv', ROOT / 'reference/resale/geocode.json'


def geo_key(block, street):
    return f'{block.strip().upper()}|{norm(street)}'


def curl(*args):
    return subprocess.run(['curl', '-sf', '--max-time', '180', '-A', 'BTOlab/1.0 (personal project)', *args],
                          capture_output=True, text=True).stdout


def osm_pass(want, geo):
    q = '[out:json][timeout:170];nwr["addr:housenumber"]["addr:street"](1.2,103.6,1.47,104.05);out center tags;'
    try:
        els = json.loads(curl('https://overpass-api.de/api/interpreter', '--data-urlencode', f'data={q}'))['elements']
    except Exception:
        print('  OSM pass skipped (Overpass unavailable)'); return
    n = 0
    for e in els:
        t, c = e['tags'], e.get('center') or e
        k = geo_key(t['addr:housenumber'], t['addr:street'])
        if k in want and not geo.get(k) and 'lat' in c:
            geo[k] = [round(c['lat'], 6), round(c['lon'], 6)]; n += 1
    print(f'  OSM: {n} blocks')


def onemap(block, street):
    for t in range(6):
        time.sleep(1.2 + 10 * t)
        try:
            r = json.loads(curl(f'https://www.onemap.gov.sg/api/common/elastic/search?searchVal={block}%20{street.replace(" ", "%20")}'
                                '&returnGeom=Y&getAddrDetails=Y&pageNum=1')).get('results', [])
        except Exception:
            continue                                              # throttled or empty reply: back off and retry
        hit = next((x for x in r if x.get('BLK_NO', '').upper() == block.strip().upper()), None)
        return [round(float(hit['LATITUDE']), 6), round(float(hit['LONGITUDE']), 6)] if hit else None
    return False                                                  # gave up: leave unset so a later run retries


if __name__ == '__main__':
    pairs = {geo_key(r['block'], r['street_name']): (r['block'], r['street_name']) for r in csv.DictReader(open(CSV))}
    geo = json.loads(OUT.read_text()) if OUT.exists() else {}
    if not any(geo.values()):
        osm_pass(pairs, geo); OUT.write_text(json.dumps(geo))
    todo = [k for k in pairs if k not in geo]
    print(f'{len(pairs)} blocks, {len(pairs) - len(todo)} done, {len(todo)} to look up')
    for i, k in enumerate(todo, 1):
        v = onemap(*pairs[k])
        if v is not False:
            geo[k] = v
        if i % 50 == 0 or i == len(todo):
            OUT.write_text(json.dumps(geo))
            print(f'  {i}/{len(todo)}', flush=True)
    found = sum(1 for k in pairs if geo.get(k))
    print(f'resolved {found}/{len(pairs)}; not found {sum(1 for k in pairs if k in geo and geo[k] is None)}')
