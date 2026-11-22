"""Detailed 3D surroundings from OSM2World: roads, non-HDB buildings and roofs within R metres of the site.

usage: python3 tools/build_osm3d.py projects/<id>...   -> projects/<id>/osm3d.glb, project.json["osm3d"] = {"r": R}

Needs Java 17+ (brew install openjdk) and the OSM2World "latest" build unpacked at tools/osm2world/latest/
(https://osm2world.org/download/files/latest/OSM2World-latest-bin.zip; 0.4.0 writes 100x larger files), plus Blender.
Buildings we draw ourselves (HDB context blocks, coloured amenity boxes) are dropped from the OSM data first; the GLB is
cropped, shifted to the site frame, stripped of ground areas and Draco-compressed by blender/post_osm3d.py.
"""
import json, math, struct, subprocess, sys, tempfile, time
import xml.etree.ElementTree as ET
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / 'tools'))
from fetch_context import local_xz          # noqa: E402
from fetch_surround import inside           # noqa: E402

R = 600
O2W = ROOT / 'tools/osm2world/latest'
JVM = ['-Xmx6G', '--add-exports', 'java.base/java.lang=ALL-UNNAMED', '--add-exports', 'java.desktop/sun.awt=ALL-UNNAMED',
       '--add-exports', 'java.desktop/sun.java2d=ALL-UNNAMED']


def hull(pts):
    """Convex hull (monotone chain) of [x, z] points."""
    pts = sorted(map(tuple, pts))
    cross = lambda o, a, b: (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
    def half(ps):
        h = []
        for q in ps:
            while len(h) >= 2 and cross(h[-2], h[-1], q) <= 0:
                h.pop()
            h.append(q)
        return h[:-1]
    return [list(q) for q in half(pts) + half(pts[::-1])]


def ours(P, stacks=()):
    """Outlines (site-local metres) of the buildings the app already draws: this project's stacks (layout.json, drawn by
    model.glb), HDB context blocks, and every surround box except plain 'bldg' ones (those OSM2World replaces)."""
    rect = lambda s: [[s['x'] + i * s['a'][0] * s['hx'] + j * s['f'][0] * s['hz'], s['z'] + i * s['a'][1] * s['hx'] + j * s['f'][1] * s['hz']]
                      for i, j in ((-1, -1), (1, -1), (1, 1), (-1, 1))]
    blk = {s['no']: s['block'] for s in P.get('stacks', [])}
    blocks = {}                                                    # a mapped tower's centre is often between its stacks
    for s in stacks:
        blocks.setdefault(blk.get(s.get('no'), s.get('no')), []).extend(rect(s))
    return ([hull(c) for c in blocks.values()] + [c['p'] for c in P.get('context', [])] +
            [s['p'] for s in P.get('surround', []) if s['k'] != 'bldg' and s['h'] > 0.2])


def drop_ours(root, P, stacks=()):
    """Remove the building tags of ways and relations whose centroid lies inside one of ours(P, stacks); returns how many.
    A relation's centroid is that of its outer ways' nodes."""
    lat0, lon0 = P['site']['lat'], P['site']['lon']
    nodes = {n.get('id'): local_xz(lat0, lon0, float(n.get('lon')), float(n.get('lat'))) for n in root.iter('node')}
    ways = {w.get('id'): [nodes[nd.get('ref')] for nd in w.findall('nd') if nd.get('ref') in nodes] for w in root.iter('way')}
    polys, n = ours(P, stacks), 0
    for el in [*root.iter('way'), *root.iter('relation')]:
        tags = [t for t in el.findall('tag') if t.get('k') in ('building', 'building:part')]
        pts = ways[el.get('id')] if el.tag == 'way' else \
            [q for m in el.findall('member') if m.get('type') == 'way' and m.get('role') == 'outer' for q in ways.get(m.get('ref'), [])]
        if not tags or len(pts) < 3:
            continue
        cx, cz = sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts)
        if any(inside(cx, cz, p) for p in polys):
            for t in tags:
                el.remove(t)
            n += 1
    return n


def overpass_ok(body):
    """A complete Overpass XML answer; a timeout or out-of-memory still answers 200, with partial data and a <remark>."""
    return body.lstrip().startswith(b'<?xml') and b'<remark>' not in body


def fetch(P):
    """Everything within R of the site as OSM XML, cached at reference/amenities/osm3d-<id>.osm."""
    path = ROOT / f"reference/amenities/osm3d-{P['id']}.osm"
    if path.exists():
        return path
    lat, lon = P['site']['lat'], P['site']['lon']
    a = f'around:{R},{lat},{lon}'
    # route/boundary relations would drag in the whole island, so only area relations
    q = f'[out:xml][timeout:120];(node({a});way({a});rel({a})[type~"^(multipolygon|building)$"];);(._;>;);out meta qt;'
    for t in range(6):                                             # public Overpass servers are often busy: retry, alternate
        time.sleep(20 * t)
        url = ('https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter')[t % 2]
        r = subprocess.run(['curl', '-sf', '--max-time', '180', '-A', 'BTOlab/1.0 (personal project)', url,
                            '--data-urlencode', f'data={q}'], capture_output=True)
        if r.returncode == 0 and overpass_ok(r.stdout):
            path.write_bytes(r.stdout)
            return path
    raise SystemExit('Overpass unavailable; try again later')


def origin_offset(glb, P):
    """Where OSM2World's origin (first node's extras.origin, lat/lon) sits in the site frame, as (x, z) metres."""
    with open(glb, 'rb') as f:
        f.read(12)
        n, _ = struct.unpack('<II', f.read(8))
        o = json.loads(f.read(n))['nodes'][0]['extras']['origin']
    return local_xz(P['site']['lat'], P['site']['lon'], o['lon'], o['lat'])


def mark(d):
    """Record in project.json that d/osm3d.glb exists (the app then drops its own boxes within R); False if it doesn't."""
    if not (d / 'osm3d.glb').exists():
        return False
    f = d / 'project.json'
    P = json.loads(f.read_text())
    P['osm3d'] = {'r': R}
    f.write_text(json.dumps(P, separators=(',', ':')))
    return True


def build(d):
    P = json.loads((d / 'project.json').read_text())
    if not (O2W / 'OSM2World.jar').exists():
        raise SystemExit(f'OSM2World missing: unpack OSM2World-latest-bin.zip at {O2W} (see this file\'s docstring)')
    cfg = O2W / 'btolab.properties'                                # texture paths resolve relative to the config file
    if not cfg.exists():
        cfg.write_text('include = standard.properties\ncreateTerrain = false\n')
    tree = ET.parse(fetch(P))
    L = d / 'layout.json'
    dropped = drop_ours(tree.getroot(), P, json.loads(L.read_text())['stacks'] if L.exists() else ())
    with tempfile.TemporaryDirectory() as tmp:
        osm, raw = Path(tmp) / 'in.osm', Path(tmp) / 'raw.glb'
        tree.write(osm, encoding='utf-8', xml_declaration=True)
        java = '/opt/homebrew/opt/openjdk/bin/java' if Path('/opt/homebrew/opt/openjdk/bin/java').exists() else 'java'
        subprocess.run([java, *JVM, '-jar', 'OSM2World.jar', '--config', cfg.name, '-i', str(osm), '-o', str(raw), '--lod', '2'],
                       cwd=O2W, check=True, capture_output=True)   # it logs per-object errors and still writes the file
        ox, oz = origin_offset(raw, P)
        # --python-exit-code: blender otherwise exits 0 when the script raises, and the old GLB would look fresh
        r = subprocess.run(['blender', '-b', '--factory-startup', '--python-exit-code', '1', '-P', str(ROOT / 'blender/post_osm3d.py'),
                            '--', str(raw), str(d / 'osm3d.glb'), str(ox), str(oz), str(R)], capture_output=True, text=True)
        if r.returncode:
            raise RuntimeError('blender/post_osm3d.py failed:\n' + r.stdout[-2000:] + r.stderr[-2000:])
    mark(d)
    print(f"{P['id']}: dropped {dropped} of our buildings, osm3d.glb {(d / 'osm3d.glb').stat().st_size // 1024} KB")


def main(dirs):
    """Build each project; a failure is reported and the rest still run. Returns the number that failed."""
    failed = 0
    for a in dirs:
        try:
            build(Path(a))
        except (Exception, SystemExit) as e:
            failed += 1
            print(f'{a}: FAILED {e}', file=sys.stderr)
    return failed


if __name__ == '__main__':
    sys.exit(1 if main(sys.argv[1:]) else 0)
