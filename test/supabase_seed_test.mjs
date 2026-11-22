// Supabase seed (#33): project rows and chunking. No network.
import assert from 'node:assert/strict';
import { projectRow, chunkText, chunkMarkdown } from '../tools/supabase_seed.mjs';

// geometry dropped; nested arrays stay as-is inside jsonb; index fields merged in
const r = projectRow({ id: 'p', name: 'P', town: 'T', surround: [1], commute: { hubs: [[1, 2]] } }, { flatTypes: ['3-room'], cmp: { radiusM: 900 } }, '2026-11-01');
assert.equal(r.data.surround, undefined);
assert.deepEqual(r.data.commute, { hubs: [[1, 2]] });
assert.deepEqual(r.flat_types, ['3-room']);
assert.deepEqual(r.data.cmp, { radiusM: 900 });
assert.equal(r.status, null);

const c = chunkText('a b\n\n' + 'x'.repeat(25) + '\n\nc', 10);
assert.ok(c.every(t => t.length <= 10), c);
assert.equal(c.join('').replace(/\s/g, ''), 'ab' + 'x'.repeat(25) + 'c');  // nothing lost
assert.deepEqual(chunkText('aaaa bbbb cccc', 10), ['aaaa bbbb', 'cccc']);  // long paragraph cut at a space, not mid-word

const m = chunkMarkdown('intro\n# Sun\nafternoon sun\n## Value\nprice');
assert.deepEqual(m, [{ section: '', text: 'intro' }, { section: 'Sun', text: 'afternoon sun' }, { section: 'Value', text: 'price' }]);
console.log('supabase_seed ok');
