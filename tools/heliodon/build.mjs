// usage: node tools/heliodon/build.mjs   -> web/heliodon.html (the "How it works" figure, animated by web/heliodon.js)
// Draws a heliodon with the anatomy kit (kit/, MIT): the lamp rides 21 Dec's sun path, centred on the tested window.
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as k from './kit/iso-kit.mjs';
import * as G from './kit/lathe.mjs';
import { helioAt, toFig, HOME, NBR, WIN, R, K, TABLE, T0, T1, SITE, DAY } from '../../web/heliodon.js';
import { sunTimes } from '../../web/sun.js';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '../../web/heliodon.html');
const W = 640, H = 470;

// world (figure units): x north, y west, z up; the model's metres come through toFig
const planOf = b => { const [x0, y0] = toFig([b.cx + b.hx, 0, b.cz + b.hz]), [x1, y1] = toFig([b.cx - b.hx, 0, b.cz - b.hz]); return { x: x0, y: y0, w: x1 - x0, d: y1 - y0, r: 0.6 }; };
const HOMEP = planOf(HOME), NBRP = planOf(NBR);
const WINF = toFig([WIN.px, WIN.y, WIN.pz]);
const { rise, set } = sunTimes(SITE, ...DAY);
const PATH = []; for (let m = Math.ceil(rise) + 1; m <= set - 1; m += 4) PATH.push(m);
const arc = (m, dr = 0) => { const h = helioAt(m), p = toFig([WIN.px + h.s[0] * (R + dr), WIN.y + h.s[1] * (R + dr), WIN.pz + h.s[2] * (R + dr)]); return p; };
const ENDS = [arc(PATH[0]), arc(PATH.at(-1))];

const PLATE = { x: -82, y: -122, w: 156, d: 262, r: 10 }, PLATE_H = 10, FOOT_H = 5;
const TT = { x: -17, y: 27, r: 58 };
const DIAL = { x: 46, y: 104, r: 15, z: 7 };
const KNOB = [58, 58];

const P = k.fitProjection(
  [...k.boxCorners(PLATE, -PLATE_H - FOOT_H, 0), ...PATH.map(m => arc(m, 4)), [NBRP.x, NBRP.y + NBRP.d, TABLE + NBR.H * K]],
  W, H, { pad: 18, azimuth: 45 });
const at = p => k.iso(p, P);
const S = (paths, o) => k.solidSvg(paths, o), Ln = (d, o) => k.lineSvg(d, o), Dt = (pts, o) => k.dotsSvg(pts, o);
const byDepth = pts => [...pts].sort((a, b) => k.depthOf([a[0], a[1], 0], P) - k.depthOf([b[0], b[1], 0], P));
const f = v => v.toFixed(1);

function base() {
  const out = [`<path class="iso-halo" d="${k.haloOf(PLATE, -PLATE_H - FOOT_H, PLATE_H, P)}"/>`];
  for (const [x, y] of byDepth(k.corners(PLATE, 20))) {
    out.push(S(k.cylinder(x, y, 8, -PLATE_H - FOOT_H, 1.6, P, 28), { tone: 'lo' }));
    out.push(S(k.cylinder(x, y, 6, -PLATE_H - FOOT_H + 1.6, FOOT_H - 1.6, P, 28), { tone: 'mid' }));
  }
  out.push(S(k.slabOf(PLATE, -PLATE_H, PLATE_H, P, 8, 1.4), { tone: 'mid' }));
  out.push(Ln(k.planOutline(k.insetPlan(PLATE, 5), 0, P), { tone: 'lo' }));
  const screws = k.corners(PLATE, 10);
  out.push(Ln(screws.map(([x, y]) => k.ring(x, y, 2.4, 0, P, 16)).join(''), { tone: 'lo' }));
  out.push(Dt(screws.map(([x, y]) => at([x, y, 0])), { size: 0.55 }));
  // ruler strip along the front edge
  const strip = { x: PLATE.x + PLATE.w - 15, y: -96, w: 7, d: 172, r: 1 };
  out.push(S(k.slabOf(strip, 0, 0.6, P, 3), { tone: 'lo', crease: 'none' }));
  const ticks = k.topTicks(strip.y + 4, strip.y + strip.d - 4, 4, 5, strip.x + 0.8, 0.6, [2, 3.8], P, 'y');
  out.push(Ln(ticks.minor, { tone: 'lo' }), Ln(ticks.major, { tone: 'mid' }));
  out.push(Dt([at([strip.x + 3.5, strip.y + 2, 0.6]), at([strip.x + 3.5, strip.y + strip.d - 2, 0.6])], { size: 0.45 }));
  // label plate with three rule lines (printed text)
  const lab = { x: 22, y: -108, w: 30, d: 20, r: 1.2 };
  out.push(S(k.slabOf(lab, 0, 0.8, P, 3, 0.4), { tone: 'mid', crease: 'none' }));
  out.push(Ln([5, 9, 13].map(dy => k.lineOnTop([lab.x + 4, lab.y + dy], [lab.x + (dy === 13 ? 16 : 26), lab.y + dy], 0.8, P)).join(''), { tone: 'lo', free: true }));
  out.push(Dt([at([lab.x + 2, lab.y + 2, 0.8]), at([lab.x + lab.w - 2, lab.y + lab.d - 2, 0.8])], { size: 0.4 }));
  return out.join('');
}

function turntable() {
  const out = [`<path class="iso-halo" d="${k.haloOf({ x: TT.x - TT.r, y: TT.y - TT.r, w: TT.r * 2, d: TT.r * 2, r: TT.r }, 0, 2, P)}" style="filter:blur(5px)"/>`];
  out.push(S(k.cylinder(TT.x, TT.y, TT.r + 3, 0, 2, P, 96), { tone: 'lo' }));
  out.push(S(k.cylinder(TT.x, TT.y, TT.r, 2, TABLE - 2, P, 96, 0.8), { tone: 'mid', inner: Ln(k.sideArc(TT.x, TT.y, TT.r, 4, P, 64), { tone: 'faint' }) }));
  const ticks = k.radialTicks(TT.x, TT.y, TT.r - 1.5, 72, 6, TABLE, [1.6, 3.4], P);
  out.push(Ln(ticks.minor, { tone: 'lo' }), Ln(ticks.major, { tone: 'mid' }));
  out.push(Ln(k.ring(TT.x, TT.y, TT.r - 6, TABLE, P, 96), { tone: 'faint' }));
  // north: a lit pointer from the inner ring to the rim, and the one engraved letter
  out.push(Ln(k.lineOnTop([TT.x + TT.r - 6, TT.y], [TT.x + TT.r - 0.6, TT.y], TABLE, P), { tone: 'hi' }));
  out.push(k.faceTextSvg(k.topMatrix([TT.x + TT.r - 10, TT.y], TABLE, P, 'y'), 'N', { size: 4, tone: 'mid', anchor: 'middle' }));
  out.push(Dt([0, 2.1, 4.2].map(a => at([TT.x + Math.cos(a) * (TT.r - 3.5), TT.y + Math.sin(a) * (TT.r - 3.5), TABLE])), { size: 0.45 }));
  return out.join('');
}

// a slab block with storey seams (3 m), a parapet line, rooftop kit and a column of windows on its visible faces
function block(b, plan, { tone, roof }) {
  const top = TABLE + b.H * K, storeys = [];
  for (let z = TABLE + 3 * K; z < top - 2; z += 3 * K) storeys.push(k.sideSeam(plan, z, P, 2));
  const out = [S(k.slabOf(plan, TABLE, top - TABLE, P, 2, 0.6), { tone, crease: 'lo', inner: Ln(storeys.join(''), { tone: 'faint' }) })];
  out.push(Ln(k.planOutline(k.insetPlan(plan, 1.6), top, P, 2), { tone: 'lo' }));
  out.push(S(k.slabOf(roof, top, 4, P, 2, 0.4), { tone: 'mid' }));
  return out.join('');
}
function windows(plan, b, face, skip) {                        // short window heads on the +y (west) or +x (north) face
  const top = TABLE + b.H * K, out = [];
  for (let z = TABLE + 3 * K * 0.6; z < top - 3; z += 3 * K) {
    const along = face === 'y' ? [plan.x + 4, plan.x + plan.w - 4] : [plan.y + 4, plan.y + plan.d - 4];
    for (let a = along[0]; a <= along[1] - 4; a += 9) {
      if (skip && skip(a, z)) continue;
      const p = face === 'y' ? [[a, plan.y + plan.d, z], [a + 4.2, plan.y + plan.d, z]] : [[plan.x + plan.w, a, z], [plan.x + plan.w, a + 4.2, z]];
      out.push(k.segment(p[0], p[1], P));
    }
  }
  return Ln(out.join(''), { tone: 'lo', free: true });
}

function blocks() {
  const home = block(HOME, HOMEP, { tone: 'hi', roof: { x: -6, y: -4, w: 12, d: 8, r: 0.6 } });
  const nbr = block(NBR, NBRP, { tone: 'mid', roof: { x: NBRP.x + 6, y: NBRP.y + 10, w: 10, d: 12, r: 0.6 } });
  const near = (a, z) => Math.abs(a + 2.1 - WINF[0]) < 5 && Math.abs(z - WINF[2]) < 3;
  // the tested window: a thin sill-mounted pane standing proud of the west face
  const pane = S(k.slabOf({ x: WINF[0] - 3.2, y: HOMEP.y + HOMEP.d, w: 6.4, d: 0.7, r: 0.2 }, WINF[2] - 2.6, 5.2, P, 2), { tone: 'hi', crease: 'none', className: 'helio-pane' });
  return [nbr, windows(NBRP, NBR, 'x'), windows(NBRP, NBR, 'y'), home, windows(HOMEP, HOME, 'y', near), windows(HOMEP, HOME, 'x'),
    `<g data-part="window">${pane}</g>`].join('');
}

function track() {
  const out = [];
  for (const [x, y, z] of ENDS) {                               // a post under each end of the arc, on a foot pad
    out.push(S(k.cylinder(x, y, 6, 0, 1.6, P, 28), { tone: 'lo' }));
    out.push(S(k.cylinder(x, y, 2.6, 1.6, z - 5.6, P, 24), { tone: 'mid', crease: 'none', inner: Ln(k.sideArc(x, y, 2.6, 8, P, 16), { tone: 'faint' }) }));
    out.push(S(k.cylinder(x, y, 3.6, z - 6, 2.4, P, 24), { tone: 'mid' }));
    out.push(S(k.slabOf({ x: x - 3, y: y - 3, w: 6, d: 6, r: 1 }, z - 3.6, 3.6, P, 2, 0.3), { tone: 'mid' }));
    out.push(Dt([at([x, y, 1.6])], { size: 0.45 }));
  }
  const outer = PATH.map(m => at(arc(m, 2.6))), inner = PATH.map(m => at(arc(m, -2.6)));
  const band = `M${[...outer, ...inner.reverse()].map(p => `${f(p[0])} ${f(p[1])}`).join('L')}Z`;
  out.push(`<path class="iso-fill" d="${band}"/><path class="iso-top" d="${band}" style="opacity:.6"/>`);
  out.push(Ln(`M${outer.map(p => `${f(p[0])} ${f(p[1])}`).join('L')}`, { tone: 'mid' }), Ln(`M${inner.reverse().map(p => `${f(p[0])} ${f(p[1])}`).join('L')}`, { tone: 'mid' }));
  // hour ticks across the band; noon (13:00 SGT is close to solar noon) gets a major tick
  const hours = []; for (let h = 8; h <= 18; h++) hours.push(h * 60);
  out.push(Ln(hours.filter(m => m !== 13 * 60).map(m => k.segment(arc(m, -2.6), arc(m, 2.6), P)).join(''), { tone: 'lo' }));
  out.push(Ln(k.segment(arc(13 * 60, -2.6), arc(13 * 60, 4.4), P), { tone: 'hi' }));
  return out.join('');
}

function lamp() {                                              // built at the origin, moved by web/heliodon.js
  const glow = `<circle class="helio-glow" cx="${f(at([0, 0, 0])[0])}" cy="${f(at([0, 0, 0])[1])}" r="11"/>`;
  const ball = S(G.sphereOf([0, 0, 0], 5, P), { tone: 'hi', className: 'helio-sun' });
  const cap = S(G.disc(-1.2, 1.2, 2.6, G.frameAlong([0, 0, -5.4], [0, 0, 1]), P), { tone: 'mid' });
  return `${glow}${cap}${ball}`;
}

function dial() {
  const { x, y, r, z } = DIAL, out = [];
  out.push(S(k.cylinder(x, y, r + 2, 0, 2, P, 48), { tone: 'lo' }));
  out.push(S(k.cylinder(x, y, r, 2, z - 2, P, 64, 0.8), { tone: 'hi', crease: 'lo' }));
  out.push(Ln(k.knurl(x, y, r, z - 2.6, z, 72, P, 0.3), { tone: 'lo' }));
  out.push(Ln(k.ring(x, y, r - 2, z, P, 64), { tone: 'lo' }));
  // three sectors, one per state: away (left), lit (centre), shade (right)
  const mark = a => k.lineOnTop([x + Math.cos(a) * (r - 6), y - Math.sin(a) * (r - 6)], [x + Math.cos(a) * (r - 2), y - Math.sin(a) * (r - 2)], z, P);
  out.push(Ln([-0.9, 0.9].map(mark).join(''), { tone: 'mid' }), Ln(mark(0), { tone: 'lit', className: 'helio-litmark' }));
  const minor = []; for (let a = -1.2; a <= 1.2001; a += 0.15) if (![-0.9, 0, 0.9].some(b => Math.abs(a - b) < 0.01)) minor.push(k.lineOnTop([x + Math.cos(a) * (r - 4), y - Math.sin(a) * (r - 4)], [x + Math.cos(a) * (r - 2), y - Math.sin(a) * (r - 2)], z, P));
  out.push(Ln(minor.join(''), { tone: 'lo' }));
  out.push(`<path data-part="needle" class="iso-line" data-tone="hi" data-free="end" style="stroke-width:1.1" d=""/>`);
  out.push(Ln(k.ring(x, y, 1.6, z, P, 16), { tone: 'mid' }), Dt([at([x, y, z])], { size: 0.6, tone: 'hi' }));
  // the time knob beside it
  const [kx, ky] = KNOB;
  out.push(S(k.cylinder(kx, ky, 7, 0, 1.4, P, 32), { tone: 'lo' }));
  out.push(S(k.cylinder(kx, ky, 5.4, 1.4, 5.6, P, 32), { tone: 'mid' }));
  out.push(Ln(k.knurl(kx, ky, 5.4, 1.6, 7, 40, P), { tone: 'lo' }));
  out.push(Ln(k.lineOnTop([kx, ky], [kx + 5.4, ky], 7, P), { tone: 'hi' }));
  return out.join('');
}

const lit0 = helioAt(15 * 60);
const svg = k.figureSvg({
  width: W, height: H,
  label: 'A heliodon: a model of one tower block and a taller neighbour on a turntable, with a lamp riding the sun\'s path for 21 December. A ray runs from one west-facing window towards the lamp. The window counts as sunlit only when it faces the lamp and nothing blocks the ray.',
  body: [base(), turntable(), track(), blocks(),
    `<g data-part="lamp">${lamp()}</g>`,
    `<path data-part="ray" class="iso-line helio-ray" data-tone="lit" d=""/><circle data-part="ray-end" class="iso-wire-end helio-end" r="1.3"/><circle data-part="ray-end" class="iso-wire-end helio-end" r="1.3"/>`,
    dial()],
});

const CSS = `
.helio.iso[data-theme="light"]{--anatomy-lit:#C9700A;--anatomy-card:#FBFCFA}
.helio .iso-figure{margin:0}
.helio .iso-plate{padding:44px 16px}
.helio .iso-stage{outline:none;cursor:ew-resize;touch-action:pan-y}
.helio .iso-stage:focus-visible{box-shadow:0 0 0 2px #E8931C;border-radius:4px}
.helio .helio-sun>.iso-top,.helio .helio-sun>.iso-shade{fill:#F6C47A!important;stroke:#F6C47A!important}
.helio .helio-sun>.iso-shade[data-shade="0"]{fill:#E8931C!important;stroke:#E8931C!important}
.helio .helio-sun>.iso-shade[data-shade="1"]{fill:#EEA543!important;stroke:#EEA543!important}
.helio .helio-sun>.iso-edge{stroke:#C9700A}
.helio .helio-glow{fill:#F6C47A;opacity:.35;filter:blur(4px)}
.helio .helio-ray{stroke-width:1.1}
.helio .helio-end{stroke:#C9700A}
.helio .helio-pane>.iso-fill,.helio .helio-pane>.iso-shade,.helio .helio-pane>.iso-top{transition:fill .3s}
.helio[data-st="lit"] .helio-pane>.iso-fill,.helio[data-st="lit"] .helio-pane>.iso-shade,.helio[data-st="lit"] .helio-pane>.iso-top{fill:#F6C47A}
.helio[data-st="shade"] .helio-pane>.iso-fill,.helio[data-st="shade"] .helio-pane>.iso-shade,.helio[data-st="shade"] .helio-pane>.iso-top{fill:#8A9AA0}
.helio[data-st="shade"] .helio-ray,.helio[data-st="shade"] .helio-end{stroke:#5B6B70;stroke-dasharray:3 2.5}
@media (prefers-reduced-motion:reduce){.helio .helio-pane>*{transition:none}}
`;

const body = k.plateHtml({
  fig: 'Fig 1', title: 'How the sun check works',
  hint: 'Hover or use arrow keys to move the sun',
  readout: `3:00 pm · sun ${Math.round(lit0.alt)}° up, ${Math.round(lit0.az)}° · sunlit`,
  keys: [
    { mark: 'lit', label: 'Lamp, ray and window: what the check looks at' },
    { mark: 'raised', label: 'Your block (white) and a taller neighbour' },
    { mark: 'dashed', label: 'Ray stopped by a building' },
  ],
  caption: 'For every window, every 10 minutes, the app does what this heliodon does: it puts the sun where it really is for your date and time in Singapore, then draws a straight line from the window towards it. The window counts as sunlit only if it faces the sun and that line reaches the sky without hitting a block. This is 21 December: the west-facing window gets no sun in the morning, is lit from about 1:20 pm, and falls into the neighbour\'s shadow at about 4:10 pm.',
  body: `<div class="iso-stage" tabindex="0" role="slider" aria-label="Time of day on 21 December: arrow keys move the sun" aria-valuemin="${T0}" aria-valuemax="${T1}" aria-valuenow="900">${svg}</div>`,
});

const html = `<!-- generated by tools/heliodon/build.mjs; do not edit -->
<div class="iso helio" data-theme="light" data-st="lit" data-p='${JSON.stringify(P)}' data-dial='${JSON.stringify(DIAL)}'><style>${k.ISO_CSS}${CSS}</style>${body}</div>
`;
writeFileSync(OUT, html);
console.log('wrote web/heliodon.html', (html.length / 1024).toFixed(0), 'KB');
