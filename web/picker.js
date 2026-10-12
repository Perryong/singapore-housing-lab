// Project header badge and the "Change project" catalogue (pure; no three.js).
import { range, money, esc } from './format.js';

export const BADGE = { launched: p => `BTO · ${p.launch} launch`, upcoming: p => `Upcoming BTO · ${p.launch}`, reference: () => 'Private condo · reference' };
const roomLbl = t => t.replace(/^(\d) ROOM$/, '$1-room');

export function cmpHtml(c) {                                    // BTO (orange) vs resale nearby (blue), same flat type
  if (!c) return '';
  return `<div class="cmp"><div class="bto${c.bto ? '' : ' na'}"><i>BTO</i>${c.bto ? `${roomLbl(c.type)} ${range(...c.bto)}` : 'Price announced at launch'}</div>
    <div class="rs"><i>Resale</i>${c.resale ? `${roomLbl(c.type)} median ${money(c.resale)} · ${c.radiusM} m` : `Too few ${roomLbl(c.type)} sales nearby`}</div></div>`;
}

// catalogue cards grouped by launch, filtered by every word of q; pid = the project on screen
export function pickerHtml(INDEX, pid, q = '') {
  q = q.trim().toLowerCase();
  const groups = {};
  for (const p of INDEX) {
    const hay = [p.name, p.town, p.launch, p.classification, ...p.flatTypes].join(' ').toLowerCase();
    if (q && !q.split(/\s+/).every(w => hay.includes(w))) continue;
    const g = p.status === 'upcoming' ? `Upcoming · ${p.launch}` : p.status === 'reference' ? 'Reference · private condo' : `${p.launch} BTO launch`;
    (groups[g] ||= []).push(p);
  }
  return Object.entries(groups).map(([g, ps]) => `<section class="group"><h3>${esc(g)}</h3><div class="cards">${ps.map(p => `
    <a class="card" href="?p=${encodeURIComponent(p.id)}" ${p.id === pid ? 'aria-current="page"' : ''}>
      <b>${esc(p.name)}</b>
      <div class="m">${esc([p.town, p.classification, `${p.units.toLocaleString('en-SG')} units`].filter(Boolean).join(' · '))}</div>
      <div class="m">${esc(p.flatTypes.join(', '))}</div>
      ${cmpHtml(p.cmp)}
      <span class="tag ${p.hasLayout ? '' : 'no'}">${p.hasLayout ? '3D sun study' : 'Layout not released'}</span>
    </a>`).join('')}</div></section>`).join('') || '<p class="note">No projects match.</p>';
}
