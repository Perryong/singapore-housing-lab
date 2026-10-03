"""projects/<slug>/project.json for every upcoming BTO in reference/hdb/upcoming.json (no layout yet).

usage: python3 tools/make_upcoming.py
Site coordinates, flat types and unit counts come from HDB's Flat Portal; context from fetch_context.py.
"""
import json, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / 'tools'))
from fetch_context import fetch   # noqa: E402

for u in json.loads((ROOT / 'reference/hdb/upcoming.json').read_text()):
    d = ROOT / 'projects' / u['slug']
    d.mkdir(parents=True, exist_ok=True)
    P = {'id': u['slug'], 'name': u['name'], 'kind': 'bto', 'status': 'upcoming', 'launch': 'Oct 2026',
         'town': u['town'], 'units': u['units'], 'flatTypes': u['flatTypes'], 'contract': u['code'],
         'tagline': f"Upcoming BTO · Oct 2026 launch · {u['town']} · {u['units']:,} units",
         'site': {'lat': u['lat'], 'lon': u['lon'], 'tz': 8, 'floorHeight': 2.8},
         'blocks': {}, 'stacks': [], 'categories': {},
         'notes': ("HDB has not released this project's site plan yet, so its blocks are not shown. The pin marks "
                   "HDB's site location; grey blocks are existing HDB flats within 900 m (data.gov.sg), so you can "
                   "see how they shade the site through the day. Unit-level sun hours will be added after HDB's "
                   "sales launch."),
         'context': fetch(u['lat'], u['lon'])}
    (d / 'project.json').write_text(json.dumps(P, separators=(',', ':')))
    print(u['slug'], len(P['context']), 'context blocks')
