// Crawlable pages from tools/build_seo.js match the catalogue and carry real facts as text.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const INDEX = JSON.parse(readFileSync('projects/index.json'));
const sitemap = readFileSync('sitemap.xml', 'utf8');
// .vercelignore is an allow-list: anything not named here 404s in production.
const deployed = readFileSync('.vercelignore', 'utf8');
for (const path of ['/bto', '/robots.txt', '/sitemap.xml']) assert.ok(deployed.includes(`!${path}\n`), `${path} not deployed`);
assert.match(readFileSync('robots.txt', 'utf8'), /Sitemap: https:\/\/singapore-housing-lab\.vercel\.app\/sitemap\.xml/);
assert.equal(sitemap.match(/<loc>/g).length, INDEX.length + 3);
assert.ok(sitemap.includes('/web/weather.html</loc>'));
for (const p of INDEX) assert.ok(Number.isFinite(p.lat) && Number.isFinite(p.lon), `${p.id}: no coordinates for the weather map`);
const titles = new Set(), descs = new Set();
for (const p of INDEX) {
  const h = readFileSync(`bto/${p.id}/index.html`, 'utf8');
  const title = h.match(/<title>(.*?)<\/title>/)[1], desc = h.match(/name="description" content="(.*?)"/)[1];
  titles.add(title); descs.add(desc);
  assert.ok(desc.includes(p.launch), `${p.id}: description lacks "${p.launch}"`);
  assert.ok(desc.length <= 200, `${p.id}: description ${desc.length} chars`);
  assert.ok(sitemap.includes(`/bto/${p.id}/</loc>`), p.id);
  assert.ok(h.includes(`rel="canonical" href="https://singapore-housing-lab.vercel.app/bto/${p.id}/"`), p.id);
  assert.ok(h.includes(`href="/web/?p=${encodeURIComponent(p.id)}"`), p.id);
  assert.equal(JSON.parse(h.match(/ld\+json">(.*?)<\/script>/)[1]).numberOfAccommodationUnits, p.units);
  assert.ok(!/undefined|NaN|null/.test(h.replace(/<script[\s\S]*?<\/script>/, '')), `${p.id}: bad value in page`);
}
assert.equal(titles.size, INDEX.length); assert.equal(descs.size, INDEX.length);       // no duplicate titles or descriptions
const launched = INDEX.find(p => p.status === 'launched'), up = INDEX.find(p => p.status === 'upcoming');
assert.match(readFileSync(`bto/${launched.id}/index.html`, 'utf8'), /HDB launch prices/);
assert.match(readFileSync(`bto/${up.id}/index.html`, 'utf8'), /releases prices and the site plan at the sales launch/);
console.log('ok');
