# Each stack's own flat, read off its brochure page: rooms, walls and scale (tools/extract_plan3d.py).
import sys
from pathlib import Path
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
assert all(isinstance(v, (dict, str)) for v in R.values()) and len(R) >= 4, R.keys()   # both rows of units
S = extract_page('bishan-terraces', 14)                                # scanned page: plan or reason, never raises
assert S and all(isinstance(v, (dict, str)) for v in S.values())
print('ok')
