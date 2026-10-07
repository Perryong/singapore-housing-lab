# Each stack's own flat, read off its brochure page: rooms, walls and scale (tools/extract_plan3d.py).
import sys
from pathlib import Path
from tools.extract_plan3d import nearest_label

# two rows of units sharing one blob: a room below the bottom-row label belongs to it, not to the top one at the same x
L = {'100': (500, 100), '200': (520, 900)}
assert nearest_label(505, 820, L) == '200', nearest_label(505, 820, L)
assert nearest_label(505, 180, L) == '100', nearest_label(505, 180, L)
if not Path('reference/hdb/brochures/kim-keat-crest.pdf').exists():   # HDB brochure, not in the repo
    sys.exit(print('skipped: HDB sales brochure is not in the repo'))
from tools.extract_plan3d import extract_page

R = extract_page('kim-keat-crest', 13)
p, q = R['584'], R['586']
assert isinstance(p, dict) and isinstance(q, dict), (p if isinstance(p, str) else q)
types = [r['type'] for r in p['rooms']]
assert types.count('bedroom') == 3 and types.count('bath') == 2, types
assert {'living', 'kitchen', 'yard', 'shelter'} <= set(types), types
assert abs(p['bboxPx'][2] - 850) < 15 and abs(q['bboxPx'][0] - 850) < 15, (p['bboxPx'], q['bboxPx'])  # split on the party wall
assert abs(p['scale']['pxPerM'] - q['scale']['pxPerM']) / p['scale']['pxPerM'] < 0.03, (p['scale'], q['scale'])  # mirror pair
assert abs((p['north'] + 180) % 360 - 180) < 5, p['north']           # page fitted to the site plan: page-up is north
assert any(w['kind'] == 'window' for w in p['walls']) and any(w['kind'] == 'solid' for w in p['walls'])
part = sum(max(r[2] - r[0], r[3] - r[1]) for w in p['walls'] if w['kind'] == 'partition'
           for r in [w['rect']] if max(r[2] - r[0], r[3] - r[1]) >= 0.5)
assert part >= 22, f'interior walls {part:.1f} m'                   # double-line partitions drawn in a darker fill shade
assert all(isinstance(v, (dict, str)) for v in R.values()) and len(R) >= 4, R.keys()   # both rows of units
S = extract_page('bishan-terraces', 14)                                # scanned page: plan or reason, never raises
assert S and all(isinstance(v, (dict, str)) for v in S.values())
import json
C = extract_page('chencharu-grove', 21)                               # "UNIT 323" printed sideways
assert isinstance(C['323'], dict), C['323']
D = json.load(open('projects/sembawang-deck/project.json'))
pg = sorted({l['page'] for l in D['layouts'].values()})[0]
SD = extract_page('sembawang-deck', pg)                               # scanned: names partly/un-readable -> still a plan
partial = [v for v in SD.values() if isinstance(v, dict) and not v['named']]
assert partial, SD
assert all(r['type'] == 'other' or r['name'] for r in partial[0]['rooms'])    # unread rooms stay unlabelled
assert all(v['named'] for v in (p, q))
O = extract_page('oak-ville-amk', 13)                                 # diagonal label: "UNIT" garbled, number intact
assert O['253'] != 'unit label not found on page', O['253']
print('ok')
