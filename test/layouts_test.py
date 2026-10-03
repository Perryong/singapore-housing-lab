import json
from tools.extract_layouts import extract
L = extract('kebun-baru-breeze')
P = json.load(open('projects/kebun-baru-breeze/project.json'))
for_sale = {str(s['no']) for s in P['stacks'] if s['type'] != 'RENT'}   # rental flats have no plan in the brochure
assert for_sale <= set(L), sorted(for_sale - set(L))
assert 'lowest' in L['239'] and L['239']['typical'] != L['239']['lowest']
from PIL import Image
w, h = Image.open('projects/kebun-baru-breeze/' + L['201']['typical']).size
assert 150 < w < 1600 and 150 < h < 1600, (w, h)
print('ok')
