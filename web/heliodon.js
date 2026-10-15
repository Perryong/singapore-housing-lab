// "How it works" heliodon: one west-facing window, a taller neighbour, and the lamp on 21 Dec's sun path.
// The model is the app's own sun.js on a two-box scene (pure, runs in Node); mount() animates heliodon.html.
import { solarPos, sunVec, unitSun } from './sun.js';
import { fmtTime } from './format.js';

export const SITE = { lat: 1.35, lon: 103.82, tz: 8 }, DAY = [2026, 12, 21];
const box = (blk, cx, cz, hx, hz, H) => ({ blk, own: blk, cx, cz, ax: 1, az: 0, fx: 0, fz: 1, hx, hz, H });
export const HOME = box('home', 0, 0, 6, 15, 40), NBR = box('nbr', -28.5, 28, 16.5, 12, 45);   // metres, +x east, +z south
export const WIN = { px: -6.05, pz: 0, y: 20 };                // a window on the home block's west face
export const R = 86;                                           // lamp distance from the window, m
export const T0 = 7 * 60 + 5, T1 = 19 * 60;                    // tour range, inside sunrise 7:01 and sunset 19:04
const L = { boxes: [HOME, NBR], context: [] };
const U = { y: WIN.y, st: { no: 'home', fp: [{ nx: -1, nz: 0, px: WIN.px, pz: WIN.pz }] } };

// distance along s at which the ray from o enters box b (Infinity if it misses)
function enter(b, o, s) {
  let t0 = 0, t1 = Infinity;
  for (const [p, d, lo, hi] of [[o[0], s[0], b.cx - b.hx, b.cx + b.hx], [o[1], s[1], 0, b.H], [o[2], s[2], b.cz - b.hz, b.cz + b.hz]]) {
    if (Math.abs(d) < 1e-12) { if (p < lo || p > hi) return Infinity; continue; }
    let a = (lo - p) / d, c = (hi - p) / d; if (a > c) [a, c] = [c, a];
    t0 = Math.max(t0, a); t1 = Math.min(t1, c);
  }
  return t0 <= t1 ? t0 : Infinity;
}

// -> { alt, az, s, st: 'lit'|'shade'|'away'|'night', by, hit: where the ray ends (lamp, or the neighbour's wall) }
export function helioAt(min) {
  const p = solarPos(SITE, ...DAY, min / 60), s = sunVec(p.alt, p.az), o = [WIN.px, WIN.y, WIN.pz];
  const r = p.alt > 0 ? unitSun(L, U, s) : { st: 'night', by: 0 };
  const t = r.st === 'shade' ? enter(NBR, o, s) : R;
  return { alt: p.alt, az: p.az, s, st: r.st, by: r.by, hit: o.map((v, i) => v + s[i] * t) };
}

// figure space (anatomy kit): x north, y west, z up, K units per metre, model standing on the turntable top
export const K = 1.4, TABLE = 6;
export const toFig = ([x, y, z]) => [-z * K, -x * K, y * K + TABLE];

const STATE = { lit: 'sunlit', shade: 'in shade', away: 'facing away', night: 'night' };
const NEEDLE = { away: -1, lit: 0, shade: 1, night: -1 };     // dial sectors, one per state

export function mount(root) {
  const P = JSON.parse(root.dataset.p), D = JSON.parse(root.dataset.dial);
  const c = { sA: Math.sin(P.azimuth * Math.PI / 180), cA: Math.cos(P.azimuth * Math.PI / 180), sE: Math.sin(P.elevation * Math.PI / 180), cE: Math.cos(P.elevation * Math.PI / 180), k: P.scale * Math.sqrt(1.6) };
  const iso = ([x, y, z]) => [P.origin[0] + (x * c.sA - y * c.cA) * c.k, P.origin[1] + ((x * c.cA + y * c.sA) * c.sE - z * c.cE) * c.k];
  const f = v => v.toFixed(1), q = s => root.querySelector(`[data-part="${s}"]`);
  const lamp = q('lamp'), ray = q('ray'), rayEnds = root.querySelectorAll('[data-part="ray-end"]'), needle = q('needle');
  const stage = root.querySelector('.iso-stage'), readout = root.querySelector('[data-readout]');
  const win = toFig([WIN.px - 0.05, WIN.y, WIN.pz]), still = matchMedia('(prefers-reduced-motion: reduce)');
  let t = 15 * 60, target = t, swing = 0, touring = !still.matches, idle = 0, raf = 0, last = 0, alive = true;

  function draw() {
    const h = helioAt(t), at = iso(toFig(h.hit)), w = iso(win), l = iso(toFig([WIN.px + h.s[0] * R, WIN.y + h.s[1] * R, WIN.pz + h.s[2] * R])), o = iso([0, 0, 0]);
    lamp.setAttribute('transform', `translate(${f(l[0] - o[0])} ${f(l[1] - o[1])})`);
    root.dataset.st = h.st;
    ray.setAttribute('d', h.st === 'away' || h.st === 'night' ? '' : `M${f(w[0])} ${f(w[1])}L${f(at[0])} ${f(at[1])}`);
    [w, at].forEach((p, i) => { rayEnds[i].setAttribute('cx', f(p[0])); rayEnds[i].setAttribute('cy', f(p[1])); });
    const a = swing * 0.9, n = iso([D.x + Math.cos(a) * D.r, D.y - Math.sin(a) * D.r, D.z]), b = iso([D.x - Math.cos(a) * 2.5, D.y + Math.sin(a) * 2.5, D.z]);
    needle.setAttribute('d', `M${f(b[0])} ${f(b[1])}L${f(n[0])} ${f(n[1])}`);
    const text = `${fmtTime(t)} · sun ${Math.round(h.alt)}° up, ${Math.round(h.az)}° · ${STATE[h.st]}`;
    if (readout.textContent !== text) readout.textContent = text;
    stage.setAttribute('aria-valuenow', String(Math.round(t))); stage.setAttribute('aria-valuetext', text);
    return h;
  }
  function tick(now) {
    if (!alive) return;
    const dt = last ? Math.min((now - last) / 1000, 1 / 30) : 1 / 60; last = now;
    if (touring) { target += dt * 45; if (target > T1) target = t = T0; }          // 45 min of sun per second
    t = still.matches ? target : t + (target - t) * (1 - Math.exp(-dt / 0.25));
    if (Math.abs(target - t) < 0.5) t = target;
    const h = draw(), want = NEEDLE[h.st];
    swing = still.matches ? want : swing + (want - swing) * (1 - Math.exp(-dt / 0.18));
    if (Math.abs(want - swing) < 1e-3) swing = want;
    raf = touring || t !== target || swing !== want ? requestAnimationFrame(tick) : 0;
  }
  const run = () => { if (!raf && alive) { last = 0; raf = requestAnimationFrame(tick); } };
  const steer = to => {
    touring = false; target = Math.max(T0, Math.min(T1, to)); run();
    clearTimeout(idle); idle = setTimeout(() => { touring = !still.matches; run(); }, 4000);
  };
  stage.addEventListener('pointermove', e => {
    const r = stage.getBoundingClientRect(), share = Math.max(0, Math.min(1, ((e.clientX - r.left) / r.width - 0.15) / 0.7));
    steer(T1 - share * (T1 - T0));                               // the sun sets on the left of the figure
  });
  stage.addEventListener('keydown', e => {
    const by = { ArrowLeft: 15, ArrowUp: 15, ArrowRight: -15, ArrowDown: -15 }[e.key];
    if (e.key === 'Home' || e.key === 'End') { e.preventDefault(); steer(e.key === 'Home' ? T0 : T1); }
    else if (by) { e.preventDefault(); steer(target + by); }
  });
  swing = NEEDLE[draw().st]; draw(); run();
  return () => { alive = false; cancelAnimationFrame(raf); clearTimeout(idle); };
}
