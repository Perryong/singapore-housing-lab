import assert from 'node:assert/strict';
import { money, range } from '../web/format.js';
assert.equal(money(592000), '$592k'); assert.equal(money(1200000), '$1.2m'); assert.equal(money(1038000), '$1.04m');
assert.equal(range(592000, 810000), '$592k–$810k');
console.log('ok');
assert.equal(money(999600), '$1m');                                       // rounds up to a million: not "$1000k"
import { fmtTime } from '../web/format.js';
assert.equal(fmtTime(1439.8), '12:00 am');                                // last half-minute of the day rounds to midnight
console.log('ok edges');
