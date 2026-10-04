from tools.fetch_resale import aggregate, nearby_blocks
from tools.fetch_context import norm
R = lambda m, b, s, t, sqm, p, left='60 years 01 month': dict(month=m, block=b, street_name=s, flat_type=t,
    storey_range='04 TO 06', floor_area_sqm=str(sqm), flat_model='Model A', lease_commence_date='1990',
    remaining_lease=left, resale_price=str(p), town='X')
B = {('1', norm('FOO ST 1')): dict(x=10, z=0, ctx=0, storeys=12, lease=1990),
     ('2', norm('FOO ST 1')): dict(x=20, z=0, ctx=None, storeys=10, lease=1985)}
rows = [R('2026-10', '1', 'FOO ST 1', '4 ROOM', 90, 900000), R('2026-09', '1', 'FOO ST 1', '4 ROOM', 90, 810000),
        R('2026-01', '1', 'FOO ST 1', '4 ROOM', 100, 1000000), R('2024-10', '1', 'FOO ST 1', '4 ROOM', 90, 1),  # 25th month back -> excluded
        R('2026-05', '2', 'FOO ST 1', '3 ROOM', 70, 500000), R('2026-05', '9', 'OTHER RD', '4 ROOM', 90, 2)]       # unknown block -> excluded
A = aggregate(rows, B, '2026-10')
assert A['summary']['4 ROOM'] == {'n': 3, 'median': 900000, 'psm': 10000, 'leaseLeft': 60}
assert A['summary']['3 ROOM']['n'] == 1 and 'median' not in A['summary']['3 ROOM']        # too few sales
assert [s['price'] for s in A['sales']] == [900000, 810000, 500000, 1000000]                # newest first
assert {b['blk'] for b in A['blocks']} == {'1', '2'} and A['radiusM'] == 900 and A['months'] == 24
import json, os, sys
if not os.path.exists('reference/hdb/hdb-buildings.geojson'):   # large data.gov.sg download, not in the repo
    sys.exit(print('ok (linking check skipped: reference/hdb/hdb-buildings.geojson not present)'))
P = json.load(open('projects/kebun-baru-ridge/project.json'))
blocks, unlinked = nearby_blocks(P)
assert ('179', norm('ANG MO KIO AVE 5')) in blocks      # resale spelling "AVE" must link to OneMap "AVENUE"
assert blocks[('179', norm('ANG MO KIO AVE 5'))]['storeys'] > 0
b1 = next(b for b in A['blocks'] if b['blk'] == '1')
assert [r['price'] for r in b1['recent']] == [900000, 810000, 1000000]   # per-block, newest first
print('ok')
