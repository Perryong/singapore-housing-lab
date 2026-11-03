// Future BTO map panel: filters, parcel styles, the card and the backtest note.
import assert from 'node:assert/strict';
import { BAND, FILTERS, visible, style, cardHtml, noteText } from '../web/future.js';

const P = { id: 1, name: 'Kranji <b>', ring: [[1.42, 103.75], [1.43, 103.75], [1.43, 103.76]], score: 86, band: 'likely', horizon: 'near',
  reasons: [['In announced growth area: Kranji (~14,000 homes)', 40], ['Kranji MRT 450 m', 15]], areaHa: 31.2, lu: 'RESIDENTIAL',
  gpr: '3.0', announced: true, source: 'https://www.ura.gov.sg/news/media/pr25-32/' };
const Q = { ...P, name: 'Unannounced · near Bukit Batok', band: 'longshot', horizon: 'far', announced: false, source: null, gpr: null };

assert.deepEqual(FILTERS, ['all', 'near', 'far', 'announced']);
assert.deepEqual(Object.keys(BAND), ['likely', 'possible', 'longshot']);
assert.ok([P, Q].every(p => visible(p, 'all')));
assert.ok(visible(P, 'near') && !visible(Q, 'near'));
assert.ok(!visible(P, 'far') && visible(Q, 'far'));
assert.ok(visible(P, 'announced') && !visible(Q, 'announced'));

assert.deepEqual(style(P), { color: '#fff', weight: 1.5, dashArray: null, fillColor: '#E8931C', fillOpacity: 0.6 });
assert.equal(style(Q).dashArray, '5 4');
assert.equal(style(Q).fillColor, '#7E8C90');

const h = cardHtml(P);
assert.ok(h.includes('Kranji &lt;b&gt;') && !h.includes('Kranji <b>'));
assert.ok(h.includes('Likely') && h.includes('≤ 5 years') && h.includes('<b>86</b>'));
assert.ok(h.includes('31.2 ha · Residential · GPR 3.0'));
assert.ok(h.includes('In announced growth area: Kranji (~14,000 homes)') && h.includes('+40') && h.includes('+15'));
assert.ok(h.includes('An estimate from URA zoning, not an HDB announcement.'));
assert.ok(h.includes('<a href="https://www.ura.gov.sg/news/media/pr25-32/"'));
const k = cardHtml(Q);
assert.ok(k.includes('Long shot') && k.includes('5–10 years') && k.includes('GPR —') && !k.includes('<a '));

assert.equal(noteText({ topDecile: 0.62, mrtOnly: 0.31, random: 0.06, n: 80, inCandidates: 0.6, dropped: ['rezoned'] }, { growthAreas: '2026-11-03' }),
  'Backtest on the 2019 plan: 62% of 80 new HDB sites (blocks finished 2022–26 and BTOs launched since Oct 2025) fell in the top 10% of parcels (MRT distance alone: 31%, random: 6%). Rezoning not tested. Announcements reviewed 3 Nov 2026.');

console.log('ok: future panel');
