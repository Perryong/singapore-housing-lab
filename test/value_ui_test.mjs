import assert from 'node:assert/strict';
import { gapText, driverBars } from '../web/value.js';

assert.equal(gapText(982000, 455000, 624000), '≈ $358k above the highest BTO price');
assert.equal(gapText(500000, 455000, 624000), 'within the BTO price range');
assert.equal(gapText(400000, 455000, 624000), '≈ $55k below the lowest BTO price');
const h = driverBars({ location: 172000, floor: 31000, size: -29000 });
assert.match(h, /Location[\s\S]*class="bar pos"[\s\S]*\+\$172k/);
assert.match(h, /Size[\s\S]*class="bar neg"[\s\S]*−\$29k/);
console.log('ok');
