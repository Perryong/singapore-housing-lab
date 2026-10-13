// Value tab helpers (pure; no three.js).
import { money, range, esc, pad } from './format.js';

// estimate vs HDB's launch range for the flat type
export function gapText(est, lo, hi) {
  if (est > hi) return `≈ ${money(est - hi)} above the highest BTO price`;
  if (est < lo) return `≈ ${money(lo - est)} below the lowest BTO price`;
  return 'within the BTO price range';
}

// what drives the estimate, in dollars: bars scaled to the largest effect
export function driverBars(d) {
  const items = [['Location', d.location, 'vs the average HDB flat of this type'], ['Floor', d.floor, `vs floor ${d.floorRef}`],
    ['Size', d.size, 'vs a typical unit of this type']].filter(([, v]) => v != null);
  const max = Math.max(1, ...items.map(([, v]) => Math.abs(v)));
  return items.map(([k, v, why]) => `<div class="drv"><span class="k">${k}</span><span class="track"><i class="bar ${v >= 0 ? 'pos' : 'neg'}"
    style="width:${Math.round(Math.abs(v) / max * 100)}%"></i></span><b>${v >= 0 ? '+' : '−'}${money(Math.abs(v))}</b><small>${why}</small></div>`).join('');
}

// Value tab: the selected stack's estimate (selStack/selFloor may be null) and every stack's range
export function valueHtml(P, stacks, selStack, selFloor) {
  const V = P.value;
  if (!V) return '<p class="unit-meta">No value estimate for this project.</p>';
  const m = V.metrics, k = v => money(v);
  const foot = `<p class="unit-meta">Typical error ±${m.mdape}% (median, on ${m.nTest.toLocaleString('en-SG')} recent sales the model did not see);
    the range held ${m.coverage}% of the latest three months' sales.</p><div class="src">Model trained on HDB resale transactions (data.gov.sg), 2017–${esc(V.asOf)}. Estimate, not a valuation.</div>`;
  const st = stacks.find(s => s.no === selStack), byS = st && V.byStack[String(st.no)];
  let card = '';
  if (st && !byS) card = `<p class="unit-meta">#${pad(selFloor)}-${pad(st.no)}: ${esc(V.skipped[String(st.no)] || 'no estimate for this stack')}.</p>`;
  else if (st) {
    const fl = Object.keys(byS).map(Number), f = fl.reduce((a, b) => Math.abs(b - selFloor) < Math.abs(a - selFloor) ? b : a);
    const [est, lo, hi] = byS[f], ref = byS[V.drivers[st.no].floorRef] || byS[Math.min(...fl)], pr = (P.prices || {})[st.type];
    card = `<div class="unit"><div class="unit-no">#${pad(f)}-${pad(st.no)}</div>
      <div class="vest">${k(est)}</div><div class="unit-meta">Range ${k(lo)}–${k(hi)} · a flat like this, resold today with ~${V.lease} years of lease left</div>
      ${pr ? `<div class="btovs">${gapText(est, pr.min, pr.max)} (BTO ${range(pr.min, pr.max)})</div>` : ''}
      <div class="lbl">What drives it</div>${driverBars({ ...V.drivers[st.no], floor: est - ref[0] })}
      ${/Plus|Prime/.test(P.classification || '') ? `<p class="unit-meta caveat">HDB ${esc(P.classification)} flats have a 10-year minimum occupation period and a subsidy clawback on resale; this estimate ignores both.</p>` : ''}</div>`;
  }
  const rows = Object.entries(V.byStack).map(([no, f]) => { const v = Object.values(f).map(x => x[0]), s = stacks.find(x => String(x.no) === no);
    return [no, s, Math.min(...v), Math.max(...v)]; }).sort((a, b) => b[3] - a[3]);
  const table = rows.length ? `<div class="lbl">Every stack · lowest to top floor</div><table class="rtable vtable"><thead><tr><th>Stack</th><th>Blk</th><th>Type</th><th>Estimate</th></tr></thead><tbody>${rows.map(([no, s, a, b]) =>
    `<tr data-s="${no}" class="${String(selStack) === no ? 'on' : ''}"><td>${no}</td><td>${esc(s?.blk || '')}</td><td>${esc(s?.type || '')}</td><td>${k(a)}–${k(b)}</td></tr>`).join('')}</tbody></table>`
    : `<div class="lbl">Typical unit at this site (floor 10)</div><table class="rtable"><tbody>${Object.entries(V.types).map(([t, [e, lo, hi]]) =>
      `<tr><td>${esc(t.toLowerCase())}</td><td>${k(e)}</td><td class="unit-meta">${k(lo)}–${k(hi)}</td></tr>`).join('')}</tbody></table>`;
  return `<h2>Estimated resale value</h2>${card || (rows.length ? '<p class="unit-meta">Pick a unit on the model or in the table to see its estimate.</p>' : '')}${table}${foot}`;
}
