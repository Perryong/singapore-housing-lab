// Moon position, phase and rise/set (main terms of Meeus, Astronomical Algorithms ch. 47), plus Singapore wall-clock time.
// Pure: runs in the browser and in Node.
const R = Math.PI / 180, sin = x => Math.sin(x * R), cos = x => Math.cos(x * R);
const jd = ms => ms / 86400000 + 2440587.5;

function moonEcl(T) {                                           // ecliptic longitude/latitude (deg), distance (km)
  const Lp = 218.3164477 + 481267.88123421 * T, D = 297.8501921 + 445267.1114034 * T, M = 357.5291092 + 35999.0502909 * T;
  const Mp = 134.9633964 + 477198.8675055 * T, F = 93.2720950 + 483202.0175233 * T;
  const lon = Lp + 6.288774 * sin(Mp) + 1.274027 * sin(2 * D - Mp) + 0.658314 * sin(2 * D) + 0.213618 * sin(2 * Mp)
    - 0.185116 * sin(M) - 0.114332 * sin(2 * F) + 0.058793 * sin(2 * D - 2 * Mp) + 0.057066 * sin(2 * D - M - Mp)
    + 0.053322 * sin(2 * D + Mp) + 0.045758 * sin(2 * D - M) - 0.040923 * sin(M - Mp) - 0.034720 * sin(D) - 0.030383 * sin(M + Mp);
  const lat = 5.128122 * sin(F) + 0.280602 * sin(Mp + F) + 0.277693 * sin(Mp - F) + 0.173237 * sin(2 * D - F)
    + 0.055413 * sin(2 * D - Mp + F) + 0.046271 * sin(2 * D - Mp - F);
  const dist = 385000.56 - 20905.355 * cos(Mp) - 3699.111 * cos(2 * D - Mp) - 2955.968 * cos(2 * D) - 569.925 * cos(2 * Mp);
  return { lon, lat, dist };
}

// Moon altitude/azimuth (deg, azimuth from north clockwise) at time ms for a site {lat, lon}; h0 = rise/set altitude.
export function moonAltAz(site, ms) {
  const J = jd(ms), T = (J - 2451545) / 36525, { lon, lat, dist } = moonEcl(T), eps = 23.439291 - 0.0130042 * T;
  const ra = Math.atan2(sin(lon) * cos(eps) - Math.tan(lat * R) * sin(eps), cos(lon)) / R;
  const dec = Math.asin(sin(lat) * cos(eps) + cos(lat) * sin(eps) * sin(lon)) / R;
  const H = 280.46061837 + 360.98564736629 * (J - 2451545) + 0.000387933 * T * T + site.lon - ra;
  const alt = Math.asin(sin(site.lat) * sin(dec) + cos(site.lat) * cos(dec) * cos(H)) / R;
  const az = (Math.atan2(sin(H), cos(H) * sin(site.lat) - Math.tan(dec * R) * cos(site.lat)) / R + 180 + 360) % 360;
  const hp = Math.asin(6378.14 / dist) / R;                     // horizontal parallax
  return { alt, az, h0: 0.7275 * hp - 0.5667 };
}

// Moonrise / moonset in local minutes for the site's calendar day (null when it doesn't happen that day).
export function moonTimes(site, y, m, d) {
  const t0 = Date.UTC(y, m - 1, d) - site.tz * 3600000;
  const f = min => { const p = moonAltAz(site, t0 + min * 60000); return p.alt - p.h0; };
  const out = { rise: null, set: null };
  for (let a = 0; a < 1440; a += 10) {
    const b = Math.min(a + 10, 1440), fa = f(a), fb = f(b);
    if ((fa < 0) === (fb < 0)) continue;
    let lo = a, hi = b;
    for (let i = 0; i < 20; i++) { const c = (lo + hi) / 2; (f(lo) < 0) === (f(c) < 0) ? lo = c : hi = c; }
    const k = fa < 0 ? 'rise' : 'set';
    if (out[k] == null) out[k] = (lo + hi) / 2;
  }
  return out;
}

const NAMES = ['New moon', 'Waxing crescent', 'First quarter', 'Waxing gibbous', 'Full moon', 'Waning gibbous', 'Last quarter', 'Waning crescent'];
// Illuminated fraction, waxing?, phase name, and age angle (0 = new, 180 = full) at time ms.
export function moonPhase(ms) {
  const T = (jd(ms) - 2451545) / 36525, mo = moonEcl(T);
  const M = 357.52911 + 35999.05029 * T;
  const sunLon = 280.46646 + 36000.76983 * T + (1.914602 - 0.004817 * T) * sin(M) + 0.019993 * sin(2 * M) + 0.000289 * sin(3 * M);
  const psi = Math.acos(cos(mo.lat) * cos(mo.lon - sunLon)) / R;            // elongation
  const i = Math.atan2(1.496e8 * sin(psi), mo.dist - 1.496e8 * cos(psi)) / R;  // phase angle
  const illum = (1 + cos(i)) / 2, age = ((mo.lon - sunLon) % 360 + 360) % 360, waxing = age < 180;
  const name = illum < 0.02 ? NAMES[0] : illum > 0.98 ? NAMES[4] : Math.abs(illum - 0.5) < 0.04 ? NAMES[waxing ? 2 : 6]
    : waxing ? NAMES[illum < 0.5 ? 1 : 3] : NAMES[illum < 0.5 ? 7 : 5];
  return { illum, waxing, name, age };
}

// Singapore (UTC+8) calendar date and minutes past midnight, independent of the viewer's timezone.
export function sgtNow(ms = Date.now()) {
  const t = new Date(ms + 8 * 3600000);
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate(), min: t.getUTCHours() * 60 + t.getUTCMinutes() };
}

// Small SVG of the moon's phase: lit part on the right while waxing (as seen from Singapore, near the equator it tilts; good enough).
export function phaseSvg(illum, waxing, size = 18) {
  const r = 8, rx = r * Math.abs(1 - 2 * illum), side = waxing ? 1 : 0, bulge = illum > 0.5 ? side : 1 - side;
  const lit = illum < 0.01 ? '' : `<path d="M10 2 A${r} ${r} 0 0 ${side} 10 18 A${rx.toFixed(2)} ${r} 0 0 ${bulge} 10 2Z" fill="#F4EFD8"/>`;
  return `<svg width="${size}" height="${size}" viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="${r}" fill="#3B4A4E"/>${lit}</svg>`;
}
