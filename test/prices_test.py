import sys
from pathlib import Path
if not Path('reference/hdb/oct25-Annex-ABTO-sales-exercise-Oct-2025.pdf').exists():
    sys.exit(print('skipped: HDB launch annex PDFs are not in the repo'))
from tools.fetch_prices import parse_annex
A = parse_annex('reference/hdb/oct25-Annex-ABTO-sales-exercise-Oct-2025.pdf')
assert A['Ping Yi Court']['prices']['4RM'] == {'min': 498000, 'max': 624000, 'sqm': 93, 'internalSqm': 90, 'units': 294, 'waitingMonths': 33}, A['Ping Yi Court']['prices'].get('4RM')
assert A['Ping Yi Court']['prices']['2RF1']['sqm'] == 40 and A['Ping Yi Court']['prices']['2RF2']['sqm'] == 48
assert A['Ping Yi Court']['resaleComparables']['4RM'] == {'min': 745000, 'max': 845000}
assert set(A['Mount Pleasant Crest']['prices']) >= {'2RF1', '2RF2', '3RM', '4RM'}
assert 'Chencharu Grove' in A and A['Chencharu Grove']['prices']['5RM']['units'] == 236
assert A['Berlayar Residences']['prices']['4RM']['min'] > 0
print('ok')
J = parse_annex('reference/hdb/annex-jun26.pdf')
assert J['Kebun Baru Breeze']['prices']['4RM']['waitingMonths'] == 52, J['Kebun Baru Breeze']['prices']['4RM']['waitingMonths']
assert J['Kebun Baru Ridge']['prices']['4RM']['waitingMonths'] == 37
print('ok waiting')
assert J['Berlayar Rise']['prices']['4RM']['waitingMonths'] == 49 and J['Berlayar Rise']['prices']['4RM'].get('waitingMonthsMax') == 54
assert 'waitingMonthsMax' not in J['Kebun Baru Ridge']['prices']['4RM']    # single waiting time
print('ok waiting range')
