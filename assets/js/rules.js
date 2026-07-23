  const ARCHIVE_RULES_KEY = 'akrasia_archive_rules_v1';

  function archiveRuleId() {
    return `rule-${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
  }

  function normalizeArchiveRule(rule) {
    rule = rule && typeof rule === 'object' ? rule : {};
    var field = ['name','folder','date','tag','type','version'].includes(rule.field) ? rule.field : 'name';
    var operator = ['contains','is','starts','ends'].includes(rule.operator) ? rule.operator : 'contains';
    var rawFolder = cleanSingleLine(rule.folder,240);
    var rootFolder = ['root','__root__','root / loose archive'].includes(rawFolder.toLowerCase());
    return {
      id:cleanSingleLine(rule.id,90) || archiveRuleId(),
      field,
      operator:field === 'date' ? 'is' : operator,
      value:cleanSingleLine(rule.value,160),
      moveEnabled:Boolean(rule.moveEnabled),
      folder:rootFolder ? ROOT_ARCHIVE_PATH : normalizeFolderPath(rawFolder),
      noteEnabled:Boolean(rule.noteEnabled),
      noteMode:rule.noteMode === 'replace' ? 'replace' : 'append',
      note:cleanMultiline(rule.note,12000),
      enabled:rule.enabled !== false,
      autoApply:rule.autoApply !== false,
      createdAt:safeDateTime(rule.createdAt) || new Date().toISOString()
    };
  }

  function readArchiveRules() {
    try {
      var value = JSON.parse(localStorage.getItem(ARCHIVE_RULES_KEY) || '[]');
      return Array.isArray(value) ? value.map(normalizeArchiveRule).filter(rule => rule.value && (rule.moveEnabled || rule.noteEnabled)) : [];
    } catch(error) { return []; }
  }

  function writeArchiveRules(rules) {
    try { localStorage.setItem(ARCHIVE_RULES_KEY,JSON.stringify(rules.map(normalizeArchiveRule))); }
    catch(error) { showAppNotice('saved rules are unavailable in this browser.','error'); }
  }

  function archiveRuleFieldLabel(field) {
    return { name:'title or filename', folder:'folder', date:'worked-on date', tag:'tag', type:'file type', version:'version' }[field] || 'title or filename';
  }

  function archiveRuleOperatorLabel(operator) {
    return { contains:'contains', is:'is', starts:'starts with', ends:'ends with' }[operator] || 'contains';
  }

  function archiveRuleRecordValue(record, field) {
    record = record || {};
    if(field === 'name') return `${record.title || ''} ${record.filename || record.name || ''}`;
    if(field === 'folder') return record.batch === ROOT_ARCHIVE_PATH ? '' : record.batch || record.folder || '';
    if(field === 'date') return record.asset_date || record.assetDate || '';
    if(field === 'tag') return record.mood || record.tag || '';
    if(field === 'type') return record.type || '';
    if(field === 'version') return record.version || record.ver || '';
    return '';
  }

  function archiveRuleRowValue(row, field) {
    if(field === 'name') return `${row.getAttribute('data-title') || ''} ${row.getAttribute('data-name') || ''}`;
    if(field === 'folder') return row.getAttribute('data-sub') || '';
    if(field === 'date') return row.getAttribute('data-asset-date') || dateFromSortKey(row.getAttribute('data-date')) || '';
    if(field === 'tag') return row.getAttribute('data-mood') || '';
    if(field === 'type') return row.getAttribute('data-type') || '';
    if(field === 'version') return row.getAttribute('data-ver') || '';
    return '';
  }

  function archiveRuleValueMatches(candidate, rule) {
    var actual = String(candidate || '').trim().toLowerCase();
    var expected = String(rule.value || '').trim().toLowerCase();
    if(!expected) return false;
    if(rule.operator === 'is') return actual === expected;
    if(rule.operator === 'starts') return actual.startsWith(expected);
    if(rule.operator === 'ends') return actual.endsWith(expected);
    return actual.includes(expected);
  }

  function archiveRuleMatchesRow(row, rule) {
    return archiveRuleValueMatches(archiveRuleRowValue(row,rule.field),rule);
  }

  function archiveRuleMatchesRecord(record, rule) {
    return archiveRuleValueMatches(archiveRuleRecordValue(record,rule.field),rule);
  }

  function appendArchiveRuleNote(existing, note) {
    var current = cleanMultiline(existing,12000);
    var addition = cleanMultiline(note,12000);
    if(!addition) return current;
    if(current.toLowerCase().includes(addition.toLowerCase())) return current;
    return cleanMultiline(current ? `${current}\n\n${addition}` : addition,12000);
  }

  function archiveRuleDestination(rule) {
    return rule.folder === ROOT_ARCHIVE_PATH ? '' : normalizeFolderPath(rule.folder);
  }

  function applyArchiveRuleToRecord(record, rule) {
    if(!archiveRuleMatchesRecord(record,rule)) return record;
    if(rule.moveEnabled) record.batch = archiveRuleDestination(rule) || ROOT_ARCHIVE_PATH;
    if(rule.noteEnabled) record.notes = rule.noteMode === 'replace' ? rule.note : appendArchiveRuleNote(record.notes,rule.note);
    return record;
  }

  function applySavedArchiveRulesToRecord(record) {
    readArchiveRules().filter(rule => rule.enabled && rule.autoApply).forEach(rule => applyArchiveRuleToRecord(record,rule));
    return record;
  }

  function archiveRuleFromBuilder(requireActions) {
    var field = document.getElementById('archiveRuleField')?.value || 'name';
    var value = cleanSingleLine(document.getElementById('archiveRuleValue')?.value,160);
    if(!value) return null;
    var moveEnabled = Boolean(document.getElementById('archiveRuleMoveEnabled')?.checked);
    var noteEnabled = Boolean(document.getElementById('archiveRuleNoteEnabled')?.checked);
    var rawFolder = cleanSingleLine(document.getElementById('archiveRuleFolder')?.value,240);
    var rootFolder = ['root','__root__','root / loose archive'].includes(rawFolder.toLowerCase());
    var note = cleanMultiline(document.getElementById('archiveRuleNote')?.value,12000);
    if(requireActions && !moveEnabled && !noteEnabled) return null;
    if(requireActions && moveEnabled && !rootFolder && !normalizeFolderPath(rawFolder)) return null;
    if(requireActions && noteEnabled && !note) return null;
    var existingId = cleanSingleLine(document.getElementById('archiveRuleId')?.value,90);
    var prior = readArchiveRules().find(rule => rule.id === existingId);
    return normalizeArchiveRule({
      id:existingId || archiveRuleId(),
      field,
      operator:document.getElementById('archiveRuleOperator')?.value,
      value,
      moveEnabled,
      folder:rootFolder ? ROOT_ARCHIVE_PATH : rawFolder,
      noteEnabled,
      noteMode:document.getElementById('archiveRuleNoteMode')?.value,
      note,
      enabled:prior ? prior.enabled : true,
      autoApply:Boolean(document.getElementById('archiveRuleAuto')?.checked),
      createdAt:prior?.createdAt || new Date().toISOString()
    });
  }

  function matchingRowsForArchiveRule(rule) {
    return rule ? baseRows().filter(row => archiveRuleMatchesRow(row,rule)) : [];
  }

  function syncArchiveRuleMatchInput() {
    var field = document.getElementById('archiveRuleField')?.value;
    var input = document.getElementById('archiveRuleValue');
    var operator = document.getElementById('archiveRuleOperator');
    if(!input || !operator) return;
    input.type = field === 'date' ? 'date' : 'text';
    input.placeholder = field === 'name' ? 'batch 4' : (field === 'folder' ? 'demos' : (field === 'tag' ? 'raw' : (field === 'version' ? 'v4' : 'audio')));
    operator.disabled = field === 'date';
    if(field === 'date') operator.value = 'is';
  }

  function syncArchiveRuleActionState() {
    var move = Boolean(document.getElementById('archiveRuleMoveEnabled')?.checked);
    var note = Boolean(document.getElementById('archiveRuleNoteEnabled')?.checked);
    document.getElementById('archiveRuleFolder').disabled = !move;
    document.getElementById('archiveRuleNoteMode').disabled = !note;
    document.getElementById('archiveRuleNote').disabled = !note;
  }

  function previewArchiveRule() {
    var preview = document.getElementById('archiveRulePreview');
    if(!preview) return;
    var rule = archiveRuleFromBuilder(false);
    var rows = matchingRowsForArchiveRule(rule);
    var names = rows.slice(0,6).map(row => row.getAttribute('data-title') || row.getAttribute('data-name') || 'untitled');
    preview.innerHTML = `<strong>${rows.length} match${rows.length === 1 ? '' : 'es'}</strong><span>${rule ? (names.length ? escapeHtml(names.join(' / ')) + (rows.length > names.length ? ` / +${rows.length - names.length} more` : '') : 'nothing in the current archive matches this sentence.') : 'finish the sentence to preview the archive.'}</span>`;
    var button = document.getElementById('archiveRuleApplyBtn');
    if(button) button.disabled = !rows.length || !archiveRuleFromBuilder(true);
  }

  function archiveRuleSummary(rule) {
    var actions = [];
    if(rule.moveEnabled) actions.push(`move to ${rule.folder === ROOT_ARCHIVE_PATH ? 'archive root' : rule.folder}`);
    if(rule.noteEnabled) actions.push(`${rule.noteMode} note`);
    return `when ${archiveRuleFieldLabel(rule.field)} ${archiveRuleOperatorLabel(rule.operator)} "${rule.value}" -> ${actions.join(' + ')}`;
  }

  function renderArchiveRules() {
    var list = document.getElementById('archiveRuleList');
    if(!list) return;
    var rules = readArchiveRules();
    list.innerHTML = rules.length ? rules.map(rule => {
      var id = encodeURIComponent(rule.id);
      var count = matchingRowsForArchiveRule(rule).length;
      return `<article class="archive-rule-card${rule.enabled ? '' : ' disabled'}">
        <label class="archive-rule-enabled"><input type="checkbox" ${rule.enabled ? 'checked' : ''} onchange="toggleArchiveRuleEnabled(decodeURIComponent('${id}'),this.checked)"><span>${rule.enabled ? 'enabled' : 'paused'}</span></label>
        <div class="archive-rule-card-copy"><strong>${escapeHtml(archiveRuleSummary(rule))}</strong><span>${count} current match${count === 1 ? '' : 'es'} / ${rule.autoApply ? 'future imports on' : 'manual only'}</span></div>
        <div class="archive-rule-card-actions"><button type="button" onclick="editArchiveRule(decodeURIComponent('${id}'))">edit</button><button type="button" onclick="applySavedArchiveRule(decodeURIComponent('${id}'))">run</button><button type="button" onclick="removeArchiveRule(decodeURIComponent('${id}'))">remove</button></div>
      </article>`;
    }).join('') : '<div class="archive-rule-empty">no saved rules yet. build one on the left, preview it, then save it.</div>';
    previewArchiveRule();
  }

  function resetArchiveRuleBuilder() {
    document.getElementById('archiveRuleId').value = '';
    document.getElementById('archiveRuleField').value = 'name';
    document.getElementById('archiveRuleOperator').value = 'contains';
    document.getElementById('archiveRuleValue').value = '';
    document.getElementById('archiveRuleMoveEnabled').checked = false;
    document.getElementById('archiveRuleFolder').value = '';
    document.getElementById('archiveRuleNoteEnabled').checked = false;
    document.getElementById('archiveRuleNoteMode').value = 'append';
    document.getElementById('archiveRuleNote').value = '';
    document.getElementById('archiveRuleAuto').checked = true;
    syncArchiveRuleMatchInput();
    syncArchiveRuleActionState();
    previewArchiveRule();
  }

  function saveArchiveRule() {
    if(!requireAdmin()) return;
    var rule = archiveRuleFromBuilder(true);
    if(!rule) return showAppNotice('finish the match and choose a valid move or note action.','error');
    var rules = readArchiveRules();
    var index = rules.findIndex(item => item.id === rule.id);
    if(index === -1) rules.push(rule);
    else rules[index] = rule;
    writeArchiveRules(rules);
    document.getElementById('archiveRuleId').value = rule.id;
    renderArchiveRules();
    showAppNotice(index === -1 ? 'archive rule saved.' : 'archive rule updated.');
  }

  function editArchiveRule(id) {
    var rule = readArchiveRules().find(item => item.id === id);
    if(!rule) return;
    document.getElementById('archiveRuleId').value = rule.id;
    document.getElementById('archiveRuleField').value = rule.field;
    document.getElementById('archiveRuleOperator').value = rule.operator;
    document.getElementById('archiveRuleValue').value = rule.value;
    document.getElementById('archiveRuleMoveEnabled').checked = rule.moveEnabled;
    document.getElementById('archiveRuleFolder').value = rule.folder === ROOT_ARCHIVE_PATH ? 'root' : rule.folder;
    document.getElementById('archiveRuleNoteEnabled').checked = rule.noteEnabled;
    document.getElementById('archiveRuleNoteMode').value = rule.noteMode;
    document.getElementById('archiveRuleNote').value = rule.note;
    document.getElementById('archiveRuleAuto').checked = rule.autoApply;
    syncArchiveRuleMatchInput();
    syncArchiveRuleActionState();
    previewArchiveRule();
    document.querySelector('.archive-rule-builder')?.scrollIntoView({ behavior:archiveSettings?.motion === 'off' ? 'auto' : 'smooth', block:'start' });
  }

  function toggleArchiveRuleEnabled(id, enabled) {
    var rules = readArchiveRules();
    var rule = rules.find(item => item.id === id);
    if(!rule) return;
    rule.enabled = Boolean(enabled);
    writeArchiveRules(rules);
    renderArchiveRules();
  }

  function removeArchiveRule(id) {
    if(!requireAdmin()) return;
    var rules = readArchiveRules();
    var rule = rules.find(item => item.id === id);
    if(!rule || !confirm(`remove this rule?\n\n${archiveRuleSummary(rule)}`)) return;
    writeArchiveRules(rules.filter(item => item.id !== id));
    if(document.getElementById('archiveRuleId').value === id) resetArchiveRuleBuilder();
    renderArchiveRules();
    showAppNotice('archive rule removed.');
  }

  function archiveRuleChangeForRow(row, rule) {
    var update = {};
    var dom = {};
    if(rule.moveEnabled) {
      var destination = archiveRuleDestination(rule);
      if(normalizeFolderPath(row.getAttribute('data-sub')) !== destination) {
        update.batch = destination || ROOT_ARCHIVE_PATH;
        dom.batch = destination;
      }
    }
    if(rule.noteEnabled) {
      var current = row.getAttribute('data-notes') || '';
      var notes = rule.noteMode === 'replace' ? rule.note : appendArchiveRuleNote(current,rule.note);
      if(notes !== current) { update.notes = notes; dom.notes = notes; }
    }
    return Object.keys(update).length ? { row, update, dom } : null;
  }

  async function persistArchiveRuleChanges(changes) {
    if(!isRemoteReady || !supabaseClient) return { successful:changes, failed:[] };
    var groups = new Map();
    var localOnly = [];
    changes.forEach(change => {
      var id = change.row.getAttribute('data-id');
      if(!id) return localOnly.push(change);
      var key = JSON.stringify(change.update);
      if(!groups.has(key)) groups.set(key,{ update:change.update, changes:[] });
      groups.get(key).changes.push(change);
    });
    var successful = localOnly.slice();
    var failed = [];
    for(var group of groups.values()) {
      for(var offset = 0; offset < group.changes.length; offset += 100) {
        var chunk = group.changes.slice(offset,offset + 100);
        var ids = chunk.map(change => change.row.getAttribute('data-id'));
        var result = await supabaseClient.from('archive_assets').update(group.update).in('id',ids);
        if(result.error) failed.push(...chunk);
        else successful.push(...chunk);
      }
    }
    return { successful, failed };
  }

  function applyArchiveRuleDomChanges(changes) {
    var playing = null;
    changes.forEach(change => {
      if(Object.prototype.hasOwnProperty.call(change.dom,'batch')) {
        archiveDestination(change.dom.batch).appendChild(change.row);
        setRowBatch(change.row,change.dom.batch);
      }
      if(Object.prototype.hasOwnProperty.call(change.dom,'notes')) {
        change.row.setAttribute('data-notes',change.dom.notes);
        archiveSearchIndex.delete(change.row);
      }
      if(change.row.classList.contains('playing')) playing = change.row;
    });
    removeEmptyFolders();
    updateDirectoryDropdown();
    updateCounts();
    buildQueue();
    renderQueueList();
    setFilter(activeFilter);
    if(archiveSearchQuery) applyArchiveSearch(archiveSearchQuery);
    if(playing) updateNowPlayingDetails(playing,playing.getAttribute('data-type') || activeMediaType);
  }

  async function applyArchiveRuleToExisting(rule, options) {
    options = options || {};
    if(!requireAdmin()) return { matched:0, changed:0, failed:0 };
    var rows = matchingRowsForArchiveRule(rule);
    var changes = rows.map(row => archiveRuleChangeForRow(row,rule)).filter(Boolean);
    if(!changes.length) {
      if(!options.silent) showAppNotice(rows.length ? 'everything matching this rule is already organized.' : 'this rule has no matches.');
      return { matched:rows.length, changed:0, failed:0 };
    }
    if(!options.skipConfirm && changes.length > 25 && !confirm(`apply this rule to ${changes.length} files?`)) return { matched:rows.length, changed:0, failed:0 };
    var result = await persistArchiveRuleChanges(changes);
    applyArchiveRuleDomChanges(result.successful);
    if(!options.silent) showAppNotice(result.failed.length ? `updated ${result.successful.length} files; ${result.failed.length} could not be saved.` : `organized ${result.successful.length} file${result.successful.length === 1 ? '' : 's'}.`,result.failed.length ? 'error' : '');
    renderArchiveRules();
    return { matched:rows.length, changed:result.successful.length, failed:result.failed.length };
  }

  async function applyDraftArchiveRule() {
    var rule = archiveRuleFromBuilder(true);
    if(!rule) return showAppNotice('finish the rule before applying it.','error');
    var button = document.getElementById('archiveRuleApplyBtn');
    button.disabled = true;
    button.textContent = 'applying';
    try { await applyArchiveRuleToExisting(rule); }
    finally { button.textContent = 'apply to matches'; previewArchiveRule(); }
  }

  async function applySavedArchiveRule(id) {
    var rule = readArchiveRules().find(item => item.id === id);
    if(rule) await applyArchiveRuleToExisting(rule);
  }

  async function runEnabledArchiveRules() {
    if(!requireAdmin()) return;
    var rules = readArchiveRules().filter(rule => rule.enabled);
    if(!rules.length) return showAppNotice('there are no enabled rules.','error');
    if(!confirm(`run ${rules.length} enabled archive rule${rules.length === 1 ? '' : 's'} against the current vault?`)) return;
    var changed = 0;
    var failed = 0;
    for(var rule of rules) {
      var result = await applyArchiveRuleToExisting(rule,{ skipConfirm:true, silent:true });
      changed += result.changed;
      failed += result.failed;
    }
    renderArchiveRules();
    showAppNotice(failed ? `rules changed ${changed} files; ${failed} updates failed.` : `enabled rules finished / ${changed} changes.`,failed ? 'error' : '');
  }

  function initArchiveRules() {
    syncArchiveRuleMatchInput();
    syncArchiveRuleActionState();
    renderArchiveRules();
  }
