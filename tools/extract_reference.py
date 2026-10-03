"""One-off: turn the original sun-study page into projects/thomson-reserve/{project.json,siteplan.jpg}.

usage: python3 tools/extract_reference.py reference/sun-study.html projects/thomson-reserve
"""
import base64, json, re, sys
from pathlib import Path

src, out = Path(sys.argv[1]), Path(sys.argv[2])
html = src.read_text()
out.mkdir(parents=True, exist_ok=True)


def literal(name):
    """Grab `const NAME=<literal>;` and coerce the JS literal to JSON (no eval)."""
    m = re.search(r'const ' + name + r'=(.*?);\n', html, re.S)
    s = m.group(1)
    s = re.sub(r'//[^\n]*', '', s)
    s = s.replace("'", '"')
    s = re.sub(r'([{,]\s*)([A-Za-z_]\w*|\d+)\s*:', r'\1"\2":', s)
    s = re.sub(r',\s*([\]}])', r'\1', s)
    return json.loads(s)


def num(name):
    return float(re.search(r'\b' + name + r'=([-\d.]+)', html).group(1))


img_b64 = re.search(r'SITE_IMG="data:image/jpeg;base64,([^"]+)"', html).group(1)
(out / 'siteplan.jpg').write_bytes(base64.b64decode(img_b64))

blocks, stacks, ut, first, cats = (literal(n) for n in ('BLOCKS', 'STACKS', 'UT', 'FIRST', 'CATS'))
img = literal('IMG')

# sizeOf() in the original: per category, with one per-code override
sizes = {'B': [55, 592], 'BP': [63, 678], 'BPS': [68, 732], 'C': [88, 947], 'CP': [98, 1055],
         'CPS': [107, 1152], 'D': [115, 1238], 'DP': [127, 1367], 'DPS': [138, 1485], 'E': [168, 1808]}
for k, v in cats.items():
    v['size'] = sizes[k]

project = {
    'name': 'Thomson Reserve',
    'tagline': 'Which stacks catch the sun, hour by hour',
    'site': {'lat': num('LAT'), 'lon': num('LON'), 'tz': num('TZ'), 'floorHeight': num('FH')},
    'plan': {'pxPerM': num('PX'), 'upBearing': num('UP_BEARING'), 'origin': [num('OX'), num('OY')],
             'image': {'file': 'siteplan.jpg', **img}},
    'stackSize': {'normal': [4.8, 6], 'corner': [6.5, 7]},
    'blocks': {k: {'floors': v['floors'], 'axis': v['axis'], 'centre': v['c'],
                   'collection': 'Luxury' if v['floors'] == 30 else 'Classic'} for k, v in blocks.items()},
    'stacks': [{'no': no, 'block': blk, 'px': px, 'py': py, 'faces': faces,
                'type': ut[str(no)], 'first': first.get(str(no), 2)} for no, blk, px, py, faces in stacks],
    'categories': cats,
    'sizeOverrides': {'BPS4': [72, 775]},
    'context': [{'h': c['h'], 'p': c['p']} for c in literal('CONTEXT')],
    'notes': ('Blocks and stacks are placed on the official site plan, oriented with its north arrow and scaled '
              "to its 100 m bar. Each stack's window directions are read from its position on the plan (corner "
              'units get two). Grey blocks are neighbouring HDB flats within 900 m, from HDB open data; shading '
              'counts them and the towers, but not private buildings, trees or terrain. Check the floor plan '
              'before deciding on a unit.'),
}
(out / 'project.json').write_text(json.dumps(project, separators=(',', ':')))
print(f"{len(project['blocks'])} blocks, {len(project['stacks'])} stacks, {len(project['context'])} context")
