// Seed Supabase with the RAG chatbot's data (#33): `projects` (facts for get_project/list_projects)
// and `chunks` (README/docs + HDB PDFs already in the repo, for search_*_docs). Tables: supabase/schema.sql.
// Usage: put SUPABASE_URL and SUPABASE_SECRET_KEY in .env (gitignored), then: node tools/supabase_seed.mjs [--dry]
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const root = new URL('..', import.meta.url).pathname;

// chatbot-facing fields; geometry (surround, context, blockers, stacks, resale) is big and not needed
const KEEP = ['tagline', 'address', 'notes', 'brochure', 'prices', 'categories', 'value', 'commute', 'amenities',
  'facilities', 'layouts', 'resaleComparables'];

export function projectRow(p, idx = {}, updated = null) {
  const data = { cmp: idx.cmp ?? null };
  for (const k of KEEP) if (k in p) data[k] = p[k];
  return { id: p.id, name: p.name, town: p.town ?? null, status: p.status ?? null, launch: p.launch ?? null,
    kind: p.kind ?? null, classification: p.classification ?? null, units: p.units ?? null,
    flat_types: idx.flatTypes ?? null, data, updated };
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
const day = f => {
  try { const d = execFileSync('git', ['log', '-1', '--format=%cs', '--', f], { cwd: root }).toString().trim(); if (d) return d; } catch {}
  return statSync(root + f).mtime.toISOString().slice(0, 10);
};

function collect() {
  const index = Object.fromEntries(JSON.parse(readFileSync(root + 'projects/index.json')).map(p => [p.id, p]));
  const projects = [];
  for (const slug of readdirSync(root + 'projects')) {
    const f = `projects/${slug}/project.json`;
    if (existsSync(root + f)) projects.push(projectRow(JSON.parse(readFileSync(root + f)), index[slug], day(f)));
  }
  const byId = Object.fromEntries(projects.map(p => [p.id, p]));

  const chunks = [];  // every row carries every column: PostgREST bulk inserts need the same keys
  const add = (meta, parts) => parts.forEach((p, n) =>
    chunks.push({ id: chunkId(meta.source, n), n, section: null, page: null, ...meta, ...p }));
  for (const f of ['README.md', 'docs/model/README.md', 'docs/performance.md'])
    add({ kind: 'app', source: f, source_url: null, title: f === 'README.md' ? 'BTOlab README' : `BTOlab ${f}`, fetched: day(f) },
      chunkMarkdown(readFileSync(root + f, 'utf8')));

  const pdfs = [
    ...readdirSync(root + 'reference/hdb').filter(n => /annex.*\.pdf$/i.test(n)).map(n =>
      ({ f: `reference/hdb/${n}`, title: `HDB sales exercise annex (${n.replace(/\.pdf$/i, '')})`, url: null })),
    ...readdirSync(root + 'reference/hdb/brochures').filter(n => n.endsWith('.pdf')).map(n => {
      const slug = n.replace(/\.pdf$/, ''), p = byId[slug];
      return { f: `reference/hdb/brochures/${n}`, title: `${p?.name ?? slug} sales brochure (HDB)`, url: p?.data.brochure ?? null };
    }),
  ];
  for (const { f, title, url } of pdfs) {
    const pages = execFileSync('pdftotext', [root + f, '-'], { maxBuffer: 64 << 20 }).toString().split('\f');
    add({ kind: 'hdb', source: f, source_url: url, title, fetched: day(f) },
      pages.flatMap((t, i) => chunkText(t).map(text => ({ page: i + 1, text }))));
  }
  return { projects, chunks };
}

async function rest(method, path, body) {
  const key = process.env.SUPABASE_SECRET_KEY;
  const headers = { apikey: key, 'Content-Type': 'application/json', Prefer: 'return=minimal' };
  if (key.startsWith('eyJ')) headers.Authorization = `Bearer ${key}`;  // legacy service_role JWT
  const r = await fetch(`${process.env.SUPABASE_URL}/rest/v1/${path}`, { method, headers, body: body && JSON.stringify(body) });
  if (!r.ok) throw new Error(`${method} ${path.split('?')[0]} ${r.status}: ${(await r.text()).slice(0, 500)}`);
}

async function main() {
  const { projects, chunks } = collect();
  const kinds = chunks.reduce((m, c) => (m[c.kind] = (m[c.kind] ?? 0) + 1, m), {});
  console.log(`${projects.length} projects, ${chunks.length} chunks`, kinds);
  if (process.argv.includes('--dry')) return;
  try { process.loadEnvFile(root + '.env'); } catch {}
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SECRET_KEY) throw new Error('set SUPABASE_URL and SUPABASE_SECRET_KEY in .env');
  // replace everything: the repo is the source of truth, and this also drops rows whose source was removed
  for (const [table, rows, size] of [['projects', projects, 10], ['chunks', chunks, 500]]) {
    await rest('DELETE', `${table}?id=not.is.null`);
    for (let i = 0; i < rows.length; i += size) await rest('POST', table, rows.slice(i, i + size));
  }
  console.log(`wrote to ${new URL(process.env.SUPABASE_URL).host}`);
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
