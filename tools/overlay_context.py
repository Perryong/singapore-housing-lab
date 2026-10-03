"""Draw a project's context footprints over its site plan (alignment check).

usage: python3 tools/overlay_context.py projects/<id> out.png
"""
import json, math, sys
from pathlib import Path
import cv2
import numpy as np

D = Path(sys.argv[1]); P = json.loads((D / 'project.json').read_text())
im = cv2.imread(str(D / P['plan']['image']['file']))
pl = P['plan']; PX = pl['pxPerM']; ox, oy = pl['origin']; b = math.radians(pl['upBearing'])


def w2p(x, z):
    # inverse of plan2world: world = R(up) * plan_local
    lx = x * math.cos(b) + z * math.sin(b); lz = -x * math.sin(b) + z * math.cos(b)
    return ox + lx * PX, oy + lz * PX


for c in P['context']:
    pts = np.array([w2p(x, z) for x, z in c['p']], np.int32)
    cv2.polylines(im, [pts], True, (255, 0, 255), 2)
cv2.imwrite(sys.argv[2], im)
