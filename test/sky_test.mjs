import assert from 'node:assert/strict';
import { sunTimes } from '../web/sun.js';
import { moonTimes, moonPhase, sgtNow, phaseSvg } from '../web/moon.js';

// reference: US Naval Observatory (aa.usno.navy.mil), Kim Keat Crest site, UTC+8
const site = { lat: 1.3333, lon: 103.8606, tz: 8 };
const hm = s => { const [h, m] = s.split(':').map(Number); return h * 60 + m; };
const near = (got, want, tol, what) => assert.ok(got != null && Math.abs(got - hm(want)) <= tol, `${what}: got ${got && `${Math.floor(got / 60)}:${String(Math.round(got % 60)).padStart(2, '0')}`}, want ${want}`);

for (const [y, m, d, rise, noon, set] of [[2026, 6, 21, '07:00', '13:06', '19:12'], [2026, 10, 10, '06:49', '12:52', '18:54'], [2026, 12, 21, '07:01', '13:02', '19:04']]) {
  const s = sunTimes(site, y, m, d);
  near(s.rise, rise, 2, `sunrise ${d}/${m}`); near(s.noon, noon, 2, `noon ${d}/${m}`); near(s.set, set, 2, `sunset ${d}/${m}`);
}
for (const [y, m, d, rise, set] of [[2026, 6, 21, '12:32', '00:10'], [2026, 10, 10, '06:15', '18:35'], [2026, 12, 21, '16:13', '03:47']]) {
  const t = moonTimes(site, y, m, d);
  near(t.rise, rise, 5, `moonrise ${d}/${m}`); near(t.set, set, 5, `moonset ${d}/${m}`);
}
const ph = ms => moonPhase(ms);
assert.ok(ph(Date.UTC(2026, 9, 10, 15, 50)).illum < 0.01 && ph(Date.UTC(2026, 9, 10, 15, 50)).name === 'New moon');
assert.ok(ph(Date.UTC(2026, 9, 26, 4, 12)).illum > 0.99 && ph(Date.UTC(2026, 9, 26, 4, 12)).name === 'Full moon');
assert.equal(ph(Date.UTC(2026, 9, 18, 8, 12)).name, 'First quarter');
const g = ph(Date.UTC(2026, 11, 21, 4)); assert.ok(Math.abs(g.illum - 0.88) < 0.04 && g.name === 'Waxing gibbous', JSON.stringify(g));
const c = ph(Date.UTC(2026, 5, 21, 4)); assert.ok(Math.abs(c.illum - 0.42) < 0.04 && c.name === 'Waxing crescent', JSON.stringify(c));
// Singapore wall-clock time, whatever the viewer's timezone
assert.deepEqual(sgtNow(Date.UTC(2026, 9, 10, 16, 30)), { y: 2026, m: 10, d: 11, min: 30 });
assert.ok(!phaseSvg(0, true).includes('<path') && phaseSvg(0.5, true).includes('<path'));   // new moon: no lit part
console.log('ok');
