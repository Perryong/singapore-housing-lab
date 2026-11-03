"""Inputs for the future BTO map -> reference/ura/ (git-ignored; re-run to rebuild).

usage: python3 tools/fetch_landuse.py [--refresh]

URA Master Plan land use and rail stations, 2025 (amended) and 2019, from data.gov.sg; every OSM building's bounding
box (one Overpass query); locations of HDB blocks completed in 2020 or later (reference/hdb/hdb-property.csv), from
reference/resale/geocode.json or OneMap search (resumable, ~1.2 s per lookup).
"""
import collections, csv, json, subprocess, sys, time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / 'tools'))
from fetch_surround import overpass             # noqa: E402
from geocode_resale import geo_key, onemap      # noqa: E402

URA = ROOT / 'reference/ura'
DATASETS = {'mp2025.geojson': 'd_7a03324bed531cdff76a16239b0e84e1',     # Amendment to Master Plan 2025 Land Use Layer
            'mp2019.geojson': 'd_90d86daa5bfaa371668b84fa5f01424f',     # Master Plan 2019 Land Use layer
            'rail2025.geojson': 'd_6f5107a8cf6c9a32439cffbfa9013423',   # Amendment to Master Plan 2025 Rail Station Layer
            'rail2019.geojson': 'd_8d886e3a83934d7447acdf5bc6959999'}   # Master Plan 2019 Rail Station layer
NEW_BLOCKS, NEW_SINCE = URA / 'new-blocks.json', 2020


def download(name, dataset, refresh):
    out = URA / name
    if out.exists() and not refresh:
        return
    for t in range(6):
        time.sleep(6 * t)
        r = subprocess.run(['curl', '-s', f'https://api-open.data.gov.sg/v1/public/api/datasets/{dataset}/poll-download'],
                           capture_output=True, text=True).stdout
        try:
            url = json.loads(r)['data']['url']
            break
        except Exception:
            continue
    else:
        raise SystemExit(f'{name}: data.gov.sg download link unavailable (rate limited?) — try again later')
    subprocess.run(['curl', '-sfL', '-o', str(out), url], check=True)
    print(f'{name}: {out.stat().st_size // 1_000_000} MB')


def buildings(refresh):
    path = URA / 'osm-buildings.raw'
    if refresh:
        path.unlink(missing_ok=True)
    # shortcut: bounding boxes, not outlines, keep the island-wide query small; they overstate rotated footprints,
    # so a parcel reads a little more built than it is. Fetch `out geom` if vacant parcels go missing.
    return overpass(path, '[out:json][timeout:170];way["building"](1.2,103.6,1.47,104.05);out bb qt;')


def new_blocks():
    want = {geo_key(r['blk_no'], r['street']): (r['blk_no'], r['street'])
            for r in csv.DictReader(open(ROOT / 'reference/hdb/hdb-property.csv'))
            if r['residential'] == 'Y' and int(r['year_completed']) >= NEW_SINCE}
    known = json.loads((ROOT / 'reference/resale/geocode.json').read_text())
    geo = json.loads(NEW_BLOCKS.read_text()) if NEW_BLOCKS.exists() else {}
    for k in want:
        if k not in geo and known.get(k):
            geo[k] = known[k]
    todo = [k for k in want if k not in geo]
    print(f'{len(want)} HDB blocks completed since {NEW_SINCE}, {len(todo)} to look up on OneMap')
    for i, k in enumerate(todo, 1):
        v = onemap(*want[k])
        if v is not False:
            geo[k] = v
        if i % 50 == 0 or i == len(todo):
            NEW_BLOCKS.write_text(json.dumps(geo))
            print(f'  {i}/{len(todo)}', flush=True)
    NEW_BLOCKS.write_text(json.dumps(geo))
    found = sum(1 for k in want if geo.get(k))
    print(f'new-blocks.json: {found}/{len(want)} located')


if __name__ == '__main__':
    refresh = '--refresh' in sys.argv
    URA.mkdir(parents=True, exist_ok=True)
    for name, dataset in DATASETS.items():
        download(name, dataset, refresh)
    lu = collections.Counter(f['properties']['LU_DESC'] for f in json.loads((URA / 'mp2025.geojson').read_text())['features'])
    print('MP2025 land use:', ', '.join(f'{k} {n}' for k, n in lu.most_common()))
    print(f'osm-buildings.raw: {len(buildings(refresh))} buildings')
    new_blocks()
