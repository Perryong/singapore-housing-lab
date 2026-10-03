"""Find the HDB site-plan scale bar (alternating black/white 10 m segments) in a search box.

usage: python3 tools/find_scalebar.py <image> <x0> <y0> <x1> <y1>  -> prints p0, p1 (bar ends, full-image px)
"""
import sys
import cv2
import numpy as np

im = cv2.imread(sys.argv[1], cv2.IMREAD_GRAYSCALE)
x0, y0, x1, y1 = map(int, sys.argv[2:6])
g = im[y0:y1, x0:x1] < 90
outline = im[y0:y1, x0:x1] < 170          # thin anti-aliased bar outline


def chain_of(y):
    """Longest run of evenly spaced, equal-length black segments on row y."""
    row = np.concatenate([[0], g[y].astype(np.int8), [0]])
    d = np.diff(row)
    runs = [(a, b) for a, b in zip(np.flatnonzero(d == 1), np.flatnonzero(d == -1)) if b - a > 20]
    best = []
    for i in range(len(runs)):
        seg = runs[i][1] - runs[i][0]
        chain = [runs[i]]
        for r in runs[i + 1:]:
            if abs((r[1] - r[0]) - seg) < 0.25 * seg and abs(r[0] - chain[-1][0] - 2 * seg) < 0.25 * seg:
                chain.append(r)
        best = max(best, chain, key=len)
    return best


y, chain = max(((y, chain_of(y)) for y in range(g.shape[0])), key=lambda t: len(t[1]))
seg = np.median([b - a for a, b in chain])
# the bar's thin outline spans its full length whatever the black/white pattern: take the longest
# continuous dark run near the bar that contains the black segments
span = (chain[0][0], chain[-1][1])
best = span
for yy in range(max(0, y - 25), min(g.shape[0], y + 25)):
    row = np.concatenate([[0], outline[yy].astype(np.int8), [0]])
    d = np.diff(row)
    for a, b in zip(np.flatnonzero(d == 1), np.flatnonzero(d == -1)):
        if a <= span[0] + 3 and b >= span[1] - 3 and b - a > best[1] - best[0]:
            best = (a, b)
left, right = best
print(f'p0 [{int(x0 + left)}, {y0 + y}]  p1 [{int(x0 + right)}, {y0 + y}]  length {right - left}px = '
      f'{(right - left) / seg * 10:.0f} m at {seg:.1f}px per 10 m ({len(chain)} black segments)')
