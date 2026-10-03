// usage: node tools/build.js projects/<id> [...]   -> projects/<id>/model.glb   (no args: every assembled project)
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dirs = process.argv.slice(2).length ? process.argv.slice(2).map(d => resolve(d))
  : readdirSync(join(ROOT, 'projects')).map(d => join(ROOT, 'projects', d))
    .filter(d => existsSync(join(d, 'project.json')) && JSON.parse(readFileSync(join(d, 'project.json'))).status);
for (const dir of dirs) {
  execFileSync('node', [join(ROOT, 'tools/derive.js'), dir], { stdio: 'inherit' });
  const out = execFileSync('blender', ['-b', '--factory-startup', '-P', join(ROOT, 'blender/build_model.py'), '--', dir], { encoding: 'utf8' });
  console.log(out.split('\n').find(l => l.startsWith('wrote')) || out.slice(-2000));
}
