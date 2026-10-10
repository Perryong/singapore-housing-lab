import assert from 'node:assert/strict';
import { walkMin, schoolBands } from '../web/nearby.js';

assert.equal(walkMin(0), 1);                 // never "0 min"
assert.equal(walkMin(615), 10);              // 615 m straight line × 1.3 / 80 m per min ≈ 10
const S = [{ cat: 'primary', name: 'Near', x: 300, z: 400 }, { cat: 'primary', name: 'Mid', x: 1500, z: 0 },
           { cat: 'primary', name: 'Far', x: 2500, z: 0 }, { cat: 'secondary', name: 'Sec', x: 10, z: 0 }];
const b = schoolBands({ x: 0, z: 0 }, S);   // measured from the stack, not the site centre
assert.deepEqual(b.within1.map(s => s.name), ['Near']);
assert.deepEqual(b.within2.map(s => s.name), ['Mid']);
assert.deepEqual(schoolBands({ x: 2000, z: 0 }, S).within1.map(s => s.name), ['Mid', 'Far']);   // another block, other bands
console.log('ok');
