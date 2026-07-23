  const ADMIN_RECENT_FOLDERS_KEY = 'akrasia_admin_recent_folders_v1';
  var adminWorkspaceMode = 'folder';
  var adminWorkspacePath = '';
  var adminWorkspaceQuery = '';
  var adminWorkspaceSelectedKey = '';
  var adminWorkspaceHistoryEntries = [{ mode:'folder', path:'' }];
  var adminWorkspaceHistoryIndex = 0;
  var adminWorkspaceSearchTimer = 0;
  var adminWorkspaceSort = 'date';
  var adminWorkspaceSortDirection = -1;
  var adminWorkspaceDraggedKey = '';
  var adminWorkspaceDraggedFolderPath = '';

  function adminWorkspaceIsOpen() {
    return Boolean(document.getElementById('controlPanel')?.classList.contains('active') && document.getElementById('tab-review')?.classList.contains('active'));
  }

  function adminFolderPaths() {
    return Array.from(new Set(Array.from(document.querySelectorAll('.folder-block[data-standard-folder]')).map(folder => normalizeFolderPath(folder.getAttribute('data-standard-folder'))).filter(Boolean))).sort((a,b) => a.localeCompare(b));
  }

  function adminDirectRows(path) {
    path = normalizeFolderPath(path);
    return baseRows().filter(row => normalizeFolderPath(row.getAttribute('data-sub')) === path);
  }

  function adminDescendantRows(path) {
    path = normalizeFolderPath(path);
    return baseRows().filter(row => {
      var folder = normalizeFolderPath(row.getAttribute('data-sub'));
      return path ? (folder === path || folder.startsWith(path + '/')) : true;
    });
  }

  function adminChildFolders(path) {
    path = normalizeFolderPath(path);
    return adminFolderPaths().filter(folder => folderParentPath(folder) === path);
  }

  function adminRowKey(row) {
    return typeof timelineRowKey === 'function' ? timelineRowKey(row) : (row.getAttribute('data-id') || row.getAttribute('data-name') || '');
  }

  function adminRowFromKey(key) {
    return baseRows().find(row => adminRowKey(row) === key) || null;
  }

  function readAdminRecentFolders() {
    try {
      var value = JSON.parse(localStorage.getItem(ADMIN_RECENT_FOLDERS_KEY) || '[]');
      return Array.isArray(value) ? value.map(normalizeFolderPath).filter(path => !path || findFolderBlock(path)).slice(0,8) : [];
    } catch(error) { return []; }
  }

  function rememberAdminFolder(path) {
    path = normalizeFolderPath(path);
    var recent = readAdminRecentFolders().filter(item => item !== path);
    recent.unshift(path);
    try { localStorage.setItem(ADMIN_RECENT_FOLDERS_KEY,JSON.stringify(recent.slice(0,8))); } catch(error) {}
  }

  function adminWorkspaceHistoryState() {
    return { mode:adminWorkspaceMode, path:adminWorkspacePath };
  }

  function pushAdminWorkspaceHistory() {
    var state = adminWorkspaceHistoryState();
    var current = adminWorkspaceHistoryEntries[adminWorkspaceHistoryIndex];
    if(current && current.mode === state.mode && current.path === state.path) return;
    adminWorkspaceHistoryEntries = adminWorkspaceHistoryEntries.slice(0,adminWorkspaceHistoryIndex + 1);
    adminWorkspaceHistoryEntries.push(state);
    adminWorkspaceHistoryIndex = adminWorkspaceHistoryEntries.length - 1;
  }

  function adminWorkspaceHistory(direction) {
    var next = adminWorkspaceHistoryIndex + Number(direction || 0);
    if(next < 0 || next >= adminWorkspaceHistoryEntries.length) return;
    adminWorkspaceHistoryIndex = next;
    var state = adminWorkspaceHistoryEntries[next];
    adminWorkspaceMode = state.mode;
    adminWorkspacePath = state.path;
    adminWorkspaceQuery = '';
    var input = document.getElementById('adminWorkspaceSearch');
    if(input) input.value = '';
    renderAdminWorkspace();
  }

  function openAdminWorkspacePlace(mode, path, addHistory) {
    adminWorkspaceMode = ['folder','recent','loose','notes','visuals','enrichment'].includes(mode) ? mode : 'folder';
    adminWorkspacePath = adminWorkspaceMode === 'folder' ? normalizeFolderPath(path) : '';
    adminWorkspaceQuery = '';
    adminWorkspaceSelectedKey = '';
    var input = document.getElementById('adminWorkspaceSearch');
    if(input) input.value = '';
    if(adminWorkspaceMode === 'folder') rememberAdminFolder(adminWorkspacePath);
    if(addHistory !== false) pushAdminWorkspaceHistory();
    renderAdminWorkspace();
  }

  function adminNavigateFolder(path, addHistory) {
    openAdminWorkspacePlace('folder',path,addHistory);
  }

  function adminWorkspaceTitle() {
    if(adminWorkspaceQuery) return 'search results';
    if(adminWorkspaceMode === 'folder') return adminWorkspacePath ? folderDisplayName(adminWorkspacePath) : 'archive root';
    return { recent:'recently worked on', loose:'loose files', notes:'notes', visuals:'visuals', enrichment:'enrichment review' }[adminWorkspaceMode] || 'archive';
  }

  function adminWorkspaceRows() {
    var rows = baseRows();
    if(adminWorkspaceQuery) return rows.filter(row => adminWorkspaceRowMatchesSearch(row,adminWorkspaceQuery));
    if(adminWorkspaceMode === 'folder') return adminDirectRows(adminWorkspacePath);
    if(adminWorkspaceMode === 'loose') return rows.filter(row => !normalizeFolderPath(row.getAttribute('data-sub')));
    if(adminWorkspaceMode === 'notes') return rows.filter(row => row.getAttribute('data-type') === 'text' || String(row.getAttribute('data-notes') || '').trim());
    if(adminWorkspaceMode === 'visuals') return rows.filter(row => ['image','video'].includes(row.getAttribute('data-type')));
    if(adminWorkspaceMode === 'recent') return rows.slice().sort(adminWorkspaceDateCompare).slice(0,100);
    return rows;
  }

  function adminWorkspaceDateValue(row) {
    return sortKeyFromDateTime(row.getAttribute('data-asset-date') || '',row.getAttribute('data-asset-time') || '') || row.getAttribute('data-date') || '';
  }

  function adminWorkspaceDateCompare(a,b) {
    return adminWorkspaceDateValue(b).localeCompare(adminWorkspaceDateValue(a));
  }

  function adminWorkspaceSortRows(rows) {
    return rows.slice().sort((a,b) => {
      var value = 0;
      if(adminWorkspaceSort === 'title') value = String(a.getAttribute('data-title') || '').localeCompare(String(b.getAttribute('data-title') || ''));
      else if(adminWorkspaceSort === 'version') value = archiveVersionNumber(a) - archiveVersionNumber(b);
      else if(adminWorkspaceSort === 'type') value = String(a.getAttribute('data-type') || '').localeCompare(String(b.getAttribute('data-type') || ''));
      else value = adminWorkspaceDateValue(a).localeCompare(adminWorkspaceDateValue(b));
      if(!value) value = String(a.getAttribute('data-title') || '').localeCompare(String(b.getAttribute('data-title') || ''));
      return value * adminWorkspaceSortDirection;
    });
  }

  function setAdminWorkspaceSort(sort) {
    if(adminWorkspaceSort === sort) adminWorkspaceSortDirection *= -1;
    else {
      adminWorkspaceSort = sort;
      adminWorkspaceSortDirection = sort === 'date' ? -1 : 1;
    }
    renderAdminWorkspace();
  }

  function adminSearchParts(query) {
    var filters = {};
    var terms = [];
    cleanSingleLine(query,160).toLowerCase().split(/\s+/).filter(Boolean).forEach(token => {
      var match = token.match(/^(type|folder|date|version|tag|genre|theme|bpm|key|era|analysis|lyrics):(.*)$/);
      if(match && match[2]) filters[match[1]] = match[2];
      else terms.push(token);
    });
    return { filters, terms };
  }

  function adminEditDistance(a,b) {
    if(a === b) return 0;
    if(Math.abs(a.length - b.length) > 2) return 3;
    var prior = Array.from({ length:b.length + 1 },(_,index) => index);
    for(var i = 1; i <= a.length; i++) {
      var current = [i];
      for(var j = 1; j <= b.length; j++) current[j] = Math.min(current[j - 1] + 1,prior[j] + 1,prior[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      prior = current;
    }
    return prior[b.length];
  }

  function adminFuzzyIncludes(text,term) {
    text = String(text || '').toLowerCase();
    term = String(term || '').toLowerCase();
    if(!term || text.includes(term)) return true;
    if(term.length < 4) return false;
    return text.split(/[^a-z0-9]+/).filter(Boolean).some(word => adminEditDistance(word,term) <= (term.length >= 5 ? 2 : 1));
  }

  function adminWorkspaceRowMatchesSearch(row, query) {
    var structured = typeof archiveStructuredSearchParts === 'function' ? archiveStructuredSearchParts(query) : null;
    if(structured) {
      var structuredOnly = structured.filters.map(filter => `${filter.key}:${filter.value}`).join(' ');
      if(structuredOnly && !archiveRowMatchesStructuredSearch(row,structuredOnly)) return false;
      return structured.terms.every(term => adminFuzzyIncludes(archiveSearchText(row),term));
    }
    var parts = adminSearchParts(query);
    var folder = normalizeFolderPath(row.getAttribute('data-sub'));
    if(parts.filters.type && !adminFuzzyIncludes(row.getAttribute('data-type'),parts.filters.type)) return false;
    if(parts.filters.folder && !adminFuzzyIncludes(folder,parts.filters.folder)) return false;
    if(parts.filters.date && String(row.getAttribute('data-asset-date') || '').toLowerCase() !== parts.filters.date) return false;
    if(parts.filters.version && String(row.getAttribute('data-ver') || '').toLowerCase() !== normalizeVersionLabel(parts.filters.version,'v1').toLowerCase()) return false;
    if(parts.filters.tag && !adminFuzzyIncludes(`${row.getAttribute('data-mood') || ''} ${row.getAttribute('data-tags') || ''}`,parts.filters.tag)) return false;
    if(parts.filters.genre && !enrichmentTagValues(row).some(value => value.includes(parts.filters.genre))) return false;
    if(parts.filters.theme && !enrichmentTagValues(row,'lyrical-theme').some(value => value.includes(parts.filters.theme))) return false;
    if(parts.filters.bpm && !enrichmentBpmMatches(row.getAttribute('data-bpm'),parts.filters.bpm)) return false;
    if(parts.filters.key && !adminFuzzyIncludes(row.getAttribute('data-musical-key'),parts.filters.key)) return false;
    if(parts.filters.era && !adminFuzzyIncludes(row.getAttribute('data-era-names'),parts.filters.era.replace(/-/g,' '))) return false;
    if(parts.filters.analysis && row.getAttribute('data-analysis-status') !== parts.filters.analysis) return false;
    if(parts.filters.lyrics && row.getAttribute('data-lyrics-review') !== parts.filters.lyrics) return false;
    var text = archiveSearchText(row);
    return parts.terms.every(term => adminFuzzyIncludes(text,term));
  }

  function adminSearchReason(row, query) {
    if(!query) return '';
    var folder = row.getAttribute('data-sub') || 'archive root';
    var lower = query.toLowerCase();
    if(String(row.getAttribute('data-notes') || '').toLowerCase().includes(lower)) return 'matched note';
    if(String(row.getAttribute('data-lyrics') || '').toLowerCase().includes(lower)) return 'matched lyrics';
    if(folder.toLowerCase().includes(lower)) return `inside ${folder}`;
    return `matched ${row.getAttribute('data-type') || 'file'} metadata`;
  }

  function queueAdminWorkspaceSearch(value) {
    window.clearTimeout(adminWorkspaceSearchTimer);
    adminWorkspaceSearchTimer = window.setTimeout(() => {
      adminWorkspaceQuery = cleanSingleLine(value,160).toLowerCase();
      adminWorkspaceSelectedKey = '';
      renderAdminWorkspace();
    },100);
  }

  function handleAdminWorkspaceSearchKey(event) {
    if(event.key === 'Escape') {
      event.preventDefault();
      event.currentTarget.value = '';
      adminWorkspaceQuery = '';
      renderAdminWorkspace();
    }
  }

  function adminFolderMarkup(path) {
    var key = encodeURIComponent(path);
    var count = adminDescendantRows(path).length;
    var selected = selectedArchiveEntries.has(findFolderBlock(path));
    return `<article class="admin-workspace-entry folder-entry${selected ? ' selected' : ''}" draggable="true" ondragstart="adminWorkspaceFolderDragStart(event,decodeURIComponent('${key}'))" ondragend="adminWorkspaceDragEnd()" ondragover="adminWorkspaceDragOver(event)" ondrop="adminWorkspaceDrop(event,decodeURIComponent('${key}'))">
      <button class="admin-entry-select" type="button" aria-label="select folder" aria-pressed="${selected}" onclick="adminToggleWorkspaceFolder(event,decodeURIComponent('${key}'))"></button>
      <button class="admin-entry-open" type="button" onclick="adminNavigateFolder(decodeURIComponent('${key}'))"><span class="admin-entry-icon folder-icon"></span><span><strong>${escapeHtml(folderDisplayName(path))}</strong><small>${escapeHtml(path)}</small></span></button>
      <span class="admin-entry-date">${count} file${count === 1 ? '' : 's'}</span><span class="admin-entry-version">--</span><span class="admin-entry-type">folder</span>
      <button class="admin-entry-more" type="button" onclick="adminSelectWorkspaceFolder(decodeURIComponent('${key}'))" aria-label="folder details">...</button>
    </article>`;
  }

  function adminRowMarkup(row) {
    var rawKey = adminRowKey(row);
    var key = encodeURIComponent(rawKey);
    var type = row.getAttribute('data-type') || 'file';
    var selected = selectedArchiveEntries.has(row);
    var reason = adminSearchReason(row,adminWorkspaceQuery);
    return `<article class="admin-workspace-entry file-entry${selected ? ' selected' : ''}" draggable="true" ondragstart="adminWorkspaceDragStart(event,decodeURIComponent('${key}'))">
      <button class="admin-entry-select" type="button" aria-label="select ${escapeAttr(row.getAttribute('data-title') || 'file')}" aria-pressed="${selected}" onclick="adminToggleWorkspaceRow(event,decodeURIComponent('${key}'))"></button>
      <button class="admin-entry-open" type="button" onclick="adminSelectWorkspaceRow(decodeURIComponent('${key}'))" ondblclick="adminOpenWorkspaceRow(decodeURIComponent('${key}'))"><span class="admin-entry-icon ${escapeAttr(type)}-icon">${escapeHtml(type.slice(0,1))}</span><span><strong>${escapeHtml(row.getAttribute('data-title') || 'untitled')}</strong><small>${escapeHtml(reason || row.getAttribute('data-sub') || 'archive root')}</small></span></button>
      <span class="admin-entry-date">${escapeHtml(displayDateTime(row.getAttribute('data-asset-date'),row.getAttribute('data-asset-time')) || 'undated')}</span><span class="admin-entry-version">${escapeHtml(row.getAttribute('data-ver') || 'v1')}</span><span class="admin-entry-type">${escapeHtml(type)}</span>
      <button class="admin-entry-more" type="button" onclick="adminSelectWorkspaceRow(decodeURIComponent('${key}'))" aria-label="file details">...</button>
    </article>`;
  }

  function adminSearchGroupsMarkup(rows) {
    var groups = new Map();
    rows.forEach(row => {
      var folder = row.getAttribute('data-sub') || 'archive root';
      if(!groups.has(folder)) groups.set(folder,[]);
      groups.get(folder).push(row);
    });
    return Array.from(groups.entries()).sort((a,b) => a[0].localeCompare(b[0])).map(([folder,items]) => {
      var encoded = encodeURIComponent(folder === 'archive root' ? '' : folder);
      return `<section class="admin-search-group"><button type="button" onclick="adminNavigateFolder(decodeURIComponent('${encoded}'))"><span>${escapeHtml(folder)}</span><small>${items.length} match${items.length === 1 ? '' : 'es'}</small></button>${items.map(adminRowMarkup).join('')}</section>`;
    }).join('');
  }

  function renderAdminWorkspaceBreadcrumbs() {
    var target = document.getElementById('adminWorkspaceBreadcrumbs');
    if(!target) return;
    if(adminWorkspaceQuery || adminWorkspaceMode !== 'folder') {
      target.innerHTML = `<button type="button" onclick="adminNavigateFolder('')">archive</button><span>/</span><strong>${escapeHtml(adminWorkspaceTitle())}</strong>`;
      return;
    }
    var parts = adminWorkspacePath ? adminWorkspacePath.split('/') : [];
    var built = '';
    var html = '<button type="button" onclick="adminNavigateFolder(\'\')">archive</button>';
    parts.forEach((part,index) => {
      built = normalizeFolderPath(built ? `${built}/${part}` : part);
      var encoded = encodeURIComponent(built);
      html += `<span>/</span>${index === parts.length - 1 ? `<strong>${escapeHtml(part)}</strong>` : `<button type="button" onclick="adminNavigateFolder(decodeURIComponent('${encoded}'))">${escapeHtml(part)}</button>`}`;
    });
    target.innerHTML = html;
  }

  function renderAdminSidebarFolders(filterValue) {
    var target = document.getElementById('adminSidebarFolders');
    if(!target) return;
    var filter = cleanSingleLine(filterValue == null ? document.getElementById('adminFolderFilter')?.value : filterValue,100).toLowerCase();
    var paths = adminFolderPaths().filter(path => !filter || adminFuzzyIncludes(path,filter));
    var recent = filter ? [] : readAdminRecentFolders().filter(Boolean);
    var recentMarkup = recent.length ? `<div class="admin-sidebar-group"><small>recent locations</small>${recent.map(path => adminSidebarFolderButton(path)).join('')}</div>` : '';
    var folderMarkup = paths.slice(0,120).map(path => adminSidebarFolderButton(path)).join('');
    target.innerHTML = `${recentMarkup}<div class="admin-sidebar-group"><small>${filter ? 'matching folders' : 'all folders'}</small>${folderMarkup || '<span class="admin-sidebar-empty">no folders found</span>'}</div>`;
  }

  function adminSidebarFolderButton(path) {
    var encoded = encodeURIComponent(path);
    var active = adminWorkspaceMode === 'folder' && adminWorkspacePath === path;
    return `<button class="${active ? 'active' : ''}" type="button" style="--folder-level:${Math.min(4,folderPathDepth(path))}" onclick="adminNavigateFolder(decodeURIComponent('${encoded}'))" ondragover="adminWorkspaceDragOver(event)" ondrop="adminWorkspaceDrop(event,decodeURIComponent('${encoded}'))"><span>${escapeHtml(folderDisplayName(path))}</span><small>${adminDescendantRows(path).length}</small></button>`;
  }

  function renderAdminWorkspace() {
    if(!document.getElementById('adminFileWorkspace')) return;
    document.getElementById('adminFileWorkspace').classList.toggle('enrichment-mode',adminWorkspaceMode === 'enrichment');
    renderAdminSidebarFolders();
    renderAdminWorkspaceBreadcrumbs();
    document.querySelectorAll('[data-admin-place]').forEach(button => button.classList.toggle('active',!adminWorkspaceQuery && button.getAttribute('data-admin-place') === adminWorkspaceMode));
    var rootCount = document.getElementById('adminRootCount');
    if(rootCount) rootCount.textContent = baseRows().length;
    var reviewCount = document.getElementById('adminReviewCount');
    if(reviewCount) {
      var pending = Array.isArray(archiveEnrichment?.suggestions) ? archiveEnrichment.suggestions.filter(item => ['pending','draft','needs_review','stale'].includes(item.status)).length : 0;
      reviewCount.textContent = pending ? String(pending) : '';
    }
    var back = document.getElementById('adminWorkspaceBack');
    var forward = document.getElementById('adminWorkspaceForward');
    if(back) back.disabled = adminWorkspaceHistoryIndex <= 0;
    if(forward) forward.disabled = adminWorkspaceHistoryIndex >= adminWorkspaceHistoryEntries.length - 1;

    if(adminWorkspaceMode === 'enrichment' && typeof renderEnrichmentWorkspace === 'function') {
      renderEnrichmentWorkspace();
      return;
    }

    var folders = adminWorkspaceQuery || adminWorkspaceMode !== 'folder' ? [] : adminChildFolders(adminWorkspacePath);
    var allRows = adminWorkspaceSortRows(adminWorkspaceRows());
    var shownRows = allRows.slice(0,250);
    var list = document.getElementById('adminWorkspaceList');
    if(list) list.innerHTML = adminWorkspaceQuery ? adminSearchGroupsMarkup(shownRows) : folders.map(adminFolderMarkup).join('') + shownRows.map(adminRowMarkup).join('');
    var total = folders.length + allRows.length;
    var empty = document.getElementById('adminWorkspaceEmpty');
    if(empty) {
      empty.hidden = total > 0;
      empty.textContent = adminWorkspaceQuery ? 'nothing in the archive matches that search.' : 'nothing is here yet. use + to add a folder, note, or file.';
    }
    document.getElementById('adminWorkspaceTitle').textContent = adminWorkspaceTitle();
    document.getElementById('adminWorkspaceKicker').textContent = adminWorkspaceQuery ? 'searching the whole archive' : (adminWorkspaceMode === 'folder' ? `archive / ${adminWorkspacePath || 'root'}` : 'smart place');
    document.getElementById('adminWorkspaceCount').textContent = `${total} item${total === 1 ? '' : 's'}${allRows.length > shownRows.length ? ` / showing ${shownRows.length}` : ''}`;
    renderAdminWorkspaceInspector();
    renderAdminWorkspaceSelection();
  }

  function adminSelectWorkspaceRow(key) {
    adminWorkspaceSelectedKey = key;
    renderAdminWorkspaceInspector();
    document.getElementById('adminFileWorkspace')?.classList.add('has-selection');
  }

  function adminSelectWorkspaceFolder(path) {
    adminWorkspaceSelectedKey = `folder:${normalizeFolderPath(path)}`;
    renderAdminWorkspaceInspector();
    document.getElementById('adminFileWorkspace')?.classList.add('has-selection');
  }

  function closeAdminWorkspaceInspector() {
    if(adminWorkspaceMode === 'enrichment' && typeof closeEnrichmentInspector === 'function') return closeEnrichmentInspector();
    adminWorkspaceSelectedKey = '';
    document.getElementById('adminFileWorkspace')?.classList.remove('has-selection');
    renderAdminWorkspaceInspector();
  }

  function renderAdminWorkspaceInspector() {
    var target = document.getElementById('adminWorkspaceInspector');
    if(!target) return;
    if(adminWorkspaceMode === 'enrichment' && typeof renderEnrichmentInspector === 'function') return renderEnrichmentInspector();
    if(!adminWorkspaceSelectedKey) {
      target.innerHTML = '<div class="admin-inspector-empty"><span>select something</span><p>Artwork, notes, versions, dates, and organization controls appear here.</p></div>';
      document.getElementById('adminFileWorkspace')?.classList.remove('has-selection');
      return;
    }
    if(adminWorkspaceSelectedKey.startsWith('folder:')) {
      var path = normalizeFolderPath(adminWorkspaceSelectedKey.slice(7));
      var folder = findFolderBlock(path);
      if(!folder) { adminWorkspaceSelectedKey = ''; return renderAdminWorkspaceInspector(); }
      var count = adminDescendantRows(path).length;
      var note = findFolderNoteRow(path)?.getAttribute('data-text-content') || '';
      var encoded = encodeURIComponent(path);
      target.innerHTML = `<div class="admin-inspector-head"><small>folder</small><button type="button" onclick="closeAdminWorkspaceInspector()">close</button></div><div class="admin-inspector-folder-art"><span>${escapeHtml(folderDisplayName(path).slice(0,2).toLowerCase())}</span></div><h3>${escapeHtml(folderDisplayName(path))}</h3><p class="admin-inspector-path">archive / ${escapeHtml(path)}</p><div class="admin-inspector-stats"><span>files<strong>${count}</strong></span><span>subfolders<strong>${adminChildFolders(path).length}</strong></span></div>${note ? `<div class="admin-inspector-notes"><small>folder note</small>${escapeHtml(note).replace(/\n/g,'<br>')}</div>` : ''}<div class="admin-inspector-actions"><button class="primary" type="button" onclick="adminNavigateFolder(decodeURIComponent('${encoded}'))">open folder</button><button type="button" onclick="adminOpenFolderEditor(decodeURIComponent('${encoded}'))">rename + note</button><button type="button" onclick="adminToggleWorkspaceFolder(event,decodeURIComponent('${encoded}'))">select folder</button></div>`;
      return;
    }
    var row = adminRowFromKey(adminWorkspaceSelectedKey);
    if(!row) { adminWorkspaceSelectedKey = ''; return renderAdminWorkspaceInspector(); }
    var key = encodeURIComponent(adminWorkspaceSelectedKey);
    var cover = row.getAttribute('data-cover') || row.getAttribute('data-cover-url') || (row.getAttribute('data-type') === 'image' ? row.getAttribute('data-img-src') || row.getAttribute('data-file-url') : '');
    var notes = row.getAttribute('data-notes') || (row.getAttribute('data-type') === 'text' ? row.getAttribute('data-text-content') : '');
    var path = row.getAttribute('data-sub') || '';
    var pathEncoded = encodeURIComponent(path);
    target.innerHTML = `<div class="admin-inspector-head"><small>${escapeHtml(row.getAttribute('data-type') || 'file')}</small><button type="button" onclick="closeAdminWorkspaceInspector()">close</button></div><div class="admin-inspector-art">${cover ? `<img src="${escapeAttr(cover)}" alt="">` : `<span>${escapeHtml((row.getAttribute('data-type') || 'file').slice(0,3))}</span>`}</div><h3>${escapeHtml(row.getAttribute('data-title') || 'untitled')}</h3><p class="admin-inspector-path">${escapeHtml(path || 'archive root')} / ${escapeHtml(row.getAttribute('data-ver') || 'v1')}</p><div class="admin-inspector-stats"><span>worked on<strong>${escapeHtml(row.getAttribute('data-asset-date') || 'undated')}</strong></span><span>tag<strong>${escapeHtml(row.getAttribute('data-mood') || 'raw')}</strong></span></div>${notes ? `<div class="admin-inspector-notes"><small>notes</small>${escapeHtml(notes).replace(/\n/g,'<br>')}</div>` : ''}${typeof enrichmentMetadataHtml === 'function' ? enrichmentMetadataHtml(row,true) : ''}<div class="admin-inspector-actions"><button class="primary" type="button" onclick="adminOpenWorkspaceRow(decodeURIComponent('${key}'))">${row.getAttribute('data-type') === 'audio' ? 'play' : 'open'}</button><button type="button" onclick="adminEditWorkspaceRow(decodeURIComponent('${key}'))">edit file</button><button type="button" onclick="adminShowWorkspaceRowFolder(decodeURIComponent('${pathEncoded}'))">show in folder</button><button type="button" onclick="adminToggleWorkspaceRow(event,decodeURIComponent('${key}'))">select</button><button class="danger" type="button" onclick="adminRemoveWorkspaceRow(decodeURIComponent('${key}'))">remove</button></div>`;
  }

  function adminOpenWorkspaceRow(key) {
    var row = adminRowFromKey(key);
    if(row) handleRowClick({ target:row },row);
  }

  function adminEditWorkspaceRow(key) {
    var row = adminRowFromKey(key);
    if(row) openEditAsset(row);
  }

  function adminShowWorkspaceRowFolder(path) {
    closeAdminWorkspaceInspector();
    adminNavigateFolder(path);
  }

  async function adminRemoveWorkspaceRow(key) {
    var row = adminRowFromKey(key);
    if(!row) return;
    await removeAsset(row);
    adminWorkspaceSelectedKey = '';
    renderAdminWorkspace();
  }

  function adminOpenFolderEditor(path) {
    var folder = findFolderBlock(path);
    var button = folder?.querySelector(':scope > .folder-row .folder-action');
    if(folder && button) openFolderEditor({ preventDefault(){}, stopPropagation(){} },button);
  }

  function adminToggleWorkspaceRow(event,key) {
    if(event) { event.preventDefault(); event.stopPropagation(); }
    var row = adminRowFromKey(key);
    if(row) setArchiveEntrySelected(row,!selectedArchiveEntries.has(row));
    renderAdminWorkspace();
  }

  function adminToggleWorkspaceFolder(event,path) {
    if(event) { event.preventDefault(); event.stopPropagation(); }
    var folder = findFolderBlock(path);
    if(folder) setArchiveEntrySelected(folder,!selectedArchiveEntries.has(folder));
    renderAdminWorkspace();
  }

  function renderAdminWorkspaceSelection() {
    var bar = document.getElementById('adminWorkspaceSelection');
    if(!bar) return;
    var rows = selectedArchiveRows();
    var folders = topLevelSelectedFolders();
    var direct = Array.from(selectedArchiveEntries).filter(entry => entry.classList?.contains('frow')).length;
    var total = folders.length + direct;
    bar.hidden = total === 0;
    document.getElementById('adminWorkspaceSelectionCount').textContent = folders.length ? `${folders.length} folders / ${rows.length} files` : `${rows.length} selected`;
  }

  async function moveAdminWorkspaceSelection() {
    var destination = document.getElementById('adminWorkspaceMoveDestination')?.value || '';
    var original = document.getElementById('archiveSelectionDestination');
    if(original) original.value = destination;
    await moveArchiveSelection();
    if(document.getElementById('adminWorkspaceMoveDestination')) document.getElementById('adminWorkspaceMoveDestination').value = '';
    renderAdminWorkspace();
  }

  function adminWorkspaceDragStart(event,key) {
    adminWorkspaceDraggedKey = key;
    adminWorkspaceDraggedFolderPath = '';
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain',key);
  }

  function adminWorkspaceFolderDragStart(event,path) {
    adminWorkspaceDraggedKey = '';
    adminWorkspaceDraggedFolderPath = normalizeFolderPath(path);
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain',`folder:${adminWorkspaceDraggedFolderPath}`);
  }

  function adminWorkspaceDragEnd() {
    adminWorkspaceDraggedKey = '';
    adminWorkspaceDraggedFolderPath = '';
  }

  function adminWorkspaceDragOver(event) {
    if(!adminWorkspaceDraggedKey && !adminWorkspaceDraggedFolderPath) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  }

  async function adminWorkspaceDrop(event,path) {
    event.preventDefault();
    var transfer = event.dataTransfer.getData('text/plain');
    var draggedFolderPath = adminWorkspaceDraggedFolderPath || (transfer.startsWith('folder:') ? normalizeFolderPath(transfer.slice(7)) : '');
    if(draggedFolderPath) {
      adminWorkspaceDragEnd();
      var folder = findFolderBlock(draggedFolderPath);
      var targetFolder = normalizeFolderPath(path);
      if(!folder || targetFolder === draggedFolderPath || targetFolder.startsWith(draggedFolderPath + '/')) return;
      var newPath = normalizeFolderPath(targetFolder ? `${targetFolder}/${folderDisplayName(draggedFolderPath)}` : folderDisplayName(draggedFolderPath));
      if(newPath === draggedFolderPath) return;
      if(findFolderBlock(newPath)) return showAppNotice('that folder already exists there.','error');
      try {
        await persistFolderRename(folder,newPath);
        var destination = targetFolder ? ensureFolder(targetFolder) : document.getElementById('directoryContainer');
        destination.appendChild(folder);
        rewriteFolderPaths(folder,newPath,true);
        refreshExplorerAfterFolderAction();
        adminWorkspacePath = targetFolder;
        renderAdminWorkspace();
        showAppNotice(`moved ${folderDisplayName(newPath)}.`);
      } catch(error) { showAppNotice(error.message || 'the folder could not be moved.','error'); }
      return;
    }
    var key = adminWorkspaceDraggedKey || transfer;
    adminWorkspaceDraggedKey = '';
    var row = adminRowFromKey(key);
    if(!row) return;
    var target = normalizeFolderPath(path);
    archiveDestination(target).appendChild(row);
    setRowBatch(row,target);
    try { await persistRowsBatch([row],target); }
    catch(error) { showAppNotice(error.message || 'the move could not be saved.','error'); }
    removeEmptyFolders();
    refreshExplorerAfterFolderAction();
    adminWorkspacePath = target;
    renderAdminWorkspace();
  }

  function toggleAdminAddMenu(force) {
    var menu = document.getElementById('adminAddMenu');
    if(!menu) return;
    menu.hidden = typeof force === 'boolean' ? !force : !menu.hidden;
  }

  function openAdminReviewTool(tab) {
    togglePanel(true);
    switchPanelTab('review');
    openAdminWorkspacePlace('enrichment');
    if(typeof setEnrichmentWorkspaceTab === 'function') setEnrichmentWorkspaceTab(tab === 'eras' ? 'eras' : 'review');
    setAdminToolHeading(tab === 'eras' ? 'creative eras' : 'AI review',tab === 'eras' ? 'Define artist-led eras and confirm revision assignments.' : 'Review local lyric, tag, theme, and technical metadata suggestions before anything is published.');
  }

  function openAdminAdvancedTool(name) {
    if(!['rules','stats'].includes(name)) return;
    togglePanel(true);
    switchPanelTab(name);
    setAdminToolHeading(name === 'rules' ? 'organization rules' : 'archive stats',name === 'rules' ? 'Preview filename and date rules, then apply only the changes you confirm.' : 'Catalog health and listening activity tied back to individual files.');
  }

  function setVaultIntakeMode(mode) {
    mode = mode === 'bandlab' ? 'bandlab' : 'files';
    var pane = document.getElementById('tab-upload');
    if(!pane) return;
    pane.setAttribute('data-intake-mode',mode);
    pane.querySelectorAll('[data-intake-mode-button]').forEach(button => button.classList.toggle('active',button.getAttribute('data-intake-mode-button') === mode));
  }

  function toggleVaultIntakeDetails(force) {
    var pane = document.getElementById('tab-upload');
    var button = pane?.querySelector('.vault-intake-details-toggle');
    if(!pane || !button) return;
    var open = typeof force === 'boolean' ? force : !pane.classList.contains('show-details');
    pane.classList.toggle('show-details',open);
    button.textContent = open ? 'hide details' : 'add details';
    button.setAttribute('aria-expanded',open ? 'true' : 'false');
  }

  function closeAdminUploadTool() {
    toggleVaultIntakeDetails(false);
    togglePanel(false);
  }

  function openAdminCreateDialog(type) {
    toggleAdminAddMenu(false);
    var dialog = document.getElementById('adminCreateDialog');
    var folderForm = document.getElementById('adminCreateFolderForm');
    var noteForm = document.getElementById('adminCreateNoteForm');
    folderForm.hidden = type !== 'folder';
    noteForm.hidden = type !== 'note';
    dialog.hidden = false;
    if(type === 'folder') {
      var input = document.getElementById('adminCreateFolderPath');
      input.value = adminWorkspaceMode === 'folder' && adminWorkspacePath ? `${adminWorkspacePath}/` : '';
      input.focus();
    } else {
      document.getElementById('adminCreateNoteFolder').value = adminWorkspaceMode === 'folder' ? adminWorkspacePath : '';
      document.getElementById('adminCreateNoteTitle').focus();
    }
  }

  function closeAdminCreateDialog() {
    document.getElementById('adminCreateDialog').hidden = true;
  }

  async function createAdminWorkspaceFolder(event) {
    event.preventDefault();
    if(!requireAdmin()) return;
    var path = normalizeFolderPath(document.getElementById('adminCreateFolderPath').value);
    if(!path || path === ROOT_ARCHIVE_PATH) return showAppNotice('enter a valid folder path.','error');
    if(findFolderBlock(path)) return showAppNotice('that folder already exists.','error');
    ensureFolder(path);
    var saveButton = document.getElementById('adminCreateFolderSave');
    saveButton.disabled = true;
    saveButton.textContent = 'creating';
    try {
      var synced = await persistArchiveFolder(path);
      updateDirectoryDropdown();
      updateCounts();
      closeAdminCreateDialog();
      setArchiveSmartView('all');
      var createdFolder = findFolderBlock(path);
      if(createdFolder) setFolderCollapsed(createdFolder,false,true);
      showAppNotice(synced ? `created ${folderDisplayName(path)}.` : `created ${folderDisplayName(path)} on this device. run the latest Supabase setup to sync empty folders across devices.`);
    } catch(error) {
      findFolderBlock(path)?.remove();
      showAppNotice(error.message || 'the folder could not be created.','error');
    } finally {
      saveButton.disabled = false;
      saveButton.textContent = 'create folder';
    }
  }

  async function createAdminWorkspaceNote(event) {
    event.preventDefault();
    if(!requireAdmin()) return;
    var title = cleanSingleLine(document.getElementById('adminCreateNoteTitle').value,120);
    var text = cleanMultiline(document.getElementById('adminCreateNoteBody').value,12000);
    var folder = normalizeFolderPath(document.getElementById('adminCreateNoteFolder').value);
    if(!title || !text) return showAppNotice('give the note a title and some text.','error');
    var timestamp = easternDateTimeParts(new Date());
    var record = {
      filename:`${title.replace(/[^a-z0-9_-]+/gi,'-').replace(/^-|-$/g,'').toLowerCase() || 'note'}.txt`, title, version:'v1', batch:folder || ROOT_ARCHIVE_PATH,
      asset_date:timestamp.date, asset_time:timestamp.time || null, mood:'notes', mood_color:'#d8d8d8', type:'text', size_label:`${text.length} chars`, file_url:'', cover_url:'', storage_path:'', cover_storage_path:'', notes:'', synced_lyrics:'', text_content:text,
      project_key:folder ? normalizeFolderPath(folderDisplayName(folder)) : '', world_title:folder ? folderDisplayName(folder) : '', asset_role:'note', object_style:'notebook', credits:[], world_summary:'', sort_order:adminDirectRows(folder).length * 1000 + 1000
    };
    var button = document.getElementById('adminCreateNoteSave');
    button.disabled = true;
    button.textContent = 'saving';
    try {
      if(isRemoteReady && supabaseClient) {
        var insert = await supabaseClient.from('archive_assets').insert(record).select().single();
        if(insert.error && /asset_time|synced_lyrics|project_key|world_title|asset_role|object_style|credits|world_summary|schema cache|column/i.test(insert.error.message || '')) insert = await supabaseClient.from('archive_assets').insert(withoutFolderNoteOptionalFields(record)).select().single();
        if(insert.error) throw insert.error;
        record = Object.assign({},record,insert.data || {});
      }
      var row = createRowFromRecord(record);
      document.getElementById('adminCreateNoteForm').reset();
      closeAdminCreateDialog();
      setArchiveSmartView('all');
      row.scrollIntoView({ behavior:document.documentElement.dataset.motion === 'off' ? 'auto' : 'smooth',block:'center' });
      showAppNotice('note added to the archive.');
    } catch(error) { showAppNotice(error.message || 'the note could not be saved.','error'); }
    finally { button.disabled = false; button.textContent = 'save note'; }
  }

  function openAdminUploadTool(showBandlab) {
    toggleAdminAddMenu(false);
    togglePanel(true);
    switchPanelTab('upload');
    setAdminToolHeading(showBandlab ? 'BandLab + analysis import' : 'add files',showBandlab ? 'Scan the backup read-only, then choose revisions, covers, and private AI sidecars to import.' : 'Add files to the current archive without leaving the archive structure behind.');
    setVaultIntakeMode(showBandlab ? 'bandlab' : 'files');
    window.requestAnimationFrame(() => {
      if(showBandlab) document.querySelector('.bandlab-sync-panel')?.scrollIntoView({ block:'start' });
      else {
        var root = document.getElementById('injRoot');
        var batch = document.getElementById('injBatch');
        var path = adminWorkspaceMode === 'folder' ? adminWorkspacePath : '';
        if(root) root.checked = !path;
        toggleRootPlacement();
        if(path && batch) batch.value = path;
        document.getElementById('injFile')?.focus();
      }
    });
  }

  function initAdminWorkspace() {
    var dialog = document.getElementById('adminCreateDialog');
    if(dialog && dialog.parentElement !== document.body) document.body.appendChild(dialog);
    document.addEventListener('click', function(event) {
      var menu = document.getElementById('adminAddMenu');
      if(menu && !menu.hidden && !event.target.closest('#adminAddMenu') && !event.target.closest('#adminAddTrigger')) menu.hidden = true;
    });
  }

  function setAdminToolHeading(title,description) {
    var titleNode = document.getElementById('adminToolTitle');
    var descriptionNode = document.getElementById('adminToolDescription');
    if(titleNode) titleNode.textContent = title;
    if(descriptionNode) descriptionNode.textContent = description;
  }
