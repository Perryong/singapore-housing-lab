import assert from 'node:assert/strict';
import { kindColour, isGround, hostOutline, offsetOutline, hostRingShapes } from '../web/surround.js';

assert.equal(kindColour('school'), '#2E8B57'); assert.equal(kindColour('campus'), '#2E8B57');
assert.equal(kindColour('health'), '#A61E4D'); assert.equal(kindColour('cc'), '#1F7A8C'); assert.equal(kindColour('nope'), null);
assert.ok(isGround({ k: 'park', h: 0.2 })); assert.ok(isGround({ k: 'cc', h: 0.2 })); assert.ok(!isGround({ k: 'cc', h: 10 }));

const P = { surround: [{ k: 'hdb', h: 30, p: [[0, 0], [10, 0], [10, 10], [0, 10]] }], context: [{ h: 30, p: [[20, 0], [30, 0], [30, 10]] }],
  amenities: [{ cat: 'clinic', host: { s: 0 } }, { cat: 'clinic', host: { c: 0 } }, { cat: 'preschool', host: { s: 9 } },
    { cat: 'supermarket', host: { c: -1 } }, { cat: 'clinic' }, { cat: 'clinic', host: {} }] };
assert.deepEqual(hostOutline(P, { s: 0 }), P.surround[0].p);
assert.deepEqual(hostOutline(P, { c: 0 }), P.context[0].p);
for (const h of [{ s: 9 }, { c: -1 }, {}, null, undefined]) assert.equal(hostOutline(P, h), null);
const r = hostRingShapes(P);
assert.deepEqual(Object.keys(r), ['clinic']); assert.equal(r.clinic.length, 2);   // invalid hosts skipped

const o = offsetOutline([[0, 0], [10, 0], [10, 10], [0, 10]], 1);                 // square grows by 1 m each side
const xs = o.map(q => q[0]), zs = o.map(q => q[1]);
assert.ok(Math.abs(Math.min(...xs) + 1) < 1e-9 && Math.abs(Math.max(...xs) - 11) < 1e-9 && Math.abs(Math.min(...zs) + 1) < 1e-9);
const cw = offsetOutline([[0, 0], [0, 10], [10, 10], [10, 0]], 1);                // either winding grows outward
assert.ok(Math.abs(Math.max(...cw.map(q => q[0])) - 11) < 1e-9);

assert.deepEqual(hostRingShapes({ surround: P.surround, amenities: [{ cat: 'bogus', host: { s: 0 } }] }), {});   // unknown category skipped

// Review focus 5: nothing nearby
assert.deepEqual(hostRingShapes({}), {}); assert.deepEqual(hostRingShapes({ surround: [], amenities: [] }), {});
console.log('ok');
