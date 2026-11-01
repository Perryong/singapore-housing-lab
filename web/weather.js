// NEA real-time weather: fetching, pacing and blending between stations. Pure: runs in the browser and in Node.
import { card16 } from './unit.js';
import { sunVec, unitSun } from './sun.js';

export const WX_API = 'https://api-open.data.gov.sg/v2/real-time/api';
export const GAP_MS = 1700;                                     // NEA allows 6 calls per 10 s without a key
export const SLOTS = 12, SLOT_MIN = 15;                         // the timeline: 3 hours of past moments, then now
const KNOT = 0.5144, KM_PER_DEG = 111.3, RETRY_MS = 10000;

export const STOPS = {
  wind: { unit: 'm/s', stops: [[0, '#2B3F8F'], [1, '#2F7FB8'], [2, '#17A398'], [3.5, '#3FB65B'], [5, '#B9C93A'], [7, '#E8A317'], [10, '#D9472B'], [15, '#8E1F4A']] },
  temp: { unit: '°C', stops: [[23, '#2F7FB8'], [25, '#17A398'], [27, '#7DBE4B'], [29, '#E8C72E'], [31, '#E8831C'], [33, '#D9472B'], [35, '#8E1F4A']] },
  hum: { unit: '%', stops: [[50, '#C9A24A'], [60, '#8FB76A'], [70, '#3FB38C'], [80, '#2F8DB8'], [90, '#2B5FA8'], [100, '#2B3F8F']] },
};
// shortcut: colours read off real radar frames, light to heavy with no mm/h; use the table in NEA's API spec to label them
export const RAIN_COLOURS = ['#00837D', '#00BABF', '#00FFFF', '#008045', '#00CA11', '#00FF00', '#FFFF00', '#FFC600', '#FF8A00', '#FF1F00', '#C10000'];

// one call at a time, at least gap ms apart; hold() makes the next call wait longer
export function makeQueue(gap = GAP_MS, wait = ms => new Promise(r => setTimeout(r, ms)), now = Date.now) {
  let tail = Promise.resolve(), next = 0;
  return {
    run(fn) {
      const p = tail.then(async () => { while (now() < next) await wait(next - now()); next = now() + gap; return fn(); });
      tail = p.catch(() => {});
      return p;
    },
    hold(ms) { next = Math.max(next, now() + ms); },
  };
}

// base and fetchFn are test seams; callers use the defaults. NEA signals rate limiting by status 429 or body code 24.
export async function fetchFeed(path, { queue, signal, base = WX_API, fetchFn = (...a) => fetch(...a) }) {
  for (let tries = 1; ; tries++) {
    const res = await queue.run(() => fetchFn(`${base}/${path}`, { signal }));
    const body = await res.json().catch(() => null);
    if (res.ok && body?.code === 0) return body.data;
    const limited = res.status === 429 || body?.code === 24;
    if (limited) queue.hold(RETRY_MS);
    if (!limited || tries === 3) throw new Error(`${path} ${res.status}`);
  }
}

// -> { at, points: [{ id, name, lat, lon, v }] }, leaving out stations with no reading
export function stations(data) {
  const r = data?.readings?.[0];
  if (!r) return { at: null, points: [] };
  const vals = new Map(r.data.map(q => [q.stationId, q.value]));
  return { at: r.timestamp, points: data.stations.filter(s => vals.get(s.id) != null)
    .map(s => ({ id: s.id, name: s.name, lat: s.location.latitude, lon: s.location.longitude, v: vals.get(s.id) })) };
}

// speed in knots and the bearing it blows from -> m/s and the vector it blows towards (u east, v north)
export function windPoints(speed, dir) {
  const from = new Map(stations(dir).points.map(p => [p.id, p.v]));
  return stations(speed).points.filter(p => from.has(p.id)).map(p => {
    const ms = p.v * KNOT, th = from.get(p.id) * Math.PI / 180;
    return { ...p, ms, u: -ms * Math.sin(th), v: -ms * Math.cos(th) };
  });
}

const km2 = (p, lat, lon) => ((p.lat - lat) * KM_PER_DEG) ** 2 + ((p.lon - lon) * KM_PER_DEG) ** 2;
// inverse distance squared: an estimate between stations, not a weather model
export function blend(points, f, lat, lon) {
  if (!points.length) return null;
  let a = 0, w = 0;
  for (const p of points) { const g = 1 / (km2(p, lat, lon) + 0.25); a += g * f(p); w += g; }
  return a / w;
}
export const windAt = (points, lat, lon) => points.length ? [blend(points, p => p.u, lat, lon), blend(points, p => p.v, lat, lon)] : [0, 0];
export const fromBearing = (u, v) => (Math.atan2(-u, -v) * 180 / Math.PI + 360) % 360;

export function nearest(points, lat, lon) {
  if (!points.length) return null;
  const p = points.reduce((a, b) => km2(b, lat, lon) < km2(a, lat, lon) ? b : a);
  return { ...p, km: Math.sqrt(km2(p, lat, lon)) };
}

// -> { at, url, bounds: [[south, west], [north, east]] }; the url expires in about 20 minutes
export function radarFrame(data) {
  const r = data?.records?.[0], b = data?.boundaryBox;
  if (!r?.image?.url || !b) return null;
  return { at: r.timestamp, url: r.image.url, bounds: [[b.lowerRight.latitude, b.upperLeft.longitude], [b.upperLeft.latitude, b.lowerRight.longitude]] };
}

export function forecastAt(data, lat, lon) {
  const list = data?.items?.[0]?.forecasts;
  if (!list || !data.area_metadata?.length) return null;
  const area = nearest(data.area_metadata.map(a => ({ name: a.name, lat: a.label_location.latitude, lon: a.label_location.longitude })), lat, lon).name;
  const text = list.find(f => f.area === area)?.forecast;
  return text ? { area, text } : null;
}

const rgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
export function rampColour(stops, v) {
  if (v <= stops[0][0]) return rgb(stops[0][1]);
  for (let i = 1; i < stops.length; i++) if (v <= stops[i][0]) {
    const t = (v - stops[i - 1][0]) / (stops[i][0] - stops[i - 1][0]), a = rgb(stops[i - 1][1]), b = rgb(stops[i][1]);
    return a.map((c, k) => c + (b[k] - c) * t);
  }
  return rgb(stops.at(-1)[1]);
}

export const minutesOld = (iso, nowMs) => iso ? Math.floor((nowMs - Date.parse(iso)) / 60000) : null;

// the timeline's past moments, oldest first: whole quarter hours, ending at the latest one
export function slotTimes(nowMs, count = SLOTS, stepMin = SLOT_MIN) {
  const step = stepMin * 60000, last = Math.floor(nowMs / step) * step;
  return Array.from({ length: count }, (_, i) => last - (count - 1 - i) * step);
}
export const sgtStamp = ms => new Date(ms + 8 * 3600000).toISOString().slice(0, 19);
export const atMoment = (path, ms) => `${path}?date=${sgtStamp(ms)}`;
export const withinMin = (iso, ms, min = SLOT_MIN) => !!iso && Math.abs(Date.parse(iso) - ms) <= min * 60000;

// plain text for one place (callers escape); a missing feed shows a dash
export function readout({ lat, lon }, { wind = [], rain = [], temp = [], hum = [], fc = null }) {
  const [u, v] = windAt(wind, lat, lon), g = nearest(rain, lat, lon), t = nearest(temp, lat, lon), h = nearest(hum, lat, lon), f = forecastAt(fc, lat, lon);
  return {
    wind: wind.length ? `${Math.hypot(u, v).toFixed(1)} m/s from the ${card16(fromBearing(u, v))}` : '–',
    rain: g ? `${(g.v * 12).toFixed(0)} mm/h` : '–',                // the gauge reports a 5-minute total
    gauge: g ? `${g.name}, ${g.km.toFixed(1)} km` : null,
    temp: t ? `${t.v.toFixed(1)} °C` : '–',
    hum: h ? `${h.v.toFixed(0)}%` : '–',
    forecast: f ? `${f.area}: ${f.text}` : null,
  };
}

/* ---------- Wind and rain on a project's blocks: estimates from the sun's ray-caster, not airflow ---------- */
const DROP_MS = 6.5, WIND_EXP = 0.25;                           // fall speed of a roughly 2 mm drop; wind profile over a built-up area (an assumption)
export const atHeight = (U10, y) => U10 * (Math.max(y, 10) / 10) ** WIND_EXP;
const altOf = U => Math.atan2(DROP_MS, Math.max(U, 0.01)) * 180 / Math.PI;
export const rainRay = (U, from) => sunVec(altOf(U), from);     // rain falls along a slanted straight line, so it traces like a sun ray
export const windRay = from => sunVec(0, from);

// mutates units: rainSt/windSt 'lit' (reached) | 'shade' (a block shelters it) | 'away' | 'dry' | 'calm', by, rainFlux (rate on the facade, mm/h), windMs. Stacks get rainPct/windPct.
export function computeWeather(L, { from, U, mmh }) {
  for (const u of L.units) {
    const Uz = atHeight(U, u.y);
    if (mmh > 0) {
      const s = rainRay(Uz, from), r = unitSun(L, u, s), h = Math.hypot(s[0], s[2]);
      // a yes/no would call a near-vertical shower "reached", so colour by rate x slant x how squarely it faces (r.cos includes h)
      Object.assign(u, { rainSt: r.st, rainBy: r.by, rainFlux: r.st === 'lit' ? mmh * (Uz / DROP_MS) * (r.cos / h) : 0 });
    } else Object.assign(u, { rainSt: 'dry', rainBy: 0, rainFlux: 0 });
    if (U > 0) {
      const w = unitSun(L, u, windRay(from));
      Object.assign(u, { windSt: w.st, windBy: w.by, windMs: w.st === 'lit' ? Uz * w.cos : 0 });
    } else Object.assign(u, { windSt: 'calm', windBy: 0, windMs: 0 });
  }
  const share = (st, k) => Math.round(100 * st.units.filter(u => u[k] === 'lit').length / st.units.length);
  for (const st of L.stacks) { st.rainPct = share(st, 'rainSt'); st.windPct = share(st, 'windSt'); }
}

// roof height at any point, baked once: too many buildings to test for every raindrop every frame
export function heightGrid(L, extra = [], R = 650, cell = 5) {
  const n = Math.ceil(2 * R / cell), g = new Float32Array(n * n), idx = v => Math.floor((v + R) / cell);
  const fill = (x0, x1, z0, z1, h, inside) => {
    for (let j = Math.max(0, idx(z0)); j <= Math.min(n - 1, idx(z1)); j++) for (let i = Math.max(0, idx(x0)); i <= Math.min(n - 1, idx(x1)); i++) {
      if (g[j * n + i] < h && inside((i + .5) * cell - R, (j + .5) * cell - R)) g[j * n + i] = h;
    }
  };
  for (const b of L.boxes) {
    const r = Math.hypot(b.hx, b.hz);
    fill(b.cx - r, b.cx + r, b.cz - r, b.cz + r, b.H, (x, z) => { const dx = x - b.cx, dz = z - b.cz; return Math.abs(dx * b.ax + dz * b.az) <= b.hx && Math.abs(dx * b.fx + dz * b.fz) <= b.hz; });
  }
  for (const b of [...L.context, ...extra]) {
    if (!(b.h > 1)) continue;                                   // parks and other ground areas
    const xs = b.p.map(q => q[0]), zs = b.p.map(q => q[1]), P = b.p;
    fill(Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs), b.h, (x, z) => {
      let c = false;
      for (let i = 0, k = P.length - 1; i < P.length; k = i++) if ((P[i][1] > z) !== (P[k][1] > z) && x < (P[k][0] - P[i][0]) * (z - P[i][1]) / (P[k][1] - P[i][1]) + P[i][0]) c = !c;
      return c;
    });
  }
  return (x, z) => { const i = idx(x), j = idx(z); return i < 0 || j < 0 || i >= n || j >= n ? 0 : g[j * n + i]; };
}

// one set of values for a project: the 3 nearest wind stations, the nearest gauge, the nearest forecast area
export function liveValues({ speed, dir, rain, fc }, lat, lon) {
  const wind = windPoints(speed, dir).sort((a, b) => km2(a, lat, lon) - km2(b, lat, lon)).slice(0, 3);
  if (!wind.length) return null;
  const [u, v] = windAt(wind, lat, lon), g = nearest(stations(rain).points, lat, lon);
  return { U: Math.hypot(u, v), from: fromBearing(u, v), mmh: g ? g.v * 12 : 0, gauge: g ? `${g.name}, ${g.km.toFixed(1)} km` : null, at: stations(speed).at, forecast: forecastAt(fc, lat, lon) };
}
// how much the forecast dims direct sun in the scene; an impression, since NEA publishes no cloud or solar reading here
export const skyDim = text => /thunder|heavy|rain|shower/i.test(text || '') ? 0.4 : /cloud|overcast|haz|mist/i.test(text || '') ? 0.7 : 1;
