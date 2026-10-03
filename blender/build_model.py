"""Generate the architectural study model from layout.json and export model.glb.

usage: blender -b --factory-startup -P blender/build_model.py -- projects/<id>

Layout coordinates are three.js world space (+x east, +y up, -z north). Blender is Z-up, so a
world point (x, y, z) is written as (x, -z, y); the glTF exporter converts it back to Y-up.
Every vertex of the coloured unit bodies and balustrades carries a `_UNIT` attribute (index into the web app's
units array) so the browser can recolour units without one mesh per unit.
"""
import json, sys
from pathlib import Path

import bmesh
import bpy

DIR = Path(sys.argv[sys.argv.index('--') + 1])
L = json.loads((DIR / 'layout.json').read_text())
FH = L['FH']

BALCONY = 1.4      # slab overhang on window sides (m)
RAIL_H = 1.1       # balustrade height (coloured with its unit)
FIN_EVERY = 4.5    # vertical fin spacing on window faces
SLAB_T = 0.28


class MeshBuf:
    def __init__(self):
        self.v, self.f, self.unit = [], [], []

    def box(self, o, a, f, amin, amax, fmin, fmax, y0, y1, uid=-1):
        """Box in a local frame: origin o=(x,z), along-axis a, across-axis f (unit 2D vectors, world xz)."""
        base = len(self.v)
        for y in (y0, y1):
            for sa, sf in ((amin, fmin), (amax, fmin), (amax, fmax), (amin, fmax)):
                x = o[0] + a[0] * sa + f[0] * sf
                z = o[1] + a[1] * sa + f[1] * sf
                self.v.append((x, -z, y))
                self.unit.append(uid)
        b = base
        self.f += [(b, b + 3, b + 2, b + 1), (b + 4, b + 5, b + 6, b + 7),
                   (b, b + 1, b + 5, b + 4), (b + 1, b + 2, b + 6, b + 5),
                   (b + 2, b + 3, b + 7, b + 6), (b + 3, b, b + 4, b + 7)]

    def prism(self, pts, h):
        """Vertical extrusion of a world-xz polygon from 0 to h."""
        base, n = len(self.v), len(pts)
        for y in (0, h):
            for x, z in pts:
                self.v.append((x, -z, y))
                self.unit.append(-1)
        self.f.append(tuple(range(base + n - 1, base - 1, -1)))
        self.f.append(tuple(range(base + n, base + 2 * n)))
        for i in range(n):
            j = (i + 1) % n
            self.f.append((base + i, base + j, base + n + j, base + n + i))

    def to_object(self, name, mat):
        me = bpy.data.meshes.new(name)
        me.from_pydata(self.v, [], self.f)
        if any(u >= 0 for u in self.unit):
            attr = me.attributes.new('_UNIT', 'FLOAT', 'POINT')
            attr.data.foreach_set('value', [float(u) for u in self.unit])
        bm = bmesh.new()
        bm.from_mesh(me)
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        bm.to_mesh(me)
        bm.free()
        me.materials.append(mat)
        ob = bpy.data.objects.new(name, me)
        bpy.context.scene.collection.objects.link(ob)
        return ob


def material(name, rgb, rough=0.85):
    m = bpy.data.materials.new(name)
    bsdf = next(n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
    bsdf.inputs['Base Color'].default_value = (*rgb, 1)
    bsdf.inputs['Roughness'].default_value = rough
    return m


bpy.ops.wm.read_factory_settings(use_empty=True)
units, detail, core, ctx = MeshBuf(), MeshBuf(), MeshBuf(), MeshBuf()

for s in L['stacks']:
    o, a, f, hx, hz = (s['x'], s['z']), s['a'], s['f'], s['hx'], s['hz']
    # which sides of the stack box carry windows: (+a, -a, +f, -f)
    sides = set()
    for nx, nz in s['faces']:
        da, df = nx * a[0] + nz * a[1], nx * f[0] + nz * f[1]
        sides.add(('a', 1 if da > 0 else -1) if abs(da) > abs(df) else ('f', 1 if df > 0 else -1))
    ext = {k: (BALCONY if k in sides else 0) for k in (('a', 1), ('a', -1), ('f', 1), ('f', -1))}
    amin, amax = -hx - ext[('a', -1)], hx + ext[('a', 1)]
    fmin, fmax = -hz - ext[('f', -1)], hz + ext[('f', 1)]
    top = s['floors'] * FH
    bottom = (s['first'] - 1) * FH

    for i, fl in enumerate(range(s['first'], s['floors'] + 1)):
        y0 = (fl - 1) * FH
        uid = s['unit0'] + i
        # coloured unit body, set back from the slab edge
        units.box(o, a, f, -hx + 0.25, hx - 0.25, -hz + 0.25, hz - 0.25, y0 + SLAB_T, y0 + FH, uid)
        # floor slab incl. balcony overhang
        detail.box(o, a, f, amin, amax, fmin, fmax, y0, y0 + SLAB_T)
        # solid balustrade along the balcony edge, part of the unit so the sun colour reads from outside
        for axis, sign in sides:
            if axis == 'a':
                e = amax if sign > 0 else amin
                units.box(o, a, f, e - 0.12, e, fmin, fmax, y0 + SLAB_T, y0 + SLAB_T + RAIL_H, uid)
            else:
                e = fmax if sign > 0 else fmin
                units.box(o, a, f, amin, amax, e - 0.12, e, y0 + SLAB_T, y0 + SLAB_T + RAIL_H, uid)

    # vertical fins on window faces, full height of the stack
    for axis, sign in sides:
        span = hz if axis == 'a' else hx
        n = max(1, int(2 * span // FIN_EVERY))
        for k in range(n + 1):
            t = -span + 2 * span * k / n
            if axis == 'a':
                e = hx if sign > 0 else -hx
                lo, hi = sorted((e, e + sign * BALCONY))
                detail.box(o, a, f, lo, hi, t - 0.08, t + 0.08, bottom, top)
            else:
                e = hz if sign > 0 else -hz
                lo, hi = sorted((e, e + sign * BALCONY))
                detail.box(o, a, f, t - 0.08, t + 0.08, lo, hi, bottom, top)

    # roof slab + parapet
    detail.box(o, a, f, amin, amax, fmin, fmax, top, top + 0.4)
    for lo_a, hi_a, lo_f, hi_f in ((amin, amax, fmin, fmin + 0.2), (amin, amax, fmax - 0.2, fmax),
                                   (amin, amin + 0.2, fmin, fmax), (amax - 0.2, amax, fmin, fmax)):
        detail.box(o, a, f, lo_a, hi_a, lo_f, hi_f, top + 0.4, top + 1.5)
    # pilotis: transfer slab and columns under the first residential floor
    if bottom > 0:
        detail.box(o, a, f, -hx, hx, -hz, hz, bottom - 0.6, bottom)
        for ca in (-hx + 0.6, hx - 0.6):
            for cf in (-hz + 0.6, hz - 0.6):
                core.box(o, a, f, ca - 0.4, ca + 0.4, cf - 0.4, cf + 0.4, 0, bottom - 0.6)

for c in L['cores']:
    o, a, f = (c['x'], c['z']), c['a'], c['f']
    core.box(o, a, f, -c['hx'], c['hx'], -c['hz'], c['hz'], 0, c['H'])
    # lift motor room and crown frame
    core.box(o, a, f, -c['hx'] * 0.5, c['hx'] * 0.5, -c['hz'] * 0.7, c['hz'] * 0.7, c['H'], c['H'] + 4)
    for sa in (-1, 1):
        core.box(o, a, f, sa * c['hx'] - 0.3, sa * c['hx'] + 0.3, -c['hz'] - 1, c['hz'] + 1, c['H'] - 2, c['H'] + 6)
    core.box(o, a, f, -c['hx'] - 0.3, c['hx'] + 0.3, -c['hz'] - 1, c['hz'] + 1, c['H'] + 5.4, c['H'] + 6)

for b in L['context']:
    pts = []
    for p in b['p']:
        if not pts or abs(p[0] - pts[-1][0]) + abs(p[1] - pts[-1][1]) > 0.05:
            pts.append(tuple(p))
    if len(pts) > 2 and abs(pts[0][0] - pts[-1][0]) + abs(pts[0][1] - pts[-1][1]) < 0.05:
        pts.pop()
    if len(pts) >= 3:
        ctx.prism(pts, b['h'])

units.to_object('Units', material('Unit', (0.92, 0.93, 0.91)))
detail.to_object('Detail', material('Slab', (0.97, 0.97, 0.95)))
core.to_object('Core', material('Core', (0.74, 0.76, 0.73)))
ctx.to_object('Context', material('HDB', (0.62, 0.66, 0.64), 0.95))

out = DIR / 'model.glb'
bpy.ops.export_scene.gltf(filepath=str(out), export_format='GLB', export_attributes=True,
                          export_apply=False, export_yup=True)
print(f'wrote {out} ({out.stat().st_size // 1024} KB), verts: units={len(units.v)} detail={len(detail.v)} '
      f'core={len(core.v)} context={len(ctx.v)}')
