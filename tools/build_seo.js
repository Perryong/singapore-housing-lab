// projects/index.json + project.json -> crawlable static pages: bto/<id>/index.html, bto/index.html, sitemap.xml, robots.txt
// The 3D app renders with JavaScript after loading megabytes of data; these pages give search engines the same facts as text.
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { esc, money, range } from '../web/format.js';
import { catOf } from '../web/project.js';
// flat names by price code, for launched projects with no site-plan legend (categories) yet
const FLAT = { CCA: 'Community Care Apartment', '2RF1': '2-room Flexi (smaller)', '2RF2': '2-room Flexi', '3RM': '3-room', '4RM': '4-room',
  '4RMB': '4-room with balcony', '5RM': '5-room', '3GEN': '3Gen' };

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SITE = 'https://singapore-housing-lab.vercel.app';
const CSS = `body{margin:0 auto;max-width:760px;padding:24px 16px;font:16px/1.55 system-ui,sans-serif;color:#1A2427;background:#fff}
a{color:#8A5300}h1{font-size:28px;line-height:1.2;margin:8px 0}h2{font-size:18px;margin:28px 0 8px}
table{width:100%;border-collapse:collapse;font-size:14px}th,td{text-align:left;padding:6px 8px 6px 0;border-bottom:1px solid #E1E6E3}
.cta{display:inline-block;margin:12px 0;padding:10px 16px;border-radius:8px;background:#E8931C;color:#1A2427;font-weight:600;text-decoration:none}
.m{color:#56666A;font-size:14px}.tag{padding:2px 8px;border-radius:99px;background:#EEF0EC;font-size:13px;font-weight:600}
@media(prefers-color-scheme:dark){body{background:#14191A;color:#E8EDEA}a{color:#F0B566}th,td{border-color:#39454A}.m{color:#A8B5B8}.tag{background:#39454A}}`;
const table = (head, rows) => `<table><thead><tr>${head.map(h => `<th scope="col">${h}</th>`).join('')}</tr></thead><tbody>${
  rows.map(r => `<tr>${r.map(c => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
const page = (title, desc, path, body, ld) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><meta name="description" content="${esc(desc)}"><link rel="canonical" href="${SITE}${path}">
<meta property="og:type" content="website"><meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(desc)}"><meta property="og:url" content="${SITE}${path}">
${ld ? `<script type="application/ld+json">${JSON.stringify(ld).replace(/</g, '\\u003c')}</script>\n` : ''}<style>${CSS}</style></head>
<body><nav class="m"><a href="/bto/">All BTO projects</a> · <a href="/web/">Open BTOlab</a></nav>
${body}
<p class="m">Independent project using public data; not affiliated with HDB. Estimates are not valuations. Check HDB's own documents before you apply.</p></body></html>
`;

function projectPage(p) {
  const P = JSON.parse(readFileSync(join(ROOT, 'projects', p.id, 'project.json')));
  const when = p.status === 'upcoming' ? `Upcoming, ${p.launch}` : `Launched ${p.launch}`;
  const sale = Object.entries(P.prices || {});
  const lows = sale.map(([, v]) => v.min), highs = sale.map(([, v]) => v.max);
  const price = sale.length ? ` From ${money(Math.min(...lows))} to ${money(Math.max(...highs))}.` : '';
  const title = `${p.name} BTO (${p.launch}): ${sale.length ? 'prices, ' : ''}sun, value and commute | BTOlab`;
  const desc = `${p.name}${p.name.includes(p.town) ? '' : `, ${p.town}`}: ${p.units.toLocaleString('en-SG')} HDB BTO units, ${p.status === 'upcoming' ? 'upcoming in' : 'launched'} ${p.launch}.${price} ${p.hasLayout ? 'See sun on each unit' : 'See the site in 3D'}, nearby resale prices and commute times.`;
  const facts = [['Status', esc(when) + (p.availability === 'closed' ? ` <span class="tag">Closed since ${esc(p.since)}</span>` : '')], ['Town', esc(p.town)],
    p.classification && ['Classification', esc(p.classification)], ['Units', p.units.toLocaleString('en-SG')],
    ['Flat types', esc(p.flatTypes.join(', '))], P.address && ['Location', esc(P.address)]].filter(Boolean);
  const mrt = (P.amenities || []).filter(a => a.cat === 'mrt').sort((a, b) => a.d - b.d)[0];
  if (mrt) facts.push(['Nearest MRT', `${esc(mrt.name)}, ${mrt.d.toLocaleString('en-SG')} m in a straight line`]);
  let body = `<h1>${esc(p.name)} BTO</h1><p class="m">${esc(P.tagline || when)}</p>
<a class="cta" href="/web/?p=${encodeURIComponent(p.id)}">${p.hasLayout ? 'Open the 3D sun study' : 'Open the site in 3D'}</a>
<h2>Project facts</h2>${table(['Item', 'Detail'], facts)}`;
  if (sale.length) body += `<h2>HDB launch prices</h2>${table(['Flat', 'Price', 'Floor area', 'Wait'], sale.map(([c, v]) => [
    esc(P.categories?.[catOf(P, c)]?.name || FLAT[c] || c) + ` (${esc(c)})`, range(v.min, v.max), v.sqm ? `${v.sqm} sqm` : '', v.waitingMonths ? `${v.waitingMonths} months` : '']))}`;
  else if (p.status === 'upcoming') body += `<h2>Prices and layout</h2><p>HDB releases prices and the site plan at the sales launch.</p>`;
  const rs = Object.entries(P.resale?.summary || {}).filter(([, v]) => v.median);
  if (rs.length) body += `<h2>Resale prices within ${P.resale.radiusM} m</h2><p class="m">HDB resale sales in the ${P.resale.months} months up to ${esc(P.resale.asOf)}.</p>${
    table(['Flat', 'Sales', 'Median', 'Lease left'], rs.map(([t, v]) => [esc(t.toLowerCase()), v.n, money(v.median), v.leaseLeft ? `${v.leaseLeft} years` : '']))}`;
  const val = Object.entries(P.value?.types || {});
  if (val.length) body += `<h2>Estimated resale value today</h2><p class="m">A typical unit on floor 10 with about ${P.value.lease} years of lease, from a model of HDB resale sales up to ${esc(P.value.asOf)}. An estimate, not a valuation.</p>${
    table(['Flat', 'Estimate', 'Range'], val.map(([t, [e, lo, hi]]) => [esc(t.toLowerCase()), money(e), range(lo, hi)]))}`;
  const C = P.commute, hubs = C?.hubs?.[C.near];
  if (hubs?.some(Boolean)) body += `<h2>Commute</h2><p class="m">Estimated door-to-station time by public transport at ${esc(C.at)}.</p>${
    table(['To', 'Minutes'], hubs.map((h, i) => h && [esc(C.hubPts[i][0]), h[0]]).filter(Boolean))}`;
  const ld = { '@context': 'https://schema.org', '@type': 'ApartmentComplex', name: `${p.name} BTO`, url: `${SITE}/bto/${p.id}/`, numberOfAccommodationUnits: p.units,
    address: { '@type': 'PostalAddress', addressLocality: p.town, addressCountry: 'SG' }, geo: { '@type': 'GeoCoordinates', latitude: P.site.lat, longitude: P.site.lon } };
  return page(title, desc, `/bto/${p.id}/`, body, ld);
}

const INDEX = JSON.parse(readFileSync(join(ROOT, 'projects/index.json')));
rmSync(join(ROOT, 'bto'), { recursive: true, force: true });
for (const p of INDEX) {
  mkdirSync(join(ROOT, 'bto', p.id), { recursive: true });
  writeFileSync(join(ROOT, 'bto', p.id, 'index.html'), projectPage(p));
}
const groups = Object.groupBy(INDEX, p => p.status === 'upcoming' ? `Upcoming, ${p.launch}` : `Launched ${p.launch}`);
writeFileSync(join(ROOT, 'bto/index.html'), page('Singapore HDB BTO projects: sun, prices, value and commute | BTOlab',
  `${INDEX.length} Singapore HDB BTO projects with launch prices, nearby resale prices, sun studies and commute times.`, '/bto/',
  `<h1>Singapore HDB BTO projects</h1>${Object.entries(groups).map(([g, ps]) => `<h2>${esc(g)}</h2><ul>${ps.map(p =>
    `<li><a href="/bto/${encodeURIComponent(p.id)}/">${esc(p.name)}</a> · ${esc(p.town)} · ${p.units.toLocaleString('en-SG')} units</li>`).join('')}</ul>`).join('')}`));
writeFileSync(join(ROOT, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${['/web/', '/web/weather.html', '/web/future.html', '/bto/', ...INDEX.map(p => `/bto/${p.id}/`)].map(u => `  <url><loc>${SITE}${u}</loc></url>`).join('\n')}
</urlset>
`);
writeFileSync(join(ROOT, 'robots.txt'), `User-agent: *\nAllow: /\n\nSitemap: ${SITE}/sitemap.xml\n`);
console.log(`${INDEX.length} project pages, bto/index.html, sitemap.xml, robots.txt`);
