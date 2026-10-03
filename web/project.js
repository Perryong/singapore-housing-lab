// project.json (plan pixels) -> world-space layout. Pure: runs in the browser and in Node.
// World axes match three.js: +x east, +y up, -z north.
export const deg = Math.PI / 180;
export const bdir = b => [Math.sin(b * deg), -Math.cos(b * deg)];

export function plan2world(P, px, py) {
  const { pxPerM, upBearing, origin: [ox, oy] } = P.plan;
  const lx = (px - ox) / pxPerM, lz = (py - oy) / pxPerM, c = Math.cos(upBearing * deg), s = Math.sin(upBearing * deg);
  return [lx * c - lz * s, lx * s + lz * c];
}

// category = longest category key that prefixes the unit code ('BPS4' -> 'BPS', '2RF1' -> '2RF', 'CP1p' -> 'CP')
export const catOf = (P, code) => Object.keys(P.categories).filter(k => code.startsWith(k)).sort((a, b) => b.length - a.length)[0];
export const sizeOf = (P, code) => {
  const o = Object.entries(P.sizeOverrides || {}).find(([k]) => code.startsWith(k));
  return o ? o[1] : P.categories[catOf(P, code)].size;
};

export function buildLayout(P) {
  const FH = P.site.floorHeight, stacks = [], units = [], boxes = [], cores = [];
  for (const s of P.stacks) {
    const B = P.blocks[s.block], [x, z] = plan2world(P, s.px, s.py), corner = s.faces.length > 1;
    // traced BTO stacks carry their own orientation and size; Thomson Reserve uses block axis + standard sizes
    const axis = s.axis ?? B.axis, [hx, hz] = s.size || P.stackSize[corner ? 'corner' : 'normal'];
    const floors = s.floors || B.floors;
    const [ax, az] = bdir(axis), [fx, fz] = bdir(axis + 90);
    // facade sample points just outside the box in each window direction
    const fp = s.faces.map(b => {
      const [nx, nz] = bdir(b), d = hx * Math.abs(nx * ax + nz * az) + hz * Math.abs(nx * fx + nz * fz) + 0.5;
      return { b, nx, nz, px: x + nx * d, pz: z + nz * d };
    });
    const st = { no: s.no, blk: s.block, x, z, faces: s.faces, axis, ax, az, fx, fz, hx, hz,
      floors, first: s.first, type: s.type, collection: B.collection, fp, units: [] };
    stacks.push(st);
    boxes.push({ own: s.no, blk: s.block, cx: x, cz: z, ax, az, fx, fz, hx, hz, H: floors * FH + 1.5 });
    for (let f = s.first; f <= floors; f++) {
      const u = { id: units.length, st, floor: f, code: s.type + (P.lowestFloorSuffix && f === s.first && s.first < 3 ? P.lowestFloorSuffix : ''), y: (f - 1) * FH + FH / 2 };
      units.push(u); st.units.push(u);
    }
  }
  for (const [blk, B] of Object.entries(P.blocks)) {
    if (!B.centre) continue;   // traced BTO blocks: units shade each other directly, no separate core box
    const [cx, cz] = plan2world(P, ...B.centre), [ax, az] = bdir(B.axis), [fx, fz] = bdir(B.axis + 90);
    const proj = stacks.filter(s => s.blk == blk).map(s => (s.x - cx) * ax + (s.z - cz) * az);
    const hx = (Math.max(...proj) - Math.min(...proj)) * 0.3, hz = 4;
    cores.push({ blk: +blk, cx, cz, ax, az, fx, fz, hx, hz, floors: B.floors, H: B.floors * FH + 3 });
    boxes.push({ own: -1, blk: +blk, cx, cz, ax, az, fx, fz, hx, hz, H: B.floors * FH + 4 });
  }
  const context = P.context.map(b => {
    const xs = b.p.map(q => q[0]), zs = b.p.map(q => q[1]);
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cz = (Math.min(...zs) + Math.max(...zs)) / 2;
    return { h: b.h, p: b.p, cx, cz, r: Math.max(...b.p.map(q => Math.hypot(q[0] - cx, q[1] - cz))) };
  });
  return { FH, stacks, units, boxes, cores, context };
}
