// The 3D plan's unseen ceiling: covers everything the flat encloses, leaves outdoor notches open.
import assert from 'node:assert/strict';
import { lidRects } from '../web/lid.js';

const covers = (rects, x, z) => rects.some(([x0, z0, x1, z1]) => x >= x0 && x <= x1 && z >= z0 && z <= z1);
const wall = (x0, z0, x1, z1) => ({ rect: [x0, z0, x1, z1], kind: 'solid' });

// four walls round a space no room polygon covers (a room the brochure extraction lost): still roofed
const ring = [wall(0, 0, 4, 0.1), wall(0, 2.9, 4, 3), wall(0, 0, 0.1, 3), wall(3.9, 0, 4, 3)];
assert.ok(covers(lidRects([], ring), 2, 1.5), 'enclosed gap is roofed');
assert.ok(!covers(lidRects([], ring), 6, 1.5), 'outside stays open');

// two rooms with a door-wide gap between them, no wall rect over the doorway
const rooms = [{ poly: [[0, 0], [3, 0], [3, 3], [0, 3]] }, { poly: [[3.2, 0], [6, 0], [6, 3], [3.2, 3]] }];
const split = [wall(3, 0, 3.2, 1), wall(3, 1.9, 3.2, 3)];
assert.ok(covers(lidRects(rooms, split), 3.1, 1.45), 'doorway between two rooms is roofed');

// L-shaped flat: the outdoor notch is not roofed, so sun still reaches windows that face it
const L = [{ poly: [[0, 0], [6, 0], [6, 3], [3, 3], [3, 6], [0, 6]] }];
assert.ok(covers(lidRects(L, []), 1, 5) && !covers(lidRects(L, []), 5, 5), 'notch stays open');

// rooms the extraction left with one or two points do not throw
assert.ok(covers(lidRects([{ poly: [[1, 1]] }, { poly: [[0, 0], [1, 1]] }, ...L], []), 1, 1));
assert.deepEqual(lidRects([], []), []);
console.log('ok: ceiling covers enclosed gaps, leaves notches open');
