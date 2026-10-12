// Nearby helpers (pure; no three.js).
import { esc } from './format.js';

// shortcut: straight line × 1.3 at 80 m/min, not a routed walk; use OneMap routing if exact times are needed
export const walkMin = d => Math.max(1, Math.round(d * 1.3 / 80));

// MOE P1 priority bands, measured from the stack's block (straight line to the school's location)
export function schoolBands(st, amenities) {
  const sch = amenities.filter(a => a.cat === 'primary').map(a => ({ ...a, ds: Math.hypot(a.x - st.x, a.z - st.z) }))
    .sort((a, b) => a.ds - b.ds);
  return { within1: sch.filter(a => a.ds <= 1000), within2: sch.filter(a => a.ds > 1000 && a.ds <= 2000) };
}

export const ACAT = {
  mrt: ['MRT station', '#C2272D', 'M'], lrt: ['LRT station', '#7D8C8C', 'L'], bus: ['Bus stop', '#2F6DB5', 'B'],
  primary: ['Primary school', '#2E8B57', 'P'], secondary: ['Secondary school', '#3E7D6E', 'S'], preschool: ['Preschool', '#E58E26', 'K'],
  hawker: ['Hawker centre / market', '#B5651D', 'H'], supermarket: ['Supermarket', '#8A3FA0', '$'], clinic: ['Clinic (CHAS)', '#D6336C', '+'],
  polyclinic: ['Polyclinic', '#A61E4D', '+'], park: ['Park', '#3A9D23', 'T'], library: ['Library', '#5C4B8A', 'Li'], cc: ['Community club', '#1F7A8C', 'CC'],
  mall: ['Shopping mall', '#E4572E', 'Ma'],
};
// MRT/LRT line colours by code prefix (LTA)
const LINE = { NS: '#D42E12', EW: '#009645', CG: '#009645', NE: '#9900AA', CC: '#FA9E0D', CE: '#FA9E0D', DT: '#005EC4', TE: '#9D5B25', JS: '#0099AA', JE: '#0099AA', JW: '#0099AA' };
export const lineChips = a => (a.lines || '').split(' ').filter(Boolean).map(c => `<b class="line" style="background:${LINE[c.replace(/\d.*/, '')] || '#748477'}">${esc(c)}</b>`).join('');
export const dist = d => (d < 1000 ? d + ' m' : (d / 1000).toFixed(1) + ' km') + ` · ≈${walkMin(d)} min`;
export const shown = a => a.cat !== 'primary' || a.d <= 2000;   // primaries beyond 2 km are kept only for per-block bands

// Amenities list: estate facilities (site plan), then nearby amenities by category
export function amenitiesHtml(P) {
  const by = {};
  (P.amenities || []).forEach((a, i) => shown(a) && (by[a.cat] ||= []).push([a, i]));
  const facNames = [...new Map((P.facilities || []).map(f => [f.n, f.name])).entries()].sort((a, b) => a[0] - b[0]);
  return (facNames.length ? `<div class="acat"><h4><i style="background:#1D2A2E">#</i>In this estate</h4>${facNames.map(([n, name]) => `<div class="aitem" data-f="${n}"><span>${n} · ${esc(name)}</span></div>`).join('')}</div>` : '') +
    Object.keys(ACAT).filter(k => by[k]).map(k => `<div class="acat"><h4><i style="background:${ACAT[k][1]}">${ACAT[k][2]}</i>${ACAT[k][0]}</h4>${by[k].map(([a, i]) =>
      `<div class="aitem" data-a="${i}"><span>${esc(a.name)}${lineChips(a)}${k === 'primary' ? `<span class="tag1k">${a.d <= 1000 ? '≤1 km' : '1–2 km'}</span>` : ''}</span><span>${dist(a.d)}</span></div>`).join('')}</div>`).join('') ||
    '<p class="note">No amenity data.</p>';
}
