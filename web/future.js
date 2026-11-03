// Future BTO map: what a parcel looks like, which filter shows it, and its card (pure, no DOM).
import { esc, titleCase } from './format.js';

export const BAND = { likely: { label: 'Likely', colour: '#E8931C' }, possible: { label: 'Possible', colour: '#C9A24A' },
  longshot: { label: 'Long shot', colour: '#7E8C90' } };
export const FILTERS = ['all', 'near', 'far', 'announced'];
const HORIZON = { near: '≤ 5 years', far: '5–10 years' };
const pct = x => `${Math.round(x * 100)}%`;

export const visible = (p, filter) => filter === 'all' || (filter === 'announced' ? p.announced : p.horizon === filter);

export const style = p => ({ color: '#fff', weight: 1.5, dashArray: p.horizon === 'near' ? null : '5 4',
  fillColor: BAND[p.band].colour, fillOpacity: 0.6 });

export function cardHtml(p) {
  const src = p.source ? `Source: <a href="${esc(p.source)}" target="_blank" rel="noopener">${esc(new URL(p.source).hostname)}</a>. ` : '';
  return `<h2>${esc(p.name)}</h2>
<div class="meta">${p.areaHa} ha · ${esc(titleCase(p.lu))} · GPR ${esc(p.gpr ?? '—')}</div>
<div class="score"><b>${p.score}</b><span class="tag ${p.band}">${BAND[p.band].label}</span><span class="tag t">${HORIZON[p.horizon]}</span></div>
<ul>${p.reasons.map(([t, n]) => `<li><span>${esc(t)}</span><span>+${n}</span></li>`).join('')}</ul>
<small>${src}An estimate from URA zoning, not an HDB announcement.</small>`;
}

export function noteText(bt, reviewed) {
  const day = new Date(`${reviewed.growthAreas}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  return `Backtest on the 2019 plan: ${pct(bt.topDecile)} of ${bt.n} new HDB sites (blocks finished 2022–26 and BTOs launched since Oct 2025) ` +
    `fell in the top 10% of parcels (MRT distance alone: ${pct(bt.mrtOnly)}, random: ${pct(bt.random)}).` +
    `${bt.dropped?.includes('rezoned') ? ' Rezoning not tested.' : ''} Announcements reviewed ${day}.`;
}
