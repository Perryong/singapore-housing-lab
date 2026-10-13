// Side-panel HTML renderers on a real project (pure modules; no browser, no three.js).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildLayout } from '../web/project.js';
import { unitCardHtml, stackTable, legendHtml, card16 } from '../web/unit.js';
import { pickerHtml, cmpHtml } from '../web/picker.js';
import { amenitiesHtml } from '../web/nearby.js';
import { valueHtml } from '../web/value.js';
import { resalePanelHtml, resaleCardHtml, resaleLegendHtml } from '../web/resale.js';
import { esc, fmtTime } from '../web/format.js';

const P = JSON.parse(readFileSync('projects/kim-keat-crest/project.json'));
const INDEX = JSON.parse(readFileSync('projects/index.json'));
const { stacks } = buildLayout(P);
for (const u of stacks.flatMap(s => s.units)) Object.assign(u, { am: 1, pm: 2, p3: 0.5, now: 'lit' });
for (const s of stacks) Object.assign(s, { am: 1, pm: 2 });

assert.equal(esc('<a href="x">&'), '&lt;a href=&quot;x&quot;&gt;&amp;');
assert.equal(fmtTime(0), '12:00 am'); assert.equal(fmtTime(13 * 60 + 5), '1:05 pm'); assert.equal(fmtTime(719.7), '12:00 pm');
assert.equal(card16(0), 'N'); assert.equal(card16(250), 'WSW'); assert.equal(card16(-10), 'N');

// unit card: nothing selected, then a unit
assert.match(unitCardHtml(P, '', null, null, {}), /Tap any unit/);
const st = stacks[0], u = st.units[0], cur = { y: 2026, m: 10, d: 11, min: 15 * 60 };
const card = unitCardHtml(P, 'b/', st, u, cur);
assert.match(card, new RegExp(`#${String(u.floor).padStart(2, '0')}-${String(st.no).padStart(2, '0')}`));
assert.match(card, /At 3:00 pm the windows are in direct sun\./);
assert.match(card, /HDB launch range/);
assert.match(card, /data-a="down" disabled/);                           // lowest floor: can't go down

// stack table: sort keys and selection
const t = stackTable(P, stacks, 'no', st.no);
assert.equal(t.title, 'All stacks');
assert.equal((t.rows.match(/<tr /g) || []).length, stacks.length);
assert.match(t.rows, new RegExp(`data-s="${st.no}" class="on"`));
assert.equal(stackTable(P, stacks, 'pm', null).title, 'Stacks by afternoon sun');

// legend per colour mode; upcoming projects show the site key
for (const m of ['now', 'pm', 'am', 'type', 'face']) assert.ok(legendHtml(P, m, true).length > 50, m);
assert.match(legendHtml(P, 'now', false), /HDB site location/);

// picker: every project once, search narrows, current project marked
const all = pickerHtml(INDEX, P.id);
assert.equal((all.match(/class="card"/g) || []).length, INDEX.length);
assert.match(all, new RegExp(`href="\\?p=${P.id}" aria-current="page"`));
assert.equal((pickerHtml(INDEX, P.id, 'kim keat').match(/class="card"/g) || []).length, 1);
assert.match(pickerHtml(INDEX, P.id, 'zzzz'), /No projects match/);
assert.equal(cmpHtml(null), '');

// amenities, value, resale
assert.match(amenitiesHtml(P), /MRT station/);
assert.match(amenitiesHtml({}), /No amenity data/);
assert.match(valueHtml(P, stacks, null, null), /Pick a unit[\s\S]*Every stack/);
const vs = Object.keys(P.value.byStack)[0], vst = stacks.find(s => String(s.no) === vs);
assert.match(valueHtml(P, stacks, vst.no, vst.units[0].floor), /What drives it/);
assert.match(valueHtml({}, stacks, null, null), /No value estimate/);
assert.match(valueHtml({ ...P, value: { ...P.value, lease: 90 } }, stacks, vst.no, vst.units[0].floor), /~90 years of lease left/);   // the model's lease, not a copy
assert.match(resalePanelHtml(P, '4 ROOM', 'price'), /<option value="price" selected>/);
assert.match(resalePanelHtml({}, '4 ROOM', 'date'), /No resale data/);
assert.match(resaleCardHtml(P.resale.blocks[0], P.resale.asOf), /id="rClose"/);
assert.match(resaleLegendHtml(P.resale, '4 ROOM', [0, 0]), /has 3\+/);
console.log('ok');
