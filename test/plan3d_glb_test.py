# Blender turns a stack's plan JSON into a dollhouse GLB (blender/build_plan3d.py).
import json, shutil, struct, subprocess, sys, tempfile
from pathlib import Path

SRC = Path('projects/kim-keat-crest/plans3d/584.json')
if not shutil.which('blender') or not SRC.exists():
    sys.exit(print('skipped: needs blender and projects/kim-keat-crest/plans3d/584.json'))

out = Path(tempfile.mkdtemp()) / '584.glb'
r = subprocess.run(['blender', '-b', '--factory-startup', '-P', 'blender/build_plan3d.py', '--', str(SRC), str(out)],
                   capture_output=True, text=True)
assert out.exists(), r.stdout[-2000:] + r.stderr[-2000:]
b = out.read_bytes()
n = struct.unpack_from('<I', b, 12)[0]
G = json.loads(b[20:20 + n])
names = [nd.get('name', '') for nd in G['nodes']]
assert 'walls' in names, names
assert sum(x.startswith('room:') for x in names) >= 8, names
wall_mesh = G['meshes'][G['nodes'][names.index('walls')]['mesh']]
pos = G['accessors'][wall_mesh['primitives'][0]['attributes']['POSITION']]
assert 2.75 <= pos['max'][1] <= 2.85, pos['max']                         # glTF is Y-up: wall height 2.8 m
J = json.loads(SRC.read_text())
xs = [p[0] for r_ in J['rooms'] for p in r_['poly']]
zs = [p[1] for r_ in J['rooms'] for p in r_['poly']]
for got, want in ((pos['max'][0] - pos['min'][0], max(xs) - min(xs)), (pos['max'][2] - pos['min'][2], max(zs) - min(zs))):
    assert abs(got / want - 1) < 0.1, (got, want)                          # walls frame the rooms
print('ok')
