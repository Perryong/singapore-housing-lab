"""One stack's flat as a dollhouse GLB, from tools/extract_plan3d.py's JSON.

usage: blender -b --factory-startup -P blender/build_plan3d.py -- <plan.json> <out.glb>

Plan coordinates are metres, x right and z down the brochure page. Blender is Z-up, so a plan point (x, z) is
written as (x, -z, height); the glTF exporter turns that into three.js (x, height, z).
Walls: one mesh `walls` (window walls as sill and head pieces around the opening). Floors: one mesh per room,
named `room:<type>:<i>`, material by room type.
"""
import json, sys
from pathlib import Path

import bmesh
import bpy

SRC, OUT = (Path(a) for a in sys.argv[sys.argv.index('--') + 1:][:2])
J = json.loads(SRC.read_text())

WALL_H, SILL, HEAD, SLAB, MIN_T = 2.8, 1.0, 2.1, 0.05, 0.08
COLOURS = {   # muted but distinct, readable from above
    'bedroom': (0.55, 0.70, 0.90), 'living': (0.95, 0.80, 0.50), 'kitchen': (0.92, 0.62, 0.48),
    'bath': (0.50, 0.80, 0.80), 'yard': (0.72, 0.72, 0.66), 'shelter': (0.55, 0.55, 0.60),
    'ledge': (0.80, 0.80, 0.78), 'other': (0.84, 0.80, 0.72)}
WALL = (0.95, 0.94, 0.91)


def material(name, rgb, rough=0.9):
    m = bpy.data.materials.new(name)
    bsdf = next(n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
    bsdf.inputs['Base Color'].default_value = (*rgb, 1)
    bsdf.inputs['Roughness'].default_value = rough
    return m


def box(bm, x0, z0, x1, z1, h0, h1):
    if x1 - x0 < MIN_T:
        c = (x0 + x1) / 2; x0, x1 = c - MIN_T / 2, c + MIN_T / 2
    if z1 - z0 < MIN_T:
        c = (z0 + z1) / 2; z0, z1 = c - MIN_T / 2, c + MIN_T / 2
    v = [bm.verts.new((x, -z, h)) for h in (h0, h1) for x, z in ((x0, z0), (x1, z0), (x1, z1), (x0, z1))]
    for f in ((0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)):
        bm.faces.new([v[i] for i in f])


def obj(name, bm, mat):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me); bm.free()
    me.materials.append(mat)
    o = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(o)
    return o


bpy.ops.wm.read_factory_settings(use_empty=True)

bm = bmesh.new()
for w in J['walls']:
    x0, z0, x1, z1 = w['rect']
    if w['kind'] == 'window':
        box(bm, x0, z0, x1, z1, 0, SILL); box(bm, x0, z0, x1, z1, HEAD, WALL_H)
    else:
        box(bm, x0, z0, x1, z1, 0, WALL_H)
obj('walls', bm, material('wall', WALL, 0.95))

mats = {t: material(f'floor-{t}', c) for t, c in COLOURS.items()}
for i, r in enumerate(J['rooms']):
    bm = bmesh.new()
    top = [bm.verts.new((x, -z, SLAB)) for x, z in r['poly']]
    try:
        face = bm.faces.new(top)
    except ValueError:                                     # degenerate outline: skip this floor
        bm.free(); continue
    if face.normal.z < 0:
        face.normal_flip()
    bmesh.ops.extrude_face_region(bm, geom=[face])
    for v in bm.verts:
        if v not in top:
            v.co.z = 0
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    obj(f"room:{r['type']}:{i}", bm, mats.get(r['type'], mats['other']))

OUT.parent.mkdir(parents=True, exist_ok=True)
bpy.ops.export_scene.gltf(filepath=str(OUT), export_format='GLB', export_apply=False, export_yup=True)
print(f'wrote {OUT} ({OUT.stat().st_size // 1024} KB), walls {len(J["walls"])}, rooms {len(J["rooms"])}')
