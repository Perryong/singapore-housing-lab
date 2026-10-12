"""Evaluate the Value-tab resale model against simple baselines, by segment, and across time.

usage: python3 tools/eval_value.py   -> docs/model/eval.json, docs/model/pred-vs-actual.svg (read by docs/model/README.md)

Same time split as train_value.py: train on everything before the last 6 months, test on the last 6 months.
Backtest: the same split repeated at earlier cut-offs (each a fresh model that never sees its test months).
"""
import json, sys
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.linear_model import Ridge
from sklearn.compose import make_column_transformer
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import OneHotEncoder, StandardScaler

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / 'tools'))
from train_value import CAT, NUM, fit, features, load, month_index   # noqa: E402

OUT = ROOT / 'docs/model'
mdape = lambda est, y: round(float(np.median(np.abs(est / y - 1))) * 100, 2)


def baselines(X, y, tr, te):
    """Town x flat-type median (last 12 train months), its price-per-sqm version, and a linear model on log price."""
    recent = tr & (X['mi'] > X.loc[tr, 'mi'].max() - 12)
    k = lambda m: (X.loc[m, 'town'].astype(str) + '|' + X.loc[m, 'type'].astype(str)).to_numpy()
    med = pd.Series(y[recent]).groupby(k(recent)).median()
    psm = pd.Series(y[recent] / X.loc[recent, 'sqm'].to_numpy()).groupby(k(recent)).median()
    fall, fall_psm = np.median(y[recent]), np.median(y[recent] / X.loc[recent, 'sqm'].to_numpy())
    keys = k(te)
    lin = make_pipeline(make_column_transformer((OneHotEncoder(handle_unknown='ignore'), CAT), (StandardScaler(), NUM)),
                        Ridge(alpha=1.0)).fit(X[tr], np.log(y[tr]))
    return {'Town x type median price': np.array([med.get(q, fall) for q in keys]),
            'Town x type median $/sqm x area': np.array([psm.get(q, fall_psm) for q in keys]) * X.loc[te, 'sqm'].to_numpy(),
            'Linear model (same features)': np.exp(lin.predict(X[te]))}


def split(X, cut):
    return (X['mi'] <= cut).to_numpy(), ((X['mi'] > cut) & (X['mi'] <= cut + 6)).to_numpy()


def svg(est, y, path, n=3000):
    """Predicted vs actual scatter (a random sample), log axes, no plotting dependency."""
    rng = np.random.default_rng(0)
    i = rng.choice(len(y), min(n, len(y)), replace=False)
    lo, hi = np.log(200e3), np.log(1.8e6)
    S, P = 420, 50
    f = lambda v: P + (np.log(np.clip(v, 200e3, 1.8e6)) - lo) / (hi - lo) * S
    dots = ''.join(f'<circle cx="{f(a):.1f}" cy="{P + S - f(b) + P:.1f}" r="1.6"/>' for a, b in zip(y[i], est[i]))
    ticks = ''.join(f'<text x="{f(v):.0f}" y="{S + P + 18}" text-anchor="middle">${v // 1000:.0f}k</text>'
                    f'<text x="{P - 6}" y="{2 * P + S - f(v) + 4:.0f}" text-anchor="end">${v // 1000:.0f}k</text>'
                    for v in (300e3, 500e3, 800e3, 1.2e6))
    path.write_text(
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {S + 2 * P} {S + 2 * P + 10}" font-family="sans-serif" font-size="11">'
        f'<rect width="100%" height="100%" fill="#fff"/><rect x="{P}" y="{P}" width="{S}" height="{S}" fill="none" stroke="#bbb"/>'
        f'<line x1="{P}" y1="{P + S}" x2="{P + S}" y2="{P}" stroke="#E07A1F" stroke-width="1.5"/>'
        f'<g fill="#2B4C7E" fill-opacity=".35">{dots}</g>{ticks}'
        f'<text x="{P + S / 2}" y="{S + 2 * P + 6}" text-anchor="middle">Actual resale price (log scale)</text>'
        f'<text x="14" y="{P + S / 2}" text-anchor="middle" transform="rotate(-90 14 {P + S / 2})">Model estimate</text>'
        f'<text x="{P}" y="{P - 12}" font-size="13" font-weight="bold">Estimate vs actual, last 6 months (unseen), {len(i):,} sales</text></svg>')


def main():
    df, geo, places = load()
    X, d = features(df, geo, places)
    y = d['resale_price'].astype(float).to_numpy()
    last = month_index(d['month'].max())
    tr, te = split(X, last - 6)
    est = np.exp(fit(X[tr], y[tr])['mid'].predict(X[te]))
    yt = y[te]
    res = {'asOf': d['month'].max(), 'nTrain': int(tr.sum()), 'nTest': int(te.sum()),
           'model': {'mdape': mdape(est, yt), 'within5': round(float(np.mean(np.abs(est / yt - 1) <= 0.05)) * 100, 1),
                     'within10': round(float(np.mean(np.abs(est / yt - 1) <= 0.10)) * 100, 1)},
           'baselines': {k: mdape(v, yt) for k, v in baselines(X, y, tr, te).items()}}
    T = X[te].assign(err=np.abs(est / yt - 1) * 100)
    T['floors'] = pd.cut(T['storey'], [0, 6, 12, 24, 99], labels=['1-6', '7-12', '13-24', '25+'])
    seg = lambda c: [{'k': str(k), 'n': int(len(g)), 'mdape': round(float(g['err'].median()), 2)}
                     for k, g in T.groupby(c, observed=True)]
    res['byType'], res['byFloors'] = seg('type'), seg('floors')
    res['byTown'] = sorted(seg('town'), key=lambda r: -r['mdape'])
    res['backtest'] = []
    for back in (30, 24, 18, 12, 6):                             # cut-offs every 6 months over the last 3 years
        a, b = split(X, last - 6 - back)
        e = np.exp(fit(X[a], y[a])['mid'].predict(X[b]))
        m0 = X.loc[b, 'mi'].min()
        res['backtest'].append({'test': f'{2017 + m0 // 12}-{m0 % 12 + 1:02d} +6 mo', 'n': int(b.sum()), 'mdape': mdape(e, y[b])})
        print(res['backtest'][-1])
    res['backtest'].append({'test': 'latest 6 months', 'n': res['nTest'], 'mdape': res['model']['mdape']})
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / 'eval.json').write_text(json.dumps(res, indent=1))
    svg(est, yt, OUT / 'pred-vs-actual.svg')
    print(json.dumps({k: res[k] for k in ('model', 'baselines')}, indent=1))


if __name__ == '__main__':
    main()
