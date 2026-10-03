// Ported logic must reproduce the original site's stack table (captured live for 2 Oct 2026).
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { buildLayout } from '../web/project.js';
import { computeDay } from '../web/sun.js';

// stack: [AM, PM] as shown on thomsonreserve.sgpropai.com/sun-study for 2026-10-02
const EXPECTED = `16 5.0 0.0|17 0.2 0.0|24 5.5 0.0|25 5.5 0.0|26 5.5 0.0|38 3.0 0.0|39 0.2 0.0|47 5.5 0.0|48 5.5 0.0|49 5.5 0.0|18 5.7 0.2|40 3.6 0.2|33 5.8 0.2|34 5.8 0.2|35 5.8 0.2|50 5.8 0.3|27 5.8 0.3|07 0.0 0.5|01 5.8 0.5|02 5.8 0.5|03 5.8 0.5|04 5.8 0.5|08 0.0 2.7|06 0.0 3.0|09 5.7 3.0|55 0.0 3.6|54 0.0 3.8|46 5.5 3.8|53 0.0 4.0|52 0.0 5.0|23 5.5 5.3|29 0.0 5.5|30 0.0 5.5|31 0.0 5.5|32 5.3 5.5|37 3.3 5.6|15 5.0 5.7|05 5.8 6.0|10 2.8 6.0|11 0.3 6.0|12 0.3 6.0|13 0.3 6.0|14 0.3 6.0|19 5.8 6.0|20 0.0 6.0|21 0.0 6.0|22 0.0 6.0|28 0.2 6.0|36 5.8 6.0|41 4.0 6.0|42 0.3 6.0|43 0.3 6.0|44 0.3 6.0|45 0.3 6.0|51 5.8 6.0`
  .split('|').map(r => r.split(' ').map(Number));

const P = JSON.parse(readFileSync(new URL('../projects/thomson-reserve/project.json', import.meta.url)));
const L = buildLayout(P);
computeDay(L, P.site, 2026, 10, 2);
assert.equal(L.stacks.length, EXPECTED.length);
for (const [no, am, pm] of EXPECTED) {
  const st = L.stacks.find(s => s.no === no);
  assert.equal(st.am.toFixed(1), am.toFixed(1), `stack ${no} AM`);
  assert.equal(st.pm.toFixed(1), pm.toFixed(1), `stack ${no} PM`);
}
console.log(`ok: ${EXPECTED.length} stacks match the original, ${L.units.length} units`);
