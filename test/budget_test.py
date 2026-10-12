# Load-size budget: what the browser downloads for one project (Vercel serves these compressed; gzip is a fair proxy).
import gzip
from pathlib import Path

BUDGET_KB = {'project.json': 300, 'model.glb': 2048}
worst = {}
for d in Path('projects').iterdir():
    for name, kb in BUDGET_KB.items():
        f = d / name
        if f.exists():
            size = len(gzip.compress(f.read_bytes(), 6)) // 1024
            assert size <= kb, f'{f}: {size} KB gzipped > {kb} KB budget'
            worst[name] = max(worst.get(name, 0), size)
print('ok', {k: f'{v} KB (budget {BUDGET_KB[k]})' for k, v in worst.items()})
