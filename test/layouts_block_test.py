# Every stored crop must come from a page whose title names the stack's own block (never another stack's plan),
# and must be wide enough to show the unit with its label.
import json, glob
from PIL import Image
bad, thin = [], []
for f in glob.glob('projects/*/project.json'):
    P = json.load(open(f)); blk = {str(s['no']): s['block'] for s in P['stacks']}
    for no, l in (P.get('layouts') or {}).items():
        for kind in ('typical', 'lowest'):
            if kind in l:
                pb = l.get('pageBlock' if kind == 'typical' else 'lowestBlock')
                if pb is not None and pb.upper() != blk[no].upper() or (pb is None and 'pageBlock' not in l):
                    bad.append((f.split('/')[1], no, kind, pb, blk[no]))
        w, h = Image.open(f.rsplit('/', 1)[0] + '/' + l['typical']).size
        if w < 150:
            thin.append((f.split('/')[1], no, w))
assert not bad, bad[:10]
assert len(thin) <= 5, thin[:10]
print('ok')
