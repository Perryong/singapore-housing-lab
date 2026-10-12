// Resale-nearby helpers (pure; no three.js).
import { money, range, esc, titleCase } from './format.js';
export const RESALE_TYPE = { '2RF1': '2 ROOM', '2RF2': '2 ROOM', '3RM': '3 ROOM', '4RM': '4 ROOM', '5RM': '5 ROOM', '3GEN': 'MULTI-GENERATION' };

export function defaultType(resale) {
  const s = resale.summary || {};
  if ((s['4 ROOM']?.n || 0) >= 3) return '4 ROOM';
  return Object.entries(s).sort((a, b) => b[1].n - a[1].n)[0]?.[0] || '4 ROOM';
}

const LO = [0xDC, 0xEB, 0xFA], HI = [0x0B, 0x3C, 0x7A];
export function psmRamp(v, min, max) {
  const t = max > min ? Math.min(1, Math.max(0, (v - min) / (max - min))) : 0.5;
  return '#' + LO.map((a, i) => Math.round(a + (HI[i] - a) * t).toString(16).padStart(2, '0')).join('');
}

export function trendSvg(points, w = 300, h = 90) {
  if (!points || points.length < 2) return '';
  const vs = points.map(p => p[1]), lo = Math.min(...vs), hi = Math.max(...vs), pad = 14;
  const x = i => pad + (w - 2 * pad) * i / (points.length - 1);
  const y = v => h - 18 - (h - 30) * (hi > lo ? (v - lo) / (hi - lo) : 0.5);
  const pts = points.map((p, i) => `${x(i).toFixed(1)},${y(p[1]).toFixed(1)}`).join(' ');
  return `<svg viewBox="0 0 ${w} ${h}" width="100%" role="img" aria-label="Median price per sqm by month">` +
    `<polyline fill="none" stroke="#1C5FD1" stroke-width="2" points="${pts}"/>` +
    `<text x="${pad}" y="${h - 3}" font-size="10" fill="#5B6C70">${esc(points[0][0])}</text>` +
    `<text x="${w - pad}" y="${h - 3}" font-size="10" fill="#5B6C70" text-anchor="end">${esc(points.at(-1)[0])}</text>` +
    `<text x="${pad}" y="10" font-size="10" fill="#5B6C70">$${hi.toLocaleString('en-SG')}/sqm</text>` +
    `<text x="${pad}" y="${h - 20}" font-size="10" fill="#5B6C70" dy="-2">$${lo.toLocaleString('en-SG')}</text></svg>`;
}

// One flat type to compare BTO vs resale on: what the BTO sells (4-room first), else the first type with a resale median.
const CMP_ORDER = ['4 ROOM', '5 ROOM', '3 ROOM', '2 ROOM'];
export function compareType(prices, summary = {}) {
  const sold = new Set(Object.keys(prices || {}).map(c => RESALE_TYPE[c]));
  return CMP_ORDER.find(t => sold.size ? sold.has(t) : summary[t]?.median) || null;
}

export const radiusTxt = m => m >= 1000 ? `${m / 1000} km` : `${m} m`;
export const typeLabel = t => titleCase(t).replace('Multi-Generation', 'Multi-generation (3Gen)');

// colour key for the resale map; [lo, hi] = $/sqm range of the coloured blocks (0 when none)
export function resaleLegendHtml(RS, rType, [lo, hi]) {
  return !RS ? '<div>No resale data for this project.</div>' : lo
    ? `<div class="ramp" style="background:linear-gradient(90deg,${psmRamp(lo, lo, hi)},${psmRamp(hi, lo, hi)})"></div>
       <div class="ramp-lbl"><span>$${lo.toLocaleString('en-SG')}/sqm</span><span>$${hi.toLocaleString('en-SG')}/sqm</span></div>
       <div style="margin-top:6px">Median resale price per sqm, ${typeLabel(rType)}, last ${RS.months} months. Grey blocks: fewer than 3 such sales.</div>`
    : `<div>No block within ${radiusTxt(RS.radiusM)} has 3+ ${typeLabel(rType)} resales in the last ${RS.months} months.</div>`;
}

export const resaleTypesHtml = (RS, rType) => Object.keys(RS.summary).map(t =>
  `<button class="chip" data-t="${esc(t)}" aria-pressed="${t === rType}">${esc(typeLabel(t))}</button>`).join('');

function btoLine(P, RS, rType) {
  const codes = Object.keys(P.prices || {}).filter(c => RESALE_TYPE[c] === rType);
  const s = RS.summary[rType];
  if (!codes.length || !s?.median) return '';
  const lo = Math.min(...codes.map(c => P.prices[c].min)), hi = Math.max(...codes.map(c => P.prices[c].max));
  return `<div class="btovs">This BTO ${esc(typeLabel(rType))}: <b>${range(lo, hi)}</b> · Resale nearby median <b>${money(s.median)}</b>${s.leaseLeft ? ` (${s.leaseLeft} yrs left)` : ''}</div>`;
}

// side panel in resale mode; rSort 'date' | 'price'
export function resalePanelHtml(P, rType, rSort) {
  const RS = P.resale;
  if (!RS) return '<p class="unit-meta">No resale data for this project.</p>';
  const rows = Object.entries(RS.summary).map(([t, s]) => `<tr${t === rType ? ' class="on"' : ''}><td>${esc(typeLabel(t))}</td><td>${s.n}</td>` +
    (s.median ? `<td>${money(s.median)}</td><td>$${s.psm.toLocaleString('en-SG')}</td><td>${s.leaseLeft ?? '—'}</td>` : '<td colspan="3" class="unit-meta">too few sales</td>') + '</tr>').join('');
  const sales = [...RS.sales].sort((a, b) => rSort === 'price' ? b.price - a.price : 0);
  return `<h2>Resale within ${radiusTxt(RS.radiusM)} · last ${RS.months} months</h2>
    <table class="rtable"><thead><tr><th>Type</th><th>Sales</th><th>Median</th><th>$/sqm</th><th>Yrs left</th></tr></thead><tbody>${rows}</tbody></table>
    ${btoLine(P, RS, rType)}
    <div class="lbl">${esc(typeLabel(rType))} · median $/sqm by month</div>${trendSvg(RS.trend[rType]) || '<p class="unit-meta">Not enough monthly sales for a trend.</p>'}
    <div class="tablehead"><div class="lbl">Recent sales</div><select id="rSort" aria-label="Sort sales"><option value="date"${rSort === 'date' ? ' selected' : ''}>Newest</option><option value="price"${rSort === 'price' ? ' selected' : ''}>Highest price</option></select></div>
    <div class="rsales">${sales.map(x => `<div><span>${esc(x.m)} · Blk ${esc(x.blk)} ${esc(titleCase(x.street))} · ${esc(typeLabel(x.type))} · ${esc(x.storey.toLowerCase())} · ${x.sqm} sqm</span><span>${money(x.price)}</span></div>`).join('')}</div>
    <div class="src">HDB resale transactions, data.gov.sg, up to ${esc(RS.asOf)}</div>`;
}

// card for one resale block b (from P.resale.blocks); asOf 'YYYY-MM'
export function resaleCardHtml(b, asOf) {
  const yr = +asOf.slice(0, 4), left = b.lease ? b.lease + 99 - yr : null;
  return `<div class="unit"><div class="unit-no" style="font-size:18px">Blk ${esc(b.blk)} ${esc(titleCase(b.street))}</div>
    <div class="unit-meta">${b.lease ? `${b.lease} lease (${left} years left)` : ''}${b.storeys ? ` · ${b.storeys} storeys` : ''}</div>
    <table class="rtable"><thead><tr><th>Type</th><th>Sales</th><th>Median</th><th>Latest</th></tr></thead><tbody>${Object.entries(b.types).map(([t, s]) =>
      `<tr><td>${esc(typeLabel(t))}</td><td>${s.n}</td><td>${s.median ? money(s.median) : '—'}</td><td>${money(s.lastPrice)} (${esc(s.last)})</td></tr>`).join('')}</tbody></table>
    <div class="rsales">${(b.recent || []).map(x => `<div><span>${esc(x.m)} · ${esc(typeLabel(x.type))} · ${esc(x.storey.toLowerCase())}</span><span>${money(x.price)}</span></div>`).join('')}</div>
    <div class="btns"><button class="btn" id="rClose">Close</button></div></div>`;
}
