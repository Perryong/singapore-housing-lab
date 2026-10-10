"""Resale value model for the Value tab: train on HDB resale sales, validate on the latest 6 months, estimate BTO units.

usage: python3 tools/train_value.py train              -> reference/resale/value-model.pkl + value-metrics.json
       python3 tools/train_value.py estimate projects/<id>...   -> project.json["value"]

Target log(price). Gradient-boosted trees (scikit-learn HistGradientBoostingRegressor): one for the estimate, two
quantile models (10th / 90th percentile) for the range. Location features come from the block's coordinates
(reference/resale/geocode.json) and the amenity layers (reference/amenities/all.json).
"""
import json, math, pickle, re, sys
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingRegressor
from sklearn.neighbors import KDTree

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / 'tools'))
from geocode_resale import geo_key   # noqa: E402

R = ROOT / 'reference/resale'
CBD = (1.2839, 103.8515)                                          # Raffles Place MRT
LAT0, LON0 = 1.35, 103.82
NUM = ['sqm', 'storey', 'lease', 'mi', 'd_mrt', 'd_cbd', 'd_mall', 'd_hawker', 'n_pri1k']
CAT = ['type', 'model', 'town']


def storey_mid(s):
    a, b = (int(x) for x in re.findall(r'\d+', s)[:2])
    return (a + b) // 2


def lease_years(s):
    n = [int(x) for x in re.findall(r'\d+', s)]
    return round(n[0] + (n[1] / 12 if len(n) > 1 else 0), 2)


def month_index(m):                                               # '2017-01' -> 0
    y, mo = map(int, m.split('-'))
    return (y - 2017) * 12 + mo - 1


def xy(lat, lon):                                                 # metres on a local plane (fine across Singapore)
    lat, lon = np.asarray(lat, float), np.asarray(lon, float)
    return np.c_[(lon - LON0) * 111320 * math.cos(math.radians(LAT0)), (lat - LAT0) * 110574]


class Places:
    """Nearest-distance lookups against the amenity layers."""
    def __init__(self, amen):
        pts = lambda cats: xy([a['lat'] for a in amen if a['cat'] in cats], [a['lon'] for a in amen if a['cat'] in cats])
        self.mrt, self.mall, self.hawker = (KDTree(pts(c)) for c in ({'mrt', 'lrt'}, {'mall'}, {'hawker'}))
        self.pri, self.cbd = KDTree(pts({'primary'})), xy([CBD[0]], [CBD[1]])[0]

    def loc(self, lat, lon):
        p = xy(lat, lon)
        near = lambda t: t.query(p, k=1)[0][:, 0]
        return pd.DataFrame({'d_mrt': near(self.mrt), 'd_cbd': np.hypot(*(p - self.cbd).T), 'd_mall': near(self.mall),
                             'd_hawker': near(self.hawker), 'n_pri1k': self.pri.query_radius(p, r=1000, count_only=True)})


def features(df, geo, places):
    """Model inputs for resale rows; rows whose block has no coordinates are dropped (count in .attrs['dropped'])."""
    keys = [geo_key(b, s) for b, s in zip(df['block'], df['street_name'])]
    ok = np.array([bool(geo.get(k)) for k in keys])
    d = df[ok].reset_index(drop=True)
    ll = np.array([geo[k] for k, o in zip(keys, ok) if o])
    X = pd.concat([pd.DataFrame({
        'type': d['flat_type'], 'model': d['flat_model'], 'town': d['town'],
        'sqm': d['floor_area_sqm'].astype(float), 'storey': d['storey_range'].map(storey_mid),
        'lease': d['remaining_lease'].map(lease_years), 'mi': d['month'].map(month_index)}),
        places.loc(ll[:, 0], ll[:, 1])], axis=1)
    for c in CAT:
        X[c] = X[c].astype('category')
    X.attrs['dropped'] = int((~ok).sum())
    return X[CAT + NUM], d


def fit(X, y, band=(-0.1, 0.1)):
    m = HistGradientBoostingRegressor(max_iter=500, learning_rate=0.08, max_leaf_nodes=63,
                                      categorical_features='from_dtype', random_state=0).fit(X, np.log(y))
    return {'mid': m, 'band': band}


def predict(models, X):
    """Estimate and range; the range is the 10th-90th percentile of log(actual/estimate) on recent unseen sales."""
    est = np.exp(models['mid'].predict(X))
    q10, q90 = models['band']
    return est, est * np.exp(min(q10, 0)), est * np.exp(max(q90, 0))


def load():
    df = pd.read_csv(R / 'resale.csv', dtype=str)
    geo = json.loads((R / 'geocode.json').read_text())
    places = Places(json.loads((ROOT / 'reference/amenities/all.json').read_text()))
    return df, geo, places


def train():
    df, geo, places = load()
    X, d = features(df, geo, places)
    y = d['resale_price'].astype(float).to_numpy()
    as_of = d['month'].max()
    cut = month_index(as_of) - 6                                   # test = the last 6 months
    tr, te = X['mi'] <= cut, X['mi'] > cut
    m = fit(X[tr], y[tr])
    est = np.exp(m['mid'].predict(X[te]))
    yt, r = y[te], np.log(y[te] / est)
    early = (X.loc[te, 'mi'] <= cut + 3).to_numpy()                # band from months 1-3 of the test window,
    band = (float(np.quantile(r[early], 0.1)), float(np.quantile(r[early], 0.9)))   # coverage measured on months 4-6
    lo, hi = est * np.exp(band[0]), est * np.exp(band[1])
    metrics = {'asOf': as_of, 'mdape': round(float(np.median(np.abs(est / yt - 1))) * 100, 1),
               'coverage': round(float(np.mean(((yt >= lo) & (yt <= hi))[~early])) * 100, 1),
               'band': [round(band[0], 4), round(band[1], 4)],
               'nTrain': int(tr.sum()), 'nTest': int(te.sum()), 'dropped': X.attrs['dropped']}
    print('validation', metrics)
    models = fit(X, y, band)                                       # final model uses every sale
    (R / 'value-model.pkl').write_bytes(pickle.dumps({'models': models, 'columns': list(X.columns),
                                                      'cats': {c: list(X[c].cat.categories) for c in CAT}}))
    (R / 'value-metrics.json').write_text(json.dumps(metrics))
    return metrics


TYPE = {'2RF1': '2 ROOM', '2RF2': '2 ROOM', '3RM': '3 ROOM', '4RM': '4 ROOM', '5RM': '5 ROOM', '3GEN': 'MULTI-GENERATION'}
MIN_SALES, LEASE, FLOOR_REF = 500, 94, 8
_ctx = {}


def context():
    """Model, amenities and per-type reference values, loaded once."""
    if not _ctx:
        M = pickle.loads((R / 'value-model.pkl').read_bytes())
        df = pd.read_csv(R / 'resale.csv', dtype=str)
        recent = df[df['lease_commence_date'].astype(int) >= 2015]
        geo = json.loads((R / 'geocode.json').read_text())
        places = Places(json.loads((ROOT / 'reference/amenities/all.json').read_text()))
        X, _ = features(df[df['month'] >= '2025-01'], geo, places)
        _ctx.update(M=M, places=places, n=df['flat_type'].value_counts().to_dict(),
                    model=recent.groupby('flat_type')['flat_model'].agg(lambda v: v.mode()[0]).to_dict(),
                    sqm=recent.groupby('flat_type')['floor_area_sqm'].agg(lambda v: v.astype(float).median()).to_dict(),
                    towns=X.groupby(['type', 'town'], observed=True)[['d_mrt', 'd_cbd', 'd_mall', 'd_hawker', 'n_pri1k']]
                    .median().join(X.groupby(['type', 'town'], observed=True).size().rename('w')),
                    metrics=json.loads((R / 'value-metrics.json').read_text()))
    return _ctx


def rows(c, typ, sqm, storeys, town, loc):
    """One model input row per storey for a flat of `typ` at location `loc` (dict of location features)."""
    X = pd.DataFrame({'type': typ, 'model': c['model'][typ], 'town': town, 'sqm': float(sqm), 'storey': storeys,
                      'lease': float(LEASE), 'mi': month_index(c['metrics']['asOf']), **loc})
    for k in CAT:
        X[k] = pd.Categorical(X[k], categories=c['M']['cats'][k])       # unseen town -> missing, as in training
    return X[c['M']['columns']]


def latlon(P, x, z):                                                    # inverse of fetch_context.local_xz
    lat0, lon0 = P['site']['lat'], P['site']['lon']
    return lat0 - z / 110574.0, lon0 + x / (111320.0 * math.cos(math.radians(lat0)))


def stack_xz(P, s):                                                     # web/project.js plan2world
    pl = P['plan']; ox, oy = pl['origin']
    lx, lz = (s['px'] - ox) / pl['pxPerM'], (s['py'] - oy) / pl['pxPerM']
    b = math.radians(pl['upBearing'])
    return lx * math.cos(b) - lz * math.sin(b), lx * math.sin(b) + lz * math.cos(b)


def estimate_project(P):
    c = context()
    k = lambda v: int(round(float(v), -3))
    town = (P.get('town') or '').upper()
    out = {'asOf': c['metrics']['asOf'], 'metrics': c['metrics'], 'byStack': {}, 'drivers': {}, 'types': {}, 'skipped': {}}
    site = c['places'].loc(*[[v] for v in (P['site']['lat'], P['site']['lon'])]).iloc[0].to_dict()
    for code in sorted({s['type'] for s in P['stacks']}):
        typ = TYPE.get(code)
        if typ and c['n'].get(typ, 0) >= MIN_SALES and typ not in out['types']:
            e, lo, hi = predict(c['M']['models'], rows(c, typ, c['sqm'][typ], [10], town, site))
            out['types'][typ] = [k(e[0]), k(lo[0]), k(hi[0])]
    for typ in (P.get('flatTypes') or []):                              # upcoming projects: types from the catalogue
        t = {'2-room Flexi': '2 ROOM', '3-room': '3 ROOM', '4-room': '4 ROOM', '5-room': '5 ROOM'}.get(typ)
        if t and t not in out['types']:
            e, lo, hi = predict(c['M']['models'], rows(c, t, c['sqm'][t], [10], town, site))
            out['types'][t] = [k(e[0]), k(lo[0]), k(hi[0])]
    for s in P['stacks']:
        no, typ = str(s['no']), TYPE.get(s['type'])
        if not typ:
            out['skipped'][no] = f"no resale equivalent for {s['type']}"; continue
        if c['n'].get(typ, 0) < MIN_SALES:
            out['skipped'][no] = f'too few {typ.lower()} resale sales to model'; continue
        sqm = (P.get('prices') or {}).get(s['type'], {}).get('sqm') or c['sqm'][typ]
        loc = c['places'].loc(*[[v] for v in latlon(P, *stack_xz(P, s))]).iloc[0].to_dict()
        top = P['blocks'][s['block']]['floors']
        floors = list(range(s.get('first', 2), top + 1))
        e, lo, hi = predict(c['M']['models'], rows(c, typ, sqm, floors, town, loc))
        out['byStack'][no] = {str(f): [k(a), k(b), k(d)] for f, a, b, d in zip(floors, e, lo, hi)}
        mid = [floors[len(floors) // 2]]
        base = predict(c['M']['models'], rows(c, typ, sqm, mid, town, loc))[0][0]
        T = c['towns'].loc[typ]                                       # island-wide average: every town, weighted by sales
        avg = float(np.average([predict(c['M']['models'], rows(c, typ, sqm, mid, t, r.drop('w').to_dict()))[0][0]
                                for t, r in T.iterrows()], weights=T['w']))
        typical = predict(c['M']['models'], rows(c, typ, c['sqm'][typ], mid, town, loc))[0][0]
        out['drivers'][no] = {'location': k(base - avg), 'size': k(base - typical), 'floorRef': FLOOR_REF}
    return out


if __name__ == '__main__':
    if sys.argv[1:2] == ['train']:
        train()
    elif sys.argv[1:2] == ['estimate']:
        for d in sys.argv[2:]:
            f = Path(d) / 'project.json'
            P = json.loads(f.read_text())
            P['value'] = estimate_project(P)
            f.write_text(json.dumps(P, separators=(',', ':')))
            v = P['value']
            print(f"{Path(d).name}: {len(v['byStack'])} stacks, types {list(v['types'])}, skipped {len(v['skipped'])}")
