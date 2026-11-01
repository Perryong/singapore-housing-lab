// Weather page data: NEA feeds parsed, blended and paced without touching the network.
import assert from 'node:assert/strict';
import { GAP_MS, STOPS, RAIN_COLOURS, makeQueue, fetchFeed, stations, windPoints, blend, windAt, fromBearing, nearest, radarFrame, forecastAt, rampColour, minutesOld, readout } from '../web/weather.js';

const near = (a, b, e = 1e-6) => assert.ok(Math.abs(a - b) < e, `${a} !~ ${b}`);
const st = (id, lat, lon) => ({ id, name: id, location: { latitude: lat, longitude: lon } });
const feed = (sts, vals, timestamp = '2026-11-02T12:00:00+08:00') => ({ stations: sts, readings: [{ timestamp, data: Object.entries(vals).map(([stationId, value]) => ({ stationId, value })) }] });

// stations: readings joined to locations, gaps skipped
const A = st('A', 1.35, 103.8), B = st('B', 1.35, 103.9);
assert.deepEqual(stations(feed([A, B], { A: 5 })), { at: '2026-11-02T12:00:00+08:00', points: [{ id: 'A', name: 'A', lat: 1.35, lon: 103.8, v: 5 }] });
assert.deepEqual(stations(feed([A], { A: null })).points, []);
assert.deepEqual(stations({ stations: [A], readings: [] }), { at: null, points: [] });
assert.deepEqual(stations(undefined), { at: null, points: [] });

// wind: knots to m/s, "from" bearing to a "towards" vector
const [w] = windPoints(feed([A], { A: 10 }), feed([A], { A: 90 }));   // 10 kt from the east blows west
near(w.ms, 5.144); near(w.u, -5.144); near(w.v, 0);
assert.equal(windPoints(feed([A, B], { A: 10, B: 10 }), feed([A], { A: 90 })).length, 1);   // no direction: skipped
assert.deepEqual(windPoints(undefined, undefined), []);
near(fromBearing(w.u, w.v), 90);
near(fromBearing(0, -1), 0);                                          // blowing south means from the north

// angles blend as vectors: 350° and 10° make north, not south
const pair = windPoints(feed([A, B], { A: 10, B: 10 }), feed([A, B], { A: 350, B: 10 }));
const [u, v] = windAt(pair, 1.35, 103.85);
const bearing = fromBearing(u, v);
assert.ok(bearing < 1 || bearing > 359, `blended to ${bearing}`);
assert.ok(v < 0);

// blending: a point on top of a station stays close to it, and nothing to blend gives null
const two = [{ lat: 1.35, lon: 103.8, v: 20 }, { lat: 1.35, lon: 104.0, v: 30 }];
assert.ok(blend(two, p => p.v, 1.35, 103.8) < 21);
near(blend(two, p => p.v, 1.35, 103.9), 25);
assert.equal(blend([], p => p.v, 1.35, 103.8), null);
assert.deepEqual(windAt([], 1.35, 103.8), [0, 0]);

// nearest
const n = nearest(two, 1.35, 103.81); assert.equal(n.v, 20); near(n.km, 1.113, 1e-3);
assert.equal(nearest([], 1.35, 103.8), null);

// radar
const box = { upperLeft: { longitude: 103.3, latitude: 2 }, lowerRight: { longitude: 104.6, latitude: 0.7 } };
assert.deepEqual(radarFrame({ boundaryBox: box, records: [{ timestamp: 't', image: { url: 'u' } }] }), { at: 't', url: 'u', bounds: [[0.7, 103.3], [2, 104.6]] });
for (const bad of [{ boundaryBox: box, records: [] }, { records: [{}] }, {}, undefined]) assert.equal(radarFrame(bad), null);

// forecast for the closest area
const fc = { area_metadata: [{ name: 'Far', label_location: { latitude: 1.45, longitude: 104 } }, { name: 'Bishan', label_location: { latitude: 1.35, longitude: 103.84 } }],
  items: [{ forecasts: [{ area: 'Far', forecast: 'Fair' }, { area: 'Bishan', forecast: 'Cloudy' }] }] };
assert.deepEqual(forecastAt(fc, 1.346, 103.85), { area: 'Bishan', text: 'Cloudy' });
for (const bad of [undefined, {}, { area_metadata: fc.area_metadata, items: [] }]) assert.equal(forecastAt(bad, 1.35, 103.8), null);

// colour ramps clamp at both ends and interpolate between stops
assert.deepEqual(rampColour([[0, '#000000'], [10, '#FF0000']], -5), [0, 0, 0]);
assert.deepEqual(rampColour([[0, '#000000'], [10, '#FF0000']], 99), [255, 0, 0]);
assert.deepEqual(rampColour([[0, '#000000'], [10, '#FF0000']], 5).map(Math.round), [128, 0, 0]);
for (const s of Object.values(STOPS)) for (let i = 1; i < s.stops.length; i++) assert.ok(s.stops[i][0] > s.stops[i - 1][0], 'stops rise');
assert.ok(RAIN_COLOURS.length > 3);

assert.equal(minutesOld('2026-11-02T12:00:00+08:00', Date.parse('2026-11-02T12:16:30+08:00')), 16);
assert.equal(minutesOld(null, 0), null);

// readout: rain is a 5-minute total, and a missing feed shows a dash rather than a wrong number
const pin = { lat: 1.35, lon: 103.8 };
const r = readout(pin, { wind: windPoints(feed([A], { A: 10 }), feed([A], { A: 90 })), rain: stations(feed([A], { A: 1.5 })).points, temp: stations(feed([A], { A: 27.25 })).points, hum: stations(feed([A], { A: 74 })).points, fc: null });
assert.deepEqual(r, { wind: '5.1 m/s from the E', rain: '18 mm/h', gauge: 'A, 0.0 km', temp: '27.3 °C', hum: '74%', forecast: null });
assert.deepEqual(readout(pin, {}), { wind: '–', rain: '–', gauge: null, temp: '–', hum: '–', forecast: null });

// queue: a burst stays inside NEA's 6 calls in any 10 seconds, on a fake clock
let t = 0; const times = [], q = makeQueue(GAP_MS, async ms => { t += ms; }, () => t);
await Promise.all(Array.from({ length: 30 }, () => q.run(async () => times.push(t))));
assert.equal(times.length, 30);
for (const a of times) assert.ok(times.filter(b => b >= a && b < a + 10000).length <= 6, 'over 6 calls in 10 s');
assert.deepEqual(times, [...times].sort((a, b) => a - b));            // one at a time, in order
const failed = await q.run(async () => { throw new Error('x'); }).catch(e => e.message);
assert.equal(failed, 'x');                                            // a failure doesn't jam the queue
assert.equal(await q.run(async () => 'next'), 'next');

// fetchFeed: unwraps data, and backs off when rate limited whichever way NEA signals it
const res = (status, body) => ({ status, ok: status === 200, json: async () => body });
const clock = () => { let c = 0; return { q: makeQueue(0, async ms => { c += ms; }, () => c), now: () => c }; };
let c = clock();
assert.deepEqual(await fetchFeed('rainfall', { queue: c.q, base: 'http://x', fetchFn: async u => { assert.equal(u, 'http://x/rainfall'); return res(200, { code: 0, data: { a: 1 } }); } }), { a: 1 });
for (const limited of [res(429, {}), res(200, { code: 24, data: null })]) {
  c = clock(); let calls = 0;
  const got = await fetchFeed('rainfall', { queue: c.q, fetchFn: async () => ++calls === 1 ? limited : res(200, { code: 0, data: 'ok' }) });
  assert.equal(got, 'ok'); assert.equal(calls, 2); assert.ok(c.now() >= 10000, 'waited before retrying');
}
c = clock(); let tries = 0;
await assert.rejects(fetchFeed('rainfall', { queue: c.q, fetchFn: async () => { tries++; return res(429, {}); } }));
assert.equal(tries, 3);                                               // gives up rather than retrying for ever
c = clock();
await assert.rejects(fetchFeed('rainfall', { queue: c.q, fetchFn: async () => res(404, { code: 28, data: null }) }));
await assert.rejects(fetchFeed('rainfall', { queue: c.q, fetchFn: async () => res(200, { code: 17, data: null }) }));
await assert.rejects(fetchFeed('rainfall', { queue: c.q, fetchFn: async () => ({ status: 500, ok: false, json: async () => { throw new Error('not json'); } }) }));

console.log('ok');
