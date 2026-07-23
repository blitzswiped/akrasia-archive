import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../assets/js/rules.js', import.meta.url), 'utf8');
const helpers = `
  const ROOT_ARCHIVE_PATH = '__root__';
  function cleanSingleLine(value, maxLength) {
    return String(value || '').replace(/[\\r\\n\\t]+/g, ' ').trim().slice(0, maxLength || 500);
  }
  function cleanMultiline(value, maxLength) {
    return String(value || '').replace(/\\r/g, '').trim().slice(0, maxLength || 12000);
  }
  function normalizeFolderPath(value) {
    return String(value || '').split('/').map(part => cleanSingleLine(part, 100)).filter(Boolean).join('/');
  }
  function safeDateTime(value) {
    return Number.isNaN(Date.parse(value || '')) ? '' : new Date(value).toISOString();
  }
`;

const {
  normalizeArchiveRule,
  archiveRuleValueMatches,
  archiveRuleMatchesRecord,
  appendArchiveRuleNote,
  applyArchiveRuleToRecord
} = new Function(`${helpers}\n${source}\nreturn { normalizeArchiveRule, archiveRuleValueMatches, archiveRuleMatchesRecord, appendArchiveRuleNote, applyArchiveRuleToRecord };`)();

const batchRule = normalizeArchiveRule({
  id: 'batch-4',
  field: 'name',
  operator: 'contains',
  value: 'batch 4',
  moveEnabled: true,
  folder: 'sessions/batch 4'
});
const datedNoteRule = normalizeArchiveRule({
  id: 'session-note',
  field: 'date',
  value: '2026-07-17',
  noteEnabled: true,
  noteMode: 'append',
  note: 'worked on during the July 17 session'
});

assert.equal(archiveRuleValueMatches('BATCH 4 outro v3', batchRule), true);
assert.equal(archiveRuleValueMatches('batch 3 outro', batchRule), false);
assert.equal(archiveRuleMatchesRecord({ title: 'quiet demo', asset_date: '2026-07-17' }, datedNoteRule), true);

const record = { title: 'Batch 4 hook', filename: 'batch 4 hook v2.mp3', batch: 'loose', notes: '' };
applyArchiveRuleToRecord(record, batchRule);
assert.equal(record.batch, 'sessions/batch 4');

const datedRecord = { title: 'voice memo', asset_date: '2026-07-17', notes: 'first pass' };
applyArchiveRuleToRecord(datedRecord, datedNoteRule);
applyArchiveRuleToRecord(datedRecord, datedNoteRule);
assert.equal(datedRecord.notes, 'first pass\n\nworked on during the July 17 session');
assert.equal(appendArchiveRuleNote(datedRecord.notes, datedNoteRule.note), datedRecord.notes);

const rootRule = normalizeArchiveRule({ field: 'folder', value: 'misc', moveEnabled: true, folder: 'root' });
const rootRecord = { title: 'loose idea', batch: 'misc' };
applyArchiveRuleToRecord(rootRecord, rootRule);
assert.equal(rootRecord.batch, '__root__');

console.log('archive rule tests passed');
