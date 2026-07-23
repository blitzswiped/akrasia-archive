  // ---- FILE INJECTION ----
  function titleForUpload(file, baseTitle, index, total) {
    var cleanName = file && file.name ? cleanSingleLine(file.name.replace(/\.[^/.]+$/, '').replace(/[_-]+/g, ' '), 120) : 'untitled file';
    if(total <= 1) return baseTitle || cleanName || 'untitled file';
    if(baseTitle) return `${baseTitle} ${String(index + 1).padStart(2, '0')}`;
    return cleanName || `untitled file ${index + 1}`;
  }

  function normalizeSourcePath(value) {
    return String(value || '').replace(/\\/g,'/').split('/').map(part => part.trim()).filter(part => part && part !== '.' && part !== '..').slice(0,24).join('/').slice(0,1000);
  }

  function cleanSourceToken(value, maxLength) {
    return String(value || '').replace(/[^a-z0-9._:-]+/gi,'-').replace(/^-+|-+$/g,'').slice(0,maxLength || 180);
  }

  function stableSourceHash(value) {
    var hash = 2166136261;
    var input = String(value || '');
    for(var index = 0; index < input.length; index++) {
      hash ^= input.charCodeAt(index);
      hash = Math.imul(hash,16777619);
    }
    return (hash >>> 0).toString(16).padStart(8,'0');
  }

  function stableUtf8SourceHash(value) {
    var hash = 2166136261;
    var input = unescape(encodeURIComponent(String(value || '')));
    for(var index = 0; index < input.length; index++) {
      hash ^= input.charCodeAt(index);
      hash = Math.imul(hash,16777619);
    }
    return (hash >>> 0).toString(16).padStart(8,'0');
  }

  function sourcePathRelativeToSelectedRoot(value) {
    var parts = normalizeSourcePath(value).split('/').filter(Boolean);
    return (parts.length > 1 ? parts.slice(1) : parts).join('/');
  }

  function formatSourceBytes(bytes) {
    var value = Math.max(0,Number(bytes) || 0);
    if(value >= 1073741824) return `${(value / 1073741824).toFixed(2)} gb`;
    if(value >= 1048576) return `${(value / 1048576).toFixed(2)} mb`;
    return `${Math.max(1,Math.round(value / 1024))} kb`;
  }

  function setBandlabSourceState(message, ready) {
    var state = document.getElementById('bandlabSourceState');
    if(!state) return;
    state.textContent = cleanSingleLine(message,260);
    state.classList.toggle('ready',Boolean(ready));
  }

  function setBandlabProgress(percent, message) {
    var progress = document.getElementById('bandlabProgress');
    var fill = document.getElementById('bandlabProgressFill');
    var text = document.getElementById('bandlabProgressText');
    var pct = document.getElementById('bandlabProgressPct');
    var value = Math.max(0,Math.min(100,Math.round(Number(percent) || 0)));
    if(progress) progress.classList.toggle('active',bandlabSyncRunning || value > 0);
    if(fill) fill.style.width = value + '%';
    if(text) text.textContent = cleanSingleLine(message || 'waiting',180);
    if(pct) pct.textContent = value + '%';
  }

  function openBandlabSourceDb() {
    return new Promise((resolve,reject) => {
      if(!window.indexedDB) return reject(new Error('source memory is unavailable'));
      var request = indexedDB.open(BANDLAB_SOURCE_DB,1);
      request.onupgradeneeded = () => {
        var db = request.result;
        if(!db.objectStoreNames.contains(BANDLAB_SOURCE_STORE)) db.createObjectStore(BANDLAB_SOURCE_STORE);
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('source memory failed'));
    });
  }

  async function rememberBandlabSourceHandle(handle) {
    if(!handle || handle.kind !== 'directory') return;
    bandlabSourceHandle = handle;
    try {
      var db = await openBandlabSourceDb();
      await new Promise((resolve,reject) => {
        var request = db.transaction(BANDLAB_SOURCE_STORE,'readwrite').objectStore(BANDLAB_SOURCE_STORE).put(handle,'bandlab');
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      });
      db.close();
    } catch(error) {}
    var button = document.getElementById('bandlabRescanBtn');
    if(button) button.disabled = false;
  }

  async function restoreBandlabSourceHandle() {
    try {
      var db = await openBandlabSourceDb();
      var handle = await new Promise((resolve,reject) => {
        var request = db.transaction(BANDLAB_SOURCE_STORE,'readonly').objectStore(BANDLAB_SOURCE_STORE).get('bandlab');
        request.onsuccess = () => resolve(request.result || null);
        request.onerror = () => reject(request.error);
      });
      db.close();
      if(handle && handle.kind === 'directory') {
        bandlabSourceHandle = handle;
        var button = document.getElementById('bandlabRescanBtn');
        if(button) button.disabled = false;
        setBandlabSourceState(`${cleanSingleLine(handle.name,100)} connected / scan when ready`,true);
        autoRescanBandlabSource();
      }
    } catch(error) {}
  }

  async function enumerateDirectoryHandle(handle, prefix, output) {
    output = output || [];
    if(output.length > 6000) throw new Error('source contains more than 6000 files');
    for await (var pair of handle.entries()) {
      var name = pair[0];
      var child = pair[1];
      var path = normalizeSourcePath(prefix ? `${prefix}/${name}` : name);
      if(child.kind === 'directory') await enumerateDirectoryHandle(child,path,output);
      else {
        var file = await child.getFile();
        output.push({ file, path });
      }
      if(output.length > 6000) throw new Error('source contains more than 6000 files');
    }
    return output;
  }

  function showBandlabImportPanel() {
    var panel = document.getElementById('controlPanel');
    if(panel) panel.classList.add('active');
    switchPanelTab('upload');
    if(typeof setVaultIntakeMode === 'function') setVaultIntakeMode('bandlab');
    window.requestAnimationFrame(() => document.querySelector('.bandlab-sync-panel')?.scrollIntoView({ behavior:'auto', block:'start' }));
  }

  async function openBandlabFolderPicker() {
    if(!requireAdmin()) return;
    showBandlabImportPanel();
    if(typeof window.showDirectoryPicker !== 'function') {
      document.getElementById('bandlabFolderInput')?.click();
      return;
    }
    try {
      var handle = await window.showDirectoryPicker({ mode:'read', id:'akrasia-bandlab-backup' });
      await rememberBandlabSourceHandle(handle);
      setBandlabSourceState(`scanning ${cleanSingleLine(handle.name,100)}...`,false);
      var entries = await enumerateDirectoryHandle(handle,handle.name,[]);
      await scanBandlabEntries(entries,handle.name,handle);
    } catch(error) {
      if(error && error.name !== 'AbortError') showAppNotice(error.message || 'folder could not be read','error');
    }
  }

  async function rescanBandlabSource() {
    if(!requireAdmin()) return;
    showBandlabImportPanel();
    if(!bandlabSourceHandle) return openBandlabFolderPicker();
    try {
      var permission = typeof bandlabSourceHandle.queryPermission === 'function' ? await bandlabSourceHandle.queryPermission({ mode:'read' }) : 'granted';
      if(permission !== 'granted' && typeof bandlabSourceHandle.requestPermission === 'function') permission = await bandlabSourceHandle.requestPermission({ mode:'read' });
      if(permission !== 'granted') throw new Error('folder permission was not granted');
      setBandlabSourceState(`rescanning ${cleanSingleLine(bandlabSourceHandle.name,100)}...`,false);
      var entries = await enumerateDirectoryHandle(bandlabSourceHandle,bandlabSourceHandle.name,[]);
      await scanBandlabEntries(entries,bandlabSourceHandle.name,bandlabSourceHandle);
    } catch(error) {
      showAppNotice(error.message || 'connected source could not be scanned','error');
    }
  }

  async function autoRescanBandlabSource() {
    if(!isAdmin || !bandlabSourceHandle || bandlabAutoScanAttempted || bandlabSyncRunning) return;
    bandlabAutoScanAttempted = true;
    try {
      var permission = typeof bandlabSourceHandle.queryPermission === 'function' ? await bandlabSourceHandle.queryPermission({ mode:'read' }) : 'granted';
      if(permission !== 'granted') return;
      setBandlabSourceState(`checking ${cleanSingleLine(bandlabSourceHandle.name,100)} for new revisions...`,false);
      var entries = await enumerateDirectoryHandle(bandlabSourceHandle,bandlabSourceHandle.name,[]);
      await scanBandlabEntries(entries,bandlabSourceHandle.name,bandlabSourceHandle);
    } catch(error) {
      setBandlabSourceState(`${cleanSingleLine(bandlabSourceHandle.name,100)} connected / manual rescan needed`,true);
    }
  }

  function bandlabVersion(value, filename) {
    var raw = cleanSingleLine(value,24).toLowerCase();
    var match = raw.match(/^(?:v)?(\d{1,6})$/) || String(filename || '').match(/(?:^|\s|-)(v\d{1,6})(?=\.[^.]+$)/i);
    if(!match) return 'v1';
    var digits = String(match[1] || match[0]).replace(/^v/i,'');
    return normalizeVersionLabel('v' + digits, 'v1');
  }

  function bandlabDateParts(value) {
    var parsed = new Date(String(value || ''));
    if(!Number.isFinite(parsed.getTime())) return { date:'', time:'' };
    return easternDateTimeParts(parsed);
  }

  function bandlabAudioExtension(name) {
    var extension = String(name || '').split('.').pop().toLowerCase();
    return ['mp3','wav','m4a','aac','flac','ogg','opus'].includes(extension) ? extension : '';
  }

  function findSourceSibling(fileMap, directory, filename) {
    var expected = normalizeSourcePath(directory ? `${directory}/${filename}` : filename).toLowerCase();
    if(fileMap.has(expected)) return fileMap.get(expected);
    var cleanName = String(filename || '').toLowerCase();
    return Array.from(fileMap.values()).find(entry => {
      var path = entry.path.toLowerCase();
      return path.slice(path.lastIndexOf('/') + 1) === cleanName && path.slice(0,path.lastIndexOf('/')) === String(directory || '').toLowerCase();
    }) || null;
  }

  function cleanBandlabAnalysisRevision(value) {
    if(!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('analysis revision is not an object');
    var revisionId = cleanSourceToken(value.revisionId,180);
    var revisionNumber = cleanSingleLine(value.revisionNumber,24);
    var sourceSha256 = String(value.sourceSha256 || '').trim().toUpperCase();
    if(!revisionId || !/^v\d{3,}$/i.test(revisionNumber)) throw new Error('analysis revision identity is invalid');
    if(sourceSha256 && !/^[A-F0-9]{64}$/.test(sourceSha256)) throw new Error('analysis source hash is invalid');
    if(!['complete','partial','failed','skipped'].includes(value.analysisStatus)) throw new Error('analysis status is invalid');
    if(JSON.stringify(value).length > 2000000) throw new Error('analysis revision exceeds the 2 MB import limit');
    var output = {
      revisionId,revisionNumber,sourceSha256,analysisStatus:value.analysisStatus,
      analyzedAt:cleanSingleLine(value.analyzedAt,80),
      cache:value.cache && typeof value.cache === 'object' && !Array.isArray(value.cache) ? value.cache : {},
      lyrics:value.lyrics && typeof value.lyrics === 'object' && !Array.isArray(value.lyrics) ? value.lyrics : {},
      audioMetadata:value.audioMetadata && typeof value.audioMetadata === 'object' && !Array.isArray(value.audioMetadata) ? value.audioMetadata : {},
      tagSuggestions:Array.isArray(value.tagSuggestions) ? value.tagSuggestions.slice(0,80) : [],
      eraEvidence:value.eraEvidence && typeof value.eraEvidence === 'object' && !Array.isArray(value.eraEvidence) ? value.eraEvidence : {},
      warnings:Array.isArray(value.warnings) ? value.warnings.map(item => cleanSingleLine(item,500)).filter(Boolean).slice(0,30) : []
    };
    if(String(output.lyrics.syncedText || '').length > 40000) throw new Error('analysis lyrics exceed the Akrasia limit');
    return output;
  }

  async function readBandlabAnalysisSidecar(fileMap,directory,manifest,warnings,manifestPath) {
    var entry = findSourceSibling(fileMap,directory,'akrasia-analysis.json');
    if(!entry) return null;
    if(entry.file.size > 25165824) { warnings.push(`${entry.path}: analysis sidecar exceeds 24 MB`); return null; }
    try {
      var value = JSON.parse(await entry.file.text());
      if(!value || value.schemaVersion !== 1 || !Array.isArray(value.revisions) || value.revisions.length > 2000) throw new Error('unsupported analysis sidecar schema');
      var manifestProjectId = cleanSourceToken(manifest.bandLabProjectId,180);
      var sidecarProjectId = cleanSourceToken(value.projectId,180);
      if(manifestProjectId && sidecarProjectId && manifestProjectId !== sidecarProjectId) throw new Error('analysis project ID does not match manifest');
      var byId = new Map();
      var byHash = new Map();
      value.revisions.forEach((raw,index) => {
        try {
          var revision = cleanBandlabAnalysisRevision(raw);
          if(byId.has(revision.revisionId)) throw new Error('duplicate analysis revision identity');
          byId.set(revision.revisionId,revision);
          if(revision.sourceSha256 && !byHash.has(revision.sourceSha256)) byHash.set(revision.sourceSha256,revision);
        } catch(error) { warnings.push(`${entry.path} revision ${index + 1}: ${cleanSingleLine(error.message,180)}`); }
      });
      return { byId,byHash,path:entry.path };
    } catch(error) {
      warnings.push(`${manifestPath}: analysis sidecar ignored / ${cleanSingleLine(error.message,180)}`);
      return null;
    }
  }

  function makeBandlabItem(project, revision, sourceEntry, manifestPath) {
    var projectTitle = cleanSingleLine(project.projectTitle || revision.projectTitle || sourceEntry.file.name.replace(/\.[^.]+$/,''),120) || 'untitled song';
    var manifestDirectory = normalizeSourcePath(manifestPath).split('/').slice(0,-1);
    var sourceFolder = cleanSingleLine(manifestDirectory[manifestDirectory.length - 1] || projectTitle,120) || projectTitle;
    var projectId = cleanSourceToken(project.bandLabProjectId || revision.bandLabProjectId,100);
    var version = bandlabVersion(revision.revisionNumber,revision.finalFilename || sourceEntry.file.name);
    var revisionId = cleanSourceToken(revision.revisionId,140);
    var relativeManifestPath = sourcePathRelativeToSelectedRoot(manifestPath);
    var projectIdentity = projectId || `local-${stableUtf8SourceHash(relativeManifestPath + ':' + projectTitle)}`;
    var sha = String(revision.sha256 || '').trim().toUpperCase();
    if(!/^[A-F0-9]{64}$/.test(sha)) sha = '';
    var sourceRelativePath = sourcePathRelativeToSelectedRoot(sourceEntry.path).toLowerCase();
    var sourceRevisionId = revisionId || `fallback-${stableUtf8SourceHash(`${projectIdentity}|${version}|${sourceRelativePath}|${sha}`)}`;
    var dateParts = bandlabDateParts(revision.revisionDateTime);
    var sourceUrl = safeExternalUrl(revision.sourceRevisionUrl || '');
    return {
      key:`bandlab:${sourceRevisionId}`,
      projectSelectionKey:projectIdentity,
      projectId,
      projectTitle,
      archiveTitle:projectTitle,
      sourceFolder,
      projectKey:normalizedWorldKey(projectTitle) || `song-${stableSourceHash(projectIdentity)}`,
      version,
      revisionId:sourceRevisionId,
      sha256:sha,
      sourceUrl,
      file:sourceEntry.file,
      relativePath:sourceEntry.path,
      filename:cleanSingleLine(revision.finalFilename || sourceEntry.file.name,240) || sourceEntry.file.name,
      assetDate:dateParts.date,
      assetTime:dateParts.time,
      metadata:{
        projectTitle,
        archiveTitle:projectTitle,
        sourceFolder,
        revisionNumber:version,
        revisionDateTime:cleanSingleLine(revision.revisionDateTime,120),
        revisionAuthor:cleanSingleLine(revision.revisionAuthor,80),
        originalDownloadedFilename:cleanSingleLine(revision.originalDownloadedFilename,240),
        downloadTimestamp:safeDateTime(revision.downloadTimestamp),
        verificationStatus:cleanSingleLine(revision.verificationStatus,40),
        errorOrWarning:cleanSingleLine(revision.errorOrWarning,300),
        backupFormat:cleanSingleLine(project.backupFormat,120),
        embeddedFormat:cleanSingleLine(revision.embeddedMetadata && revision.embeddedMetadata.format,40),
        relativePath:sourceEntry.path,
        fileSizeBytes:Math.max(0,Number(revision.fileSizeBytes) || sourceEntry.file.size || 0)
      },
      existingRow:null,
      status:'new'
    };
  }

  function makeInferredBandlabItem(entry) {
    var filename = entry.file.name;
    var stem = filename.replace(/\.[^.]+$/,'');
    var match = stem.match(/^(.*?)(?:\s*-\s*|\s+)(v\d{1,6})$/i);
    var pathParts = entry.path.split('/');
    var folderTitle = pathParts.length > 1 ? pathParts[pathParts.length - 2] : stem;
    var title = cleanSingleLine(match && match[1] || folderTitle,120) || 'untitled song';
    var version = bandlabVersion(match && match[2],filename);
    var projectIdentity = `inferred-${stableSourceHash(entry.path.slice(0,entry.path.lastIndexOf('/')))}`;
    var revisionId = `inferred-${stableSourceHash(entry.path.toLowerCase())}`;
    var modified = Number(entry.file.lastModified) ? new Date(entry.file.lastModified) : null;
    var dateParts = modified ? easternDateTimeParts(modified) : { date:'',time:'' };
    return {
      key:`bandlab:${revisionId}`,
      projectSelectionKey:projectIdentity,
      projectId:'',
      projectTitle:title,
      archiveTitle:title,
      sourceFolder:cleanSingleLine(folderTitle,120) || title,
      projectKey:normalizedWorldKey(title) || `song-${stableSourceHash(projectIdentity)}`,
      version,
      revisionId,
      sha256:'',
      sourceUrl:'',
      file:entry.file,
      relativePath:entry.path,
      filename:filename,
      assetDate:dateParts.date,
      assetTime:dateParts.time,
      metadata:{ projectTitle:title, archiveTitle:title, sourceFolder:cleanSingleLine(folderTitle,120) || title, revisionNumber:version, revisionDateTime:modified ? modified.toISOString() : '', revisionAuthor:'', originalDownloadedFilename:filename, downloadTimestamp:'', verificationStatus:'inferred from filename', errorOrWarning:'manifest entry not found', backupFormat:'', embeddedFormat:'', relativePath:entry.path, fileSizeBytes:entry.file.size || 0 },
      existingRow:null,
      status:'new'
    };
  }

  function analyzeBandlabPlan() {
    var rows = baseRows();
    var byRevision = new Map();
    var byProjectVersion = new Map();
    var byFileVersion = new Map();
    rows.forEach(row => {
      var revisionId = row.getAttribute('data-source-revision-id');
      var projectId = row.getAttribute('data-source-project-id');
      var version = String(row.getAttribute('data-ver') || '').toLowerCase();
      if(revisionId) byRevision.set(revisionId,row);
      if(projectId && version) byProjectVersion.set(`${projectId}:${version}`,row);
      byFileVersion.set(`${String(row.getAttribute('data-name') || '').toLowerCase()}:${version}`,row);
    });
    bandlabScanState.entries.forEach(item => {
      var existing = byRevision.get(item.revisionId)
        || (item.projectId ? byProjectVersion.get(`${item.projectId}:${item.version.toLowerCase()}`) : null)
        || byFileVersion.get(`${item.filename.toLowerCase()}:${item.version.toLowerCase()}`)
        || null;
      item.existingRow = existing;
      if(!existing) item.status = 'new';
      else if(!existing.getAttribute('data-source-revision-id')) item.status = 'changed';
      else {
        var existingSha = String(existing.getAttribute('data-source-sha256') || '').toUpperCase();
        item.status = item.sha256 && existingSha && item.sha256 !== existingSha ? 'changed' : 'unchanged';
      }
      item.analysisSyncNeeded = Boolean(item.analysis && typeof bandlabAnalysisNeedsSync === 'function' && bandlabAnalysisNeedsSync(item));
    });
  }

  async function scanBandlabEntries(rawEntries, sourceLabel, handle) {
    var entries = Array.from(rawEntries || []).slice(0,6001).map(entry => ({ file:entry.file, path:normalizeSourcePath(entry.path || entry.file && entry.file.webkitRelativePath || entry.file && entry.file.name) })).filter(entry => entry.file && entry.path);
    if(!entries.length) throw new Error('no files were found in that folder');
    if(entries.length > 6000) throw new Error('source contains more than 6000 files');
    var fileMap = new Map(entries.map(entry => [entry.path.toLowerCase(),entry]));
    var manifestEntries = entries.filter(entry => /(^|\/)manifest\.json$/i.test(entry.path));
    if(!manifestEntries.length) throw new Error('no BandLab manifest.json files were found');
    var items = [];
    var matchedPaths = new Set();
    var warnings = [];
    var identities = new Set();
    setBandlabSourceState(`reading ${manifestEntries.length} song manifests...`,false);
    for(var manifestEntry of manifestEntries.slice(0,1000)) {
      if(manifestEntry.file.size > 5242880) { warnings.push(`${manifestEntry.path}: manifest too large`); continue; }
      var manifest;
      try { manifest = JSON.parse(await manifestEntry.file.text()); }
      catch(error) { warnings.push(`${manifestEntry.path}: invalid json`); continue; }
      if(!manifest || !Array.isArray(manifest.revisions)) { warnings.push(`${manifestEntry.path}: revisions missing`); continue; }
      var directory = manifestEntry.path.includes('/') ? manifestEntry.path.slice(0,manifestEntry.path.lastIndexOf('/')) : '';
      var analysisSidecar = await readBandlabAnalysisSidecar(fileMap,directory,manifest,warnings,manifestEntry.path);
      for(var revision of manifest.revisions.slice(0,1000)) {
        var filename = cleanSingleLine(revision && revision.finalFilename,240);
        if(!filename || !bandlabAudioExtension(filename)) continue;
        var sourceEntry = findSourceSibling(fileMap,directory,filename);
        if(!sourceEntry) { warnings.push(`${cleanSingleLine(manifest.projectTitle,80)} ${bandlabVersion(revision.revisionNumber,filename)}: audio missing`); continue; }
        var validation = validateAssetFile(sourceEntry.file,'audio');
        if(validation) { warnings.push(validation); continue; }
        var item = makeBandlabItem(manifest,revision,sourceEntry,manifestEntry.path);
        if(analysisSidecar) {
          item.analysis = analysisSidecar.byId.get(item.revisionId) || (item.sha256 ? analysisSidecar.byHash.get(item.sha256) : null) || null;
          item.analysisSidecar = analysisSidecar.path;
          if(item.analysis && bandlabVersion(item.analysis.revisionNumber) !== item.version) {
            warnings.push(`${item.projectTitle} ${item.version}: analysis revision label does not match the manifest`);
            item.analysis = null;
          }
          item.analysisStale = Boolean(item.analysis && item.sha256 && item.analysis.sourceSha256 && item.sha256 !== item.analysis.sourceSha256);
          if(item.analysisStale) warnings.push(`${item.projectTitle} ${item.version}: analysis hash is stale`);
          else if(item.analysis && item.analysis.analysisStatus !== 'complete') warnings.push(`${item.projectTitle} ${item.version}: analysis is ${item.analysis.analysisStatus} and will require review`);
        }
        if(identities.has(item.key)) continue;
        identities.add(item.key);
        matchedPaths.add(sourceEntry.path.toLowerCase());
        items.push(item);
      }
    }
    entries.filter(entry => bandlabAudioExtension(entry.file.name) && !matchedPaths.has(entry.path.toLowerCase())).forEach(entry => {
      var validation = validateAssetFile(entry.file,'audio');
      if(validation) return warnings.push(validation);
      var item = makeInferredBandlabItem(entry);
      if(identities.has(item.key)) return;
      identities.add(item.key);
      items.push(item);
    });
    if(!items.length) throw new Error('the manifests did not resolve to any audio versions');
    var titleProjects = new Map();
    items.forEach(item => {
      var titleKey = item.projectTitle.toLocaleLowerCase();
      if(!titleProjects.has(titleKey)) titleProjects.set(titleKey,new Set());
      titleProjects.get(titleKey).add(item.projectSelectionKey);
    });
    items.forEach(item => {
      var duplicateTitle = titleProjects.get(item.projectTitle.toLocaleLowerCase())?.size > 1;
      var sourceFolder = cleanSingleLine(item.sourceFolder,120);
      item.archiveTitle = duplicateTitle
        ? (sourceFolder && sourceFolder.toLocaleLowerCase() !== item.projectTitle.toLocaleLowerCase() ? sourceFolder : `${item.projectTitle} [${cleanSourceToken(item.projectSelectionKey,8)}]`)
        : item.projectTitle;
      item.projectKey = normalizedWorldKey(item.archiveTitle) || `song-${stableSourceHash(item.projectSelectionKey)}`;
      item.metadata.archiveTitle = item.archiveTitle;
    });
    items.sort((a,b) => (a.archiveTitle || a.projectTitle).localeCompare(b.archiveTitle || b.projectTitle,undefined,{numeric:true,sensitivity:'base'}) || a.version.localeCompare(b.version,undefined,{numeric:true,sensitivity:'base'}));
    var projectsMap = new Map();
    items.forEach(item => {
      if(!projectsMap.has(item.projectSelectionKey)) projectsMap.set(item.projectSelectionKey,{ key:item.projectSelectionKey, id:item.projectId, title:item.archiveTitle, items:[] });
      projectsMap.get(item.projectSelectionKey).items.push(item);
    });
    bandlabScanState = {
      entries:items,
      projects:Array.from(projectsMap.values()),
      selectedProjects:new Set(projectsMap.keys()),
      warnings,
      sourceLabel:cleanSingleLine(sourceLabel || 'BandLab Backup',120)
    };
    if(handle) await rememberBandlabSourceHandle(handle);
    analyzeBandlabPlan();
    renderBandlabPlan();
    setBandlabSourceState(`${bandlabScanState.sourceLabel} / ${projectsMap.size} songs / ${items.length} versions${warnings.length ? ` / ${warnings.length} warnings` : ''}`,true);
    showAppNotice(`${projectsMap.size} songs and ${items.length} versions resolved from the backup.`);
  }

  function bandlabDestinationForItem(item) {
    var mode = document.getElementById('bandlabImportMode')?.value || 'song-folders';
    var parent = normalizeArchiveDestination(document.getElementById('bandlabParentFolder')?.value || '');
    if(mode === 'root') return '';
    if(mode === 'one-folder') return parent || 'bandlab backup';
    var song = normalizeFolderPath(item.archiveTitle || item.projectTitle).split('/').join(' ') || `song ${stableSourceHash(item.projectSelectionKey)}`;
    return normalizeFolderPath(parent ? `${parent}/${song}` : song);
  }

  function bandlabSortOrder(item) {
    var projectIndex = Math.max(0,bandlabScanState.projects.findIndex(project => project.key === item.projectSelectionKey));
    var versionNumber = Math.max(0,parseInt(String(item.version || '').replace(/\D/g,''),10) || 0);
    return projectIndex * 1000000 + versionNumber * 1000;
  }

  function renderBandlabPlan() {
    var plan = document.getElementById('bandlabPlan');
    if(!plan) return;
    var hasItems = bandlabScanState.entries.length > 0;
    plan.classList.toggle('active',hasItems);
    if(!hasItems) return;
    analyzeBandlabPlan();
    var counts = { new:0, changed:0, unchanged:0 };
    bandlabScanState.entries.forEach(item => counts[item.status]++);
    document.getElementById('bandlabProjectCount').textContent = bandlabScanState.projects.length;
    document.getElementById('bandlabVersionCount').textContent = bandlabScanState.entries.length;
    document.getElementById('bandlabNewCount').textContent = counts.new;
    document.getElementById('bandlabChangedCount').textContent = counts.changed;
    document.getElementById('bandlabUnchangedCount').textContent = counts.unchanged;
    document.getElementById('bandlabSizeCount').textContent = formatSourceBytes(bandlabScanState.entries.reduce((sum,item) => sum + (item.file.size || 0),0));
    var projects = document.getElementById('bandlabProjects');
    projects.innerHTML = bandlabScanState.projects.map(project => {
      var projectCounts = { new:0, changed:0, unchanged:0 };
      project.items.forEach(item => projectCounts[item.status]++);
      var versions = project.items.map(item => item.version);
      var destination = bandlabDestinationForItem(project.items[0]) || 'archive root';
      var analysisCount = project.items.filter(item => item.analysisSyncNeeded).length;
      return `<label class="bandlab-project"><input type="checkbox" data-bandlab-project="${escapeAttr(project.key)}"${bandlabScanState.selectedProjects.has(project.key) ? ' checked' : ''}><span><strong>${escapeHtml(project.title)}</strong><span>${escapeHtml(versions[0])}${versions.length > 1 ? ` - ${escapeHtml(versions[versions.length - 1])}` : ''} / ${escapeHtml(destination)}</span></span><span class="bandlab-project-status"><b>${project.items.length} version${project.items.length === 1 ? '' : 's'}</b>${projectCounts.new} new / ${projectCounts.changed} changed${analysisCount ? ` / ${analysisCount} analysis` : ''}</span></label>`;
    }).join('');
    projects.querySelectorAll('[data-bandlab-project]').forEach(input => input.addEventListener('change',function(){
      if(this.checked) bandlabScanState.selectedProjects.add(this.getAttribute('data-bandlab-project'));
      else bandlabScanState.selectedProjects.delete(this.getAttribute('data-bandlab-project'));
      renderBandlabPlan();
    }));
    var selectedActionable = bandlabScanState.entries.filter(item => bandlabScanState.selectedProjects.has(item.projectSelectionKey) && (item.status !== 'unchanged' || item.analysisSyncNeeded));
    var sync = document.getElementById('bandlabSyncBtn');
    if(sync) {
      sync.disabled = bandlabSyncRunning || !selectedActionable.length;
      var mediaCount = selectedActionable.filter(item => item.status !== 'unchanged').length;
      var analysisCount = selectedActionable.filter(item => item.analysisSyncNeeded).length;
      sync.textContent = selectedActionable.length ? `sync ${mediaCount} media / ${analysisCount} analysis` : 'source already synced';
    }
    var analysisSync = document.getElementById('bandlabAnalysisSyncBtn');
    if(analysisSync) {
      var matchedAnalysisCount = selectedActionable.filter(item => item.analysisSyncNeeded && item.existingRow).length;
      analysisSync.disabled = bandlabSyncRunning || !matchedAnalysisCount;
      analysisSync.textContent = matchedAnalysisCount ? `import ${matchedAnalysisCount} analysis only` : 'no matched analysis to import';
    }
  }

  function toggleAllBandlabProjects(selected) {
    bandlabScanState.selectedProjects = new Set(selected ? bandlabScanState.projects.map(project => project.key) : []);
    renderBandlabPlan();
  }

  async function ensureBandlabSyncSchema() {
    if(!isRemoteReady || !supabaseClient || !isAdmin) throw new Error('admin Supabase access is required for a persistent sync');
    var result = await supabaseClient.from('archive_source_provenance').select('asset_id,source_kind,source_project_id,source_revision_id,source_sha256,source_url,source_metadata,synced_at').limit(1);
    if(result.error) throw new Error('The private BandLab sync table is missing. Run the updated supabase-setup.sql first.');
    if(bandlabScanState.entries.some(item => item.analysis)) {
      var enrichment = await supabaseClient.from('archive_enrichment_suggestions').select('id').limit(1);
      if(enrichment.error) throw new Error('The private enrichment review tables are missing. Run the updated supabase-setup.sql first.');
    }
  }

  function setBandlabCoverState(message, active) {
    var state = document.getElementById('bandlabCoverState');
    if(!state) return;
    state.textContent = cleanSingleLine(message,220);
    state.classList.toggle('active',Boolean(active));
  }

  async function loadBandlabCoverMap() {
    if(!bandlabCoverMapPromise) bandlabCoverMapPromise = fetch('assets/data/bandlab-covers.json',{ cache:'no-store' }).then(async response => {
      if(!response.ok) throw new Error('BandLab artwork index could not be loaded');
      var payload = await response.json();
      if(!payload || !Array.isArray(payload.projects)) throw new Error('BandLab artwork index is invalid');
      return payload.projects.filter(entry => /^[a-f0-9-]{36}$/i.test(entry.projectId || '') && /^https:\/\/bl-prod-images\.azureedge\.net\//i.test(entry.coverUrl || ''));
    }).catch(error => {
      bandlabCoverMapPromise = null;
      throw error;
    });
    return bandlabCoverMapPromise;
  }

  async function bandlabCoverForProject(projectId) {
    var id = String(projectId || '').toLowerCase();
    if(!id) return null;
    return (await loadBandlabCoverMap()).find(entry => String(entry.projectId || '').toLowerCase() === id) || null;
  }

  function bandlabCoverStoragePath(entry, contentType) {
    var parsed = new URL(entry.coverUrl);
    var match = parsed.pathname.match(/\/(songs|users)\/([a-f0-9-]{36})\//i);
    var token = match ? `${match[1]}-${match[2]}`.toLowerCase() : `cover-${stableSourceHash(entry.coverUrl)}`;
    var extension = /png/i.test(contentType || '') ? 'png' : /webp/i.test(contentType || '') ? 'webp' : 'jpg';
    return `bandlab-covers/${token}.${extension}`;
  }

  async function ensureBandlabCoverStored(entry) {
    if(!entry || !entry.coverUrl) return '';
    if(bandlabCoverStoragePromises.has(entry.coverUrl)) return bandlabCoverStoragePromises.get(entry.coverUrl);
    var promise = (async () => {
      var response = await fetch(entry.coverUrl,{ mode:'cors', cache:'force-cache' });
      if(!response.ok) throw new Error(`BandLab cover returned ${response.status}`);
      var blob = await response.blob();
      if(!/^image\//i.test(blob.type || '') || !blob.size || blob.size > 12582912) throw new Error('BandLab cover is not a valid image');
      var path = bandlabCoverStoragePath(entry,blob.type);
      var upload = await supabaseClient.storage.from(STORAGE_BUCKET).upload(path,blob,{ upsert:true, contentType:blob.type, cacheControl:'31536000' });
      if(upload.error) throw upload.error;
      return path;
    })();
    bandlabCoverStoragePromises.set(entry.coverUrl,promise);
    try { return await promise; }
    catch(error) {
      bandlabCoverStoragePromises.delete(entry.coverUrl);
      throw error;
    }
  }

  async function resolveBandlabCoverFields(entry) {
    if(!entry || !entry.coverUrl) return {};
    try {
      return { cover_storage_path:await ensureBandlabCoverStored(entry), cover_url:'' };
    } catch(error) {
      console.warn('BandLab cover storage fallback',entry.title,error);
      return { cover_storage_path:'', cover_url:entry.coverUrl };
    }
  }

  function bandlabCoverTitleKey(value) {
    return cleanSingleLine(value,180).toLocaleLowerCase().replace(/\s+/g,' ').trim();
  }

  async function syncBandlabCovers(options) {
    options = options || {};
    if(!requireAdmin() || bandlabCoverSyncRunning) return;
    var button = document.getElementById('bandlabCoverSyncBtn');
    try {
      await ensureBandlabSyncSchema();
      var coverMap = await loadBandlabCoverMap();
      var provenance = await supabaseClient.from('archive_source_provenance').select('asset_id,source_project_id').eq('source_kind','bandlab').limit(2000);
      if(provenance.error) throw provenance.error;
      var assets = await supabaseClient.from('archive_assets').select('id,title,world_title,project_key').limit(2000);
      if(assets.error) throw assets.error;
      var assetRows = assets.data || [];
      var byProject = new Map();
      (provenance.data || []).forEach(source => {
        var key = String(source.source_project_id || '').toLowerCase();
        if(!byProject.has(key)) byProject.set(key,new Set());
        byProject.get(key).add(source.asset_id);
      });
      var targets = coverMap.map(entry => {
        var ids = new Set(byProject.get(String(entry.projectId || '').toLowerCase()) || []);
        if(entry.titleFallback) {
          var titleKey = bandlabCoverTitleKey(entry.title);
          assetRows.forEach(asset => {
            if([asset.title,asset.world_title,asset.project_key].some(value => bandlabCoverTitleKey(value) === titleKey)) ids.add(asset.id);
          });
        }
        return { entry, ids:Array.from(ids).filter(Boolean) };
      }).filter(target => target.ids.length);
      var versionCount = new Set(targets.flatMap(target => target.ids)).size;
      if(!versionCount) return showAppNotice('no BandLab-linked archive versions were found.','error');
      if(options.confirm !== false && !confirm(`apply BandLab artwork to ${versionCount} archive version(s) across ${targets.length} projects?`)) return;
      bandlabCoverSyncRunning = true;
      if(button) { button.disabled = true; button.textContent = 'syncing artwork'; }
      var completed = 0;
      var failures = [];
      for(var target of targets) {
        setBandlabCoverState(`${completed + 1} / ${targets.length} / ${target.entry.title}`,true);
        try {
          var coverFields = await resolveBandlabCoverFields(target.entry);
          for(var offset = 0; offset < target.ids.length; offset += 100) {
            var update = await supabaseClient.from('archive_assets').update(coverFields).in('id',target.ids.slice(offset,offset + 100));
            if(update.error) throw update.error;
          }
        } catch(error) { failures.push(`${target.entry.title}: ${cleanSingleLine(error.message || 'cover failed',140)}`); }
        completed++;
      }
      await loadRemoteArchive();
      setBandlabCoverState(failures.length ? `${versionCount} versions resolved / ${failures.length} projects failed` : `${versionCount} versions / ${targets.length} project covers synchronized`,!failures.length);
      showAppNotice(failures.length ? `${versionCount} versions updated; ${failures.length} artwork failures.` : `BandLab artwork applied to ${versionCount} versions.`,failures.length ? 'error' : undefined);
    } catch(error) {
      setBandlabCoverState(error.message || 'artwork sync failed',false);
      showAppNotice(error.message || 'BandLab artwork could not be synchronized.','error');
    } finally {
      bandlabCoverSyncRunning = false;
      if(button) { button.disabled = false; button.textContent = 'sync BandLab artwork'; }
    }
  }

  async function saveBandlabProvenance(assetId, item, syncedAt) {
    var result = await supabaseClient.from('archive_source_provenance').upsert({
      asset_id:assetId,
      source_kind:'bandlab',
      source_project_id:item.projectId || item.projectSelectionKey,
      source_revision_id:item.revisionId,
      source_sha256:item.sha256,
      source_url:item.sourceUrl,
      source_metadata:item.metadata,
      synced_at:syncedAt
    },{ onConflict:'source_kind,source_revision_id' });
    if(result.error) throw result.error;
  }

  async function verifyBandlabFileHash(item) {
    if(!item.sha256 || !window.crypto?.subtle || item.file.size > 134217728) return;
    var digest = await window.crypto.subtle.digest('SHA-256',await item.file.arrayBuffer());
    var actual = Array.from(new Uint8Array(digest),byte => byte.toString(16).padStart(2,'0')).join('').toUpperCase();
    if(actual !== item.sha256) throw new Error('audio file no longer matches its verified backup manifest');
  }

  async function saveBandlabRevision(item) {
    var projectToken = cleanSourceToken(item.projectId || item.projectSelectionKey,90) || stableSourceHash(item.projectSelectionKey);
    var revisionToken = cleanSourceToken(item.revisionId,120) || `${projectToken}-${item.version}`;
    var safeName = cleanSourceToken(item.filename,180) || `${item.projectKey}-${item.version}.${bandlabAudioExtension(item.file.name) || 'mp3'}`;
    var storagePath = `bandlab/${projectToken}/${revisionToken}-${safeName}`.slice(0,500);
    await verifyBandlabFileHash(item);
    var upload = await supabaseClient.storage.from(STORAGE_BUCKET).upload(storagePath,item.file,{ upsert:true, contentType:item.file.type || undefined, cacheControl:'3600' });
    if(upload.error) throw upload.error;
    var now = new Date().toISOString();
    var sourceFields = {
      filename:item.filename,
      version:item.version,
      asset_date:item.assetDate || null,
      asset_time:item.assetTime || null,
      type:'audio',
      size_label:formatSourceBytes(item.file.size),
      file_url:'',
      storage_path:storagePath
    };
    try {
      var projectCover = await bandlabCoverForProject(item.projectId || item.projectSelectionKey);
      if(projectCover) Object.assign(sourceFields,await resolveBandlabCoverFields(projectCover));
    } catch(error) { console.warn('BandLab project cover could not attach',item.projectTitle,error); }
    var existingId = item.existingRow && item.existingRow.getAttribute('data-id');
    var replacedStoragePath = item.existingRow && item.existingRow.getAttribute('data-storage-path');
    if(!existingId) {
      var sourceMatch = await supabaseClient.from('archive_source_provenance').select('asset_id').eq('source_kind','bandlab').eq('source_revision_id',item.revisionId).maybeSingle();
      if(sourceMatch.error) throw sourceMatch.error;
      existingId = sourceMatch.data && sourceMatch.data.asset_id;
    }
    if(existingId) {
      var update = await supabaseClient.from('archive_assets').update(sourceFields).eq('id',existingId).select().single();
      if(update.error) throw update.error;
      await saveBandlabProvenance(existingId,item,now);
      if(replacedStoragePath && replacedStoragePath !== storagePath) await supabaseClient.storage.from(STORAGE_BUCKET).remove([replacedStoragePath]);
      return update.data;
    }
    var batch = bandlabDestinationForItem(item);
    var row = Object.assign({},sourceFields,{
      title:item.archiveTitle || item.projectTitle,
      batch:batch || ROOT_ARCHIVE_PATH,
      mood:'raw',
      mood_color:'#ffffff',
      cover_url:sourceFields.cover_url || '',
      cover_storage_path:sourceFields.cover_storage_path || '',
      notes:'',
      synced_lyrics:'',
      spotify_url:'',
      apple_url:'',
      youtube_url:'',
      soundcloud_url:'',
      text_content:'',
      project_key:item.projectKey,
      world_title:item.projectTitle,
      asset_role:'version',
      credits:item.metadata.revisionAuthor ? [{ role:'revision author', name:item.metadata.revisionAuthor }] : [],
      world_summary:`BandLab project preserved from its verified revision history. ${item.metadata.backupFormat || ''}`.trim(),
      object_style:'tape',
      sort_order:bandlabSortOrder(item)
    });
    if(typeof applySavedArchiveRulesToRecord === 'function') applySavedArchiveRulesToRecord(row);
    var insert = await supabaseClient.from('archive_assets').insert(row).select().single();
    if(insert.error && /world_title|schema cache|column/i.test(insert.error.message || '')) {
      delete row.world_title;
      insert = await supabaseClient.from('archive_assets').insert(row).select().single();
      if(insert.data) insert.data.world_title = item.projectTitle;
    }
    if(insert.error) throw insert.error;
    await saveBandlabProvenance(insert.data.id,item,now);
    return insert.data;
  }

  async function syncBandlabRevisionAndAnalysis(item, options) {
    var analysisOnly = Boolean(options && options.analysisOnly);
    var record = null;
    var mediaSaved = !analysisOnly && item.status !== 'unchanged';
    if(mediaSaved) record = await saveBandlabRevision(item);
    var assetId = record?.id || item.existingRow?.getAttribute('data-id') || '';
    if(!assetId && item.revisionId) {
      var sourceMatch = await supabaseClient.from('archive_source_provenance').select('asset_id').eq('source_kind','bandlab').eq('source_revision_id',item.revisionId).maybeSingle();
      if(sourceMatch.error) throw sourceMatch.error;
      assetId = sourceMatch.data?.asset_id || '';
    }
    var analysisSaved = typeof saveBandlabAnalysisSuggestions === 'function' ? await saveBandlabAnalysisSuggestions(assetId,item) : 0;
    return { record,mediaSaved,analysisSaved };
  }

  async function runBandlabSync(options) {
    if(!requireAdmin() || bandlabSyncRunning) return;
    var analysisOnly = Boolean(options && options.analysisOnly);
    var selected = bandlabScanState.entries.filter(item => bandlabScanState.selectedProjects.has(item.projectSelectionKey));
    var queue = analysisOnly
      ? selected.filter(item => item.analysisSyncNeeded && item.existingRow)
      : selected.filter(item => item.status !== 'unchanged' || item.analysisSyncNeeded);
    if(!queue.length) return showAppNotice('the selected source is already synced.');
    try { await ensureBandlabSyncSchema(); }
    catch(error) { return showAppNotice(error.message,'error'); }
    var mediaQueue = analysisOnly ? [] : queue.filter(item => item.status !== 'unchanged');
    var analysisQueue = queue.filter(item => item.analysisSyncNeeded);
    var unmatchedAnalysisCount = analysisOnly ? selected.filter(item => item.analysisSyncNeeded && !item.existingRow).length : 0;
    var totalBytes = mediaQueue.reduce((sum,item) => sum + (item.file.size || 0),0);
    var prompt = analysisOnly
      ? `import ${analysisQueue.length} private analysis sidecar result(s) for existing archive revisions only? zero audio files will be uploaded.${unmatchedAnalysisCount ? ` ${unmatchedAnalysisCount} unmatched analysis result(s) will be skipped.` : ''}`
      : `sync ${mediaQueue.length} media revision(s) / ${formatSourceBytes(totalBytes)} and ${analysisQueue.length} private analysis sidecar result(s)? existing organization, accepted metadata, and manual edits are preserved.`;
    if(!confirm(prompt)) return;
    bandlabSyncCancelled = false;
    bandlabSyncRunning = true;
    var syncButton = document.getElementById('bandlabSyncBtn');
    var cancelButton = document.getElementById('bandlabCancelBtn');
    if(syncButton) syncButton.disabled = true;
    if(cancelButton) cancelButton.disabled = false;
    var cursor = 0;
    var completed = 0;
    var saved = 0;
    var analysisSaved = 0;
    var errors = [];
    setBandlabProgress(1,`preparing ${queue.length} revisions`);
    async function worker() {
      while(!bandlabSyncCancelled) {
        var index = cursor++;
        if(index >= queue.length) return;
        var item = queue[index];
        setBandlabProgress((completed / queue.length) * 100,`${item.archiveTitle || item.projectTitle} / ${item.version}`);
        try {
          var resolution = await syncBandlabRevisionAndAnalysis(item,{ analysisOnly });
          if(!analysisOnly) item.status = 'unchanged';
          if(resolution.mediaSaved) saved++;
          analysisSaved += resolution.analysisSaved;
        } catch(error) {
          errors.push(`${item.archiveTitle || item.projectTitle} ${item.version}: ${cleanSingleLine(error.message || 'sync failed',180)}`);
        }
        completed++;
        setBandlabProgress((completed / queue.length) * 100,bandlabSyncCancelled ? 'stopping after current file' : `${completed} of ${queue.length} resolved`);
      }
    }
    await Promise.all(Array.from({ length:Math.min(2,queue.length) },() => worker()));
    bandlabSyncRunning = false;
    if(cancelButton) cancelButton.disabled = true;
    try { await loadRemoteArchive(); }
    catch(error) { errors.push(cleanSingleLine(error.message || 'archive refresh failed',180)); }
    analyzeBandlabPlan();
    renderBandlabPlan();
    setBandlabProgress(bandlabSyncCancelled ? (completed / queue.length) * 100 : 100,bandlabSyncCancelled ? `${saved} media / ${analysisSaved} drafts saved before stopping` : `${saved} media / ${analysisSaved} private drafts synced${unmatchedAnalysisCount ? ` / ${unmatchedAnalysisCount} unmatched skipped` : ''}`);
    if(errors.length) {
      setBandlabSourceState(`${saved} media + ${analysisSaved} drafts / ${errors.length} failed / ${errors[0]}`,false);
      showAppNotice(`${saved} media and ${analysisSaved} drafts synced; ${errors.length} failed. ${errors[0]}`,'error');
    } else if(bandlabSyncCancelled) {
      showAppNotice(`${saved} media revisions and ${analysisSaved} private drafts synced before stopping.`);
    } else {
      setBandlabSourceState(`${bandlabScanState.sourceLabel} / synchronized`,true);
      showAppNotice(`${saved} media revisions and ${analysisSaved} private drafts synchronized without duplicates.`);
    }
  }

  async function recentBandlabAdditions(hours) {
    var windowHours = Math.max(1,Math.min(24,Number(hours) || 4));
    var cutoff = new Date(Date.now() - windowHours * 3600000).toISOString();
    var provenance = await supabaseClient.from('archive_source_provenance')
      .select('asset_id,source_revision_id,synced_at')
      .eq('source_kind','bandlab')
      .gte('synced_at',cutoff)
      .order('synced_at',{ ascending:false });
    if(provenance.error) throw provenance.error;
    var ids = Array.from(new Set((provenance.data || []).map(item => item.asset_id).filter(Boolean)));
    if(!ids.length) return [];
    var assets = await supabaseClient.from('archive_assets')
      .select('id,title,version,batch,created_at,storage_path,cover_storage_path')
      .in('id',ids);
    if(assets.error) throw assets.error;
    return (assets.data || []).filter(asset => {
      var createdAt = Date.parse(asset.created_at || '');
      return Number.isFinite(createdAt) && createdAt >= Date.parse(cutoff);
    }).sort((a,b) => String(a.title || '').localeCompare(String(b.title || '')) || (parseInt(String(a.version || '').replace(/\D/g,''),10) || 0) - (parseInt(String(b.version || '').replace(/\D/g,''),10) || 0));
  }

  async function undoRecentBandlabAdditions() {
    if(!requireAdmin() || bandlabSyncRunning) return;
    var button = document.getElementById('bandlabUndoRecentBtn');
    if(button) button.disabled = true;
    try {
      var additions = await recentBandlabAdditions(4);
      if(!additions.length) return showAppNotice('no newly created BandLab rows were found in the last four hours.');
      var preview = additions.slice(0,12).map(item => `${cleanSingleLine(item.title || 'untitled',80)} ${normalizeVersionLabel(item.version || 'v1')}`).join('\n');
      var overflow = additions.length > 12 ? `\n+ ${additions.length - 12} more` : '';
      if(!confirm(`remove ${additions.length} archive row(s) created by the recent BandLab sync?\n\n${preview}${overflow}\n\nOlder songs, refreshed revisions, and their accepted metadata will not be touched. This cannot restore a row after removal.`)) return;
      var ids = additions.map(item => item.id);
      var storagePaths = Array.from(new Set(additions.flatMap(item => [item.storage_path,item.cover_storage_path]).filter(Boolean)));
      var removal = await supabaseClient.from('archive_assets').delete().in('id',ids);
      if(removal.error) throw removal.error;
      var storageWarning = '';
      if(storagePaths.length) {
        var storageRemoval = await supabaseClient.storage.from(STORAGE_BUCKET).remove(storagePaths);
        if(storageRemoval.error) storageWarning = ` Cloud storage cleanup needs attention: ${cleanSingleLine(storageRemoval.error.message || 'remove failed',160)}`;
      }
      await loadRemoteArchive();
      analyzeBandlabPlan();
      renderBandlabPlan();
      showAppNotice(`${additions.length} newly added BandLab revision(s) removed.${storageWarning}`,storageWarning ? 'error' : '');
    } catch(error) {
      showAppNotice(`recent BandLab additions could not be removed: ${cleanSingleLine(error.message || 'unknown error',180)}`,'error');
    } finally {
      if(button) button.disabled = false;
    }
  }

  function cancelBandlabSync() {
    if(!bandlabSyncRunning) return;
    bandlabSyncCancelled = true;
    var button = document.getElementById('bandlabCancelBtn');
    if(button) button.disabled = true;
    setBandlabProgress(0,'stopping after current upload');
  }

  function initBandlabImporter() {
    var input = document.getElementById('bandlabFolderInput');
    if(input) input.addEventListener('change',async function(){
      try {
        showBandlabImportPanel();
        var files = Array.from(this.files || []);
        var entries = files.map(file => ({ file, path:file.webkitRelativePath || file.name }));
        var label = normalizeSourcePath(entries[0] && entries[0].path).split('/')[0] || 'chosen backup';
        setBandlabSourceState(`scanning ${label}...`,false);
        await scanBandlabEntries(entries,label,null);
      } catch(error) {
        setBandlabSourceState(error.message || 'backup scan failed',false);
        showAppNotice(error.message || 'backup scan failed','error');
      } finally {
        this.value = '';
      }
    });
    restoreBandlabSourceHandle();
  }

  async function handleFileInject() {
    if(!requireAdmin()) return;
    var title = cleanSingleLine(document.getElementById('injTitle').value, 120);
    var ver = normalizeVersionLabel(cleanSingleLine(document.getElementById('injVer').value, 24), 'v1');
    var forceRoot = Boolean(document.getElementById('injRoot')?.checked);
    var selectedBatch = forceRoot ? '__root__' : document.getElementById('injBatch').value;
    var baseBatch = selectedBatch === '__root__' ? '' : normalizeFolderPath(selectedBatch);
    var subfolder = forceRoot ? '' : normalizeFolderPath(document.getElementById('injSubfolder').value);
    var batch = subfolder ? normalizeFolderPath(baseBatch ? `${baseBatch}/${subfolder}` : subfolder) : baseBatch;
    var type = document.getElementById('injType').value;
    var mood = cleanSingleLine(document.getElementById('injMood').value.toLowerCase(), 32) || 'raw';
    var moodColor = safeHexColor(document.getElementById('injMoodColor').value);
    var notes = cleanMultiline(document.getElementById('injNotes').value, 12000);
    var lyrics = cleanMultiline(document.getElementById('injLyrics').value, 40000);
    var projectLabel = cleanSingleLine(document.getElementById('injProject').value, 100);
    var worldMeta = {
      projectKey: projectLabel.toLowerCase(),
      worldTitle: projectLabel.replace(/[-_]+/g, ' '),
      role: safeWorldRole(document.getElementById('injRole').value),
      objectStyle: safeObjectStyle(document.getElementById('injObjectStyle').value),
      credits: parseCreditsText(document.getElementById('injCredits').value),
      summary: cleanMultiline(document.getElementById('injWorldSummary').value, 4000)
    };
    var rawLinks = {
      spotify: document.getElementById('injSpotify').value,
      apple: document.getElementById('injApple').value,
      youtube: document.getElementById('injYoutube').value,
      soundcloud: document.getElementById('injSoundcloud').value
    };
    var links = Object.fromEntries(Object.entries(rawLinks).map(([key,value]) => [key,safeExternalUrl(value)]));
    var fileInput = document.getElementById('injFile');
    var coverInput = document.getElementById('injCover');
    
    if(!fileInput.files.length) return alert("select at least one core file.");
    var files = Array.from(fileInput.files);
    var invalidLink = Object.keys(rawLinks).find(key => String(rawLinks[key] || '').trim() && !links[key]);
    if(invalidLink) return alert(`${invalidLink} must be a secure https link.`);
    var invalidFile = files.map(file => validateAssetFile(file, type)).find(Boolean);
    if(invalidFile) return alert(invalidFile);
    var assetDate = selectedAssetDate();
    var assetTime = selectedAssetTime();
    var dateStr = displayDateTime(assetDate, assetTime);
    var submitBtn = document.querySelector('#injectForm button[onclick="handleFileInject()"]');
    var coverFile = coverInput.files.length > 0 ? coverInput.files[0] : null;
    if(coverFile && (validateAssetFile(coverFile, 'image') || coverFile.size > 26214400)) return alert('cover art must be a valid image under 25mb.');

    archiveDestination(batch);
    updateDirectoryDropdown();
    generateFilterChip(mood, moodColor);
    setUploadProgress(4, files.length > 1 ? `preparing ${files.length} files` : 'preparing file');

    if(isRemoteReady) {
      try {
        for(var i = 0; i < files.length; i++) {
          var file = files[i];
          var uploadTitle = titleForUpload(file, title, i, files.length);
          var sizeStr = (file.size / 1024 / 1024).toFixed(2) + 'mb';
          var startPct = (i / files.length) * 92 + 4;
          if(submitBtn) submitBtn.textContent = files.length > 1 ? `uploading ${i + 1}/${files.length}...` : 'uploading...';
          setUploadProgress(startPct, files.length > 1 ? `uploading ${i + 1}/${files.length}` : 'uploading file');
          var remoteRecord = await saveRemoteAsset({
            file,
            coverFile,
            name: file.name,
            title: uploadTitle,
            batch,
            mood,
            moodColor,
            type,
            size: sizeStr,
            date: dateStr,
            assetDate,
            assetTime,
            ver,
            notes,
            lyrics,
            links,
            worldMeta
          });
          createRowFromRecord(remoteRecord, true);
          setUploadProgress(((i + 1) / files.length) * 92 + 4, files.length > 1 ? `indexed ${i + 1}/${files.length}` : 'indexed file');
        }
        setUploadProgress(100, 'upload complete');
        showAppNotice(batch ? `indexed in ${batch}` : 'indexed directly in archive root');
        document.getElementById('injectForm').reset();
        toggleRootPlacement(false);
        toggleCoverInput();
        setDefaultAssetDate();
        setFilter(activeFilter);
        updateDirectoryDropdown();
        updateCounts();
        buildQueue();
        if(submitBtn) submitBtn.textContent = 'add to archive';
        resetUploadProgress(950);
        return;
      } catch(err) {
        if(submitBtn) submitBtn.textContent = 'add to archive';
        setUploadProgress(0, 'upload failed');
        resetUploadProgress(1400);
        alert(err.message || 'upload failed.');
        return;
      }
    }

    var coverUrl = '';
    if(type === 'audio' && coverFile) {
      coverUrl = URL.createObjectURL(coverFile);
    }

    files.forEach((file, i) => {
      var uploadTitle = titleForUpload(file, title, i, files.length);
      var sizeStr = (file.size / 1024 / 1024).toFixed(2) + 'mb';
      setUploadProgress(((i + 1) / files.length) * 92 + 4, files.length > 1 ? `indexing ${i + 1}/${files.length}` : 'indexing file');
      createRow(file, file.name, uploadTitle, batch, mood, type, sizeStr, dateStr, coverUrl, ver, notes, links, moodColor, assetDate, assetTime, true, lyrics, worldMeta);
    });
    setUploadProgress(100, 'indexed locally');
    showAppNotice(batch ? `indexed in ${batch}` : 'indexed directly in archive root');
    document.getElementById('injectForm').reset();
    toggleRootPlacement(false);
    toggleCoverInput();
    setDefaultAssetDate();
    setFilter(activeFilter);
    resetUploadProgress(950);
  }
