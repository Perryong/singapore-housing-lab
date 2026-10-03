// Sun position (NOAA) and window shading against proxy boxes. Pure: runs in the browser and in Node.
import { deg } from './project.js';

export function solarPos(site, y, m, d, hour) {
  const { lat: LAT, lon: LON, tz: TZ } = site;
  const jd = Date.UTC(y, m - 1, d) / 86400000 + 2440587.5 + (hour - TZ) / 24;
  const T = (jd - 2451545) / 36525;
  const L0 = ((280.46646 + T * (36000.76983 + T * 0.0003032)) % 360 + 360) % 360;
  const M = (357.52911 + T * (35999.05029 - 0.0001537 * T)) * deg;
  const e = 0.016708634 - T * (0.000042037 + 0.0000001267 * T);
  const C = Math.sin(M) * (1.914602 - T * (0.004817 + 0.000014 * T)) + Math.sin(2 * M) * (0.019993 - 0.000101 * T) + Math.sin(3 * M) * 0.000289;
  const om = (125.04 - 1934.136 * T) * deg;
  const lam = (L0 + C - 0.00569 - 0.00478 * Math.sin(om)) * deg;
  const eps0 = 23 + (26 + (21.448 - T * (46.815 + T * (0.00059 - T * 0.001813))) / 60) / 60;
  const eps = (eps0 + 0.00256 * Math.cos(om)) * deg;
  const decl = Math.asin(Math.sin(eps) * Math.sin(lam));
  const yv = Math.tan(eps / 2) ** 2, L = L0 * deg;
  const eot = 4 * (yv * Math.sin(2 * L) - 2 * e * Math.sin(M) + 4 * e * yv * Math.sin(M) * Math.cos(2 * L) - 0.5 * yv * yv * Math.sin(4 * L) - 1.25 * e * e * Math.sin(2 * M)) / deg;
  const tst = hour * 60 + eot + 4 * LON - 60 * TZ;
  const ha = (tst / 4 - 180) * deg, lat = LAT * deg;
  const cz = Math.sin(lat) * Math.sin(decl) + Math.cos(lat) * Math.cos(decl) * Math.cos(ha);
  const alt = 90 - Math.acos(Math.max(-1, Math.min(1, cz))) / deg;
  let az = Math.atan2(Math.sin(ha), Math.cos(ha) * Math.sin(lat) - Math.tan(decl) * Math.cos(lat)) / deg + 180;
  az = (az % 360 + 360) % 360;
  return { alt, az, noon: (720 - 4 * LON - eot + TZ * 60) / 60 };
}
export const sunVec = (alt, az) => [Math.cos(alt * deg) * Math.sin(az * deg), Math.sin(alt * deg), -Math.cos(alt * deg) * Math.cos(az * deg)];

function blockedByContext(L, px, py, pz, s) {
  const dx = s[0], dz = s[2], len = Math.hypot(dx, dz); if (len < 1e-6) return false;
  for (const b of L.context) {
    const vx = b.cx - px, vz = b.cz - pz, tc = (vx * dx + vz * dz) / (len * len); if (tc * len < -b.r) continue;
    if (Math.abs(vx * dz - vz * dx) / len > b.r) continue;
    if (py + s[1] * Math.max(0, tc - b.r / len) > b.h) continue;
    const P = b.p;
    for (let i = 0; i < P.length; i++) {
      const a = P[i], c = P[(i + 1) % P.length], ex = c[0] - a[0], ez = c[1] - a[1];
      const den = dx * ez - dz * ex; if (Math.abs(den) < 1e-9) continue;
      const wx = a[0] - px, wz = a[1] - pz, t = (wx * ez - wz * ex) / den, u = (wx * dz - wz * dx) / den;
      if (t > 0 && u >= 0 && u <= 1 && py + s[1] * t < b.h) return true;
    }
  }
  return false;
}

// slab test of ray (p + t*s) against each oriented box; returns blocking block id, 'hdb' or 0
function blockedBy(L, px, py, pz, s, own) {
  for (const b of L.boxes) {
    if (b.own === own) continue;
    const dx = px - b.cx, dz = pz - b.cz;
    const o = [dx * b.ax + dz * b.az, py - b.H / 2, dx * b.fx + dz * b.fz];
    const d = [s[0] * b.ax + s[2] * b.az, s[1], s[0] * b.fx + s[2] * b.fz];
    const h = [b.hx, b.H / 2, b.hz];
    let tmin = 0.01, tmax = 1e9, miss = false;
    for (let k = 0; k < 3 && !miss; k++) {
      if (Math.abs(d[k]) < 1e-9) { miss = Math.abs(o[k]) > h[k]; continue; }
      let t1 = (-h[k] - o[k]) / d[k], t2 = (h[k] - o[k]) / d[k]; if (t1 > t2) [t1, t2] = [t2, t1];
      tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2); miss = tmin > tmax;
    }
    if (!miss) return b.blk;
  }
  return blockedByContext(L, px, py, pz, s) ? 'hdb' : 0;
}

// -> {st:'lit'|'shade'|'away', cos, by}
export function unitSun(L, u, s) {
  let best = 0, by = 0, facing = false;
  for (const f of u.st.fp) {
    const c = f.nx * s[0] + f.nz * s[2];
    if (c < 0.03) continue; facing = true;
    const b = blockedBy(L, f.px, u.y, f.pz, s, u.st.no);
    if (!b) { if (c > best) best = c; } else if (!by) by = b;
  }
  return best > 0 ? { st: 'lit', cos: best, by: 0 } : facing ? { st: 'shade', cos: 0, by } : { st: 'away', cos: 0, by: 0 };
}

// AM/PM/after-3pm hours per unit (10-minute samples), averaged per stack. Mutates units/stacks.
export function computeDay(L, site, y, m, d) {
  const dt = 1 / 6, samples = [], noon = solarPos(site, y, m, d, 13).noon;
  for (let h = 6; h < 20.5; h += dt) { const p = solarPos(site, y, m, d, h + dt / 2); if (p.alt > 0.5) samples.push({ h: h + dt / 2, s: sunVec(p.alt, p.az) }); }
  for (const u of L.units) {
    let am = 0, pm = 0, p3 = 0;
    for (const sm of samples) {
      if (unitSun(L, u, sm.s).st !== 'lit') continue;
      if (sm.h < noon) am += dt; else pm += dt;
      if (sm.h >= 15) p3 += dt;
    }
    Object.assign(u, { am, pm, p3 });
  }
  for (const st of L.stacks) {
    const n = st.units.length;
    st.am = st.units.reduce((a, u) => a + u.am, 0) / n; st.pm = st.units.reduce((a, u) => a + u.pm, 0) / n;
  }
  return noon;
}

export function computeNow(L, site, y, m, d, minutes) {
  const p = solarPos(site, y, m, d, minutes / 60); p.s = sunVec(p.alt, p.az);
  for (const u of L.units) {
    if (p.alt <= 0) { Object.assign(u, { now: 'night', cos: 0, by: 0 }); continue; }
    const r = unitSun(L, u, p.s); Object.assign(u, { now: r.st, cos: r.cos, by: r.by });
  }
  return p;
}
