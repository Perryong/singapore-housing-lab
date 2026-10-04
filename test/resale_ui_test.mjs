import assert from 'node:assert/strict';
import { RESALE_TYPE, defaultType, psmRamp, trendSvg } from '../web/resale.js';
assert.equal(RESALE_TYPE['2RF2'], '2 ROOM');
assert.equal(defaultType({ summary: { '4 ROOM': { n: 2 }, '3 ROOM': { n: 9 } } }), '3 ROOM');
assert.equal(defaultType({ summary: { '4 ROOM': { n: 3 }, '3 ROOM': { n: 9 } } }), '4 ROOM');
assert.equal(psmRamp(0, 5, 10).toLowerCase(), '#dcebfa'); assert.equal(psmRamp(99, 5, 10).toLowerCase(), '#0b3c7a');
assert.equal(trendSvg([['2026-01', 1]]), '');
assert.match(trendSvg([['2026-01', 9000], ['2026-02', 9500]]), /<polyline[^>]+points=/);
console.log('ok');
