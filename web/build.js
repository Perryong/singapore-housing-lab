// BTO build view: the order units go up in, the six-stage timeline, and the state at any moment (pure, no DOM).
import { esc } from './format.js';
import { catOf, sizeOf } from './project.js';

export const STAGES = [
  { key: 'site', label: 'Site', dur: 1.8 }, { key: 'void', label: 'Void deck', dur: 2.0 },
  { key: 'floors', label: 'Typical floors', dur: 14.0 }, { key: 'roof', label: 'Roof', dur: 1.8 },
  { key: 'paint', label: 'Paint', dur: 1.8 }, { key: 'section', label: 'Section A–A', dur: 3.6 }];
export const TOTAL = 25;
const ROOF_M = 12;                                              // water tanks and lift motor rooms above the top floor

export function stages() {
  let t = 0;
  return STAGES.map(s => ({ ...s, t0: t, t1: (t = Math.round((t + s.dur) * 1000) / 1000) }));   // no float drift at boundaries
}

// floor by floor across all blocks (precast cycles run in parallel), then block, then stack, as in project.json
export function buildOrder(L, P) {
  const blk = Object.keys(P.blocks), stack = new Map(L.stacks.map((s, i) => [s, i]));
  // P.blocks keys are strings; a stack's block can be a number (thomson-reserve), so compare as strings
  return [...L.units].sort((a, b) => a.floor - b.floor || blk.indexOf(String(a.st.blk)) - blk.indexOf(String(b.st.blk)) || stack.get(a.st) - stack.get(b.st));
}

export function stateAt(t, order, L, P) {
  const S = stages(), N = order.length, tt = Math.min(TOTAL, Math.max(0, t));
  const stage = tt >= TOTAL ? S.length - 1 : S.findIndex(s => tt < s.t1), p = (tt - S[stage].t0) / S[stage].dur;
  const x = stage === 2 ? p * N : stage > 2 ? N : 0, step = Math.min(N, Math.floor(x));
  const active = stage === 2 && step < N ? order[step] : null;
  const minFirst = Math.min(...L.stacks.map(s => s.first));
  const maxFloors = Math.max(...Object.values(P.blocks).map(b => b.floors));
  const topY = [0, p * (minFirst - 1) * L.FH, active ? active.floor * L.FH : maxFloors * L.FH,
    maxFloors * L.FH + p * ROOF_M][stage] ?? maxFloors * L.FH + ROOF_M;
  return { t: tt, stage, key: S[stage].key, p, step, active, drop: stage === 2 ? x - step : stage > 2 ? 1 : 0,
    floors: stage < 2 ? Object.fromEntries(Object.keys(P.blocks).map(b => [b, 0])) : floorsDone(order, step, P),
    topY, paint: stage < 4 ? 0 : stage === 4 ? p : 1, cut: stage < 5 ? 0 : p };
}

// per block, the highest floor with every unit up to it placed
function floorsDone(order, step, P) {
  const left = {};                                             // blk -> floor -> units not yet placed
  for (let j = step; j < order.length; j++) {
    const u = order[j], b = (left[u.st.blk] ||= {});
    b[u.floor] = (b[u.floor] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(P.blocks).map(([b, B]) => {
    const open = Object.keys(left[b] || {}).map(Number);
    return [b, open.length ? Math.min(...open) - 1 : B.floors];
  }));
}

// the step the shaders reveal up to: -1 before the floors stage, so no unit hangs over its slot during site and void deck
export const revealStep = s => s.stage < 2 ? -1 : s.step;

/* ---------- panels ---------- */
const up = s => s.toUpperCase();
const typeName = (P, code) => P.categories[catOf(P, code)].name;

export function timelineHtml(s) {
  return stages().map((g, i) => {
    const done = i < s.stage ? 1 : i === s.stage ? s.p : 0;
    return `<div${i === s.stage ? ' class="cur"' : ''}><span>${String(i + 1).padStart(2, '0')} ${up(g.label)}</span>` +
      `<span class="bar"><i style="left:${(g.t0 / TOTAL * 100).toFixed(1)}%;width:${(done * g.dur / TOTAL * 100).toFixed(1)}%"></i></span>` +
      `<span>${Math.round(done * 100)}%</span></div>`;
  }).join('');
}

export function activeCardHtml(s, P, N) {
  const u = s.active, f = (k, v) => `<span><i>${k}</i><b>${v}</b></span>`, w = (k, v) => `<span class="w"><i>${k}</i><b>${v}</b></span>`;
  const step = `#${String(s.step).padStart(String(N).length, '0')} / ${N}`;
  return w('MEMBER', u ? `BLK ${esc(u.st.blk)} · #${String(u.floor).padStart(2, '0')}-${u.st.no}` : '—') +
    f('STEP', step) + f('STAGE', `${String(s.stage + 1).padStart(2, '0')} · ${up(STAGES[s.stage].label)}`) +
    f('FLAT TYPE', u ? esc(typeName(P, u.code)) : '—') + f('FLOOR AREA', u ? `${sizeOf(P, u.code)[0]} m²` : '—') +
    w('PLACED AT X · Y · Z', u ? `${[u.st.x, u.y, u.st.z].map(v => v.toFixed(1)).join(' · ')} m` : '—');
}

export function structureHtml(s, P) {
  return Object.entries(P.blocks).map(([b, B]) => {
    const n = s.floors[b] ?? 0;
    return `<div${s.active && String(s.active.st.blk) === b ? ' class="cur"' : ''}><span>${esc(b)}</span><span class="b"><i style="width:${(n / B.floors * 100).toFixed(1)}%"></i></span><span>${n} / ${B.floors}</span></div>`;
  }).join('');
}

// units placed in steps from+1..to; whole block-floors when steps are too quick to read one by one
export function logLines(order, from, to, P, stepDur) {
  if (to <= from) return [];
  const units = order.slice(from, to);
  if (stepDur >= 0.05) return units.map(u => `ASM BLK ${u.st.blk} · L${u.floor} · stack ${u.st.no} · ${typeName(P, u.code)}`);
  const out = [];
  for (let i = 0; i < units.length;) {
    const u = units[i], key = j => order[j] && order[j].st.blk === u.st.blk && order[j].floor === u.floor;
    let j = i; while (j < units.length && key(from + j)) j++;
    if (key(from + j)) break;                                   // the run carries on past `to`: not complete yet
    const n = {};
    for (const v of units.slice(i, j)) { const c = catOf(P, v.code); n[c] = (n[c] || 0) + 1; }
    out.push(`ASM BLK ${u.st.blk} · L${u.floor} · ${j - i} units · ${Object.entries(n).sort((a, b) => b[1] - a[1]).map(([c, k]) => `${c} ×${k}`).join(', ')}`);
    i = j;
  }
  return out;
}

export function titleBlockHtml(P, s, cam) {
  const cell = (k, v) => `<span><i>${k}</i><b>${v}</b></span>`;
  return `<div>${cell('DRAWING', esc(up(P.name)))}${cell('SCALE', 'NTS · illustrative')}</div>` +
    `<div>${cell('PHASE', up(STAGES[s.stage].label))}${cell('SHEET', `${s.stage + 1} / 6`)}</div>` +
    `<div>${cell('CAMERA', `AZ ${Math.round(cam.az)}° · EL +${Math.round(cam.el)}°`)}</div>`;
}

export function pickMime(isSupported) {
  const m = ['video/mp4;codecs=avc1', 'video/webm;codecs=vp9', 'video/webm'].find(isSupported);
  return m ? { mime: m, ext: m.startsWith('video/mp4') ? 'mp4' : 'webm' } : null;
}
