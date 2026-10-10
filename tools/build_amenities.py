"""Normalise government open-data amenity layers into reference/amenities/all.json.

usage: python3 tools/build_amenities.py
Sources (data.gov.sg, downloaded to reference/amenities/*.raw): LTA MRT station exits, LTA bus stops, NEA hawker
centres, MOH CHAS clinics, polyclinics, ECDA pre-schools, NParks parks, NLB libraries, PA community clubs,
MOE school list and SFA supermarket licences (the last two by postal code, geocoded with OneMap; cached).
"""
import csv, json, re, subprocess, time
from pathlib import Path

A = Path(__file__).resolve().parent.parent / 'reference' / 'amenities'
CACHE = A / 'postal-cache.json'
cache = json.loads(CACHE.read_text()) if CACHE.exists() else {}


def attrs(p):
    d = p.get('Description')
    return dict(re.findall(r'<th>([^<]+)</th>\s*<td>([^<]*)</td>', d)) if d else p


def pts(name):
    for f in json.loads((A / f'{name}.raw').read_text())['features']:
        lon, lat = f['geometry']['coordinates'][:2]
        yield attrs(f['properties']), lat, lon


def title(s):
    s = re.sub(r"'([A-Z])\b", lambda m: "'" + m.group(1).lower(), ' '.join(s.split()).title())   # St Andrew's, not Andrew'S
    return re.sub(r'\b(Mrt|Lrt|Cc|Pte|Ltd|Sg|Chas|Ntuc)\b', lambda m: m.group(0).upper(), s)


SECTORS = set(json.loads((A / 'sectors.json').read_text())) if (A / 'sectors.json').exists() else None


def geocode(postal):
    # ponytail: only postal sectors near a catalogued site are geocoded (OneMap throttles hard); regenerate
    # sectors.json when adding projects in new areas
    if SECTORS is not None and postal[:2] not in SECTORS and postal not in cache:
        return None
    if postal not in cache:
        for t in range(6):
            time.sleep(1.2 + 10 * t)
            try:
                out = subprocess.run(['curl', '-sf', '--max-time', '20',
                                      f'https://www.onemap.gov.sg/api/common/elastic/search?searchVal={postal}&returnGeom=Y&getAddrDetails=Y&pageNum=1'],
                                     capture_output=True, check=True).stdout
                r = json.loads(out).get('results', [])
                cache[postal] = [float(r[0]['LATITUDE']), float(r[0]['LONGITUDE'])] if r else None
                break
            except Exception:
                continue
        CACHE.write_text(json.dumps(cache))
    return cache.get(postal)


out = []
add = lambda cat, name, lat, lon, **kw: out.append({'cat': cat, 'name': name, 'lat': round(lat, 6), 'lon': round(lon, 6), **kw})

stations = {}
for p, lat, lon in pts('mrt'):        # one entry per exit; the app keeps the nearest exit per station
    n = title(p['STATION_NA'])
    add('mrt' if 'MRT' in n else 'lrt', n, lat, lon, exit=p.get('EXIT_CODE', ''))
for p, lat, lon in pts('bus'):
    add('bus', f"Bus stop {p['BUS_STOP_NUM']}", lat, lon)
for p, lat, lon in pts('hawker'):
    add('hawker', title(p.get('NAME') or p.get('ADDRESSBUILDINGNAME') or 'Hawker centre'), lat, lon)
for p, lat, lon in pts('clinic'):
    add('clinic', title(p['HCI_NAME']), lat, lon)
for p, lat, lon in pts('polyclinic'):
    add('polyclinic', p['NAME'], lat, lon)
for p, lat, lon in pts('preschool'):
    add('preschool', title(p['CENTRE_NAME']), lat, lon)
for p, lat, lon in pts('park'):
    n = p['NAME']
    if not re.search(r'\bPG\b|PLAYGROUND', n):                     # playgrounds are their own small points
        add('park', title(n), lat, lon)
for p, lat, lon in pts('library'):
    add('library', p['NAME'], lat, lon)
for p, lat, lon in pts('cc'):
    add('cc', p['NAME'], lat, lon)

for r in csv.DictReader(open(A / 'schools.raw')):
    lvl = r['mainlevel_code']
    cat = 'primary' if lvl.startswith('PRIMARY') or 'P1' in lvl else 'secondary' if 'S1' in lvl else None
    g = cat and geocode(r['postal_code'].zfill(6))
    if g:
        add(cat, title(r['school_name']), *g)
seen = set()
for r in csv.DictReader(open(A / 'supermarkets.raw')):
    pc = r['postal_code'].zfill(6)
    if pc in seen:
        continue
    seen.add(pc)
    g = geocode(pc)
    if g:
        brand = re.sub(r'\b(Pte|Ltd|Singapore|\(.*?\)|Supermarket|Supermarkets)\b.*', '', r['licensee_name'], flags=re.I).strip(' ,.')
        add('supermarket', title(brand or r['licensee_name']), *g)

# OpenStreetMap (© OpenStreetMap contributors, ODbL) via Overpass, saved as mall.raw / stations.raw:
#   nwr["shop"="mall"](1.15,103.6,1.48,104.1);out center tags;   nwr["railway"="station"]["ref"](...);out center tags;
osm = lambda f: json.loads((A / f).read_text())['elements'] if (A / f).exists() else []
for e in osm('mall.raw'):
    t, c = e.get('tags', {}), e.get('center') or e
    my = t.get('addr:country') == 'MY' or re.search(r'johor', ' '.join(t.values()), re.I) or c['lat'] > 1.452
    if t.get('name') and not my:                                 # bbox reaches into Johor Bahru
        add('mall', t['name'], c['lat'], c['lon'])
codes = {re.sub(r'\s+(MRT|LRT)\b.*', '', t['name'], flags=re.I).lower(): t['ref'].replace(';', ' ')
         for t in (e.get('tags', {}) for e in osm('stations.raw')) if t.get('name') and t.get('ref')}
for o in out:
    if o['cat'] in ('mrt', 'lrt'):
        o['lines'] = codes.get(re.sub(r'\s+(MRT|LRT)\b.*', '', o['name'], flags=re.I).lower(), '')
(A / 'all.json').write_text(json.dumps(out, separators=(',', ':')))
from collections import Counter
print(len(out), dict(Counter(o['cat'] for o in out)))
