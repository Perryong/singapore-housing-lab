// BTO build view: unit order, stage timing and the state at any moment, on a real project.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildLayout } from '../web/project.js';
import { STAGES, TOTAL, stages, buildOrder, stateAt } from '../web/build.js';

const P = JSON.parse(readFileSync(new URL('../projects/kim-keat-crest/project.json', import.meta.url)));
const L = buildLayout(P), order = buildOrder(L, P), N = order.length;
const near = (a, b, e = 1e-9) => assert.ok(Math.abs(a - b) < e, `${a} !~ ${b}`);

// stages: six, contiguous, 25 s
const S = stages();
assert.deepEqual(STAGES.map(s => s.key), ['site', 'void', 'floors', 'roof', 'paint', 'section']);
assert.equal(TOTAL, 25);
S.forEach((s, i) => assert.equal(s.t0, i ? S[i - 1].t1 : 0));
near(S.at(-1).t1, 25); near(S[2].t0, 3.8); near(S[2].t1, 17.8);

// order: every unit once, floor-major, then block, then stack
assert.equal(N, L.units.length);
assert.equal(new Set(order.map(u => u.id)).size, N);
const blocks = Object.keys(P.blocks), stackIx = new Map(P.stacks.map((s, i) => [s.no, i]));
for (let i = 1; i < N; i++) {
  const a = order[i - 1], b = order[i];
  assert.ok(a.floor <= b.floor, `floor order at ${i}`);
  if (a.floor === b.floor) {
    const ba = blocks.indexOf(a.st.blk), bb = blocks.indexOf(b.st.blk);
    assert.ok(ba <= bb, `block order at ${i}`);
    if (ba === bb) assert.ok(stackIx.get(a.st.no) < stackIx.get(b.st.no), `stack order at ${i}`);
  }
}

// state at chosen moments
let s = stateAt(0, order, L, P);
assert.equal(s.step, 0); assert.equal(s.key, 'site'); assert.equal(s.active, null); assert.equal(s.topY, 0);
for (const t of [17.8, 30]) { s = stateAt(t, order, L, P); assert.equal(s.step, N); }
assert.equal(stateAt(30, order, L, P).t, 25);
assert.equal(stateAt(-3, order, L, P).t, 0);

const k = order.findIndex(u => u.floor === 15), dur = 14 / N;
s = stateAt(3.8 + dur * k + dur / 2, order, L, P);
assert.equal(s.key, 'floors'); assert.equal(s.step, k); assert.equal(s.active, order[k]);
assert.equal(s.active.floor, 15); assert.equal(s.active.st.blk, '271A');
assert.deepEqual(s.floors, { '271A': 14, '271B': 14, '272A': 14, '272B': 14, '273A': 14 });
near(s.topY, 15 * L.FH);
near(s.drop, 0.5, 1e-6);

s = stateAt(17.8, order, L, P);
assert.equal(s.floors['272A'], 24); assert.equal(s.floors['271A'], 30);

const minFirst = Math.min(...L.stacks.map(t => t.first)), maxFloors = Math.max(...Object.values(P.blocks).map(b => b.floors));
near(stateAt(3.8 - 1e-9, order, L, P).topY, (minFirst - 1) * L.FH, 1e-6);   // at 3.8 the floors stage has begun
assert.ok(stateAt(19.6, order, L, P).topY >= maxFloors * L.FH + 4);

assert.equal(stateAt(19.5, order, L, P).paint, 0); assert.equal(stateAt(21.4, order, L, P).paint, 1);
assert.equal(stateAt(21.3, order, L, P).cut, 0); near(stateAt(21.4 + 1.8, order, L, P).cut, 0.5, 1e-6);

console.log('ok: build order and state');
