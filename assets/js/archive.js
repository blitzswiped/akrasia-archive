  var archiveSearchQuery = '';
  var archiveSmartView = 'all';
  var archiveSearchTimer = 0;
  var archiveSearchIndex = new WeakMap();
  var editingFolder = null;
  var persistedArchiveFolders = new Set();
  const ARCHIVE_FOLDER_REGISTRY_KEY = 'akrasia_archive_folders_v1';

  function readLocalArchiveFolders() {
    try {
      var value = JSON.parse(localStorage.getItem(ARCHIVE_FOLDER_REGISTRY_KEY) || '[]');
      return Array.isArray(value) ? value.map(normalizeFolderPath).filter(path => path && path !== ROOT_ARCHIVE_PATH) : [];
    } catch(error) { return []; }
  }

  function saveLocalArchiveFolders() {
    try { localStorage.setItem(ARCHIVE_FOLDER_REGISTRY_KEY,JSON.stringify(Array.from(persistedArchiveFolders).sort())); } catch(error) {}
  }

  function archiveFoldersTableMissing(error) {
    return /archive_folders|relation .* does not exist|schema cache|42p01/i.test(error?.message || error?.code || '');
  }

  async function loadRemoteArchiveFolders() {
    persistedArchiveFolders.clear();
    var localPaths = readLocalArchiveFolders();
    localPaths.forEach(path => {
      persistedArchiveFolders.add(path);
      ensureFolder(path);
    });
    if(!isRemoteReady || !supabaseClient) return;
    var result = await supabaseClient.from('archive_folders').select('path,sort_order').order('sort_order',{ ascending:true });
    if(result.error) {
      if(!archiveFoldersTableMissing(result.error)) console.warn('archive folders could not load',result.error);
      return;
    }
    (result.data || []).forEach(record => {
      var path = normalizeFolderPath(record.path);
      if(!path || path === ROOT_ARCHIVE_PATH) return;
      persistedArchiveFolders.add(path);
      ensureFolder(path);
    });
    if(isAdmin && localPaths.length) {
      var remotePaths = new Set((result.data || []).map(record => normalizeFolderPath(record.path)));
      var missing = localPaths.filter(path => !remotePaths.has(path)).map((path,index) => ({ path, sort_order:((result.data || []).length + index + 1) * 1000 }));
      if(missing.length) {
        var sync = await supabaseClient.from('archive_folders').upsert(missing,{ onConflict:'path' });
        if(sync.error && !archiveFoldersTableMissing(sync.error)) console.warn('local archive folders could not sync',sync.error);
      }
    }
    saveLocalArchiveFolders();
  }

  async function persistArchiveFolder(path) {
    path = normalizeFolderPath(path);
    if(!path || path === ROOT_ARCHIVE_PATH) return false;
    persistedArchiveFolders.add(path);
    saveLocalArchiveFolders();
    if(!isRemoteReady || !supabaseClient) return false;
    var result = await supabaseClient.from('archive_folders').upsert({ path, sort_order:persistedArchiveFolders.size * 1000 },{ onConflict:'path' });
    if(result.error) {
      if(archiveFoldersTableMissing(result.error)) return false;
      persistedArchiveFolders.delete(path);
      saveLocalArchiveFolders();
      throw result.error;
    }
    return true;
  }

  async function deletePersistedFolderTree(root) {
    root = normalizeFolderPath(root);
    var paths = Array.from(persistedArchiveFolders).filter(path => path === root || path.startsWith(root + '/'));
    paths.forEach(path => persistedArchiveFolders.delete(path));
    saveLocalArchiveFolders();
    if(!isRemoteReady || !supabaseClient || !paths.length) return;
    for(var offset = 0; offset < paths.length; offset += 100) {
      var result = await supabaseClient.from('archive_folders').delete().in('path',paths.slice(offset,offset + 100));
      if(result.error && !archiveFoldersTableMissing(result.error)) throw result.error;
    }
  }

  async function renamePersistedFolderTree(oldRoot,newRoot) {
    oldRoot = normalizeFolderPath(oldRoot);
    newRoot = normalizeFolderPath(newRoot);
    var paths = Array.from(persistedArchiveFolders).filter(path => path === oldRoot || path.startsWith(oldRoot + '/'));
    if(!paths.length) return;
    var records = paths.map((path,index) => ({
      path:path === oldRoot ? newRoot : normalizeFolderPath(newRoot + path.slice(oldRoot.length)),
      sort_order:(index + 1) * 1000
    }));
    if(isRemoteReady && supabaseClient) {
      var upsert = await supabaseClient.from('archive_folders').upsert(records,{ onConflict:'path' });
      if(upsert.error && !archiveFoldersTableMissing(upsert.error)) throw upsert.error;
      if(!upsert.error) {
        var remove = await supabaseClient.from('archive_folders').delete().in('path',paths);
        if(remove.error && !archiveFoldersTableMissing(remove.error)) {
          await supabaseClient.from('archive_folders').delete().in('path',records.map(record => record.path));
          throw remove.error;
        }
      }
    }
    paths.forEach(path => persistedArchiveFolders.delete(path));
    records.forEach(record => persistedArchiveFolders.add(record.path));
    saveLocalArchiveFolders();
  }

  function readFolderStates() {
    try {
      var states = JSON.parse(localStorage.getItem(FOLDER_STATE_KEY) || '{}');
      return states && typeof states === 'object' && !Array.isArray(states) ? states : {};
    } catch(error) { return {}; }
  }

  function folderShouldStartCollapsed(path) {
    return readFolderStates()[normalizeFolderPath(path)] !== 'open';
  }

  function setFolderCollapsed(folder,collapsed,persist) {
    if(!folder) return;
    folder.classList.toggle('collapsed',Boolean(collapsed));
    var toggle = folder.querySelector(':scope > .folder-row .folder-toggle');
    if(toggle) toggle.textContent = collapsed ? '[+]' : '[-]';
    if(persist !== false) {
      var states = readFolderStates();
      states[normalizeFolderPath(folder.getAttribute('data-standard-folder'))] = collapsed ? 'closed' : 'open';
      try { localStorage.setItem(FOLDER_STATE_KEY,JSON.stringify(states)); } catch(error) {}
    }
  }

  function toggleFolder(header) {
    var block = header.closest('.folder-block');
    if(!block) return;
    setFolderCollapsed(block,!block.classList.contains('collapsed'));
  }

  // Toggle Cover Input based on file type
  function toggleCoverInput() {
    var type = document.getElementById('injType').value;
    var rows = document.querySelectorAll('.cover-row');
    rows.forEach(r => r.style.display = (type === 'audio') ? 'block' : 'none');
    document.getElementById('injFile').accept = type === 'audio' ? 'audio/*' : (type === 'image' ? 'image/*' : (type === 'video' ? 'video/*' : '.txt,text/plain'));
  }

  function toggleRootPlacement(force) {
    var checkbox = document.getElementById('injRoot');
    var select = document.getElementById('injBatch');
    var subfolder = document.getElementById('injSubfolder');
    if(!checkbox || !select || !subfolder) return;
    if(typeof force === 'boolean') checkbox.checked = force;
    var atRoot = checkbox.checked;
    checkbox.closest('.root-placement')?.classList.toggle('active', atRoot);
    select.disabled = atRoot;
    subfolder.disabled = atRoot;
    if(atRoot) {
      select.value = '__root__';
      subfolder.value = '';
      if(typeof force !== 'boolean') showAppNotice('new files will be placed directly in archive root.');
    } else if(typeof force !== 'boolean' && select.value === '__root__') {
      var firstFolder = Array.from(select.options).find(option => option.value !== '__root__');
      if(firstFolder) select.value = firstFolder.value;
    }
  }

  function setEditDestinationRoot() {
    var field = document.getElementById('editFolder');
    if(field) { field.value = ''; field.focus(); }
  }

  function normalizeFolderPath(value) {
    return String(value || '')
      .split('/')
      .map(part => part.trim().toLowerCase().replace(/[<>\\:"|?*\x00-\x1f]/g, '').replace(/\s+/g, ' ').slice(0, 64))
      .filter(Boolean)
      .slice(0, 12)
      .join('/')
      .slice(0, 240);
  }

  function normalizeArchiveDestination(value) {
    var path = normalizeFolderPath(value);
    return path === ROOT_ARCHIVE_PATH ? '' : path;
  }

  function cleanSingleLine(value, maxLength) {
    return String(value || '').replace(/[\x00-\x1f\x7f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, maxLength || 160);
  }

  function cleanMultiline(value, maxLength) {
    return String(value || '').replace(/\r/g, '').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '').replace(/<\/?script\b[^>]*>/gi, '').trim().slice(0, maxLength || 12000);
  }

  function parseCreditsText(value) {
    return cleanMultiline(value, 6000).split('\n').map(line => {
      var parts = line.split(':');
      var role = cleanSingleLine(parts.shift(), 60);
      var name = cleanSingleLine(parts.join(':'), 120);
      return role && name ? { role, name } : null;
    }).filter(Boolean).slice(0, 80);
  }

  function creditsToText(value) {
    var credits = Array.isArray(value) ? value : [];
    return credits.map(item => `${cleanSingleLine(item && item.role, 60)}: ${cleanSingleLine(item && item.name, 120)}`).filter(line => line !== ': ').join('\n');
  }

  function safeWorldRole(value) {
    var role = cleanSingleLine(value, 40).toLowerCase();
    return /^(version|visual|note|artifact)$/.test(role) ? role : 'version';
  }

  function safeObjectStyle(value) {
    var style = cleanSingleLine(value, 30).toLowerCase();
    return ['case','notebook','tape','contact-sheet'].includes(style) ? style : 'case';
  }

  function safeDateTime(value) {
    if(!value) return '';
    var date = new Date(value);
    return Number.isFinite(date.getTime()) ? date.toISOString() : '';
  }

  function safeExternalUrl(value) {
    var raw = String(value || '').trim();
    if(!raw) return '';
    try {
      var parsed = new URL(raw);
      return parsed.protocol === 'https:' ? parsed.href : '';
    } catch(error) { return ''; }
  }

  function safeHexColor(value, fallback) {
    var color = String(value || '').trim();
    return /^#[0-9a-f]{6}$/i.test(color) ? color : (fallback || '#ffffff');
  }

  function showAppNotice(message, tone) {
    var toast = document.getElementById('appToast');
    if(!toast) return;
    toast.textContent = cleanSingleLine(message, 260);
    toast.classList.toggle('error', tone === 'error');
    toast.classList.add('active');
    clearTimeout(window.appToastTimer);
    window.appToastTimer = setTimeout(() => toast.classList.remove('active'), 3200);
  }

  function validateAssetFile(file, type) {
    if(!file) return 'select a file.';
    var limits = { audio:786432000, video:2147483648, image:52428800, text:5242880 };
    if(file.size <= 0) return `${file.name || 'file'} is empty.`;
    if(file.size > (limits[type] || limits.text)) return `${file.name || 'file'} is too large for ${type}.`;
    var mime = String(file.type || '').toLowerCase();
    var extension = String(file.name || '').split('.').pop().toLowerCase();
    var extensions = { audio:['mp3','wav','m4a','aac','flac','ogg','opus'], video:['mp4','mov','webm','m4v'], image:['jpg','jpeg','png','webp','gif','avif'], text:['txt','md','text'] };
    var mimeOkay = !mime || mime.indexOf(type === 'text' ? 'text/' : type + '/') === 0;
    if(!mimeOkay && !(extensions[type] || []).includes(extension)) return `${file.name || 'file'} does not match the selected ${type} type.`;
    return '';
  }

  function folderDisplayName(path) {
    var parts = normalizeFolderPath(path).split('/').filter(Boolean);
    return parts.length ? parts[parts.length - 1] : 'uncategorized';
  }

  function folderParentPath(path) {
    var parts = normalizeFolderPath(path).split('/').filter(Boolean);
    parts.pop();
    return parts.join('/');
  }

  function folderPathDepth(path) {
    return Math.max(0, normalizeFolderPath(path).split('/').filter(Boolean).length - 1);
  }

  function selectedAssetDate() {
    var field = document.getElementById('injDate');
    return field && field.value ? field.value : new Date().toISOString().slice(0, 10);
  }

  function selectedAssetTime() {
    var field = document.getElementById('injTime');
    return field && field.value ? field.value : '';
  }

  function displayDateFromISO(dateValue) {
    if(!dateValue) return '';
    var parts = String(dateValue).slice(0, 10).split('-');
    if(parts.length !== 3) return '';
    return `${parts[1]}.${parts[2]}.${parts[0].slice(-2)}`;
  }

  function sortDateFromISO(dateValue) {
    if(!dateValue) return '';
    return String(dateValue).slice(0, 10).replaceAll('-', '');
  }

  function sortKeyFromDateTime(dateValue, timeValue) {
    return `${sortDateFromISO(dateValue)}${String(timeValue || '00:00').replace(':', '')}`;
  }

  function displayDateTime(dateValue, timeValue) {
    var date = displayDateFromISO(dateValue);
    if(!date) return '';
    return timeValue ? `${date} ${formatTwelveHourTime(timeValue)} ${easternTimeLabel(dateValue)}` : date;
  }

  function formatTwelveHourTime(timeValue) {
    var parts = String(timeValue || '').split(':');
    var hour = parseInt(parts[0], 10);
    if(!Number.isFinite(hour)) return String(timeValue || '');
    var minute = String(parts[1] || '00').padStart(2, '0').slice(0, 2);
    var suffix = hour >= 12 ? 'PM' : 'AM';
    var displayHour = hour % 12 || 12;
    return `${displayHour}:${minute} ${suffix}`;
  }

  function easternTimeLabel(dateValue) {
    if(!dateValue) return 'ET';
    try {
      var probe = new Date(`${String(dateValue).slice(0, 10)}T12:00:00Z`);
      var zonePart = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', timeZoneName: 'short' })
        .formatToParts(probe)
        .find(part => part.type === 'timeZoneName');
      return zonePart && /^(EST|EDT)$/.test(zonePart.value) ? zonePart.value : 'ET';
    } catch(error) {
      return 'ET';
    }
  }

  function easternDateTimeParts(dateValue) {
    try {
      var formatter = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
      });
      var parts = {};
      formatter.formatToParts(dateValue).forEach(part => { if(part.type !== 'literal') parts[part.type] = part.value; });
      return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
    } catch(error) {
      return { date: new Date().toISOString().slice(0, 10), time: '00:00' };
    }
  }

  function setDefaultAssetDate() {
    var field = document.getElementById('injDate');
    if(field && !field.value) field.value = new Date().toISOString().slice(0, 10);
  }

  function setAssetDateToday() {
    var field = document.getElementById('injDate');
    if(field) field.value = new Date().toISOString().slice(0, 10);
    var time = document.getElementById('injTime');
    if(time && !time.value) {
      var now = new Date();
      time.value = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    }
  }

  function setAssetTimeNow() {
    var time = document.getElementById('injTime');
    if(!time) return;
    var now = new Date();
    time.value = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  }

  function quickMood(name, color) {
    var mood = document.getElementById('injMood');
    var moodColor = document.getElementById('injMoodColor');
    if(mood) mood.value = name;
    if(moodColor) moodColor.value = color;
  }

  function clearUploadForm() {
    var form = document.getElementById('injectForm');
    if(form) form.reset();
    toggleRootPlacement(false);
    toggleCoverInput();
    setAssetDateToday();
  }

  function setUploadProgress(percent, text) {
    var box = document.getElementById('uploadProgress');
    var fill = document.getElementById('uploadProgressFill');
    var pct = document.getElementById('uploadProgressPct');
    var label = document.getElementById('uploadProgressText');
    var value = Math.max(0, Math.min(100, Math.round(percent || 0)));
    if(box) box.classList.toggle('active', value > 0 && value < 100 || !!text);
    if(fill) fill.style.width = value + '%';
    if(pct) pct.textContent = value + '%';
    if(label) label.textContent = text || 'uploading';
  }

  function resetUploadProgress(delay) {
    window.clearTimeout(window.uploadProgressTimer);
    window.uploadProgressTimer = window.setTimeout(() => {
      var box = document.getElementById('uploadProgress');
      if(box) box.classList.remove('active');
      setUploadProgress(0, '');
    }, delay || 700);
  }

  // ---- DYNAMIC DIRECTORY UPDATER ----
  function updateDirectoryDropdown() {
    var select = document.getElementById('injBatch');
    if(!select) return;
    var currentVal = select.value;
    select.innerHTML = '';
    var rootOpt = document.createElement('option');
    rootOpt.value = '__root__';
    rootOpt.textContent = 'root / loose archive';
    select.appendChild(rootOpt);
    
    document.querySelectorAll('.folder-block[data-standard-folder]').forEach(folder => {
      var name = folder.getAttribute('data-standard-folder');
      if (name === "smartFilterFolderBlock") return;
      var opt = document.createElement('option');
      opt.value = name;
      opt.textContent = `${'  '.repeat(folderPathDepth(name))}directory: ${folderDisplayName(name)}`;
      select.appendChild(opt);
    });
    
    if (currentVal && select.querySelector(`[value="${currentVal}"]`)) {
      select.value = currentVal;
    }
    var folderOptions = document.getElementById('archiveFolderOptions');
    if(folderOptions) {
      var paths = Array.from(document.querySelectorAll('.folder-block[data-standard-folder]'))
        .map(folder => folder.getAttribute('data-standard-folder'))
        .filter(Boolean);
      folderOptions.innerHTML = paths.map(path => `<option value="${escapeAttr(path)}"></option>`).join('');
    }
  }

  function handleFolderCreate() {
    if(!requireAdmin()) return;
    var name = normalizeFolderPath(document.getElementById('newFolder').value);
    if(!name) return;
    if(name === ROOT_ARCHIVE_PATH) return alert('that name is reserved for archive root.');
    if(findFolderBlock(name)) return alert("directory already exists.");
    ensureFolder(name);
    document.getElementById('newFolder').value = '';
    updateDirectoryDropdown();
  }

  function generateFilterChip(tag, color) {
    if(!tag) return;
    tag = tag.toLowerCase().trim();
    var grid = document.getElementById('filterGrid');
    if(!grid) return;
    var exists = Array.from(grid.children).some(c => c.textContent === tag);
    if(!exists) {
      var chip = document.createElement('div');
      chip.className = 'filter-chip';
      chip.textContent = tag;
      if(color) {
        chip.dataset.moodColor = color;
        chip.style.setProperty('--chip-color', color);
      }
      chip.onclick = (e) => setFilter(tag, e.currentTarget);
      grid.appendChild(chip);
    } else if(color) {
      var chip = Array.from(grid.children).find(c => c.textContent === tag);
      chip.dataset.moodColor = color;
      chip.style.setProperty('--chip-color', color);
    }
  }

  function setFilter(tag, target) {
    activeTimelineDate = null;
    activeFilter = tag;
    document.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
    document.querySelectorAll('.timeline-node').forEach(node => node.classList.remove('active'));
    var activeChip = target || Array.from(document.querySelectorAll('.filter-chip')).find(c => c.textContent === tag || c.textContent === `type: ${tag}`);
    if(activeChip) activeChip.classList.add('active');

    var smartBlock = document.getElementById('smartFilterFolderBlock');
    var smartList = document.getElementById('smartFilterList');
    smartList.innerHTML = '';

    if (tag === 'all') {
      smartBlock.style.display = 'none';
      document.querySelectorAll('.frow').forEach(row => row.style.display = 'grid');
    } else {
      document.getElementById('smartFolderTitle').textContent = `isolated: ${tag}`;
      smartBlock.style.display = 'block';

      document.querySelectorAll('[data-batch-target] .frow, [data-root-target] > .frow').forEach(row => {
        if (row.getAttribute('data-mood') === tag || row.getAttribute('data-type') === tag) {
          row.style.display = 'grid';
          var clone = row.cloneNode(true);
          clone.addEventListener('click', (e) => { e.stopPropagation(); handleRowClick(e, row); });
          smartList.appendChild(clone);
        } else {
          row.style.display = 'grid';
        }
      });
    }
    updateCounts(); buildQueue();
  }

  function baseRows() {
    return Array.from(document.querySelectorAll('[data-batch-target] .frow, [data-root-target] > .frow'));
  }

  function archiveSearchText(row) {
    if(archiveSearchIndex.has(row)) return archiveSearchIndex.get(row);
    var searchable = [
      row.getAttribute('data-title'), row.getAttribute('data-name'), row.getAttribute('data-sub'),
      row.getAttribute('data-ver'), row.getAttribute('data-mood'), row.getAttribute('data-type'),
      row.getAttribute('data-notes'), row.getAttribute('data-lyrics'), row.getAttribute('data-text-content'),
      row.getAttribute('data-asset-date'), row.getAttribute('data-asset-role'), row.getAttribute('data-project-key'),
      row.getAttribute('data-world-title'), row.getAttribute('data-world-summary'), row.getAttribute('data-credits'),
      row.getAttribute('data-source-title'), row.getAttribute('data-tags'), row.getAttribute('data-bpm'),
      row.getAttribute('data-musical-key'), row.getAttribute('data-era-names'), row.getAttribute('data-analysis-status'),
      row.getAttribute('data-lyrics-review')
    ].filter(Boolean).join(' ').toLowerCase();
    archiveSearchIndex.set(row,searchable);
    return searchable;
  }

  function archiveSmartViewMatches(row) {
    if(archiveSmartView === 'loose') return !normalizeFolderPath(row.getAttribute('data-sub'));
    if(archiveSmartView === 'notes') return row.getAttribute('data-type') === 'text' || Boolean(String(row.getAttribute('data-notes') || '').trim());
    if(archiveSmartView === 'visuals') return ['image','video'].includes(row.getAttribute('data-type'));
    return true;
  }

  function setArchiveSmartView(view) {
    archiveSmartView = ['all','loose','notes','visuals'].includes(view) ? view : 'all';
    document.querySelectorAll('[data-archive-view]').forEach(button => button.classList.toggle('active',button.getAttribute('data-archive-view') === archiveSmartView));
    applyArchiveSearch(document.getElementById('archiveSearchInput')?.value || '');
  }

  function applyArchiveSearch(value) {
    var input = document.getElementById('archiveSearchInput');
    var query = cleanSingleLine(value == null && input ? input.value : value,160).toLowerCase();
    var terms = query.split(/\s+/).filter(Boolean);
    var rows = baseRows();
    var explorer = document.getElementById('archiveExplorer');
    var smartBlock = document.getElementById('smartFilterFolderBlock');
    var status = document.getElementById('archiveSearchStatus');
    var clear = document.getElementById('archiveSearchClear');
    var empty = document.getElementById('archiveSearchEmpty');
    var root = document.getElementById('rootArchiveList');
    var rootDivider = root?.previousElementSibling;
    archiveSearchQuery = query;
    explorer?.classList.toggle('archive-search-active',Boolean(query));
    if(clear) clear.hidden = !query;

    var matches = 0;
    rows.forEach(row => {
      var searchMatch = !terms.length || (typeof archiveRowMatchesStructuredSearch === 'function' ? archiveRowMatchesStructuredSearch(row,query) : terms.every(term => archiveSearchText(row).includes(term)));
      var visible = searchMatch && archiveSmartViewMatches(row);
      row.classList.toggle('archive-search-hidden',!visible);
      if(visible) matches += 1;
    });

    document.querySelectorAll('.folder-block[data-standard-folder]').forEach(folder => {
      var filtering = Boolean(terms.length || archiveSmartView !== 'all');
      var hasMatch = !filtering || Boolean(folder.querySelector('.frow:not(.archive-search-hidden)'));
      folder.classList.toggle('archive-search-match',Boolean(filtering && hasMatch));
      folder.classList.toggle('archive-search-hidden',Boolean(filtering && !hasMatch));
      var toggle = folder.querySelector(':scope > .folder-row .folder-toggle');
      if(toggle) toggle.textContent = terms.length && hasMatch ? '[-]' : (folder.classList.contains('collapsed') ? '[+]' : '[-]');
    });

    var rootMatches = root ? root.querySelectorAll(':scope > .frow:not(.archive-search-hidden)').length : 0;
    rootDivider?.classList.toggle('archive-search-hidden',Boolean(terms.length && !rootMatches));
    if(smartBlock) smartBlock.style.display = terms.length ? 'none' : (activeFilter === 'all' ? 'none' : 'block');
    if(status) status.textContent = terms.length || archiveSmartView !== 'all' ? `${matches} found` : `${rows.length} files`;
    if(empty) empty.hidden = !((terms.length || archiveSmartView !== 'all') && matches === 0);
    return matches;
  }

  function queueArchiveSearch(value) {
    window.clearTimeout(archiveSearchTimer);
    archiveSearchTimer = window.setTimeout(() => applyArchiveSearch(value),80);
  }

  function clearArchiveSearch() {
    window.clearTimeout(archiveSearchTimer);
    var input = document.getElementById('archiveSearchInput');
    if(input) input.value = '';
    applyArchiveSearch('');
    input?.focus();
  }

  function handleArchiveSearchKey(event) {
    if(event.key === 'Escape') {
      event.preventDefault();
      clearArchiveSearch();
      return;
    }
    if(event.key !== 'Enter') return;
    var row = baseRows().find(item => !item.classList.contains('archive-search-hidden'));
    if(row) {
      event.preventDefault();
      handleRowClick({ target:row },row);
    }
  }

  document.addEventListener('keydown', function(event) {
    if(event.key !== '/' || event.ctrlKey || event.metaKey || event.altKey) return;
    var target = event.target;
    if(target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
    var input = document.getElementById('archiveSearchInput');
    if(!input || document.body.getAttribute('data-section') !== 'archive' || document.getElementById('archiveExplorer')?.offsetParent === null) return;
    event.preventDefault();
    input.focus();
  });

  function fallbackArchiveRow() {
    var rows = baseRows();
    if(!rows.length) return null;
    var dayKey = Math.floor(Date.now() / 86400000);
    return rows[Math.abs(dayKey) % rows.length];
  }

  function connectionTitleKey(row) {
    return String(row.getAttribute('data-title') || '').toLowerCase().replace(/\b(v(?:er(?:sion)?)?\s*\d+|demo|mix|master|rough|final)\b/g,'').replace(/[^a-z0-9]+/g,' ').trim();
  }

  function openArchiveConnections(seedRow) {
    var candidate = seedRow || document.querySelector('.frow.playing') || fallbackArchiveRow();
    if(!candidate) return;
    var openedFromWorlds = document.getElementById('worldsViewport')?.classList.contains('active');
    var seed = canonicalRow(candidate);
    var key = connectionTitleKey(seed);
    var folder = seed.getAttribute('data-sub') || '';
    var mood = seed.getAttribute('data-mood') || '';
    var related = baseRows().filter(row => row !== seed && ((key && connectionTitleKey(row) === key) || (folder && row.getAttribute('data-sub') === folder) || (mood && row.getAttribute('data-mood') === mood)));
    var rows = [seed].concat(related).slice(0, 13);
    var body = document.getElementById('connectionsBody');
    var satellites = rows.slice(1).map((row,index,list) => { var angle = Math.PI * 2 * index / Math.max(1,list.length) - Math.PI/2; return {row,x:50+Math.cos(angle)*34,y:50+Math.sin(angle)*36}; });
    body.innerHTML = `<div class="connection-hero"><h2>${escapeHtml(seed.getAttribute('data-title') || 'archive thread')}</h2><p>Versions, folders, moods, visuals and notes form a spatial thread around the selected file.</p></div><div class="constellation-shell"><svg class="constellation-lines" viewBox="0 0 100 100" preserveAspectRatio="none">${satellites.map(item => `<line x1="50" y1="50" x2="${item.x}" y2="${item.y}"></line>`).join('')}</svg><button class="constellation-node origin connection-item" type="button" style="--x:50%;--y:50%" data-connection-key="${escapeAttr(timelineRowKey(seed))}">${escapeHtml(seed.getAttribute('data-title') || 'origin')}</button>${satellites.map(item => `<button class="constellation-node connection-item" type="button" style="--x:${item.x}%;--y:${item.y}%" data-connection-key="${escapeAttr(timelineRowKey(item.row))}">${escapeHtml(item.row.getAttribute('data-ver') || item.row.getAttribute('data-type'))}<br>${escapeHtml(item.row.getAttribute('data-mood') || '')}</button>`).join('')}<div class="constellation-legend">shared title / folder / mood relationships</div></div>`;
    body.querySelectorAll('.connection-item').forEach(button => button.addEventListener('click', function(){
      var row = baseRows().find(item => timelineRowKey(item) === this.getAttribute('data-connection-key'));
      if(row) { closeViewport('connectionsViewport'); handleRowClick({ target:row, fromWorlds:openedFromWorlds }, row); }
    }));
    document.getElementById('connectionsViewport').classList.add('active');
    setAppSection('connections');
  }

  async function loadRemoteArchive() {
    var result = await supabaseClient.from('archive_assets').select('*').order('created_at', { ascending: false });
    if(result.error) {
      document.getElementById('authStatus').textContent = 'load error';
      return;
    }

    await hydrateArchiveSignedUrls(result.data || []);
    await hydrateArchiveSourceProvenance(result.data || []);
    await normalizeRemoteArchiveVersions(result.data || []);

    document.querySelectorAll('.folder-block[data-standard-folder]').forEach(folder => folder.remove());
    var rootArchive = document.getElementById('rootArchiveList');
    if(rootArchive) rootArchive.innerHTML = '';
    await loadRemoteArchiveFolders();
    result.data.sort((a, b) => {
      var aOrder = Number.isFinite(Number(a.sort_order)) ? Number(a.sort_order) : Number.MAX_SAFE_INTEGER;
      var bOrder = Number.isFinite(Number(b.sort_order)) ? Number(b.sort_order) : Number.MAX_SAFE_INTEGER;
      return aOrder - bOrder;
    }).forEach(record => createRowFromRecord(record, true));
    if(typeof loadArchiveEnrichmentData === 'function') await loadArchiveEnrichmentData({ force:true });
    updateDirectoryDropdown();
    updateCounts();
    buildQueue();
    if(typeof hydrateArchiveEnrichmentRows === 'function') hydrateArchiveEnrichmentRows();
    if(bandlabScanState) renderBandlabPlan();
  }

  async function normalizeRemoteArchiveVersions(records) {
    var changes = new Map();
    (records || []).forEach(record => {
      var normalized = normalizeVersionLabel(record.version,'v1');
      if(normalized !== String(record.version || '')) {
        if(!changes.has(normalized)) changes.set(normalized,[]);
        if(record.id) changes.get(normalized).push(record.id);
      }
      record.version = normalized;
    });
    if(!isAdmin || !supabaseClient || !changes.size) return;
    for(var [version,ids] of changes) {
      for(var offset = 0; offset < ids.length; offset += 100) {
        var result = await supabaseClient.from('archive_assets').update({ version }).in('id',ids.slice(offset,offset + 100));
        if(result.error) return;
      }
    }
  }

  async function hydrateArchiveSignedUrls(records) {
    if(!supabaseClient || !Array.isArray(records) || !records.length) return records;
    var paths = Array.from(new Set(records.flatMap(record => [record.storage_path,record.cover_storage_path]).filter(Boolean)));
    if(!paths.length) return records;
    var result = await supabaseClient.storage.from(STORAGE_BUCKET).createSignedUrls(paths,21600);
    if(result.error || !Array.isArray(result.data)) return records;
    var signed = new Map(result.data.filter(item => item && item.path && item.signedUrl).map(item => [item.path,item.signedUrl]));
    records.forEach(record => {
      if(record.storage_path && signed.has(record.storage_path)) record.file_url = signed.get(record.storage_path);
      if(record.cover_storage_path && signed.has(record.cover_storage_path)) record.cover_url = signed.get(record.cover_storage_path);
    });
    return records;
  }

  async function hydrateArchiveSourceProvenance(records) {
    if(!isAdmin || !supabaseClient || !Array.isArray(records) || !records.length) return records;
    var ids = records.map(record => record.id).filter(Boolean);
    var provenance = [];
    for(var index = 0; index < ids.length; index += 100) {
      var result = await supabaseClient.from('archive_source_provenance').select('*').in('asset_id',ids.slice(index,index + 100));
      if(result.error) return records;
      provenance.push(...(result.data || []));
    }
    var byAsset = new Map(provenance.map(source => [source.asset_id,source]));
    records.forEach(record => {
      var source = byAsset.get(record.id);
      if(!source) return;
      record.source_kind = source.source_kind || '';
      record.source_project_id = source.source_project_id || '';
      record.source_revision_id = source.source_revision_id || '';
      record.source_sha256 = source.source_sha256 || '';
      record.source_url = source.source_url || '';
      record.source_metadata = source.source_metadata || {};
      record.source_synced_at = source.synced_at || '';
    });
    return records;
  }

  function ensureFolder(batch) {
    var name = normalizeFolderPath(batch) || 'uncategorized';
    var existing = findFolderBlock(name);
    if(existing) return existing.querySelector('[data-batch-target]');

    var parentPath = folderParentPath(name);
    var container = parentPath ? ensureFolder(parentPath) : document.getElementById('directoryContainer');
    var depth = folderPathDepth(name);
    var label = folderDisplayName(name);
    var newBlock = document.createElement('div');
    var startsCollapsed = folderShouldStartCollapsed(name);
    newBlock.className = 'folder-block' + (startsCollapsed ? ' collapsed' : '');
    newBlock.setAttribute('data-standard-folder', name);
    newBlock.setAttribute('data-folder-depth', depth);
    newBlock.style.setProperty('--folder-depth', depth);
    newBlock.draggable = true;
    newBlock.innerHTML = `
      <div class="folder-row" onclick="toggleFolder(this)" ondragover="handleFolderDragOver(event)" ondragleave="handleFolderDragLeave(event)" ondrop="handleFolderDrop(event)"><div class="folder-row-left"><svg viewBox="0 0 24 24"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg><span>${escapeHtml(label)} items</span><small class="folder-note-badge">note</small></div><span class="folder-toggle">${startsCollapsed ? '[+]' : '[-]'}</span><div class="folder-actions admin-only"><button class="folder-select-btn" type="button" onclick="toggleFolderSelection(event,this)">select</button><details class="folder-menu" onclick="event.stopPropagation()"><summary aria-label="more folder actions">...</summary><div class="folder-menu-popover"><button type="button" onclick="moveFolderStep(event,this,-1)">move up</button><button type="button" onclick="moveFolderStep(event,this,1)">move down</button><button type="button" onclick="openFolderEditor(event,this)">edit folder</button><button type="button" onclick="ungroupFolder(event,this)">ungroup</button><button type="button" onclick="deleteFolder(event,this)">remove</button></div></details></div></div>
      <div class="folder-contents" data-batch-target="${escapeAttr(name)}"></div>
    `;
    container.appendChild(newBlock);
    attachExplorerDrag(newBlock);
    return newBlock.querySelector('[data-batch-target]');
  }

  function archiveDestination(batch) {
    var path = normalizeFolderPath(batch);
    if(path === ROOT_ARCHIVE_PATH) path = '';
    return path ? ensureFolder(path) : document.getElementById('rootArchiveList');
  }

  function findFolderBlock(name) {
    var normalized = normalizeFolderPath(name) || 'uncategorized';
    return Array.from(document.querySelectorAll('.folder-block[data-standard-folder]')).find(folder => folder.getAttribute('data-standard-folder') === normalized);
  }

  function updateFolderLabel(folder) {
    var label = folder.querySelector('.folder-row-left span');
    if(label) label.textContent = `${folderDisplayName(folder.getAttribute('data-standard-folder'))} items`;
  }

  function isFolderNoteRow(row) {
    return Boolean(row && row.getAttribute('data-type') === 'text' && row.getAttribute('data-name') === '.folder-notes.txt');
  }

  function findFolderNoteRow(path) {
    var target = normalizeFolderPath(path);
    return baseRows().find(row => isFolderNoteRow(row) && normalizeFolderPath(row.getAttribute('data-sub')) === target) || null;
  }

  function syncFolderNoteState(path) {
    var folder = findFolderBlock(path);
    if(folder) folder.classList.toggle('has-folder-note',Boolean(findFolderNoteRow(path)));
  }

  function setArchiveEntrySelected(entry, selected) {
    if(!entry) return;
    if(selected) selectedArchiveEntries.add(entry);
    else selectedArchiveEntries.delete(entry);
    entry.classList.toggle('archive-selected', Boolean(selected));
    if(entry.classList.contains('frow')) {
      var button = entry.querySelector('.row-select-btn');
      if(button) button.setAttribute('aria-pressed', selected ? 'true' : 'false');
    } else {
      var folderButton = entry.querySelector(':scope > .folder-row .folder-select-btn');
      if(folderButton) folderButton.textContent = selected ? 'selected' : 'select';
    }
    updateArchiveSelectionBar();
  }

  function toggleRowSelection(event, button) {
    if(event) { event.preventDefault(); event.stopPropagation(); }
    if(!requireAdmin()) return;
    var sourceRow = button && button.closest('.frow');
    var row = sourceRow ? canonicalRow(sourceRow) : null;
    if(row) setArchiveEntrySelected(row, !selectedArchiveEntries.has(row));
  }

  function toggleFolderSelection(event, button) {
    if(event) { event.preventDefault(); event.stopPropagation(); }
    if(!requireAdmin()) return;
    var folder = button && button.closest('.folder-block[data-standard-folder]');
    if(folder) setArchiveEntrySelected(folder, !selectedArchiveEntries.has(folder));
  }

  function pruneArchiveSelection() {
    selectedArchiveEntries.forEach(entry => {
      if(!entry || !entry.isConnected) selectedArchiveEntries.delete(entry);
    });
    updateArchiveSelectionBar();
  }

  function selectedArchiveRows() {
    var rows = new Set();
    selectedArchiveEntries.forEach(entry => {
      if(entry.classList.contains('frow')) rows.add(canonicalRow(entry));
      else entry.querySelectorAll('.frow').forEach(row => {
        if(!row.closest('#smartFilterFolderBlock')) rows.add(canonicalRow(row));
      });
    });
    return Array.from(rows).filter(Boolean);
  }

  function topLevelSelectedFolders() {
    return Array.from(selectedArchiveEntries).filter(entry => {
      if(!entry.classList.contains('folder-block') || !entry.isConnected) return false;
      return !Array.from(selectedArchiveEntries).some(other => other !== entry && other.classList.contains('folder-block') && other.contains(entry));
    });
  }

  function updateArchiveSelectionBar() {
    var bar = document.getElementById('archiveSelectionBar');
    if(!bar) return;
    var folders = topLevelSelectedFolders();
    var rows = selectedArchiveRows();
    var directRows = Array.from(selectedArchiveEntries).filter(entry => entry.classList && entry.classList.contains('frow') && entry.isConnected);
    var active = folders.length + directRows.length > 0;
    bar.classList.toggle('active', active);
    document.body.classList.toggle('has-archive-selection', active);
    var count = document.getElementById('archiveSelectionCount');
    var label = document.getElementById('archiveSelectionLabel');
    if(count) count.textContent = folders.length + directRows.length;
    if(label) label.textContent = folders.length ? `${folders.length} song folder${folders.length === 1 ? '' : 's'} / ${rows.length} version${rows.length === 1 ? '' : 's'}` : `${rows.length} file${rows.length === 1 ? '' : 's'} selected`;
    if(typeof renderAdminWorkspaceSelection === 'function') renderAdminWorkspaceSelection();
  }

  function clearArchiveSelection() {
    selectedArchiveEntries.forEach(entry => {
      if(entry && entry.isConnected) {
        entry.classList.remove('archive-selected');
        var rowButton = entry.querySelector('.row-select-btn');
        if(rowButton) rowButton.setAttribute('aria-pressed','false');
        var folderButton = entry.querySelector(':scope > .folder-row .folder-select-btn');
        if(folderButton) folderButton.textContent = 'select';
      }
    });
    selectedArchiveEntries.clear();
    updateArchiveSelectionBar();
  }

  function resetBulkCoverPreview() {
    if(bulkCoverPreviewUrl) URL.revokeObjectURL(bulkCoverPreviewUrl);
    bulkCoverPreviewUrl = '';
    var preview = document.getElementById('bulkCoverPreview');
    var image = document.getElementById('bulkCoverPreviewImage');
    if(preview) preview.classList.remove('active');
    if(image) image.removeAttribute('src');
  }

  function openBulkEdit() {
    if(!requireAdmin()) return;
    var rows = selectedArchiveRows();
    if(!rows.length) return showAppNotice('select at least one archive file.','error');
    resetBulkCoverPreview();
    ['bulkApplyNames','bulkApplyTag','bulkApplyCover','bulkRemoveCover'].forEach(id => { var input = document.getElementById(id); if(input) input.checked = false; });
    document.getElementById('bulkNameTemplate').value = '{name}';
    document.getElementById('bulkTag').value = '';
    document.getElementById('bulkTagColor').value = '#ffffff';
    document.getElementById('bulkCoverFile').value = '';
    document.getElementById('bulkEditCount').textContent = `${rows.length} file${rows.length === 1 ? '' : 's'}`;
    var viewport = document.getElementById('bulkEditViewport');
    viewport.setAttribute('aria-hidden','false');
    openAnimatedSurface(viewport);
    setAppSection('bulk edit');
    syncMobileExitControl();
  }

  function previewBulkCover() {
    var input = document.getElementById('bulkCoverFile');
    var file = input?.files?.[0];
    resetBulkCoverPreview();
    if(!file) return;
    document.getElementById('bulkApplyCover').checked = true;
    document.getElementById('bulkRemoveCover').checked = false;
    bulkCoverPreviewUrl = URL.createObjectURL(file);
    document.getElementById('bulkCoverPreviewImage').src = bulkCoverPreviewUrl;
    document.getElementById('bulkCoverPreviewName').textContent = `${file.name} / ${(file.size / 1024 / 1024).toFixed(2)}mb`;
    document.getElementById('bulkCoverPreview').classList.add('active');
  }

  function toggleBulkCoverRemoval() {
    var remove = document.getElementById('bulkRemoveCover').checked;
    if(remove) {
      document.getElementById('bulkApplyCover').checked = true;
      document.getElementById('bulkCoverFile').value = '';
      resetBulkCoverPreview();
    }
  }

  function bulkTitleForRow(template,row,index) {
    return cleanSingleLine(String(template || '')
      .replace(/\{name\}/gi,row.getAttribute('data-title') || 'untitled')
      .replace(/\{version\}/gi,row.getAttribute('data-ver') || '')
      .replace(/\{folder\}/gi,row.getAttribute('data-sub') || 'root')
      .replace(/\{n\}/gi,String(index + 1)),120) || row.getAttribute('data-title') || 'untitled';
  }

  function storagePathsUnusedAfterRows(paths,removedRows) {
    var excluded = new Set((removedRows || []).map(canonicalRow));
    return Array.from(new Set((paths || []).filter(Boolean))).filter(path => !baseRows().some(row => !excluded.has(row) && (row.getAttribute('data-storage-path') === path || row.getAttribute('data-cover-storage-path') === path)));
  }

  function applyBulkMetadataToRow(row,change) {
    if(change.title) {
      row.setAttribute('data-title',change.title);
      var nameCell = row.querySelector('.name-cell');
      if(nameCell) nameCell.innerHTML = `${escapeHtml(change.title)}<span class="row-path">${escapeHtml(row.getAttribute('data-sub') || 'archive')}</span>`;
    }
    if(change.mood) {
      row.setAttribute('data-mood',change.mood);
      row.setAttribute('data-mood-color',change.moodColor);
      row.style.setProperty('--mood-color',change.moodColor);
      var mood = row.querySelector('.mood-pill');
      if(mood) mood.textContent = change.mood;
    }
    if(change.coverChanged) {
      row.setAttribute('data-cover',change.coverUrl || '');
      row.setAttribute('data-cover-url',change.coverUrl || '');
      row.setAttribute('data-cover-storage-path',change.coverPath || '');
    }
    archiveSearchIndex.delete(row);
  }

  async function applyBulkEdit() {
    if(!requireAdmin()) return;
    var rows = selectedArchiveRows();
    if(!rows.length) return showAppNotice('the archive selection is empty.','error');
    var changeNames = document.getElementById('bulkApplyNames').checked;
    var changeTag = document.getElementById('bulkApplyTag').checked;
    var changeCover = document.getElementById('bulkApplyCover').checked;
    if(!changeNames && !changeTag && !changeCover) return showAppNotice('choose names, tag, or cover art to change.','error');
    var template = document.getElementById('bulkNameTemplate').value;
    var mood = cleanSingleLine(document.getElementById('bulkTag').value.toLowerCase(),32);
    var moodColor = safeHexColor(document.getElementById('bulkTagColor').value);
    if(changeNames && !cleanSingleLine(template,120)) return showAppNotice('enter a title template.','error');
    if(changeTag && !mood) return showAppNotice('enter the new archive tag.','error');
    var removeCover = document.getElementById('bulkRemoveCover').checked;
    var coverFile = document.getElementById('bulkCoverFile').files?.[0] || null;
    if(changeCover && !removeCover && !coverFile) return showAppNotice('choose cover art or select remove covers.','error');
    if(coverFile && (validateAssetFile(coverFile,'image') || coverFile.size > 26214400)) return showAppNotice('cover art must be a valid image under 25mb.','error');
    var button = document.getElementById('bulkEditSave');
    var oldLabel = button.textContent;
    button.disabled = true;
    button.textContent = 'applying...';
    var coverPath = '';
    var coverUrl = '';
    var uploadedPath = '';
    var coverCommitted = false;
    var oldCoverPaths = changeCover ? rows.map(row => row.getAttribute('data-cover-storage-path')).filter(Boolean) : [];
    try {
      if(changeCover && !removeCover && coverFile) {
        if(isRemoteReady && supabaseClient) {
          var safeName = coverFile.name.replace(/[^a-z0-9._-]+/gi,'-');
          coverPath = `covers/bulk/${Date.now()}-${safeName}`;
          var upload = await supabaseClient.storage.from(STORAGE_BUCKET).upload(coverPath,coverFile,{upsert:false,contentType:coverFile.type || undefined,cacheControl:'3600'});
          if(upload.error) throw upload.error;
          uploadedPath = coverPath;
          var signed = await supabaseClient.storage.from(STORAGE_BUCKET).createSignedUrl(coverPath,21600);
          if(signed.error || !signed.data?.signedUrl) throw signed.error || new Error('could not prepare the new cover.');
          coverUrl = signed.data.signedUrl;
        } else coverUrl = URL.createObjectURL(coverFile);
      }
      var ids = rows.map(row => row.getAttribute('data-id')).filter(Boolean);
      if(isRemoteReady && supabaseClient && ids.length) {
        if(changeNames) {
          for(var index = 0; index < rows.length; index++) {
            var id = rows[index].getAttribute('data-id');
            if(!id) continue;
            var titleResult = await supabaseClient.from('archive_assets').update({ title:bulkTitleForRow(template,rows[index],index) }).eq('id',id);
            if(titleResult.error) throw titleResult.error;
          }
        }
        var sharedUpdate = {};
        if(changeTag) { sharedUpdate.mood = mood; sharedUpdate.mood_color = moodColor; }
        if(changeCover) { sharedUpdate.cover_storage_path = removeCover ? '' : coverPath; sharedUpdate.cover_url = ''; }
        if(Object.keys(sharedUpdate).length) {
          for(var offset = 0; offset < ids.length; offset += 100) {
            var sharedResult = await supabaseClient.from('archive_assets').update(sharedUpdate).in('id',ids.slice(offset,offset + 100));
            if(sharedResult.error) throw sharedResult.error;
          }
          if(changeCover) coverCommitted = true;
        }
      }
      rows.forEach((row,index) => applyBulkMetadataToRow(row,{
        title:changeNames ? bulkTitleForRow(template,row,index) : '',
        mood:changeTag ? mood : '',
        moodColor,
        coverChanged:changeCover,
        coverPath:removeCover ? '' : coverPath,
        coverUrl:removeCover ? '' : coverUrl
      }));
      if(changeTag) generateFilterChip(mood,moodColor);
      if(isRemoteReady && supabaseClient && oldCoverPaths.length) {
        var unused = storagePathsUnusedAfterRows(oldCoverPaths,rows);
        if(unused.length) await supabaseClient.storage.from(STORAGE_BUCKET).remove(unused);
      }
      var playing = rows.find(row => row.classList.contains('playing'));
      if(playing) {
        document.getElementById('pbTitle').textContent = playing.getAttribute('data-title');
        document.getElementById('fsTitle').textContent = playing.getAttribute('data-title');
        updateNowPlayingDetails(playing,playing.getAttribute('data-type') || activeMediaType);
        var fsCover = document.getElementById('fsCover');
        var activeCover = playing.getAttribute('data-cover');
        if(fsCover) { fsCover.src = activeCover || ''; fsCover.classList.toggle('active',Boolean(activeCover)); }
      }
      timelineNeedsBuild = true;
      updateCounts();
      buildQueue();
      setFilter(activeFilter);
      closeViewport('bulkEditViewport');
      clearArchiveSelection();
      resetBulkCoverPreview();
      showAppNotice(`updated ${rows.length} archive file${rows.length === 1 ? '' : 's'}.`);
    } catch(error) {
      if(uploadedPath && !coverCommitted && supabaseClient) await supabaseClient.storage.from(STORAGE_BUCKET).remove([uploadedPath]).catch(() => {});
      showAppNotice(error.message || 'bulk edit failed.','error');
    } finally {
      button.disabled = false;
      button.textContent = oldLabel;
    }
  }

  function setRowBatch(row, batch) {
    var previous = normalizeFolderPath(row.getAttribute('data-sub'));
    var target = normalizeFolderPath(batch) || '';
    row.setAttribute('data-sub',target);
    archiveSearchIndex.delete(row);
    var path = row.querySelector('.row-path');
    if(path) path.textContent = target || 'archive';
    if(row.classList.contains('playing')) {
      var subtitle = `${target || 'archive'} / ${row.getAttribute('data-ver') || 'v1'}`;
      var barSub = document.getElementById('pbSub');
      var fullSub = document.getElementById('fsSub');
      if(barSub) barSub.textContent = subtitle;
      if(fullSub) fullSub.textContent = subtitle;
    }
    if(isFolderNoteRow(row)) {
      if(previous && previous !== target) syncFolderNoteState(previous);
      if(target) syncFolderNoteState(target);
    }
  }

  async function persistRowsBatch(rows, batch) {
    var target = normalizeFolderPath(batch) || '';
    rows.forEach(row => setRowBatch(row,target));
    if(!isRemoteReady || !supabaseClient) return;
    var ids = Array.from(new Set(rows.map(row => row.getAttribute('data-id')).filter(Boolean)));
    for(var index = 0; index < ids.length; index += 100) {
      var result = await supabaseClient.from('archive_assets').update({ batch:target || ROOT_ARCHIVE_PATH }).in('id', ids.slice(index,index + 100));
      if(result.error) throw result.error;
    }
  }

  function songFolderNameForRow(row) {
    var title = cleanSingleLine(row.getAttribute('data-source-title') || row.getAttribute('data-title'),120)
      .replace(/\s*[-_/]?\s*v\d{1,6}\s*$/i,'')
      .replace(/\b(?:demo|mix|master|rough|final|bounce)\s*$/i,'')
      .trim();
    return normalizeFolderPath(title).split('/').join(' ') || 'untitled song';
  }

  async function moveArchiveSelection() {
    if(!requireAdmin() || !selectedArchiveEntries.size) return;
    var target = normalizeArchiveDestination(document.getElementById('archiveSelectionDestination')?.value || '');
    var folders = topLevelSelectedFolders();
    var directRows = Array.from(selectedArchiveEntries).filter(entry => entry.classList && entry.classList.contains('frow') && entry.isConnected && !folders.some(folder => folder.contains(entry)));
    var movedRows = [];
    var skipped = 0;
    for(var folder of folders) {
      var oldPath = folder.getAttribute('data-standard-folder') || '';
      if(target === oldPath || target.indexOf(oldPath + '/') === 0) { skipped++; continue; }
      var leaf = folderDisplayName(oldPath);
      var newPath = normalizeFolderPath(target ? `${target}/${leaf}` : leaf);
      var duplicate = findFolderBlock(newPath);
      var rows = Array.from(folder.querySelectorAll('.frow')).filter(row => !row.closest('#smartFilterFolderBlock'));
      if(duplicate && duplicate !== folder) {
        var duplicateList = duplicate.querySelector(':scope > .folder-contents');
        var ownList = folder.querySelector(':scope > .folder-contents');
        Array.from(ownList.children).forEach(child => {
          duplicateList.appendChild(child);
          if(child.classList.contains('folder-block')) updateMovedFolderPaths(child,newPath,true);
        });
        rows.filter(row => row.parentElement === duplicateList).forEach(row => setRowBatch(row,newPath));
        await renamePersistedFolderTree(oldPath,newPath);
        folder.remove();
      } else {
        var destination = target ? ensureFolder(target) : document.getElementById('directoryContainer');
        await renamePersistedFolderTree(oldPath,newPath);
        destination.appendChild(folder);
        updateMovedFolderPaths(folder,target,true);
      }
      movedRows.push(...rows);
    }
    if(directRows.length) {
      var rowDestination = archiveDestination(target);
      directRows.forEach(row => {
        rowDestination.appendChild(row);
        setRowBatch(row,target);
      });
      movedRows.push(...directRows);
    }
    var grouped = new Map();
    movedRows.forEach(row => {
      var batch = row.getAttribute('data-sub') || target;
      if(!grouped.has(batch)) grouped.set(batch,[]);
      grouped.get(batch).push(row);
    });
    try {
      for(var [batch,rows] of grouped) await persistRowsBatch(rows,batch);
    } catch(error) {
      showAppNotice(error.message || 'some moves could not be saved','error');
    }
    clearArchiveSelection();
    refreshExplorerAfterFolderAction();
    showAppNotice(`${movedRows.length} file${movedRows.length === 1 ? '' : 's'} moved${skipped ? ` / ${skipped} folder skipped` : ''}.`);
  }

  async function groupSelectionIntoSongFolders() {
    if(!requireAdmin()) return;
    var rows = selectedArchiveRows();
    if(!rows.length) return;
    var parent = normalizeArchiveDestination(document.getElementById('archiveSelectionDestination')?.value || '');
    var grouped = new Map();
    rows.forEach(row => {
      var leaf = songFolderNameForRow(row);
      var destination = normalizeFolderPath(parent ? `${parent}/${leaf}` : leaf);
      if(!grouped.has(destination)) grouped.set(destination,[]);
      grouped.get(destination).push(row);
    });
    try {
      for(var [destination,versionRows] of grouped) {
        var list = archiveDestination(destination);
        versionRows.forEach(row => list.appendChild(row));
        await persistRowsBatch(versionRows,destination);
      }
      clearArchiveSelection();
      refreshExplorerAfterFolderAction();
      showAppNotice(`${rows.length} versions resolved into ${grouped.size} song folder${grouped.size === 1 ? '' : 's'}.`);
    } catch(error) {
      showAppNotice(error.message || 'song folders could not be saved','error');
    }
  }

  function attachExplorerDrag(item) {
    if(!item || item.id === 'smartFilterFolderBlock') return;
    if(item.dataset.dragBound === 'true') return;
    item.dataset.dragBound = 'true';
    item.draggable = true;
    item.addEventListener('dragstart', function(e) {
      if(!isAdmin) {
        e.preventDefault();
        return;
      }
      draggedExplorerItem = item;
      item.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', item.classList.contains('folder-block') ? 'folder' : 'row');
      e.stopPropagation();
    });
    item.addEventListener('dragend', function() {
      item.classList.remove('dragging');
      document.querySelectorAll('.folder-block.drag-over,.folder-block.drop-before,.folder-block.drop-after').forEach(folder => folder.classList.remove('drag-over', 'drop-before', 'drop-after'));
      document.querySelectorAll('.frow.row-drop-target').forEach(row => row.classList.remove('row-drop-target'));
      draggedExplorerItem = null;
    });
    if(item.classList.contains('frow')) {
      item.addEventListener('dragover', handleRowDragOver);
      item.addEventListener('dragleave', handleRowDragLeave);
      item.addEventListener('drop', handleRowDrop);
    }
  }

  function initExplorerDrag() {
    document.querySelectorAll('.folder-block[data-standard-folder], .frow').forEach(attachExplorerDrag);
  }

  function handleFolderDragOver(e) {
    if(!isAdmin || !draggedExplorerItem) return;
    e.preventDefault();
    var folder = e.currentTarget.closest('.folder-block');
    if(!folder || folder === draggedExplorerItem || (draggedExplorerItem.classList.contains('folder-block') && draggedExplorerItem.contains(folder))) return;
    folder.classList.remove('drag-over', 'drop-before', 'drop-after');
    if(draggedExplorerItem.classList.contains('folder-block')) {
      var rect = e.currentTarget.getBoundingClientRect();
      var ratio = (e.clientY - rect.top) / Math.max(1, rect.height);
      if(ratio < 0.28) folder.classList.add('drop-before');
      else if(ratio > 0.72) folder.classList.add('drop-after');
      else folder.classList.add('drag-over');
    } else {
      folder.classList.add('drag-over');
    }
  }

  function handleFolderDragLeave(e) {
    var folder = e.currentTarget.closest('.folder-block');
    if(folder) folder.classList.remove('drag-over', 'drop-before', 'drop-after');
  }

  function handleRowDragOver(e) {
    if(!isAdmin || !draggedExplorerItem || !draggedExplorerItem.classList.contains('frow') || draggedExplorerItem === e.currentTarget) return;
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.classList.add('row-drop-target');
  }

  function handleRowDragLeave(e) {
    e.currentTarget.classList.remove('row-drop-target');
  }

  function handleRowDrop(e) {
    if(!isAdmin || !draggedExplorerItem || !draggedExplorerItem.classList.contains('frow')) return;
    e.preventDefault();
    e.stopPropagation();
    var targetRow = e.currentTarget;
    if(targetRow === draggedExplorerItem) return;
    targetRow.classList.remove('row-drop-target');
    var oldList = draggedExplorerItem.parentElement;
    var targetList = targetRow.parentElement;
    var targetPath = targetList.hasAttribute('data-root-target') ? '' : (targetList.getAttribute('data-batch-target') || '');
    var insertAfter = e.clientY > targetRow.getBoundingClientRect().top + targetRow.getBoundingClientRect().height / 2;
    targetList.insertBefore(draggedExplorerItem, insertAfter ? targetRow.nextSibling : targetRow);
    if((draggedExplorerItem.getAttribute('data-sub') || '') !== targetPath) {
      draggedExplorerItem.setAttribute('data-sub', targetPath);
      saveMovedRowBatch(draggedExplorerItem, targetPath);
    }
    explorerSortKey = '';
    updateSortIndicators();
    persistRowOrder(targetList);
    if(oldList && oldList !== targetList) persistRowOrder(oldList);
    buildQueue();
    renderQueueList();
  }

  function handleRootDragOver(e) {
    if(!isAdmin || !draggedExplorerItem || !draggedExplorerItem.classList.contains('frow')) return;
    e.preventDefault();
    e.currentTarget.classList.add('drag-over');
  }

  function handleRootDragLeave(e) {
    e.currentTarget.classList.remove('drag-over');
  }

  function handleRootDrop(e) {
    if(!isAdmin || !draggedExplorerItem || !draggedExplorerItem.classList.contains('frow')) return;
    e.preventDefault();
    var rootList = e.currentTarget;
    var oldList = draggedExplorerItem.parentElement;
    rootList.classList.remove('drag-over');
    rootList.appendChild(draggedExplorerItem);
    draggedExplorerItem.setAttribute('data-sub','');
    saveMovedRowBatch(draggedExplorerItem,'');
    persistRowOrder(rootList);
    if(oldList && oldList !== rootList) persistRowOrder(oldList);
    removeEmptyFolders();
    updateCounts();
    buildQueue();
    renderQueueList();
  }

  async function persistRowOrder(list) {
    if(!list) return;
    var rows = Array.from(list.children).filter(child => child.classList && child.classList.contains('frow'));
    var updates = [];
    rows.forEach((row, index) => {
      var order = index * 1000;
      row.setAttribute('data-sort-order', order);
      var assetId = row.getAttribute('data-id');
      if(isRemoteReady && assetId) updates.push(supabaseClient.from('archive_assets').update({ sort_order: order }).eq('id', assetId));
    });
    if(!updates.length) return;
    var results = await Promise.all(updates);
    if(results.some(result => result.error)) document.getElementById('authStatus').textContent = 'order not saved';
  }

  async function persistExplorerOrder() {
    var root = document.getElementById('directoryContainer');
    if(!root) return;
    var rows = Array.from(root.querySelectorAll('.frow')).filter(row => !row.closest('#smartFilterFolderBlock'));
    var updates = [];
    rows.forEach((row, index) => {
      var order = index * 1000;
      row.setAttribute('data-sort-order', order);
      var assetId = row.getAttribute('data-id');
      if(isRemoteReady && assetId) updates.push(supabaseClient.from('archive_assets').update({ sort_order: order }).eq('id', assetId));
    });
    if(updates.length) {
      var results = await Promise.all(updates);
      document.getElementById('authStatus').textContent = results.some(result => result.error) ? 'order not saved' : 'order saved';
    }
    explorerSortKey = '';
    updateSortIndicators();
    buildQueue();
    renderQueueList();
  }

  function moveFolderStep(event, button, direction) {
    event.preventDefault();
    event.stopPropagation();
    if(!requireAdmin()) return;
    var folder = button.closest('.folder-block');
    if(!folder) return;
    var siblings = Array.from(folder.parentElement.children).filter(child => child.classList && child.classList.contains('folder-block') && child.id !== 'smartFilterFolderBlock');
    var index = siblings.indexOf(folder);
    var target = siblings[index + direction];
    if(!target) return;
    if(direction < 0) folder.parentElement.insertBefore(folder, target);
    else folder.parentElement.insertBefore(folder, target.nextSibling);
    persistExplorerOrder();
  }

  function handleFolderDrop(e) {
    if(!isAdmin || !draggedExplorerItem) return;
    e.preventDefault();
    e.stopPropagation();
    var targetFolder = e.currentTarget.closest('.folder-block');
    if(!targetFolder || targetFolder === draggedExplorerItem) return;
    var placeBefore = targetFolder.classList.contains('drop-before');
    var placeAfter = targetFolder.classList.contains('drop-after');
    targetFolder.classList.remove('drag-over', 'drop-before', 'drop-after');
    var targetPath = targetFolder.getAttribute('data-standard-folder');
    var targetList = targetFolder.querySelector('[data-batch-target]');
    if(!targetList) return;
    setFolderCollapsed(targetFolder,false);

    if(draggedExplorerItem.classList.contains('frow')) {
      var oldList = draggedExplorerItem.parentElement;
      targetList.appendChild(draggedExplorerItem);
      draggedExplorerItem.setAttribute('data-sub', targetPath);
      saveMovedRowBatch(draggedExplorerItem, targetPath);
      explorerSortKey = '';
      updateSortIndicators();
      persistRowOrder(targetList);
      if(oldList && oldList !== targetList) persistRowOrder(oldList);
    } else if(draggedExplorerItem.classList.contains('folder-block')) {
      var oldPath = draggedExplorerItem.getAttribute('data-standard-folder');
      if(draggedExplorerItem.contains(targetFolder)) return;
      if(placeBefore || placeAfter) {
        var siblingContainer = targetFolder.parentElement;
        var siblingParentPath = siblingContainer.id === 'directoryContainer' ? '' : (siblingContainer.getAttribute('data-batch-target') || '');
        siblingContainer.insertBefore(draggedExplorerItem, placeAfter ? targetFolder.nextSibling : targetFolder);
        if(folderParentPath(oldPath) !== siblingParentPath) updateMovedFolderPaths(draggedExplorerItem, siblingParentPath);
        persistExplorerOrder();
        updateDirectoryDropdown();
        updateCounts();
        return;
      }
      if(targetPath.indexOf(oldPath + '/') === 0) return;
      var newPath = normalizeFolderPath(`${targetPath}/${folderDisplayName(oldPath)}`);
      var duplicateFolder = findFolderBlock(newPath);
      if(duplicateFolder && duplicateFolder !== draggedExplorerItem) {
        alert('that folder already exists there.');
        return;
      }
      targetList.appendChild(draggedExplorerItem);
      updateMovedFolderPaths(draggedExplorerItem, targetPath);
      persistExplorerOrder();
    }

    updateDirectoryDropdown();
    updateCounts();
    buildQueue();
  }

  function folderPathChanges(folder, newRoot) {
    var oldRoot = normalizeFolderPath(folder && folder.getAttribute('data-standard-folder'));
    var targetRoot = normalizeFolderPath(newRoot);
    if(!folder || !oldRoot || !targetRoot) return [];
    return [folder].concat(Array.from(folder.querySelectorAll('.folder-block[data-standard-folder]'))).map(block => {
      var oldPath = normalizeFolderPath(block.getAttribute('data-standard-folder'));
      var newPath = oldPath === oldRoot ? targetRoot : normalizeFolderPath(targetRoot + oldPath.slice(oldRoot.length));
      return { block, oldPath, newPath };
    });
  }

  function migrateFolderStates(changes) {
    var states = readFolderStates();
    var changed = false;
    changes.forEach(change => {
      if(!Object.prototype.hasOwnProperty.call(states,change.oldPath)) return;
      states[change.newPath] = states[change.oldPath];
      delete states[change.oldPath];
      changed = true;
    });
    if(changed) {
      try { localStorage.setItem(FOLDER_STATE_KEY,JSON.stringify(states)); } catch(error) {}
    }
  }

  function rewriteFolderPaths(folder, newRoot, deferSave) {
    var changes = folderPathChanges(folder,newRoot);
    migrateFolderStates(changes);
    changes.forEach(change => {
      var block = change.block;
      var depth = folderPathDepth(change.newPath);
      block.setAttribute('data-standard-folder',change.newPath);
      block.setAttribute('data-folder-depth',depth);
      block.style.setProperty('--folder-depth',depth);
      var contents = block.querySelector(':scope > [data-batch-target]');
      if(contents) contents.setAttribute('data-batch-target',change.newPath);
      updateFolderLabel(block);
      if(contents) {
        Array.from(contents.children).forEach(child => {
          if(!child.classList || !child.classList.contains('frow')) return;
          setRowBatch(child,change.newPath);
          if(!deferSave) saveMovedRowBatch(child,change.newPath);
        });
      }
    });
    return changes;
  }

  function updateMovedFolderPaths(folder, targetPath, deferSave) {
    var oldRoot = normalizeFolderPath(folder.getAttribute('data-standard-folder'));
    var newRoot = normalizeFolderPath(`${targetPath}/${folderDisplayName(oldRoot)}`);
    return rewriteFolderPaths(folder,newRoot,deferSave);
  }

  async function saveMovedRowBatch(row, batch) {
    setRowBatch(row,batch);
    if(!isRemoteReady) return;
    var assetId = row.getAttribute('data-id');
    if(!assetId) return;
    var result = await supabaseClient.from('archive_assets').update({ batch:batch || ROOT_ARCHIVE_PATH }).eq('id', assetId);
    if(result.error) {
      document.getElementById('authStatus').textContent = 'move not saved';
    }
  }

  function refreshExplorerAfterFolderAction() {
    removeEmptyFolders();
    updateDirectoryDropdown();
    updateCounts();
    buildQueue();
    renderQueueList();
  }

  function openFolderEditor(event, button) {
    if(event) { event.preventDefault(); event.stopPropagation(); }
    if(!requireAdmin()) return;
    var folder = button && button.closest('.folder-block[data-standard-folder]');
    if(!folder || folder.id === 'smartFilterFolderBlock') return;
    editingFolder = folder;
    var path = normalizeFolderPath(folder.getAttribute('data-standard-folder'));
    var note = findFolderNoteRow(path);
    var count = Array.from(folder.querySelectorAll('.frow')).filter(row => !row.closest('#smartFilterFolderBlock')).length;
    document.getElementById('folderEditPath').textContent = `archive / ${path}`;
    document.getElementById('folderEditCount').textContent = `${count} file${count === 1 ? '' : 's'}`;
    document.getElementById('folderEditName').value = folderDisplayName(path);
    document.getElementById('folderEditNotes').value = note ? note.getAttribute('data-text-content') || '' : '';
    document.getElementById('folderNoteRemove').hidden = !note;
    var viewport = document.getElementById('folderEditViewport');
    viewport.setAttribute('aria-hidden','false');
    openAnimatedSurface(viewport);
    setAppSection('folder edit');
    window.setTimeout(() => document.getElementById('folderEditName')?.focus(),80);
  }

  async function persistFolderRename(folder, newRoot) {
    var oldRoot = normalizeFolderPath(folder.getAttribute('data-standard-folder'));
    if(!isRemoteReady || !supabaseClient) {
      await renamePersistedFolderTree(oldRoot,newRoot);
      return;
    }
    var grouped = new Map();
    baseRows().forEach(row => {
      var oldBatch = normalizeFolderPath(row.getAttribute('data-sub'));
      if(oldBatch !== oldRoot && oldBatch.indexOf(oldRoot + '/') !== 0) return;
      var id = row.getAttribute('data-id');
      if(!id) return;
      var newBatch = oldBatch === oldRoot ? newRoot : normalizeFolderPath(newRoot + oldBatch.slice(oldRoot.length));
      var key = `${oldBatch}\n${newBatch}`;
      if(!grouped.has(key)) grouped.set(key,{ oldBatch, newBatch, ids:[] });
      grouped.get(key).ids.push(id);
    });

    var completed = [];
    try {
      for(var change of grouped.values()) {
        for(var offset = 0; offset < change.ids.length; offset += 100) {
          var ids = change.ids.slice(offset,offset + 100);
          var result = await supabaseClient.from('archive_assets').update({ batch:change.newBatch }).in('id',ids);
          if(result.error) throw result.error;
          completed.push({ ids, batch:change.oldBatch });
        }
      }
      await renamePersistedFolderTree(oldRoot,newRoot);
    } catch(error) {
      for(var index = completed.length - 1; index >= 0; index--) {
        try { await supabaseClient.from('archive_assets').update({ batch:completed[index].batch }).in('id',completed[index].ids); } catch(rollbackError) {}
      }
      throw error;
    }
  }

  function folderNotePayload(path, text) {
    var folder = findFolderBlock(path);
    var directRows = folder ? Array.from(folder.querySelectorAll(':scope > .folder-contents > .frow')).filter(row => !isFolderNoteRow(row)) : [];
    var source = directRows.find(row => row.getAttribute('data-type') === 'audio') || directRows[0] || null;
    var timestamp = easternDateTimeParts(new Date());
    var sortOrders = directRows.map(row => Number(row.getAttribute('data-sort-order'))).filter(value => Number.isFinite(value) && value < Number.MAX_SAFE_INTEGER);
    var title = `${folderDisplayName(path)} notes`;
    return {
      filename:'.folder-notes.txt',
      title,
      version:'v1',
      batch:path,
      asset_date:timestamp.date,
      asset_time:timestamp.time || null,
      mood:'notes',
      mood_color:'#d8d8d8',
      type:'text',
      size_label:`${text.length} chars`,
      file_url:'',
      cover_url:'',
      storage_path:'',
      cover_storage_path:'',
      notes:'',
      synced_lyrics:'',
      text_content:text,
      project_key:source ? source.getAttribute('data-project-key') || normalizeFolderPath(folderDisplayName(path)) : normalizeFolderPath(folderDisplayName(path)),
      world_title:source ? source.getAttribute('data-world-title') || folderDisplayName(path) : folderDisplayName(path),
      asset_role:'note',
      object_style:'notebook',
      credits:[],
      world_summary:'',
      sort_order:(sortOrders.length ? Math.max(...sortOrders) : directRows.length * 1000) + 1000
    };
  }

  function applyFolderNoteValues(row, payload, remoteRecord) {
    if(remoteRecord && remoteRecord.id) row.setAttribute('data-id',remoteRecord.id);
    row.setAttribute('data-name',payload.filename);
    row.setAttribute('data-title',payload.title);
    row.setAttribute('data-text-content',payload.text_content);
    row.setAttribute('data-size',payload.size_label);
    row.setAttribute('data-project-key',payload.project_key || '');
    row.setAttribute('data-world-title',payload.world_title || '');
    row.setAttribute('data-asset-role','note');
    row.setAttribute('data-object-style','notebook');
    setRowBatch(row,payload.batch);
    var name = row.querySelector('.name-cell');
    if(name) name.innerHTML = `${escapeHtml(payload.title)}<span class="row-path">${escapeHtml(payload.batch)}</span>`;
    var size = row.querySelector('.size-cell');
    if(size) size.textContent = payload.size_label;
    archiveSearchIndex.delete(row);
  }

  function withoutFolderNoteOptionalFields(payload) {
    var fallback = Object.assign({},payload);
    delete fallback.asset_time;
    delete fallback.synced_lyrics;
    delete fallback.project_key;
    delete fallback.world_title;
    delete fallback.asset_role;
    delete fallback.object_style;
    delete fallback.credits;
    delete fallback.world_summary;
    return fallback;
  }

  async function upsertFolderNote(path, value) {
    var text = cleanMultiline(value,12000);
    var existing = findFolderNoteRow(path);
    if(!text) {
      if(existing) await deleteFolderNoteRow(existing);
      return null;
    }

    var payload = folderNotePayload(path,text);
    if(existing) {
      payload.asset_date = existing.getAttribute('data-asset-date') || payload.asset_date;
      payload.asset_time = existing.getAttribute('data-asset-time') || payload.asset_time;
      var existingOrder = Number(existing.getAttribute('data-sort-order'));
      if(Number.isFinite(existingOrder)) payload.sort_order = existingOrder;
    }
    var remoteRecord = null;
    if(isRemoteReady && supabaseClient) {
      if(existing && existing.getAttribute('data-id')) {
        var updatePayload = Object.assign({},payload);
        var update = await supabaseClient.from('archive_assets').update(updatePayload).eq('id',existing.getAttribute('data-id'));
        if(update.error && /asset_time|synced_lyrics|project_key|world_title|asset_role|object_style|credits|world_summary|schema cache|column/i.test(update.error.message || '')) {
          update = await supabaseClient.from('archive_assets').update(withoutFolderNoteOptionalFields(updatePayload)).eq('id',existing.getAttribute('data-id'));
        }
        if(update.error) throw update.error;
      } else {
        var insert = await supabaseClient.from('archive_assets').insert(payload).select().single();
        if(insert.error && /asset_time|synced_lyrics|project_key|world_title|asset_role|object_style|credits|world_summary|schema cache|column/i.test(insert.error.message || '')) {
          insert = await supabaseClient.from('archive_assets').insert(withoutFolderNoteOptionalFields(payload)).select().single();
        }
        if(insert.error) throw insert.error;
        remoteRecord = Object.assign({},payload,insert.data || {});
      }
    }

    if(existing) applyFolderNoteValues(existing,payload,remoteRecord);
    else existing = createRowFromRecord(remoteRecord || Object.assign({ created_at:new Date().toISOString() },payload),true);
    syncFolderNoteState(path);
    return existing;
  }

  async function deleteFolderNoteRow(row) {
    if(!row) return false;
    var path = normalizeFolderPath(row.getAttribute('data-sub'));
    var id = row.getAttribute('data-id');
    if(isRemoteReady && supabaseClient && id) {
      var result = await supabaseClient.from('archive_assets').delete().eq('id',id);
      if(result.error) throw result.error;
    }
    row.remove();
    syncFolderNoteState(path);
    return true;
  }

  async function removeFolderNote() {
    if(!requireAdmin() || !editingFolder) return;
    var path = normalizeFolderPath(editingFolder.getAttribute('data-standard-folder'));
    var note = findFolderNoteRow(path);
    if(!note || !confirm(`remove the note from "${folderDisplayName(path)}"?`)) return;
    try {
      await deleteFolderNoteRow(note);
      document.getElementById('folderEditNotes').value = '';
      document.getElementById('folderNoteRemove').hidden = true;
      var count = editingFolder.querySelectorAll('.frow').length;
      document.getElementById('folderEditCount').textContent = `${count} file${count === 1 ? '' : 's'}`;
      updateCounts();
      setFilter(activeFilter);
      if(archiveSearchQuery) applyArchiveSearch(archiveSearchQuery);
      showAppNotice('folder note removed.');
    } catch(error) {
      showAppNotice(error.message || 'folder note could not be removed.','error');
    }
  }

  async function saveFolderEditor() {
    if(!requireAdmin() || !editingFolder || !editingFolder.isConnected) return;
    var rawName = cleanSingleLine(document.getElementById('folderEditName').value,64);
    if(!rawName) return showAppNotice('enter a folder name.','error');
    if(/[\\/]/.test(rawName)) return showAppNotice('folder names cannot contain slashes.','error');
    var leaf = normalizeFolderPath(rawName);
    if(!leaf || leaf.indexOf('/') !== -1 || leaf === ROOT_ARCHIVE_PATH) return showAppNotice('that folder name is not valid.','error');

    var oldRoot = normalizeFolderPath(editingFolder.getAttribute('data-standard-folder'));
    var parent = folderParentPath(oldRoot);
    var newRoot = normalizeFolderPath(parent ? `${parent}/${leaf}` : leaf);
    var duplicate = findFolderBlock(newRoot);
    if(duplicate && duplicate !== editingFolder) return showAppNotice('a folder with that name already exists here.','error');

    var noteText = document.getElementById('folderEditNotes').value;
    var saveButton = document.getElementById('folderEditSave');
    var originalLabel = saveButton.textContent;
    var renameSaved = false;
    saveButton.disabled = true;
    saveButton.textContent = 'saving';
    try {
      if(newRoot !== oldRoot) {
        await persistFolderRename(editingFolder,newRoot);
        rewriteFolderPaths(editingFolder,newRoot,true);
        renameSaved = true;
      }
      await upsertFolderNote(newRoot,noteText);
      updateDirectoryDropdown();
      updateCounts();
      buildQueue();
      renderQueueList();
      setFilter(activeFilter);
      if(archiveSearchQuery) applyArchiveSearch(archiveSearchQuery);
      closeViewport('folderEditViewport');
      showAppNotice(newRoot !== oldRoot ? `renamed folder to ${folderDisplayName(newRoot)}.` : 'folder saved.');
      editingFolder = null;
    } catch(error) {
      if(renameSaved) {
        document.getElementById('folderEditPath').textContent = `archive / ${newRoot}`;
        document.getElementById('folderEditName').value = folderDisplayName(newRoot);
      }
      showAppNotice(renameSaved ? 'folder renamed, but its note could not be saved.' : error.message || 'folder changes could not be saved.','error');
    } finally {
      saveButton.disabled = false;
      saveButton.textContent = originalLabel;
    }
  }

  async function ungroupFolder(event, button) {
    event.preventDefault();
    event.stopPropagation();
    if(!requireAdmin()) return;
    var folder = button.closest('.folder-block');
    if(!folder || folder.id === 'smartFilterFolderBlock') return;
    var folderPath = normalizeFolderPath(folder.getAttribute('data-standard-folder'));
    var persistedChildren = Array.from(persistedArchiveFolders).filter(path => path.startsWith(folderPath + '/')).map(path => ({
      oldPath:path,
      newPath:normalizeFolderPath((folderParentPath(folderPath) ? folderParentPath(folderPath) + '/' : '') + path.slice(folderPath.length + 1))
    }));
    var list = folder.querySelector(':scope > .folder-contents');
    var parentPath = folderParentPath(folder.getAttribute('data-standard-folder'));
    var destination = parentPath ? ensureFolder(parentPath) : document.getElementById('directoryContainer');
    var rowDestination = parentPath ? destination : archiveDestination('');
    var rowDestinationPath = parentPath || '';
    var children = Array.from(list.children);
    if(!children.length) {
      await deletePersistedFolderTree(folderPath);
      folder.remove();
      refreshExplorerAfterFolderAction();
      return;
    }

    children.forEach(child => {
      if(child.classList.contains('frow')) {
        rowDestination.appendChild(child);
        setRowBatch(child,rowDestinationPath);
        saveMovedRowBatch(child, rowDestinationPath);
      } else if(child.classList.contains('folder-block')) {
        destination.appendChild(child);
        updateMovedFolderPaths(child, parentPath || '');
      }
    });

    await deletePersistedFolderTree(folderPath);
    for(var persistedChild of persistedChildren) await persistArchiveFolder(persistedChild.newPath);
    folder.remove();
    refreshExplorerAfterFolderAction();
  }

  async function deleteFolder(event, button) {
    event.preventDefault();
    event.stopPropagation();
    if(!requireAdmin()) return;
    var folder = button.closest('.folder-block');
    if(!folder || folder.id === 'smartFilterFolderBlock') return;
    var name = folderDisplayName(folder.getAttribute('data-standard-folder'));
    var rows = Array.from(folder.querySelectorAll('.frow'));
    var removesActiveMedia = rows.some(row => row.classList.contains('playing'));
    var message = rows.length ? `remove folder "${name}" and ${rows.length} item(s) inside it?` : `remove empty folder "${name}"?`;
    if(!confirm(message)) return;

    try { await deletePersistedFolderTree(folder.getAttribute('data-standard-folder')); }
    catch(error) { return showAppNotice(error.message || 'the folder record could not be removed.','error'); }

    if(isRemoteReady && rows.length) {
      var ids = rows.map(row => row.getAttribute('data-id')).filter(Boolean);
      var paths = [];
      rows.forEach(row => {
        var storagePath = row.getAttribute('data-storage-path');
        var coverPath = row.getAttribute('data-cover-storage-path');
        if(storagePath) paths.push(storagePath);
        if(coverPath) paths.push(coverPath);
      });
      paths = storagePathsUnusedAfterRows(paths,rows);
      if(paths.length) await supabaseClient.storage.from(STORAGE_BUCKET).remove(paths);
      if(ids.length) {
        var result = await supabaseClient.from('archive_assets').delete().in('id', ids);
        if(result.error) return alert(result.error.message);
      }
    }

    rows.forEach(row => row.remove());
    folder.remove();
    if(removesActiveMedia) document.getElementById('pbClose').click();
    refreshExplorerAfterFolderAction();
  }

  function archiveRowActionsHtml(type) {
    var playLabel = type === 'audio' ? 'play' : 'open';
    return `<div class="row-actions">
      <button class="row-play-btn" type="button" aria-label="${playLabel} file" title="${playLabel}">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5l11 7-11 7z"/></svg>
      </button>
      <details class="row-menu">
        <summary aria-label="more file actions" title="more actions">...</summary>
        <div class="row-menu-popover">
          ${type === 'audio' ? '<button class="world-btn" type="button">song world</button>' : ''}
          <button class="info-btn" type="button">info</button>
          <button class="edit-btn admin-only" type="button">edit</button>
          <button class="delete-btn admin-only" type="button">remove</button>
        </div>
      </details>
    </div>`;
  }

  function createRowFromRecord(record, skipRefresh) {
    var type = record.type || 'audio';
    var batch = normalizeFolderPath(record.batch);
    if(batch === ROOT_ARCHIVE_PATH) batch = '';
    var targetBatchList = archiveDestination(batch);
    var row = document.createElement('div');
    row.className = 'frow';
    row.draggable = true;
    var assetDate = record.asset_date || '';
    var assetTime = record.asset_time || '';
    var created = record.created_at ? new Date(record.created_at) : new Date();
    var easternCreated = easternDateTimeParts(created);
    var fallbackTime = easternCreated.time;
    var fallbackDate = easternCreated.date;
    var effectiveDate = assetDate || fallbackDate;
    var effectiveTime = assetTime || fallbackTime;
    var dateDisplay = displayDateTime(effectiveDate, effectiveTime);
    var dateSort = sortKeyFromDateTime(effectiveDate, effectiveTime);

    row.setAttribute('data-name', record.filename || record.title || 'remote asset');
    row.setAttribute('data-title', record.title || 'untitled file');
    row.setAttribute('data-date', dateSort);
    row.setAttribute('data-asset-date', effectiveDate);
    row.setAttribute('data-asset-time', effectiveTime);
    row.setAttribute('data-sort-order', Number.isFinite(Number(record.sort_order)) ? Number(record.sort_order) : Number.MAX_SAFE_INTEGER);
    var recordVersion = normalizeVersionLabel(record.version, 'v1');
    row.setAttribute('data-ver', recordVersion);
    row.setAttribute('data-mood', record.mood || 'raw');
    row.setAttribute('data-mood-color', record.mood_color || moodColorFor(record.mood || 'raw'));
    row.style.setProperty('--mood-color', record.mood_color || moodColorFor(record.mood || 'raw'));
    row.setAttribute('data-type', type);
    row.setAttribute('data-size', record.size_label || '');
    row.setAttribute('data-sub', batch);
    row.setAttribute('data-notes', record.notes || '');
    row.setAttribute('data-lyrics', record.synced_lyrics || record.lyrics || '');
    row.setAttribute('data-spotify', record.spotify_url || '');
    row.setAttribute('data-apple', record.apple_url || '');
    row.setAttribute('data-youtube', record.youtube_url || '');
    row.setAttribute('data-soundcloud', record.soundcloud_url || '');
    row.setAttribute('data-cover', record.cover_url || '');
    row.setAttribute('data-id', record.id || '');
    row.setAttribute('data-file-url', record.file_url || '');
    row.setAttribute('data-cover-url', record.cover_url || '');
    row.setAttribute('data-storage-path', record.storage_path || '');
    row.setAttribute('data-cover-storage-path', record.cover_storage_path || '');
    row.setAttribute('data-project-key', record.project_key || '');
    row.setAttribute('data-world-title', record.world_title || '');
    row.setAttribute('data-asset-role', safeWorldRole(record.asset_role || 'version'));
    row.setAttribute('data-object-style', safeObjectStyle(record.object_style || 'case'));
    row.setAttribute('data-world-summary', record.world_summary || '');
    row.setAttribute('data-credits', JSON.stringify(Array.isArray(record.credits) ? record.credits : []));
    var sourceMetadata = isAdmin && record.source_metadata && typeof record.source_metadata === 'object' && !Array.isArray(record.source_metadata) ? record.source_metadata : {};
    row.setAttribute('data-source-kind', isAdmin ? record.source_kind || '' : '');
    row.setAttribute('data-source-project-id', isAdmin ? record.source_project_id || '' : '');
    row.setAttribute('data-source-revision-id', isAdmin ? record.source_revision_id || '' : '');
    row.setAttribute('data-source-sha256', isAdmin ? record.source_sha256 || '' : '');
    row.setAttribute('data-source-url', isAdmin ? record.source_url || '' : '');
    row.setAttribute('data-source-synced-at', isAdmin ? record.source_synced_at || '' : '');
    row.setAttribute('data-source-title', sourceMetadata.archiveTitle || sourceMetadata.projectTitle || record.title || '');
    row.setAttribute('data-source-metadata', JSON.stringify(sourceMetadata));
    row.setAttribute('data-tags','');
    row.setAttribute('data-bpm','');
    row.setAttribute('data-musical-key','');
    row.setAttribute('data-era-ids','');
    row.setAttribute('data-era-names','');
    row.setAttribute('data-analysis-status','none');
    row.setAttribute('data-lyrics-review',row.getAttribute('data-lyrics') ? 'accepted' : 'none');
    if(type === 'audio') row.setAttribute('data-file', record.file_url || '');
    if(type === 'image') row.setAttribute('data-img-src', record.file_url || '');
    if(type === 'video') row.setAttribute('data-video-src', record.file_url || '');
    if(type === 'text') row.setAttribute('data-text-content', record.text_content || '');

    var icon = '<svg viewBox="0 0 24 24"><path d="M9 18V5l12-2v13M9 18a3 3 0 11-6 0 3 3 0 016 0zm12-2a3 3 0 11-6 0 3 3 0 016 0z"/></svg>';
    if(type === 'image') icon = '<svg viewBox="0 0 24 24"><path d="M3 7h18v13H3z"/><circle cx="8" cy="11" r="1.5" fill="currentColor"/><path d="M3 17l5-5 4 4 4-5 4 6"/></svg>';
    if(type === 'video') icon = '<svg viewBox="0 0 24 24"><path d="M4 5h16v14H4z"/><path d="M10 9l5 3-5 3z"/></svg>';
    if(type === 'text') icon = '<svg viewBox="0 0 24 24"><path d="M7 3h7l5 5v13a1 1 0 01-1 1H7a1 1 0 01-1-1V4a1 1 0 011-1z"/><path d="M14 3v5h5" fill="none"/></svg>';

    row.innerHTML = `
      <div class="icon-cell">${icon}<button class="row-select-btn admin-only" type="button" aria-label="select ${escapeAttr(record.title || 'file')}" aria-pressed="false"></button></div>
      <div class="name-cell">${escapeHtml(record.title || 'untitled file')}<span class="row-path">${escapeHtml(batch || 'archive')}</span></div>
      <div class="dim-cell date-cell">${dateDisplay}</div><div class="dim-cell version-cell">${escapeHtml(recordVersion)}</div><div class="pill mood-pill">${escapeHtml(record.mood || 'raw')}</div>
      <div class="pill">${escapeHtml(type)}</div>
      ${archiveRowActionsHtml(type)}
    `;
    targetBatchList.appendChild(row);
    attachExplorerDrag(row);
    generateFilterChip(record.mood || 'raw', record.mood_color || moodColorFor(record.mood || 'raw'));
    if(isFolderNoteRow(row)) syncFolderNoteState(batch);
    if(!skipRefresh) {
      updateDirectoryDropdown();
      updateCounts();
      buildQueue();
    }
    return row;
  }

  async function saveRemoteAsset(payload) {
    var safeFolder = normalizeFolderPath(payload.batch).split('/').map(part => part.replace(/[^a-z0-9_-]+/g, '-')).filter(Boolean).join('/') || 'root';
    var safeName = payload.name.replace(/[^a-z0-9._-]+/gi, '-');
    var basePath = `${safeFolder}/${Date.now()}-${safeName}`;
    var fileUpload = await supabaseClient.storage.from(STORAGE_BUCKET).upload(basePath, payload.file, { upsert: false });
    if(fileUpload.error) throw fileUpload.error;
    var fileUrl = '';

    var coverUrl = '';
    if(payload.coverFile) {
      var coverName = payload.coverFile.name.replace(/[^a-z0-9._-]+/gi, '-');
      var coverPath = `${safeFolder}/${Date.now()}-cover-${coverName}`;
      var coverUpload = await supabaseClient.storage.from(STORAGE_BUCKET).upload(coverPath, payload.coverFile, { upsert: false });
      if(coverUpload.error) throw coverUpload.error;
      coverUrl = '';
    }

    var row = {
      filename: payload.name,
      title: payload.title,
      version: normalizeVersionLabel(payload.ver, 'v1'),
      batch: payload.batch || ROOT_ARCHIVE_PATH,
      asset_date: payload.assetDate,
      asset_time: payload.assetTime || null,
      mood: payload.mood,
      mood_color: payload.moodColor || '#ffffff',
      type: payload.type,
      size_label: payload.size,
      file_url: fileUrl,
      cover_url: coverUrl,
      storage_path: basePath,
      cover_storage_path: payload.coverFile ? coverPath : '',
      notes: payload.notes,
      synced_lyrics: payload.lyrics || '',
      spotify_url: payload.links.spotify,
      apple_url: payload.links.apple,
      youtube_url: payload.links.youtube,
      soundcloud_url: payload.links.soundcloud,
      text_content: '',
      project_key: payload.worldMeta && payload.worldMeta.projectKey || '',
      world_title: payload.worldMeta && payload.worldMeta.worldTitle || '',
      asset_role: payload.worldMeta && payload.worldMeta.role || 'version',
      object_style: payload.worldMeta && payload.worldMeta.objectStyle || 'case',
      credits: payload.worldMeta && payload.worldMeta.credits || [],
      world_summary: payload.worldMeta && payload.worldMeta.summary || ''
    };

    if(payload.type === 'text') {
      row.text_content = await payload.file.text();
    }

    if(typeof applySavedArchiveRulesToRecord === 'function') applySavedArchiveRulesToRecord(row);

    var insert = await supabaseClient.from('archive_assets').insert(row).select().single();
    if(insert.error && /asset_time|synced_lyrics|project_key|world_title|asset_role|object_style|credits|world_summary|schema cache|column/i.test(insert.error.message || '')) {
      if(/asset_time/i.test(insert.error.message || '')) delete row.asset_time;
      if(/synced_lyrics|schema cache|column/i.test(insert.error.message || '')) delete row.synced_lyrics;
      ['project_key','world_title','asset_role','object_style','credits','world_summary'].forEach(key => delete row[key]);
      insert = await supabaseClient.from('archive_assets').insert(row).select().single();
      if(insert.data) insert.data.asset_time = payload.assetTime || '';
      if(insert.data) insert.data.synced_lyrics = payload.lyrics || '';
      if(insert.data && payload.worldMeta) {
        insert.data.project_key = payload.worldMeta.projectKey;
        insert.data.world_title = payload.worldMeta.worldTitle || '';
        insert.data.asset_role = payload.worldMeta.role;
        insert.data.object_style = payload.worldMeta.objectStyle;
        insert.data.credits = payload.worldMeta.credits;
        insert.data.world_summary = payload.worldMeta.summary;
      }
    }
    if(insert.error) throw insert.error;
    await hydrateArchiveSignedUrls([insert.data]);
    return insert.data;
  }

  function createRow(fileObj, name, title, batch, mood, type, size, date, coverUrl, ver, notes, links, moodColor, assetDate, assetTime, skipFormReset, lyrics, worldMeta) {
    batch = normalizeFolderPath(batch);
    ver = normalizeVersionLabel(ver, 'v1');
    var targetBatchList = archiveDestination(batch);
    
    var row = document.createElement('div');
    row.className = 'frow';
    row.draggable = true;
    row.setAttribute('data-name', name);
    row.setAttribute('data-title', title);
    row.setAttribute('data-date', assetDate ? sortKeyFromDateTime(assetDate, assetTime) : date.replaceAll('.','').replace(':',''));
    row.setAttribute('data-asset-date', assetDate || '');
    row.setAttribute('data-asset-time', assetTime || '');
    row.setAttribute('data-ver', ver);
    row.setAttribute('data-sort-order', targetBatchList.querySelectorAll(':scope > .frow').length * 1000);
    row.setAttribute('data-mood', mood);
    row.setAttribute('data-mood-color', moodColor || '#ffffff');
    row.style.setProperty('--mood-color', moodColor || '#ffffff');
    row.setAttribute('data-type', type);
    row.setAttribute('data-size', size);
    row.setAttribute('data-sub', batch);
    row.setAttribute('data-notes', notes || '');
    row.setAttribute('data-lyrics', lyrics || '');
    worldMeta = worldMeta || {};
    row.setAttribute('data-project-key', worldMeta.projectKey || '');
    row.setAttribute('data-world-title', worldMeta.worldTitle || '');
    row.setAttribute('data-asset-role', safeWorldRole(worldMeta.role || 'version'));
    row.setAttribute('data-object-style', safeObjectStyle(worldMeta.objectStyle || 'case'));
    row.setAttribute('data-world-summary', worldMeta.summary || '');
    row.setAttribute('data-credits', JSON.stringify(worldMeta.credits || []));
    if(links) {
      Object.keys(links).forEach(key => {
        if(links[key]) row.setAttribute('data-' + key, links[key]);
      });
    }
    if(coverUrl) row.setAttribute('data-cover', coverUrl);

    var icon = '<svg viewBox="0 0 24 24"><path d="M9 18V5l12-2v13M9 18a3 3 0 11-6 0 3 3 0 016 0zm12-2a3 3 0 11-6 0 3 3 0 016 0z"/></svg>';
    
    if(type === 'audio' || type === 'image' || type === 'video') {
      var objUrl = URL.createObjectURL(fileObj);
      if(type === 'audio') row.setAttribute('data-file', objUrl);
      if(type === 'image') {
        row.setAttribute('data-img-src', objUrl);
        icon = '<svg viewBox="0 0 24 24"><path d="M3 7h18v13H3z"/><circle cx="8" cy="11" r="1.5" fill="currentColor"/><path d="M3 17l5-5 4 4 4-5 4 6"/></svg>';
      }
      if(type === 'video') {
        row.setAttribute('data-video-src', objUrl);
        icon = '<svg viewBox="0 0 24 24"><path d="M4 5h16v14H4z"/><path d="M10 9l5 3-5 3z"/></svg>';
      }
      finalizeRow();
    } else {
      var reader = new FileReader();
      reader.onload = function(e) {
        row.setAttribute('data-text-content', e.target.result);
        icon = '<svg viewBox="0 0 24 24"><path d="M7 3h7l5 5v13a1 1 0 01-1 1H7a1 1 0 01-1-1V4a1 1 0 011-1z"/><path d="M14 3v5h5" fill="none"/></svg>';
        finalizeRow();
      };
      reader.readAsText(fileObj);
    }

    function finalizeRow() {
    row.innerHTML = `
        <div class="icon-cell">${icon}<button class="row-select-btn admin-only" type="button" aria-label="select ${escapeAttr(title || 'file')}" aria-pressed="false"></button></div>
        <div class="name-cell">${escapeHtml(title)}<span class="row-path">${escapeHtml(batch || 'archive')}</span></div>
        <div class="dim-cell date-cell">${escapeHtml(date)}</div><div class="dim-cell version-cell">${escapeHtml(ver)}</div><div class="pill mood-pill">${escapeHtml(mood)}</div>
        <div class="pill">${escapeHtml(type)}</div>
        ${archiveRowActionsHtml(type)}
      `;
      targetBatchList.appendChild(row);
      attachExplorerDrag(row);
      if(!skipFormReset) {
        document.getElementById('injectForm').reset();
        toggleRootPlacement(false);
        toggleCoverInput();
        setDefaultAssetDate();
      }
      setFilter(activeFilter);
    }
  }

  function updateCounts() {
    pruneArchiveSelection();
    var rows = baseRows();
    var isLargeLibrary = rows.length >= 160;
    document.body.classList.toggle('large-archive', isLargeLibrary);
    timelineNeedsBuild = true;
    liveAssetSelectNeedsRefresh = true;
    var audio = rows.filter(row => row.getAttribute('data-type') === 'audio').length;
    var visual = rows.filter(row => ['image','video'].includes(row.getAttribute('data-type'))).length;
    document.getElementById('itemCount').textContent = `${rows.length} indexed`;
    document.getElementById('statAudio').textContent = audio;
    document.getElementById('statVisual').textContent = visual;
    document.getElementById('statAccess').textContent = isAdmin ? 'admin' : 'open';
    document.getElementById('emptyState').classList.toggle('active', rows.length === 0);
    if(archiveSearchQuery) applyArchiveSearch(archiveSearchQuery);
    else {
      var searchStatus = document.getElementById('archiveSearchStatus');
      if(searchStatus) searchStatus.textContent = `${rows.length} files`;
    }
    var liveRoomOpen = document.getElementById('liveRoom')?.classList.contains('active');
    var liveDrawerOpen = document.getElementById('liveAdminDrawer')?.classList.contains('open');
    if(liveRoomOpen || liveDrawerOpen) refreshLiveAssetSelect();
    if(document.getElementById('timelinePanel')?.classList.contains('active')) buildTimeline();
    if(typeof adminWorkspaceIsOpen === 'function' && adminWorkspaceIsOpen()) renderAdminWorkspace();
  }

  function positionArchiveRowMenu(menu) {
    if(!menu || !menu.open) return;
    var popover = menu.querySelector('.row-menu-popover');
    var summary = menu.querySelector('summary');
    if(!popover || !summary) return;

    menu.classList.remove('open-up','menu-shifted');
    menu.style.removeProperty('--row-menu-shift');
    var summaryRect = summary.getBoundingClientRect();
    var popoverRect = popover.getBoundingClientRect();
    var spaceBelow = window.innerHeight - summaryRect.bottom;
    var spaceAbove = summaryRect.top;

    if(popoverRect.bottom > window.innerHeight - 8 && spaceAbove > spaceBelow) {
      menu.classList.add('open-up');
      popoverRect = popover.getBoundingClientRect();
    }

    var maximumLeft = Math.max(8, window.innerWidth - popoverRect.width - 8);
    var desiredLeft = Math.min(Math.max(popoverRect.left, 8), maximumLeft);
    var shift = popoverRect.left - desiredLeft;
    if(Math.abs(shift) > 0.5) {
      menu.style.setProperty('--row-menu-shift', `${shift}px`);
      menu.classList.add('menu-shifted');
    }
  }

  function positionArchiveFolderMenu(menu) {
    if(!menu || !menu.open) return;
    var popover = menu.querySelector('.folder-menu-popover');
    var summary = menu.querySelector('summary');
    if(!popover || !summary) return;
    var trigger = summary.getBoundingClientRect();
    var width = Math.max(150,popover.offsetWidth || 150);
    var height = Math.max(160,popover.offsetHeight || 160);
    var left = Math.min(Math.max(8,trigger.right - width),window.innerWidth - width - 8);
    var top = trigger.bottom + 6;
    if(top + height > window.innerHeight - 8) top = Math.max(8,trigger.top - height - 6);
    popover.style.left = `${left}px`;
    popover.style.top = `${top}px`;
  }

  document.addEventListener('click', function(e) {
    var clickedMenu = e.target.closest && e.target.closest('.row-menu');
    if(!clickedMenu) document.querySelectorAll('.row-menu[open]').forEach(menu => menu.removeAttribute('open'));
    var clickedFolderMenu = e.target.closest && e.target.closest('.folder-menu');
    if(!clickedFolderMenu) document.querySelectorAll('.folder-menu[open]').forEach(menu => menu.removeAttribute('open'));
    var folderSummary = e.target.closest && e.target.closest('.folder-menu > summary');
    if(folderSummary) {
      document.querySelectorAll('.folder-menu[open]').forEach(menu => { if(menu !== clickedFolderMenu) menu.removeAttribute('open'); });
      e.stopPropagation();
      window.setTimeout(() => positionArchiveFolderMenu(clickedFolderMenu),0);
      return;
    }
    var row = e.target.closest('.frow');
    if (!row) return;
    if (e.target.closest('.row-select-btn')) return toggleRowSelection(e, e.target.closest('.row-select-btn'));
    var menuSummary = e.target.closest('.row-menu > summary');
    if(menuSummary) {
      document.querySelectorAll('.row-menu[open]').forEach(menu => { if(menu !== clickedMenu) menu.removeAttribute('open'); });
      e.stopPropagation();
      window.setTimeout(() => positionArchiveRowMenu(clickedMenu),0);
      return;
    }
    if (e.target.closest('.info-btn')) { clickedMenu?.removeAttribute('open'); return showProperties(row); }
    if (e.target.closest('.world-btn')) { clickedMenu?.removeAttribute('open'); return openSongWorldForRow(row); }
    if (e.target.closest('.edit-btn')) { clickedMenu?.removeAttribute('open'); return openEditAsset(row); }
    if (e.target.closest('.delete-btn')) { clickedMenu?.removeAttribute('open'); return removeAsset(row); }
    if (e.target.closest('.row-play-btn')) return handleRowClick(e, row);
    if(isAdmin && (e.ctrlKey || e.metaKey || e.shiftKey)) return toggleRowSelection(e, row.querySelector('.row-select-btn'));
    handleRowClick(e, row);
  });

  window.addEventListener('resize', function() {
    document.querySelectorAll('.row-menu[open]').forEach(positionArchiveRowMenu);
    document.querySelectorAll('.folder-menu[open]').forEach(positionArchiveFolderMenu);
  });

  function archiveVersionGroupKey(row) {
    if(!row) return '';
    var projectKey = cleanSingleLine(row.getAttribute('data-project-key'),100).toLowerCase();
    if(projectKey) return `project:${projectKey}`;
    var sourceProject = cleanSingleLine(row.getAttribute('data-source-project-id'),160).toLowerCase();
    if(sourceProject) return `source:${sourceProject}`;
    var folder = normalizeFolderPath(row.getAttribute('data-sub'));
    var title = cleanSingleLine(row.getAttribute('data-title'),160).toLowerCase()
      .replace(/\b(?:v|ver(?:sion)?)\s*0*\d+\b/g,'')
      .replace(/\b(?:demo|mix|master|rough|final|bounce)\b/g,'')
      .replace(/[^a-z0-9]+/g,' ')
      .trim();
    return `folder:${folder}|title:${title}`;
  }

  function archiveVersionNumber(row) {
    var match = String(row?.getAttribute('data-ver') || '').match(/^v(\d+)/i);
    return match ? Number.parseInt(match[1],10) : Number.MAX_SAFE_INTEGER;
  }

  function archiveVersionCompactionPlan(deletedRow) {
    if(!deletedRow || deletedRow.getAttribute('data-type') !== 'audio') return [];
    var groupKey = archiveVersionGroupKey(deletedRow);
    var deletedId = deletedRow.getAttribute('data-id') || '';
    var deletedCanonical = deletedRow;
    return baseRows()
      .filter(row => row.getAttribute('data-type') === 'audio')
      .filter(row => archiveVersionGroupKey(row) === groupKey)
      .filter(row => row !== deletedCanonical && (!deletedId || row.getAttribute('data-id') !== deletedId))
      .sort((a,b) => archiveVersionNumber(a) - archiveVersionNumber(b)
        || String(a.getAttribute('data-date') || '').localeCompare(String(b.getAttribute('data-date') || ''))
        || Number(a.getAttribute('data-sort-order') || 0) - Number(b.getAttribute('data-sort-order') || 0))
      .map((row,index) => ({ row, version:`v${index + 1}` }))
      .filter(item => item.row.getAttribute('data-ver') !== item.version);
  }

  function applyArchiveRowVersion(row,version) {
    row.setAttribute('data-ver',version);
    var cell = row.querySelector('.version-cell');
    if(cell) cell.textContent = version;
    archiveSearchIndex.delete(row);
    if(row.classList.contains('playing')) {
      var subtitle = `${row.getAttribute('data-sub') || 'archive'} / ${version}`;
      var barSub = document.getElementById('pbSub');
      var fullSub = document.getElementById('fsSub');
      if(barSub) barSub.textContent = subtitle;
      if(fullSub) fullSub.textContent = subtitle;
    }
  }

  async function compactArchiveVersionsAfterDelete(deletedRow) {
    var changes = archiveVersionCompactionPlan(deletedRow);
    if(!changes.length) return 0;
    if(isRemoteReady && supabaseClient) {
      for(var change of changes) {
        var id = change.row.getAttribute('data-id');
        if(!id) continue;
        var result = await supabaseClient.from('archive_assets').update({ version:change.version }).eq('id',id);
        if(result.error) {
          showAppNotice('file removed, but its remaining versions could not all be renumbered. refresh before editing them.','error');
          return 0;
        }
      }
    }
    changes.forEach(change => applyArchiveRowVersion(change.row,change.version));
    timelineNeedsBuild = true;
    return changes.length;
  }

  async function removeAsset(row) {
    if(!requireAdmin()) return;
    var title = row.getAttribute('data-title') || 'this item';
    if(!confirm(`remove "${title}"?`)) return;
    var assetId = row.getAttribute('data-id');

    if(isRemoteReady && assetId) {
      var paths = storagePathsUnusedAfterRows([row.getAttribute('data-storage-path'), row.getAttribute('data-cover-storage-path')],[row]);
      if(paths.length) await supabaseClient.storage.from(STORAGE_BUCKET).remove(paths);
      var result = await supabaseClient.from('archive_assets').delete().eq('id', assetId);
      if(result.error) return alert(result.error.message);
    }

    var rowsToRemove = assetId ? Array.from(document.querySelectorAll('.frow')).filter(item => item.getAttribute('data-id') === assetId) : [row];
    var removesActiveMedia = rowsToRemove.some(item => item.classList.contains('playing'));
    rowsToRemove.forEach(item => item.remove());
    var compactedVersions = await compactArchiveVersionsAfterDelete(row);
    removeEmptyFolders();
    updateDirectoryDropdown();
    setFilter(activeFilter);
    if(removesActiveMedia) document.getElementById('pbClose').click();
    showAppNotice(compactedVersions ? `removed ${title}. renumbered ${compactedVersions} remaining version${compactedVersions === 1 ? '' : 's'}.` : `removed ${title}.`);
  }

  function removeEmptyFolders() {
    Array.from(document.querySelectorAll('.folder-block[data-standard-folder]')).reverse().forEach(folder => {
      var list = folder.querySelector(':scope > .folder-contents');
      var path = normalizeFolderPath(folder.getAttribute('data-standard-folder'));
      if(list && list.children.length === 0 && !persistedArchiveFolders.has(path)) folder.remove();
    });
  }

  function handleRowClick(e, rowElement) {
    rowElement = canonicalRow(rowElement);
    if(e && e.fromTimeline) viewerOrigin = 'timeline';
    else if(e && e.fromWorlds) viewerOrigin = 'worlds';
    else viewerOrigin = 'archive';
    if(!applyingLiveState) exitLiveFollowerMode();
    var type = rowElement.getAttribute('data-type');
    if(type === 'text') {
      document.getElementById('txtViewTitle').textContent = rowElement.getAttribute('data-title');
      document.getElementById('txtViewBody').textContent = rowElement.getAttribute('data-text-content');
      var attachedNotes = String(rowElement.getAttribute('data-notes') || '').trim();
      var textNotes = document.getElementById('txtViewNotes');
      textNotes.innerHTML = attachedNotes ? `<strong>attached notes</strong>${escapeHtml(attachedNotes).replace(/\n/g,'<br>')}` : '';
      textNotes.style.display = attachedNotes ? 'block' : 'none';
      document.getElementById('textViewport').classList.add('active');
      setAppSection('text viewer');
    } else if(type === 'image') {
      showMediaInNowPlaying(rowElement, 'image');
    } else if(type === 'video') {
      showMediaInNowPlaying(rowElement, 'video');
    } else if(type === 'audio') {
      buildQueue(); 
      var idx = audioQueue.findIndex(r => r === rowElement);
      if(idx !== -1) playTrackFromQueue(idx);
    }
    syncViewerExitControl();
  }

  function sourceMetadataForRow(row) {
    try {
      var value = JSON.parse(row.getAttribute('data-source-metadata') || '{}');
      return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    } catch(error) { return {}; }
  }

  function showProperties(row) {
    var playStat = rowPlayStat(row);
    var section = (title, pairs) => `<div class="props-section"><div class="props-section-title">${title}</div>${pairs.map(pair => `<div class="props-pair"><div class="props-label">${pair[0]}</div><div class="props-val">${escapeHtml(pair[1] || 'unknown')}</div></div>`).join('')}</div>`;
    var links = [
      ['spotify', row.getAttribute('data-spotify')],
      ['apple', row.getAttribute('data-apple')],
      ['youtube', row.getAttribute('data-youtube')],
      ['soundcloud', row.getAttribute('data-soundcloud')]
    ].filter(pair => pair[1]);
    var sourceKind = row.getAttribute('data-source-kind');
    var sourceMeta = sourceMetadataForRow(row);
    var sourceSection = sourceKind ? section('source provenance', [
      ['source', sourceKind],
      ['project', sourceMeta.projectTitle || row.getAttribute('data-source-project-id')],
      ['revision id', row.getAttribute('data-source-revision-id')],
      ['revision author', sourceMeta.revisionAuthor || 'unknown'],
      ['revision timestamp', sourceMeta.revisionDateTime || 'unknown'],
      ['verification', sourceMeta.verificationStatus || 'unknown'],
      ['sha-256', row.getAttribute('data-source-sha256') || 'not provided'],
      ['source link', row.getAttribute('data-source-url') || 'none'],
      ['last synchronized', row.getAttribute('data-source-synced-at') || 'unknown']
    ]) : '';
    var html = [
      section('identity', [
        ['title', row.getAttribute('data-title')],
        ['file', row.getAttribute('data-name')],
        ['version', row.getAttribute('data-ver')]
      ]),
      section('placement', [
        ['directory', row.getAttribute('data-sub')],
        ['date', displayDateTime(row.getAttribute('data-asset-date'), row.getAttribute('data-asset-time')) || row.getAttribute('data-date')],
        ['type', row.getAttribute('data-type')],
        ['size', row.getAttribute('data-size')]
      ]),
      section('mood + notes', [
        ['mood', row.getAttribute('data-mood')],
        ['notes', row.getAttribute('data-notes') || 'none']
      ]),
      section('listening', [
        ['plays', String(playStat.play_count)],
        ['last played', statsDateLabel(playStat.last_played)]
      ]),
      section('archive world', [
        ['project', projectKeyForRow(row)],
        ['role', row.getAttribute('data-asset-role') || 'version'],
        ['credits', creditsToText(rowCredits(row)) || 'none']
      ]),
      typeof enrichmentPropertyPairs === 'function' ? section('accepted enrichment',enrichmentPropertyPairs(row)) : '',
      sourceSection,
      section('links', links.length ? links : [['links', 'none added']])
    ].join('');
    document.getElementById('propsBody').innerHTML = html;
    openAnimatedSurface(document.getElementById('propsViewport'));
    document.getElementById('propsViewport').setAttribute('aria-hidden','false');
    setAppSection('info');
  }

  function canonicalRow(row) {
    var id = row.getAttribute('data-id');
    if(id) return Array.from(document.querySelectorAll(`.frow[data-id="${cssEscape(id)}"]`)).find(item => !item.closest('#smartFilterList')) || row;
    var name = row.getAttribute('data-name');
    return Array.from(document.querySelectorAll('.frow')).find(item => !item.closest('#smartFilterList') && item.getAttribute('data-name') === name) || row;
  }

  function openEditAsset(row) {
    if(!requireAdmin()) return;
    editingRow = canonicalRow(row);
    document.getElementById('editRowKey').value = editingRow.getAttribute('data-id') || editingRow.getAttribute('data-name') || '';
    document.getElementById('editTitle').value = editingRow.getAttribute('data-title') || '';
    document.getElementById('editVer').value = editingRow.getAttribute('data-ver') || '';
    document.getElementById('editDate').value = editingRow.getAttribute('data-asset-date') || '';
    document.getElementById('editTime').value = editingRow.getAttribute('data-asset-time') || timeFromSortKey(editingRow.getAttribute('data-date')) || '';
    document.getElementById('editFolder').value = editingRow.getAttribute('data-sub') || '';
    var positionRows = Array.from(editingRow.parentElement.children).filter(item => item.classList && item.classList.contains('frow'));
    document.getElementById('editPosition').value = Math.max(1, positionRows.indexOf(editingRow) + 1);
    document.getElementById('editMood').value = editingRow.getAttribute('data-mood') || '';
    document.getElementById('editMoodColor').value = editingRow.getAttribute('data-mood-color') || moodColorFor(editingRow.getAttribute('data-mood') || 'raw');
    document.getElementById('editProject').value = editingRow.getAttribute('data-project-key') || '';
    document.getElementById('editRole').value = safeWorldRole(editingRow.getAttribute('data-asset-role') || 'version');
    document.getElementById('editObjectStyle').value = safeObjectStyle(editingRow.getAttribute('data-object-style') || 'case');
    document.getElementById('editCredits').value = creditsToText(rowCredits(editingRow));
    document.getElementById('editWorldSummary').value = editingRow.getAttribute('data-world-summary') || '';
    document.getElementById('editNotes').value = editingRow.getAttribute('data-notes') || '';
    document.getElementById('editLyrics').value = editingRow.getAttribute('data-lyrics') || '';
    document.getElementById('editSpotify').value = editingRow.getAttribute('data-spotify') || '';
    document.getElementById('editApple').value = editingRow.getAttribute('data-apple') || '';
    document.getElementById('editYoutube').value = editingRow.getAttribute('data-youtube') || '';
    document.getElementById('editSoundcloud').value = editingRow.getAttribute('data-soundcloud') || '';
    openAnimatedSurface(document.getElementById('editViewport'));
    document.getElementById('editViewport').setAttribute('aria-hidden','false');
    setAppSection('edit');
  }

  function applyEditedValues(row, values) {
    var oldBatch = row.getAttribute('data-sub') || '';
    var oldList = row.parentElement;
    row.setAttribute('data-title', values.title);
    values.ver = normalizeVersionLabel(values.ver, 'v1');
    row.setAttribute('data-ver', values.ver);
    row.setAttribute('data-asset-date', values.assetDate);
    row.setAttribute('data-asset-time', values.assetTime);
    row.setAttribute('data-date', sortKeyFromDateTime(values.assetDate, values.assetTime));
    row.setAttribute('data-sub', values.batch);
    row.setAttribute('data-mood', values.mood);
    row.setAttribute('data-mood-color', values.moodColor);
    row.style.setProperty('--mood-color', values.moodColor);
    row.setAttribute('data-notes', values.notes);
    row.setAttribute('data-lyrics', values.lyrics);
    row.setAttribute('data-project-key', values.worldMeta.projectKey);
    row.setAttribute('data-asset-role', values.worldMeta.role);
    row.setAttribute('data-object-style', values.worldMeta.objectStyle);
    row.setAttribute('data-world-summary', values.worldMeta.summary);
    row.setAttribute('data-credits', JSON.stringify(values.worldMeta.credits));
    row.setAttribute('data-spotify', values.links.spotify);
    row.setAttribute('data-apple', values.links.apple);
    row.setAttribute('data-youtube', values.links.youtube);
    row.setAttribute('data-soundcloud', values.links.soundcloud);
    archiveSearchIndex.delete(row);

    var nameCell = row.querySelector('.name-cell');
    if(nameCell) nameCell.innerHTML = `${escapeHtml(values.title)}<span class="row-path">${escapeHtml(values.batch || 'archive')}</span>`;
    var dims = row.querySelectorAll('.dim-cell');
    if(dims[0]) dims[0].textContent = displayDateTime(values.assetDate, values.assetTime);
    if(dims[1]) dims[1].textContent = values.ver;
    var moodPill = row.querySelector('.mood-pill');
    if(moodPill) moodPill.textContent = values.mood;

    if(values.batch !== oldBatch) {
      archiveDestination(values.batch).appendChild(row);
      removeEmptyFolders();
    }
    var targetList = row.parentElement;
    var siblings = Array.from(targetList.children).filter(item => item.classList && item.classList.contains('frow') && item !== row);
    var targetIndex = Math.max(0, Math.min(siblings.length, values.position - 1));
    targetList.insertBefore(row, siblings[targetIndex] || null);
    explorerSortKey = '';
    updateSortIndicators();
    persistRowOrder(targetList);
    if(oldList && oldList !== targetList) persistRowOrder(oldList);
  }

  async function saveEditedAsset() {
    if(!requireAdmin() || !editingRow) return;
    var values = {
      title: cleanSingleLine(document.getElementById('editTitle').value, 120) || 'untitled file',
      ver: normalizeVersionLabel(cleanSingleLine(document.getElementById('editVer').value, 24), 'v1'),
      assetDate: document.getElementById('editDate').value || new Date().toISOString().slice(0, 10),
      assetTime: document.getElementById('editTime').value || '',
      batch: normalizeArchiveDestination(document.getElementById('editFolder').value),
      position: Math.max(1, parseInt(document.getElementById('editPosition').value, 10) || 1),
      mood: cleanSingleLine(document.getElementById('editMood').value.toLowerCase(), 32) || 'raw',
      moodColor: safeHexColor(document.getElementById('editMoodColor').value),
      notes: cleanMultiline(document.getElementById('editNotes').value, 12000),
      lyrics: cleanMultiline(document.getElementById('editLyrics').value, 40000),
      worldMeta: {
        projectKey: cleanSingleLine(document.getElementById('editProject').value, 100).toLowerCase(),
        role: safeWorldRole(document.getElementById('editRole').value),
        objectStyle: safeObjectStyle(document.getElementById('editObjectStyle').value),
        credits: parseCreditsText(document.getElementById('editCredits').value),
        summary: cleanMultiline(document.getElementById('editWorldSummary').value, 4000)
      },
      links: {
        spotify: safeExternalUrl(document.getElementById('editSpotify').value),
        apple: safeExternalUrl(document.getElementById('editApple').value),
        youtube: safeExternalUrl(document.getElementById('editYoutube').value),
        soundcloud: safeExternalUrl(document.getElementById('editSoundcloud').value)
      }
    };
    var editUrlFields = ['editSpotify','editApple','editYoutube','editSoundcloud'];
    var badEditUrl = editUrlFields.find(id => document.getElementById(id).value.trim() && !safeExternalUrl(document.getElementById(id).value));
    if(badEditUrl) return alert('all external links must use https.');

    var assetId = editingRow.getAttribute('data-id');
    if(isRemoteReady && assetId) {
      var updatePayload = {
        title: values.title,
        version: values.ver,
        asset_date: values.assetDate,
        asset_time: values.assetTime || null,
        batch: values.batch || ROOT_ARCHIVE_PATH,
        mood: values.mood,
        mood_color: values.moodColor,
        notes: values.notes,
        synced_lyrics: values.lyrics,
        spotify_url: values.links.spotify,
        apple_url: values.links.apple,
        youtube_url: values.links.youtube,
        soundcloud_url: values.links.soundcloud
        ,project_key: values.worldMeta.projectKey
        ,asset_role: values.worldMeta.role
        ,object_style: values.worldMeta.objectStyle
        ,credits: values.worldMeta.credits
        ,world_summary: values.worldMeta.summary
      };
      var result = await supabaseClient.from('archive_assets').update(updatePayload).eq('id', assetId);
      if(result.error && /asset_time|synced_lyrics|project_key|world_title|asset_role|object_style|credits|world_summary|schema cache|column/i.test(result.error.message || '')) {
        if(/asset_time/i.test(result.error.message || '')) delete updatePayload.asset_time;
        if(/synced_lyrics|schema cache|column/i.test(result.error.message || '')) delete updatePayload.synced_lyrics;
        ['project_key','asset_role','object_style','credits','world_summary'].forEach(key => delete updatePayload[key]);
        result = await supabaseClient.from('archive_assets').update(updatePayload).eq('id', assetId);
      }
      if(result.error) return alert(result.error.message);
    }

    applyEditedValues(editingRow, values);
    generateFilterChip(values.mood, values.moodColor);
    closeViewport('editViewport');
    updateDirectoryDropdown();
    updateCounts();
    buildQueue();
    setFilter(activeFilter);
    if(editingRow.classList.contains('playing')) {
      document.getElementById('pbTitle').textContent = values.title;
      document.getElementById('fsTitle').textContent = values.title;
      updateNowPlayingDetails(editingRow, editingRow.getAttribute('data-type') || activeMediaType);
      renderMeta(editingRow);
      renderLyricsForRow(editingRow);
      updateLyricsDisplay(currentAudio ? currentAudio.currentTime : 0);
    }
    editingRow = null;
  }
