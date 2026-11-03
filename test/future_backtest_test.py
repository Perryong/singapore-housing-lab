# The future BTO rules run as of the 2019 Master Plan must pick out later HDB sites better than the baselines.
import sys
from pathlib import Path

NEED = ['reference/ura/mp2019.geojson', 'reference/ura/rail2019.geojson', 'reference/ura/osm-buildings.raw',
        'reference/ura/new-blocks.json', 'reference/hdb/hdb-property.csv']
if not all(Path(f).exists() for f in NEED):
    sys.exit(print('skipped: no reference/ura caches (python3 tools/fetch_landuse.py)'))
sys.path.insert(0, 'tools')
from predict_future import run  # noqa: E402

_, bt = run(2019)
print(bt)
assert bt['n'] >= 60, bt
# most later sites must still read as vacant in 2019, or the test measures today's buildings, not the rules
assert bt['inCandidates'] >= 0.5, bt
assert bt['topDecile'] > bt['mrtOnly'], bt
assert bt['topDecile'] > bt['random'], bt
print('ok: backtest beats MRT distance and random')
