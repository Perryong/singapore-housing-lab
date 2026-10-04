// Resale-nearby helpers (pure; no three.js).
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
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
