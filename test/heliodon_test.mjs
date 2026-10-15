import assert from 'node:assert/strict';
import { helioAt, HOME, NBR, WIN, R } from '../web/heliodon.js';

// 21 Dec, the How-it-works heliodon: one west-facing window and a taller neighbour to the south-west
const at = (h, m = 0) => helioAt(h * 60 + m);
assert.equal(at(10).st, 'away', 'morning sun is east of a west-facing window');
assert.equal(at(15).st, 'lit', 'high afternoon sun clears the neighbour');
const late = at(17, 30);
assert.equal(late.st, 'shade'); assert.equal(late.by, 'nbr');
assert.equal(at(21).st, 'night');

// the ray ends on the neighbour's wall when shaded, at the lamp (R from the window) when lit
const [x, y, z] = late.hit;
assert.ok(Math.abs(x - NBR.cx) <= NBR.hx + 1e-6 && Math.abs(z - NBR.cz) <= NBR.hz + 1e-6 && y >= 0 && y <= NBR.H + 1e-6, `hit ${late.hit} on the neighbour`);
const lit = at(15), d = Math.hypot(lit.hit[0] - WIN.px, lit.hit[1] - WIN.y, lit.hit[2] - WIN.pz);
assert.ok(Math.abs(d - R) < 1e-6, `lamp ${d} m from the window`);
assert.ok(HOME.H < NBR.H);
console.log('heliodon ok');
