// Commute tab: bus stops, services, MRT stations, and their SVG layers. Pure string builders (data from tools/build_commute.py).
import { esc } from './format.js';
import { LINE } from './nearby.js';
import { liveChip, nextBuses, liveLine } from './live.js';

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

// ladder rows [left, right]: a in travel order, b (other direction) reversed; LCS pairs stops <= 120 m apart onto one rung
export function ladder(a, b) {
  if (!b) return a.map(s => [s, null]);
  const r = [...b].reverse(), near = (p, q) => Math.hypot(p.x - q.x, p.z - q.z) <= 120;
  const L = Array.from({ length: a.length + 1 }, () => new Array(r.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) for (let j = r.length - 1; j >= 0; j--)
    L[i][j] = Math.max(near(a[i], r[j]) ? L[i + 1][j + 1] + 1 : 0, L[i + 1][j], L[i][j + 1]);
  const rows = [];
  for (let i = 0, j = 0; i < a.length || j < r.length;) {
    if (i < a.length && j < r.length && near(a[i], r[j]) && L[i][j] === L[i + 1][j + 1] + 1) rows.push([a[i++], r[j++]]);
    else if (j === r.length || (i < a.length && L[i][j] === L[i + 1][j])) rows.push([a[i++], null]);
    else rows.push([null, r[j++]]);
  }
  return rows;
}

// busrouter.sg-style two-lane route: picked direction runs down the left lane, the same number's other direction up the right
export function ladderHtml(T, key, here) {
  const pts = k => T.services[k]?.stops?.map((code, i) => ({ code, name: T.names?.[code] ?? code, x: T.services[k].stopPts[i][0], z: T.services[k].stopPts[i][1] }));
  const svc = T.services[key], a = pts(key);
  if (!a) return '';                                               // transit.json built before stop names
  const ok = Object.keys(T.services).find(k => k !== key && T.services[k].no === svc.no), b = ok && pts(ok);
  const cell = (s, side) => s ? `<span${s.code === here && side === 'l' ? ' class="here"' : ''}><small>${esc(s.code)}</small> ${esc(s.name)}${s.code === here && side === 'l' ? ' <b>· board here</b>' : ''}</span>` : '<span></span>';
  const rows = ladder(a, b).map(([l, r], i) => `<li class="${[l && 'hl', r && 'hr'].filter(Boolean).join(' ')}">${cell(l, 'l')}` +
    `<i class="track">${l && r ? '<b></b>' : ''}${i % 4 === 2 ? `<s class="dl">↓</s>${b ? '<s class="dr">↑</s>' : ''}` : ''}</i>${cell(r && r.code !== l?.code ? r : null, 'r')}</li>`).join('');
  return `<p class="lad-head${b ? '' : ' one'}"><span>↓ to ${esc(svc.to)}</span><i></i><span>${b ? '↑ to ' + esc(T.services[ok].to) : ''}</span></p>` +
    `<ol class="lad${b ? '' : ' one'}" aria-label="${esc(svc.no)} stops in order">${rows}</ol>`;
}

export function serviceCard(svc, stopCode, live = null, lad = '') {
  const t = svc.times?.[stopCode];
  return `<div class="svc-card"><p><b>${esc(svc.no)}</b> · ${esc(svc.from)} → ${esc(svc.to)} · ${svc.n} stops</p>` +
    (t ? `<p class="note">Here ${esc(t[0])}–${esc(t[1])}</p>` : '') +
    (live?.data ? `<p class="note">Next buses: ${esc(live.arr?.length ? nextBuses(live.arr, live.nowMs) : '–')}</p>` : '') +
    `<p class="note">every ${esc(svc.band)} min at 8 am${svc.road === false ? ' · route shape approximate' : ''}</p>${lad}</div>`;
}

export function stopsHtml(T, blk, selSvc, selStop = null, live = null) {
  const stops = T.stops.filter(s => s.walk && blk in s.walk).sort((a, b) => w(a, blk) - w(b, blk));
  // no stop given: fall back to the nearest stop carrying the service
  const at = selStop ?? stops.find(s => s.svc.some(no => svcKey(T, s, no) === selSvc))?.code;
  const rows = stops.map(s => {
    let card = '';
    const lv = live && live.stop === s.code ? live : null;
    const arrOf = no => lv.data.services?.find(x => x.no === no)?.arrivals || [];
    const chips = s.svc.map(no => {
      const k = svcKey(T, s, no);
      if (!k) return '';
      const on = k === selSvc && s.code === at;
      if (on) card = serviceCard(T.services[k], s.code, lv?.data && { data: 1, arr: arrOf(no), nowMs: lv.nowMs }, ladderHtml(T, k, s.code));
      return `<button class="svc" data-svc="${esc(k)}" data-stop="${esc(s.code)}" aria-pressed="${on}">${esc(lv?.data ? `${no} · ${liveChip(arrOf(no), lv.nowMs)}` : no)}</button>`;
    }).join('');
    return `<div class="stop" data-stop="${esc(s.code)}"><div class="aitem"><span>${esc(s.name)} <span class="note">${esc(s.code)}</span></span><span>≈${s.walk[blk]} min</span></div>${lv && (lv.data || lv.failed) ? `<p class="note live">${esc(liveLine(lv.updatedMs, lv.nowMs, !lv.data))}</p>` : ''}<div class="svcs">${chips}</div>${card}</div>`;
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

// lines, then every station once (interchanges bigger); fs > 0 also labels them, skipping names in `skip` and any that would overlap
export function railSvg(R, site, sw = 1, fs = 0, skip = new Set()) {
  const lines = Object.entries(R || {}).map(([p, v]) => v.paths.map(path =>
    `<polyline points="${path.map(([la, lo]) => toXZ(site, la, lo).join(',')).join(' ')}" fill="none" stroke="${LINE[p] || '#748477'}" stroke-width="${sw}" stroke-linejoin="round" opacity=".85"/>`).join('')).join('');
  const st = new Map();                                            // name -> [x, z, number of lines]
  for (const v of Object.values(R || {})) for (const [n, la, lo] of v.stations || []) {
    const s = st.get(n);
    if (s) s[2]++; else st.set(n, [...toXZ(site, la, lo), 1]);
  }
  const boxes = [], labels = [];
  const dots = [...st].map(([n, [x, z, k]]) => {
    const len = n.length * .55 * fs;
    const hit = boxes.some(([bx, bz, bl]) => Math.abs(x - bx) < (len + bl) / 2 + fs * .3 && Math.abs(z - bz) < fs * 1.1);   // shortcut: first come keeps its label
    if (fs && !hit && !skip.has(n.toLowerCase())) {
      boxes.push([x, z, len]);
      labels.push(`<text x="${x}" y="${z - sw * 2.2}" font-size="${fs}" text-anchor="middle" fill="currentColor" opacity=".75">${esc(n)}</text>`);
    }
    return `<circle cx="${x}" cy="${z}" r="${sw * (k > 1 ? 1.6 : 1.1)}" fill="#fff" stroke="#1D2A2E" stroke-width="${sw * (k > 1 ? .55 : .4)}"><title>${esc(n)}</title></circle>`;
  }).join('');
  return lines + dots + labels.join('');
}

export function routeSvg(svc, fs) {
  const p = svc.path, a = p[0], b = p[p.length - 1];
  const m = fs * .5;                                                // chevron at each vertex: travel direction
  return `<marker id="chev" viewBox="0 0 10 10" refX="5" refY="5" markerUnits="userSpaceOnUse" markerWidth="${m}" markerHeight="${m}" orient="auto"><path d="M2 1L8 5L2 9" fill="none" stroke="#fff" stroke-width="2.5"/></marker>` +
    `<polyline points="${p.map(q => q.join(',')).join(' ')}" fill="none" stroke="#2F6DB5" stroke-width="${fs * .3}" stroke-linejoin="round" stroke-linecap="round" marker-mid="url(#chev)"/>` +
    svc.stopPts.map(([x, z]) => `<circle cx="${x}" cy="${z}" r="${fs * .22}" fill="#fff" stroke="#2F6DB5" stroke-width="${fs * .1}"/>`).join('') +
    `<text x="${a[0] + fs * .5}" y="${a[1] - fs * .5}" font-size="${fs}" fill="#2F6DB5">from ${esc(svc.from)}</text>` +
    `<text x="${b[0] + fs * .5}" y="${b[1] + fs * 1.2}" font-size="${fs}" fill="#2F6DB5">to ${esc(svc.to)}</text>`;
}
