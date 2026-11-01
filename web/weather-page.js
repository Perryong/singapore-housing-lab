// The weather map: Leaflet, four layers from NEA's live feeds, wind trails on a canvas, and a pin for every project.
import { esc } from './format.js';
import { STOPS, RAIN_COLOURS, makeQueue, fetchFeed, stations, windPoints, blend, windAt, radarFrame, rampColour, minutesOld, readout } from './weather.js';

const $ = s => document.querySelector(s), { L } = window;
const MIN = 60000, STALE_MIN = 15, RETRY = MIN;
const ISLAND = [[1.2, 103.6], [1.47, 104.03]], FIELD_BOX = [[.95, 103.3], [1.75, 104.4]], FIELD_W = 260, FIELD_H = 190, FIELD_ALPHA = 150;
const FEEDS = [                                                 // in load order, radar first because it's what people look for
  { key: 'radar', path: 'weather-radar-images/70km', every: 5 * MIN },
  { key: 'speed', path: 'wind-speed', every: MIN },
  { key: 'dir', path: 'wind-direction', every: MIN },
  { key: 'rain', path: 'rainfall', every: 5 * MIN },
  { key: 'temp', path: 'air-temperature', every: 5 * MIN },
  { key: 'hum', path: 'relative-humidity', every: 5 * MIN },
  { key: 'fc', path: 'two-hr-forecast', every: 30 * MIN },
];
const LAYERS = { wind: 'Wind', rain: 'Rain radar', temp: 'Temperature', hum: 'Humidity' };

if (!L) { document.body.insertAdjacentHTML('beforeend', '<div id="fail">The map could not load. Check your connection and try again.</div>'); throw new Error('Leaflet did not load'); }

const state = { wind: true, rain: true, field: null, pin: null };   // field: 'temp' | 'hum' | null, which replaces the wind colours
const data = {}, failed = {}, due = {}, busy = new Set(), queue = makeQueue();
const windPts = () => windPoints(data.speed, data.dir), pts = k => stations(data[k]).points;
const fieldKind = () => state.field || (state.wind ? 'wind' : null);
const radar = () => failed.radar ? null : radarFrame(data.radar);

/* ---------- Map ---------- */
const map = L.map('map', { zoomSnap: .25, minZoom: 10.5, maxBounds: FIELD_BOX, maxBoundsViscosity: .8 });
map.attributionControl.setPrefix('Leaflet');
map.zoomControl.setPosition('bottomright');
map.fitBounds(ISLAND);
L.tileLayer('https://www.onemap.gov.sg/maps/tiles/Grey/{z}/{x}/{y}.png', { minZoom: 10.5, minNativeZoom: 11, maxNativeZoom: 19, maxZoom: 19, bounds: FIELD_BOX,
  attribution: 'Map: OneMap © SLA · Weather: NEA via data.gov.sg (Open Data Licence)' }).addTo(map);
map.createPane('wxField').style.zIndex = 300;
map.createPane('wxRain').style.zIndex = 350;
const fieldLayer = L.imageOverlay('', FIELD_BOX, { pane: 'wxField', interactive: false });
const radarLayer = L.imageOverlay('', ISLAND, { pane: 'wxRain', opacity: .85, interactive: false });
const dotLayer = L.layerGroup().addTo(map), gaugeLayer = L.layerGroup().addTo(map);
radarLayer.on('error', () => { failed.radar = true; due.radar = Date.now() + RETRY; render(); });   // e.g. its link expired

function fieldUrl(kind) {
  const P = kind === 'wind' ? windPts() : pts(kind);
  if (!P.length) return null;
  const f = kind === 'wind' ? (la, lo) => Math.hypot(...windAt(P, la, lo)) : (la, lo) => blend(P, p => p.v, la, lo);
  const c = document.createElement('canvas'), x = c.getContext('2d'); c.width = FIELD_W; c.height = FIELD_H;
  const im = x.createImageData(FIELD_W, FIELD_H), [[S, W], [N, E]] = FIELD_BOX, { stops } = STOPS[kind];
  for (let j = 0; j < FIELD_H; j++) for (let i = 0; i < FIELD_W; i++) {
    im.data.set([...rampColour(stops, f(N + (S - N) * j / FIELD_H, W + (E - W) * i / FIELD_W)), FIELD_ALPHA], (j * FIELD_W + i) * 4);
  }
  x.putImageData(im, 0, 0);
  return c.toDataURL();
}

/* ---------- Drawing the current state ---------- */
function renderField() {
  const kind = fieldKind(), url = kind && fieldUrl(kind);
  if (url) { fieldLayer.setUrl(url).addTo(map); } else fieldLayer.remove();
  dotLayer.clearLayers();
  if (url) for (const p of kind === 'wind' ? windPts() : pts(kind)) L.circleMarker([p.lat, p.lon], { radius: 2.5, stroke: false, fill: true, fillColor: '#fff', fillOpacity: .9, interactive: false }).addTo(dotLayer);
}
function renderRain() {
  const f = state.rain && radar();
  if (f) { if (radarLayer._wxUrl !== f.url) { radarLayer._wxUrl = f.url; radarLayer.setUrl(f.url); } radarLayer.setBounds(f.bounds).addTo(map); } else radarLayer.remove();
  gaugeLayer.clearLayers();
  if (state.rain && !f) for (const g of pts('rain')) if (g.v > 0) {             // radar is beta: fall back to the gauges reading rain
    L.circleMarker([g.lat, g.lon], { radius: 4 + Math.min(10, g.v * 12 / 5), stroke: false, fill: true, fillColor: '#00BABF', fillOpacity: .85, interactive: false }).addTo(gaugeLayer);
  }
}
const unavailable = (keys, name) => keys.every(k => failed[k] && !data[k]) ? `${name} unavailable` : name;
function renderRail() {
  const rainName = radar() || !failed.radar ? LAYERS.rain : data.rain ? 'Rain (gauges)' : 'Rain unavailable';
  const names = { wind: unavailable(['speed', 'dir'], LAYERS.wind), rain: rainName, temp: unavailable(['temp'], LAYERS.temp), hum: unavailable(['hum'], LAYERS.hum) };
  const on = { wind: state.wind, rain: state.rain, temp: state.field === 'temp', hum: state.field === 'hum' };
  $('#rail').innerHTML = Object.keys(LAYERS).map(k => `<button data-l="${k}" aria-pressed="${on[k]}">${names[k]}</button>`).join('');
}
function renderLegend() {
  const kind = fieldKind(), R = kind && STOPS[kind];
  const field = R ? `<div><b>${R.unit}</b>${[...R.stops].reverse().map(([v, c]) => `<i style="background:${c}">${v}</i>`).join('')}</div>` : '';
  const rain = state.rain ? `<div><b>Rain</b><small>Heavy</small>${[...RAIN_COLOURS].reverse().map(c => `<i class="flat" style="background:${c}"></i>`).join('')}<small>Light</small></div>` : '';
  $('#legend').innerHTML = rain + field;
}
function renderStatus() {
  const at = stations(data.speed).at, age = minutesOld(at, Date.now()), el = $('#status');
  const text = !at ? (failed.speed ? 'Live data unavailable, retrying' : 'Loading live data…')
    : age > STALE_MIN ? `Readings ${age} min old`
    : `Live · ${new Date(at).toLocaleTimeString('en-SG', { timeZone: 'Asia/Singapore', hour: 'numeric', minute: '2-digit' })}`;
  if (el.textContent !== text) el.textContent = text;
  el.classList.toggle('live', text.startsWith('Live ·'));
}
function renderCard() {
  const p = state.pin, el = $('#card'); el.hidden = !p;
  if (!p) return;
  const r = readout(p, { wind: windPts(), rain: pts('rain'), temp: pts('temp'), hum: pts('hum'), fc: data.fc });
  el.innerHTML = `<h2>${esc(p.name)}</h2><button aria-label="Close">×</button>
    <p>Wind <b>${esc(r.wind)}</b></p><p>Rain <b>${esc(r.rain)}</b> · <b>${esc(r.temp)}</b> · <b>${esc(r.hum)}</b></p>
    ${r.forecast ? `<p>${esc(r.forecast)}</p>` : ''}
    <small>${r.gauge ? `Nearest gauge ${esc(r.gauge)}. ` : ''}Wind blended from nearby stations.</small>
    <a href="./?p=${encodeURIComponent(p.id)}">Open in 3D</a>`;
}
function render() { renderField(); renderRain(); renderRail(); renderLegend(); renderStatus(); renderCard(); drawArrows(); run(); }

/* ---------- Wind trails ---------- */
const still = matchMedia('(prefers-reduced-motion: reduce)'), cv = $('#trails'), cx = cv.getContext('2d');
const COUNT = innerWidth < 700 ? 650 : 1700, PX_PER_MS = .62, LIFE = 90;
const spawn = () => ({ x: Math.random() * innerWidth, y: Math.random() * innerHeight, age: Math.random() * LIFE });
const parts = Array.from({ length: COUNT }, spawn);
let raf = 0, frames = 0, arrows = 0, moving = false;
function size() { const d = Math.min(devicePixelRatio || 1, 2); cv.width = innerWidth * d; cv.height = innerHeight * d; cx.setTransform(d, 0, 0, d, 0, 0); drawArrows(); }
const clear = () => cx.clearRect(0, 0, innerWidth, innerHeight);
function step(P) {
  cx.globalCompositeOperation = 'destination-in'; cx.fillStyle = 'rgba(0,0,0,.93)'; cx.fillRect(0, 0, innerWidth, innerHeight);
  cx.globalCompositeOperation = 'source-over'; cx.strokeStyle = 'rgba(255,255,255,.72)'; cx.lineWidth = 1.05; cx.beginPath();
  parts.forEach((q, i) => {
    const ll = map.containerPointToLatLng([q.x, q.y]), [u, v] = windAt(P, ll.lat, ll.lng), x = q.x + u * PX_PER_MS, y = q.y - v * PX_PER_MS;
    cx.moveTo(q.x, q.y); cx.lineTo(x, y); q.x = x; q.y = y;
    if (++q.age > LIFE || x < 0 || y < 0 || x > innerWidth || y > innerHeight) parts[i] = { ...spawn(), age: 0 };
  });
  cx.stroke();
}
const animating = () => state.wind && !still.matches && !document.hidden && windPts().length > 0;
function run() {
  if (raf) return;
  if (!animating()) { if (!still.matches) clear(); return; }
  raf = requestAnimationFrame(() => {
    raf = 0;
    if (animating() && !moving) { step(windPts()); frames++; }  // wind may have gone off since this frame was queued
    run();
  });
}
function drawArrows() {                                         // reduced motion: the same wind, standing still
  if (!still.matches) return;
  clear(); arrows = 0;
  if (!state.wind) return;
  cx.strokeStyle = cx.fillStyle = '#fff'; cx.lineWidth = 1.6;
  for (const p of windPts()) {
    const a = map.latLngToContainerPoint([p.lat, p.lon]), len = 6 + p.ms * 4, k = len / Math.max(p.ms, .01), x = a.x + p.u * k, y = a.y - p.v * k;
    cx.beginPath(); cx.moveTo(a.x, a.y); cx.lineTo(x, y); cx.stroke();
    cx.beginPath(); cx.arc(x, y, 2.2, 0, Math.PI * 2); cx.fill();
    arrows++;
  }
}
map.on('movestart zoomstart', () => { moving = true; if (!still.matches) clear(); });
map.on('moveend zoomend', () => { moving = false; drawArrows(); });
addEventListener('resize', size);
still.addEventListener('change', () => { clear(); render(); });
size();

/* ---------- Live feeds ---------- */
// aborted while queued if the tab was hidden in the meantime, so a hidden tab never calls NEA
const fetchVisible = (...a) => document.hidden ? Promise.reject(new DOMException('hidden', 'AbortError')) : fetch(...a);
function load(f) {
  busy.add(f.key);
  fetchFeed(f.path, { queue, fetchFn: fetchVisible })
    .then(d => { data[f.key] = d; failed[f.key] = false; due[f.key] = Date.now() + f.every; })
    .catch(e => { if (e.name === 'AbortError') due[f.key] = 0; else { failed[f.key] = true; due[f.key] = Date.now() + RETRY; } })
    .finally(() => { busy.delete(f.key); render(); });
}
function tick() {
  renderStatus();                                               // the age label keeps counting even if a refresh fails
  if (document.hidden) return;
  for (const f of FEEDS) if (!busy.has(f.key) && Date.now() >= (due[f.key] ?? 0)) load(f);
}
setInterval(tick, 5000);
document.addEventListener('visibilitychange', () => { tick(); run(); });

/* ---------- Controls ---------- */
$('#rail').addEventListener('click', e => {
  const l = e.target.closest('[data-l]')?.dataset.l;
  if (!l) return;
  if (l === 'wind' || l === 'rain') state[l] = !state[l]; else state.field = state.field === l ? null : l;
  render();
  $(`[data-l=${l}]`).focus();                                   // the rail was just redrawn
});
const pinEls = new Map();
function selectPin(p) {
  if (state.pin) pinEls.get(state.pin.id)?.classList.remove('sel');
  state.pin = p;
  if (p) pinEls.get(p.id)?.classList.add('sel');
  renderCard();
}
$('#card').addEventListener('click', e => { if (e.target.closest('button')) { const id = state.pin?.id; selectPin(null); pinEls.get(id)?.focus(); } });
addEventListener('keydown', e => { if (e.key === 'Escape' && state.pin) { const id = state.pin.id; selectPin(null); pinEls.get(id)?.focus(); } });
map.on('click', () => selectPin(null));

fetch('../projects/index.json', { cache: 'no-cache' }).then(r => r.json()).then(list => {
  for (const p of list) {
    const m = L.marker([p.lat, p.lon], { title: p.name, riseOnHover: true, icon: L.divIcon({ className: `pin ${p.status}`, html: '<i></i>', iconSize: [26, 26] }) }).addTo(map);
    const el = m.getElement(); pinEls.set(p.id, el);
    m.on('click', () => selectPin(p));
    el.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectPin(p); } });   // Leaflet's Enter only opens its own popups
  }
}).catch(e => console.warn('project pins unavailable', e));

window.__wx = {                                                 // test hook
  settled: () => FEEDS.every(f => due[f.key] != null) && !busy.size,
  fieldKind, radarOn: () => map.hasLayer(radarLayer), dots: () => dotLayer.getLayers().length, gauges: () => gaugeLayer.getLayers().length,
  frames: () => frames, arrows: () => arrows, tick, expire: () => FEEDS.forEach(f => { due[f.key] = 0; }),
};
render();
tick();
