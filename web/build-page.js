// BTO build: the project's model revealed unit by unit as an assembly drawing, with the build panels and a stage strip.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { buildLayout, catOf, sizeOf } from './project.js';
import { esc } from './format.js';
import { TOTAL, STAGES, stages, buildOrder, stateAt, timelineHtml, activeCardHtml, structureHtml, logLines, titleBlockHtml, pickMime, revealStep } from './build.js';

const $ = s => document.querySelector(s);
const pid = new URLSearchParams(location.search).get('p') || '';
const NO_LAYOUT = "This project's blocks aren't released yet";
const S = stages();
window.__build = { ready: false, t: 0, step: 0, msg: '' };

// the stage is a fixed 1600×900 drawing, scaled to the window so every recording has the same layout
const fit = () => document.documentElement.style.setProperty('--k', Math.min(innerWidth / 1600, innerHeight / 900));
addEventListener('resize', fit); fit();

function fail(text) {
  $('#msg').hidden = false;
  $('#msg').innerHTML = `${esc(text)}. <a href="./?p=${encodeURIComponent(pid)}">Back to BTOlab</a>`;
  window.__build.msg = text;
}

const P = await fetch(`../projects/${encodeURIComponent(pid)}/project.json`).then(r => r.ok ? r.json() : null).catch(() => null);
const L = P && P.stacks?.length ? buildLayout(P) : null;
const gltf = L && await new GLTFLoader().loadAsync(`../projects/${encodeURIComponent(pid)}/model.glb`).catch(() => null);
if (!gltf) { fail(NO_LAYOUT); throw new Error(NO_LAYOUT); }

const order = buildOrder(L, P), N = order.length, rank = new Float32Array(N);
order.forEach((u, i) => { rank[u.id] = i; });
$('#projTitle').textContent = `${P.name} — Assembly Drawing`;
$('#projWhat').textContent = `${Object.keys(P.blocks).length} blocks · ${L.stacks.length} stacks · ${N.toLocaleString('en-SG')} flats, placed unit by unit`;
$('#projBox').textContent = `${P.name} · ${P.town}`.toUpperCase();
document.title = `${P.name}: BTO build | BTOlab`;

/* ---------- scene ---------- */
const view = $('#view'), W = view.clientWidth, H = view.clientHeight;
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(2, devicePixelRatio)); renderer.setSize(W, H); renderer.localClippingEnabled = true;
view.append(renderer.domElement);
const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(30, W / H, 1, 5000);
scene.add(new THREE.HemisphereLight(0xffffff, 0xd9cdbd, 2.2));
const sun = new THREE.DirectionalLight(0xffffff, 1.4); sun.position.set(-150, 300, 200); scene.add(sun);

const PAPER = 0xFBF7F0, INK = 0x2B2522, RED = 0xB8282E, GHOST = 0xD9666A;
const U = { uStep: { value: 0 }, uDrop: { value: 1 }, uPaint: { value: 0 } };
const below = new THREE.Plane(new THREE.Vector3(0, -1, 0), 0), above = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const cut = new THREE.Plane(new THREE.Vector3(1, 0, 0), 1e6);

// rank-driven reveal: `show` is the GLSL condition (on vRank) for a fragment to be drawn; the unit being placed hangs above its slot
function rankMaterial(mat, show, { tint = false } = {}) {
  mat.clippingPlanes = [cut];
  mat.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = 'attribute float aRank;\nattribute vec3 aType;\nuniform float uStep, uDrop;\nvarying float vRank;\nvarying vec3 vType;\n' +
      sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvRank = aRank; vType = aType;\nif (aRank >= uStep && aRank < uStep + 1.0) transformed.y += (1.0 - uDrop) * 6.0;');
    sh.fragmentShader = 'uniform float uStep, uPaint;\nvarying float vRank;\nvarying vec3 vType;\n' +
      sh.fragmentShader.replace('void main() {', `void main() {\nif (!(${show})) discard;`);
    if (tint) sh.fragmentShader = sh.fragmentShader.replace('#include <color_fragment>',
      '#include <color_fragment>\ndiffuseColor.rgb = vRank >= uStep ? vec3(0.722, 0.157, 0.180) : mix(diffuseColor.rgb, vType, uPaint);');
  };
  return mat;
}
const BUILT = 'vRank < uStep + 1.0', UNBUILT = 'vRank >= uStep';
const key = (a, i) => `${a.getX(i).toFixed(2)},${a.getY(i).toFixed(2)},${a.getZ(i).toFixed(2)}`;
const centre = new THREE.Vector3(), box = new THREE.Box3();
let units = null;

gltf.scene.updateMatrixWorld(true);
gltf.scene.traverse(o => {
  if (!o.isMesh) return;
  const g = o.geometry, m = o.matrixWorld;
  if (o.name === 'Context') {                                  // existing neighbours: faint paper, no lines
    scene.add(Object.assign(new THREE.Mesh(g, new THREE.MeshLambertMaterial({ color: 0xE9E0D2, transparent: true, opacity: 0.22, depthWrite: false, clippingPlanes: [cut] })), { matrixAutoUpdate: false, matrix: m }));
    return;
  }
  const edges = new THREE.EdgesGeometry(g, 25);
  if (g.attributes._unit) {                                    // the flats: revealed by build rank
    units = o; box.setFromObject(o);
    const u = g.attributes._unit.array, n = u.length, r = new Float32Array(n), ty = new Float32Array(n * 3), byPos = new Map();
    const col = new THREE.Color();
    for (let i = 0; i < n; i++) {
      r[i] = rank[u[i]];
      col.set(P.categories[catOf(P, L.units[u[i]].code)].col); ty.set([col.r, col.g, col.b], i * 3);
      byPos.set(key(g.attributes.position, i), i);
    }
    g.setAttribute('aRank', new THREE.BufferAttribute(r, 1)); g.setAttribute('aType', new THREE.BufferAttribute(ty, 3));
    const ep = edges.attributes.position, er = new Float32Array(ep.count), et = new Float32Array(ep.count * 3);
    for (let i = 0; i < ep.count; i++) { const j = byPos.get(key(ep, i)) ?? 0; er[i] = r[j]; et.set(ty.subarray(j * 3, j * 3 + 3), i * 3); }
    edges.setAttribute('aRank', new THREE.BufferAttribute(er, 1)); edges.setAttribute('aType', new THREE.BufferAttribute(et, 3));
    const add = obj => { obj.matrixAutoUpdate = false; obj.matrix.copy(m); scene.add(obj); };
    add(new THREE.Mesh(g, rankMaterial(new THREE.MeshLambertMaterial({ color: PAPER, side: THREE.DoubleSide }), BUILT, { tint: true })));
    add(new THREE.Mesh(g, rankMaterial(new THREE.MeshBasicMaterial({ color: GHOST, transparent: true, opacity: 0.025, depthWrite: false }), UNBUILT)));
    add(new THREE.LineSegments(edges, rankMaterial(new THREE.LineBasicMaterial({ color: INK }), BUILT)));
    const ghost = new THREE.LineSegments(edges, rankMaterial(new THREE.LineDashedMaterial({ color: GHOST, dashSize: 0.8, gapSize: 0.7, transparent: true, opacity: 0.3, depthWrite: false }), UNBUILT));
    ghost.computeLineDistances(); add(ghost);
    return;
  }
  // slabs, balconies, cores: revealed by a height clip that follows the floor being built
  const add = obj => { obj.matrixAutoUpdate = false; obj.matrix.copy(m); scene.add(obj); };
  add(new THREE.Mesh(g, new THREE.MeshLambertMaterial({ color: PAPER, side: THREE.DoubleSide, clippingPlanes: [below, cut] })));
  add(new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: INK, clippingPlanes: [below, cut] })));
  const ghost = new THREE.LineSegments(edges, new THREE.LineDashedMaterial({ color: GHOST, dashSize: 0.8, gapSize: 0.7, transparent: true, opacity: 0.3, depthWrite: false, clippingPlanes: [above, cut] }));
  ghost.computeLineDistances(); add(ghost);
});
box.getCenter(centre);
const R = box.getSize(new THREE.Vector3()).length() * 1.75;
centre.y *= 0.8;

// the section cuts across the first block, through its middle
const firstBlk = Object.keys(P.blocks)[0], fb = L.stacks.filter(s => String(s.blk) === firstBlk);
if (!fb.length) { fail(NO_LAYOUT); throw new Error(NO_LAYOUT); }
const bc = new THREE.Vector3(fb.reduce((a, s) => a + s.x, 0) / fb.length, 0, fb.reduce((a, s) => a + s.z, 0) / fb.length);
const bAxis = new THREE.Vector3(fb[0].ax, 0, fb[0].az).normalize();
const bHalf = Math.max(...fb.map(s => Math.abs((s.x - bc.x) * bAxis.x + (s.z - bc.z) * bAxis.z))) + 8;
const tallest = Object.entries(P.blocks).sort((a, b) => b[1].floors - a[1].floors)[0];

// crane line over the unit being placed
const crane = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 30, 0)]), new THREE.LineBasicMaterial({ color: RED }));
scene.add(crane);

/* ---------- overlays ---------- */
const overlay = $('#overlay');
const callout = () => overlay.appendChild(Object.assign(document.createElement('div'), { className: 'call' }));
const cActive = callout(), cTop = callout(), cVoid = callout();
const maxFloors = Math.max(...Object.values(P.blocks).map(b => b.floors));
const levels = [10, 20, 30, 40, 50].filter(f => f <= maxFloors).map(f => {
  const el = overlay.appendChild(Object.assign(document.createElement('div'), { className: 'lvl mono', textContent: `+${(f * L.FH).toFixed(2)}` }));
  return { f, el };
});
const v3 = new THREE.Vector3();
// measured when placing: the drawing panel fills in after load
const panels = () => ['#title', '#dwg'].map(id => { const e = $(id); return [e.offsetLeft, e.offsetTop, e.offsetLeft + e.offsetWidth, e.offsetTop + e.offsetHeight]; });
function place(el, x, y, z) {
  v3.set(x, y, z).project(camera);
  const px = (v3.x + 1) / 2 * W, py = (1 - v3.y) / 2 * H;
  // off screen, or under the title block or drawing panel
  el.hidden = v3.z > 1 || panels().some(([a, b, c, d]) => px > a - 20 && px < c && py > b - 10 && py < d + 10);
  el.style.left = `${px}px`; el.style.top = `${py}px`;
}
const blockCentre = b => { const ss = L.stacks.filter(s => String(s.blk) === b); return [ss.reduce((a, s) => a + s.x, 0) / ss.length, ss.reduce((a, s) => a + s.z, 0) / ss.length]; };
const [tx, tz] = blockCentre(tallest[0]), [vx, vz] = blockCentre(firstBlk);

/* ---------- playback ---------- */
let t = 0, playing = true, speed = 1, rotate = true, forceColour = false, forceCut = false, last = performance.now();
const cam = { az: 212, el: 24 };

function frame(tt) {
  const s = stateAt(tt, order, L, P), FH = L.FH;
  U.uStep.value = revealStep(s); U.uDrop.value = s.drop;
  U.uPaint.value = forceColour ? 1 : s.paint;
  below.constant = s.topY; above.constant = -s.topY;

  cam.az = 212 + (rotate ? 40 * s.t / TOTAL : 0);
  const sectionOn = forceCut || s.key === 'section', c = forceCut ? 1 : s.cut, zoom = sectionOn ? 1 - 0.3 * Math.min(1, c * 2) : 1;
  const tgt = centre.clone().lerp(new THREE.Vector3(bc.x, centre.y, bc.z), sectionOn ? Math.min(1, c * 2) : 0);
  const az = cam.az * Math.PI / 180, el = cam.el * Math.PI / 180, r = R * zoom;
  camera.position.set(tgt.x + r * Math.sin(az) * Math.cos(el), tgt.y + r * Math.sin(el), tgt.z - r * Math.cos(az) * Math.cos(el));
  camera.lookAt(tgt);
  if (sectionOn) {                                             // remove the half facing the camera, sliding to the middle
    const n = bAxis.clone(); if (n.dot(camera.position.clone().sub(bc)) > 0) n.negate();
    cut.set(n, -n.dot(bc) + bHalf * (1 - Math.min(1, c * 2)));
  } else cut.set(new THREE.Vector3(1, 0, 0), 1e6);

  const a = s.active;
  crane.visible = !!a;
  if (a) crane.position.set(a.st.x, a.y + FH / 2 + (1 - s.drop) * 6, a.st.z);
  renderer.render(scene, camera);

  // overlays and panels
  cActive.hidden = !a;
  if (a) { cActive.innerHTML = `BLK ${esc(a.st.blk)} · LEVEL ${a.floor}<small>stack ${a.st.no} · ${esc(P.categories[catOf(P, a.code)].name)} · lowering</small>`; place(cActive, a.st.x, a.y + 30, a.st.z); }
  cTop.innerHTML = `BLK ${esc(tallest[0])} · ${tallest[1].floors} STOREYS<small>tops out at +${(tallest[1].floors * FH).toFixed(1)} m</small>`;
  place(cTop, tx, tallest[1].floors * FH + 6, tz);
  cVoid.innerHTML = 'VOID DECK<small>level 1 · columns and lift lobbies</small>';
  place(cVoid, vx, 1.4, vz); cVoid.hidden ||= s.stage < 1;
  for (const l of levels) { place(l.el, box.max.x + 12, l.f * FH, centre.z); l.el.hidden ||= s.topY < l.f * FH - 1e-6 && s.stage < 3; }

  const clock = `${String(Math.floor(s.t / 60)).padStart(2, '0')}:${(s.t % 60).toFixed(1).padStart(4, '0')}`;
  $('#clock').textContent = clock; $('#time').textContent = `${clock} / 00:25`;
  $('#stepBox').textContent = `STEP ${String(s.step).padStart(String(N).length, '0')}/${N} · UNITS`;
  $('#titleStep').textContent = `STEP ${String(s.step).padStart(String(N).length, '0')} / ${N}`;
  $('#titleOp').textContent = a ? `BLK ${a.st.blk} · LEVEL ${a.floor} · STACK ${a.st.no}` : STAGES[s.stage].label.toUpperCase();
  $('#titleSpec').textContent = a ? `${P.categories[catOf(P, a.code)].name} · ${sizeOf(P, a.code)[0]} m²` : '';
  $('#dwg').innerHTML = titleBlockHtml(P, s, cam);
  $('#timeline').innerHTML = timelineHtml(s);
  $('#active').innerHTML = activeCardHtml(s, P, N);
  $('#structure').innerHTML = structureHtml(s, P);
  // rebuilt from the step every frame, so scrubbing back never leaves stale lines
  $('#log').innerHTML = logLines(order, Math.max(0, s.step - 400), s.step, P, 14 / N / speed).slice(-7).map(l => `<div>${esc(l)}</div>`).join('');
  for (const c of $('#strip').children) c.setAttribute('aria-current', +c.dataset.stage === s.stage);
  $('#scrub').value = s.t;
  Object.assign(window.__build, { t: s.t, step: s.step });
}

function tick(now) {
  const dt = (now - last) / 1000; last = now;
  if (playing) { t = Math.min(TOTAL, t + dt * speed); if (t >= TOTAL) setPlaying(false); }
  frame(t);
  requestAnimationFrame(tick);
}
export function seek(v) { t = Math.min(TOTAL, Math.max(0, v)); frame(t); }
function setPlaying(v) {
  if (!v && recording?.state === 'recording') recording.stop();   // a recording is one uninterrupted run: pausing ends it
  playing = v; $('#play').textContent = v ? '❚❚' : '▶'; $('#play').setAttribute('aria-label', v ? 'Pause' : 'Play'); }
export function play(from = 0) { seek(from); setPlaying(true); }

/* ---------- record: capture this tab while the sequence plays once ---------- */
let recording = null, busy = false, msgTimer = 0;
function say(text) {
  $('#msg').hidden = false; $('#msg').textContent = text; window.__build.msg = text;
  clearTimeout(msgTimer); msgTimer = setTimeout(() => { $('#msg').hidden = true; }, 5000);
}
async function record() {
  if (recording) { recording.stop(); return; }                // the button reads Stop while recording
  if (busy) return;                                           // a share picker is already open
  busy = true;
  const fmt = window.MediaRecorder ? pickMime(m => MediaRecorder.isTypeSupported(m)) : null;
  let stream;
  try {
    if (!fmt || !navigator.mediaDevices?.getDisplayMedia) throw new Error('unsupported');
    stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 60 }, audio: false, preferCurrentTab: true, selfBrowserSurface: 'include' });
    recording = new MediaRecorder(stream, { mimeType: fmt.mime, videoBitsPerSecond: 12e6 });
  } catch {
    stream?.getTracks().forEach(tr => tr.stop());
    say('Recording needs permission to capture this tab.'); return;
  } finally { busy = false; }
  const parts = [];
  recording.ondataavailable = e => { if (e.data.size) parts.push(e.data); };
  recording.onstop = () => {
    stream.getTracks().forEach(tr => tr.stop());
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(new Blob(parts, { type: fmt.mime })), download: `${pid}-build.${fmt.ext}` });
    a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 10000);
    recording = null; $('#recDot').hidden = true; $('#record').textContent = '● Record';
  };
  stream.getVideoTracks()[0]?.addEventListener('ended', () => recording?.stop());   // "Stop sharing" in the browser bar
  $('#recDot').hidden = false; $('#msg').hidden = true; $('#record').textContent = '■ Stop';
  play(0); recording.start(250);
}

/* ---------- controls ---------- */
$('#record').onclick = record;
$('#marks').innerHTML = S.map(g => `<span style="left:${g.t0 / TOTAL * 100}%">${g.label.toUpperCase()}</span>`).join('');
$('#scrub').addEventListener('input', e => { setPlaying(false); seek(+e.target.value); });
$('#rebuild').onclick = () => play(0);
$('#play').onclick = () => { if (t >= TOTAL) t = 0; setPlaying(!playing); };
const toggle = (id, set) => { const b = $(id); b.onclick = () => { const v = b.getAttribute('aria-pressed') !== 'true'; b.setAttribute('aria-pressed', v); set(v); frame(t); }; };
toggle('#rotate', v => { rotate = v; }); toggle('#colour', v => { forceColour = v; }); toggle('#section', v => { forceCut = v; });
$('#speed').onclick = () => { speed = speed === 1 ? 2 : speed === 2 ? 0.5 : 1; $('#speed').textContent = `SPEED ×${speed}`; };

// stage strip: each card shows the real model at the end of its stage
const strip = $('#strip');
strip.innerHTML = S.map((g, i) => `<button class="st" data-stage="${i}"><span class="t mono">${g.t0.toFixed(1)}s</span><span class="ph"></span><b>${String(i + 1).padStart(2, '0')}. ${g.label}</b><small>${[
  `${Object.keys(P.blocks).length} footprints · grid`, 'level 1 · lift cores', `${N.toLocaleString('en-SG')} units · ${maxFloors} levels`,
  'water tanks · parapets', 'by flat type', `cut through Blk ${esc(firstBlk)}`][i]}</small></button>`).join('');
for (const c of strip.children) c.onclick = () => { setPlaying(false); seek(S[+c.dataset.stage].t0); };
renderer.setClearColor(0xF2EADF, 1);                        // thumbnails on paper, not on the transparent canvas
S.forEach((g, i) => {
  frame(Math.min(TOTAL, g.t1 - 1e-3));
  strip.children[i].querySelector('.ph').replaceWith(Object.assign(new Image(), { src: renderer.domElement.toDataURL('image/jpeg', 0.8), alt: '' }));
});
renderer.setClearColor(0x000000, 0);
seek(0);
window.__build.ready = true;
requestAnimationFrame(now => { last = now; tick(now); });
