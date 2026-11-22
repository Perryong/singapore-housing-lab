// Firestore seed (#33): value encoding, slimming and chunking. No network.
import assert from 'node:assert/strict';
import { toValue, slimProject, chunkText, chunkMarkdown } from '../tools/firestore_seed.mjs';

assert.deepEqual(toValue(3), { integerValue: '3' });
assert.deepEqual(toValue(1.5), { doubleValue: 1.5 });
assert.deepEqual(toValue(null), { nullValue: null });
assert.deepEqual(toValue({ a: [true, 'x'] }), { mapValue: { fields: { a: { arrayValue: { values: [{ booleanValue: true }, { stringValue: 'x' }] } } } } });

// geometry dropped; arrays-in-arrays (not allowed by Firestore) become JSON text; maps of arrays stay native
const s = slimProject({ id: 'p', name: 'P', surround: [1], commute: { hubs: [[1, 2]] }, value: { byStack: { 3: [1, 2] } } }, { flatTypes: ['3-room'] });
assert.equal(s.surround, undefined);
assert.equal(s.commute, '{"hubs":[[1,2]]}');
assert.deepEqual(s.value, { byStack: { 3: [1, 2] } });
assert.deepEqual(s.flatTypes, ['3-room']);

const c = chunkText('a b\n\n' + 'x'.repeat(25) + '\n\nc', 10);
assert.ok(c.every(t => t.length <= 10), c);
assert.equal(c.join('').replace(/\s/g, ''), 'ab' + 'x'.repeat(25) + 'c');  // nothing lost
assert.deepEqual(chunkText('aaaa bbbb cccc', 10), ['aaaa bbbb', 'cccc']);  // long paragraph cut at a space, not mid-word

const m = chunkMarkdown('intro\n# Sun\nafternoon sun\n## Value\nprice');
assert.deepEqual(m, [{ section: '', text: 'intro' }, { section: 'Sun', text: 'afternoon sun' }, { section: 'Value', text: 'price' }]);
console.log('firestore_seed ok');
