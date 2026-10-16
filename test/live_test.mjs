import assert from 'node:assert/strict';
import { API, PROD_API, apiFor, fetchArrivals, minutesUntil, liveChip, nextBuses, liveLine } from '../web/live.js';

const now = Date.parse('2026-10-16T21:30:00+08:00');
const at = ms => new Date(now + ms).toISOString();
assert.equal(minutesUntil(at(3.5 * 60000), now), 3);
assert.equal(minutesUntil(at(-40000), now), 0);
assert.equal(liveChip([], now), '–');
assert.equal(liveChip([at(30000)], now), 'Arr');
assert.equal(liveChip([at(-5000)], now), 'Arr');
assert.equal(liveChip([at(7.2 * 60000)], now), '7′');
assert.equal(nextBuses([at(30000), at(6 * 60000), at(14 * 60000)], now), 'Arriving · 6 min · 14 min');
assert.equal(liveLine(now - 12000, now, false), 'Live · updated 12 s ago');
assert.equal(liveLine(now - 12000, now, true), 'Live times unavailable, showing the timetable');
// device clock 5 min fast; server time is the truth
const devNow = now + 300000;
assert.equal(liveChip([at(4 * 60000)], devNow - 300000), '4′');
assert.equal(apiFor('localhost'), 'http://127.0.0.1:8010');
assert.equal(apiFor('127.0.0.1'), 'http://127.0.0.1:8010');
assert.equal(apiFor('singapore-housing-lab.vercel.app'), PROD_API);
assert.equal(PROD_API, 'https://sg-bus-api.vercel.app');
assert.equal(typeof API, 'string');

let calls = 0;
globalThis.fetch = async () => { calls++; return { ok: true, status: 200, json: async () => ({ at: at(0) }) }; };
await assert.rejects(fetchArrivals('52031', undefined, ''));   // not configured: never fetches
assert.equal(calls, 0);
const r = await fetchArrivals('52031', undefined, 'http://x');
assert.equal(calls, 1);
assert.ok(Math.abs(r.offsetMs - (now - Date.now())) < 5);
globalThis.fetch = async () => ({ ok: false, status: 502, json: async () => ({}) });
await assert.rejects(fetchArrivals('52031', undefined, 'http://x'));
globalThis.fetch = async () => { throw new Error('net'); };
await assert.rejects(fetchArrivals('52031', undefined, 'http://x'));
console.log('ok');
