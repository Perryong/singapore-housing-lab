// 3D "dollhouse" of one stack's flat (projects/<id>/plans3d/<stack>.glb + .json), in its own canvas.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';

const loader = new GLTFLoader().setDRACOLoader(                // models are Draco-compressed (blender/build_plan3d.py)
  new DRACOLoader().setDecoderPath('https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/libs/draco/gltf/'));
window.__plan3dViewers = 0;                                    // live viewers (test hook)
const title = s => s.replace(/-\s+/g, '').toLowerCase().replace(/\b\w/g, c => c.toUpperCase()).replace(/\s*\/\s*/g, ' / ').replace(/\bWc\b/, 'WC');

// stem = '<base>plans3d/<stack>' (no extension). Resolves to { reset, dispose }; rejects if the model can't load.
export async function openPlan3d(holder, stem) {
  const [J, gltf] = await Promise.all([
    fetch(stem + '.json', { cache: 'no-cache' }).then(r => { if (!r.ok) throw new Error('no plan'); return r.json(); }),
    loader.loadAsync(stem + '.glb'),
  ]);
  const w = holder.clientWidth || 600, h = holder.clientHeight || 420;
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); renderer.setSize(w, h);
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const scene = new THREE.Scene(); scene.background = new THREE.Color(0xF4F6F3);
  const camera = new THREE.PerspectiveCamera(38, w / h, 0.1, 200);
  scene.add(new THREE.HemisphereLight(0xffffff, 0xC9CFC6, 1.6));
  const sun = new THREE.DirectionalLight(0xffffff, 1.6);
  sun.position.set(-8, 14, 10); sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -12, right: 12, top: 12, bottom: -12 }); sun.shadow.bias = -0.0005;
  scene.add(sun);
  gltf.scene.traverse(o => { if (o.isMesh) { o.castShadow = o.name === 'walls'; o.receiveShadow = true; } });
  scene.add(gltf.scene);
  const box = new THREE.Box3().setFromObject(gltf.scene), size = box.getSize(new THREE.Vector3()), c = box.getCenter(new THREE.Vector3());
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(size.x + 6, size.z + 6), new THREE.MeshLambertMaterial({ color: 0xE6EAE4 }));
  ground.rotation.x = -Math.PI / 2; ground.position.set(c.x, -0.01, c.z); ground.receiveShadow = true; scene.add(ground);

  // north arrow on the ground beside the flat; page-up has compass bearing J.north
  const n = THREE.MathUtils.degToRad(J.north || 0), dir = new THREE.Vector3(-Math.sin(n), 0, -Math.cos(n));
  const arrow = new THREE.ArrowHelper(dir, new THREE.Vector3(box.max.x + 1.2, 0.05, box.max.z + 0.5), 1.4, 0xC0392B, 0.5, 0.35);
  scene.add(arrow);

  // room names: HTML labels that follow the 3D positions
  const layer = document.createElement('div'); layer.className = 'p3-labels';
  const area = r => Math.abs(r.poly.reduce((a, q, i) => { const n = r.poly[(i + 1) % r.poly.length]; return a + q[0] * n[1] - n[0] * q[1]; }, 0)) / 2;
  const tags = J.rooms.filter(r => r.name).sort((a, b) => area(b) - area(a)).map(r => {   // big rooms win label space
    const el = document.createElement('span'); el.textContent = title(r.name); layer.append(el);
    return { el, p: new THREE.Vector3(r.label[0], 1.2, r.label[1]) };
  });
  const nTag = document.createElement('span'); nTag.className = 'n'; nTag.textContent = 'N'; layer.append(nTag);
  tags.push({ el: nTag, p: arrow.position.clone().add(dir.clone().multiplyScalar(1.8)) });
  holder.replaceChildren(renderer.domElement, layer);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true; controls.maxPolarAngle = Math.PI * 0.47;
  // distance that fits the whole flat in the canvas, whatever its shape (phones are tall and narrow)
  const t = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  const fit = Math.max(size.z / 2 / t, size.x / 2 / (t * camera.aspect), 6) * 1.25;
  const view = new THREE.Vector3(-0.25, 0.95, 0.85).normalize().multiplyScalar(fit);
  const reset = () => { controls.target.copy(c); camera.position.copy(c).add(view); controls.update(); };
  reset();

  const v = new THREE.Vector3();
  let raf = 0, alive = true;
  const frame = () => {
    if (!alive) return;
    controls.update(); renderer.render(scene, camera);
    const shown = [];                                          // hide a label that would overlap one already placed
    for (const t of tags) {
      v.copy(t.p).project(camera);
      const x = (v.x + 1) / 2 * w, y = (1 - v.y) / 2 * h, hw = (t.w ??= t.el.offsetWidth) / 2 + 2, hh = (t.h ??= t.el.offsetHeight) / 2 + 1;
      const hit = shown.some(o => Math.abs(o.x - x) < o.hw + hw && Math.abs(o.y - y) < o.hh + hh);
      t.el.style.visibility = hit ? 'hidden' : '';
      if (!hit) shown.push({ x, y, hw, hh });
      t.el.style.transform = `translate(-50%,-50%) translate(${x}px,${y}px)`;
    }
    raf = requestAnimationFrame(frame);
  };
  frame();
  window.__plan3dViewers++;
  return {
    reset,
    dispose() {
      if (!alive) return;
      alive = false; cancelAnimationFrame(raf); controls.dispose();
      scene.traverse(o => { o.geometry?.dispose(); [].concat(o.material || []).forEach(m => m.dispose()); });
      renderer.dispose(); renderer.forceContextLoss(); holder.replaceChildren();
      window.__plan3dViewers--;
    },
  };
}
