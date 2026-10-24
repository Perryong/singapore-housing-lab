// Commute tab: door-to-hub table, bus stops, stations, reach map. Pure string builders (data from tools/build_commute.py).
import { esc } from './format.js';
import { LINE, walkMin } from './nearby.js';
import { railSvg, routeSvg, stopsHtml, stationsHtml } from './transit.js';

const chip = (bg, t) => `<b class="line" style="background:${bg}">${esc(t)}</b>`;
const leg = ([k, v]) => k === 'walk' ? chip('#8A948C', 'walk ' + v)
  : k === 'rail' ? chip(LINE[v.replace(/\d.*/, '')] || '#748477', v)   // LRT prefixes (BP, SE...) fall back to grey
  : chip('#2F6DB5', v);
const mins = h => h ? h[0] + ' min' : 'over 60 min';
// bands stack in the SVG, so each swatch shows the composited shade: 1 - (1-.12)(1-.22)(1-.45) = .62, then .31, .12
const key = (rail, bus) => '<p class="note reach-key">' + [[.62, 15], [.31, 30], [.12, 45]].map(([o, t]) => `<span><i style="opacity:${o}"></i>${t} min</span>`).join('') +
  (rail ? '<span>coloured lines = MRT</span>' + (bus ? '<span>blue = selected bus</span>' : '') : '') + '</p>';

export function reachSvg(C, R = null, svc = null, site = null, px = 340) {   // px: rendered width; wider also names every station
  const hubs = C.hubs[C.near] || Object.values(C.hubs)[0] || [];
  const pts = [...(C.reach['45'] || []).flat(), ...C.hubPts.map(([, x, z]) => [x, z]), [0, 0]];
  const xs = pts.map(p => p[0]), zs = pts.map(p => p[1]);
  const x0 = Math.min(...xs), z0 = Math.min(...zs), w = Math.max(...xs) - x0, h = Math.max(...zs) - z0;
  const m = Math.max(w, h) * 0.1, fs = Math.max(w, h) * 1.2 / px * 11;   // ~11 px rendered text at any width
  const path = b => `<path d="${(C.reach[b] || []).map(r => 'M' + r.map(p => p.join(' ')).join('L') + 'Z').join('')}" fill="var(--accent)" fill-opacity="${{ 15: .45, 30: .22, 45: .12 }[b]}"/>`;
  const within = C.hubPts.filter((_, i) => hubs[i] && hubs[i][0] <= 30).map(p => p[0]);
  const alt = 'Within 30 min: ' + (within.join(', ') || 'none of the hubs');
  const right = x0 + w + m;
  const boxes = [], labels = [];
  const dots = C.hubPts.map(([n, x, z], i) => {
    const t = `${n}${hubs[i] ? ` · ${hubs[i][0]}′` : ' · over 60′'}`, len = t.length * .55 * fs;
    const end = x + fs * .7 + len > right;   // label would be clipped: put it left of the dot
    const lx = end ? x - fs * .7 - len : x + fs * .7;
    let ty = z + fs * .3;
    while (boxes.some(q => lx < q[0] + q[2] && q[0] < lx + len && Math.abs(ty - q[1]) < fs * 1.05)) ty += fs * 1.1;   // shortcut: nudge down, no look-ahead
    boxes.push([lx, ty, len]);
    labels.push(`<text x="${end ? x - .7 * fs : x + .7 * fs}" y="${ty}" font-size="${fs}"${end ? ' text-anchor="end"' : ''} fill="currentColor" stroke="#FAFBF9" stroke-width="${fs * .3}" paint-order="stroke">${esc(t)}</text>`);   // halo: readable over station dots
    return `<circle cx="${x}" cy="${z}" r="${fs * .4}" fill="#1D2A2E"/>`;
  }).join('');
  const s = fs * .5;
  return `<svg viewBox="${x0 - m} ${z0 - m} ${w + 2 * m} ${h + 2 * m}" role="img" aria-label="${esc(alt)}" class="reach">${['45', '30', '15'].map(path).join('')}${R && site ? railSvg(R, site, fs * .18, px > 340 ? fs * .8 : 0, new Set(C.hubPts.map(p => p[0].toLowerCase()))) : ''}${dots}${svc ? routeSvg(svc, fs) : ''}${labels.join('')}` +
    `<rect x="${-s}" y="${-s}" width="${2 * s}" height="${2 * s}" transform="rotate(45)" fill="var(--accent)" stroke="#fff"/></svg>`;
}

export function commuteHtml(P, stacks, selStack, T = null, R = null, pick = {}, live = null) {
  const C = P.commute;
  if (!C) return '<p class="note">No commute data for this project.</p>';
  const sel = stacks.find(s => s.no === selStack);
  const blk = sel && C.hubs[sel.blk] ? sel.blk : C.near;
  const hubs = C.hubs[blk] || [];
  const where = blk === 'site' ? 'from the site centre' : 'Blk ' + esc(blk);
  const rows = C.hubPts.map(([n], i) => `<tr><td>${esc(n)}</td><td>${mins(hubs[i])}</td><td>${(hubs[i]?.[1] || []).map(leg).join(' › ')}</td></tr>`).join('');
  const obj = T && typeof T === 'object';
  const stops = obj ? '' : (C.stops || []).slice(0, 4).map(s => `<div class="aitem"><span>${esc(s.name)}</span><span>${s.d} m · ≈${walkMin(s.d)} min</span></div>` +
    `<p class="note">${s.svc.map(([no, a, b]) => `${esc(no)} ${esc(a)}–${esc(b)}`).join(' · ')}</p>`).join('');
  const liveShown = obj && live?.data && T.stops.some(s => s.code === live.stop && s.walk && blk in s.walk);   // same stops stopsHtml lists
  return `<h3>Door to hub, weekday 8 am · ${where}</h3>` +
    (sel ? (sel.blk === blk ? '' : `<p class="note">No times for this block; showing ${where}</p>`) : blk !== 'site' ? '<p class="note">Pick a unit to see its block</p>' : '') +
    `<table class="commute"><thead><tr><th>Hub</th><th>Time</th><th>Route</th></tr></thead><tbody>${rows}</tbody></table>` +
    (obj ? stopsHtml(T, blk, pick.svc || null, pick.stop ?? null, live) + stationsHtml(T, blk, pick.station || null)
      : `<h3>Nearest bus stops</h3>${stops || '<p class="note">None within range.</p>'}` +
        (T === false ? '<p class="note">Bus and MRT details unavailable</p>' : '<p class="note">Loading bus and MRT details…</p>')) +
    `<h3>Reach map</h3><button class="reach-open" aria-haspopup="dialog" aria-label="Expand reach map">${reachHtml(P, stacks, selStack, T, R, pick)}<span class="reach-zoom" aria-hidden="true">⤢ Expand</span></button>` +
    (liveShown ? '<p class="note">Hub times are estimated from LTA timetables and service frequencies; times are to the hub\'s MRT platform; real trips vary. Live minutes for the selected stop: LTA DataMall.</p>'
      : '<p class="note">Estimated from LTA timetables and service frequencies, not live data; times are to the hub\'s MRT platform; real trips vary.</p>');
}

// key + map for the selected block (same block and bus as commuteHtml); px > 340 is the expanded view
export function reachHtml(P, stacks, selStack, T, R, pick = {}, px = 340) {
  const C = P.commute, sel = stacks.find(s => s.no === selStack);
  const blk = sel && C.hubs[sel.blk] ? sel.blk : C.near, obj = T && typeof T === 'object';
  const svc = obj && pick.svc && pick.svc in T.services ? T.services[pick.svc] : null;
  return key(obj && R, svc) + reachSvg({ ...C, near: blk }, obj ? R : null, svc, P.site, px);
}
