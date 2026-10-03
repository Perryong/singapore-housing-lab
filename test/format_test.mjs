import assert from 'node:assert/strict';
import { money, range } from '../web/format.js';
assert.equal(money(592000), '$592k'); assert.equal(money(1200000), '$1.2m'); assert.equal(money(1038000), '$1.04m');
assert.equal(range(592000, 810000), '$592k–$810k');
console.log('ok');
