# Resale model quality guard, on the committed results of tools/eval_value.py (CI has no resale data to retrain on).
# Re-run the tool after retraining; this fails if the new model got worse than these bars.
import json
from pathlib import Path

r = json.loads(Path('docs/model/eval.json').read_text())
m = r['model']['mdape']
assert m <= 4.0, f'median error {m}% > 4%'
assert all(m * 2 <= b for b in r['baselines'].values()), f'model ({m}%) not 2x better than every baseline: {r["baselines"]}'
assert max(w['mdape'] for w in r['backtest']) <= 4.5, r['backtest']                    # no bad period
assert r['model']['within10'] >= 90, r['model']
assert r['nTest'] >= 5000
# the numbers the app shows come from the same model run
for f in Path('projects').glob('*/project.json'):
    v = json.loads(f.read_text()).get('value')
    if v:
        assert v['metrics']['mdape'] <= 4.0, (f, v['metrics'])
print('ok', {'mdape': m, 'baselines': r['baselines'], 'worst backtest': max(w['mdape'] for w in r['backtest'])})
