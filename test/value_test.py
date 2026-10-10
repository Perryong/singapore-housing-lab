# Value tab: resale geocoding, features and model (tools/geocode_resale.py, tools/train_value.py).
from tools.geocode_resale import geo_key

assert geo_key('406', 'ANG MO KIO AVE 10') == geo_key('406 ', 'Ang Mo Kio Avenue 10'), geo_key('406', 'ANG MO KIO AVE 10')
print('ok')

import numpy as np
from tools.train_value import storey_mid, lease_years, predict

assert storey_mid('10 TO 12') == 11 and storey_mid('01 TO 03') == 2
assert abs(lease_years('61 years 04 months') - 61.33) < 0.01 and lease_years('94 years') == 94


class Const:                                                     # stand-in model returning fixed log prices
    def __init__(self, v): self.v = v
    def predict(self, X): return np.full(len(X), np.log(self.v))


est, lo, hi = predict({'mid': Const(500000), 'band': (-0.08, 0.06)}, np.zeros((2, 1)))
assert np.allclose(lo, 500000 * np.exp(-0.08)) and np.allclose(hi, 500000 * np.exp(0.06))   # band = recent error quantiles
est, lo, hi = predict({'mid': Const(500000), 'band': (0.02, -0.01)}, np.zeros((2, 1)))
assert (lo <= est).all() and (est <= hi).all(), (est, lo, hi)     # a band that excludes the estimate is widened to it
print('ok model helpers')

from pathlib import Path
if not (Path('reference/resale/resale.csv').exists() and Path('reference/resale/geocode.json').exists()):
    raise SystemExit(print('skipped: resale data / geocode cache not present'))
from tools.train_value import load, features, fit
df, geo, places = load()
X, d = features(df[df['month'] >= '2024-01'].sample(20000, random_state=1).reset_index(drop=True), geo, places)
y = d['resale_price'].astype(float).to_numpy()
cut = int(len(X) * 0.8)
m = fit(X[:cut], y[:cut])
est, lo, hi = predict(m, X[cut:])
mdape = float(np.median(np.abs(est / y[cut:] - 1)))
assert mdape < 0.15, mdape                                         # small slice: loose bar; the full run reports real metrics
assert {'d_mrt', 'd_cbd', 'd_mall', 'n_pri1k'} <= set(X.columns) and X.attrs['dropped'] >= 0
print(f'ok slice model, MdAPE {mdape:.1%}')

import json
from tools.train_value import estimate_project
if Path('reference/resale/value-model.pkl').exists():
    P = json.load(open('projects/kim-keat-crest/project.json'))
    V = estimate_project(P)
    rent = [str(s['no']) for s in P['stacks'] if s['type'] in ('RENT', 'CCA')]
    assert rent and all(n in V['skipped'] and n not in V['byStack'] for n in rent), V['skipped']
    s584 = V['byStack']['584']
    assert all(lo <= est <= hi for est, lo, hi in s584.values())
    assert V['drivers']['584']['location'] > 0, V['drivers']['584']          # Toa Payoh: above the island-wide average
    assert V['metrics']['mdape'] <= 7
    print('ok estimates', s584['16'], V['drivers']['584'])
    from tools.train_value import town_for, context
    T = json.load(open('projects/tengah-oct-2026/project.json'))
    tw = town_for(T)                                                # Tengah has no resale history: nearest trained town
    assert tw in context()['M']['cats']['town'] and tw in ('BUKIT BATOK', 'JURONG WEST', 'CHOA CHU KANG', 'BUKIT PANJANG'), tw
    assert town_for(P) == 'TOA PAYOH'
    print('ok unseen town ->', tw)
