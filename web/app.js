import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { buildLayout, bdir, catOf, sizeOf, deg } from './project.js';
import { solarPos, sunVec, computeDay, computeNow, sunTimes } from './sun.js?v=2';
import { moonAltAz, moonTimes, moonPhase, sgtNow, phaseSvg } from './moon.js?v=1';
import { money, range } from './format.js';
import { RESALE_TYPE, defaultType, psmRamp, trendSvg } from './resale.js';
import { walkMin, schoolBands } from './nearby.js';
import { gapText, driverBars } from './value.js';
import { openPlan3d } from './plan3d.js';

const $ = s => document.querySelector(s);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const INDEX = await fetch('../projects/index.json', { cache: 'no-cache' }).then(r => r.json());
const asked = new URLSearchParams(location.search).get('p');
// no project in the URL: open the newest launched project with a model, and show the picker
const pid = INDEX.some(p => p.id === asked) ? asked : (INDEX.find(p => p.status === 'launched' && p.hasLayout) || INDEX[0]).id;
const base = `../projects/${encodeURIComponent(pid)}/`;
const P = await fetch(base + 'project.json', { cache: 'no-cache' }).then(r => { if (!r.ok) throw new Error(`No project "${pid}"`); return r.json(); });
const L = buildLayout(P), { stacks, units, FH } = L, site = P.site;
const hasLayout = stacks.length > 0;

/* ---------- Which project is this: header + picker ---------- */
const BADGE = { launched: p => `BTO · ${p.launch} launch`, upcoming: p => `Upcoming BTO · ${p.launch}`, reference: () => 'Private condo · reference' };
document.title = `${P.name} · ${BADGE[P.status](P)} · Sun study`;
$('#badge').textContent = BADGE[P.status](P); $('#badge').className = 'badge ' + P.status;
$('#projName').textContent = P.name;
$('#projMeta').textContent = [P.town, P.classification && `${P.classification}`, P.units && `${P.units.toLocaleString('en-SG')} units`].filter(Boolean).join(' · ');
$('#name').textContent = P.name; $('#tagline').textContent = P.tagline || ''; $('#notes').textContent = P.notes || '';

const picker = $('#picker');
const roomLbl = t => t.replace(/^(\d) ROOM$/, '$1-room');
function cmpHtml(c) {                                          // BTO (orange) vs resale nearby (blue), same flat type
  if (!c) return '';
  return `<div class="cmp"><div class="bto${c.bto ? '' : ' na'}"><i>BTO</i>${c.bto ? `${roomLbl(c.type)} ${range(...c.bto)}` : 'Price announced at launch'}</div>
    <div class="rs"><i>Resale</i>${c.resale ? `${roomLbl(c.type)} median ${money(c.resale)} · ${c.radiusM} m` : `Too few ${roomLbl(c.type)} sales nearby`}</div></div>`;
}
function renderPicker(q = '') {
  q = q.trim().toLowerCase();
  const groups = {};
  for (const p of INDEX) {
    const hay = [p.name, p.town, p.launch, p.classification, ...p.flatTypes].join(' ').toLowerCase();
    if (q && !q.split(/\s+/).every(w => hay.includes(w))) continue;
    const g = p.status === 'upcoming' ? `Upcoming · ${p.launch}` : p.status === 'reference' ? 'Reference · private condo' : `${p.launch} BTO launch`;
    (groups[g] ||= []).push(p);
  }
  $('#pickList').innerHTML = Object.entries(groups).map(([g, ps]) => `<section class="group"><h3>${esc(g)}</h3><div class="cards">${ps.map(p => `
    <a class="card" href="?p=${encodeURIComponent(p.id)}" ${p.id === pid ? 'aria-current="page"' : ''}>
      <b>${esc(p.name)}</b>
      <div class="m">${esc([p.town, p.classification, `${p.units.toLocaleString('en-SG')} units`].filter(Boolean).join(' · '))}</div>
      <div class="m">${esc(p.flatTypes.join(', '))}</div>
      ${cmpHtml(p.cmp)}
      <span class="tag ${p.hasLayout ? '' : 'no'}">${p.hasLayout ? '3D sun study' : 'Layout not released'}</span>
    </a>`).join('')}</div></section>`).join('') || '<p class="note">No projects match.</p>';
}
$('#change').addEventListener('click', () => { renderPicker($('#pickSearch').value); picker.showModal(); $('#pickSearch').focus(); });
$('#pickClose').addEventListener('click', () => picker.close());
picker.addEventListener('click', e => { if (e.target === picker) picker.close(); });
$('#pickSearch').addEventListener('input', e => renderPicker(e.target.value));
if (!asked) { renderPicker(); picker.showModal(); }

if (!hasLayout) {
  for (const id of ['#labelsRow', '#unitCard', '#tableHead', '#tableWrap', '#tableNote']) $(id).hidden = true;
  document.querySelectorAll('#modes .mode').forEach(b => { b.hidden = b.dataset.m !== 'resale'; });
  if (!P.resale) { $('#modesLbl').hidden = $('#modes').hidden = true; }
  const card = $('#upcomingCard'); card.hidden = false;
  card.innerHTML = `<div class="unit"><div class="unit-no" style="font-size:18px">Layout not released yet</div>
    <p class="unit-meta">HDB publishes the site plan at the sales launch. Until then this view shows the site and the existing HDB blocks around it.</p>
    <p class="unit-meta"><b>Prices and layouts are released at HDB's sales launch.</b></p>
    <dl class="facts"><dt>Launch</dt><dd>${esc(P.launch)}</dd><dt>Town</dt><dd>${esc(P.town)}</dd>
    <dt>Units</dt><dd>${P.units.toLocaleString('en-SG')}</dd><dt>Flat types</dt><dd>${esc(P.flatTypes.join(', '))}</dd>
    ${P.contract ? `<dt>HDB contract</dt><dd>${esc(P.contract)}</dd>` : ''}</dl></div>`;
}

/* ---------- Labels & colours ---------- */
const COMPASS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
const LONG = { N: 'north', NNE: 'north-northeast', NE: 'northeast', ENE: 'east-northeast', E: 'east', ESE: 'east-southeast', SE: 'southeast', SSE: 'south-southeast', S: 'south', SSW: 'south-southwest', SW: 'southwest', WSW: 'west-southwest', W: 'west', WNW: 'west-northwest', NW: 'northwest', NNW: 'north-northwest' };
const card16 = b => COMPASS[Math.round(((b % 360) + 360) % 360 / 22.5) % 16];
const face8 = b => ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(((b % 360) + 360) % 360 / 45) % 8];
const pad = n => String(n).padStart(2, '0');
const col = h => new THREE.Color(h);
function mkRamp(hexes) { const cs = hexes.map(col); return v => { v = Math.max(0, Math.min(1, v)); const x = v * (cs.length - 1), i = Math.min(cs.length - 2, Math.floor(x)); return cs[i].clone().lerp(cs[i + 1], x - i); }; }
const RAMP_PM = ['#EEF0EC', '#FFE7A3', '#F6A93B', '#DE5A2C', '#9A2430'], RAMP_AM = ['#EEF0EC', '#FFF1B8', '#F3CF4E', '#C99A12'];
const ramp = mkRamp(RAMP_PM), amramp = mkRamp(RAMP_AM);
const FACE = { N: '#4F86B5', NE: '#6FAE9F', E: '#E6BE45', SE: '#B9A57A', S: '#5E9C7E', SW: '#E08447', W: '#CC3F2B', NW: '#9772AE' };
const C_AWAY = col('#E9ECE8'), C_SHADE = col('#7E95A3'), C_NIGHT = col('#8B95A3'), C_LITLO = col('#FFE39A'), C_LITHI = col('#F07F1E');
const SKY = [[-8, '#18233A'], [-2, '#3D4A6E'], [2, '#EDB38C'], [10, '#CFDDE3'], [30, '#B7D5EA'], [90, '#A6CDEB']];
function skyColor(a) {
  if (a <= SKY[0][0]) return col(SKY[0][1]);
  for (let i = 0; i < SKY.length - 1; i++) { const [a0, c0] = SKY[i], [a1, c1] = SKY[i + 1]; if (a <= a1) return col(c0).lerp(col(c1), (a - a0) / (a1 - a0)); }
  return col(SKY.at(-1)[1]);
}

/* ---------- Scene ---------- */
const stage = $('#stage');
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
stage.appendChild(renderer.domElement);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(40, 1, 1, 6000);
camera.position.set(-300, 400, 500);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 20, 0); controls.enableDamping = true; controls.maxPolarAngle = 1.5;
controls.minDistance = 60; controls.maxDistance = 1800;

const hemi = new THREE.HemisphereLight(0xe3edf4, 0x8a9a86, 1.4); scene.add(hemi);
const sunLight = new THREE.DirectionalLight(0xfff1d6, 2.5);
sunLight.castShadow = true; sunLight.shadow.mapSize.set(4096, 4096);
Object.assign(sunLight.shadow.camera, { left: -620, right: 620, top: 620, bottom: -620, near: 10, far: 3200 });
sunLight.shadow.bias = -0.0005; sunLight.shadow.normalBias = 0.3;
scene.add(sunLight, sunLight.target);

const ground = new THREE.Mesh(new THREE.CircleGeometry(1600, 72), new THREE.MeshLambertMaterial({ color: 0xDCE2DA }));
ground.rotation.x = -Math.PI / 2; ground.position.y = -0.4; ground.receiveShadow = true; scene.add(ground);

// OneMap grey street map around the site (Singapore Land Authority), ~1.2 km each way at zoom 17
{
  const Z = 17, n = 2 ** Z, R = 1250, lat0 = site.lat, lon0 = site.lon, kx = 111320 * Math.cos(lat0 * deg), kz = 110574;
  const tx = lon => (lon + 180) / 360 * n, ty = lat => (1 - Math.log(Math.tan(lat * deg) + 1 / Math.cos(lat * deg)) / Math.PI) / 2 * n;
  const lonOf = x => x / n * 360 - 180, latOf = y => Math.atan(Math.sinh(Math.PI * (1 - 2 * y / n))) / deg;
  const x0 = Math.floor(tx(lon0 - R / kx)), x1 = Math.floor(tx(lon0 + R / kx)), y0 = Math.floor(ty(lat0 + R / kz)), y1 = Math.floor(ty(lat0 - R / kz));
  const loader = new THREE.TextureLoader(); loader.setCrossOrigin('anonymous');
  for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) {
    const wx0 = (lonOf(x) - lon0) * kx, wx1 = (lonOf(x + 1) - lon0) * kx, wz0 = -(latOf(y) - lat0) * kz, wz1 = -(latOf(y + 1) - lat0) * kz;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(wx1 - wx0, wz1 - wz0), new THREE.MeshLambertMaterial());
    m.rotation.x = -Math.PI / 2; m.position.set((wx0 + wx1) / 2, -0.15, (wz0 + wz1) / 2); m.receiveShadow = true; m.visible = false; scene.add(m);
    // shown only once loaded (a failed tile would render black); OneMap throttles, so retry with backoff, else the grey ground shows
    const url = `https://www.onemap.gov.sg/maps/tiles/Grey/${Z}/${x}/${y}.png`;
    const ok = t => { t.colorSpace = THREE.SRGBColorSpace; m.material.map = t; m.material.needsUpdate = true; m.visible = true; };
    const get = k => loader.load(k ? `${url}?r=${k}` : url, ok, undefined, () => k < 3 && setTimeout(() => get(k + 1), (2 ** k) * 2000 + Math.random() * 2000));
    get(0);
  }
}

// site plan on the ground, rotated to true north
if (P.plan) {
  const { pxPerM: PX, upBearing, origin: [OX, OY], image: IMG } = P.plan;
  const planGroup = new THREE.Group(); planGroup.rotation.y = -upBearing * deg; scene.add(planGroup);
  let plan;                                                   // shown only once the image loads: HDB plans aren't in the public repo
  const tex = new THREE.TextureLoader().load(base + IMG.file, () => { plan.visible = true; });
  tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  plan = new THREE.Mesh(new THREE.PlaneGeometry(IMG.w / PX, IMG.h / PX), new THREE.MeshLambertMaterial({ map: tex }));
  plan.visible = false;
  plan.rotation.x = -Math.PI / 2; plan.position.set((IMG.x0 + IMG.w / 2 - OX) / PX, 0, (IMG.y0 + IMG.h / 2 - OY) / PX);
  plan.receiveShadow = true; planGroup.add(plan);
} else {
  // upcoming: no plan yet, mark HDB's site location
  const pin = new THREE.Mesh(new THREE.CylinderGeometry(40, 40, 1.2, 64), new THREE.MeshLambertMaterial({ color: 0xF6C47A, transparent: true, opacity: .75 }));
  pin.position.y = 0.6; pin.receiveShadow = true; scene.add(pin);
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.2, 60, 12), new THREE.MeshLambertMaterial({ color: 0xE8931C }));
  mast.position.y = 30; mast.castShadow = true; scene.add(mast);
}

/* ---------- Blender model ---------- */
let unitMesh = null, vUnit = null;
const gltf = await new GLTFLoader().loadAsync(base + 'model.glb').catch(() => null);
$('#loading').remove();
if (!gltf) throw new Error(`Missing ${base}model.glb, run: node tools/build.js projects/${pid}`);
if (!hasLayout) { const l = makeLabel('Site · layout not released', { bg: '#E8931C', fg: '#2A1A00' }); l.position.set(0, 72, 0); scene.add(l); }
gltf.scene.traverse(o => {
  if (!o.isMesh) return;
  o.castShadow = o.receiveShadow = true;
  if (o.geometry.attributes._unit) {
    unitMesh = o; vUnit = o.geometry.attributes._unit.array;
    o.geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(vUnit.length * 3), 3));
    o.material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8 });
  }
});
scene.add(gltf.scene);

/* ---------- Labels, compass, sun path, selection ---------- */
function makeLabel(text, { size = 34, bg = 'rgba(29,42,46,.86)', fg = '#F4F7F6', h = 14 } = {}) {
  const c = document.createElement('canvas'), x = c.getContext('2d');
  const font = `600 ${size}px "Schibsted Grotesk", system-ui, sans-serif`;
  x.font = font; const w = Math.ceil(x.measureText(text).width) + size, hh = Math.ceil(size * 1.6);
  c.width = w; c.height = hh; x.font = font;
  if (bg) { x.fillStyle = bg; x.beginPath(); x.roundRect(0, 0, w, hh, hh / 2); x.fill(); }
  x.fillStyle = fg; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(text, w / 2, hh / 2 + 1);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthWrite: false }));
  sp.scale.set(w / hh * h, h, 1); return sp;
}
const blockLabels = new THREE.Group(), stackLabels = new THREE.Group(), compass = new THREE.Group();
scene.add(blockLabels, stackLabels, compass);
function addLabels() {
  [blockLabels, stackLabels, compass].forEach(g => { while (g.children.length) { const c = g.children.pop(); c.material.map.dispose(); c.material.dispose(); } });
  for (const blk of new Set(stacks.map(s => s.blk))) {
    const ss = stacks.filter(s => s.blk === blk), top = Math.max(...ss.map(s => s.floors)) * FH;
    const l = makeLabel('Blk ' + blk);
    l.position.set(ss.reduce((a, s) => a + s.x, 0) / ss.length, top + 20, ss.reduce((a, s) => a + s.z, 0) / ss.length);
    blockLabels.add(l);
  }
  for (const st of stacks) {
    const l = makeLabel(pad(st.no), { size: 30, bg: 'rgba(255,255,255,.88)', fg: '#1D2A2E', h: 7 });
    const [nx, nz] = bdir(st.faces[0]); l.position.set(st.x + nx * 4, st.floors * FH + 5, st.z + nz * 4); stackLabels.add(l);
  }
  [['N', 0], ['E', 90], ['S', 180], ['W', 270]].forEach(([t, b]) => {
    const [x, z] = bdir(b), s = makeLabel(t, { size: 40, bg: t === 'N' ? '#E8931C' : 'rgba(29,42,46,.8)', fg: t === 'N' ? '#2A1A00' : '#F4F7F6', h: 22 });
    s.position.set(x * 560, 8, z * 560); compass.add(s);
  });
  stackLabels.visible = $('#labels').checked;
}
const ring = new THREE.Mesh(new THREE.RingGeometry(538, 541, 128), new THREE.MeshBasicMaterial({ color: 0x5B6C70, transparent: true, opacity: .5 }));
ring.rotation.x = -Math.PI / 2; ring.position.y = 0.3; scene.add(ring);
const sunBall = new THREE.Mesh(new THREE.SphereGeometry(14, 24, 16), new THREE.MeshBasicMaterial({ color: 0xFFCF5C })); scene.add(sunBall);
const moonTex = new THREE.CanvasTexture(document.createElement('canvas')); moonTex.colorSpace = THREE.SRGBColorSpace;
const moonBall = new THREE.Sprite(new THREE.SpriteMaterial({ map: moonTex, depthWrite: false })); moonBall.scale.set(34, 34, 1); scene.add(moonBall);
const moonLight = new THREE.DirectionalLight(0xC8D6F0, 0); scene.add(moonLight, moonLight.target);
let moonDrawn = null;
function drawMoon(illum, waxing) {                               // phase disc, redrawn only when it visibly changes
  const key = `${Math.round(illum * 50)}${waxing}`; if (key === moonDrawn) return; moonDrawn = key;
  const c = moonTex.image, x = c.getContext('2d'); c.width = c.height = 128; const r = 56, rx = r * Math.abs(1 - 2 * illum);
  x.fillStyle = '#2E3A3E'; x.beginPath(); x.arc(64, 64, r, 0, Math.PI * 2); x.fill();
  if (illum > 0.01) {
    x.fillStyle = '#F4EFD8'; x.beginPath(); x.arc(64, 64, r, -Math.PI / 2, Math.PI / 2, !waxing);
    x.ellipse(64, 64, rx, r, 0, Math.PI / 2, -Math.PI / 2, illum > 0.5 ? !waxing : waxing); x.fill();
  }
  moonTex.needsUpdate = true;
}
const sgMs = () => Date.UTC(cur.y, cur.m - 1, cur.d) - 8 * 3600000 + cur.min * 60000;
const pathMat = new THREE.LineDashedMaterial({ color: 0xE8931C, dashSize: 12, gapSize: 8, transparent: true, opacity: .85 });
let pathLine = null;
function drawPath() {
  if (pathLine) { scene.remove(pathLine); pathLine.geometry.dispose(); }
  const pts = [];
  for (let h = 5.5; h <= 20.5; h += 1 / 12) { const p = solarPos(site, cur.y, cur.m, cur.d, h); if (p.alt > -2) { const s = sunVec(p.alt, p.az); pts.push(new THREE.Vector3(s[0] * 540, s[1] * 540, s[2] * 540)); } }
  pathLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), pathMat); pathLine.computeLineDistances(); scene.add(pathLine);
}
// selection: dim everything else, a glowing box around the chosen flat, a beam + label above the stack
const SEL = 0x2B7FFF;
const edges = new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1));
const stackOutline = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: SEL, transparent: true, opacity: .55 }));
const unitBox = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: SEL, transparent: true, opacity: .35, depthTest: false }));
const unitEdge = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: SEL, depthTest: false }));
unitBox.renderOrder = unitEdge.renderOrder = 10;
const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 1, 8), new THREE.MeshBasicMaterial({ color: SEL, transparent: true, opacity: .8 }));
let selLabel = null;
const selGroup = new THREE.Group(); selGroup.add(stackOutline, unitBox, unitEdge, beam); selGroup.visible = false; scene.add(selGroup);
let camGoal = null;
function updateOutlines() {
  const st = stacks.find(s => s.no === selStack);
  if (selLabel) { scene.remove(selLabel); selLabel.material.map.dispose(); selLabel = null; }
  if (!st) { selGroup.visible = false; return; }
  selGroup.visible = true;
  const top = st.floors * FH, bot = (st.first - 1) * FH, rot = (90 - st.axis) * deg;
  stackOutline.position.set(st.x, (top + bot) / 2, st.z); stackOutline.rotation.y = rot;
  stackOutline.scale.set(st.hx * 2 + 3, top - bot + 0.6, st.hz * 2 + 3);
  const u = st.units.find(u => u.floor === selFloor) || st.units[0];
  for (const o of [unitBox, unitEdge]) { o.position.set(st.x, u.y, st.z); o.rotation.y = rot; o.scale.set(st.hx * 2 + 4, FH + 0.6, st.hz * 2 + 4); }
  beam.scale.set(1, 18, 1); beam.position.set(st.x, top + 10, st.z);
  selLabel = makeLabel(`#${pad(u.floor)}-${pad(st.no)} · ${P.categories[catOf(P, u.code)].name}`, { bg: '#2B7FFF', fg: '#fff', h: 12 });
  selLabel.position.set(st.x, top + 26, st.z); selLabel.renderOrder = 11; scene.add(selLabel);
  // ease the camera to look at the flat from its window side
  const [nx, nz] = bdir(st.faces[0]), d = Math.max(140, camera.position.distanceTo(controls.target) * 0.6);
  camGoal = { target: new THREE.Vector3(st.x, u.y, st.z), pos: new THREE.Vector3(st.x + nx * d, u.y + d * 0.55, st.z + nz * d) };
}

/* ---------- Amenities: estate facilities (site plan) + nearby (government open data) ---------- */
const ACAT = {
  mrt: ['MRT station', '#C2272D', 'M'], lrt: ['LRT station', '#7D8C8C', 'L'], bus: ['Bus stop', '#2F6DB5', 'B'],
  primary: ['Primary school', '#2E8B57', 'P'], secondary: ['Secondary school', '#3E7D6E', 'S'], preschool: ['Preschool', '#E58E26', 'K'],
  hawker: ['Hawker centre / market', '#B5651D', 'H'], supermarket: ['Supermarket', '#8A3FA0', '$'], clinic: ['Clinic (CHAS)', '#D6336C', '+'],
  polyclinic: ['Polyclinic', '#A61E4D', '+'], park: ['Park', '#3A9D23', 'T'], library: ['Library', '#5C4B8A', 'Li'], cc: ['Community club', '#1F7A8C', 'CC'],
  mall: ['Shopping mall', '#E4572E', 'Ma'],
};
// MRT/LRT line colours by code prefix (LTA)
const LINE = { NS: '#D42E12', EW: '#009645', CG: '#009645', NE: '#9900AA', CC: '#FA9E0D', CE: '#FA9E0D', DT: '#005EC4', TE: '#9D5B25', JS: '#0099AA', JE: '#0099AA', JW: '#0099AA' };
const lineChips = a => (a.lines || '').split(' ').filter(Boolean).map(c => `<b class="line" style="background:${LINE[c.replace(/\d.*/, '')] || '#748477'}">${esc(c)}</b>`).join('');
const dist = d => (d < 1000 ? d + ' m' : (d / 1000).toFixed(1) + ' km') + ` · ≈${walkMin(d)} min`;
const shown = a => a.cat !== 'primary' || a.d <= 2000;          // primaries beyond 2 km are kept only for per-block bands
function pinSprite(text, color, h = 9) {
  const c = document.createElement('canvas'), x = c.getContext('2d'), S = 64;
  c.width = S; c.height = S * 1.35;
  x.fillStyle = color; x.beginPath(); x.arc(S / 2, S / 2, S / 2 - 3, 0, Math.PI * 2); x.fill();
  x.beginPath(); x.moveTo(S * 0.3, S * 0.85); x.lineTo(S / 2, S * 1.32); x.lineTo(S * 0.7, S * 0.85); x.fill();
  x.lineWidth = 4; x.strokeStyle = '#fff'; x.beginPath(); x.arc(S / 2, S / 2, S / 2 - 3, 0, Math.PI * 2); x.stroke();
  x.fillStyle = '#fff'; x.font = `700 ${text.length > 1 ? 24 : 32}px "Schibsted Grotesk", system-ui`; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(text, S / 2, S / 2 + 1);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthTest: false }));
  sp.center.set(0.5, 0); sp.scale.set(h, h * 1.35, 1); sp.renderOrder = 5; return sp;
}
const facGroup = new THREE.Group(), amenGroup = new THREE.Group(); scene.add(facGroup, amenGroup);
const pickables = [];
for (const f of P.facilities || []) {
  const sp = pinSprite(String(f.n), '#1D2A2E', 6); sp.position.set(f.x, 1, f.z); sp.userData = { tip: `${f.n} · ${f.name}` }; facGroup.add(sp); pickables.push(sp);
}
const amenSprites = [];
(P.amenities || []).forEach((a, i) => {
  if (!shown(a)) return;
  const [label, color, glyph] = ACAT[a.cat] || ['Amenity', '#555', '•'];
  const big = a.cat === 'mrt' || a.cat === 'lrt';
  const sp = pinSprite(glyph, color, big ? 22 : 14); sp.position.set(a.x, 1, a.z);
  sp.userData = { tip: `${a.name} · ${label} · ${a.d} m`, idx: i }; amenGroup.add(sp); pickables.push(sp); amenSprites[i] = sp;
  if (big) { const l = makeLabel(a.name + (a.lines ? ' · ' + a.lines : ''), { bg: color, size: 30, h: 9 }); l.position.set(a.x, 62, a.z); amenGroup.add(l); }
});
function renderAmenities() {
  const by = {};
  (P.amenities || []).forEach((a, i) => shown(a) && (by[a.cat] ||= []).push([a, i]));
  const facNames = [...new Map((P.facilities || []).map(f => [f.n, f.name])).entries()].sort((a, b) => a[0] - b[0]);
  $('#amenList').innerHTML =
    (facNames.length ? `<div class="acat"><h4><i style="background:#1D2A2E">#</i>In this estate</h4>${facNames.map(([n, name]) => `<div class="aitem" data-f="${n}"><span>${n} · ${esc(name)}</span></div>`).join('')}</div>` : '') +
    Object.keys(ACAT).filter(k => by[k]).map(k => `<div class="acat"><h4><i style="background:${ACAT[k][1]}">${ACAT[k][2]}</i>${ACAT[k][0]}</h4>${by[k].map(([a, i]) =>
      `<div class="aitem" data-a="${i}"><span>${esc(a.name)}${lineChips(a)}${k === 'primary' ? `<span class="tag1k">${a.d <= 1000 ? '≤1 km' : '1–2 km'}</span>` : ''}</span><span>${dist(a.d)}</span></div>`).join('')}</div>`).join('') ||
    '<p class="note">No amenity data.</p>';
}
let amenFocus = null;
$('#amenList').addEventListener('click', e => {
  const it = e.target.closest('.aitem'); if (!it) return;
  document.querySelectorAll('.aitem.on').forEach(x => x.classList.remove('on')); it.classList.add('on');
  let x, z, s = null;
  if (it.dataset.a != null) { const a = P.amenities[+it.dataset.a]; x = a.x; z = a.z; s = amenSprites[+it.dataset.a]; amenGroup.visible = true; $('#showAmen').checked = true; }
  else { const f = P.facilities.find(f => f.n === +it.dataset.f); x = f.x; z = f.z; s = facGroup.children[P.facilities.indexOf(f)]; facGroup.visible = true; $('#showFac').checked = true; }
  if (amenFocus) amenFocus.scale.multiplyScalar(1 / 1.8);
  amenFocus = s; if (s) s.scale.multiplyScalar(1.8);
  const d = Math.max(220, Math.hypot(x, z) * 1.4);
  camGoal = { target: new THREE.Vector3(x / 2, 0, z / 2), pos: new THREE.Vector3(x / 2 - d * 0.5, d * 0.9, z / 2 + d * 0.7) };
});
$('#showFac').addEventListener('change', e => { facGroup.visible = e.target.checked; });
$('#showAmen').addEventListener('change', e => { amenGroup.visible = e.target.checked; });
renderAmenities();

/* ---------- Resale nearby (HDB resale transactions, data.gov.sg) ---------- */
const RS = P.resale;
const radiusTxt = m => m >= 1000 ? `${m / 1000} km` : `${m} m`;
let rType = RS ? defaultType(RS) : null, rSort = 'date';
const resaleGroup = new THREE.Group(); resaleGroup.visible = false; scene.add(resaleGroup);
const resaleMeshes = [];
for (const b of RS?.blocks || []) {
  const c = b.ctx != null && P.context[b.ctx];
  if (!c) continue;
  const sh = new THREE.Shape(c.p.map(q => new THREE.Vector2(q[0], -q[1])));
  const m = new THREE.Mesh(new THREE.ExtrudeGeometry(sh, { depth: c.h + 0.3, bevelEnabled: false }), new THREE.MeshLambertMaterial({ color: 0xDCEBFA }));
  m.rotation.x = -Math.PI / 2; m.userData.resale = b; m.castShadow = true; resaleGroup.add(m); resaleMeshes.push(m);
}
const titleCase = s => s.toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
const typeLabel = t => titleCase(t).replace('Multi-Generation', 'Multi-generation (3Gen)');
function psmRange() {
  const v = resaleMeshes.map(m => m.userData.resale.types[rType]?.psm).filter(Boolean);   // drawn blocks only
  return v.length ? [Math.min(...v), Math.max(...v)] : [0, 0];
}
function paintResale() {
  if (!RS) return;
  const [lo, hi] = psmRange();
  for (const m of resaleMeshes) {
    const t = m.userData.resale.types[rType];
    m.visible = !!t?.psm;
    if (m.visible) m.material.color.set(psmRamp(t.psm, lo, hi));
  }
  window.__resaleOverlays = resaleMeshes.filter(m => m.visible).length;
}
window.__resaleScreen = () => {                              // test hook: screen point on top of each visible overlay
  const r = renderer.domElement.getBoundingClientRect(), box = new THREE.Box3(), v = new THREE.Vector3();
  return resaleMeshes.filter(m => m.visible).map(m => {
    box.setFromObject(m).getCenter(v); v.y = box.max.y; v.project(camera);
    return { blk: m.userData.resale.blk, x: r.left + (v.x + 1) / 2 * r.width, y: r.top + (1 - v.y) / 2 * r.height };
  }).filter(p => p.x > r.left + 20 && p.x < r.right - 20 && p.y > r.top + 20 && p.y < r.bottom - 20);
};
function renderResaleLegend() {
  const [lo, hi] = psmRange();
  $('#legend').innerHTML = !RS ? '<div>No resale data for this project.</div>' : lo
    ? `<div class="ramp" style="background:linear-gradient(90deg,${psmRamp(lo, lo, hi)},${psmRamp(hi, lo, hi)})"></div>
       <div class="ramp-lbl"><span>$${lo.toLocaleString('en-SG')}/sqm</span><span>$${hi.toLocaleString('en-SG')}/sqm</span></div>
       <div style="margin-top:6px">Median resale price per sqm, ${typeLabel(rType)}, last ${RS.months} months. Grey blocks: fewer than 3 such sales.</div>`
    : `<div>No block within ${radiusTxt(RS.radiusM)} has 3+ ${typeLabel(rType)} resales in the last ${RS.months} months.</div>`;
}
function renderResaleTypes() {
  $('#resaleTypes').innerHTML = Object.keys(RS.summary).map(t => `<button class="chip" data-t="${esc(t)}" aria-pressed="${t === rType}">${esc(typeLabel(t))}</button>`).join('');
}
$('#resaleTypes').addEventListener('click', e => {
  const t = e.target.closest('.chip')?.dataset.t; if (!t) return;
  rType = t; renderResaleTypes(); paintResale(); renderResaleLegend(); renderResalePanel();
});
function btoLine() {
  const codes = Object.keys(P.prices || {}).filter(c => RESALE_TYPE[c] === rType);
  const s = RS.summary[rType];
  if (!codes.length || !s?.median) return '';
  const lo = Math.min(...codes.map(c => P.prices[c].min)), hi = Math.max(...codes.map(c => P.prices[c].max));
  return `<div class="btovs">This BTO ${esc(typeLabel(rType))}: <b>${range(lo, hi)}</b> · Resale nearby median <b>${money(s.median)}</b>${s.leaseLeft ? ` (${s.leaseLeft} yrs left)` : ''}</div>`;
}
function renderResalePanel() {
  if (!RS) { $('#resalePanel').innerHTML = '<p class="unit-meta">No resale data for this project.</p>'; return; }
  const rows = Object.entries(RS.summary).map(([t, s]) => `<tr${t === rType ? ' class="on"' : ''}><td>${esc(typeLabel(t))}</td><td>${s.n}</td>` +
    (s.median ? `<td>${money(s.median)}</td><td>$${s.psm.toLocaleString('en-SG')}</td><td>${s.leaseLeft ?? '—'}</td>` : '<td colspan="3" class="unit-meta">too few sales</td>') + '</tr>').join('');
  const sales = [...RS.sales].sort((a, b) => rSort === 'price' ? b.price - a.price : 0);
  $('#resalePanel').innerHTML = `<h2>Resale within ${radiusTxt(RS.radiusM)} · last ${RS.months} months</h2>
    <table class="rtable"><thead><tr><th>Type</th><th>Sales</th><th>Median</th><th>$/sqm</th><th>Yrs left</th></tr></thead><tbody>${rows}</tbody></table>
    ${btoLine()}
    <div class="lbl">${esc(typeLabel(rType))} · median $/sqm by month</div>${trendSvg(RS.trend[rType]) || '<p class="unit-meta">Not enough monthly sales for a trend.</p>'}
    <div class="tablehead"><div class="lbl">Recent sales</div><select id="rSort" aria-label="Sort sales"><option value="date"${rSort === 'date' ? ' selected' : ''}>Newest</option><option value="price"${rSort === 'price' ? ' selected' : ''}>Highest price</option></select></div>
    <div class="rsales">${sales.map(x => `<div><span>${esc(x.m)} · Blk ${esc(x.blk)} ${esc(titleCase(x.street))} · ${esc(typeLabel(x.type))} · ${esc(x.storey.toLowerCase())} · ${x.sqm} sqm</span><span>${money(x.price)}</span></div>`).join('')}</div>
    <div class="src">HDB resale transactions, data.gov.sg, up to ${esc(RS.asOf)}</div>`;
  $('#rSort').addEventListener('change', e => { rSort = e.target.value; renderResalePanel(); });
}
function openResaleCard(b) {
  if (rtab === 'value') { rtab = 'sun'; applyRTab(); }             // the block card lives on the Sun tab
  const yr = +RS.asOf.slice(0, 4), left = b.lease ? b.lease + 99 - yr : null;
  const recent = b.recent || [];
  $('#resaleCard').hidden = false;
  $('#resaleCard').innerHTML = `<div class="unit"><div class="unit-no" style="font-size:18px">Blk ${esc(b.blk)} ${esc(titleCase(b.street))}</div>
    <div class="unit-meta">${b.lease ? `${b.lease} lease (${left} years left)` : ''}${b.storeys ? ` · ${b.storeys} storeys` : ''}</div>
    <table class="rtable"><thead><tr><th>Type</th><th>Sales</th><th>Median</th><th>Latest</th></tr></thead><tbody>${Object.entries(b.types).map(([t, s]) =>
      `<tr><td>${esc(typeLabel(t))}</td><td>${s.n}</td><td>${s.median ? money(s.median) : '—'}</td><td>${money(s.lastPrice)} (${esc(s.last)})</td></tr>`).join('')}</tbody></table>
    <div class="rsales">${recent.map(x => `<div><span>${esc(x.m)} · ${esc(typeLabel(x.type))} · ${esc(x.storey.toLowerCase())}</span><span>${money(x.price)}</span></div>`).join('')}</div>
    <div class="btns"><button class="btn" id="rClose">Close</button></div></div>`;
  $('#rClose').addEventListener('click', () => { $('#resaleCard').hidden = true; });
}
function hitResale(e) {
  const r = renderer.domElement.getBoundingClientRect();
  mouse.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1); ray.setFromCamera(mouse, camera);
  return ray.intersectObjects(resaleMeshes.filter(m => m.visible), false)[0]?.object.userData.resale || null;
}
/* ---------- Value tab: ML resale estimate (tools/train_value.py -> P.value) ---------- */
let rtab = 'sun';
function applyRTab() {
  const v = rtab === 'value';
  document.querySelectorAll('.rtabs button').forEach(b => b.setAttribute('aria-selected', b.dataset.t === rtab));
  $('#valuePanel').hidden = !v;
  for (const id of ['#unitCard', '#tableHead', '#tableWrap', '#tableNote']) $(id).hidden = v || !hasLayout || mode === 'resale';
  $('#upcomingCard').hidden = v || hasLayout;
  $('#resalePanel').hidden = v || mode !== 'resale';
  if (v) { $('#resaleCard').hidden = true; renderValue(); }
}
$('.rtabs').addEventListener('click', e => { const t = e.target.closest('button')?.dataset.t; if (t) { rtab = t; applyRTab(); } });
function renderValue() {
  const V = P.value, box = $('#valuePanel');
  if (!V) { box.innerHTML = '<p class="unit-meta">No value estimate for this project.</p>'; return; }
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
      <div class="vest">${k(est)}</div><div class="unit-meta">Range ${k(lo)}–${k(hi)} · a flat like this, resold today with ~94 years of lease left</div>
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
  box.innerHTML = `<h2>Estimated resale value</h2>${card || (rows.length ? '<p class="unit-meta">Pick a unit on the model or in the table to see its estimate.</p>' : '')}${table}${foot}`;
}
$('#valuePanel').addEventListener('click', e => { const r = e.target.closest('tr[data-s]'); if (r) select(+r.dataset.s); });
function setResaleMode(on) {
  resaleGroup.visible = on;
  $('#resaleTypes').hidden = !on || !RS;
  $('#resalePanel').hidden = !on;
  if (!on) $('#resaleCard').hidden = true;
  if (hasLayout) for (const id of ['#unitCard', '#tableHead', '#tableWrap', '#tableNote']) $(id).hidden = on;
  if (rtab === 'value') queueMicrotask(applyRTab);
  if (on && RS) {
    renderResaleTypes(); paintResale();
    const xs = [0], zs = [0];                                  // frame the site plus the coloured blocks
    for (const m of resaleMeshes) if (m.visible) { xs.push(m.userData.resale.x); zs.push(m.userData.resale.z); }
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cz = (Math.min(...zs) + Math.max(...zs)) / 2;
    const d = Math.min(1500, Math.max(300, Math.hypot(Math.max(...xs) - Math.min(...xs), Math.max(...zs) - Math.min(...zs)) * 0.9));
    camGoal = { target: new THREE.Vector3(cx, 0, cz), pos: new THREE.Vector3(cx - d * 0.3, d * 0.85, cz + d * 0.55) };
  }
  if (on) renderResalePanel();
}

/* ---------- State ---------- */
const today = sgtNow();                                         // Singapore date/time, whatever the viewer's timezone
const cur = { y: today.y, m: today.m, d: today.d, min: today.min };
let live = true;                                                // follow the actual time in Singapore
function setLive(on) {
  live = on; $('#now').setAttribute('aria-pressed', on);
  if (!on) return;
  const n = sgtNow(), newDay = n.y !== cur.y || n.m !== cur.m || n.d !== cur.d;
  Object.assign(cur, n); Object.assign(today, n); timeIn.value = Math.round(n.min / 5) * 5; setDateInput();
  newDay ? refreshDay() : refreshNow();
}
setInterval(() => live && setLive(true), 30000);
let mode = 'now', selStack = null, selFloor = null, noonH = 13, sunNow = { alt: 0, az: 0, s: [0, 1, 0] };

/* ---------- Painting & UI ---------- */
function unitColor(u) {
  if (mode === 'now') return u.now === 'lit' ? C_LITLO.clone().lerp(C_LITHI, Math.min(1, u.cos * 1.2)) : u.now === 'shade' ? C_SHADE : u.now === 'night' ? C_NIGHT : C_AWAY;
  if (mode === 'pm') return ramp(u.pm / 5);
  if (mode === 'am') return amramp(u.am / 5);
  if (mode === 'type') return col(P.categories[catOf(P, u.code)].col);
  if (mode === 'resale') return C_AWAY;
  return col(FACE[face8(u.st.faces[0])]);
}
function paint() {
  if (!unitMesh) { renderLegend(); return; }
  const DIM = col('#D6DAD7');
  const cs = units.map(u => selStack == null || u.st.no === selStack ? unitColor(u) : unitColor(u).lerp(DIM, 0.8)), arr = unitMesh.geometry.attributes.color;
  if (selStack != null) { const u = stacks.find(s => s.no === selStack)?.units.find(u => u.floor === selFloor); if (u) cs[u.id] = col(SEL); }
  for (let i = 0; i < vUnit.length; i++) { const c = cs[vUnit[i]]; arr.array[i * 3] = c.r; arr.array[i * 3 + 1] = c.g; arr.array[i * 3 + 2] = c.b; }
  arr.needsUpdate = true; renderLegend();
}
const swatch = (c, t, extra = '') => `<span class="sw"><i style="background:${c};${extra}"></i>${t}</span>`;
function renderLegend() {
  if (mode === 'resale') { renderResaleLegend(); return; }
  if (!hasLayout) { $('#legend').innerHTML = `<div class="swatches">${swatch('#F6C47A', 'HDB site location')}${swatch('#9EA8A3', 'Existing HDB block')}</div>`; return; }
  const grad = cs => `<div class="ramp" style="background:linear-gradient(90deg,${cs.join(',')})"></div><div class="ramp-lbl"><span>0 h</span><span>2.5 h</span><span>5 h+</span></div>`;
  const note = t => `<div style="margin-top:6px">${t}</div>`;
  $('#legend').innerHTML =
    mode === 'now' ? `<div class="swatches">${swatch('#F07F1E', 'Direct sun')}${swatch('#7E95A3', 'Shaded by a building')}${swatch('#9EA8A3', 'Neighbouring HDB block')}${swatch('#E9ECE8', 'Sun behind windows', 'border:1px solid #bbb')}</div>${note('Deeper orange means the sun hits the windows more squarely.')}`
    : mode === 'pm' ? grad(RAMP_PM) + note('Hours of direct sun on the windows after solar noon on this date.')
    : mode === 'am' ? grad(RAMP_AM) + note('Hours of direct sun on the windows before solar noon.')
    : mode === 'type' ? `<div class="typelist">${Object.entries(P.categories).map(([k, v]) => {
        const codes = P.stacks.map(s => s.type).filter(c => catOf(P, c) === k); if (!codes.length) return '';
        const sz = [...new Set(codes.map(c => sizeOf(P, c)[1]))].sort((a, b) => a - b).join(' / ');
        return `<span class="sw"><i style="background:${v.col};border:1px solid rgba(0,0,0,.12)"></i>${v.name}<b>${sz} sq ft</b></span>`; }).join('')}</div>`
    : `<div class="swatches">${Object.entries(FACE).map(([k, v]) => swatch(v, k)).join('')}</div>${note("Direction of each unit's main windows.")}`;
}
const fmtTime = m => { let h = Math.floor(m / 60), mm = Math.round(m % 60); if (mm === 60) { h++; mm = 0; } return `${((h + 11) % 12) + 1}:${pad(mm)} ${h >= 12 ? 'pm' : 'am'}`; };
const hrs = v => v.toFixed(1) + ' h';
function updateSunUI() {
  const p = sunNow; $('#clock').textContent = fmtTime(cur.min);
  $('#sunline').textContent = (p.alt > 0 ? `Sun ${Math.round(p.alt)}° high, from the ${card16(p.az)} (${Math.round(p.az)}°). ` : 'Sun below the horizon. ') + `Solar noon ${fmtTime(noonH * 60)}.`;
  const s = p.s; sunLight.position.set(s[0] * 1400, Math.max(s[1], 0.02) * 1400, s[2] * 1400);
  const up = Math.max(0, Math.sin(p.alt * deg));
  sunLight.intensity = p.alt > 0 ? 0.9 + 2 * Math.sqrt(up) : 0; hemi.intensity = p.alt > 0 ? 1.1 + 0.6 * up : 0.7;
  sunBall.position.set(s[0] * 540, s[1] * 540, s[2] * 540); sunBall.visible = p.alt > -3;
  scene.background = skyColor(p.alt);
  const mo = moonAltAz(site, sgMs()), ph = moonPhase(sgMs()), mv = sunVec(mo.alt, mo.az);
  drawMoon(ph.illum, ph.waxing); moonBall.position.set(mv[0] * 520, mv[1] * 520, mv[2] * 520); moonBall.visible = mo.alt > -3;
  moonLight.position.set(mv[0] * 1400, Math.max(mv[1], 0.02) * 1400, mv[2] * 1400);
  moonLight.intensity = p.alt < 0 && mo.alt > 0 ? 0.35 * ph.illum : 0;
  $('#clock').classList.toggle('night', p.alt < -6);
  window.__sky = { sunAlt: p.alt, moonAlt: mo.alt, moonAz: mo.az, moonVisible: moonBall.visible, illum: ph.illum };   // test hook
}
function renderSky() {                                           // sun & moon outlook for the chosen date
  const s = sunTimes(site, cur.y, cur.m, cur.d), mt = moonTimes(site, cur.y, cur.m, cur.d), ph = moonPhase(sgMs());
  const t = v => v == null ? '—' : fmtTime(v), len = s.rise != null && s.set != null ? s.set - s.rise : null;
  $('#skycard').innerHTML = `<div class="sky-row"><i class="sky-ic sun" title="Sun"></i><span>Rise <b>${t(s.rise)}</b></span><span>Set <b>${t(s.set)}</b></span>
    <span class="unit-meta">${len != null ? `${Math.floor(len / 60)} h ${pad(Math.round(len % 60))} m of daylight` : ''}</span></div>
    <div class="sky-row">${phaseSvg(ph.illum, ph.waxing)}<span>Rise <b>${t(mt.rise)}</b></span><span>Set <b>${t(mt.set)}</b></span>
    <span class="unit-meta">${ph.name}, ${Math.round(ph.illum * 100)}% lit</span></div>`;
}
function refreshNow() { sunNow = computeNow(L, site, cur.y, cur.m, cur.d, cur.min); updateSunUI(); if (mode === 'now') paint(); renderUnitCard(); }
function refreshDay() { noonH = computeDay(L, site, cur.y, cur.m, cur.d); drawPath(); renderSky(); sunNow = computeNow(L, site, cur.y, cur.m, cur.d, cur.min); updateSunUI(); paint(); renderUnitCard(); renderTable(); }

function renderTable() {
  const by = $('#sort').value, list = [...stacks];
  if (by === 'pm') list.sort((a, b) => a.pm - b.pm || a.no - b.no); else if (by === 'am') list.sort((a, b) => b.am - a.am || a.no - b.no); else list.sort((a, b) => a.no - b.no);
  $('#tableTitle').textContent = by === 'pm' ? 'Stacks by afternoon sun' : by === 'am' ? 'Stacks by morning sun' : 'All stacks';
  $('#tbody').innerHTML = list.map(st => { const c = P.categories[catOf(P, st.type)]; return `<tr data-s="${st.no}" class="${st.no === selStack ? 'on' : ''}" tabindex="0">
    <td><b>${pad(st.no)}</b></td><td>${st.blk}</td><td title="${c.name}, ${sizeOf(P, st.type)[1]} sq ft"><i class="tsw" style="background:${c.col}"></i>${st.type}</td><td>${st.faces.map(card16).join(' + ')}</td>
    <td>${st.am.toFixed(1)}<span class="bar am" style="width:${Math.min(20, st.am * 4)}px"></span></td>
    <td>${st.pm.toFixed(1)}<span class="bar" style="width:${Math.min(20, st.pm * 4)}px"></span></td>
    <td class="price">${priceOf(st.type) ? range(priceOf(st.type).min, priceOf(st.type).max) : '—'}</td></tr>`; }).join('');
}
const priceOf = code => (P.prices || {})[code];
function schoolLine(st) {                                      // MOE P1 priority bands from this stack's block
  if (!(P.amenities || []).some(a => a.cat === 'primary')) return '';
  const { within1, within2 } = schoolBands(st, P.amenities);
  const names = l => l.slice(0, 3).map(a => esc(a.name)).join(', ') + (l.length > 3 ? ` +${l.length - 3} more` : '');
  return `<div class="unit-meta schools"><b>Primary schools from Blk ${esc(st.blk)}</b> (P1 distance, approx.):
    ≤1 km: ${within1.length ? names(within1) : 'none'} · 1–2 km: ${within2.length ? names(within2) : 'none'}
    · <a href="https://www.moe.gov.sg/schoolfinder" target="_blank" rel="noopener">check MOE SchoolFinder ↗</a></div>`;
}
function priceBlock(code) {
  const p = priceOf(code);
  if (!p) return code === 'RENT' ? '<div class="pricebox unit-meta">Rental flat — not for sale.</div>' : '';
  const r = (P.resaleComparables || {})[code];
  return `<div class="pricebox"><div class="pr">${range(p.min, p.max)} <span>HDB launch range</span></div>
    ${p.afterGrantsFrom ? `<div class="unit-meta" title="Lowest launch price minus the illustrative Enhanced CPF Housing Grant in HDB's launch materials; your grants depend on income and eligibility">From ${money(p.afterGrantsFrom)} after grants (illustrative, max. EHG)</div>` : ''}
    <div class="unit-meta">${p.sqm} sqm incl. aircon ledge${p.internalSqm ? ` (${p.internalSqm} sqm internal)` : ''} · ${p.units.toLocaleString('en-SG')} units · ~${p.waitingMonths}${p.waitingMonthsMax ? `–${p.waitingMonthsMax}` : ''} months wait</div>
    ${r ? `<div class="unit-meta">Resale nearby: ${range(r.min, r.max)}</div>` : ''}
    ${P.resale?.summary?.[RESALE_TYPE[code]]?.median ? `<div class="unit-meta">Resale nearby (same type, ${radiusTxt(P.resale.radiusM)}): median ${money(P.resale.summary[RESALE_TYPE[code]].median)}</div>` : ''}</div>`;
}
function layoutThumb(no) {
  const l = (P.layouts || {})[String(no)];
  if (!l) return P.brochure
    ? `<a class="layout-src big" href="${esc(P.brochure)}" target="_blank" rel="noopener">Floor plan not extracted for this stack · open HDB brochure ↗</a>`
    : '<div class="layout-thumb none">Floor plan not available</div>';
  // HDB's crops aren't in the public repo: where the image is missing, the link to HDB's brochure page becomes the main button
  const src = P.brochure ? `<a class="layout-src" href="${esc(P.brochure)}#page=${l.page}" target="_blank" rel="noopener">View floor plan in HDB brochure, p. ${l.page} ↗</a>` : '';
  return `<button class="layout-thumb" data-a="layout" aria-label="Open floor plan"><img src="${base + l.typical}" alt="Floor plan, stack ${pad(no)}" onerror="const b=this.parentElement;b.nextElementSibling?.classList.add('big');b.remove()"><span>Floor plan · tap to enlarge</span></button>${src}`;
}
const layoutDlg = $('#layoutDlg');
let viewer = null, openSeq = 0;                                  // the live 3D viewer; openSeq drops stale loads
const closeViewer = () => { openSeq++; viewer?.dispose(); viewer = null; };
function setView(mode, no) {                                    // '3d' | '2d'
  const is3d = mode === '3d';
  $('#view3d').setAttribute('aria-pressed', is3d); $('#view2d').setAttribute('aria-pressed', !is3d);
  $('#plan3dHolder').hidden = !is3d; $('#plan3dReset').hidden = !is3d;
  $('#layoutImg').hidden = is3d; $('#layoutToggle').hidden = is3d || !P.layouts[String(no)].lowest;
  if (!is3d) { closeViewer(); return; }
  if (viewer) return;
  const seq = ++openSeq, holder = $('#plan3dHolder');
  holder.innerHTML = '<p class="p3-wait">Building 3D view…</p>';
  const stale = () => seq !== openSeq || !layoutDlg.open;
  openPlan3d(holder, `${base}plans3d/${no}`, { isStale: stale }).then(v => {
    if (stale()) v.dispose(); else viewer = v;
  }).catch(() => { if (!stale()) { $('#layoutTabs').hidden = true; setView('2d', no); } });
}
$('#view3d').addEventListener('click', e => setView('3d', e.target.dataset.no));
$('#view2d').addEventListener('click', e => setView('2d', e.target.dataset.no));
$('#plan3dReset').addEventListener('click', () => viewer?.reset());
layoutDlg.addEventListener('close', closeViewer);
function openLayout(no, which = 'typical') {
  const l = P.layouts[String(no)];
  const has3d = which === 'typical' && (P.plans3d || []).includes(String(no));
  $('#layoutTabs').hidden = !has3d; $('#view3d').dataset.no = $('#view2d').dataset.no = no;
  if (!layoutDlg.open || $('#view3d').dataset.shown !== String(no)) closeViewer();
  const img = $('#layoutImg');                                 // hide until the new plan loads: no flash of the previous stack's plan
  const url = new URL(base + l[which], location.href).href;
  if (img.src !== url) { img.style.visibility = 'hidden'; img.onload = () => { img.style.visibility = ''; }; img.src = url; }
  $('#layoutTitle').textContent = `Stack ${pad(no)} · ${which === 'lowest' ? 'lowest storey' : 'typical storey'}`;
  $('#layoutToggle').hidden = !l.lowest;
  $('#layoutToggle').textContent = which === 'lowest' ? 'Show typical storey' : 'Show lowest storey';
  $('#layoutToggle').dataset.no = no; $('#layoutToggle').dataset.next = which === 'lowest' ? 'typical' : 'lowest';
  if (!layoutDlg.open) layoutDlg.showModal();
  $('#view3d').dataset.shown = String(no);
  setView(has3d ? '3d' : '2d', no);
}
$('#layoutToggle').addEventListener('click', e => openLayout(e.target.dataset.no, e.target.dataset.next));
$('#layoutClose').addEventListener('click', () => layoutDlg.close());
layoutDlg.addEventListener('click', e => { if (e.target === layoutDlg) layoutDlg.close(); });
const verdict = pm => pm < 1 ? 'Little afternoon sun on these windows.' : pm < 3 ? 'Some afternoon sun on these windows.' : 'Strong afternoon sun on these windows.';
function renderUnitCard() {
  const box = $('#unitCard'), st = stacks.find(s => s.no === selStack);
  if (!st) { box.innerHTML = `<p class="unit-meta" style="margin:0 0 14px">Tap any unit in the model, or a row below, to see its sun exposure.</p>`; return; }
  const u = st.units.find(u => u.floor === selFloor) || st.units[0], c = P.categories[catOf(P, u.code)], [sqm, sqft] = sizeOf(P, u.code);
  const dateStr = new Date(cur.y, cur.m - 1, cur.d).toLocaleDateString('en-SG', { day: 'numeric', month: 'short', year: 'numeric' }), t = fmtTime(cur.min);
  const nowTxt = u.now === 'lit' ? `At ${t} the windows are in direct sun.` : u.now === 'shade' ? `At ${t} the windows face the sun but are shaded by ${u.by === 'hdb' ? 'a neighbouring HDB block' : 'Block ' + u.by}.` : u.now === 'night' ? `At ${t} the sun is down.` : `At ${t} the sun is behind these windows.`;
  const dirs = st.faces.map(b => `${LONG[card16(b)]} (${b}°)`);
  box.innerHTML = `<div class="unit">
    <div class="unit-no">#${pad(u.floor)}-${pad(st.no)}</div>
    <div class="utype"><i style="background:${c.col}"></i><span><b>${u.code}</b> · ${c.name} · ${sqm} sqm / ${sqft.toLocaleString('en-SG')} sq ft</span></div>
    <div class="unit-meta">Block ${st.blk}${st.collection ? `, ${st.collection} Collection` : ''}, floors ${pad(st.first)} to ${st.floors}. ${st.faces.length > 1 ? 'Corner unit, windows face ' + dirs.join(' and ') : 'Windows face ' + dirs[0]}.</div>
    <div class="stats">
      <div class="stat"><b>${hrs(u.am)}</b><span>Morning sun</span></div>
      <div class="stat"><b>${hrs(u.pm)}</b><span>Afternoon sun</span></div>
      <div class="stat"><b>${hrs(u.p3)}</b><span>After 3 pm</span></div>
    </div>
    ${priceBlock(st.type)}
    ${schoolLine(st)}
    ${st.type === 'RENT' ? '' : layoutThumb(st.no)}
    <div class="verdict">${verdict(u.pm)} <span class="unit-meta">(${dateStr})</span></div>
    <div class="now">${nowTxt}</div>
    <div class="btns">
      <button class="btn" data-a="up" ${u.floor >= st.floors ? 'disabled' : ''}>Floor up</button>
      <button class="btn" data-a="down" ${u.floor <= st.first ? 'disabled' : ''}>Floor down</button>
      <button class="btn" data-a="clear">Clear selection</button>
    </div></div>`;
}
function select(no, floor) {
  selStack = no; const st = stacks.find(s => s.no === no);
  if (st && floor == null) floor = st.units[Math.floor(st.units.length / 2)].floor;
  selFloor = floor; updateOutlines(); paint(); renderUnitCard(); renderTable();
  if (rtab === 'value') renderValue();                            // not in renderUnitCard: that runs every frame while playing
  document.querySelector(`#tbody tr[data-s="${no}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}
$('#unitCard').addEventListener('click', e => {
  const a = e.target.closest('button')?.dataset.a, st = stacks.find(s => s.no === selStack); if (!a || !st) return;
  if (a === 'up' && selFloor < st.floors) select(selStack, selFloor + 1);
  else if (a === 'down' && selFloor > st.first) select(selStack, selFloor - 1);
  else if (a === 'layout') openLayout(st.no);
  else if (a === 'clear') { selStack = selFloor = null; camGoal = null; updateOutlines(); paint(); renderUnitCard(); renderTable(); if (rtab === 'value') renderValue(); }
});
$('#tbody').addEventListener('click', e => { const r = e.target.closest('tr'); if (r) select(+r.dataset.s); });
$('#tbody').addEventListener('keydown', e => { if (e.key === 'Enter') { const r = e.target.closest('tr'); if (r) select(+r.dataset.s); } });
$('#sort').addEventListener('change', renderTable);
$('#labels').addEventListener('change', e => { stackLabels.visible = e.target.checked; });

const dateIn = $('#date');
function setDateInput() {
  dateIn.value = `${cur.y}-${pad(cur.m)}-${pad(cur.d)}`;
  document.querySelectorAll('#presets .chip').forEach(c => {
    const d = c.dataset.d;
    c.setAttribute('aria-pressed', d === 'today' ? (cur.y === today.y && cur.m === today.m && cur.d === today.d) : `${pad(cur.m)}-${pad(cur.d)}` === d);
  });
}
dateIn.addEventListener('change', () => { const v = dateIn.value.split('-').map(Number); if (v.length === 3 && v[0]) { setLive(false); [cur.y, cur.m, cur.d] = v; setDateInput(); refreshDay(); } });
$('#presets').addEventListener('click', e => {
  const d = e.target.closest('.chip')?.dataset.d; if (!d) return;
  setLive(false);
  if (d === 'today') Object.assign(cur, { y: today.y, m: today.m, d: today.d }); else [cur.m, cur.d] = d.split('-').map(Number);
  setDateInput(); refreshDay();
});
const timeIn = $('#time');
timeIn.addEventListener('input', () => { setLive(false); cur.min = +timeIn.value; refreshNow(); });
$('#now').addEventListener('click', () => setLive(true));
$('#modes').addEventListener('click', e => {
  const b = e.target.closest('.mode'); if (!b) return; mode = b.dataset.m;
  document.querySelectorAll('.mode').forEach(x => x.setAttribute('aria-pressed', x === b)); setResaleMode(mode === 'resale'); paint();
});
let playing = false, lastT = 0;
$('#play').addEventListener('click', () => { playing = !playing; if (playing) setLive(false); $('#play').textContent = playing ? '❚❚' : '▶'; $('#play').setAttribute('aria-label', playing ? 'Pause' : 'Play the day'); lastT = performance.now(); });

/* ---------- Picking ---------- */
const ray = new THREE.Raycaster(), mouse = new THREE.Vector2(), tip = $('#tip'); let downAt = null;
function hit(e) {
  const r = renderer.domElement.getBoundingClientRect();
  mouse.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1); ray.setFromCamera(mouse, camera);
  const h = ray.intersectObject(scene, true).find(h => h.object.isMesh && h.object.name !== 'Detail'); // thin slabs/fins shouldn't swallow clicks
  return h && h.object === unitMesh ? units[vUnit[h.face.a]] : null;
}
renderer.domElement.addEventListener('pointerdown', e => { downAt = [e.clientX, e.clientY]; camGoal = null; });
renderer.domElement.addEventListener('pointerup', e => {
  if (!downAt) return; const m = Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]); downAt = null;
  if (m > 5) return;
  if (mode === 'resale') { const b = hitResale(e); if (b) openResaleCard(b); return; }
  const u = hit(e); if (u) select(u.st.no, u.floor);
});
let hq = false, lastMove = null;
renderer.domElement.addEventListener('pointermove', e => {
  if (e.pointerType !== 'mouse') return; lastMove = e; if (hq) return; hq = true;
  requestAnimationFrame(() => {
    hq = false; const u = mode !== 'resale' && hit(lastMove), r = stage.getBoundingClientRect();
    if (u) {
      tip.style.display = 'block'; tip.style.left = (lastMove.clientX - r.left) + 'px'; tip.style.top = (lastMove.clientY - r.top) + 'px';
      tip.textContent = `#${pad(u.floor)}-${pad(u.st.no)}  ${u.code} ${sizeOf(P, u.code)[1]} sq ft  Blk ${u.st.blk}  faces ${u.st.faces.map(card16).join('+')}  PM ${u.pm.toFixed(1)} h`;
      renderer.domElement.style.cursor = 'pointer';
    } else {
      ray.setFromCamera(mouse, camera);
      const ph = ray.intersectObjects(pickables.filter(o => o.parent.visible), false)[0];
      if (ph) { tip.style.display = 'block'; tip.style.left = (lastMove.clientX - r.left) + 'px'; tip.style.top = (lastMove.clientY - r.top) + 'px'; tip.textContent = ph.object.userData.tip; renderer.domElement.style.cursor = 'default'; }
      else { tip.style.display = 'none'; renderer.domElement.style.cursor = ''; }
    }
  });
});
renderer.domElement.addEventListener('pointerleave', () => { tip.style.display = 'none'; });

function resize() { const w = stage.clientWidth, h = stage.clientHeight; renderer.setSize(w, h, false); camera.aspect = w / Math.max(1, h); camera.updateProjectionMatrix(); }
new ResizeObserver(resize).observe(stage); resize();
function loop(now) {
  if (playing) { const dt = (now - lastT) / 1000; lastT = now; cur.min += dt * 30; if (cur.min > 1435) cur.min = 0; timeIn.value = Math.round(cur.min / 5) * 5; refreshNow(); }
  if (camGoal) {
    controls.target.lerp(camGoal.target, 0.08); camera.position.lerp(camGoal.pos, 0.08);
    if (camera.position.distanceTo(camGoal.pos) < 1) camGoal = null;
  }
  if (selGroup.visible) unitBox.material.opacity = 0.25 + 0.2 * Math.sin(now / 250);
  controls.update(); renderer.render(scene, camera); requestAnimationFrame(loop);
}
timeIn.value = Math.round(cur.min / 5) * 5; setDateInput(); refreshDay(); addLabels();
document.fonts?.ready.then(addLabels);
requestAnimationFrame(t => { lastT = t; loop(t); });
