// Seed Firestore with the RAG chatbot's data (#33): `projects` (facts for get_project/list_projects)
// and `chunks` (README/docs + HDB PDFs already in the repo, for search_*_docs).
// Usage: GOOGLE_APPLICATION_CREDENTIALS=<firebase login ADC json> node tools/firestore_seed.mjs [--dry]
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const root = new URL('..', import.meta.url).pathname;
const PROJECT = process.env.FIREBASE_PROJECT || 'bto-lab';
const DOCS = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents`;

// chatbot-facing fields; geometry (surround, context, blockers, stacks, resale) is too big and not needed
const KEEP = ['name', 'kind', 'status', 'launch', 'town', 'classification', 'address', 'units', 'tagline', 'notes',
  'brochure', 'prices', 'categories', 'value', 'commute', 'amenities', 'facilities', 'layouts', 'resaleComparables'];

const nestedArray = v => Array.isArray(v) ? v.some(x => Array.isArray(x) || nestedArray(x))
  : v && typeof v === 'object' ? Object.values(v).some(nestedArray) : false;

// JS value -> Firestore REST Value
export function toValue(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (typeof v === 'string') return { stringValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(toValue) } };
  return { mapValue: { fields: toFields(v) } };
}
export const toFields = o => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined).map(([k, v]) => [k, toValue(v)]));

export function slimProject(p, idx = {}) {
  const out = { id: p.id, flatTypes: idx.flatTypes ?? null, cmp: idx.cmp ?? null };
  for (const k of KEEP) if (k in p)  // Firestore rejects arrays directly inside arrays, so those fields go in as JSON text
    out[k] = nestedArray(p[k]) ? JSON.stringify(p[k]) : p[k];
  return out;
}

// paragraphs packed into chunks of <= max chars; an over-long paragraph is cut at a space
export function chunkText(text, max = 1200) {
  const out = []; let cur = '';
  for (let para of text.split(/\n\s*\n/).map(s => s.replace(/\s+/g, ' ').trim()).filter(Boolean)) {
    while (para.length > max) {
      if (cur) { out.push(cur); cur = ''; }
      const sp = para.lastIndexOf(' ', max), k = sp > max / 2 ? sp : max;
      out.push(para.slice(0, k)); para = para.slice(k).trimStart();
    }
    if (cur && cur.length + para.length + 1 > max) { out.push(cur); cur = ''; }
    cur = cur ? cur + '\n' + para : para;
  }
  if (cur) out.push(cur);
  return out;
}

// markdown -> chunks per heading section, so each chunk can cite its section
export function chunkMarkdown(md, max) {
  const out = []; let section = '', buf = [];
  const flush = () => { for (const t of chunkText(buf.join('\n'), max)) out.push({ section, text: t }); buf = []; };
  for (const line of md.split('\n')) {
    const h = line.match(/^#{1,4}\s+(.*)/);
    if (h) { flush(); section = h[1].trim(); } else buf.push(line);
  }
  flush();
  return out;
}

const chunkId = (source, n) => createHash('sha1').update(`${source}#${n}`).digest('hex').slice(0, 20);
const fetched = f => {
  try { return execFileSync('git', ['log', '-1', '--format=%cs', '--', f], { cwd: root }).toString().trim() || null; }
  catch { return null; }
};
const day = f => fetched(f) ?? statSync(root + f).mtime.toISOString().slice(0, 10);

function collect() {
  const index = Object.fromEntries(JSON.parse(readFileSync(root + 'projects/index.json')).map(p => [p.id, p]));
  const projects = [];
  for (const slug of readdirSync(root + 'projects')) {
    const f = `projects/${slug}/project.json`;
    if (!existsSync(root + f)) continue;
    projects.push({ ...slimProject(JSON.parse(readFileSync(root + f)), index[slug]), updated: day(f) });
  }
  const byId = Object.fromEntries(projects.map(p => [p.id, p]));

  const chunks = [];
  const add = (meta, parts) => parts.forEach((p, n) => chunks.push({ id: chunkId(meta.source, n), n, ...meta, ...p }));
  for (const f of ['README.md', 'docs/model/README.md', 'docs/performance.md'])
    add({ kind: 'app', source: f, sourceUrl: null, title: f === 'README.md' ? 'BTOlab README' : `BTOlab ${f}`, fetched: day(f) },
      chunkMarkdown(readFileSync(root + f, 'utf8')));

  const pdfs = [
    ...readdirSync(root + 'reference/hdb').filter(n => /^annex-.*\.pdf$|Annex.*\.pdf$/i.test(n)).map(n => {
      const f = `reference/hdb/${n}`;
      return { f, title: `HDB sales exercise annex (${n.replace(/\.pdf$/i, '')})`, url: null };
    }),
    ...readdirSync(root + 'reference/hdb/brochures').filter(n => n.endsWith('.pdf')).map(n => {
      const slug = n.replace(/\.pdf$/, ''), p = byId[slug];
      return { f: `reference/hdb/brochures/${n}`, title: `${p?.name ?? slug} sales brochure (HDB)`, url: p?.brochure ?? null };
    }),
  ];
  for (const { f, title, url } of pdfs) {
    const pages = execFileSync('pdftotext', [root + f, '-'], { maxBuffer: 64 << 20 }).toString().split('\f');
    add({ kind: 'hdb', source: f, sourceUrl: url, title, fetched: day(f) },
      pages.flatMap((t, i) => chunkText(t).map(text => ({ page: i + 1, text }))));
  }
  return { projects, chunks };
}

// shortcut: only `authorized_user` credentials (from `firebase login`); add service-account JWT signing when CI seeds
async function token() {
  const c = JSON.parse(readFileSync(process.env.GOOGLE_APPLICATION_CREDENTIALS, 'utf8'));
  if (c.type !== 'authorized_user') throw new Error(`unsupported credential type ${c.type}`);
  const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST',
    body: new URLSearchParams({ client_id: c.client_id, client_secret: c.client_secret, refresh_token: c.refresh_token, grant_type: 'refresh_token' }) });
  const j = await r.json();
  if (!j.access_token) throw new Error(`token: ${r.status} ${j.error}`);
  return j.access_token;
}

async function commit(tok, coll, docs) {
  const writes = docs.map(({ id, ...d }) => ({ update: { name: `projects/${PROJECT}/databases/(default)/documents/${coll}/${id}`, fields: toFields(d) } }));
  const r = await fetch(`${DOCS}:commit`, { method: 'POST', body: JSON.stringify({ writes }),
    headers: { Authorization: `Bearer ${tok}`, 'x-goog-user-project': PROJECT, 'Content-Type': 'application/json' } });
  if (!r.ok) throw new Error(`${coll} commit ${r.status}: ${(await r.text()).slice(0, 500)}`);
}

async function main() {
  const { projects, chunks } = collect();
  const kinds = chunks.reduce((m, c) => (m[c.kind] = (m[c.kind] ?? 0) + 1, m), {});
  console.log(`${projects.length} projects, ${chunks.length} chunks`, kinds);
  if (process.argv.includes('--dry')) return;
  const tok = await token();
  // projects are up to ~100 KB each; keep each commit well under the 10 MiB request limit
  for (let i = 0; i < projects.length; i += 10) await commit(tok, 'projects', projects.slice(i, i + 10));
  for (let i = 0; i < chunks.length; i += 400) await commit(tok, 'chunks', chunks.slice(i, i + 400));
  console.log(`wrote to ${PROJECT}`);
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
