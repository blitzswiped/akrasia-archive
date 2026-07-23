  // ---- ARCHIVE WORLDS ----------------------------------------------------
  function localDateTimeInputValue(value) {
    if(!value) return '';
    var date = new Date(value);
    if(!Number.isFinite(date.getTime())) return '';
    var local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
    return local.toISOString().slice(0, 16);
  }

  function rowCredits(row) {
    try {
      var value = JSON.parse(row && row.getAttribute('data-credits') || '[]');
      return Array.isArray(value) ? value.filter(item => item && item.role && item.name) : [];
    } catch(error) { return []; }
  }

  function normalizedWorldKey(value) {
    return cleanSingleLine(value, 100).toLowerCase().replace(/\b(v(?:er(?:sion)?)?\s*\d+|demo|mix|master|rough|final|bounce)\b/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
  }

  function projectKeyForRow(row) {
    var explicit = normalizedWorldKey(row && row.getAttribute('data-project-key'));
    if(explicit) return explicit;
    var folderParts = normalizeFolderPath(row && row.getAttribute('data-sub')).split('/').filter(Boolean);
    if(folderParts.length > 1) {
      var leaf = folderParts[folderParts.length - 1];
      if(/^(visuals?|images?|video|notes?|artwork)$/i.test(leaf) && folderParts.length > 1) leaf = folderParts[folderParts.length - 2];
      var folderProject = normalizedWorldKey(leaf);
      if(folderProject) return folderProject;
    }
    var title = normalizedWorldKey(row && row.getAttribute('data-title'));
    if(title) return title;
    return normalizedWorldKey(row && row.getAttribute('data-sub')) || 'unclassified';
  }

  function worldTitleForRow(row) {
    var explicit = cleanSingleLine(row && row.getAttribute('data-project-key'), 100);
    if(explicit) return explicit.replace(/[-_]+/g, ' ');
    var title = cleanSingleLine(row && row.getAttribute('data-title'), 120);
    return title.replace(/\b(v(?:er(?:sion)?)?\s*\d+|demo|mix|master|rough|final|bounce)\b/gi, '').replace(/[\s_-]+$/g, '').trim() || title || 'unclassified';
  }

  function worldRowKey(row) {
    return row && (row.getAttribute('data-id') || row.getAttribute('data-name') || row.getAttribute('data-title')) || '';
  }

  function rowMediaUrl(row) {
    if(!row) return '';
    return row.getAttribute('data-file') || row.getAttribute('data-img-src') || row.getAttribute('data-video-src') || row.getAttribute('data-file-url') || '';
  }

  function worldCoverForRows(rows) {
    var withCover = rows.find(row => row.getAttribute('data-cover'));
    if(withCover) return withCover.getAttribute('data-cover');
    var image = rows.find(row => row.getAttribute('data-type') === 'image' && row.getAttribute('data-img-src'));
    return image ? image.getAttribute('data-img-src') : '';
  }

  function worldGroups() {
    var groups = new Map();
    baseRows().forEach(row => {
      var key = projectKeyForRow(row);
      if(!groups.has(key)) groups.set(key, { key, title:worldTitleForRow(row), rows:[], moodColor:row.getAttribute('data-mood-color') || '#ffffff' });
      var group = groups.get(key);
      group.rows.push(row);
      if(!group.worldTitle && row.getAttribute('data-world-title')) group.worldTitle = row.getAttribute('data-world-title');
      if(!group.summary && row.getAttribute('data-world-summary')) group.summary = row.getAttribute('data-world-summary');
      if(!group.objectStyle && row.getAttribute('data-object-style')) group.objectStyle = row.getAttribute('data-object-style');
    });
    return Array.from(groups.values()).map(group => {
      group.rows.sort((a,b) => (a.getAttribute('data-date') || '').localeCompare(b.getAttribute('data-date') || ''));
      group.cover = worldCoverForRows(group.rows);
      group.audio = group.rows.filter(row => row.getAttribute('data-type') === 'audio');
      group.visuals = group.rows.filter(row => ['image','video'].includes(row.getAttribute('data-type')) || row.getAttribute('data-asset-role') === 'visual');
      group.notes = group.rows.filter(row => row.getAttribute('data-type') === 'text' || row.getAttribute('data-asset-role') === 'note');
      group.latestDate = group.rows.reduce((max,row) => row.getAttribute('data-asset-date') > max ? row.getAttribute('data-asset-date') : max,'');
      group.credits = group.rows.flatMap(rowCredits).filter((item,index,list) => list.findIndex(other => other.role.toLowerCase() === item.role.toLowerCase() && other.name.toLowerCase() === item.name.toLowerCase()) === index);
      var explicitName = cleanSingleLine(group.rows.find(row => row.getAttribute('data-project-key'))?.getAttribute('data-project-key'),100);
      group.title = cleanSingleLine(group.worldTitle,120) || (explicitName ? explicitName.replace(/[-_]+/g,' ') : worldTitleForRow(group.audio[0] || group.rows[0]));
      return group;
    }).sort((a,b) => {
      var aDate = a.rows.reduce((max,row) => row.getAttribute('data-date') > max ? row.getAttribute('data-date') : max, '');
      var bDate = b.rows.reduce((max,row) => row.getAttribute('data-date') > max ? row.getAttribute('data-date') : max, '');
      return bDate.localeCompare(aDate);
    });
  }

  function getWorld(key) {
    return worldGroups().find(group => group.key === key) || null;
  }

  function rowByWorldKey(key) {
    return baseRows().find(row => worldRowKey(row) === key) || null;
  }

  function worldColorChannels(color) {
    var rgb = hexToRgb(color || '#ffffff');
    return `${Math.round(rgb.r)},${Math.round(rgb.g)},${Math.round(rgb.b)}`;
  }

  function openWorldsHub(view) {
    closeSettings(false);
    var viewport = document.getElementById('worldsViewport');
    openAnimatedSurface(viewport);
    viewport.setAttribute('aria-hidden', 'false');
    var requestedView = view || worldsCurrentView || 'worlds';
    if(requestedView === 'worlds') worldsRenderLimit = 24;
    var body = document.getElementById('worldsBody');
    if(body) body.innerHTML = '<div class="world-empty">resolving archive worlds...</div>';
    setAppSection('worlds');
    syncMobileExitControl();
    window.clearTimeout(worldsRenderTimer);
    worldsRenderTimer = window.setTimeout(function(){
      if(viewport && viewport.classList.contains('active')) renderWorldsView(requestedView);
    },80);
  }

  function closeWorldsHub(restore) {
    destroyWorldAudioTools();
    window.clearTimeout(worldsRenderTimer);
    var viewport = document.getElementById('worldsViewport');
    if(viewport) viewport.setAttribute('aria-hidden', 'true');
    var search = document.getElementById('worldsSearch');
    if(search) search.value = '';
    closeAnimatedSurface(viewport, function(){
      if(restore !== false) restoreUnderlyingSection();
      syncMobileExitControl();
    });
  }

  function setWorldNav(view) {
    document.querySelectorAll('[data-world-view]').forEach(button => button.classList.toggle('active', button.getAttribute('data-world-view') === view));
  }

  function renderWorldsView(view) {
    worldsCurrentView = view || 'worlds';
    destroyWorldAudioTools();
    setWorldNav(worldsCurrentView);
    if(worldsCurrentView === 'constellation') return renderVersionConstellation(activeWorldKey);
    if(worldsCurrentView === 'eras' && typeof renderCreativeErasWorlds === 'function') return renderCreativeErasWorlds();
    if(worldsCurrentView === 'radio') return renderArchiveRadio();
    if(worldsCurrentView === 'premieres') return renderPremieres();
    if(worldsCurrentView === 'history') return renderListeningHistory();
    if(worldsCurrentView === 'stats') return renderWorldStats();
    if(worldsCurrentView === 'changelog') return renderArchiveChangelog();
    renderWorldsLanding();
  }

  function renderWorldsLanding() {
    var groups = worldGroups();
    var rows = baseRows();
    var body = document.getElementById('worldsBody');
    if(!groups.length) {
      body.innerHTML = '<div class="world-empty">No song worlds yet.<br>Index a file and its world will form automatically.</div>';
      return;
    }
    var versionCount = groups.reduce((sum,group) => sum + group.audio.length, 0);
    var artifactCount = rows.filter(row => row.getAttribute('data-type') !== 'audio').length;
    var visibleGroups = groups.slice(0, worldsRenderLimit);
    var remaining = Math.max(0, groups.length - visibleGroups.length);
    body.innerHTML = `<section class="worlds-intro"><div class="worlds-intro-copy"><div class="worlds-kicker">archive worlds / songs connected to everything they became</div><h1 class="worlds-title">one song. every state it left behind.</h1><p class="worlds-copy">Versions, covers, notes, credits and visual studies are grouped without changing the original archive. Enter a world to compare recordings, trace connections, or send the whole project into live.</p></div><div class="world-summary"><div>worlds<strong>${groups.length}</strong></div><div>files<strong>${rows.length}</strong></div><div>versions<strong>${versionCount}</strong></div><div>artifacts<strong>${artifactCount}</strong></div></div></section><section class="world-grid">${visibleGroups.map((group,index) => {
      var rgb = worldColorChannels(group.moodColor);
      var art = group.cover ? `<img class="world-card-art" src="${escapeAttr(group.cover)}" alt="" loading="lazy" onerror="this.style.display='none'">` : '<div class="world-card-art"></div>';
      return `<button class="world-card" type="button" style="--world-delay:${Math.min(index,10) * 45}ms;--card-r:${rgb.split(',')[0]};--card-g:${rgb.split(',')[1]};--card-b:${rgb.split(',')[2]}" onclick="openSongWorld(decodeURIComponent('${encodeURIComponent(group.key)}'),'overview')"><span class="world-card-index">${String(index + 1).padStart(2,'0')}</span>${art}<span class="world-card-shade"></span><span class="world-card-copy"><small>song world / ${escapeHtml(group.latestDate || 'undated')}</small><strong>${escapeHtml(group.title)}</strong><span class="world-card-meta"><span>${group.audio.length} versions</span><span>${group.rows.length} files</span><span>${group.visuals.length} visuals</span></span></span><span class="world-card-open">enter world</span></button>`;
    }).join('')}</section>${remaining ? `<button class="worlds-more" type="button" onclick="showMoreWorlds()">reveal ${Math.min(24,remaining)} more worlds / ${remaining} waiting</button>` : ''}`;
  }

  function showMoreWorlds() {
    var viewport = document.getElementById('worldsViewport');
    var previousScroll = viewport ? viewport.scrollTop : 0;
    worldsRenderLimit += 24;
    renderWorldsLanding();
    if(viewport) viewport.scrollTop = previousScroll;
  }

  function renderWorldStats() {
    statsRenderLimits.worlds = 120;
    var body = document.getElementById('worldsBody');
    body.innerHTML = `<section class="worlds-intro"><div class="worlds-intro-copy"><div class="worlds-kicker">play stats / device + archive cloud</div><h1 class="worlds-title">every file leaves a count.</h1><p class="worlds-copy">Search a title, folder, version, or file type. Device plays appear immediately; signed-in archive plays resolve from Supabase when it is available.</p></div></section><section class="world-stats"><div class="stats-head"><span>all indexed files</span><button class="mini-btn" onclick="loadPlayStats(true,'worlds')" type="button">refresh cloud</button></div><div class="stats-tools"><input type="search" id="worldStatsSearch" placeholder="search title, folder, version" oninput="renderPlayStats(remotePlayStatsCache,'worlds')"><select id="worldStatsSort" onchange="renderPlayStats(remotePlayStatsCache,'worlds')"><option value="plays">most played</option><option value="recent">recent plays</option><option value="title">title</option><option value="folder">folder</option></select></div><div class="stats-summary" id="worldStatsTotalPlays"><div>library files<strong>--</strong></div><div>played files<strong>--</strong></div><div>total plays<strong>--</strong></div><div>last played<strong>--</strong></div></div><div class="stats-source"><span id="worldStatsSourceState">device stats ready</span><span>select any row to open it</span></div><div class="stats-list" id="worldStatsPlayList"></div></section>`;
    loadPlayStats(false,'worlds');
  }

  function renderWorldSearch(query) {
    var clean = cleanSingleLine(query, 120).toLowerCase();
    if(!clean) return renderWorldsView(worldsCurrentView);
    destroyWorldAudioTools();
    setWorldNav('');
    var terms = clean.split(/\s+/).filter(Boolean);
    var results = baseRows().filter(row => {
      return typeof archiveRowMatchesStructuredSearch === 'function' ? archiveRowMatchesStructuredSearch(row,clean) : terms.every(term => archiveSearchText(row).includes(term));
    });
    var body = document.getElementById('worldsBody');
    body.innerHTML = `<section class="worlds-intro"><div class="worlds-intro-copy"><div class="worlds-kicker">archive search / ${results.length} signals</div><h1 class="worlds-title">${escapeHtml(query)}</h1><p class="worlds-copy">Searching filenames, titles, lyrics, notes, credits, versions, dates, moods and folders together.</p></div></section>${results.length ? `<div class="world-file-list">${results.map((row,index) => worldFileHtml(row,index)).join('')}</div>` : '<div class="world-empty">Nothing in the archive matches that signal.</div>'}`;
  }

  function worldFileHtml(row, index, endLabel) {
    return `<button class="world-file" type="button" style="--file-index:${index}" onclick="openWorldAsset(decodeURIComponent('${encodeURIComponent(worldRowKey(row))}'))"><span class="world-file-index">${String(index + 1).padStart(2,'0')}</span><span class="world-file-main"><strong>${escapeHtml(row.getAttribute('data-title') || 'untitled')}</strong><span>${escapeHtml(row.getAttribute('data-sub') || 'root')} / ${escapeHtml(row.getAttribute('data-ver') || 'v1')} / ${escapeHtml(row.getAttribute('data-mood') || 'raw')}</span></span><span class="world-file-end">${escapeHtml(endLabel || row.getAttribute('data-type') || 'asset')}</span></button>`;
  }

  function openWorldAsset(key) {
    var row = rowByWorldKey(key);
    if(!row) return;
    handleRowClick({ target:row, fromWorlds:true }, row);
    if(row.getAttribute('data-type') === 'audio') openWorldPlayer();
  }

  function openWorldPlayer() {
    viewerOrigin = 'worlds';
    openMiniPlayerFullscreen();
    syncViewerExitControl();
  }

  function worldArtifactRows(group) {
    return group.rows.filter(row => row.getAttribute('data-type') !== 'audio' || ['visual','note','artifact'].includes(row.getAttribute('data-asset-role')));
  }

  function worldOverviewHtml(group, lead) {
    var recent = group.rows.slice().sort((a,b) => (b.getAttribute('data-date') || '').localeCompare(a.getAttribute('data-date') || '')).slice(0,4);
    var latestVersion = group.audio[group.audio.length - 1]?.getAttribute('data-ver') || 'none';
    var latestDate = group.latestDate ? displayDateFromISO(group.latestDate) : 'undated';
    var eras = typeof acceptedErasForRow === 'function' ? acceptedErasForRow(lead) : [];
    var analysis = typeof worldEnrichmentSummaryHtml === 'function' ? worldEnrichmentSummaryHtml(group) : '';
    return `<div class="world-overview-grid">
      <section class="world-overview-stats" aria-label="world overview">
        <div><small>featured version</small><strong>${escapeHtml(latestVersion)}</strong></div>
        <div><small>creative era</small><strong>${escapeHtml(eras.map(era => era.name).join(' + ') || 'open')}</strong></div>
        <div><small>recorded states</small><strong>${group.audio.length}</strong></div>
        <div><small>artifacts</small><strong>${worldArtifactRows(group).length}</strong></div>
        <div><small>latest change</small><strong>${escapeHtml(latestDate)}</strong></div>
      </section>
      <section class="world-section world-overview-story"><div class="world-section-head"><h3>the story</h3><span>identity + context</span></div><p>${escapeHtml(group.summary || `${group.rows.length} archive files connected across recordings, visual memory, notes, and artifacts.`)}</p></section>
      ${analysis ? `<details class="world-analysis-details"><summary>accepted metadata</summary>${analysis}</details>` : ''}
      <section class="world-section"><div class="world-section-head"><h3>latest signals</h3><span>${recent.length} recent files</span></div><div class="world-file-list">${recent.map((row,index) => worldFileHtml(row,index,row === lead && row.getAttribute('data-type') === 'audio' ? 'play latest' : '')).join('')}</div></section>
    </div>`;
  }

  function worldLyricsRows(group) {
    return group.audio.filter(row => String(row.getAttribute('data-lyrics') || '').trim());
  }

  function worldLyricsHtml(group) {
    var rows = worldLyricsRows(group);
    if(!rows.length) return '<div class="world-empty compact">No accepted synced lyrics in this world yet.</div>';
    return rows.map((row,index) => {
      var lines = parseSyncedLyrics(row.getAttribute('data-lyrics') || '');
      var preview = lines.filter(line => !line.isPause).slice(0,3).map(line => line.text).join(' / ');
      return `<button class="world-lyrics-entry" type="button" onclick="openWorldLyrics(decodeURIComponent('${encodeURIComponent(worldRowKey(row))}'))"><span>${String(index + 1).padStart(2,'0')}</span><div><strong>${escapeHtml(row.getAttribute('data-ver') || 'version')}</strong><small>${lines.length} timed lines</small><p>${escapeHtml(preview || 'instrumental passages')}</p></div><i>open lyrics</i></button>`;
    }).join('');
  }

  function openWorldLyrics(key) {
    var row = rowByWorldKey(key);
    if(!row) return;
    handleRowClick({ target:row,fromWorlds:true },row);
    window.setTimeout(() => openLyricsFullscreen(),80);
  }

  function worldTabContent(group, tab, lead) {
    var versions = group.audio.length ? group.audio.map((row,index) => worldFileHtml(row,index,'play version')).join('') : '<div class="world-empty compact">No audio versions in this world yet.</div>';
    var artifacts = worldArtifactRows(group);
    var credits = group.credits.length ? group.credits.map(item => `<div class="credit-item"><small>${escapeHtml(item.role)}</small><strong>${escapeHtml(item.name)}</strong></div>`).join('') : '<div class="world-empty compact">No credits added yet.</div>';
    var adminPass = isAdmin && lead && lead.getAttribute('data-storage-path') ? `<section class="world-section"><div class="world-section-head"><h3>temporary access link</h3><span>admin / signed media url</span></div><div class="access-pass"><select id="passAsset">${group.rows.filter(row => row.getAttribute('data-storage-path')).map(row => `<option value="${escapeAttr(worldRowKey(row))}">${escapeHtml(row.getAttribute('data-title'))}</option>`).join('')}</select><select id="passDuration"><option value="3600">1 hour</option><option value="21600">6 hours</option><option value="86400">24 hours</option><option value="604800">7 days</option></select><button class="world-action" type="button" onclick="createTemporaryAccessLink()">create link</button></div><div class="access-result" id="accessPassResult">The generated link expires automatically.</div></section>` : '';
    if(tab === 'versions') return `<section class="world-section"><div class="world-section-head"><h3>versions</h3><span>${group.audio.length} recorded states</span></div><div class="world-file-list">${versions}</div></section>${group.audio.length > 1 ? comparisonHtml(group) : ''}`;
    if(tab === 'artifacts') return `<section class="world-section"><div class="world-section-head"><h3>artifacts</h3><span>${artifacts.length} visuals, notes + attached files</span></div><div class="world-file-list">${artifacts.length ? artifacts.map((row,index) => worldFileHtml(row,index)).join('') : '<div class="world-empty compact">This world has no attached artifacts yet.</div>'}</div></section>`;
    if(tab === 'lyrics') return `<section class="world-section"><div class="world-section-head"><h3>lyrics</h3><span>${worldLyricsRows(group).length} accepted revisions</span></div><div class="world-lyrics-list">${worldLyricsHtml(group)}</div></section>`;
    if(tab === 'credits') return `<section class="world-section"><div class="world-section-head"><h3>credits</h3><span>shared across this world</span></div><div class="credits-grid">${credits}</div></section>${adminPass}`;
    return worldOverviewHtml(group, lead);
  }

  function switchSongWorldTab(tab) {
    if(!['overview','versions','artifacts','lyrics','credits'].includes(tab)) return;
    activeWorldTab = tab;
    openSongWorld(activeWorldKey, tab);
    var body = document.getElementById('worldsBody');
    if(body) body.scrollTo({ top:0, behavior:archiveSettings?.motion === 'off' ? 'auto' : 'smooth' });
  }

  function toggleWorldTitleEditor(force) {
    var editor = document.getElementById('worldTitleEditor');
    if(!editor) return;
    editor.hidden = typeof force === 'boolean' ? !force : !editor.hidden;
    if(!editor.hidden) document.getElementById('worldTitleInput')?.focus();
  }

  async function saveWorldTitle(key) {
    if(!requireAdmin()) return;
    var group = getWorld(key);
    var input = document.getElementById('worldTitleInput');
    var button = document.getElementById('worldTitleSave');
    var title = cleanSingleLine(input?.value,120);
    if(!group || !title) return showAppNotice('enter a world title.','error');
    if(button) { button.disabled = true; button.textContent = 'saving...'; }
    var legacyProjectTitle = false;
    try {
      var ids = group.rows.map(row => row.getAttribute('data-id')).filter(Boolean);
      if(isRemoteReady && supabaseClient && ids.length) {
        for(var offset = 0; offset < ids.length; offset += 100) {
          var result = await supabaseClient.from('archive_assets').update({ world_title:title }).in('id',ids.slice(offset,offset + 100));
          if(result.error && /world_title|schema cache|column/i.test(result.error.message || '')) {
            legacyProjectTitle = true;
            result = await supabaseClient.from('archive_assets').update({ project_key:title.toLowerCase() }).in('id',ids.slice(offset,offset + 100));
          }
          if(result.error) throw result.error;
        }
      }
      group.rows.forEach(row => {
        row.setAttribute('data-world-title',title);
        if(legacyProjectTitle) row.setAttribute('data-project-key',title.toLowerCase());
      });
      activeWorldKey = legacyProjectTitle ? normalizedWorldKey(title) : group.key;
      openSongWorld(activeWorldKey,activeWorldTab);
      showAppNotice('world title updated.');
    } catch(error) {
      showAppNotice(error.message || 'world title could not be updated.','error');
      if(button) { button.disabled = false; button.textContent = 'save title'; }
    }
  }

  async function updateWorldCover(input, key) {
    if(!requireAdmin()) return;
    var group = getWorld(key);
    var file = input?.files?.[0];
    if(!group || !file) return;
    if(validateAssetFile(file,'image') || file.size > 26214400) {
      input.value = '';
      return showAppNotice('cover art must be a valid image under 25mb.','error');
    }
    var picker = input.closest('.world-cover-picker');
    if(picker) picker.firstChild.textContent = 'updating...';
    var coverPath = '';
    var coverUrl = '';
    var uploadedPath = '';
    var committed = false;
    var oldCoverPaths = group.rows.map(row => row.getAttribute('data-cover-storage-path')).filter(Boolean);
    try {
      var ids = group.rows.map(row => row.getAttribute('data-id')).filter(Boolean);
      if(isRemoteReady && supabaseClient && ids.length) {
        var safeName = file.name.replace(/[^a-z0-9._-]+/gi,'-');
        coverPath = `covers/worlds/${Date.now()}-${safeName}`;
        var upload = await supabaseClient.storage.from(STORAGE_BUCKET).upload(coverPath,file,{ upsert:false,contentType:file.type || undefined,cacheControl:'3600' });
        if(upload.error) throw upload.error;
        uploadedPath = coverPath;
        var signed = await supabaseClient.storage.from(STORAGE_BUCKET).createSignedUrl(coverPath,21600);
        if(signed.error || !signed.data?.signedUrl) throw signed.error || new Error('could not prepare the cover.');
        coverUrl = signed.data.signedUrl;
        for(var offset = 0; offset < ids.length; offset += 100) {
          var result = await supabaseClient.from('archive_assets').update({ cover_storage_path:coverPath,cover_url:'' }).in('id',ids.slice(offset,offset + 100));
          if(result.error) throw result.error;
        }
        committed = true;
      } else coverUrl = URL.createObjectURL(file);
      group.rows.forEach(row => applyBulkMetadataToRow(row,{ coverChanged:true,coverPath,coverUrl }));
      if(isRemoteReady && supabaseClient && oldCoverPaths.length) {
        var unused = storagePathsUnusedAfterRows(oldCoverPaths,group.rows);
        if(unused.length) await supabaseClient.storage.from(STORAGE_BUCKET).remove(unused);
      }
      var playing = group.rows.find(row => row.classList.contains('playing'));
      if(playing) {
        updateNowPlayingDetails(playing,playing.getAttribute('data-type') || activeMediaType);
        var fsCover = document.getElementById('fsCover');
        if(fsCover) { fsCover.src = coverUrl; fsCover.classList.toggle('active',Boolean(coverUrl)); }
      }
      openSongWorld(group.key,activeWorldTab);
      showAppNotice('world cover updated.');
    } catch(error) {
      if(uploadedPath && !committed && supabaseClient) await supabaseClient.storage.from(STORAGE_BUCKET).remove([uploadedPath]).catch(() => {});
      if(picker) picker.firstChild.textContent = 'change cover';
      showAppNotice(error.message || 'world cover could not be updated.','error');
    }
  }

  function openSongWorld(key, tab) {
    var group = getWorld(key);
    if(!group) return;
    closeSettings(false);
    window.clearTimeout(worldsRenderTimer);
    var viewport = document.getElementById('worldsViewport');
    if(viewport && !viewport.classList.contains('active')) openAnimatedSurface(viewport);
    viewport?.setAttribute('aria-hidden','false');
    var sameWorld = activeWorldKey === key;
    activeWorldKey = key;
    activeWorldTab = ['overview','versions','artifacts','lyrics','credits'].includes(tab) ? tab : (sameWorld ? activeWorldTab : 'overview');
    worldsCurrentView = 'worlds';
    setWorldNav('worlds');
    destroyWorldAudioTools();
    var body = document.getElementById('worldsBody');
    var lead = group.audio[group.audio.length - 1] || group.rows[0];
    var fallback = `<div class="song-world-art-fallback"><span>${escapeHtml(group.title.slice(0,2).toLowerCase())}</span><small>cover not attached</small></div>`;
    var art = group.cover ? `${fallback}<img src="${escapeAttr(group.cover)}" alt="${escapeAttr(group.title)} cover" onerror="this.style.display='none'">` : fallback;
    var coverPicker = isAdmin ? `<label class="world-cover-picker">change cover<input type="file" accept="image/*" onchange="updateWorldCover(this,decodeURIComponent('${encodeURIComponent(group.key)}'))"></label>` : '';
    var tabs = [
      ['overview','overview',group.rows.length],
      ['versions','versions',group.audio.length],
      ['artifacts','artifacts',worldArtifactRows(group).length],
      ['lyrics','lyrics',worldLyricsRows(group).length],
      ['credits','credits',group.credits.length]
    ].map(item => `<button class="${item[0] === activeWorldTab ? 'active' : ''}" type="button" role="tab" aria-selected="${item[0] === activeWorldTab ? 'true' : 'false'}" onclick="switchSongWorldTab('${item[0]}')"><span>${item[1]}</span><small>${item[2]}</small></button>`).join('');
    body.innerHTML = `<article class="song-world" data-world-tab="${escapeAttr(activeWorldTab)}" style="--world-color:${escapeAttr(group.moodColor)}"><aside class="song-world-art-column"><div class="song-world-art">${art}${coverPicker}</div><div class="song-world-id"><div class="worlds-kicker">song world / ${group.rows.length} connected files</div><div class="world-title-heading"><h2>${escapeHtml(group.title)}</h2>${isAdmin ? '<button type="button" onclick="toggleWorldTitleEditor()">rename</button>' : ''}</div><div class="world-title-editor" id="worldTitleEditor" hidden><input id="worldTitleInput" type="text" maxlength="120" value="${escapeAttr(group.title)}" aria-label="world title"><button class="world-action" id="worldTitleSave" type="button" onclick="saveWorldTitle(decodeURIComponent('${encodeURIComponent(group.key)}'))">save title</button></div><p>${escapeHtml(group.summary || `${group.rows.length} archive files connected across versions, visuals, notes, and artifacts.`)}</p></div><div class="song-world-controls"><button class="world-action primary" type="button" onclick="openWorldAsset(decodeURIComponent('${encodeURIComponent(worldRowKey(lead))}'))">play featured</button><button class="world-action" type="button" onclick="switchSongWorldTab('versions')">versions</button><details class="world-more-actions"><summary class="world-action">...</summary><div><button class="world-action" type="button" onclick="renderVersionConstellation(decodeURIComponent('${encodeURIComponent(group.key)}'))">constellation</button><button class="world-action" type="button" onclick="renderArchiveObject(decodeURIComponent('${encodeURIComponent(group.key)}'))">object view</button><button class="world-action" type="button" onclick="openArchiveConnections(rowByWorldKey(decodeURIComponent('${encodeURIComponent(worldRowKey(lead))}')))">connections</button>${isAdmin ? `<button class="world-action" type="button" onclick="queueWorldForLive(decodeURIComponent('${encodeURIComponent(group.key)}'))">queue live</button>` : ''}</div></details></div></aside><div class="song-world-content"><nav class="song-world-tabs" role="tablist" aria-label="song world sections">${tabs}</nav><div class="song-world-tab-panel" role="tabpanel">${worldTabContent(group,activeWorldTab,lead)}</div></div></article>`;
    if(activeWorldTab === 'versions' && group.audio.length > 1) setupComparison(group);
    setAppSection('worlds');
    syncMobileExitControl();
  }

  function openSongWorldForRow(row) {
    row = canonicalRow(row);
    if(row) openSongWorld(projectKeyForRow(row),'overview');
  }

  function renderVersionConstellation(key) {
    var groups = worldGroups();
    var group = getWorld(key) || groups[0];
    if(!group) return renderWorldsLanding();
    activeWorldKey = group.key;
    worldsCurrentView = 'constellation';
    setWorldNav('constellation');
    destroyWorldAudioTools();
    var rows = group.rows.slice(0, 18);
    var origin = group.audio[group.audio.length - 1] || rows[0];
    var satellites = rows.filter(row => row !== origin);
    var positions = satellites.map((row,index) => {
      var angle = (Math.PI * 2 * index / Math.max(1,satellites.length)) - Math.PI / 2;
      var ring = 31 + (index % 3) * 4;
      return { row, x:50 + Math.cos(angle) * ring, y:50 + Math.sin(angle) * ring };
    });
    var options = groups.map(item => `<option value="${escapeAttr(item.key)}"${item.key === group.key ? ' selected' : ''}>${escapeHtml(item.title)}</option>`).join('');
    document.getElementById('worldsBody').innerHTML = `<section class="worlds-intro"><div class="worlds-intro-copy"><div class="worlds-kicker">version constellation / one source, many states</div><h1 class="worlds-title">${escapeHtml(group.title)}</h1><p class="worlds-copy">Every bounce, visual, note and artifact holds its position around the current version. Select a node to open the original archive file.</p></div><select id="constellationSelect" onchange="renderVersionConstellation(this.value)">${options}</select></section><div class="constellation-shell"><svg class="constellation-lines" viewBox="0 0 100 100" preserveAspectRatio="none">${positions.map(pos => `<line x1="50" y1="50" x2="${pos.x.toFixed(2)}" y2="${pos.y.toFixed(2)}"></line>`).join('')}</svg><button class="constellation-node origin" type="button" style="--x:50%;--y:50%" onclick="openWorldAsset(decodeURIComponent('${encodeURIComponent(worldRowKey(origin))}'))">${escapeHtml(origin.getAttribute('data-title') || group.title)}<br>${escapeHtml(origin.getAttribute('data-ver') || 'origin')}</button>${positions.map(pos => { var rgb = worldColorChannels(pos.row.getAttribute('data-mood-color')); return `<button class="constellation-node" type="button" style="--x:${pos.x.toFixed(2)}%;--y:${pos.y.toFixed(2)}%;--node-r:${rgb.split(',')[0]};--node-g:${rgb.split(',')[1]};--node-b:${rgb.split(',')[2]}" onclick="openWorldAsset(decodeURIComponent('${encodeURIComponent(worldRowKey(pos.row))}'))">${escapeHtml(pos.row.getAttribute('data-ver') || pos.row.getAttribute('data-type'))}<br>${escapeHtml(pos.row.getAttribute('data-asset-role') || pos.row.getAttribute('data-type'))}</button>`; }).join('')}<div class="constellation-legend">origin at the center / versions, notes, visuals and artifacts orbit by archive relationship</div></div>`;
  }

  function renderArchiveObject(key, style) {
    var group = getWorld(key);
    if(!group) return;
    activeWorldKey = group.key;
    destroyWorldAudioTools();
    var objectStyle = safeObjectStyle(style || group.objectStyle || 'case');
    var lead = group.audio[group.audio.length - 1] || group.rows[0];
    document.getElementById('worldsBody').innerHTML = `<div class="object-room"><div class="archive-object ${escapeAttr(objectStyle)}"><div class="object-label"><strong>${escapeHtml(group.title)}</strong><span>${escapeHtml(group.rows.length + ' files / ' + (lead.getAttribute('data-ver') || 'archive object'))}</span></div><div class="object-files">${group.rows.slice(0,10).map(row => `<button type="button" onclick="openWorldAsset(decodeURIComponent('${encodeURIComponent(worldRowKey(row))}'))">${escapeHtml(row.getAttribute('data-ver') || row.getAttribute('data-type'))}</button>`).join('')}</div></div><div class="object-controls"><button class="object-control" type="button" onclick="openSongWorld(decodeURIComponent('${encodeURIComponent(group.key)}'))">back to world</button>${['case','notebook','tape','contact-sheet'].map(item => `<button class="object-control${item === objectStyle ? ' active' : ''}" type="button" onclick="renderArchiveObject(decodeURIComponent('${encodeURIComponent(group.key)}'),'${item}')">${item.replace('-',' ')}</button>`).join('')}</div></div>`;
  }

  function comparisonHtml(group) {
    var options = group.audio.map(row => `<option value="${escapeAttr(worldRowKey(row))}">${escapeHtml((row.getAttribute('data-ver') || 'v1') + ' / ' + (row.getAttribute('data-title') || 'untitled'))}</option>`).join('');
    return `<section class="world-section compare-section"><div class="world-section-head"><h3>A / B version comparison</h3><span>two versions / one timestamp</span></div><div class="compare-stage"><div class="compare-side"><small>version A</small><select id="compareSelectA" onchange="loadComparisonSources()">${options}</select><strong id="compareTitleA">version A</strong></div><div class="compare-center">versus</div><div class="compare-side"><small>version B</small><select id="compareSelectB" onchange="loadComparisonSources()">${options}</select><strong id="compareTitleB">version B</strong></div></div><div class="compare-transport"><button class="world-action compare-play" id="comparePlay" type="button" onclick="toggleComparisonPlayback()">play comparison</button><div class="compare-listen" role="group" aria-label="choose which version to hear"><span>listen</span><button type="button" data-compare-mix="0" onclick="setComparisonMix(0,this)">A</button><button class="active" type="button" data-compare-mix="50" onclick="setComparisonMix(50,this)">both</button><button type="button" data-compare-mix="100" onclick="setComparisonMix(100,this)">B</button></div><span class="compare-time" id="compareTime">00:00 / 00:00</span></div><label class="compare-position" for="compareSeek"><span>position</span><input type="range" id="compareSeek" min="0" max="1000" value="0" aria-label="comparison position" oninput="seekComparison(this.value)"></label></section>`;
  }

  function setupComparison(group) {
    var aSelect = document.getElementById('compareSelectA');
    var bSelect = document.getElementById('compareSelectB');
    if(!aSelect || !bSelect || group.audio.length < 2) return;
    aSelect.value = worldRowKey(group.audio[0]);
    bSelect.value = worldRowKey(group.audio[group.audio.length - 1]);
    loadComparisonSources();
    initRangeControls(document.getElementById('worldsBody'));
  }

  function loadComparisonSources() {
    destroyComparison();
    var rowA = rowByWorldKey(document.getElementById('compareSelectA')?.value);
    var rowB = rowByWorldKey(document.getElementById('compareSelectB')?.value);
    if(!rowA || !rowB) return;
    compareState.a = createArchiveAudio(rowMediaUrl(rowA));
    compareState.b = createArchiveAudio(rowMediaUrl(rowB));
    compareState.a.preload = 'metadata';
    compareState.b.preload = 'metadata';
    compareState.a.load(); compareState.b.load();
    var titleA = document.getElementById('compareTitleA');
    var titleB = document.getElementById('compareTitleB');
    if(titleA) titleA.textContent = rowA.getAttribute('data-ver') || rowA.getAttribute('data-title');
    if(titleB) titleB.textContent = rowB.getAttribute('data-ver') || rowB.getAttribute('data-title');
    updateComparisonMix(Number.isFinite(compareState.mix) ? compareState.mix : 50);
    compareState.timer = window.setInterval(updateComparisonDisplay, 120);
  }

  function updateComparisonMix(value) {
    compareState.mix = Math.max(0,Math.min(100,Number(value) || 0));
    var mix = compareState.mix / 100;
    if(compareState.a) compareState.a.volume = Math.cos(mix * Math.PI / 2);
    if(compareState.b) compareState.b.volume = Math.sin(mix * Math.PI / 2);
    document.querySelectorAll('[data-compare-mix]').forEach(button => button.classList.toggle('active',Number(button.dataset.compareMix) === compareState.mix));
  }

  function setComparisonMix(value,button) {
    updateComparisonMix(value);
    if(button) button.blur();
  }

  async function toggleComparisonPlayback() {
    if(!compareState.a || !compareState.b) return;
    if(currentAudio && !currentAudio.paused) currentAudio.pause();
    if(compareState.playing) {
      compareState.a.pause(); compareState.b.pause(); compareState.playing = false;
    } else {
      var start = Math.min(compareState.a.currentTime || 0, compareState.b.currentTime || 0);
      var shortest = Math.min(compareState.a.duration || Infinity,compareState.b.duration || Infinity);
      if(!Number.isFinite(shortest) || start >= shortest - .12) start = 0;
      compareState.a.currentTime = start; compareState.b.currentTime = start;
      var results = await Promise.allSettled([compareState.a.play(),compareState.b.play()]);
      compareState.playing = results.some(result => result.status === 'fulfilled');
    }
    var button = document.getElementById('comparePlay');
    if(button) button.textContent = compareState.playing ? 'pause comparison' : 'play comparison';
  }

  function updateComparisonDisplay() {
    if(!compareState.a || !compareState.b) return;
    if(compareState.playing && Math.abs(compareState.a.currentTime - compareState.b.currentTime) > .12) compareState.b.currentTime = compareState.a.currentTime;
    var duration = Math.max(compareState.a.duration || 0, compareState.b.duration || 0);
    var current = Math.max(compareState.a.currentTime || 0, compareState.b.currentTime || 0);
    var seek = document.getElementById('compareSeek');
    if(seek && duration) seek.value = Math.round(current / duration * 1000);
    var time = document.getElementById('compareTime');
    if(time) time.textContent = `${fmt(current)} / ${fmt(duration)}`;
    if(duration && current >= duration - .08) {
      compareState.playing = false;
      var button = document.getElementById('comparePlay');
      if(button) button.textContent = 'play comparison';
    }
  }

  function seekComparison(value) {
    if(!compareState.a || !compareState.b) return;
    var duration = Math.max(compareState.a.duration || 0,compareState.b.duration || 0);
    var time = duration * Math.max(0,Math.min(1,(Number(value) || 0) / 1000));
    compareState.a.currentTime = Math.min(time,compareState.a.duration || time);
    compareState.b.currentTime = Math.min(time,compareState.b.duration || time);
    updateComparisonDisplay();
  }

  function destroyComparison() {
    window.clearInterval(compareState.timer);
    ['a','b'].forEach(side => {
      if(compareState[side]) { compareState[side].pause(); compareState[side].removeAttribute('src'); }
    });
    compareState = { a:null,b:null,timer:null,playing:false,mix:50 };
  }

  function destroyWorldAudioTools() { destroyComparison(); }

  function radioRows(mode) {
    var rows = baseRows().filter(row => row.getAttribute('data-type') === 'audio' && rowMediaUrl(row));
    mode = mode || archiveSettings?.radioMode || 'deep';
    if(mode === 'recent') rows.sort((a,b) => (b.getAttribute('data-date') || '').localeCompare(a.getAttribute('data-date') || ''));
    if(mode === 'demos') rows = rows.filter(row => /demo|rough|raw|v1/i.test([row.getAttribute('data-title'),row.getAttribute('data-ver'),row.getAttribute('data-mood')].join(' ')));
    if(mode === 'instrumentals') rows = rows.filter(row => /instrumental|beat|prod/i.test([row.getAttribute('data-title'),row.getAttribute('data-asset-role')].join(' ')));
    if(!rows.length && mode !== 'deep') return radioRows('deep');
    return rows;
  }

  function shuffleRows(rows) {
    return rows.map(row => ({row,sort:Math.random()})).sort((a,b) => a.sort-b.sort).map(item => item.row);
  }

  function startArchiveRadio(mode) {
    mode = mode || archiveSettings?.radioMode || 'deep';
    archiveSettings.radioMode = mode;
    saveArchiveSettings();
    var rows = radioRows(mode);
    if(!rows.length) return showAppNotice('archive radio needs at least one playable audio file.','error');
    audioQueue = mode === 'recent' ? rows : shuffleRows(rows);
    queueIndex = -1;
    playTrackFromQueue(0);
    if(document.getElementById('worldsViewport')?.classList.contains('active')) {
      setAppSection('worlds');
      window.setTimeout(renderArchiveRadio,80);
    }
  }

  function renderArchiveRadio() {
    var mode = archiveSettings?.radioMode || 'deep';
    var playing = document.querySelector('.frow.playing');
    document.getElementById('worldsBody').innerHTML = `<section class="radio-station ${currentAudio && !currentAudio.paused ? '' : 'paused'}"><div class="radio-orbit"><div class="radio-disc"></div></div><div class="radio-copy"><div class="worlds-kicker">archive radio / ${escapeHtml(mode)}</div><h2>the vault keeps moving.</h2><p>A continuous station built from the files already inside Akrasia. Change the logic without losing the archive's order.</p><div class="radio-modes">${[['deep','deep archive'],['recent','recent'],['demos','demos + roughs'],['instrumentals','instrumentals'],['versions','song versions']].map(item => `<button class="world-action${item[0] === mode ? ' active' : ''}" type="button" onclick="startArchiveRadio('${item[0]}')">${item[1]}</button>`).join('')}</div><div class="radio-now"><small>${playing ? 'on the signal now' : 'station waiting'}</small><strong>${escapeHtml(playing?.getAttribute('data-title') || 'press a mode to begin')}</strong><div class="song-world-controls" style="margin-top:10px"><button class="world-action" type="button" onclick="toggleCurrentPlayback();setTimeout(renderArchiveRadio,80)">${currentAudio && !currentAudio.paused ? 'pause' : 'play'}</button><button class="world-action" type="button" onclick="playNextTrack();setAppSection('worlds')">next</button><button class="world-action" type="button" onclick="openWorldPlayer()">open player</button></div></div></div></section>`;
  }

  function listeningHistory() {
    try { var value = JSON.parse(localStorage.getItem('akrasia_listening_history') || '[]'); return Array.isArray(value) ? value : []; }
    catch(error) { return []; }
  }

  function recordListeningState(row) {
    if(!archiveSettings?.rememberHistory || !row || !currentAudio || !Number.isFinite(currentAudio.currentTime)) return;
    if(Date.now() - historyWriteAt < 4500) return;
    historyWriteAt = Date.now();
    var key = worldRowKey(row);
    var history = listeningHistory().filter(item => item.key !== key);
    history.unshift({ key, title:row.getAttribute('data-title') || 'untitled', folder:row.getAttribute('data-sub') || 'root', version:row.getAttribute('data-ver') || 'v1', cover:row.getAttribute('data-cover') || '', position:Math.floor(currentAudio.currentTime), duration:Math.floor(currentAudio.duration || 0), playedAt:new Date().toISOString() });
    try { localStorage.setItem('akrasia_listening_history',JSON.stringify(history.slice(0,60))); } catch(error) {}
  }

  function resumeListeningPosition(row,audio) {
    if(!archiveSettings?.resumePlayback || !row || !audio) return;
    var requested = pendingHistoryResume && pendingHistoryResume.key === worldRowKey(row) ? pendingHistoryResume.position : null;
    pendingHistoryResume = null;
    var item = listeningHistory().find(entry => entry.key === worldRowKey(row));
    var position = Number(requested != null ? requested : item?.position) || 0;
    if(position > 5 && audio.duration && position < audio.duration * .94) audio.currentTime = position;
  }

  function renderListeningHistory() {
    var history = listeningHistory();
    document.getElementById('worldsBody').innerHTML = `<section class="worlds-intro"><div class="worlds-intro-copy"><div class="worlds-kicker">listening history / this device</div><h1 class="worlds-title">return to where it stopped.</h1><p class="worlds-copy">Playback positions stay local to this device and can be disabled or cleared in settings.</p></div></section>${history.length ? `<div class="history-list">${history.map(item => `<article class="history-item"><div><strong>${escapeHtml(item.title)}</strong><span>${escapeHtml(item.folder + ' / ' + item.version)} / ${fmt(item.position)} of ${fmt(item.duration)}</span></div><button class="world-action" type="button" onclick="resumeHistoryItem(decodeURIComponent('${encodeURIComponent(item.key)}'),${Number(item.position)||0})">resume</button></article>`).join('')}</div>` : '<div class="world-empty">Listening history is empty.</div>'}`;
  }

  function resumeHistoryItem(key,position) {
    var row = rowByWorldKey(key);
    if(!row) return showAppNotice('that file is no longer available.','error');
    pendingHistoryResume = { key,position };
    buildQueue();
    var index = audioQueue.indexOf(row);
    if(index >= 0) {
      viewerOrigin = 'worlds';
      playTrackFromQueue(index);
      openWorldPlayer();
    }
  }

  function clearListeningHistory() {
    localStorage.removeItem('akrasia_listening_history');
    showAppNotice('listening history cleared.');
    if(worldsCurrentView === 'history') renderListeningHistory();
  }

  function renderArchiveChangelog() {
    var entries = archiveChangelog.length ? archiveChangelog : baseRows().slice().sort((a,b) => (b.getAttribute('data-date') || '').localeCompare(a.getAttribute('data-date') || '')).slice(0,40).map(row => ({ action:'indexed',title:row.getAttribute('data-title'),changed_fields:[row.getAttribute('data-type'),row.getAttribute('data-ver')],happened_at:row.getAttribute('data-asset-date') }));
    document.getElementById('worldsBody').innerHTML = `<section class="worlds-intro"><div class="worlds-intro-copy"><div class="worlds-kicker">archive changes / visible provenance</div><h1 class="worlds-title">the archive remembers its own edits.</h1><p class="worlds-copy">New files, metadata changes and removals resolve into a readable history instead of disappearing silently.</p></div></section>${entries.length ? `<div class="changelog-list">${entries.map(entry => `<article class="change-item"><div><strong>${escapeHtml((entry.action || 'changed') + ' / ' + (entry.title || 'archive item'))}</strong><span>${escapeHtml((entry.changed_fields || []).join(', ') || 'metadata')} </span></div><span>${escapeHtml(entry.happened_at ? new Date(entry.happened_at).toLocaleString() : '')}</span></article>`).join('')}</div>` : '<div class="world-empty">No archive changes recorded yet.</div>'}`;
  }

  function defaultArchiveSettings() {
    return { motion:window.matchMedia('(prefers-reduced-motion:reduce)').matches ? 'calm' : 'full', blur:true, contrast:'standard', lyricScale:1, glowScale:1, rememberHistory:true, resumePlayback:true, radioMode:'deep' };
  }

  function loadArchiveSettings() {
    var stored = {};
    try { stored = JSON.parse(localStorage.getItem('akrasia_settings') || '{}') || {}; } catch(error) {}
    archiveSettings = Object.assign(defaultArchiveSettings(),stored);
    archiveSettings.motion = ['full','calm','off'].includes(archiveSettings.motion) ? archiveSettings.motion : 'full';
    archiveSettings.contrast = ['standard','high'].includes(archiveSettings.contrast) ? archiveSettings.contrast : 'standard';
    archiveSettings.radioMode = ['deep','recent','demos','instrumentals','versions'].includes(archiveSettings.radioMode) ? archiveSettings.radioMode : 'deep';
    archiveSettings.lyricScale = Math.max(.75,Math.min(1.45,Number(archiveSettings.lyricScale) || 1));
    archiveSettings.glowScale = Math.max(0,Math.min(1.5,Number(archiveSettings.glowScale) || 1));
    applyArchiveSettings();
  }

  function syncRangeControl(input) {
    if(!input || input.type !== 'range') return;
    var min = Number(input.min || 0);
    var max = Number(input.max || 100);
    var value = Number(input.value || min);
    var progress = max > min ? Math.max(0,Math.min(100,(value - min) / (max - min) * 100)) : 0;
    input.style.setProperty('--range-progress',progress.toFixed(2) + '%');
  }

  function initRangeControls(root) {
    (root || document).querySelectorAll('input[type="range"]').forEach(syncRangeControl);
  }

  function saveArchiveSettings() {
    if(!archiveSettings) return;
    try { localStorage.setItem('akrasia_settings',JSON.stringify(archiveSettings)); } catch(error) {}
    applyArchiveSettings();
  }

  function applyArchiveSettings() {
    if(!archiveSettings) return;
    var root = document.documentElement;
    root.dataset.motion = archiveSettings.motion;
    root.dataset.blur = archiveSettings.blur ? 'on' : 'off';
    root.dataset.contrast = archiveSettings.contrast;
    root.style.setProperty('--user-lyric-scale',archiveSettings.lyricScale);
    root.style.setProperty('--user-glow-scale',archiveSettings.glowScale);
  }

  function settingToggleHtml(key,title,copy) {
    var on = Boolean(archiveSettings[key]);
    return `<div class="setting-row"><div class="setting-copy"><strong>${escapeHtml(title)}</strong><span>${escapeHtml(copy)}</span></div><button class="setting-toggle ${on ? 'on' : ''}" type="button" aria-label="${escapeAttr(title)}" aria-pressed="${on}" onclick="toggleArchiveSetting('${key}')"><i></i></button></div>`;
  }

  function openSettings() {
    closeWorldsHub(false);
    var viewport = document.getElementById('settingsViewport');
    openAnimatedSurface(viewport);
    viewport.setAttribute('aria-hidden','false');
    renderSettingsPage();
    setAppSection('settings');
    syncMobileExitControl();
  }

  function closeSettings(restore) {
    var viewport = document.getElementById('settingsViewport');
    if(viewport) viewport.setAttribute('aria-hidden','true');
    closeAnimatedSurface(viewport, function(){
      if(restore !== false) restoreUnderlyingSection();
      syncMobileExitControl();
    });
  }

  function renderSettingsPage() {
    var historyCount = listeningHistory().length;
    document.getElementById('settingsGroups').innerHTML = `<section class="settings-group"><h3>motion + atmosphere</h3><div class="setting-row"><div class="setting-copy"><strong>motion level</strong><span>Full movement, a calmer rhythm, or no transitions.</span></div><select onchange="setArchiveSetting('motion',this.value)"><option value="full"${archiveSettings.motion === 'full' ? ' selected' : ''}>full</option><option value="calm"${archiveSettings.motion === 'calm' ? ' selected' : ''}>calm</option><option value="off"${archiveSettings.motion === 'off' ? ' selected' : ''}>off</option></select></div>${settingToggleHtml('blur','glass blur','Disable backdrop blur for clarity or performance.')}<div class="setting-row"><div class="setting-copy"><strong>contrast</strong><span>Increase borders and secondary text visibility.</span></div><select onchange="setArchiveSetting('contrast',this.value)"><option value="standard"${archiveSettings.contrast === 'standard' ? ' selected' : ''}>standard</option><option value="high"${archiveSettings.contrast === 'high' ? ' selected' : ''}>high</option></select></div><div class="setting-row"><div class="setting-copy"><strong>reactive glow</strong><span>Controls lyric and player atmosphere intensity.</span></div><input type="range" min="0" max="150" value="${Math.round(archiveSettings.glowScale * 100)}" oninput="setArchiveSetting('glowScale',this.value/100,false)" onchange="saveArchiveSettings()"></div></section><section class="settings-group"><h3>lyrics + listening</h3><div class="setting-row"><div class="setting-copy"><strong>lyric size</strong><span>Scale focused synced lyrics without breaking the layout.</span></div><input type="range" min="75" max="145" value="${Math.round(archiveSettings.lyricScale * 100)}" oninput="setArchiveSetting('lyricScale',this.value/100,false)" onchange="saveArchiveSettings()"></div>${settingToggleHtml('rememberHistory','listening history',`Remember progress for up to 60 files on this device. ${historyCount} saved now.`)}${settingToggleHtml('resumePlayback','resume playback','Continue a song from its last meaningful position.')}<div class="setting-row"><div class="setting-copy"><strong>clear listening history</strong><span>Remove saved positions from this device.</span></div><button class="settings-action" type="button" onclick="clearListeningHistory();renderSettingsPage()">clear</button></div></section><section class="settings-group"><h3>archive radio + introduction</h3><div class="setting-row"><div class="setting-copy"><strong>default radio signal</strong><span>The mode Archive Radio starts with.</span></div><select onchange="setArchiveSetting('radioMode',this.value)"><option value="deep"${archiveSettings.radioMode === 'deep' ? ' selected' : ''}>deep archive</option><option value="recent"${archiveSettings.radioMode === 'recent' ? ' selected' : ''}>recent</option><option value="demos"${archiveSettings.radioMode === 'demos' ? ' selected' : ''}>demos + roughs</option><option value="instrumentals"${archiveSettings.radioMode === 'instrumentals' ? ' selected' : ''}>instrumentals</option><option value="versions"${archiveSettings.radioMode === 'versions' ? ' selected' : ''}>song versions</option></select></div><div class="setting-row"><div class="setting-copy"><strong>replay archive introduction</strong><span>The cinematic tour normally appears only on the first visit.</span></div><button class="settings-action" type="button" onclick="replayArchiveIntro()">replay</button></div></section>`;
    initRangeControls(document.getElementById('settingsGroups'));
  }

  function toggleArchiveSetting(key) {
    archiveSettings[key] = !archiveSettings[key];
    saveArchiveSettings();
    renderSettingsPage();
  }

  function setArchiveSetting(key,value,persist) {
    archiveSettings[key] = value;
    applyArchiveSettings();
    if(persist !== false) { saveArchiveSettings(); renderSettingsPage(); }
  }

  function replayArchiveIntro() {
    try { localStorage.removeItem('akrasia_tour_seen_v6'); } catch(error) {}
    window.location.reload();
  }

  async function createTemporaryAccessLink() {
    if(!requireAdmin() || !supabaseClient) return showAppNotice('temporary links need Supabase.','error');
    var row = rowByWorldKey(document.getElementById('passAsset')?.value);
    var duration = Math.max(60,Math.min(604800,Number(document.getElementById('passDuration')?.value) || 3600));
    var path = row && row.getAttribute('data-storage-path');
    if(!path) return showAppNotice('this item has no remote storage path.','error');
    var result = await supabaseClient.storage.from(STORAGE_BUCKET).createSignedUrl(path,duration,{ download:false });
    if(result.error || !result.data?.signedUrl) return showAppNotice(result.error?.message || 'could not create link.','error');
    var output = document.getElementById('accessPassResult');
    output.innerHTML = `<a href="${escapeAttr(result.data.signedUrl)}" target="_blank" rel="noopener">${escapeHtml(result.data.signedUrl)}</a><br>expires ${escapeHtml(new Date(Date.now()+duration*1000).toLocaleString())}`;
    try { await navigator.clipboard.writeText(result.data.signedUrl); showAppNotice('temporary access link copied.'); } catch(error) { showAppNotice('temporary access link created.'); }
  }

  function renderPremieres() {
    var list = archivePremieres.slice().sort((a,b) => new Date(a.starts_at) - new Date(b.starts_at));
    document.getElementById('worldsBody').innerHTML = `<section class="worlds-intro"><div class="worlds-intro-copy"><div class="worlds-kicker">live premieres / one shared clock</div><h1 class="worlds-title">everyone hears it together.</h1><p class="worlds-copy">Scheduled broadcasts hold their queue until the countdown reaches zero, then the live room starts automatically for the admin.</p></div></section>${list.length ? `<div class="premiere-grid">${list.map(item => { var starts = new Date(item.starts_at); var future = starts.getTime() > Date.now(); return `<article class="premiere-card ${future ? '' : 'ready'}"><div class="premiere-state">${future ? 'soon' : 'live'}</div><div><h3>${escapeHtml(item.title || 'akrasia premiere')}</h3><p>${escapeHtml((item.queue_length || item.queue?.length || 0) + ' queued items / ' + (item.status || 'scheduled'))}</p></div><div class="premiere-time">${escapeHtml(starts.toLocaleString())}<br><button class="world-action" type="button" onclick="closeWorldsHub(false);openLiveRoom()">open live</button></div></article>`; }).join('')}</div>` : '<div class="world-empty">No live premieres are scheduled.</div>'}`;
  }

  async function loadArchiveExtras() {
    if(!supabaseClient) return;
    var results = await Promise.all([
      supabaseClient.from('archive_changelog').select('*').order('happened_at',{ascending:false}).limit(100),
      supabaseClient.from('live_premieres').select('*').order('starts_at',{ascending:true}).limit(50)
    ]);
    if(!results[0].error) archiveChangelog = results[0].data || [];
    if(!results[1].error) archivePremieres = results[1].data || [];
    hydrateUpcomingPremiere();
  }

  function hydrateUpcomingPremiere() {
    if(!isAdmin || liveQueue.length) return;
    var upcoming = archivePremieres.find(item => new Date(item.starts_at).getTime() > Date.now() && item.status !== 'ended');
    if(!upcoming || !Array.isArray(upcoming.queue)) return;
    liveQueue = upcoming.queue.map(item => findLiveRow(item.key)).filter(Boolean).map(rowToLiveQueueItem);
    liveQueueIndex = -1;
    renderLiveQueue();
  }

  async function scheduleLivePremiere(inputId) {
    if(!requireAdmin()) return;
    if(liveRehearsal) return showAppNotice('premieres stay disabled during a private rehearsal.','error');
    var input = document.getElementById(inputId);
    if(!input?.value) return showAppNotice('choose a premiere date and time.','error');
    var startsAt = safeDateTime(input.value);
    if(!startsAt || new Date(startsAt).getTime() <= Date.now()+5000) return showAppNotice('premiere time must be in the future.','error');
    if(!liveQueue.length) return showAppNotice('add archive items to the live queue first.','error');
    var publicQueue = liveQueue.filter(item => item.source === 'archive').map(item => ({ key:item.key,title:item.title,type:item.type,source:'archive' }));
    if(!publicQueue.length) return showAppNotice('a scheduled premiere needs at least one archive item.','error');
    var title = cleanSingleLine(liveState?.title || liveQueue[0].title || 'akrasia premiere',120);
    var firstPublic = liveQueue.find(item => item.source === 'archive');
    var payload = { room_id:'main',title,starts_at:startsAt,status:'scheduled',queue:publicQueue,queue_length:publicQueue.length,cover:firstPublic?.cover || '',created_at:new Date().toISOString() };
    if(supabaseClient) {
      var result = await supabaseClient.from('live_premieres').insert(payload).select().single();
      if(result.error) return showAppNotice(result.error.message,'error');
      archivePremieres.push(result.data);
    } else archivePremieres.push(Object.assign({id:'local-'+Date.now()},payload));
    liveCountdownAction = 'queue'; liveCountdownAutoStart = true; countdownAutoStarted = false;
    await saveLiveState(Object.assign({},liveState,{room_id:'main',is_live:false,countdown_target:startsAt,countdown_action:'queue',countdown_auto_start:true,queue:publicQueue,queue_index:-1,queue_length:publicQueue.length,scene:'stage',updated_at:new Date().toISOString()}));
    showAppNotice('live premiere scheduled.');
    renderLiveState(liveState);
  }

  async function markActivePremiere(status) {
    if(liveRehearsal || !isAdmin || !supabaseClient || !archivePremieres.length) return;
    var candidates = archivePremieres.filter(item => item.status === 'scheduled' || item.status === 'live').sort((a,b) => Math.abs(new Date(a.starts_at)-Date.now()) - Math.abs(new Date(b.starts_at)-Date.now()));
    var premiere = candidates[0];
    if(!premiere || Math.abs(new Date(premiere.starts_at).getTime()-Date.now()) > 86400000) return;
    var result = await supabaseClient.from('live_premieres').update({status,updated_at:new Date().toISOString()}).eq('id',premiere.id);
    if(!result.error) {
      premiere.status = status;
      premiere.updated_at = new Date().toISOString();
    }
  }

  async function setLiveScene(scene) {
    if(!requireAdmin()) return;
    var safeScene = ['stage','cover','lyrics','archive','blackout','credits'].includes(scene) ? scene : 'stage';
    await saveLiveState(Object.assign({},liveState,{room_id:'main',scene:safeScene,updated_at:new Date().toISOString()}));
    recordLiveRehearsalEvent('scene',safeScene);
    showAppNotice(`director scene: ${safeScene}`);
  }

  function queueWorldForLive(key) {
    if(!requireAdmin()) return;
    var group = getWorld(key);
    if(!group) return;
    var rows = group.audio.concat(group.visuals).filter(row => rowMediaUrl(row));
    rows.forEach(row => liveQueue.push(rowToLiveQueueItem(row)));
    liveQueueIndex = liveQueue.length ? Math.max(-1,liveQueueIndex) : -1;
    renderLiveQueue();
    saveLiveState(Object.assign({},liveState,{room_id:'main'},queueMeta(),{updated_at:new Date().toISOString()}));
    closeWorldsHub(false);
    openLiveRoom();
    toggleLiveAdminDrawer(true);
    showAppNotice(`${rows.length} world files added to live queue.`);
  }
