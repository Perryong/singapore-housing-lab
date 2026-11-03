// The future BTO map: candidate parcels from future.json on OneMap tiles, filters, a card per parcel, and project pins.
import { FILTERS, visible, style, cardHtml, noteText } from './future.js';

const $ = s => document.querySelector(s);
const LABEL = { all: 'All candidates', near: '≤ 5 years', far: '5–10 years', announced: 'Announced only' };
window.__future = { ready: false, layers: 0 };

const map = L.map('map', { zoomSnap: .25, zoomControl: false, minZoom: 10.5 }).setView([1.352, 103.82], 11.75);
L.control.zoom({ position: 'bottomright' }).addTo(map);
L.tileLayer('https://www.onemap.gov.sg/maps/tiles/Grey/{z}/{x}/{y}.png', { minZoom: 10.5, minNativeZoom: 11, maxNativeZoom: 19, maxZoom: 19,
  attribution: 'OneMap © SLA · Zoning © URA · Buildings © OpenStreetMap contributors' }).addTo(map);
const group = L.layerGroup().addTo(map);
let parcels = [], filter = 'all';

function select(p) {
  const el = $('#card');
  el.hidden = !p;
  document.body.classList.toggle('card-open', !!p);
  if (p) el.innerHTML = `<button class="x" aria-label="Close">×</button>${cardHtml(p)}`;
}

function draw() {
  group.clearLayers();
  const shown = parcels.filter(p => visible(p, filter));
  for (const p of shown) L.polygon(p.ring, { ...style(p), className: 'parcel' }).on('click', () => select(p)).addTo(group);
  $('#empty').hidden = shown.length > 0;
  for (const b of $('#rail').children) b.setAttribute('aria-pressed', b.dataset.f === filter);
  window.__future.layers = shown.length;
}

$('#rail').append(...FILTERS.map(f => Object.assign(document.createElement('button'), { textContent: LABEL[f], onclick: () => { filter = f; draw(); } }))
  .map((b, i) => (b.dataset.f = FILTERS[i], b)));
$('#card').addEventListener('click', e => { if (e.target.closest('.x')) select(null); });
addEventListener('keydown', e => { if (e.key === 'Escape') select(null); });

fetch('future.json', { cache: 'no-cache' }).then(r => { if (!r.ok) throw new Error(r.status); return r.json(); }).then(doc => {
  parcels = doc.parcels;
  draw();
  $('#note').textContent = noteText(doc.backtest, doc.reviewed);
  $('#status').textContent = `${parcels.length} candidate parcels · URA Master Plan 2025`;
  window.__future.ready = true;
}).catch(() => { $('#fail').hidden = false; $('#status').textContent = 'No data'; });

fetch('../projects/index.json', { cache: 'no-cache' }).then(r => r.json()).then(list => {
  for (const p of list) L.marker([p.lat, p.lon], { title: p.name, icon: L.divIcon({ className: `pin ${p.status}`, html: '<i></i>', iconSize: [18, 18] }) })
    .on('click', () => { location.href = `./?p=${p.id}`; }).addTo(map);
}).catch(() => {});
