"""Cut gridded, upscaled tiles from a site plan for reading coordinates by eye.

usage: python3 tools/grid_tiles.py <image> <x0> <y0> <x1> <y1> <outdir> [tile=500] [step=50]
Grid labels are full-image pixel coordinates.
"""
import sys
from pathlib import Path
import cv2

im = cv2.imread(sys.argv[1])
X0, Y0, X1, Y1 = map(int, sys.argv[2:6])
out = Path(sys.argv[6]); out.mkdir(parents=True, exist_ok=True)
TILE = int(sys.argv[7]) if len(sys.argv) > 7 else 500
STEP = int(sys.argv[8]) if len(sys.argv) > 8 else 50
for ty in range(Y0, Y1, TILE * 7 // 10):
    for tx in range(X0, X1, TILE):
        c = im[ty:ty + TILE * 7 // 10, tx:tx + TILE].copy()
        c = cv2.resize(c, None, fx=2, fy=2, interpolation=cv2.INTER_CUBIC)
        for gx in range((tx // STEP + 1) * STEP, tx + c.shape[1] // 2, STEP):
            X = (gx - tx) * 2
            cv2.line(c, (X, 0), (X, c.shape[0]), (255, 0, 255), 1)
            cv2.putText(c, str(gx), (X + 2, 14), 0, 0.45, (255, 0, 255), 1)
        for gy in range((ty // STEP + 1) * STEP, ty + c.shape[0] // 2, STEP):
            Y = (gy - ty) * 2
            cv2.line(c, (0, Y), (c.shape[1], Y), (255, 0, 255), 1)
            cv2.putText(c, str(gy), (2, Y - 3), 0, 0.45, (255, 0, 255), 1)
        cv2.imwrite(str(out / f'tile_{tx}_{ty}.png'), c)
print(sorted(p.name for p in out.glob('tile_*.png')))
