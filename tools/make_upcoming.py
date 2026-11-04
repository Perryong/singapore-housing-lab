"""projects/<slug>/project.json for every Nov 2026 BTO in reference/hdb/upcoming.json (no layout yet).

usage: python3 tools/make_upcoming.py            write each project.json afresh (drops data other tools added)
       python3 tools/make_upcoming.py --patch    update only the header fields below in the existing files
Site coordinates, flat types and unit counts come from HDB's Flat Portal and launch annex; context from fetch_context.py.
An entry with "status": "launched" carries HDB's official name and "classification" from the sales launch.
"""
import json, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / 'tools'))
from fetch_context import fetch   # noqa: E402

SHADE = ("The pin marks HDB's site location; grey blocks are existing HDB flats within 900 m (data.gov.sg), so you can "
         "see how they shade the site through the day.")


def header(u):
    launched = u.get('status') == 'launched'
    return {'name': u['name'], 'status': 'launched' if launched else 'upcoming', 'units': u['units'],
            'flatTypes': u['flatTypes'], **({'classification': u['classification']} if launched else {}),
            'tagline': f"{u['classification'] if launched else 'Upcoming'} BTO · Nov 2026 launch · {u['town']} · {u['units']:,} units",
            'notes': (f"HDB launched this project in Nov 2026, but its site plan isn't traced here yet, so its blocks are not shown. {SHADE}"
                      if launched else
                      f"HDB has not released this project's site plan yet, so its blocks are not shown. {SHADE} "
                      "Unit-level sun hours will be added after HDB's sales launch.")}


for u in json.loads((ROOT / 'reference/hdb/upcoming.json').read_text()):
    d = ROOT / 'projects' / u['slug']
    if '--patch' in sys.argv:
        P = {**json.loads((d / 'project.json').read_text()), **header(u)}
    else:
        d.mkdir(parents=True, exist_ok=True)
        P = {'id': u['slug'], 'kind': 'bto', 'launch': 'Nov 2026', 'town': u['town'], 'contract': u['code'], **header(u),
             'site': {'lat': u['lat'], 'lon': u['lon'], 'tz': 8, 'floorHeight': 2.8},
             'blocks': {}, 'stacks': [], 'categories': {}, 'context': fetch(u['lat'], u['lon'])}
    (d / 'project.json').write_text(json.dumps(P, separators=(',', ':')))
    print(u['slug'], P['status'], P['name'])
