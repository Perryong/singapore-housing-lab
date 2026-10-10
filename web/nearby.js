// Nearby helpers (pure; no three.js).

// shortcut: straight line × 1.3 at 80 m/min, not a routed walk; use OneMap routing if exact times are needed
export const walkMin = d => Math.max(1, Math.round(d * 1.3 / 80));

// MOE P1 priority bands, measured from the stack's block (straight line to the school's location)
export function schoolBands(st, amenities) {
  const sch = amenities.filter(a => a.cat === 'primary').map(a => ({ ...a, ds: Math.hypot(a.x - st.x, a.z - st.z) }))
    .sort((a, b) => a.ds - b.ds);
  return { within1: sch.filter(a => a.ds <= 1000), within2: sch.filter(a => a.ds > 1000 && a.ds <= 2000) };
}
