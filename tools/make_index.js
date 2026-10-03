// projects/*/project.json -> projects/index.json (the picker's catalogue)
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = join(resolve(dirname(fileURLToPath(import.meta.url)), '..'), 'projects');
const ORDER = { upcoming: 0, launched: 1, reference: 2 };
const month = s => { const d = Date.parse('1 ' + s); return isNaN(d) ? 0 : d; };
const list = readdirSync(DIR).filter(d => existsSync(join(DIR, d, 'project.json')))
  .map(d => [d, JSON.parse(readFileSync(join(DIR, d, 'project.json')))])
  .filter(([, P]) => P.status && P.status !== 'reference')   // unassembled projects and the condo reference stay out
  .map(([d, P]) => {
  const types = P.flatTypes || Object.values(P.categories || {}).filter(c => !/Rental/.test(c.name)).map(c => c.name);
  return { id: d, name: P.name, town: P.town || '', launch: P.launch, status: P.status, kind: P.kind,
    classification: P.classification || null, units: P.units || P.stacks.length, flatTypes: types,
    hasLayout: P.stacks.length > 0 && existsSync(join(DIR, d, 'model.glb')) };
}).sort((a, b) => ORDER[a.status] - ORDER[b.status] || month(b.launch) - month(a.launch) || a.name.localeCompare(b.name));
writeFileSync(join(DIR, 'index.json'), JSON.stringify(list, null, 1));
console.log(`${list.length} projects: ` + Object.entries(Object.groupBy(list, p => p.status)).map(([k, v]) => `${k} ${v.length}`).join(', '));
