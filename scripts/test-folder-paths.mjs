import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../assets/js/archive.js', import.meta.url), 'utf8');
const documentMock = {
  addEventListener() {},
  getElementById() { return null; },
  querySelectorAll() { return []; },
  body: { getAttribute() { return 'archive'; } }
};
const windowMock = { addEventListener() {}, clearTimeout() {}, setTimeout() {} };
const { folderPathChanges } = new Function(
  'document',
  'window',
  `${source}\nreturn { folderPathChanges };`
)(documentMock, windowMock);

function folder(path, descendants = []) {
  return {
    getAttribute(name) { return name === 'data-standard-folder' ? path : ''; },
    querySelectorAll() { return descendants; }
  };
}

const demos = folder('eras/demos');
const stems = folder('eras/demos/stems');
const root = folder('eras', [demos, stems]);

assert.deepEqual(
  folderPathChanges(root, 'years').map(change => [change.oldPath, change.newPath]),
  [
    ['eras', 'years'],
    ['eras/demos', 'years/demos'],
    ['eras/demos/stems', 'years/demos/stems']
  ]
);

assert.deepEqual(folderPathChanges(root, ''), []);
console.log('folder path tests passed');
