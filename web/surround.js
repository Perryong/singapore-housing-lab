// Pure helpers for the 3D surroundings (no three.js, so node can test them). Outlines are [[x, z], ...] in metres.
import { ACAT } from './nearby.js';

const KIND_CAT = { school: 'primary', campus: 'primary', cc: 'cc', library: 'library', hawker: 'hawker', health: 'polyclinic', park: 'park' };
export const kindColour = k => KIND_CAT[k] ? ACAT[KIND_CAT[k]][1] : null;
export const isGround = s => s.h <= 0.2;   // ground areas are flat whatever their kind

export function hostOutline(P, host) {
  const p = host && (Number.isInteger(host.s) ? P.surround?.[host.s]?.p : Number.isInteger(host.c) ? P.context?.[host.c]?.p : null);
  return p && p.length >= 3 ? p : null;
}

// grow a polygon outward by d metres (mitred corners, either winding); sharp spikes are clamped (miter length at most d/0.3)
export function offsetOutline(p, d) {
  const n = p.length;
  const area = p.reduce((a, q, i) => a + q[0] * p[(i + 1) % n][1] - p[(i + 1) % n][0] * q[1], 0);
  const sg = area > 0 ? 1 : -1;
  const nrm = (a, b) => { const dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz) || 1; return [sg * dz / l, -sg * dx / l]; };
  return p.map((q, i) => {
    const a = nrm(p[(i + n - 1) % n], q), b = nrm(q, p[(i + 1) % n]);
    const m = [a[0] + b[0], a[1] + b[1]], k = d / Math.max(0.3, 1 + a[0] * b[0] + a[1] * b[1]);
    return [q[0] + m[0] * k, q[1] + m[1] * k];
  });
}

// {category: [outline, ...]} for amenities with a valid host
export function hostRingShapes(P) {
  const out = {};
  for (const a of P.amenities || []) {
    const p = hostOutline(P, a.host);
    if (p && Object.hasOwn(ACAT, a.cat)) (out[a.cat] ||= []).push(p);
  }
  return out;
}
