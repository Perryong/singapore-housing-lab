// 3D floor plans for projects: extract each stack's plan (tools/extract_plan3d.py), build its GLB with Blender
// (blender/build_plan3d.py), and list the stacks that have one in project.json["plans3d"].
// usage: node tools/build_plan3d.js projects/<id>...
import { execFile, execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);
const JOBS = 4;                                                  // parallel Blender processes

for (const dir of process.argv.slice(2)) {
  const slug = basename(dir);
  console.log(execFileSync('python3', ['tools/extract_plan3d.py', slug], { env: { ...process.env, PYTHONPATH: '.' } }).toString().trim());
  const pd = join(dir, 'plans3d');
  const todo = readdirSync(pd).filter(f => f.endsWith('.json')).map(f => join(pd, f))
    .filter(j => { const g = j.replace(/\.json$/, '.glb'); return !existsSync(g) || statSync(g).mtimeMs < statSync(j).mtimeMs; });
  let i = 0, failed = 0;
  await Promise.all(Array.from({ length: JOBS }, async () => {
    while (i < todo.length) {
      const j = todo[i++];
      const g = j.replace(/\.json$/, '.glb');
      await run('blender', ['-b', '--factory-startup', '-P', 'blender/build_plan3d.py', '--', j, g]).catch(() => {});
      if (!existsSync(g)) { failed++; console.log(`  blender failed: ${j}`); }   // Blender exits 0 on script errors
    }
  }));
  for (const g of readdirSync(pd).filter(f => f.endsWith('.glb')))         // GLB without its JSON is stale
    if (!existsSync(join(pd, g.replace(/\.glb$/, '.json')))) execFileSync('rm', [join(pd, g)]);
  const have = readdirSync(pd).filter(f => f.endsWith('.glb')).map(f => f.replace(/\.glb$/, ''))
    .sort((a, b) => parseInt(a) - parseInt(b));
  const f = join(dir, 'project.json'), P = JSON.parse(readFileSync(f));
  P.plans3d = have;
  writeFileSync(f, JSON.stringify(P));
  console.log(`  ${slug}: ${have.length} GLBs (built ${todo.length - failed}, failed ${failed})`);
}
