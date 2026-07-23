import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../assets/js/archive.js', import.meta.url), 'utf8');
let rows = [];
const documentMock = {
  addEventListener() {},
  getElementById() { return null; },
  querySelectorAll() { return rows; },
  body: { getAttribute() { return 'archive'; } }
};
const windowMock = { addEventListener() {}, clearTimeout() {}, setTimeout() {} };
const { archiveVersionCompactionPlan } = new Function(
  'document',
  'window',
  `${source}\nreturn { archiveVersionCompactionPlan };`
)(documentMock, windowMock);

function archiveRow(version, project = 'song-a', type = 'audio') {
  const attributes = {
    'data-id': `${project}-${type}-${version}`,
    'data-type': type,
    'data-project-key': project,
    'data-source-project-id': '',
    'data-sub': project,
    'data-title': project,
    'data-ver': version,
    'data-date': version,
    'data-sort-order': version.replace(/\D/g, '')
  };
  return {
    getAttribute(name) { return attributes[name] || ''; },
    querySelector() { return null; },
    classList: { contains() { return false; } }
  };
}

const first = archiveRow('v1');
const second = archiveRow('v2');
const third = archiveRow('v3');
const otherProject = archiveRow('v7', 'song-b');
rows = [first, second, third, otherProject];

assert.deepEqual(
  archiveVersionCompactionPlan(first).map(change => [change.row.getAttribute('data-ver'), change.version]),
  [['v2', 'v1'], ['v3', 'v2']]
);
assert.deepEqual(
  archiveVersionCompactionPlan(second).map(change => [change.row.getAttribute('data-ver'), change.version]),
  [['v3', 'v2']]
);
assert.deepEqual(archiveVersionCompactionPlan(archiveRow('v1', 'song-a', 'image')), []);

console.log('version compaction tests passed');
