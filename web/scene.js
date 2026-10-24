// three.js building blocks for the site scene: ground map, site plan, surroundings, sprites, sky and moon.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { deg } from './project.js';
import { ACAT } from './nearby.js';
import { kindColour, isGround, offsetOutline, hostRingShapes } from './surround.js';

export const col = h => new THREE.Color(h);
export function mkRamp(hexes) { const cs = hexes.map(col); return v => { v = Math.max(0, Math.min(1, v)); const x = v * (cs.length - 1), i = Math.min(cs.length - 2, Math.floor(x)); return cs[i].clone().lerp(cs[i + 1], x - i); }; }

const SKY = [[-8, '#18233A'], [-2, '#3D4A6E'], [2, '#EDB38C'], [10, '#CFDDE3'], [30, '#B7D5EA'], [90, '#A6CDEB']];
export function skyColor(a) {                                   // background colour for a sun altitude in degrees
  if (a <= SKY[0][0]) return col(SKY[0][1]);
  for (let i = 0; i < SKY.length - 1; i++) { const [a0, c0] = SKY[i], [a1, c1] = SKY[i + 1]; if (a <= a1) return col(c0).lerp(col(c1), (a - a0) / (a1 - a0)); }
  return col(SKY.at(-1)[1]);
}

// a rounded text tag that always faces the camera; h = height in metres
export function makeLabel(text, { size = 34, bg = 'rgba(29,42,46,.86)', fg = '#F4F7F6', h = 14 } = {}) {
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

// a map pin with a short glyph, anchored at its tip
export function pinSprite(text, color, h = 9) {
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

// OneMap grey street map around the site (Singapore Land Authority), ~1.2 km each way at zoom 17
export function addMapTiles(scene, site) {
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

// HDB's site plan on the ground, rotated to true north; upcoming sites (no plan yet) get a pin and mast instead
export function addSitePlan(scene, P, base, renderer) {
  if (!P.plan) {
    const pin = new THREE.Mesh(new THREE.CylinderGeometry(40, 40, 1.2, 64), new THREE.MeshLambertMaterial({ color: 0xF6C47A, transparent: true, opacity: .75 }));
    pin.position.y = 0.6; pin.receiveShadow = true; scene.add(pin);
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.2, 60, 12), new THREE.MeshLambertMaterial({ color: 0xE8931C }));
    mast.position.y = 30; mast.castShadow = true; scene.add(mast);
    return;
  }
  // HDB's site plans aren't published (copyright): only a local checkout with reference data has the image
  if (!/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) return;
  const { pxPerM: PX, upBearing, origin: [OX, OY], image: IMG } = P.plan;
  const planGroup = new THREE.Group(); planGroup.rotation.y = -upBearing * deg; scene.add(planGroup);
  let plan;                                                     // shown only once the image loads (it may not exist locally either)
  const tex = new THREE.TextureLoader().load(base + IMG.file, () => { plan.visible = true; });
  tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  plan = new THREE.Mesh(new THREE.PlaneGeometry(IMG.w / PX, IMG.h / PX), new THREE.MeshLambertMaterial({ map: tex }));
  plan.visible = false;
  plan.rotation.x = -Math.PI / 2; plan.position.set((IMG.x0 + IMG.w / 2 - OX) / PX, 0, (IMG.y0 + IMG.h / 2 - OY) / PX);
  plan.receiveShadow = true; planGroup.add(plan);
}

// simple 3D surroundings (tools/fetch_surround.py): outer-ring HDB, other BTO projects' blocks, every other OSM building, malls, MRT/LRT stations, schools, CCs, libraries, hawker centres,
// health buildings, parks; one mesh per kind. Ground areas (h <= 0.2) are flat at y = 0.15, translucent for campus/park.
const SURROUND = { hdb: 0xC9CEC8, bto: 0xC9CEC8, bldg: 0xD3D6D1, mall: 0xEFA48E, mrt: 0xE58A8A };
const shape2d = p => new THREE.Shape(p.map(q => new THREE.Vector2(q[0], -q[1])));
export function buildSurround(shapes = []) {
  const group = new THREE.Group();
  for (const k of new Set(shapes.map(s => s.k))) {
    const color = SURROUND[k] ?? kindColour(k); if (color == null) continue;
    const geos = shapes.filter(s => s.k === k).map(s => {
      const g = new THREE.ExtrudeGeometry(shape2d(s.p), { depth: isGround(s) ? 0.02 : s.h, bevelEnabled: false });
      g.rotateX(-Math.PI / 2); if (isGround(s)) g.translate(0, 0.15, 0); return g;
    });
    const tint = k === 'campus' || k === 'park';
    const m = new THREE.Mesh(mergeGeometries(geos), new THREE.MeshLambertMaterial({ color, transparent: tint, opacity: tint ? 0.55 : 1 }));
    m.receiveShadow = true; group.add(m); geos.forEach(g => g.dispose());
  }
  return group;
}

const RING_IN = 0.3, RING_OUT = 0.5;   // ring wall runs 0.3 m to 0.5 m outside the outline (0.2 m thick)
// 4 m tall thin ring 0.3 m outside each host outline (clinic/supermarket/preschool), one merged mesh per category
export function buildHostRings(P) {
  const group = new THREE.Group();
  for (const [cat, outlines] of Object.entries(hostRingShapes(P))) {
    const geos = outlines.map(p => {
      const sh = shape2d(offsetOutline(p, RING_OUT)); sh.holes.push(shape2d(offsetOutline(p, RING_IN)));
      const g = new THREE.ExtrudeGeometry(sh, { depth: 4, bevelEnabled: false }); g.rotateX(-Math.PI / 2); return g;
    });
    group.add(new THREE.Mesh(mergeGeometries(geos), new THREE.MeshLambertMaterial({ color: ACAT[cat][1] })));
    geos.forEach(g => g.dispose());
  }
  return group;
}

// the moon as a sprite whose disc shows the phase; draw(illum, waxing) repaints only when it visibly changes
export function makeMoon() {
  const tex = new THREE.CanvasTexture(document.createElement('canvas')); tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthWrite: false })); sprite.scale.set(34, 34, 1);
  let drawn = null;
  const draw = (illum, waxing) => {
    const key = `${Math.round(illum * 50)}${waxing}`; if (key === drawn) return; drawn = key;
    const c = tex.image, x = c.getContext('2d'); c.width = c.height = 128; const r = 56, rx = r * Math.abs(1 - 2 * illum);
    x.fillStyle = '#2E3A3E'; x.beginPath(); x.arc(64, 64, r, 0, Math.PI * 2); x.fill();
    if (illum > 0.01) {
      x.fillStyle = '#F4EFD8'; x.beginPath(); x.arc(64, 64, r, -Math.PI / 2, Math.PI / 2, !waxing);
      x.ellipse(64, 64, rx, r, 0, Math.PI / 2, -Math.PI / 2, illum > 0.5 ? !waxing : waxing); x.fill();
    }
    tex.needsUpdate = true;
  };
  return { sprite, draw };
}
