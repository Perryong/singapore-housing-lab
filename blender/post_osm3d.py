"""Crop an OSM2World GLB to the site, shift it into the site frame, drop ground areas, join per material, Draco export.

usage: blender -b --factory-startup -P blender/post_osm3d.py -- in.glb out.glb ox oz R
(ox, oz: OSM2World's origin in the site's three.js frame, +x east, -z north; R: keep objects whose centre is within R m)
Ground areas (earth, grass, scrub, paving, water, pitches) are dropped: OneMap's tiles already show them, and OSM2World's
versions paint large brown/red patches. Roads, kerbs, markings, buildings and roofs are kept.
"""
import collections, math, re, sys
import bpy

a = sys.argv[sys.argv.index('--') + 1:]
src, dst, ox, oz, R = a[0], a[1], float(a[2]), float(a[3]), float(a[4])
GROUND = re.compile(r'EARTH|GRASS|SCRUB|PAVING_STONE|WATER|pitch|clay|TENNIS_NET|SAND|GRAVEL', re.I)

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
keep = collections.defaultdict(list)
for ob in list(bpy.data.objects):
    mat = ob.data.materials[0].name if ob.type == 'MESH' and ob.data.materials else ''
    vs = [ob.matrix_world @ v.co for v in ob.data.vertices] if ob.type == 'MESH' else []
    # Blender is Z-up: a three.js point (x, y, z) is (x, -z, y) here
    far = not vs or math.hypot(sum(v.x for v in vs) / len(vs) + ox, sum(v.y for v in vs) / len(vs) - oz) > R
    if ob.type != 'MESH' or far or GROUND.search(mat):
        bpy.data.objects.remove(ob)
    else:
        keep[mat].append(ob)

for mat, obs in keep.items():
    bpy.ops.object.select_all(action='DESELECT')
    for o in obs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = obs[0]
    if len(obs) > 1:
        bpy.ops.object.join()
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    j = bpy.context.view_layer.objects.active
    j.location = (ox, -oz, 0)
    bpy.ops.object.transform_apply(location=True)
    j.name = mat or 'mesh'

print('osm3d:', {m: len(o) for m, o in keep.items()})
# images in their own format: WEBP conversion left one texture without a source, which three.js cannot load
bpy.ops.export_scene.gltf(filepath=dst, export_format='GLB', export_draco_mesh_compression_enable=True,
                          export_draco_mesh_compression_level=7, export_image_format='AUTO')
