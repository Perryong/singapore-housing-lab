// Sun-study panel HTML: unit card, stack table, legend (pure; no three.js).
import { money, range, esc, pad, fmtTime } from './format.js';
import { catOf, sizeOf } from './project.js';
import { RESALE_TYPE, radiusTxt } from './resale.js';
import { schoolBands } from './nearby.js';

export const COMPASS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
const LONG = { N: 'north', NNE: 'north-northeast', NE: 'northeast', ENE: 'east-northeast', E: 'east', ESE: 'east-southeast', SE: 'southeast', SSE: 'south-southeast', S: 'south', SSW: 'south-southwest', SW: 'southwest', WSW: 'west-southwest', W: 'west', WNW: 'west-northwest', NW: 'northwest', NNW: 'north-northwest' };
export const card16 = b => COMPASS[Math.round(((b % 360) + 360) % 360 / 22.5) % 16];
export const face8 = b => ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(((b % 360) + 360) % 360 / 45) % 8];
export const RAMP_PM = ['#EEF0EC', '#FFE7A3', '#F6A93B', '#DE5A2C', '#9A2430'], RAMP_AM = ['#EEF0EC', '#FFF1B8', '#F3CF4E', '#C99A12'];
export const FACE = { N: '#4F86B5', NE: '#6FAE9F', E: '#E6BE45', SE: '#B9A57A', S: '#5E9C7E', SW: '#E08447', W: '#CC3F2B', NW: '#9772AE' };
const hrs = v => v.toFixed(1) + ' h';
export const verdict = pm => pm < 1 ? 'Little afternoon sun on these windows.' : pm < 3 ? 'Some afternoon sun on these windows.' : 'Strong afternoon sun on these windows.';

export function schoolLine(P, st) {                             // MOE P1 priority bands from this stack's block
  if (!(P.amenities || []).some(a => a.cat === 'primary')) return '';
  const { within1, within2 } = schoolBands(st, P.amenities);
  const names = l => l.slice(0, 3).map(a => esc(a.name)).join(', ') + (l.length > 3 ? ` +${l.length - 3} more` : '');
  return `<div class="unit-meta schools"><b>Primary schools from Blk ${esc(st.blk)}</b> (P1 distance, approx.):
    ≤1 km: ${within1.length ? names(within1) : 'none'} · 1–2 km: ${within2.length ? names(within2) : 'none'}
    · <a href="https://www.moe.gov.sg/schoolfinder" target="_blank" rel="noopener">check MOE SchoolFinder ↗</a></div>`;
}

export function priceBlock(P, code) {
  const p = (P.prices || {})[code];
  if (!p) return code === 'RENT' ? '<div class="pricebox unit-meta">Rental flat — not for sale.</div>' : '';
  const r = (P.resaleComparables || {})[code];
  return `<div class="pricebox"><div class="pr">${range(p.min, p.max)} <span>HDB launch range</span></div>
    ${p.afterGrantsFrom ? `<div class="unit-meta" title="Lowest launch price minus the illustrative Enhanced CPF Housing Grant in HDB's launch materials; your grants depend on income and eligibility">From ${money(p.afterGrantsFrom)} after grants (illustrative, max. EHG)</div>` : ''}
    <div class="unit-meta">${p.sqm} sqm incl. aircon ledge${p.internalSqm ? ` (${p.internalSqm} sqm internal)` : ''} · ${p.units.toLocaleString('en-SG')} units · ~${p.waitingMonths}${p.waitingMonthsMax ? `–${p.waitingMonthsMax}` : ''} months wait</div>
    ${r ? `<div class="unit-meta">Resale nearby: ${range(r.min, r.max)}</div>` : ''}
    ${P.resale?.summary?.[RESALE_TYPE[code]]?.median ? `<div class="unit-meta">Resale nearby (same type, ${radiusTxt(P.resale.radiusM)}): median ${money(P.resale.summary[RESALE_TYPE[code]].median)}</div>` : ''}</div>`;
}

export function layoutThumb(P, base, no) {
  const l = (P.layouts || {})[String(no)];
  if (!l) return P.brochure
    ? `<a class="layout-src big" href="${esc(P.brochure)}" target="_blank" rel="noopener">Floor plan not extracted for this stack · open HDB brochure ↗</a>`
    : '<div class="layout-thumb none">Floor plan not available</div>';
  // where the crop image is missing, the link to HDB's brochure page becomes the main button
  const src = P.brochure ? `<a class="layout-src" href="${esc(P.brochure)}#page=${l.page}" target="_blank" rel="noopener">View floor plan in HDB brochure, p. ${l.page} ↗</a>` : '';
  return `<button class="layout-thumb" data-a="layout" aria-label="Open floor plan"><img src="${base + l.typical}" alt="Floor plan, stack ${pad(no)}" onerror="const b=this.parentElement;b.nextElementSibling?.classList.add('big');b.remove()"><span>Floor plan · tap to enlarge</span></button>${src}`;
}

// the selected unit: u is one floor of stack st; cur = {y, m, d, min} in Singapore time
export function unitCardHtml(P, base, st, u, cur) {
  if (!st) return `<p class="unit-meta" style="margin:0 0 14px">Tap any unit in the model, or a row below, to see its sun exposure.</p>`;
  const c = P.categories[catOf(P, u.code)], [sqm, sqft] = sizeOf(P, u.code);
  const dateStr = new Date(cur.y, cur.m - 1, cur.d).toLocaleDateString('en-SG', { day: 'numeric', month: 'short', year: 'numeric' }), t = fmtTime(cur.min);
  const nowTxt = u.now === 'lit' ? `At ${t} the windows are in direct sun.` : u.now === 'shade' ? `At ${t} the windows face the sun but are shaded by ${u.by === 'hdb' ? 'a neighbouring HDB block' : 'Block ' + u.by}.` : u.now === 'night' ? `At ${t} the sun is down.` : `At ${t} the sun is behind these windows.`;
  const dirs = st.faces.map(b => `${LONG[card16(b)]} (${b}°)`);
  return `<div class="unit">
    <div class="unit-no">#${pad(u.floor)}-${pad(st.no)}</div>
    <div class="utype"><i style="background:${c.col}"></i><span><b>${u.code}</b> · ${c.name} · ${sqm} sqm / ${sqft.toLocaleString('en-SG')} sq ft</span></div>
    <div class="unit-meta">Block ${st.blk}${st.collection ? `, ${st.collection} Collection` : ''}, floors ${pad(st.first)} to ${st.floors}. ${st.faces.length > 1 ? 'Corner unit, windows face ' + dirs.join(' and ') : 'Windows face ' + dirs[0]}.</div>
    <div class="stats">
      <div class="stat"><b>${hrs(u.am)}</b><span>Morning sun</span></div>
      <div class="stat"><b>${hrs(u.pm)}</b><span>Afternoon sun</span></div>
      <div class="stat"><b>${hrs(u.p3)}</b><span>After 3 pm</span></div>
    </div>
    ${priceBlock(P, st.type)}
    ${schoolLine(P, st)}
    ${st.type === 'RENT' ? '' : layoutThumb(P, base, st.no)}
    <div class="verdict">${verdict(u.pm)} <span class="unit-meta">(${dateStr})</span></div>
    <div class="now">${nowTxt}</div>
    <div class="btns">
      <button class="btn" data-a="up" ${u.floor >= st.floors ? 'disabled' : ''}>Floor up</button>
      <button class="btn" data-a="down" ${u.floor <= st.first ? 'disabled' : ''}>Floor down</button>
      <button class="btn" data-a="clear">Clear selection</button>
    </div></div>`;
}

// stack table, sorted 'pm' (least afternoon sun first), 'am' (most morning sun first) or by stack number
export function stackTable(P, stacks, by, selStack) {
  const list = [...stacks];
  if (by === 'pm') list.sort((a, b) => a.pm - b.pm || a.no - b.no); else if (by === 'am') list.sort((a, b) => b.am - a.am || a.no - b.no); else list.sort((a, b) => a.no - b.no);
  const title = by === 'pm' ? 'Stacks by afternoon sun' : by === 'am' ? 'Stacks by morning sun' : 'All stacks';
  const rows = list.map(st => { const c = P.categories[catOf(P, st.type)], pr = (P.prices || {})[st.type]; return `<tr data-s="${st.no}" class="${st.no === selStack ? 'on' : ''}" tabindex="0">
    <td><b>${pad(st.no)}</b></td><td>${st.blk}</td><td title="${c.name}, ${sizeOf(P, st.type)[1]} sq ft"><i class="tsw" style="background:${c.col}"></i>${st.type}</td><td>${st.faces.map(card16).join(' + ')}</td>
    <td>${st.am.toFixed(1)}<span class="bar am" style="width:${Math.min(20, st.am * 4)}px"></span></td>
    <td>${st.pm.toFixed(1)}<span class="bar" style="width:${Math.min(20, st.pm * 4)}px"></span></td>
    <td class="price">${pr ? range(pr.min, pr.max) : '—'}</td></tr>`; }).join('');
  return { title, rows };
}

const swatch = (c, t, extra = '') => `<span class="sw"><i style="background:${c};${extra}"></i>${t}</span>`;
export function legendHtml(P, mode, hasLayout) {
  if (!hasLayout) return `<div class="swatches">${swatch('#F6C47A', 'HDB site location')}${swatch('#9EA8A3', 'Existing HDB block')}</div>`;
  const grad = cs => `<div class="ramp" style="background:linear-gradient(90deg,${cs.join(',')})"></div><div class="ramp-lbl"><span>0 h</span><span>2.5 h</span><span>5 h+</span></div>`;
  const note = t => `<div style="margin-top:6px">${t}</div>`;
  return mode === 'now' ? `<div class="swatches">${swatch('#F07F1E', 'Direct sun')}${swatch('#7E95A3', 'Shaded by a building')}${swatch('#9EA8A3', 'Neighbouring HDB block')}${swatch('#E9ECE8', 'Sun behind windows', 'border:1px solid #bbb')}</div>${note('Deeper orange means the sun hits the windows more squarely.')}`
    : mode === 'pm' ? grad(RAMP_PM) + note('Hours of direct sun on the windows after solar noon on this date.')
    : mode === 'am' ? grad(RAMP_AM) + note('Hours of direct sun on the windows before solar noon.')
    : mode === 'type' ? `<div class="typelist">${Object.entries(P.categories).map(([k, v]) => {
        const codes = P.stacks.map(s => s.type).filter(c => catOf(P, c) === k); if (!codes.length) return '';
        const sz = [...new Set(codes.map(c => sizeOf(P, c)[1]))].sort((a, b) => a - b).join(' / ');
        return `<span class="sw"><i style="background:${v.col};border:1px solid rgba(0,0,0,.12)"></i>${v.name}<b>${sz} sq ft</b></span>`; }).join('')}</div>`
    : `<div class="swatches">${Object.entries(FACE).map(([k, v]) => swatch(v, k)).join('')}</div>${note("Direction of each unit's main windows.")}`;
}
