// Feature buildings (P.blockers) shade units like P.context; they can only remove sun.
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { buildLayout } from '../web/project.js';
import { computeDay, computeNow, unitSun } from '../web/sun.js';
import { unitCardHtml } from '../web/unit.js';

const root = new URL('..', import.meta.url).pathname;
// baseline without blockers, even once project.json carries them (Task 5)
const { blockers: _, ...P } = JSON.parse(readFileSync(new URL('../projects/bishan-terraces/project.json', import.meta.url)));
const strip = L => JSON.parse(JSON.stringify({ ...L, stacks: L.stacks.map(s => ({ ...s, units: s.units.length })),
  units: L.units.map(u => ({ ...u, st: u.st.no })) }));

// absent / empty blockers -> layout unchanged
const base = buildLayout(P);
assert.deepEqual(strip(buildLayout({ ...P, blockers: [] })), strip(base));
assert.equal(base.context.length, P.context.length);

// synthetic: a 200 m tower 30 m sunward of a lit unit's facade puts it in shade
computeNow(base, P.site, 2026, 6, 21, 9 * 60);
const u = base.units.find(u => u.now === 'lit' && u.floor < 5), sun = computeNow(base, P.site, 2026, 6, 21, 9 * 60).s;
const fp = u.st.fp.find(f => f.nx * sun[0] + f.nz * sun[2] >= 0.03), len = Math.hypot(sun[0], sun[2]);
const bx = fp.px + sun[0] / len * 30, bz = fp.pz + sun[2] / len * 30, sq = [[-8, -8], [8, -8], [8, 8], [-8, 8]];
const tower = { k: 'school', h: 200, p: sq.map(([x, z]) => [bx + x, bz + z]) };
const LB = buildLayout({ ...P, blockers: [tower] });
assert.equal(LB.context.length, P.context.length + 1);
assert.deepEqual(LB.context.slice(0, -1), base.context);              // P.context entries first, untouched
assert.equal(unitSun(base, u, sun).st, 'lit');
assert.notEqual(unitSun(LB, LB.units[u.id], sun).st, 'lit');
console.log('ok: synthetic blocker shades unit', u.st.no, 'floor', u.floor);

// shade text names what blocked: the synthetic school tower, or a P.context (HDB) block
const cur = { y: 2026, m: 6, d: 21, min: 9 * 60 };
computeDay(LB, P.site, 2026, 6, 21); computeDay(base, P.site, 2026, 6, 21);   // the card shows day totals too
computeNow(LB, P.site, 2026, 6, 21, 9 * 60);
const uB = LB.units[u.id];
assert.equal(uB.now, 'shade'); assert.equal(uB.by, 'school');
assert.match(unitCardHtml(P, '', uB.st, uB, cur), /shaded by a nearby school\./);
let hdbU;
for (let min = 7 * 60; min <= 18 * 60 && !hdbU; min += 10) {
  computeNow(base, P.site, 2026, 6, 21, min);
  const v = base.units.find(v => v.now === 'shade' && v.by === 'hdb');
  if (v) hdbU = [v, { ...cur, min }];
}
assert.ok(hdbU, 'bishan-terraces has a unit shaded by a context block');
assert.match(unitCardHtml(P, '', hdbU[0].st, hdbU[0], hdbU[1]), /shaded by a neighbouring HDB block\./);
console.log('ok: shade text names a school blocker and keeps the HDB wording for context blocks');

// real project: the committed bishan-terraces blockers -> every unit's daily sun minutes <= without (no caches needed)
const { blockers } = JSON.parse(readFileSync(root + 'projects/bishan-terraces/project.json'));
assert.ok(blockers?.length > 0, 'bishan-terraces has feature blockers');
const L0 = buildLayout(P), L1 = buildLayout({ ...P, blockers });
for (const [m, d] of [[6, 21], [9, 22], [12, 21]]) {
  computeDay(L0, P.site, 2026, m, d); computeDay(L1, P.site, 2026, m, d);
  let changed = 0, drop = 0;
  L0.units.forEach((u0, i) => {
    const a = (u0.am + u0.pm) * 60, b = (L1.units[i].am + L1.units[i].pm) * 60;
    assert.ok(b <= a + 1e-9, `unit ${i} ${m}/${d}: ${b} > ${a} min`);
    if (b < a - 1e-9) { changed++; drop = Math.max(drop, a - b); }
  });
  console.log(`ok: ${m}/${d} ${blockers.length} blockers, ${changed}/${L0.units.length} units lose sun, largest drop ${drop.toFixed(0)} min`);
}
