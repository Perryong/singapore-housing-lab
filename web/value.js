// Value tab helpers (pure; no three.js).
import { money } from './format.js';

// estimate vs HDB's launch range for the flat type
export function gapText(est, lo, hi) {
  if (est > hi) return `≈ ${money(est - hi)} above the highest BTO price`;
  if (est < lo) return `≈ ${money(lo - est)} below the lowest BTO price`;
  return 'within the BTO price range';
}

// what drives the estimate, in dollars: bars scaled to the largest effect
export function driverBars(d) {
  const items = [['Location', d.location, 'vs the average HDB flat of this type'], ['Floor', d.floor, `vs floor ${d.floorRef ?? 8}`],
    ['Size', d.size, 'vs a typical unit of this type']].filter(([, v]) => v != null);
  const max = Math.max(1, ...items.map(([, v]) => Math.abs(v)));
  return items.map(([k, v, why]) => `<div class="drv"><span class="k">${k}</span><span class="track"><i class="bar ${v >= 0 ? 'pos' : 'neg'}"
    style="width:${Math.round(Math.abs(v) / max * 100)}%"></i></span><b>${v >= 0 ? '+' : '−'}${money(Math.abs(v))}</b><small>${why}</small></div>`).join('');
}
