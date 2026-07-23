import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../assets/js/admin-workspace.js', import.meta.url), 'utf8');
const helpers = `
  function cleanSingleLine(value, maxLength) {
    return String(value || '').replace(/[\\r\\n\\t]+/g, ' ').trim().slice(0, maxLength || 500);
  }
`;
const { adminEditDistance, adminFuzzyIncludes, adminSearchParts } = new Function(`${helpers}\n${source}\nreturn { adminEditDistance, adminFuzzyIncludes, adminSearchParts };`)();

assert.equal(adminEditDistance('batch','btach'),2);
assert.equal(adminFuzzyIncludes('sheep batch 4 session','btach'),true);
assert.equal(adminFuzzyIncludes('before akrasia','batch'),false);
assert.deepEqual(adminSearchParts('batch 4 type:audio folder:demos date:2026-07-17'),{
  filters:{ type:'audio', folder:'demos', date:'2026-07-17' },
  terms:['batch','4']
});

console.log('admin workspace tests passed');
