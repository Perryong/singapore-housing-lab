# OSM2World surroundings (tools/build_osm3d.py): drop the OSM buildings we already draw ourselves.
import math
import xml.etree.ElementTree as ET
from tools.build_osm3d import drop_ours

LAT0, LON0 = 1.3, 103.8
P = {'site': {'lat': LAT0, 'lon': LON0},
     'context': [{'h': 30, 'p': [[-10, -10], [10, -10], [10, 10], [-10, 10]]}],
     'surround': [{'k': 'school', 'h': 12, 'p': [[200, -10], [220, -10], [220, 10], [200, 10]]},
                  {'k': 'bldg', 'h': 10, 'p': [[90, -10], [110, -10], [110, 10], [90, 10]]}]}


def osm(boxes):                                                   # [(id, x0, z0, x1, z1)] site-local metres -> OSM XML
    lat = lambda z: LAT0 - z / 110_574.0
    lon = lambda x: LON0 + x / (111_320.0 * math.cos(math.radians(LAT0)))
    nodes, ways = [], []
    for i, x0, z0, x1, z1 in boxes:
        ids = []
        for j, (x, z) in enumerate([(x0, z0), (x1, z0), (x1, z1), (x0, z1)]):
            nid = i * 10 + j; ids.append(nid)
            nodes.append(f'<node id="{nid}" lat="{lat(z)}" lon="{lon(x)}"/>')
        nds = ''.join(f'<nd ref="{n}"/>' for n in ids + ids[:1])
        ways.append(f'<way id="{i}">{nds}<tag k="building" v="yes"/></way>')
    return ET.fromstring(f'<osm version="0.6">{"".join(nodes)}{"".join(ways)}</osm>')


root = osm([(1, -5, -5, 5, 5),          # inside the HDB context block -> dropped
            (2, 205, -5, 215, 5),       # inside a school outline -> dropped (our coloured box stays)
            (3, 95, -5, 105, 5),        # inside a plain 'bldg' outline -> kept (OSM2World replaces those boxes)
            (4, 300, -5, 310, 5)])      # nothing of ours -> kept
assert drop_ours(root, P) == 2
tagged = {w.get('id') for w in root.iter('way') if any(t.get('k') == 'building' for t in w.iter('tag'))}
assert tagged == {'3', '4'}, tagged
assert drop_ours(osm([]), {'site': P['site']}) == 0             # a project with no context or surround
print('ok')

# the GLB's origin (scene extras written by OSM2World) as an offset in the site frame
import json, struct, tempfile
from pathlib import Path
from tools.build_osm3d import origin_offset


def glb(origin):
    j = json.dumps({'asset': {'version': '2.0'}, 'nodes': [{'name': 'OSM2World scene', 'extras': {'origin': origin}}]}).encode()
    j += b' ' * (-len(j) % 4)
    f = Path(tempfile.mkdtemp()) / 'o.glb'
    f.write_bytes(struct.pack('<III', 0x46546C67, 2, 20 + len(j)) + struct.pack('<II', len(j), 0x4E4F534A) + j)
    return f


assert origin_offset(glb({'lat': LAT0, 'lon': LON0, 'ele': 0}), P) == (0.0, 0.0)
ox, oz = origin_offset(glb({'lat': LAT0 - 0.001, 'lon': LON0, 'ele': 0}), P)   # origin 0.001 deg south of the site
assert ox == 0 and abs(oz - 110.574) < 1e-6, (ox, oz)
print('ok origin')

# project.json is marked only once the GLB exists (an Overpass or OSM2World failure leaves the page as it was)
from tools.build_osm3d import mark
d = Path(tempfile.mkdtemp()); (d / 'project.json').write_text(json.dumps({'id': 'x'}))
assert mark(d) is False and 'osm3d' not in json.loads((d / 'project.json').read_text())
(d / 'osm3d.glb').write_bytes(b'glb')
assert mark(d) is True and json.loads((d / 'project.json').read_text())['osm3d'] == {'r': 600}
print('ok mark')

# review fixes: the project's own stacks, other BTOs' boxes, building relations, partial Overpass answers, batch errors
from tools.build_osm3d import overpass_ok, main
stack = {'x': 400, 'z': 0, 'a': [1, 0], 'f': [0, 1], 'hx': 6, 'hz': 6}          # a 12 m square stack of this project
Pb = dict(P, surround=P['surround'] + [{'k': 'bto', 'h': 40, 'p': [[500, -10], [520, -10], [520, 10], [500, 10]]}])
root = osm([(5, 395, -3, 405, 3),        # OSM already maps this project's tower -> dropped (model.glb draws it)
            (6, 505, -5, 515, 5),        # another BTO we draw as a 'bto' box -> dropped
            (7, 600, -5, 610, 5)])       # nothing of ours -> kept
assert drop_ours(root, Pb, [stack]) == 2
tagged = {w.get('id') for w in root.iter('way') if any(t.get('k') == 'building' for t in w.iter('tag'))}
assert tagged == {'7'}, tagged

# a multipolygon building relation over an HDB block: the tag sits on the relation, not on its outer way
root = osm([(8, -5, -5, 5, 5)])
w8 = next(root.iter('way')); [w8.remove(t) for t in w8.findall('tag')]
root.append(ET.fromstring('<relation id="9"><member type="way" ref="8" role="outer"/>'
                          '<tag k="type" v="multipolygon"/><tag k="building" v="yes"/></relation>'))
assert drop_ours(root, P) == 1
assert not any(t.get('k') == 'building' for t in root.find('relation').iter('tag'))

# Overpass can answer 200 with partial data and a runtime-error remark: never cache that
assert overpass_ok(b'<?xml version="1.0"?><osm></osm>')
assert not overpass_ok(b'<?xml version="1.0"?><osm><remark> runtime error: Query timed out </remark></osm>')
assert not overpass_ok(b'{"elements": []}')

# one failing project doesn't stop the batch, and the exit code says something failed
assert main([str(Path(tempfile.mkdtemp()) / 'missing'), str(Path(tempfile.mkdtemp()) / 'missing2')]) == 2
print('ok review fixes')

# a tower's centre sits in the corridor between its stacks: match against the whole block (hull of its stacks)
two = [dict(stack, no=1, x=700), dict(stack, no=2, x=730)]                    # one block, stacks 30 m apart
Pblk = dict(P, stacks=[{'no': 1, 'block': '1A'}, {'no': 2, 'block': '1A'}])
root = osm([(10, 705, -4, 725, 4)])                                           # mapped tower centred at x=715, between them
assert drop_ours(root, Pblk, two) == 1
print('ok block hull')
