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


def fit(X, y):
    log = np.log(y)
    base = dict(max_iter=500, learning_rate=0.08, max_leaf_nodes=63, categorical_features='from_dtype', random_state=0)
    return {'mid': HistGradientBoostingRegressor(**base).fit(X, log),
            'lo': HistGradientBoostingRegressor(loss='quantile', quantile=0.1, **base).fit(X, log),
            'hi': HistGradientBoostingRegressor(loss='quantile', quantile=0.9, **base).fit(X, log)}


def predict(models, X):
    est = np.exp(models['mid'].predict(X))
    lo, hi = np.exp(models['lo'].predict(X)), np.exp(models['hi'].predict(X))
    return est, np.minimum(lo, est), np.maximum(hi, est)          # quantile models can cross the estimate


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
    est, lo, hi = predict(m, X[te])
    yt = y[te]
    metrics = {'asOf': as_of, 'mdape': round(float(np.median(np.abs(est / yt - 1))) * 100, 1),
               'coverage': round(float(np.mean((yt >= lo) & (yt <= hi))) * 100, 1),
               'nTrain': int(tr.sum()), 'nTest': int(te.sum()), 'dropped': X.attrs['dropped']}
    print('validation', metrics)
    models = fit(X, y)                                             # final models use every sale
    (R / 'value-model.pkl').write_bytes(pickle.dumps({'models': models, 'columns': list(X.columns),
                                                      'cats': {c: list(X[c].cat.categories) for c in CAT}}))
    (R / 'value-metrics.json').write_text(json.dumps(metrics))
    return metrics


if __name__ == '__main__':
    if sys.argv[1:2] == ['train']:
        train()
