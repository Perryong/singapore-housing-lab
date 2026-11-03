"""Scoring rules for land likely to become BTO (docs/superpowers/specs/2026-11-03-future-bto-design.md).

Pure functions on plain dicts; tools/predict_future.py feeds them URA land use, buildings and hand-kept references.
Coordinates are WGS84; distances in metres via fetch_context.local_xz.
"""
import datetime as dt, json, math, sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from fetch_context import local_xz   # noqa: E402
from fetch_surround import inside    # noqa: E402

CANDIDATE_LU = frozenset({'RESIDENTIAL', 'RESIDENTIAL WITH COMMERCIAL AT 1ST STOREY', 'RESIDENTIAL / INSTITUTION',
                          'WHITE', 'RESERVE SITE'})
POINTS = {'area': 40, 'rezoned': 20, 'mrt': 15, 'hdb': 15, 'gpr': 10}
MRT_M, HDB_M = 800, 500
MIN_AREA_M2, MAX_COVER = 10_000, 0.10
STALE_DAYS = 90


def load_ref(path):
    """Items of a hand-kept {"reviewed": "YYYY-MM-DD", "items": [...]} file; warns once the review goes stale."""
    doc = json.loads(Path(path).read_text())
    if (dt.date.today() - dt.date.fromisoformat(doc['reviewed'])).days > STALE_DAYS:
        print(f"warning: {path} reviewed {doc['reviewed']}, over {STALE_DAYS} days ago", file=sys.stderr)
    return doc['items']


def dist_m(lat1, lon1, lat2, lon2):
    return math.hypot(*local_xz(lat1, lon1, lon2, lat2))


def outer_rings(geometry):
    """Outer ring of each polygon, largest first ([lon, lat] points)."""
    polys = [geometry['coordinates']] if geometry['type'] == 'Polygon' else geometry['coordinates']
    return sorted((p[0] for p in polys), key=ring_area_m2, reverse=True)


def ring_area_m2(ring):
    lon0, lat0 = ring[0]
    pts = [local_xz(lat0, lon0, lon, lat) for lon, lat in ring]
    return abs(sum(x1 * z2 - x2 * z1 for (x1, z1), (x2, z2) in zip(pts, pts[1:] + pts[:1]))) / 2


def contains(rings, lat, lon):
    return any(inside(lon, lat, r) for r in rings)


def centroid(ring):
    pts = ring[:-1] if ring[0] == ring[-1] else ring
    return sum(p[1] for p in pts) / len(pts), sum(p[0] for p in pts) / len(pts)


def gpr_num(s):
    try:
        return float(s)
    except (TypeError, ValueError):
        return None                      # URA codes such as EVA / SDP, or no GPR


class Grid:
    """Points bucketed into square cells so a radius query only looks at nearby cells."""

    def __init__(self, points, cell_m=500):
        self.pts, self.cell = list(points), cell_m
        self.cells = {}
        for p in self.pts:
            self.cells.setdefault(self._key(p[0], p[1]), []).append(p)

    def _key(self, lat, lon):
        return int(lat * 110_574 // self.cell), int(lon * 111_320 // self.cell)

    def within(self, lat, lon, r_m):
        """Every point in the cells a radius r_m around (lat, lon) can touch (a superset of the circle)."""
        (i, j), n = self._key(lat, lon), math.ceil(r_m / self.cell) + 1
        for di in range(-n, n + 1):
            for dj in range(-n, n + 1):
                yield from self.cells.get((i + di, j + dj), ())

    def near(self, lat, lon, r_m):
        out = [(dist_m(lat, lon, la, lo), payload) for la, lo, payload in self.within(lat, lon, r_m)]
        return sorted((t for t in out if t[0] <= r_m), key=lambda t: t[0])

    def nearest(self, lat, lon, keep=lambda payload: True):
        return min(((dist_m(lat, lon, la, lo), payload) for la, lo, payload in self.pts if keep(payload)),
                   key=lambda t: t[0], default=(math.inf, None))


class PolyIndex:
    """(key, rings) items filed under every cell their bounding box touches; .at() returns the keys holding a point."""

    def __init__(self, items, cell_deg=0.005):
        self.cell, self.cells = cell_deg, {}
        for key, rings in items:
            lons, lats = [p[0] for r in rings for p in r], [p[1] for r in rings for p in r]
            box = (min(lats), min(lons), max(lats), max(lons))
            for i in range(int(box[0] // cell_deg), int(box[2] // cell_deg) + 1):
                for j in range(int(box[1] // cell_deg), int(box[3] // cell_deg) + 1):
                    self.cells.setdefault((i, j), []).append((key, rings, box))

    def at(self, lat, lon):
        return [k for k, rings, (a, b, c, d) in self.cells.get((int(lat // self.cell), int(lon // self.cell)), ())
                if a <= lat <= c and b <= lon <= d and contains(rings, lat, lon)]


def coverage(rings, area_m2, buildings):
    """Share of the parcel covered by buildings whose centroid lies inside it (payload = footprint m²)."""
    lat, lon = centroid(rings[0])
    reach = max(dist_m(lat, lon, la, lo) for r in rings for lo, la in r)
    return sum(a for la, lo, a in buildings.within(lat, lon, reach) if contains(rings, la, lo)) / area_m2


def is_candidate(lu, area_m2, cover, holds_project):
    return lu in CANDIDATE_LU and area_m2 >= MIN_AREA_M2 and cover < MAX_COVER and not holds_project


def rezoned(lu_now, residential_then):
    return 'RESIDENTIAL' in lu_now and not residential_then


def band(score):
    return 'likely' if score >= 70 else 'possible' if score >= 40 else 'longshot'


def score(p, ctx):
    lat, lon, r = p['lat'], p['lon'], math.sqrt(p['area'] / math.pi)
    reasons = []
    areas = sorted((dist_m(lat, lon, a['lat'], a['lon']), i, a) for i, a in enumerate(ctx['areas']))
    area = next((a for d, _, a in areas if d <= a['radiusM']), None)
    if area:
        homes = f" (~{area['homes']:,} homes)" if area.get('homes') else ''
        reasons.append([f"In announced growth area: {area['name']}{homes}", POINTS['area']])
    if p['rezoned']:
        reasons.append(['Rezoned to residential since MP2019', POINTS['rezoned']])
    mrt_m, st = ctx['stations'].nearest(lat, lon, lambda s: s['opens'] is None or s['opens'] <= ctx['asOf'] + 10)
    if mrt_m <= MRT_M + r:
        opens = ' (planned)' if st.get('planned') else f" (opens {st['opens']})" if st['opens'] and st['opens'] > ctx['asOf'] else ''
        reasons.append([f"{st['name']} MRT{opens} {round(mrt_m)} m", POINTS['mrt']])
    if ctx['hdb'].near(lat, lon, HDB_M + r):
        reasons.append(['HDB block within 500 m', POINTS['hdb']])
    g = gpr_num(p['gpr'])
    if g is not None and g >= 2.8:
        reasons.append([f"GPR {p['gpr']} (2.8 or higher)", POINTS['gpr']])
    total = sum(pts for _, pts in reasons)
    near = bool(area and area.get('firstLaunch') and area['firstLaunch'] <= ctx['asOf'] + 5)
    name = area['name'] if area else f"Unannounced · near {st['name']}" if st else 'Unannounced'
    return {'score': total, 'band': band(total), 'horizon': 'near' if near else 'far', 'name': name, 'reasons': reasons,
            'announced': bool(area), 'source': area['source'] if area else None, 'mrtM': mrt_m}


def backtest(ranked, sites):
    """Share of launch sites inside the top 10% of parcels, against MRT-distance and random rankings."""
    n = len(sites)
    if not n:
        return {'n': 0, 'topDecile': 0.0, 'mrtOnly': 0.0, 'random': 0.0, 'inCandidates': 0.0}
    k = math.ceil(len(ranked) / 10)
    hits = lambda top: sum(any(contains(q['rings'], *s) for q in top) for s in sites) / n  # noqa: E731
    within = hits(ranked)
    return {'n': n, 'topDecile': round(hits(sorted(ranked, key=lambda q: (-q['score'], q['mrtM']))[:k]), 3),
            'mrtOnly': round(hits(sorted(ranked, key=lambda q: q['mrtM'])[:k]), 3),
            'random': round(0.1 * within, 3), 'inCandidates': round(within, 3)}
