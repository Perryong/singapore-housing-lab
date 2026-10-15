// Commute tab: bus stops, services, MRT stations, and their SVG layers. Pure string builders (data from tools/build_commute.py).
import { esc } from './format.js';
import { LINE } from './nearby.js';

export const toXZ = (site, lat, lon) => [Math.round((lon - site.lon) * 111320 * Math.cos(site.lat * Math.PI / 180)), Math.round(-(lat - site.lat) * 110574)];
const prefix = c => c.replace(/\d.*/, '');
const chipOf = c => `<b class="line" style="background:${LINE[prefix(c)] || '#748477'}">${esc(c)}</b>`;
const w = (o, blk) => o.walk?.[blk] ?? 1e9;

// a stop lists service numbers; pick the direction key whose times include the stop (loop stop: earlier in stopPts)
export function svcKey(T, stop, no) {
  const ks = Object.keys(T.services).filter(k => T.services[k].no === no && T.services[k].times?.[stop.code]);
  const at = k => { const i = T.services[k].stopPts.findIndex(p => p[0] === stop.x && p[1] === stop.z); return i < 0 ? 1e9 : i; };
  return ks.sort((a, b) => at(a) - at(b))[0] || null;
}

export function serviceCard(svc, stopCode) {
  const t = svc.times?.[stopCode];
  return `<div class="svc-card"><p><b>${esc(svc.no)}</b> · ${esc(svc.from)} → ${esc(svc.to)} · ${svc.n} stops</p>` +
    (t ? `<p class="note">Here ${esc(t[0])}–${esc(t[1])}</p>` : '') +
    `<p class="note">every ${esc(svc.band)} min at 8 am${svc.road === false ? ' · route shape approximate' : ''}</p></div>`;
}

export function stopsHtml(T, blk, selSvc, selStop = null) {
  const stops = T.stops.filter(s => s.walk && blk in s.walk).sort((a, b) => w(a, blk) - w(b, blk));
  // no stop given: fall back to the nearest stop carrying the service
  const at = selStop ?? stops.find(s => s.svc.some(no => svcKey(T, s, no) === selSvc))?.code;
  const rows = stops.map(s => {
    let card = '';
    const chips = s.svc.map(no => {
      const k = svcKey(T, s, no);
      if (!k) return '';
      const on = k === selSvc && s.code === at;
      if (on) card = serviceCard(T.services[k], s.code);
      return `<button class="svc" data-svc="${esc(k)}" data-stop="${esc(s.code)}" aria-pressed="${on}">${esc(no)}</button>`;
    }).join('');
    return `<div class="stop" data-stop="${esc(s.code)}"><div class="aitem"><span>${esc(s.name)} <span class="note">${esc(s.code)}</span></span><span>≈${s.walk[blk]} min</span></div><div class="svcs">${chips}</div>${card}</div>`;
  }).join('');
  return `<h3>${blk === 'site' ? 'Bus stops near the site' : 'Bus stops near Blk ' + esc(blk)}</h3>${rows || '<p class="note">None within range.</p>'}`;
}

export function stationCard(st, blk) {
  const exits = [...st.exits].sort((a, b) => w(a, blk) - w(b, blk));
  const lines = st.lines.map(l => `<p>${chipOf(l.code)} ${l.prev ? '‹ ' + esc(l.prev) : 'line end'} · ${l.next ? esc(l.next) + ' ›' : 'line end'}</p>` +
    (l.hubs?.length ? `<p class="note">Direct, no change: ${l.hubs.map(h => `${esc(h)} (${esc(prefix(l.code))})`).join(' · ')}</p>` : '')).join('');
  const n = exits[0];
  return `<div class="station-card">${lines}` +
    (n ? `<p class="note">Nearest: Exit ${esc(n.exit)}, ${w(n, blk) < 1e9 ? '≈' + w(n, blk) + ' min' : '—'}</p>` +
      `<p class="note">${exits.map(e => `${esc(e.exit)} ${w(e, blk) < 1e9 ? w(e, blk) + '′' : '—'}`).join(' · ')}</p>` : '') + '</div>';
}

export function stationsHtml(T, blk, selStation) {
  const near = st => Math.min(...st.exits.map(e => w(e, blk)));
  const rows = T.stations.filter(st => st.exits.some(e => blk in (e.walk || {}))).sort((a, b) => near(a) - near(b)).map(st => {
    const on = st.name === selStation;
    return `<div class="station" data-station="${esc(st.name)}"><button class="stn" data-station="${esc(st.name)}" aria-pressed="${on}">${esc(st.name)}</button> ${st.codes.map(chipOf).join('')}` +
      ` <span class="note">≈${near(st)} min to nearest exit</span>${on ? stationCard(st, blk) : ''}</div>`;
  }).join('');
  return `<h3>Nearest stations</h3>${rows || '<p class="note">None within range.</p>'}`;
}

export const railSvg = (R, site, sw = 1) => Object.entries(R || {}).map(([p, v]) => v.paths.map(path =>
  `<polyline points="${path.map(([la, lo]) => toXZ(site, la, lo).join(',')).join(' ')}" fill="none" stroke="${LINE[p] || '#748477'}" stroke-width="${sw}" stroke-linejoin="round" opacity=".85"/>`).join('')).join('');

export function routeSvg(svc, fs) {
  const p = svc.path, a = p[0], b = p[p.length - 1];
  return `<polyline points="${p.map(q => q.join(',')).join(' ')}" fill="none" stroke="#2F6DB5" stroke-width="${fs * .3}" stroke-linejoin="round" stroke-linecap="round"/>` +
    svc.stopPts.map(([x, z]) => `<circle cx="${x}" cy="${z}" r="${fs * .22}" fill="#fff" stroke="#2F6DB5" stroke-width="${fs * .1}"/>`).join('') +
    `<text x="${a[0] + fs * .5}" y="${a[1] - fs * .5}" font-size="${fs}" fill="#2F6DB5">from ${esc(svc.from)}</text>` +
    `<text x="${b[0] + fs * .5}" y="${b[1] + fs * 1.2}" font-size="${fs}" fill="#2F6DB5">to ${esc(svc.to)}</text>`;
}
