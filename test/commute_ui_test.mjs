import assert from 'node:assert/strict';
import { commuteHtml, reachSvg } from '../web/commute.js';

const names = ['Raffles Place', 'one-north', 'Changi Airport', 'Jurong East', 'Woodlands'];
const row = [[20, [['walk', 7], ['rail', 'NS'], ['bus', '88'], ['rail', 'BP'], ['walk', 2]]], [28, [['walk', 3]]], null, [41, [['walk', 3]]], [25, [['walk', 3]]]];
const ring = (r) => [[-r, -r], [r, -r], [r, r], [-r, r]];
const fixture = {
  asOf: '2026-10', at: 'weekday 08:00', near: '100B',   // near is not the first key
  hubs: { '100A': row, '100B': row.map(h => h && [h[0] + 1, h[1]]) },
  hubPts: names.map((n, i) => [n, i * 500 - 1000, 800 - i * 300]),
  reach: { 15: [ring(1000)], 30: [ring(3000)], 45: [ring(6000)] },
  stops: [{ code: '1', name: 'A&B <Stn>', d: 75, svc: [['88<', '06:00', '23:30']] }],
};
const stacks = [{ no: 101, blk: '100A' }, { no: 301, blk: '100B' }, { no: 401, blk: '999' }];

assert.match(commuteHtml({}, [], null), /No commute data for this project/);
assert.match(commuteHtml({ commute: fixture }, stacks, null), /Pick a unit to see its block/);
assert.match(commuteHtml({ commute: fixture }, stacks, null), /Blk 100B/);        // near, not first key
assert.match(commuteHtml({ commute: fixture }, stacks, null), /<thead><tr><th>Hub<\/th><th>Time<\/th><th>Route<\/th>.*15 min.*30 min.*45 min/s);
assert.match(commuteHtml({ commute: fixture }, stacks, 101), /Blk 100A/);
assert.doesNotMatch(commuteHtml({ commute: fixture }, stacks, 101), /Pick a unit/);
assert.match(commuteHtml({ commute: fixture }, stacks, 401), /Blk 100B/);         // no hubs entry -> near
assert.match(commuteHtml({ commute: fixture }, stacks, 301), /over 60 min/);
assert.doesNotMatch(commuteHtml({ commute: fixture }, stacks, 301), /null|NaN/);
assert.match(commuteHtml({ commute: fixture }, stacks, 301), /background:#D42E12[^>]*>NS/);
assert.match(commuteHtml({ commute: fixture }, stacks, 301), /background:#748477[^>]*>BP/);
assert.match(commuteHtml({ commute: fixture }, stacks, null), /A&amp;B &lt;Stn&gt;/);
assert.match(commuteHtml({ commute: fixture }, stacks, null), /88&lt;/);
assert.match(commuteHtml({ commute: fixture }, stacks, null), /not live data/);
const site = { commute: { ...fixture, near: 'site', hubs: { site: row } } };
assert.match(commuteHtml(site, [], null), /from the site centre/);
assert.doesNotMatch(commuteHtml(site, [], null), /Pick a unit/);
const svg = reachSvg(fixture);
assert.match(svg, /<svg[^>]*role="img"[^>]*aria-label="Within 30 min: [^"]+"/);
assert.match(svg, /one-north · 29′/);
const evil = { ...fixture, hubPts: fixture.hubPts.map(([n, x, z], i) => [i ? n : '<b>&', x, z]) };
assert.doesNotMatch(reachSvg(evil), /<b>/);
assert.match(commuteHtml({ commute: fixture }, stacks, 401), /No times for this block; showing Blk 100B/);
assert.doesNotMatch(commuteHtml({ commute: fixture }, stacks, 401), /Pick a unit/);
// thomson-reserve-like: far-east Changi must stay inside the viewBox
const far = { ...fixture, hubPts: [['Raffles Place', 0, 3700], ['one-north', -9000, 3000], ['Changi Airport', 10800, 1000], ['Jurong East', -12000, 0], ['Woodlands', -2000, -9000]], reach: { 15: [ring(1000)], 30: [ring(3000)], 45: [ring(3500)] } };
const fs = (v => Math.max(v[2], v[3]) / 45)(/viewBox="([^"]+)"/.exec(reachSvg(far))[1].split(' ').map(Number));
const [vx, , vw] = /viewBox="([^"]+)"/.exec(reachSvg(far))[1].split(' ').map(Number);
for (const [, x, attrs, txt] of [...reachSvg(far).matchAll(/<text x="([-\d.]+)"([^>]*)>([^<]*)</g)]) {
  const anchor = attrs.includes('text-anchor="end"');
  const wd = txt.length * .55 * fs, [a, b] = anchor ? [+x - wd, +x] : [+x, +x + wd];
  assert.ok(a >= vx && b <= vx + vw, `label "${txt}" clipped`);
}
// --- bus + MRT detail ---
const T = {
  stops: [
    { code: '2', name: 'Far <Stop>', x: 50, z: 50, walk: { '100B': 5 }, svc: ['88', '9'] },
    { code: '1', name: 'Near "A"&B', x: 10, z: 10, walk: { '100B': 1 }, svc: ['88'] },
  ],
  services: {
    '88/1': { no: '88', from: 'Fr<om>', to: 'T&o', n: 20, band: '8-10', times: { 1: ['06:00', '23:30'], 2: ['06:05', '23:35'] }, path: [[0, 0], [60, 60]], stopPts: [[10, 10], [50, 50]], road: true },
    '88/2': { no: '88', from: 'T&o', to: 'Fr<om>', n: 20, band: '8-10', times: { 1: ['06:10', '23:40'], 2: ['06:15', '23:45'] }, path: [[60, 60], [0, 0]], stopPts: [[50, 50], [10, 10]], road: true },
    '9/1': { no: '9', from: 'X', to: 'Y', n: 5, band: '5', times: { 2: ['07:00', '22:00'] }, path: [[0, 0], [50, 50]], stopPts: [[50, 50]], road: false },
  },
  stations: [{ name: 'Bi"shan&', codes: ['NS17', 'CC15'], lines: [{ code: 'NS17', prev: 'AMK', next: null, hubs: ['Raffles Place'] }, { code: 'CC15', prev: null, next: 'M', hubs: [] }],
    exits: [{ exit: 'C', x: 1, z: 1, walk: { '100B': 9 } }, { exit: 'A', x: 2, z: 2, walk: { '100B': 8 } }, { exit: 'B', x: 3, z: 3, walk: { '100B': 8 } }] }],
};
const R = { NS: { paths: [[[1.3, 103.8], [1.31, 103.81]]] }, BP: { paths: [[[1.3, 103.8], [1.31, 103.81]]] } };
const P = { commute: fixture, site: { lat: 1.3, lon: 103.8 } };
const h = commuteHtml(P, stacks, 301, T, R, { svc: '88/2', station: 'Bi"shan&' });
assert.ok(h.indexOf('Near &quot;A&quot;&amp;B') < h.indexOf('Far &lt;Stop&gt;'));            // nearest first
assert.match(h, /Bus stops near Blk 100B/);
assert.match(h, /data-svc="88\/2" data-stop="2" aria-pressed="true"/);
assert.match(h, /data-svc="88\/1" data-stop="1" aria-pressed="false"/);
assert.match(h, /<b>88<\/b> · T&amp;o → Fr&lt;om&gt; · 20 stops.*Here 06:15–23:45.*every 8-10 min at 8 am/s);
assert.doesNotMatch(h, /route shape approximate/);
assert.match(commuteHtml(P, stacks, 301, T, R, { svc: '9/1' }), /route shape approximate/);
assert.doesNotMatch(h, /Nearest bus stops/);
assert.ok(h.indexOf('class="stop"') < h.indexOf('Nearest stations'));
assert.match(h, /Direct, no change: Raffles Place \(NS\)/);
assert.doesNotMatch(h, /Direct, no change: \s*[<(]/);
assert.match(h, /Nearest: Exit A.*A 8′ · B 8′ · C 9′/s);
assert.match(h, /data-station="Bi&quot;shan&amp;"/);
assert.match(h, /<polyline[^>]*stroke="#D42E12"/);
assert.match(h, /<polyline[^>]*stroke="#748477"/);
assert.match(h, /stroke="#2F6DB5"/);
assert.match(h, /from T&amp;o</);
assert.match(h, /coloured lines = MRT · blue = selected bus/);
assert.ok(h.indexOf('Nearest stations') < h.indexOf('Reach map'));                        // spec order: hubs, stops, stations, map
assert.doesNotMatch(commuteHtml(P, stacks, 301, T, R, {}), /blue = selected bus/);         // no service picked
assert.match(commuteHtml(P, stacks, 301, T, R, {}), /coloured lines = MRT/);
assert.doesNotMatch(commuteHtml(P, stacks, 301, T, null, { svc: '88/2' }), /coloured lines/); // no rail data
assert.match(commuteHtml(P, stacks, 301, false), /Bus and MRT details unavailable/);
assert.match(commuteHtml(P, stacks, 301), /Loading bus and MRT details…/);
assert.match(commuteHtml(site, [], null, { ...T, stops: [{ ...T.stops[0], walk: { site: 3 } }] }), /Bus stops near the site/);
// card follows the tapped stop; only that chip is pressed
const pressed = x => (x.match(/aria-pressed="true"/g) || []).length;
const h1 = commuteHtml(P, stacks, 301, T, R, { svc: '88/2', stop: '2' });
assert.equal(h1.match(/class="svc-card"/g).length, 1);
assert.equal(pressed(h1.split('Nearest stations')[0]), 1);
assert.match(h1, /data-stop="2"><div class="aitem">.*aria-pressed="true".*Here 06:15–23:45/s);
const h2 = commuteHtml(P, stacks, 301, T, R, { svc: '88/1', stop: '1' });
assert.match(h2, /data-stop="1"><div class="aitem">.*Here 06:00–23:30/s);
assert.match(commuteHtml(P, stacks, 301, T, R, { svc: '88/1' }), /data-stop="1"><div class="aitem">.*Here 06:00–23:30/s);   // no stop: nearest
// loop stop: both directions contain it; pick the one reaching it first
import { svcKey } from '../web/transit.js';
assert.equal(svcKey(T, T.stops[1], '88'), '88/1');
assert.equal(svcKey(T, T.stops[0], '88'), '88/2');
// hostile strings in keys, codes, names
const H = { stops: [{ code: 'c"<&', name: 'n', x: 0, z: 0, walk: { '100B': 1 }, svc: ['9'] }],
  services: { 'k"<b>/1': { no: '9', from: 'f', to: 't', n: 1, band: 'b', times: { 'c"<&': ['1', '2'] }, path: [[0, 0], [1, 1]], stopPts: [[0, 0]], road: true } },
  stations: [{ name: 's', codes: ['NS1'], lines: [{ code: 'NS1', prev: 'p<i>', next: 'n"x', hubs: ['h<u>&'] }], exits: [{ exit: 'E<', x: 0, z: 0, walk: { '100B': 1 } }] }] };
const hh = commuteHtml(P, stacks, 301, H, R, { svc: 'k"<b>/1', stop: 'c"<&', station: 's' });
assert.doesNotMatch(hh, /<b>\/|<i>|<u>|c"<|n"x|E<</);
assert.match(hh, /data-svc="k&quot;&lt;b&gt;\/1" data-stop="c&quot;&lt;&amp;"/);
assert.match(hh, /h&lt;u&gt;&amp; \(NS\)/);
// --- live arrivals ---
import { createHash } from 'node:crypto';
const sel = { svc: '88/2', stop: '2' };
const base = commuteHtml(P, stacks, 301, T, R, sel);
assert.equal(createHash('sha256').update(base).digest('hex'), 'afcb1c289c94f7a2c9308f76c4a7203e74573dc571d2c0275b60dd7961e42611'); // pre-change output
assert.equal(commuteHtml(P, stacks, 301, T, R, sel, null), base);
const nowMs = Date.parse('2026-10-16T08:00:00Z'), at = m => new Date(nowMs + m * 60000).toISOString();
const live = { stop: '2', data: { stop: '2', at: at(0), services: [{ no: '88', arrivals: [at(3.5), at(9.5), at(15.5)] }, { no: '9<', arrivals: [at(1)] }] }, updatedMs: nowMs - 5000, failed: false, nowMs };
const hl = commuteHtml(P, stacks, 301, T, R, sel, live);
assert.match(hl, /aria-pressed="true">88 · 3′<\/button>/);
assert.match(hl, />9 · –<\/button>/);                                                  // exact match: '9<' is not '9'
assert.match(hl, /data-stop="1"><div class="aitem">.*?<button[^>]*aria-pressed="false">88<\/button>/s); // other stop plain
assert.match(hl, /Next buses: 3 min · 9 min · 15 min/);
assert.match(hl, /<p class="note live">Live · updated 5 s ago<\/p>/);
assert.match(hl, /Hub times are estimated.*Live minutes for the selected stop: LTA DataMall\./);
assert.doesNotMatch(hl, /not live data/);
const hx = commuteHtml(P, stacks, 301, T, R, { svc: '9/1', stop: '2' }, live);
assert.match(hx, /Next buses: –/);
const esc9 = commuteHtml(P, stacks, 301, T, R, sel, { ...live, data: { ...live.data, services: [{ no: '88', arrivals: ['<i>'] }] } });
assert.doesNotMatch(esc9, /<i>/);
const hf = commuteHtml(P, stacks, 301, T, R, sel, { stop: '2', data: null, updatedMs: null, failed: true, nowMs });
assert.match(hf, /<p class="note live">Live times unavailable, showing the timetable<\/p>/);
assert.match(hf, /not live data/);
assert.doesNotMatch(hf, /class="svc"[^>]*>[^<]* · /);
assert.equal(commuteHtml(P, stacks, 301, T, R, sel, { stop: '2', data: null, updatedMs: null, failed: false, nowMs }), base);
assert.equal(commuteHtml(P, stacks, 301, T, R, sel, { ...live, stop: '999' }), base);
console.log('ok');
