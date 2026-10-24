import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { buildLayout, bdir, catOf, sizeOf, deg } from './project.js';
import { solarPos, sunVec, computeDay, computeNow, sunTimes } from './sun.js';
import { moonAltAz, moonTimes, moonPhase, sgtNow, phaseSvg } from './moon.js';
import { esc, pad, fmtTime } from './format.js';
import { defaultType, psmRamp, resaleLegendHtml, resaleTypesHtml, resalePanelHtml, resaleCardHtml } from './resale.js';
import { ACAT, shown, amenitiesHtml } from './nearby.js';
import { valueHtml } from './value.js';
import { commuteHtml } from './commute.js';
import { API, fetchArrivals, liveLine } from './live.js';
import { BADGE, pickerHtml } from './picker.js';
import { kindColour } from './surround.js';
import { card16, face8, RAMP_PM, RAMP_AM, FACE, unitCardHtml, stackTable, legendHtml } from './unit.js';
import { col, mkRamp, skyColor, makeLabel, pinSprite, addMapTiles, addSitePlan, buildSurround, buildHostRings, makeMoon } from './scene.js';
import { openPlan3d } from './plan3d.js';

const $ = s => document.querySelector(s);
const INDEX = await fetch('../projects/index.json', { cache: 'no-cache' }).then(r => r.json());
const asked = new URLSearchParams(location.search).get('p');
// no project in the URL: open the newest launched project with a model, and show the picker
const pid = INDEX.some(p => p.id === asked) ? asked : (INDEX.find(p => p.status === 'launched' && p.hasLayout) || INDEX[0]).id;
const base = `../projects/${encodeURIComponent(pid)}/`;
const P = await fetch(base + 'project.json', { cache: 'no-cache' }).then(r => { if (!r.ok) throw new Error(`No project "${pid}"`); return r.json(); });
const L = buildLayout(P), { stacks, units, FH } = L, site = P.site;
const hasLayout = stacks.length > 0;

/* ---------- Which project is this: header + picker ---------- */
document.title = `${P.name} · ${BADGE[P.status](P)} · Sun study`;
$('#badge').textContent = BADGE[P.status](P); $('#badge').className = 'badge ' + P.status;
$('#projName').textContent = P.name;
$('#projMeta').textContent = [P.town, P.classification && `${P.classification}`, P.units && `${P.units.toLocaleString('en-SG')} units`].filter(Boolean).join(' · ');
$('#name').textContent = P.name; $('#tagline').textContent = P.tagline || ''; $('#notes').textContent = P.notes || '';

const picker = $('#picker');
function renderPicker(q = '') { $('#pickList').innerHTML = pickerHtml(INDEX, pid, q); }
$('#change').addEventListener('click', () => { renderPicker($('#pickSearch').value); picker.showModal(); $('#pickSearch').focus(); });
$('#pickClose').addEventListener('click', () => picker.close());
picker.addEventListener('click', e => { if (e.target === picker) picker.close(); });
$('#pickSearch').addEventListener('input', e => renderPicker(e.target.value));
if (!asked) { renderPicker(); picker.showModal(); }

// "How it works": the heliodon figure, fetched and started only when opened; fresh DOM each time
const howDlg = $('#howDlg'); let howHtml = null, stopHow = null;
$('#how').addEventListener('click', async () => {
  howDlg.showModal();
  try {
    howHtml ??= await fetch('heliodon.html').then(r => { if (!r.ok) throw new Error(r.status); return r.text(); });
    const { mount } = await import('./heliodon.js');
    if (!howDlg.open) return;
    $('#howBody').innerHTML = howHtml; stopHow = mount($('#howBody .helio'));
  } catch { $('#howBody').innerHTML = '<p class="unit-meta">Could not load the figure. Check your connection and try again.</p>'; }
});
$('#howClose').addEventListener('click', () => howDlg.close());
howDlg.addEventListener('click', e => { if (e.target === howDlg) howDlg.close(); });
howDlg.addEventListener('close', () => { stopHow?.(); stopHow = null; $('#howBody').replaceChildren(); });

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
const ramp = mkRamp(RAMP_PM), amramp = mkRamp(RAMP_AM);
const C_AWAY = col('#E9ECE8'), C_SHADE = col('#7E95A3'), C_NIGHT = col('#8B95A3'), C_LITLO = col('#FFE39A'), C_LITHI = col('#F07F1E');

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

addMapTiles(scene, site);
addSitePlan(scene, P, base, renderer);

/* ---------- Blender model ---------- */
let unitMesh = null, vUnit = null, model = null;
if (!hasLayout) { const l = makeLabel('Site · layout not released', { bg: '#E8931C', fg: '#2A1A00' }); l.position.set(0, 72, 0); scene.add(l); }
// not awaited: the map, neighbours and surroundings draw while the model (~1 MB) downloads, then units are painted
new GLTFLoader().loadAsync(base + 'model.glb').then(gltf => {
  gltf.scene.traverse(o => {
    if (!o.isMesh) return;
    o.castShadow = o.receiveShadow = true;
    if (o.geometry.attributes._unit) {
      unitMesh = o; vUnit = o.geometry.attributes._unit.array;
      o.geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(vUnit.length * 3), 3));
      o.material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8 });
    }
  });
  model = gltf.scene; scene.add(model); $('#loading').remove(); paint();
}).catch(() => { $('#loading').textContent = `Missing ${base}model.glb, run: node tools/build.js projects/${pid}`; });

/* ---------- Labels, compass, sun path, selection ---------- */
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
const moon = makeMoon(), moonBall = moon.sprite; scene.add(moonBall);
const moonLight = new THREE.DirectionalLight(0xC8D6F0, 0); scene.add(moonLight, moonLight.target);
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
function renderAmenities() { $('#amenList').innerHTML = amenitiesHtml(P); }
let amenFocus = null;
function frame(x, z) {                                           // ease the camera to show the site and the point (x, z)
  const d = Math.max(220, Math.hypot(x, z) * 1.4);
  camGoal = { target: new THREE.Vector3(x / 2, 0, z / 2), pos: new THREE.Vector3(x / 2 - d * 0.5, d * 0.9, z / 2 + d * 0.7) };
}
$('#amenList').addEventListener('click', e => {
  const it = e.target.closest('.aitem'); if (!it) return;
  document.querySelectorAll('.aitem.on').forEach(x => x.classList.remove('on')); it.classList.add('on');
  let x, z, s = null;
  if (it.dataset.a != null) { const a = P.amenities[+it.dataset.a]; x = a.x; z = a.z; s = amenSprites[+it.dataset.a]; amenGroup.visible = true; $('#showAmen').checked = true; }
  else { const f = P.facilities.find(f => f.n === +it.dataset.f); x = f.x; z = f.z; s = facGroup.children[P.facilities.indexOf(f)]; facGroup.visible = true; $('#showFac').checked = true; }
  if (amenFocus) amenFocus.scale.multiplyScalar(1 / 1.8);
  amenFocus = s; if (s) s.scale.multiplyScalar(1.8);
  frame(x, z);
});
/* ---------- Commute: bus stops, services, MRT exits (projects/<id>/transit.json + rail.json, loaded on first open) ---------- */
let T, R, pick = {}, transitLoad = null, focus = null;           // T: undefined loading, object, or false on failure
const transitGroup = new THREE.Group(); transitGroup.visible = false; scene.add(transitGroup);
let exitObjs = [], exitKey, ribbon = null, ribbonKey;
const segGeo = new THREE.BoxGeometry(1, 0.4, 1), segMat = new THREE.MeshBasicMaterial({ color: 0x2F6DB5, transparent: true, opacity: .85 });
const arrowGeo = new THREE.ConeGeometry(2.6, 7, 3).rotateZ(-Math.PI / 2), arrowMat = new THREE.MeshBasicMaterial({ color: 0xffffff });   // points +x
function shownBlk() {                                            // same rule as commuteHtml: selected stack's block, else near
  const C = P.commute, st = stacks.find(s => s.no === selStack);
  return C && (st && C.hubs[st.blk] ? st.blk : C.near);
}
function loadTransit() {
  transitLoad ??= Promise.all([base + 'transit.json', 'rail.json'].map(u => fetch(u).then(r => { if (!r.ok) throw new Error(u); return r.json(); })))
    .then(([t, r]) => { T = t; R = r; }, () => { T = false; })
    .then(() => { updateTransit3d(); if (rtab === 'commute') renderCommute(); });
}
function updateTransit3d() {
  transitGroup.visible = rtab === 'commute';
  if (!T) return;
  const blk = shownBlk();
  if (blk !== exitKey) {                                         // exit labels carry walk minutes for the shown block
    exitKey = blk;
    for (const o of exitObjs) { transitGroup.remove(o); o.material.map.dispose(); o.material.dispose(); const i = pickables.indexOf(o); if (i >= 0) pickables.splice(i, 1); }
    exitObjs = [];
    for (const st of T.stations) st.exits.forEach((e, i) => {
      const m = e.walk?.[blk], t = `Exit ${e.exit}${m != null ? ` · ${m}′` : ''}`;
      const pin = pinSprite(e.exit, '#D42E12', 12); pin.position.set(e.x, 1, e.z);
      pin.userData = { tip: `${st.name} · ${t}`, station: st.name }; pickables.push(pin);
      // exits of one station sit metres apart: stack their labels so they don't overprint, above pins and roofs
      const l = makeLabel(t, { bg: '#D42E12', size: 28, h: 10 }); l.position.set(e.x, 14 + i * 11, e.z);   // under the MRT name label at 62
      l.material.depthTest = false; l.renderOrder = 6;
      exitObjs.push(pin, l); transitGroup.add(pin, l);
    });
  }
  if (pick.svc !== ribbonKey) {                                  // blue ribbon of the selected service, clipped to 1.5 km
    ribbonKey = pick.svc;
    if (ribbon) transitGroup.remove(ribbon);
    ribbon = new THREE.Group(); transitGroup.add(ribbon);
    const p = T.services[pick.svc]?.path || [];
    let run = 0, next = 75;                                      // white arrow tiles every 150 m along the shown ribbon: travel direction
    for (let i = 1; i < p.length; i++) {
      // clip the segment to the 1.5 km circle: |a + t(b - a)| <= 1500 for t in [t0, t1]
      const [px, pz] = p[i - 1], dx = p[i][0] - px, dz = p[i][1] - pz;
      const A = dx * dx + dz * dz, B = px * dx + pz * dz, D = B * B - A * (px * px + pz * pz - 1500 ** 2);
      if (!A || D <= 0) continue;
      const t0 = Math.max(0, (-B - Math.sqrt(D)) / A), t1 = Math.min(1, (-B + Math.sqrt(D)) / A);
      if (t0 >= t1) continue;
      const ax = px + t0 * dx, az = pz + t0 * dz, bx = px + t1 * dx, bz = pz + t1 * dz;
      const s = new THREE.Mesh(segGeo, segMat); s.position.set((ax + bx) / 2, 2, (az + bz) / 2);
      const len = Math.hypot(bx - ax, bz - az), rot = Math.atan2(-(bz - az), bx - ax);
      s.rotation.y = rot; s.scale.set(len + 6, 1, 6); ribbon.add(s);
      for (; next <= run + len; next += 150) {
        const f = (next - run) / len, a = new THREE.Mesh(arrowGeo, arrowMat);
        a.position.set(ax + f * (bx - ax), 2.3, az + f * (bz - az)); a.rotation.y = rot; a.scale.set(1, .25, 1); ribbon.add(a);
      }
      run += len;
    }
  }
}
function keepPick() {                                            // block changed: keep the service only if its stop is still listed
  const b = shownBlk();
  if (pick.stop && !(b in (T?.stops?.find(s => s.code === pick.stop)?.walk || {}))) pick.svc = pick.stop = null;
  updateTransit3d(); syncLive();
}
$('#commutePanel').addEventListener('click', e => {
  const c = e.target.closest('button.svc'), s = e.target.closest('button.stn');
  if (c) { const on = pick.svc === c.dataset.svc && pick.stop === c.dataset.stop; pick.svc = on ? null : c.dataset.svc; pick.stop = on ? null : c.dataset.stop; }
  else if (s) {
    pick.station = pick.station === s.dataset.station ? null : s.dataset.station;
    const ex = T.stations.find(st => st.name === pick.station)?.exits;
    if (ex) frame(ex.reduce((a, e) => a + e.x, 0) / ex.length, ex.reduce((a, e) => a + e.z, 0) / ex.length);
  }
  else if (e.target.closest('.stop > .aitem')) pick.svc = pick.stop = null;
  else return;
  syncLive(); renderCommute(); updateTransit3d();
});
// 3D tap on a bus stop pin or an exit pin: open the Commute tab there
function openCommuteAt(f) { focus = f; if (rtab === 'commute') renderCommute(); else { rtab = 'commute'; applyRTab(); } }
function tapPin(o) {
  const u = o?.userData;
  if (u?.station) { pick.station = u.station; openCommuteAt(() => $('#commutePanel .station-card')); return true; }
  const a = u?.idx != null && P.amenities[u.idx];
  if (a?.cat !== 'bus') return false;
  openCommuteAt(() => { const s = T.stops.find(s => Math.hypot(s.x - a.x, s.z - a.z) <= 30); return s && $(`#commutePanel .stop[data-stop="${CSS.escape(s.code)}"]`); });
  return true;
}
window.__pinScreen = () => {                                    // test hook: screen point of each visible exit / bus pin
  const r = renderer.domElement.getBoundingClientRect(), v = new THREE.Vector3();
  return pickables.filter(o => o.parent.visible && (o.userData.station || P.amenities?.[o.userData.idx]?.cat === 'bus')).map(o => {
    v.copy(o.position); v.y += 6; v.project(camera);
    return { station: o.userData.station, tip: o.userData.tip, x: r.left + (v.x + 1) / 2 * r.width, y: r.top + (1 - v.y) / 2 * r.height };
  }).filter(p => p.x > r.left + 10 && p.x < r.right - 10 && p.y > r.top + 10 && p.y < r.bottom - 10);
};
$('#showFac').addEventListener('change', e => { facGroup.visible = e.target.checked; });
$('#showAmen').addEventListener('change', e => { amenGroup.visible = e.target.checked; });
renderAmenities();

/* ---------- Resale nearby (HDB resale transactions, data.gov.sg) ---------- */
const RS = P.resale;
let rType = RS ? defaultType(RS) : null, rSort = 'date';
const surroundGroup = buildSurround(P.surround); surroundGroup.add(buildHostRings(P)); scene.add(surroundGroup);
{ // compact swatches for the feature kinds actually drawn; nothing is added when there are none
  const SW = { school: 'School', campus: 'School', cc: 'Community club', library: 'Library', hawker: 'Hawker', health: 'Health', park: 'Park' };
  const names = [...new Set((P.surround || []).map(s => s.k).filter(k => SW[k]).map(k => SW[k]))];
  if (names.length) $('#showSurround').closest('label').insertAdjacentHTML('afterend', `<div class="unit-meta" id="surroundKey">${names.map(n =>
    `<span style="white-space:nowrap;margin-right:8px"><i style="display:inline-block;width:9px;height:9px;border-radius:2px;margin-right:3px;background:${kindColour(Object.keys(SW).find(k => SW[k] === n))}"></i>${n}</span>`).join('')}</div>`);
}
$('#showSurround').addEventListener('change', e => { surroundGroup.visible = e.target.checked; });
const resaleGroup = new THREE.Group(); resaleGroup.visible = false; scene.add(resaleGroup);
const resaleMeshes = [];
for (const b of RS?.blocks || []) {
  const c = b.ctx != null && P.context[b.ctx];
  if (!c) continue;
  const sh = new THREE.Shape(c.p.map(q => new THREE.Vector2(q[0], -q[1])));
  const m = new THREE.Mesh(new THREE.ExtrudeGeometry(sh, { depth: c.h + 0.3, bevelEnabled: false }), new THREE.MeshLambertMaterial({ color: 0xDCEBFA }));
  m.rotation.x = -Math.PI / 2; m.userData.resale = b; m.castShadow = true; resaleGroup.add(m); resaleMeshes.push(m);
}
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
function renderResaleLegend() { $('#legend').innerHTML = resaleLegendHtml(RS, rType, psmRange()); }
function renderResaleTypes() { $('#resaleTypes').innerHTML = resaleTypesHtml(RS, rType); }
$('#resaleTypes').addEventListener('click', e => {
  const t = e.target.closest('.chip')?.dataset.t; if (!t) return;
  rType = t; renderResaleTypes(); paintResale(); renderResaleLegend(); renderResalePanel();
});
function renderResalePanel() {
  $('#resalePanel').innerHTML = resalePanelHtml(P, rType, rSort);
  $('#rSort')?.addEventListener('change', e => { rSort = e.target.value; renderResalePanel(); });
}
function openResaleCard(b) {
  if (rtab !== 'sun') { rtab = 'sun'; applyRTab(); }             // the block card lives on the Sun tab
  $('#resaleCard').hidden = false;
  $('#resaleCard').innerHTML = resaleCardHtml(b, RS.asOf);
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
  const v = rtab !== 'sun';
  document.querySelectorAll('.rtabs button').forEach(b => b.setAttribute('aria-selected', b.dataset.t === rtab));
  $('#valuePanel').hidden = rtab !== 'value';
  $('#commutePanel').hidden = rtab !== 'commute';
  for (const id of ['#unitCard', '#tableHead', '#tableWrap', '#tableNote']) $(id).hidden = v || !hasLayout || mode === 'resale';
  $('#upcomingCard').hidden = v || hasLayout;
  $('#resalePanel').hidden = v || mode !== 'resale';
  syncLive();                                                     // before rendering: it may drop stale live data
  if (v) { $('#resaleCard').hidden = true; if (rtab === 'value') renderValue(); else renderCommute(); }
  if (rtab === 'commute') loadTransit();
  updateTransit3d();
}
$('.rtabs').addEventListener('click', e => { const t = e.target.closest('button')?.dataset.t; if (t) { rtab = t; applyRTab(); } });
function renderCommute() {
  const a = document.activeElement, sel = a?.matches?.('#commutePanel button.svc') ? `button.svc[data-svc="${CSS.escape(a.dataset.svc)}"][data-stop="${CSS.escape(a.dataset.stop)}"]`
    : a?.matches?.('#commutePanel button.stn') ? `button.stn[data-station="${CSS.escape(a.dataset.station)}"]` : null;   // keep keyboard focus across re-renders
  $('#commutePanel').innerHTML = commuteHtml(P, stacks, selStack, T, R, pick, bus && bus.stop === pick.stop ? { ...bus, nowMs: liveNow() } : null);
  if (sel) $('#commutePanel').querySelector(sel)?.focus({ preventScroll: true });
  if (!focus || T === undefined) return;                         // still loading: the post-load render scrolls
  const el = T && focus(); focus = null;
  if (el) { el.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); el.classList.add('flash'); setTimeout(() => el.classList.remove('flash'), 1500); }
}
/* ---------- Live arrivals for the picked stop (web/live.js), polled only while Commute is open and the page visible ---------- */
let bus = null, liveAbort = null, livePoll = 0, liveTick = 0;      // bus: {stop, data, updatedMs, failed, offsetMs}; times on the server clock
const liveNow = () => Date.now() + (bus?.offsetMs || 0);
function syncLive() {
  const want = API && rtab === 'commute' && document.visibilityState === 'visible' ? pick.stop : null;
  if (want && livePoll && bus?.stop === want) return;                // already polling this stop
  liveAbort?.abort(); clearInterval(livePoll); clearInterval(liveTick); livePoll = liveTick = 0;
  if (!want) return;
  if (bus?.stop !== want || liveNow() - bus.updatedMs >= 90000) bus = { stop: want, data: null, updatedMs: 0, failed: false, offsetMs: 0 };
  const poll = () => {
    liveAbort?.abort(); const ac = liveAbort = new AbortController();
    fetchArrivals(want, ac.signal).catch(() => null).then(r => {
      if (ac.signal.aborted || pick.stop !== want) return;             // late answer for a stop no longer picked
      if (r) { const off = Number.isFinite(r.offsetMs) ? r.offsetMs : 0; bus = { stop: want, data: r.data, offsetMs: off, updatedMs: Date.now() + off, failed: false }; }
      else if (!bus.data || liveNow() - bus.updatedMs >= 90000) bus = { ...bus, data: null, failed: true };   // keep good data 90 s
      clearInterval(liveTick);
      liveTick = bus.data ? setInterval(() => document.querySelectorAll('#commutePanel .live').forEach(el => { el.textContent = liveLine(bus.updatedMs, liveNow(), false); }), 1000) : 0;
      renderCommute();
    });
  };
  poll(); livePoll = setInterval(poll, window.__liveInterval || 30000);   // test hook: window.__liveInterval (ms)
}
document.addEventListener('visibilitychange', syncLive);
function renderValue() { $('#valuePanel').innerHTML = valueHtml(P, stacks, selStack, selFloor); }
$('#valuePanel').addEventListener('click', e => { const r = e.target.closest('tr[data-s]'); if (r) select(+r.dataset.s); });
function setResaleMode(on) {
  resaleGroup.visible = on;
  $('#resaleTypes').hidden = !on || !RS;
  $('#resalePanel').hidden = !on;
  if (!on) $('#resaleCard').hidden = true;
  if (hasLayout) for (const id of ['#unitCard', '#tableHead', '#tableWrap', '#tableNote']) $(id).hidden = on;
  if (rtab !== 'sun') queueMicrotask(applyRTab);
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
function renderLegend() { if (mode === 'resale') renderResaleLegend(); else $('#legend').innerHTML = legendHtml(P, mode, hasLayout); }
function updateSunUI() {
  const p = sunNow; $('#clock').textContent = fmtTime(cur.min);
  $('#sunline').textContent = (p.alt > 0 ? `Sun ${Math.round(p.alt)}° high, from the ${card16(p.az)} (${Math.round(p.az)}°). ` : 'Sun below the horizon. ') + `Solar noon ${fmtTime(noonH * 60)}.`;
  const s = p.s; sunLight.position.set(s[0] * 1400, Math.max(s[1], 0.02) * 1400, s[2] * 1400);
  const up = Math.max(0, Math.sin(p.alt * deg));
  sunLight.intensity = p.alt > 0 ? 0.9 + 2 * Math.sqrt(up) : 0; hemi.intensity = p.alt > 0 ? 1.1 + 0.6 * up : 0.7;
  sunBall.position.set(s[0] * 540, s[1] * 540, s[2] * 540); sunBall.visible = p.alt > -3;
  scene.background = skyColor(p.alt);
  const mo = moonAltAz(site, sgMs()), ph = moonPhase(sgMs()), mv = sunVec(mo.alt, mo.az);
  moon.draw(ph.illum, ph.waxing); moonBall.position.set(mv[0] * 520, mv[1] * 520, mv[2] * 520); moonBall.visible = mo.alt > -3;
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
  const { title, rows } = stackTable(P, stacks, $('#sort').value, selStack);
  $('#tableTitle').textContent = title; $('#tbody').innerHTML = rows;
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
function renderUnitCard() {
  const st = stacks.find(s => s.no === selStack), u = st && (st.units.find(u => u.floor === selFloor) || st.units[0]);
  $('#unitCard').innerHTML = unitCardHtml(P, base, st, u, cur);
}
function select(no, floor) {
  selStack = no; const st = stacks.find(s => s.no === no);
  if (st && floor == null) floor = st.units[Math.floor(st.units.length / 2)].floor;
  selFloor = floor; updateOutlines(); paint(); renderUnitCard(); renderTable(); keepPick();
  if (rtab === 'value') renderValue(); else if (rtab === 'commute') renderCommute();   // not in renderUnitCard: that runs every frame while playing
  const phone = matchMedia('(max-width:820px)').matches;            // phones: the card sits under the 3D view, the table further down
  (phone ? $('#unitCard') : document.querySelector(`#tbody tr[data-s="${no}"]`))?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}
$('#unitCard').addEventListener('click', e => {
  const a = e.target.closest('button')?.dataset.a, st = stacks.find(s => s.no === selStack); if (!a || !st) return;
  if (a === 'up' && selFloor < st.floors) select(selStack, selFloor + 1);
  else if (a === 'down' && selFloor > st.first) select(selStack, selFloor - 1);
  else if (a === 'layout') openLayout(st.no);
  else if (a === 'clear') { selStack = selFloor = null; camGoal = null; updateOutlines(); paint(); renderUnitCard(); renderTable(); keepPick(); if (rtab === 'value') renderValue(); else if (rtab === 'commute') renderCommute(); }
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
function aim(e) {
  const r = renderer.domElement.getBoundingClientRect();
  mouse.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1); ray.setFromCamera(mouse, camera);
}
function hit(e) {
  aim(e);
  // only the model: three.js raycasting ignores .visible, so the hidden selection box would swallow clicks
  const h = model && ray.intersectObject(model, true).find(h => h.object.isMesh && h.object.name !== 'Detail'); // thin slabs/fins shouldn't swallow clicks
  return h && h.object === unitMesh ? units[vUnit[h.face.a]] : null;
}
renderer.domElement.addEventListener('pointerdown', e => { downAt = [e.clientX, e.clientY]; camGoal = null; });
renderer.domElement.addEventListener('pointerup', e => {
  if (!downAt) return; const m = Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]); downAt = null;
  if (m > 5) return;
  aim(e); if (ray.intersectObjects(pickables.filter(o => o.parent.visible), false).some(h => tapPin(h.object))) return;   // an MRT pin may cover an exit pin
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
