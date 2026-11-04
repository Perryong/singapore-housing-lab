// BTO build view: unit order, stage timing and the state at any moment, on a real project.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildLayout } from '../web/project.js';
import { STAGES, TOTAL, stages, buildOrder, stateAt, timelineHtml, activeCardHtml, structureHtml, logLines, titleBlockHtml, pickMime } from '../web/build.js';
import { catOf, sizeOf } from '../web/project.js';

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

// panels: real flat type and area, per-block floors, log batching, scrubbing back
s = stateAt(3.8 + dur * k + dur / 2, order, L, P);
let h = activeCardHtml(s, P, N);
const u = s.active;
assert.ok(h.includes(`BLK 271A · #15-${u.st.no}`), h);
assert.ok(h.includes(P.categories[catOf(P, u.code)].name) && h.includes(`${sizeOf(P, u.code)[0]} m²`) && h.includes(`/ ${N}`), h);
assert.ok(h.includes(`#${String(k).padStart(String(N).length, '0')} / ${N}`), h);
assert.ok(activeCardHtml(stateAt(1, order, L, P), P, N).includes('—'));

h = structureHtml(stateAt(17.8, order, L, P), P);
assert.equal((h.match(/<div/g) || []).length, 5);
assert.ok(h.includes('24 / 24') && h.includes('30 / 30'));
assert.ok(structureHtml(s, P).includes('class="cur"'));

const lines = logLines(order, 0, 25, P, 0.012);
assert.ok(lines.length && lines.every(l => l.startsWith('ASM BLK ')), lines);
const l2 = order.filter(v => v.floor === order[0].floor && v.st.blk === order[0].st.blk).length;
assert.ok(lines[0].startsWith(`ASM BLK ${order[0].st.blk} · L${order[0].floor} · ${l2} units · `), lines[0]);
assert.deepEqual(logLines(order, 5, 3, P, 0.2), []);
const one = logLines(order, 0, 1, P, 0.2);
assert.equal(one.length, 1); assert.match(one[0], /^ASM BLK \S+ · L\d+ · stack \d+ · /);

h = timelineHtml(stateAt(10, order, L, P));
assert.match(h, /class="cur"[^]*?03 TYPICAL FLOORS/);
assert.ok(titleBlockHtml({ ...P, name: '<x>' }, s, { az: 212, el: 24 }).includes('&lt;X&gt;'));
assert.ok(titleBlockHtml(P, s, { az: 212, el: 24 }).includes('AZ 212° · EL +24°'));

assert.deepEqual(pickMime(m => m === 'video/webm'), { mime: 'video/webm', ext: 'webm' });
assert.deepEqual(pickMime(m => m.startsWith('video/mp4')), { mime: 'video/mp4;codecs=avc1', ext: 'mp4' });
assert.equal(pickMime(() => false), null);

console.log('ok: build order and state');
