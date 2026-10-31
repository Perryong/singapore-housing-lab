// Listing status: validation, stale warning, and how a closed project renders.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { applyListingStatus, staleWarning } from '../tools/listing_status.js';
import { pickerHtml } from '../web/picker.js';

const list = () => [{ id: 'a', name: 'A', town: 'T', launch: 'Jun 2026', status: 'launched', units: 9, flatTypes: [], hasLayout: true },
  { id: 'b', name: 'B', town: 'T', launch: 'Jun 2026', status: 'launched', units: 9, flatTypes: [], hasLayout: true }];
const closed = { availability: 'closed', since: '2026-11-06', source: 'HDB e-Alert' };

const L = applyListingStatus(list(), { projects: { b: closed } });
assert.equal(L[1].availability, 'closed'); assert.equal(L[1].since, '2026-11-06');
assert.equal(L[1].source, undefined);                                    // where we heard it stays out of the site's data
assert.equal(L[0].availability, undefined);                              // no status: no claim either way

assert.throws(() => applyListingStatus(list(), { projects: { typo: closed } }), /unknown project "typo"/);
assert.throws(() => applyListingStatus(list(), { projects: { a: { ...closed, availability: 'sold' } } }), /must be "closed"/);
assert.throws(() => applyListingStatus(list(), { projects: { a: { ...closed, since: '6 Nov' } } }), /since must be/);
assert.throws(() => applyListingStatus(list(), { projects: { a: { ...closed, source: '' } } }), /source is required/);

assert.equal(staleWarning({ reviewed: '2026-10-31' }, new Date('2026-12-30')), null);        // day 60
assert.match(staleWarning({ reviewed: '2026-10-31' }, new Date('2026-12-31')), /last reviewed 2026-10-31/);

const html = pickerHtml(L, 'a');
assert.equal(html.match(/>Closed</g).length, 1);
assert.match(html, /title="Closed since 2026-11-06"/);
assert.match(html, /href="\?p=b"/);                                      // still browsable
assert.match(html, /<section class="group"><h3>Jun 2026 BTO launch<\/h3>/);                  // stays in its launch group

// the committed file is valid against the real catalogue
const status = JSON.parse(readFileSync('reference/hdb/listing-status.json'));
applyListingStatus(JSON.parse(readFileSync('projects/index.json')), status);
console.log('ok');
