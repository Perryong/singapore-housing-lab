// BTO build view: the order units go up in, the six-stage timeline, and the state at any moment (pure, no DOM).

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
  return [...L.units].sort((a, b) => a.floor - b.floor || blk.indexOf(a.st.blk) - blk.indexOf(b.st.blk) || stack.get(a.st) - stack.get(b.st));
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
