"""LTA DataMall bus data -> reference/transit/<Dataset>.json (plain lists of API rows). Prints row counts only.

usage: LTA_KEY=... python3 tools/fetch_transit.py     (or put LTA_KEY=... in .env at the repo root)
       python3 tools/fetch_transit.py --osm            (only OSM bus/rail route relations; no LTA key needed)
"""
import http.client, json, math, os, ssl, sys, time, urllib.error, urllib.parse, urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BASE = 'https://datamall2.mytransport.sg/ltaodataservice/'
DATASETS = ['BusStops', 'BusRoutes', 'BusServices']
BBOX = '1.15,103.6,1.48,104.1'
OSM_QUERIES = {
    'osm_bus': '["route"="bus"]',
    'osm_rail': '["route"~"^(subway|light_rail|train)$"]',
}
OVERPASS = ('https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter')
# python.org builds on macOS ship without CA certificates; fall back to the system bundle there
_CA = os.environ.get('SSL_CERT_FILE') or ('/etc/ssl/cert.pem' if Path('/etc/ssl/cert.pem').exists() else None)
CTX = ssl.create_default_context(cafile=_CA)


def headway(band):
    """LTA frequency band in minutes ('06-09' -> 7.5, '10' -> 10.0); '-' or empty means no service -> None."""
    if not band or band == '-':
        return None
    lo, _, hi = band.partition('-')
    return (float(lo) + float(hi or lo)) / 2


def lta_key():
    if os.environ.get('LTA_KEY'):
        return os.environ['LTA_KEY']
    env = ROOT / '.env'
    if env.exists():
        for line in env.read_text().splitlines():
            line = line.strip().removeprefix('export ')
            if line.startswith('LTA_KEY='):
                return line.split('=', 1)[1].strip().strip('\'"')
    raise SystemExit('set LTA_KEY (see .env)')


def fetch_all(dataset, key):
    rows, skip = [], 0
    while True:
        req = urllib.request.Request(f'{BASE}{dataset}?$skip={skip}', headers={'AccountKey': key, 'accept': 'application/json'})
        try:
            with urllib.request.urlopen(req, timeout=60, context=CTX) as r:
                page = json.load(r)['value']
        except urllib.error.HTTPError as e:
            hint = ' (LTA rejected the key: check LTA_KEY in .env)' if e.code in (401, 403) else ''
            raise SystemExit(f'{dataset}: HTTP {e.code}{hint}')
        if not page:
            return rows
        rows += page
        skip += 500


def chain(ways):
    """Join way polylines (lists of (lat, lon)) into one path, reversing ways as needed. Starts at the first way's
    end that is farther from the second way. shortcut: a gap between ways is joined by a straight line whatever its
    size, upgrade if OSM relations with real gaps (> 50 m) show visible cuts."""
    ways = [list(w) for w in ways if w]
    if not ways:
        return []
    path = ways.pop(0)
    if ways:
        nxt = ways[0]
        near = lambda p: min(math.dist(p, nxt[0]), math.dist(p, nxt[-1]))
        if near(path[0]) < near(path[-1]):
            path.reverse()
    for w in ways:
        if math.dist(path[-1], w[-1]) < math.dist(path[-1], w[0]):
            w.reverse()
        path += w[1:] if w[0] == path[-1] else w
    return path


def fetch_osm():
    out = ROOT / 'reference/transit'
    out.mkdir(parents=True, exist_ok=True)
    for name, flt in OSM_QUERIES.items():
        q = f'[out:json][timeout:170];rel({BBOX})["type"="route"]{flt};out geom;'
        data = None
        for t in range(6):                                  # public Overpass servers are often busy: retry, alternate
            req = urllib.request.Request(OVERPASS[t % 2], data=urllib.parse.urlencode({'data': q}).encode(),
                                         headers={'User-Agent': 'BTOlab/1.0 (personal project)'})
            try:
                with urllib.request.urlopen(req, timeout=200, context=CTX) as r:
                    data = json.load(r)
                break
            except (OSError, http.client.HTTPException, ValueError):   # URLError/timeouts/resets are OSError
                if t < 5:
                    time.sleep(5)
        if data is None:
            raise SystemExit(f'{name}: Overpass unavailable; try again later')
        (out / f'{name}.json').write_text(json.dumps(data, separators=(',', ':')))
        print(f'{name}: {len(data["elements"])} relations')


if __name__ == '__main__':
    if '--osm' in sys.argv:
        fetch_osm(); sys.exit()
    key = lta_key()
    out = ROOT / 'reference/transit'
    out.mkdir(parents=True, exist_ok=True)
    for ds in DATASETS:
        rows = fetch_all(ds, key)
        (out / f'{ds}.json').write_text(json.dumps(rows, separators=(',', ':')))
        print(f'{ds}: {len(rows)} rows')
    print('fetching OSM…')
    fetch_osm()
