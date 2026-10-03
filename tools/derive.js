// projects/<id>/project.json -> projects/<id>/layout.json (world-space input for blender/build_model.py)
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildLayout } from '../web/project.js';

const dir = process.argv[2];
const P = JSON.parse(readFileSync(join(dir, 'project.json')));
const L = buildLayout(P);
const r = v => Math.round(v * 1000) / 1000;
const out = {
  FH: L.FH,
  stacks: L.stacks.map(s => ({ no: s.no, x: r(s.x), z: r(s.z), a: [r(s.ax), r(s.az)], f: [r(s.fx), r(s.fz)], hx: s.hx, hz: s.hz,
    floors: s.floors, first: s.first, faces: s.fp.map(p => [r(p.nx), r(p.nz)]), unit0: s.units[0].id })),
  cores: L.cores.map(c => ({ x: r(c.cx), z: r(c.cz), a: [r(c.ax), r(c.az)], f: [r(c.fx), r(c.fz)], hx: r(c.hx), hz: c.hz, H: c.H })),
  context: L.context.map(c => ({ h: c.h, p: c.p })),
};
writeFileSync(join(dir, 'layout.json'), JSON.stringify(out));
console.log(`layout: ${out.stacks.length} stacks, ${L.units.length} units, ${out.cores.length} cores, ${out.context.length} context`);
