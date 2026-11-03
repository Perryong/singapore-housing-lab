# The future BTO rules run as of the 2019 Master Plan must pick out later HDB sites better than the baselines.
import sys
from pathlib import Path

NEED = ['reference/ura/mp2019.geojson', 'reference/ura/rail2019.geojson', 'reference/ura/osm-buildings.raw',
        'reference/ura/new-blocks.json', 'reference/hdb/hdb-property.csv']
if not all(Path(f).exists() for f in NEED):
    sys.exit(print('skipped: no reference/ura caches (python3 tools/fetch_landuse.py)'))
sys.path.insert(0, 'tools')
import json, math  # noqa: E402
from fetch_context import local_xz  # noqa: E402
from future_score import backtest, contains, load_ref  # noqa: E402
from predict_future import backtest_sites, run  # noqa: E402

parcels, bt = run(2019)
print(bt)
sites = backtest_sites()
ids = {q['id'] for q in parcels}
# the 2019 run sees the 2019 plan: no parcel URA amended later
amended = {f['properties']['OBJECTID'] for f in json.loads(open('reference/ura/mp2019.geojson').read())['features']
           if str(f['properties']['FMEL_UPD_D'])[:4] >= '2020'}
assert not ids & amended, len(ids & amended)
# projects launched since 2025 did not exist in 2019, so the run must not drop their parcels as 'already a BTO'.
# Most still aren't candidates: in 2019 they were school land, built-up, or redrawn by URA later (4 of 29 were open).
projects = [(p['lat'], p['lon']) for p in json.load(open('projects/index.json'))]
assert sum(any(contains(q['rings'], *s) for q in parcels) for s in projects) >= 1
# the lead must not come from one estate alone
tengah = next(a for a in load_ref('reference/ura/growth-areas.json') if a['name'] == 'Tengah')
rest = [s for s in sites if math.hypot(*local_xz(tengah['lat'], tengah['lon'], s[1], s[0])) > tengah['radiusM']]
bt_rest = backtest(parcels, rest)
print('outside Tengah', bt_rest)
assert bt_rest['topDecile'] > bt_rest['mrtOnly'] and bt_rest['topDecile'] > bt_rest['random'], bt_rest
assert bt['n'] >= 60, bt
# later sites must still read as vacant in 2019, or the test measures today's buildings, not the rules
# (0.09 when new blocks' car parks and pavilions were left standing; 0.28 once cleared)
assert bt['inCandidates'] >= 0.2, bt
assert bt['topDecile'] > bt['mrtOnly'], bt
assert bt['topDecile'] > bt['random'], bt
print('ok: backtest beats MRT distance and random')
