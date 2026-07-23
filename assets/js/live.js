  function cloneLiveState(state) {
    try { return JSON.parse(JSON.stringify(state || { room_id:'main',is_live:false })); }
    catch(error) { return Object.assign({},state || { room_id:'main',is_live:false }); }
  }

  var LIVE_PHASES = ['offline','armed','countdown','live','paused','ended'];

  function livePhaseFromState(state) {
    state = state || {};
    if(LIVE_PHASES.includes(state.phase)) return state.phase;
    if(state.countdown_target && !state.is_live) return 'countdown';
    if(state.is_live) return state.playing === false && state.type !== 'image' ? 'paused' : 'live';
    if(state.ended_at) return 'ended';
    return 'offline';
  }

  function livePhaseLabel(state) {
    var phase = livePhaseFromState(state);
    return phase === 'live' ? 'on air' : phase;
  }

  function liveRehearsalElapsed() {
    return liveRehearsalStartedAt ? Math.max(0,Math.floor((Date.now()-liveRehearsalStartedAt)/1000)) : 0;
  }

  function recordLiveRehearsalEvent(type,detail) {
    if(!liveRehearsal) return;
    liveRehearsalEvents.push({ type:type || 'action',detail:cleanSingleLine(detail || '',120),at:liveRehearsalElapsed() });
    if(liveRehearsalEvents.length > 200) liveRehearsalEvents.shift();
    syncLiveRehearsalControls();
  }

  function syncLiveRehearsalControls() {
    document.body.classList.toggle('live-rehearsal',liveRehearsal);
    var room = document.getElementById('liveRoom');
    if(room) room.setAttribute('data-rehearsal',liveRehearsal ? 'true' : 'false');
    document.querySelectorAll('[data-rehearsal-toggle]').forEach(button => {
      button.classList.toggle('active',liveRehearsal);
      button.textContent = liveRehearsal ? 'end rehearsal' : (button.closest('.header-actions') ? 'rehearse' : 'rehearse set');
      button.setAttribute('aria-pressed',liveRehearsal ? 'true' : 'false');
    });
    document.querySelectorAll('[data-rehearsal-reset]').forEach(button => button.disabled = !liveRehearsal);
    var statusText = liveRehearsal ? `rehearsing / ${fmt(liveRehearsalElapsed())}` : 'ready';
    document.querySelectorAll('.live-rehearsal-status').forEach(el => el.textContent = statusText);
    var summary = liveRehearsalLastSummary || 'no rehearsal completed yet';
    document.querySelectorAll('.live-rehearsal-last').forEach(el => el.textContent = summary);
    var item = liveQueue[liveQueueIndex];
    var banner = document.getElementById('liveRehearsalBannerStatus');
    if(banner) banner.textContent = liveRehearsal
      ? `${liveQueuePlaying ? 'running' : 'armed'} / ${item ? item.title : 'no item'} / audience disconnected`
      : 'audience disconnected / local preview';
  }

  async function startLiveRehearsal() {
    if(!requireAdmin() || liveRehearsal) return;
    if(liveState && liveState.is_live) return showAppNotice('end the public broadcast before entering rehearsal.','error');
    refreshLiveAssetSelect();
    if(!liveQueue.length) {
      var selectedKey = document.getElementById('liveAssetSelect')?.value || document.getElementById('liveAssetSelectDash')?.value;
      var selectedRow = findLiveRow(selectedKey);
      if(selectedRow) liveQueue.push(rowToLiveQueueItem(selectedRow));
    }
    if(!liveQueue.length) return showAppNotice('add at least one archive or private item to the live queue first.','error');
    liveRehearsalSnapshot = cloneLiveState(liveState);
    liveRehearsal = true;
    liveRehearsalStartedAt = Date.now();
    liveRehearsalEvents = [];
    liveRehearsalSeenItems = new Set();
    liveQueueIndex = liveQueueIndex >= 0 && liveQueueIndex < liveQueue.length ? liveQueueIndex : 0;
    liveQueuePlaying = false;
    liveJoined = false;
    window.clearInterval(liveSyncTimer);
    stopCountdown();
    teardownLivePresence();
    teardownChatRealtime();
    dismissAnnouncement();
    var state = queueItemToState(liveQueue[liveQueueIndex],{ playing:false,position:0,rehearsal:true });
    activeLiveDirectState = state;
    renderLiveQueue();
    playLiveDirectState(state,true);
    await saveLiveState(state);
    openLiveRoom();
    toggleLiveAdminDrawer(true);
    window.clearInterval(liveRehearsalClockTimer);
    liveRehearsalClockTimer = window.setInterval(syncLiveRehearsalControls,1000);
    recordLiveRehearsalEvent('start',liveQueue[liveQueueIndex].title);
    syncLiveRehearsalControls();
    showAppNotice('private rehearsal armed. use start, countdown, or scene controls when ready.');
  }

  function stopLiveRehearsal(reason) {
    if(!liveRehearsal) return;
    var elapsed = liveRehearsalElapsed();
    var actionCount = liveRehearsalEvents.length;
    var itemCount = liveRehearsalSeenItems.size;
    var endReason = cleanSingleLine(reason || 'ended',40) || 'ended';
    window.clearInterval(liveRehearsalClockTimer);
    window.clearInterval(liveSyncTimer);
    window.clearTimeout(liveImageTimer);
    stopCountdown();
    liveQueuePlaying = false;
    activeLiveDirectState = null;
    stopLivePlayback();
    liveRehearsalLastSummary = `last: ${fmt(elapsed)} / ${itemCount} item${itemCount === 1 ? '' : 's'} / ${actionCount} actions / ${endReason}`;
    liveRehearsal = false;
    liveRehearsalStartedAt = 0;
    var restored = cloneLiveState(liveRehearsalSnapshot || { room_id:'main',is_live:false,countdown_target:null,updated_at:new Date().toISOString() });
    delete restored.rehearsal;
    liveRehearsalSnapshot = null;
    renderLiveState(restored);
    renderLiveQueue();
    syncLiveRehearsalControls();
    if(reason !== 'closed' && document.getElementById('liveRoom')?.classList.contains('active')) {
      setupLivePresence((restored && restored.asset_key) || 'main');
      setupChatRealtime();
      loadChatHistory();
      loadLiveState();
    }
    showAppNotice(`rehearsal ${endReason}. no audience state was changed.`);
  }

  async function resetLiveRehearsal() {
    if(!requireAdmin() || !liveRehearsal || !liveQueue.length) return;
    window.clearInterval(liveSyncTimer);
    window.clearTimeout(liveImageTimer);
    stopCountdown();
    liveQueuePlaying = false;
    stopLivePlayback();
    liveQueueIndex = 0;
    liveRehearsalStartedAt = Date.now();
    liveRehearsalEvents = [];
    liveRehearsalSeenItems = new Set();
    var state = queueItemToState(liveQueue[0],{ playing:false,position:0,rehearsal:true });
    activeLiveDirectState = state;
    renderLiveQueue();
    playLiveDirectState(state,true);
    await saveLiveState(state);
    recordLiveRehearsalEvent('restart',liveQueue[0].title);
    showAppNotice('rehearsal returned to the top of the set.');
  }

  function toggleLiveRehearsal() {
    if(liveRehearsal) stopLiveRehearsal('ended');
    else startLiveRehearsal();
  }

  function openLiveRoom() {
    if(typeof ensureArchiveSetupForLive === 'function' && !ensureArchiveSetupForLive()) return;
    closeNowInfo();
    document.getElementById('fsPlayer').classList.remove('active');
    document.getElementById('timelinePanel').classList.remove('active');
    openAnimatedSurface(document.getElementById('liveRoom'));
    document.getElementById('liveRoom').setAttribute('aria-hidden', 'false');
    setLiveMobileTab('watch');
    setAppSection('live');
    refreshLiveAssetSelect();
    renderLiveState(liveState);
    if(!liveRehearsal) {
      setupLivePresence((liveState && liveState.asset_key) || 'main');
      setupChatRealtime();
      loadChatHistory();
      checkIfBanned().then(banned => setChatBanned(banned)).catch(() => {});
      if(!liveJoined) joinLiveRoom(false);
    } else syncLiveRehearsalControls();
  }

  function closeLiveRoom() {
    if(liveRehearsal) stopLiveRehearsal('closed');
    liveJoined = false;
    if(!isAdmin) {
      exitLiveFollowerMode();
      stopLivePlayback();
    }
    toggleLiveAdminDrawer(false);
    var room = document.getElementById('liveRoom');
    room.setAttribute('aria-hidden', 'true');
    teardownLivePresence();
    teardownChatRealtime();
    closeAnimatedSurface(room, function(){
      restoreUnderlyingSection();
      syncMobileExitControl();
    });
  }

  function getLiveUserToken() {
    var token = sessionStorage.getItem('akrasia_live_token');
    if(!token) {
      token = 'user_' + Math.random().toString(36).slice(2, 11) + '_' + Date.now();
      sessionStorage.setItem('akrasia_live_token', token);
    }
    return token;
  }

  function setupLivePresence(sessionKey) {
    teardownLivePresence();
    if(!supabaseClient) return;
    livePresenceChannel = supabaseClient.channel('akrasia-presence-' + (sessionKey || 'main'), {
      config: { presence: { key: getLiveUserToken() } }
    });
    livePresenceChannel
      .on('presence', { event: 'sync' }, () => {
        var state = livePresenceChannel.presenceState();
        liveViewerCount = Object.keys(state).length;
        updateLiveViewerDisplay();
      })
      .subscribe(async status => {
        if(status === 'SUBSCRIBED') await livePresenceChannel.track({ joined_at: Date.now() });
      });
  }

  function teardownLivePresence() {
    if(livePresenceChannel) {
      livePresenceChannel.unsubscribe();
      livePresenceChannel = null;
    }
    liveViewerCount = 0;
    updateLiveViewerDisplay();
    syncLiveAdminControls();
  }

  function updateLiveViewerDisplay() {
    var text = liveRehearsal ? 'audience disconnected' : liveViewerCount + ' watching';
    var el = document.getElementById('liveViewerCount');
    var header = document.getElementById('liveViewerBadgeHeader');
    var dash = document.getElementById('dashViewerCount');
    if(el) el.textContent = text;
    if(header) header.textContent = text;
    if(dash) dash.textContent = liveRehearsal ? 'private' : String(liveViewerCount);
  }

  function toggleLiveAdminDrawer(force) {
    if(!isAdmin) return;
    var drawer = document.getElementById('liveAdminDrawer');
    if(!drawer) return;
    var open = typeof force === 'boolean' ? force : !drawer.classList.contains('open');
    drawer.classList.toggle('open', open);
    drawer.setAttribute('aria-hidden', open ? 'false' : 'true');
    syncLiveAdminControls();
    syncMobileExitControl();
  }

  function setLiveControlView(view) {
    var next = ['set','details','room'].includes(view) ? view : 'set';
    var grid = document.querySelector('#liveAdminDrawer .live-admin-drawer-grid');
    if(grid) grid.setAttribute('data-control-view', next);
    document.querySelectorAll('[data-live-control-tab]').forEach(button => {
      var active = button.getAttribute('data-live-control-tab') === next;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
  }

  function syncLiveAdminControls() {
    var isLive = Boolean(liveState && liveState.is_live);
    var stateText = liveRehearsal ? (liveState.playing ? 'rehearsing' : 'armed') : livePhaseLabel(liveState);
    var queueText = liveQueue.length ? `${Math.max(0, liveQueueIndex) + 1}/${liveQueue.length}` : '--';
    var stateEl = document.getElementById('liveDrawerState');
    var queueEl = document.getElementById('liveDrawerQueue');
    if(stateEl) stateEl.textContent = stateText;
    if(queueEl) queueEl.textContent = queueText;
    var inlineTitle = document.getElementById('liveInlineTitle');
    var inlineNotes = document.getElementById('liveInlineNotes');
    var inlineAuto = document.getElementById('liveInlineAutoStart');
    var dashAuto = document.getElementById('liveCountdownAutoStart');
    var inlineAction = document.getElementById('liveCountdownActionInline');
    var dashAction = document.getElementById('liveCountdownAction');
    if(inlineTitle && !inlineTitle.matches(':focus')) inlineTitle.value = isLive ? (liveState.title || '') : '';
    if(inlineNotes && !inlineNotes.matches(':focus')) inlineNotes.value = isLive ? (liveState.notes || '') : '';
    if(inlineAuto) inlineAuto.checked = liveCountdownAutoStart;
    if(dashAuto) dashAuto.checked = liveCountdownAutoStart;
    if(inlineAction) inlineAction.value = liveCountdownAction;
    if(dashAction) dashAction.value = liveCountdownAction;
    syncLiveRehearsalControls();
  }

  async function applyInlineLiveOverrides() {
    if(!requireAdmin()) return;
    liveCountdownAutoStart = Boolean(document.getElementById('liveInlineAutoStart')?.checked || document.getElementById('liveCountdownAutoStart')?.checked);
    var title = cleanSingleLine(document.getElementById('liveInlineTitle')?.value, 120);
    var notes = cleanMultiline(document.getElementById('liveInlineNotes')?.value, 8000);
    var coverInput = document.getElementById('liveInlineCover');
    var coverFile = coverInput && coverInput.files && coverInput.files[0];
    if(coverFile && validateAssetFile(coverFile, 'image')) return alert('live cover must be a valid image.');
    var cover = '';
    if(coverFile) {
      if(isRemoteReady && supabaseClient && !liveRehearsal) {
        var safeCover = coverFile.name.replace(/[^a-z0-9._-]+/gi, '-');
        var path = `live/covers/${Date.now()}-${safeCover}`;
        var upload = await supabaseClient.storage.from(STORAGE_BUCKET).upload(path, coverFile, { upsert:false });
        if(!upload.error) {
          var signedCover = await supabaseClient.storage.from(STORAGE_BUCKET).createSignedUrl(path,21600);
          if(!signedCover.error) cover = signedCover.data?.signedUrl || '';
        }
      } else {
        cover = URL.createObjectURL(coverFile);
      }
    }
    var nextState = Object.assign({}, liveState || {}, {
      title: title || (liveState && liveState.title) || 'live signal',
      notes: notes || (liveState && liveState.notes) || '',
      countdown_auto_start: liveCountdownAutoStart,
      updated_at: new Date().toISOString()
    });
    if(cover) nextState.cover = cover;
    saveLiveState(nextState);
    syncLiveAdminControls();
  }

  function toggleLiveChatSheet(forceOpen) {
    var side = document.getElementById('liveSide');
    if(!side) return;
    var open = typeof forceOpen === 'boolean' ? forceOpen : !side.classList.contains('chat-open');
    side.classList.toggle('chat-open', open);
  }

  function liveRowKey(row) {
    if(!row) return '';
    return row.getAttribute('data-id') || row.getAttribute('data-name') || row.getAttribute('data-title') || '';
  }

  function liveCustomOverrides() {
    var title = cleanSingleLine(document.getElementById('liveCustomTitle')?.value, 120);
    var notes = cleanMultiline(document.getElementById('liveCustomNotes')?.value, 8000);
    var mood = safeHexColor(document.getElementById('liveCustomMoodColor')?.value);
    return {
      title: title || undefined,
      notes: notes || undefined,
      mood_color: mood || undefined
    };
  }

  async function liveCustomCoverUrl() {
    var inputs = ['liveInlineCover', 'liveCustomCover'].map(id => document.getElementById(id)).filter(Boolean);
    var input = inputs.find(el => el.files && el.files[0]);
    var file = input && input.files && input.files[0];
    if(!file) return '';
    if(isRemoteReady && supabaseClient && isAdmin && !liveRehearsal) {
      var safeName = file.name.replace(/[^a-z0-9._-]+/gi, '-');
      var path = `live/covers/${Date.now()}-${safeName}`;
      var upload = await supabaseClient.storage.from(STORAGE_BUCKET).upload(path, file, { upsert:false });
      if(!upload.error) {
        var signed = await supabaseClient.storage.from(STORAGE_BUCKET).createSignedUrl(path,21600);
        if(!signed.error && signed.data?.signedUrl) return signed.data.signedUrl;
      }
    }
    return URL.createObjectURL(file);
  }

  function queueMeta() {
    return {
      queue: liveQueue.map(item => ({ key:item.key, title:item.title, type:item.type, source:item.source })),
      queue_index: liveQueueIndex,
      queue_length: liveQueue.length
    };
  }

  function findLiveRow(key) {
    if(!key) return null;
    return baseRows().find(row => row.getAttribute('data-id') === key || row.getAttribute('data-name') === key || row.getAttribute('data-title') === key) || null;
  }

  function currentBroadcastRow() {
    var playing = document.querySelector('[data-batch-target] .frow.playing, [data-root-target] > .frow.playing');
    if(playing) return canonicalRow(playing);
    var selected = document.getElementById('liveAssetSelect');
    if(selected && selected.value) return findLiveRow(selected.value);
    return baseRows()[0] || null;
  }

  function refreshLiveAssetSelect() {
    var selects = ['liveAssetSelect', 'liveAssetSelectDash'].map(id => document.getElementById(id)).filter(Boolean);
    if(!liveAssetSelectNeedsRefresh) return;
    var rows = baseRows();
    selects.forEach(select => {
      var current = select.value;
      var fragment = document.createDocumentFragment();
      rows.forEach(row => {
        var option = document.createElement('option');
        option.value = liveRowKey(row);
        option.textContent = `${row.getAttribute('data-title') || 'untitled'} / ${row.getAttribute('data-ver') || 'v1'} / ${row.getAttribute('data-type') || 'asset'}`;
        fragment.appendChild(option);
      });
      select.replaceChildren(fragment);
      var values = Array.from(select.options).map(option => option.value);
      if(current && values.includes(current)) select.value = current;
      else if(liveState && liveState.asset_key && values.includes(liveState.asset_key)) select.value = liveState.asset_key;
    });
    liveAssetSelectNeedsRefresh = false;
  }

  function liveStateFromRow(row, overrides) {
    row = canonicalRow(row);
    var type = row.getAttribute('data-type') || 'audio';
    var videoEl = type === 'video' && row.classList.contains('playing') ? document.querySelector('#fsMediaStage video') : null;
    var playing = type === 'audio'
      ? Boolean(currentAudio && row.classList.contains('playing') && !currentAudio.paused)
      : Boolean(videoEl && !videoEl.paused);
    var currentTime = type === 'audio' && currentAudio && row.classList.contains('playing')
      ? currentAudio.currentTime
      : (videoEl ? videoEl.currentTime : 0);
    var state = {
      room_id: 'main',
      is_live: true,
      asset_key: liveRowKey(row),
      title: row.getAttribute('data-title') || 'untitled',
      type,
      version: row.getAttribute('data-ver') || 'v1',
      folder: row.getAttribute('data-sub') || 'archive',
      mood: row.getAttribute('data-mood') || 'raw',
      mood_color: row.getAttribute('data-mood-color') || '#ffffff',
      notes: row.getAttribute('data-notes') || '',
      cover: row.getAttribute('data-cover') || row.getAttribute('data-img-src') || '',
      file_url: row.getAttribute('data-file-url') || row.getAttribute('data-file') || row.getAttribute('data-img-src') || row.getAttribute('data-video-src') || '',
      position: currentTime || 0,
      playing,
      updated_at: new Date().toISOString(),
      countdown_target: null,
      countdown_action: liveCountdownAction,
      countdown_auto_start: liveCountdownAutoStart,
      rehearsal: liveRehearsal,
      scene: liveState.scene || 'stage',
      phase: playing || type === 'image' ? 'live' : 'armed'
    };
    state = Object.assign(state, queueMeta(), liveCustomOverrides(), overrides || {});
    if(!overrides || !overrides.phase) state.phase = state.playing || type === 'image' ? 'live' : 'armed';
    return state;
  }

  function liveStateFromDirect(base, overrides) {
    var state = Object.assign({}, base || activeLiveDirectState || {});
    var media = livePlaybackEl || document.querySelector('#livePreview video');
    if(state.type === 'audio' && livePlaybackEl) {
      state.position = livePlaybackEl.currentTime || 0;
      state.playing = !livePlaybackEl.paused;
    } else if(state.type === 'video' && media) {
      state.position = media.currentTime || 0;
      state.playing = !media.paused;
    }
    state.room_id = 'main';
    state.is_live = true;
    state.updated_at = new Date().toISOString();
    state.countdown_target = null;
    state.countdown_action = liveCountdownAction;
    state.countdown_auto_start = liveCountdownAutoStart;
    state.rehearsal = liveRehearsal;
    state.phase = state.playing === false && state.type !== 'image' ? 'paused' : 'live';
    state = Object.assign(state, queueMeta(), overrides || {});
    if(!overrides || !overrides.phase) state.phase = state.playing === false && state.type !== 'image' ? 'paused' : 'live';
    return state;
  }

  function liveSyncedPosition(state) {
    var base = Number(state && state.position) || 0;
    if(!state || !state.playing || !state.updated_at) return base;
    var elapsed = (Date.now() - new Date(state.updated_at).getTime()) / 1000;
    if(!Number.isFinite(elapsed) || elapsed < 0) elapsed = 0;
    return base + elapsed;
  }

  function renderLiveState(state) {
    state = state || { is_live: false };
    liveState = state;
    var liveRoomEl = document.getElementById('liveRoom');
    var phase = livePhaseFromState(state);
    var phaseText = livePhaseLabel(state);
    if(liveRoomEl) {
      liveRoomEl.setAttribute('data-live-scene', ['stage','cover','lyrics','archive','blackout','credits'].includes(state.scene) ? state.scene : 'stage');
      liveRoomEl.setAttribute('data-live-phase', phase);
    }
    liveCountdownAction = state.countdown_action || liveCountdownAction || 'room';
    liveCountdownAutoStart = Boolean(state.countdown_auto_start);
    var countdownActionEl = document.getElementById('liveCountdownAction');
    var countdownActionInlineEl = document.getElementById('liveCountdownActionInline');
    var countdownAutoEl = document.getElementById('liveCountdownAutoStart');
    var countdownAutoInlineEl = document.getElementById('liveInlineAutoStart');
    if(countdownActionEl) countdownActionEl.value = liveCountdownAction;
    if(countdownActionInlineEl) countdownActionInlineEl.value = liveCountdownAction;
    if(countdownAutoEl) countdownAutoEl.checked = liveCountdownAutoStart;
    if(countdownAutoInlineEl) countdownAutoInlineEl.checked = liveCountdownAutoStart;
    var row = findLiveRow(state.asset_key);
    var isLive = Boolean(state.is_live);
    var isRehearsal = Boolean(liveRehearsal || state.rehearsal);
    document.body.classList.toggle('is-live', isLive);
    if(!isLive) {
      setLiveFollower(false);
      activeLiveDirectState = null;
      stopLivePlayback();
    }
    var liveBtn = document.getElementById('liveHeaderBtn');
    if(liveBtn) {
      liveBtn.setAttribute('aria-pressed', isLive ? 'true' : 'false');
      liveBtn.title = isRehearsal ? 'private rehearsal active' : (isLive ? 'live broadcast active' : 'open live room');
    }
    var liveColor = hexToRgb(state.mood_color || (row && row.getAttribute('data-mood-color')) || '#ffffff');
    setLiveColor(liveColor);
    var title = isLive ? (state.title || (row && row.getAttribute('data-title')) || 'live signal') : 'live room';
    var type = isLive ? (state.type || (row && row.getAttribute('data-type')) || 'asset') : 'none';
    var folder = isLive ? (state.folder || (row && row.getAttribute('data-sub')) || 'archive') : 'waiting for angel to start a session';
    var version = isLive ? (state.version || (row && row.getAttribute('data-ver')) || '') : '';
    document.getElementById('liveKicker').textContent = isRehearsal ? 'private rehearsal / not broadcasting' : (phase === 'live' || phase === 'paused' ? 'live / angel is broadcasting' : (phase === 'countdown' ? 'live / signal incoming' : (phase === 'ended' ? 'broadcast ended' : 'offline / waiting for signal')));
    document.getElementById('liveTitle').textContent = title;
    document.getElementById('liveSub').textContent = isLive ? `${folder} / ${version} / ${type}` : 'join when angel starts a session. music, videos, images, and archive notes can all be pushed live into the room.';
    document.getElementById('liveStateText').textContent = isRehearsal ? (state.playing ? 'rehearsing' : 'armed') : phaseText;
    document.getElementById('liveTypeText').textContent = type;
    document.getElementById('liveSourceText').textContent = isRehearsal ? 'local preview' : (isLive ? 'live from angel' : 'archive');
    document.getElementById('liveTimeText').textContent = isLive ? fmt(liveSyncedPosition(state)) : '--';
    var queueText = isLive && Number.isFinite(Number(state.queue_length)) && Number(state.queue_length) > 0 ? `${(Number(state.queue_index) || 0) + 1}/${Number(state.queue_length)}` : '--';
    document.getElementById('liveStageStatus').textContent = isRehearsal ? (state.playing ? 'rehearsing' : 'armed') : phaseText;
    document.getElementById('liveStageItem').textContent = title;
    document.getElementById('liveStageQueue').textContent = queueText;
    document.getElementById('liveStageTime').textContent = isLive ? fmt(liveSyncedPosition(state)) : '--';
    var notes = state.notes || (row && row.getAttribute('data-notes')) || '';
    document.getElementById('liveNotes').innerHTML = `<strong>room notes</strong>${escapeHtml(notes || 'no notes are attached to the current live item yet.')}`;
    setMoodTheme(state.mood_color || (row && row.getAttribute('data-mood-color')) || '#ffffff');
    setReactiveColor(liveColor);
    sampleLiveColor(state.cover || state.file_url || (row && (row.getAttribute('data-cover') || row.getAttribute('data-img-src'))) || '');
    renderLivePreview(row, type, state.cover);
    syncLiveAdminControls();
    updateLiveDashboard();
    syncLiveRehearsalControls();
    if(!isLive && state.countdown_target) startCountdown(state.countdown_target);
    else stopCountdown();
  }

  function updateLiveDashboard() {
    var isLive = Boolean(liveState && liveState.is_live);
    var dashState = document.getElementById('dashLiveStateText');
    var dashType = document.getElementById('dashLiveTypeText');
    var dashSource = document.getElementById('dashLiveSourceText');
    if(dashState) dashState.textContent = liveRehearsal ? (liveState.playing ? 'rehearsing' : (liveState.countdown_target ? 'countdown' : 'armed')) : livePhaseLabel(liveState);
    if(dashType) dashType.textContent = isLive ? (liveState.type || 'asset') : 'none';
    if(dashSource) dashSource.textContent = liveRehearsal ? 'local preview' : (isLive ? (liveState.asset_key ? 'archive' : 'live file') : 'archive');
    updateLiveViewerDisplay();
  }

  function setLiveCountdown(inputId) {
    if(!requireAdmin()) return;
    var input = document.getElementById(inputId || 'liveCountdownInputDash');
    if(!input || !input.value) return;
    var actionId = inputId === 'liveCountdownInputInline' ? 'liveCountdownActionInline' : 'liveCountdownAction';
    liveCountdownAction = document.getElementById(actionId)?.value || document.getElementById('liveCountdownAction')?.value || 'room';
    liveCountdownAutoStart = Boolean(document.getElementById('liveInlineAutoStart')?.checked || document.getElementById('liveCountdownAutoStart')?.checked);
    countdownAutoStarted = false;
    var iso = new Date(input.value).toISOString();
    saveLiveState(Object.assign({}, liveState, {
      countdown_target: iso,
      is_live: false,
      phase: 'countdown',
      room_id: 'main',
      countdown_action: liveCountdownAction,
      countdown_auto_start: liveCountdownAutoStart,
      updated_at: new Date().toISOString()
    }));
  }

  function clearLiveCountdown() {
    if(!requireAdmin()) return;
    ['liveCountdownInputDash', 'liveCountdownInputInline'].forEach(id => {
      var input = document.getElementById(id);
      if(input) input.value = '';
    });
    saveLiveState(Object.assign({}, liveState, { countdown_target: null, phase: liveState && liveState.is_live ? livePhaseFromState(liveState) : 'offline', room_id: 'main', updated_at: new Date().toISOString() }));
  }

  function startCountdown(target) {
    window.clearInterval(countdownTimer);
    var el = document.getElementById('liveCountdown');
    var clock = document.getElementById('liveCountdownClock');
    if(!el || !clock || !target) return;
    el.style.display = '';
    var tick = function() {
      var diff = Math.max(0, new Date(target).getTime() - Date.now());
      if(diff === 0) {
        window.clearInterval(countdownTimer);
        clock.textContent = '00:00:00';
        handleCountdownComplete();
        if(!liveRehearsal) loadLiveState();
        return;
      }
      var h = Math.floor(diff / 3600000);
      var m = Math.floor((diff % 3600000) / 60000);
      var s = Math.floor((diff % 60000) / 1000);
      clock.textContent = String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
    };
    tick();
    countdownTimer = window.setInterval(tick, 1000);
  }

  function stopCountdown() {
    window.clearInterval(countdownTimer);
    var el = document.getElementById('liveCountdown');
    if(el) el.style.display = 'none';
  }

  function handleCountdownComplete() {
    if(!isAdmin || !liveCountdownAutoStart || countdownAutoStarted) return;
    countdownAutoStarted = true;
    if(!liveRehearsal) markActivePremiere('live');
    if(liveCountdownAction === 'queue') startLiveQueue();
    else if(liveCountdownAction === 'selected') goLiveWithSelection(document.getElementById('liveAssetSelect')?.value ? 'liveAssetSelect' : 'liveAssetSelectDash');
    else openLiveRoom();
  }

  function setLiveMobileTab(tab) {
    var room = document.getElementById('liveRoom');
    if(!room) return;
    room.setAttribute('data-mobile-tab', tab || 'watch');
    document.querySelectorAll('#liveMobileTabs button').forEach(btn => btn.classList.toggle('active', btn.textContent.trim() === tab));
  }

  function setLiveColor(rgb) {
    rgb = rgb || { r: 255, g: 255, b: 255 };
    document.documentElement.style.setProperty('--live-r', Math.round(rgb.r));
    document.documentElement.style.setProperty('--live-g', Math.round(rgb.g));
    document.documentElement.style.setProperty('--live-b', Math.round(rgb.b));
  }

  function sampleLiveColor(src) {
    if(!src) return;
    if(src === liveSampleColorSignature) return;
    liveSampleColorSignature = src;
    var img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = function() {
      try {
        var sample = document.createElement('canvas');
        sample.width = 20;
        sample.height = 20;
        var ctx = sample.getContext('2d', { willReadFrequently:true });
        ctx.drawImage(img, 0, 0, sample.width, sample.height);
        var data = ctx.getImageData(0, 0, sample.width, sample.height).data;
        var r = 0, g = 0, b = 0, count = 0;
        for(var i = 0; i < data.length; i += 20) {
          if(data[i + 3] < 80) continue;
          var bright = (data[i] + data[i + 1] + data[i + 2]) / 3;
          if(bright < 18) continue;
          r += data[i]; g += data[i + 1]; b += data[i + 2]; count++;
        }
        if(count) setLiveColor({ r:r/count, g:g/count, b:b/count });
      } catch(error) {}
    };
    img.src = src;
  }

  function renderLivePreview(row, type, cover) {
    var preview = document.getElementById('livePreview');
    if(!preview) return;
    var state = liveState || {};
    var source = '';
    if(type === 'image') source = state.file_url || (row && row.getAttribute('data-img-src')) || state.cover || cover || '';
    else if(type === 'video') source = state.file_url || (row && row.getAttribute('data-video-src')) || '';
    else source = state.cover || state.live_cover || cover || (row && (row.getAttribute('data-cover') || row.getAttribute('data-img-src'))) || '';
    var signature = [Boolean(state.is_live), type || 'none', source || '', state.title || '', state.asset_key || ''].join('|');
    if(signature === livePreviewSignature) return;
    livePreviewSignature = signature;
    if(source && (type === 'image' || type === 'audio')) {
      var img = document.createElement('img');
      img.alt = state.title || 'live artwork';
      img.onerror = function() { renderLiveFallback(preview, 'artwork unavailable'); };
      img.onload = function() {
        preview.className = 'live-media-preview';
        preview.innerHTML = '';
        preview.appendChild(img);
        if(type === 'audio') addLiveAudioPulse(preview);
      };
      img.src = source;
      if(!preview.children.length) preview.className = 'live-media-preview loading';
      return;
    }
    if(source && type === 'video') {
      var video = document.createElement('video');
      video.src = source;
      video.muted = true;
      video.playsInline = true;
      video.autoplay = Boolean(state.playing);
      video.controls = false;
      video.onerror = function() { renderLiveFallback(preview, 'video unavailable'); };
      preview.className = 'live-media-preview';
      preview.innerHTML = '';
      preview.appendChild(video);
      video.play().catch(() => {});
      return;
    }
    preview.className = 'live-media-preview';
    preview.innerHTML = '';
    if(type === 'audio') addLiveAudioPulse(preview);
    preview.classList.add('empty');
    renderLiveFallback(preview, type === 'text' ? 'text broadcast' : 'no artwork');
  }

  function renderLiveFallback(container, text) {
    container.innerHTML = '';
    var fallback = document.createElement('div');
    fallback.className = 'live-art-fallback';
    fallback.textContent = text || 'artwork unavailable';
    container.appendChild(fallback);
  }

  function addLiveAudioPulse(container) {
    var pulse = document.createElement('div');
    pulse.className = 'live-audio-pulse';
    pulse.setAttribute('aria-hidden', 'true');
    pulse.innerHTML = '<i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i>';
    container.appendChild(pulse);
  }

  function setupLiveRealtime() {
    if(!supabaseClient || liveChannel) return;
    liveChannel = supabaseClient.channel('akrasia-live-room')
      .on('broadcast', { event: 'state' }, payload => {
        if(payload && payload.payload) receiveLiveState(payload.payload);
      })
      .on('broadcast', { event: 'announcement' }, payload => {
        if(!liveRehearsal && payload && payload.payload) showAnnouncement(payload.payload);
      })
      .subscribe();
  }

  async function loadLiveState() {
    if(!supabaseClient || liveRehearsal) return;
    var result = await supabaseClient.from('archive_live_state').select('*').eq('room_id', 'main').maybeSingle();
    if(!result.error && result.data) renderLiveState(result.data);
  }

  function getLiveChatUsername() {
    var locked = localStorage.getItem('akrasia_chat_name') || sessionStorage.getItem('akrasia_chat_name');
    if(locked) return locked;
    var input = document.getElementById('liveChatUsername');
    return (input && input.value.trim()) || 'listener';
  }

  function lockLiveChatName(name) {
    var clean = cleanSingleLine(name || 'listener', 24) || 'listener';
    sessionStorage.setItem('akrasia_chat_name', clean);
    try { localStorage.setItem('akrasia_chat_name', clean); } catch(error) {}
    var input = document.getElementById('liveChatUsername');
    var row = input && input.closest('.live-chat-input-row');
    if(input) {
      input.value = clean;
      input.disabled = true;
      input.placeholder = clean;
    }
    if(row) {
      row.classList.add('name-locked');
      if(!row.querySelector('.live-chat-name-lock')) {
        var label = document.createElement('div');
        label.className = 'live-chat-name-lock';
        label.textContent = 'chatting as ' + clean;
        row.insertBefore(label, row.firstChild);
      } else {
        row.querySelector('.live-chat-name-lock').textContent = 'chatting as ' + clean;
      }
    }
  }

  function setChatBanned(value) {
    chatBanned = Boolean(value);
    var note = document.getElementById('liveChatBanned');
    var input = document.getElementById('liveChatInput');
    if(note) note.style.display = chatBanned ? '' : 'none';
    if(input) input.disabled = chatBanned;
  }

  async function checkIfBanned() {
    if(!supabaseClient) return false;
    var token = getLiveUserToken();
    var result = await supabaseClient.rpc('is_live_chat_blocked', { p_token: token });
    if(result.error) return false;
    return Boolean(result.data);
  }

  async function sendLiveChat() {
    if(liveRehearsal) return showAppNotice('chat is disconnected during rehearsal.');
    var input = document.getElementById('liveChatInput');
    if(!input) return;
    var message = cleanSingleLine(input.value, 280);
    if(!message || chatBanned) return;
    if(Date.now() - lastChatSentAt < 1800) return;
    var token = getLiveUserToken();
    var username = cleanSingleLine(getLiveChatUsername(), 24) || 'listener';
    lockLiveChatName(username);
    if(supabaseClient) {
      var banned = await checkIfBanned();
      if(banned) {
        setChatBanned(true);
        return;
      }
      var result = await supabaseClient.rpc('post_live_chat', { p_username:username, p_message:message, p_token:token });
      var posted = Array.isArray(result.data) ? result.data[0] : result.data;
      if(posted) {
        appendChatMessage(posted);
      }
      if(result.error) return;
    } else {
      appendChatMessage({ id: 'local-' + Date.now(), username, message, created_at: new Date().toISOString(), user_token: token });
    }
    lastChatSentAt = Date.now();
    input.value = '';
  }

  function appendChatMessage(msg) {
    if(!msg) return;
    if(msg.id && chatMessages.some(existing => existing.id === msg.id)) return;
    chatMessages.push(msg);
    if(chatMessages.length > 180) chatMessages.shift();
    renderLiveChatMessages();
    renderAdminChatFeed();
  }

  function renderLiveChatMessages() {
    var list = document.getElementById('liveChatMessages');
    if(!list) return;
    list.innerHTML = '';
    chatMessages.filter(msg => !msg.is_hidden).slice(-100).forEach(msg => list.appendChild(buildChatMessageRow(msg, false)));
    list.scrollTop = list.scrollHeight;
    var count = chatMessages.filter(msg => !msg.is_hidden).length;
    var el = document.getElementById('liveChatCount');
    if(el) el.textContent = count + (count === 1 ? ' message' : ' messages');
    var toggle = document.getElementById('liveChatToggleCount');
    if(toggle) toggle.textContent = count + (count === 1 ? ' message' : ' messages');
  }

  function buildChatMessageRow(msg, adminView) {
    var row = document.createElement('div');
    row.className = 'chat-message' + (msg.is_hidden ? ' hidden' : '') + (adminView ? ' admin-view' : '');
    row.dataset.token = msg.user_token || '';
    row.dataset.id = msg.id || '';
    var time = msg.created_at ? new Date(msg.created_at).toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' }).toLowerCase() : '';
    row.innerHTML =
      '<span class="chat-name">' + escapeHtml(msg.username || 'listener') + '</span>' +
      '<span class="chat-text">' + escapeHtml(msg.message || '') + '</span>' +
      '<span class="chat-time">' + time + '</span>' +
      (adminView && isAdmin ? (msg.is_hidden ? '<button class="chat-mod-btn" onclick="unhideChatMessage(this)" data-id="' + escapeAttr(msg.id || '') + '">unhide</button>' : '<button class="chat-mod-btn" onclick="hideChatMessage(this)" data-id="' + escapeAttr(msg.id || '') + '">hide</button>') +
        '<button class="chat-mod-btn danger" onclick="banChatUser(this)" data-token="' + escapeAttr(msg.user_token || '') + '" data-username="' + escapeAttr(msg.username || 'listener') + '">ban</button>' +
        '<button class="chat-mod-btn" onclick="timeoutChatUser(this)" data-token="' + escapeAttr(msg.user_token || '') + '" data-username="' + escapeAttr(msg.username || 'listener') + '">timeout</button>' : '');
    return row;
  }

  function renderAdminChatFeed() {
    var feed = document.getElementById('adminChatFeed');
    if(!feed) return;
    feed.innerHTML = '';
    chatMessages.slice(-140).forEach(msg => feed.appendChild(buildChatMessageRow(msg, true)));
    feed.scrollTop = feed.scrollHeight;
  }

  function setupChatRealtime() {
    if(!supabaseClient || chatChannel || chatPollTimer) return;
    if(!isAdmin) {
      chatPollTimer = window.setInterval(loadChatHistory, 2500);
      return;
    }
    chatChannel = supabaseClient.channel('akrasia-live-chat-admin')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'live_chat', filter: 'room_id=eq.main' }, payload => {
        if(payload.new) appendChatMessage(payload.new);
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'live_chat', filter: 'room_id=eq.main' }, payload => {
        if(!payload.new) return;
        var index = chatMessages.findIndex(msg => msg.id === payload.new.id);
        if(index !== -1) chatMessages[index] = payload.new;
        else appendChatMessage(payload.new);
        renderLiveChatMessages();
        renderAdminChatFeed();
      })
      .subscribe();
  }

  function teardownChatRealtime() {
    if(chatPollTimer) {
      clearInterval(chatPollTimer);
      chatPollTimer = null;
    }
    if(chatChannel) {
      chatChannel.unsubscribe();
      chatChannel = null;
    }
  }

  async function loadChatHistory() {
    if(!supabaseClient) return;
    var result;
    if(isAdmin) result = await supabaseClient.from('live_chat').select('*').eq('room_id', 'main').order('created_at', { ascending: true }).limit(100);
    else result = await supabaseClient.rpc('public_live_chat_history');
    if(result.data) {
      chatMessages = result.data.slice().sort((a,b) => String(a.created_at || '').localeCompare(String(b.created_at || '')));
      renderLiveChatMessages();
      renderAdminChatFeed();
    }
  }

  async function hideChatMessage(btn) {
    if(liveRehearsal) return showAppNotice('moderation is disabled during rehearsal.');
    if(!requireAdmin() || !supabaseClient) return;
    var id = btn.dataset.id;
    if(!id) return;
    await supabaseClient.from('live_chat').update({ is_hidden: true }).eq('id', id);
    chatMessages = chatMessages.map(msg => msg.id === id ? Object.assign({}, msg, { is_hidden: true }) : msg);
    renderLiveChatMessages();
    renderAdminChatFeed();
  }

  async function unhideChatMessage(btn) {
    if(liveRehearsal) return showAppNotice('moderation is disabled during rehearsal.');
    if(!requireAdmin() || !supabaseClient) return;
    var id = btn.dataset.id;
    if(!id) return;
    await supabaseClient.from('live_chat').update({ is_hidden: false }).eq('id', id);
    chatMessages = chatMessages.map(msg => msg.id === id ? Object.assign({}, msg, { is_hidden: false }) : msg);
    renderLiveChatMessages();
    renderAdminChatFeed();
  }

  async function banChatUser(btn) {
    if(liveRehearsal) return showAppNotice('moderation is disabled during rehearsal.');
    if(!requireAdmin() || !supabaseClient) return;
    var token = btn.dataset.token;
    if(!token) return;
    await supabaseClient.from('live_banned_tokens').upsert({ user_token: token, username: btn.dataset.username || '', reason: 'ban', expires_at: null }, { onConflict: 'user_token' });
    await supabaseClient.from('live_chat').update({ is_hidden: true }).eq('user_token', token).eq('room_id', 'main');
    chatMessages = chatMessages.map(msg => msg.user_token === token ? Object.assign({}, msg, { is_hidden: true }) : msg);
    renderLiveChatMessages();
    renderAdminChatFeed();
    loadBannedUsers();
  }

  async function timeoutChatUser(btn) {
    if(liveRehearsal) return showAppNotice('moderation is disabled during rehearsal.');
    if(!requireAdmin() || !supabaseClient) return;
    var token = btn.dataset.token;
    if(!token) return;
    var minutes = Math.min(10080, Math.max(1, Number(document.getElementById('timeoutLength')?.value) || 10));
    var expires = new Date(Date.now() + minutes * 60 * 1000).toISOString();
    await supabaseClient.from('live_banned_tokens').upsert({ user_token: token, username: btn.dataset.username || '', reason: 'timeout', expires_at: expires }, { onConflict: 'user_token' });
    loadBannedUsers();
  }

  async function loadBannedUsers() {
    var feed = document.getElementById('bannedUsersFeed');
    if(!feed || !isAdmin) return;
    if(!supabaseClient) {
      feed.innerHTML = '<div class="panel-copy">moderation list needs supabase.</div>';
      return;
    }
    var result = await supabaseClient.from('live_banned_tokens').select('*').order('banned_at', { ascending:false }).limit(100);
    bannedUsers = result.data || [];
    renderBannedUsers();
  }

  function renderBannedUsers() {
    var feed = document.getElementById('bannedUsersFeed');
    if(!feed) return;
    feed.innerHTML = '';
    if(!bannedUsers.length) {
      feed.innerHTML = '<div class="panel-copy">no banned or timed-out users.</div>';
      return;
    }
    bannedUsers.forEach(user => {
      var row = document.createElement('div');
      row.className = 'chat-message admin-view';
      var exp = user.expires_at ? new Date(user.expires_at).toLocaleString([], { month:'2-digit', day:'2-digit', hour:'numeric', minute:'2-digit' }).toLowerCase() : 'permanent';
      row.innerHTML =
        '<span class="chat-name">' + escapeHtml(user.username || 'unknown') + '</span>' +
        '<span class="chat-text">' + escapeHtml((user.reason || 'ban') + ' / ' + (user.user_token || '').slice(0, 12)) + '</span>' +
        '<span class="chat-time">' + escapeHtml(exp) + '</span>' +
        '<button class="chat-mod-btn" onclick="unbanChatUser(this)" data-token="' + escapeAttr(user.user_token || '') + '">unban</button>';
      feed.appendChild(row);
    });
  }

  async function unbanChatUser(btn) {
    if(liveRehearsal) return showAppNotice('moderation is disabled during rehearsal.');
    if(!requireAdmin() || !supabaseClient) return;
    var token = btn.dataset.token;
    if(!token) return;
    await supabaseClient.from('live_banned_tokens').delete().eq('user_token', token);
    bannedUsers = bannedUsers.filter(user => user.user_token !== token);
    renderBannedUsers();
  }

  async function sendAnnouncement(pinned, inputId) {
    if(!requireAdmin()) return;
    var input = document.getElementById(inputId || 'liveAnnounceInput');
    var message = cleanSingleLine(input ? input.value : '', 200);
    if(!message) return;
    var kind = pinned === 'major' ? 'major' : (pinned ? 'pinned' : 'normal');
    var payload = { room_id: 'main', message, kind, is_pinned: Boolean(pinned === true), created_at: new Date().toISOString() };
    if(liveRehearsal) {
      payload.subtitle = 'private rehearsal preview';
      showAnnouncement(payload);
      recordLiveRehearsalEvent('announcement',`${kind}: ${message}`);
      if(input) input.value = '';
      return;
    }
    if(supabaseClient) await supabaseClient.from('live_announcements').insert(payload);
    showAnnouncement(payload);
    if(liveChannel) liveChannel.send({ type: 'broadcast', event: 'announcement', payload });
    if(input) input.value = '';
  }

  function showAnnouncement(data) {
    var bar = document.getElementById('liveAnnouncementBar');
    var text = document.getElementById('liveAnnouncementText');
    var major = document.getElementById('liveMajorAnnouncement');
    var majorText = document.getElementById('liveMajorText');
    var majorSub = document.getElementById('liveMajorSub');
    if(!bar || !text) return;
    if(data.kind === 'major') {
      if(major && majorText) {
        majorText.textContent = data.message || '';
        if(majorSub) majorSub.textContent = data.subtitle || 'live room update';
        major.style.display = '';
      }
      bar.style.display = 'none';
      window.clearTimeout(announcementTimer);
      if(!data.is_pinned) announcementTimer = window.setTimeout(dismissAnnouncement, 10000);
      return;
    }
    text.textContent = data.message || '';
    bar.style.display = '';
    window.clearTimeout(announcementTimer);
    if(!data.is_pinned) announcementTimer = window.setTimeout(dismissAnnouncement, 8000);
  }

  function dismissAnnouncement() {
    var bar = document.getElementById('liveAnnouncementBar');
    var major = document.getElementById('liveMajorAnnouncement');
    if(bar) bar.style.display = 'none';
    if(major) major.style.display = 'none';
    window.clearTimeout(announcementTimer);
  }

  async function saveLiveState(state) {
    liveState = state;
    renderLiveState(state);
    if(liveRehearsal || (state && state.rehearsal)) return;
    var publicState = Object.assign({},state);
    delete publicState.rehearsal;
    if(liveChannel) liveChannel.send({ type: 'broadcast', event: 'state', payload: publicState });
    if(!supabaseClient || !isAdmin) return;
    var result = await supabaseClient.from('archive_live_state').upsert(publicState, { onConflict: 'room_id' });
    if(result && result.error && /schema cache|column|queue_|countdown_action|live_notes|live_cover|scene|phase|ended_at/i.test(result.error.message || '')) {
      var fallbackState = Object.assign({}, publicState);
      ['queue','queue_index','queue_length','countdown_action','countdown_auto_start','live_notes','live_cover','scene','phase','ended_at'].forEach(key => delete fallbackState[key]);
      result = await supabaseClient.from('archive_live_state').upsert(fallbackState, { onConflict: 'room_id' });
    }
    if(result && result.error) {
      var status = document.getElementById('authStatus');
      if(status) status.textContent = 'live not saved';
    }
  }

  function receiveLiveState(state) {
    if(liveRehearsal) return;
    renderLiveState(state);
    if(state && !state.is_live) {
      setLiveFollower(false);
      activeLiveDirectState = null;
    }
    if(liveJoined && state && state.is_live) applyLiveStateToViewer(state);
  }

  function joinLiveRoom(openRoom) {
    if(liveRehearsal) return;
    liveJoined = true;
    if(openRoom !== false) openLiveRoom();
    if(liveState && liveState.is_live) applyLiveStateToViewer(liveState);
  }

  function openLiveAsset() {
    if(liveState && liveState.is_live) {
      if(liveRehearsal) playLiveDirectState(liveState,true);
      else applyLiveStateToViewer(liveState);
    }
  }

  async function goLiveWithCurrent() {
    if(!requireAdmin()) return;
    var row = currentBroadcastRow();
    if(!row) return alert('no archive item available to broadcast.');
    activeLiveDirectState = null;
    var cover = await liveCustomCoverUrl();
    saveLiveState(liveStateFromRow(row, cover ? { cover } : {}));
    startLiveSyncLoop();
  }

  async function goLiveWithSelection(selectId) {
    if(!requireAdmin()) return;
    var select = document.getElementById(selectId || 'liveAssetSelect');
    var row = findLiveRow(select && select.value);
    if(!row) return alert('choose an archive item first.');
    activeLiveDirectState = null;
    var cover = await liveCustomCoverUrl();
    var state = liveStateFromRow(row, Object.assign({ playing: true, position: 0 }, cover ? { cover } : {}));
    activeLiveDirectState = state;
    playLiveDirectState(state, true);
    saveLiveState(state);
    startLiveSyncLoop();
  }

  async function goLiveWithFile(inputId, titleId) {
    if(!requireAdmin()) return;
    var input = document.getElementById(inputId || 'liveFileInputDash');
    var file = input && input.files && input.files[0];
    if(!file) return alert('choose a live-only file first.');
    var type = file.type.indexOf('audio/') === 0 ? 'audio' : (file.type.indexOf('video/') === 0 ? 'video' : 'image');
    var titleInput = document.getElementById(titleId || 'liveTitleInputDash');
    var title = (titleInput ? titleInput.value.trim() : '') || file.name.replace(/\.[^/.]+$/, '').replace(/[_-]+/g, ' ');
    var fileUrl = '';
    if(isRemoteReady && supabaseClient && !liveRehearsal) {
      var safeName = file.name.replace(/[^a-z0-9._-]+/gi, '-');
      var path = `live/${Date.now()}-${safeName}`;
      var upload = await supabaseClient.storage.from(STORAGE_BUCKET).upload(path, file, { upsert:false });
      if(upload.error) return alert(upload.error.message || 'live upload failed.');
      var signedFile = await supabaseClient.storage.from(STORAGE_BUCKET).createSignedUrl(path,21600);
      if(signedFile.error) return alert(signedFile.error.message || 'live link failed.');
      fileUrl = signedFile.data?.signedUrl || '';
    } else {
      fileUrl = URL.createObjectURL(file);
      liveTempUrls.push(fileUrl);
    }
    var coverOverride = await liveCustomCoverUrl();
    var custom = liveCustomOverrides();
    activeLiveDirectState = Object.assign({
      room_id:'main',
      is_live:true,
      asset_key:`live:${Date.now()}`,
      title:custom.title || title,
      type,
      version:'live',
      folder:'live room',
      mood:'live',
      mood_color:custom.mood_color || '#ffffff',
      notes:custom.notes || 'live-only broadcast source',
      cover:coverOverride || (type === 'image' ? fileUrl : ''),
      file_url:fileUrl,
      position:0,
      playing:type !== 'image',
      phase:'live',
      updated_at:new Date().toISOString(),
      countdown_target:null
    }, queueMeta());
    playLiveDirectState(activeLiveDirectState, true);
    saveLiveState(liveStateFromDirect(activeLiveDirectState));
    startLiveSyncLoop();
  }

  function rowToLiveQueueItem(row) {
    row = canonicalRow(row);
    return {
      source:'archive',
      key:liveRowKey(row),
      title:row.getAttribute('data-title') || 'untitled',
      type:row.getAttribute('data-type') || 'audio',
      version:row.getAttribute('data-ver') || 'v1',
      folder:row.getAttribute('data-sub') || 'archive',
      mood:row.getAttribute('data-mood') || 'raw',
      mood_color:row.getAttribute('data-mood-color') || '#ffffff',
      notes:row.getAttribute('data-notes') || '',
      lyrics:row.getAttribute('data-lyrics') || '',
      cover:row.getAttribute('data-cover') || row.getAttribute('data-img-src') || '',
      file_url:row.getAttribute('data-file-url') || row.getAttribute('data-file') || row.getAttribute('data-img-src') || row.getAttribute('data-video-src') || ''
    };
  }

  function privateToLiveQueueItem(item) {
    return {
      source:'private',
      key:item.id || item.asset_key || ('private:' + Date.now()),
      title:item.title || 'private live item',
      type:item.type || 'audio',
      version:'private',
      folder:item.folder || 'private live',
      mood:'live',
      mood_color:item.mood_color || '#ffffff',
      notes:item.notes || '',
      cover:item.cover_url || item.cover || '',
      file_url:item.file_url || ''
    };
  }

  function queueItemToState(item, overrides) {
    var custom = liveCustomOverrides();
    return Object.assign({
      room_id:'main',
      is_live:true,
      asset_key:item.key,
      title:custom.title || item.title,
      type:item.type,
      version:item.version || 'live',
      folder:item.folder || 'live queue',
      mood:item.mood || 'live',
      mood_color:custom.mood_color || item.mood_color || '#ffffff',
      notes:custom.notes || item.notes || '',
      lyrics:item.lyrics || '',
      cover:item.cover || '',
      file_url:item.file_url || '',
      position:0,
      playing:item.type !== 'image',
      updated_at:new Date().toISOString(),
      countdown_target:null,
      countdown_action:liveCountdownAction,
      countdown_auto_start:liveCountdownAutoStart,
      rehearsal:liveRehearsal,
      scene:liveState.scene || 'stage',
      phase:'live'
    }, queueMeta(), overrides || {});
  }

  function renderLiveQueue() {
    ['liveQueueList', 'liveQueueListInline'].forEach(listId => {
      var list = document.getElementById(listId);
      if(!list) return;
      list.innerHTML = '';
      if(!liveQueue.length) {
        list.innerHTML = '<div class="live-queue-empty">queue is empty.</div>';
        return;
      }
      liveQueue.forEach((item, index) => {
        var el = document.createElement('div');
        el.className = 'live-queue-item' + (index === liveQueueIndex ? ' active' : '');
        el.innerHTML =
          '<span>' + (index + 1) + '</span>' +
          '<div><span class="live-queue-title">' + escapeHtml(item.title) + '</span><span class="live-queue-sub">' + escapeHtml((item.folder || 'live') + ' / ' + item.type) + '</span></div>' +
          '<div class="live-queue-actions"><button type="button" onclick="moveLiveQueueItem(' + index + ',-1)">^</button><button type="button" onclick="moveLiveQueueItem(' + index + ',1)">v</button><button type="button" onclick="removeLiveQueueItem(' + index + ')">x</button></div>';
        list.appendChild(el);
      });
    });
    syncLiveAdminControls();
  }

  function addSelectedArchiveToLiveQueue(selectId) {
    if(!requireAdmin()) return;
    var select = document.getElementById(selectId || 'liveAssetSelectDash');
    var row = findLiveRow(select && select.value);
    if(!row) return;
    liveQueue.push(rowToLiveQueueItem(row));
    if(liveQueueIndex < 0) liveQueueIndex = 0;
    renderLiveQueue();
  }

  function addFolderToLiveQueue(inputId) {
    if(!requireAdmin()) return;
    var value = normalizeFolderPath(document.getElementById(inputId || 'liveFolderQueueInput')?.value || '');
    if(!value) return;
    baseRows().filter(row => normalizeFolderPath(row.getAttribute('data-sub')) === value && ['audio','image','video'].includes(row.getAttribute('data-type'))).forEach(row => liveQueue.push(rowToLiveQueueItem(row)));
    if(liveQueueIndex < 0 && liveQueue.length) liveQueueIndex = 0;
    renderLiveQueue();
  }

  function moveLiveQueueItem(index, direction) {
    var target = index + direction;
    if(target < 0 || target >= liveQueue.length) return;
    var item = liveQueue.splice(index, 1)[0];
    liveQueue.splice(target, 0, item);
    if(liveQueueIndex === index) liveQueueIndex = target;
    else if(liveQueueIndex === target) liveQueueIndex = index;
    renderLiveQueue();
    recordLiveRehearsalEvent('reorder',`${item.title} to ${target + 1}`);
  }

  function removeLiveQueueItem(index) {
    var removed = liveQueue.splice(index, 1)[0];
    if(index < liveQueueIndex) liveQueueIndex--;
    if(liveQueueIndex >= liveQueue.length) liveQueueIndex = liveQueue.length - 1;
    if(!liveQueue.length) liveQueuePlaying = false;
    renderLiveQueue();
    recordLiveRehearsalEvent('remove',removed ? removed.title : `item ${index + 1}`);
  }

  function clearLiveQueue() {
    liveQueue = [];
    liveQueueIndex = -1;
    liveQueuePlaying = false;
    renderLiveQueue();
    recordLiveRehearsalEvent('clear','queue cleared');
  }

  async function startLiveQueue() {
    if(!requireAdmin() || !liveQueue.length) return;
    liveQueueAutoplay = document.getElementById('liveAutoplayToggle')?.checked !== false;
    liveFolderAutoplay = document.getElementById('liveFolderAutoplayToggle')?.checked !== false;
    if(liveQueueIndex < 0) liveQueueIndex = 0;
    liveQueuePlaying = true;
    recordLiveRehearsalEvent('play','set started');
    await playLiveQueueItem(liveQueueIndex);
  }

  function pauseLiveQueue() {
    liveQueuePlaying = false;
    if(livePlaybackEl) livePlaybackEl.pause();
    saveLiveState(Object.assign({}, liveState, { playing:false, phase:'paused', updated_at:new Date().toISOString() }));
    recordLiveRehearsalEvent('pause',liveState?.title || 'current item');
  }

  function resumeLiveQueue() {
    liveQueuePlaying = true;
    if(livePlaybackEl) livePlaybackEl.play().catch(() => {});
    saveLiveState(Object.assign({}, liveState, { playing:true, phase:'live', updated_at:new Date().toISOString() }));
    recordLiveRehearsalEvent('resume',liveState?.title || 'current item');
  }

  function nextLiveQueueItem() {
    if(liveQueueIndex < liveQueue.length - 1) {
      liveQueueIndex++;
      playLiveQueueItem(liveQueueIndex);
    } else {
      liveQueuePlaying = false;
      stopLiveRoom();
    }
  }

  function prevLiveQueueItem() {
    if(liveQueueIndex > 0) {
      liveQueueIndex--;
      recordLiveRehearsalEvent('back',liveQueue[liveQueueIndex]?.title || `item ${liveQueueIndex + 1}`);
      playLiveQueueItem(liveQueueIndex);
    }
  }

  async function playLiveQueueItem(index) {
    if(index < 0 || index >= liveQueue.length) return;
    liveQueueIndex = index;
    var item = liveQueue[index];
    if(liveRehearsal) liveRehearsalSeenItems.add(item.key || `${index}:${item.title}`);
    var cover = await liveCustomCoverUrl();
    var state = queueItemToState(item, cover ? { cover } : {});
    activeLiveDirectState = state;
    renderLiveQueue();
    playLiveDirectState(state, true);
    saveLiveState(state);
    startLiveSyncLoop();
    recordLiveRehearsalEvent('item',`${index + 1}/${liveQueue.length} ${item.title}`);
  }

  function handleLiveItemEnded() {
    if(!isAdmin || !liveQueuePlaying || !liveQueueAutoplay) return;
    recordLiveRehearsalEvent('ended',liveState?.title || 'current item');
    nextLiveQueueItem();
  }

  async function hydratePrivateLiveItemUrls(item) {
    if(!item || !supabaseClient || !isAdmin) return item;
    var hydrated = Object.assign({}, item);
    if(item.storage_path) {
      var fileSigned = await supabaseClient.storage.from(PRIVATE_LIVE_BUCKET).createSignedUrl(item.storage_path, 21600);
      if(!fileSigned.error) hydrated.file_url = fileSigned.data.signedUrl;
    }
    if(item.cover_storage_path) {
      var coverSigned = await supabaseClient.storage.from(PRIVATE_LIVE_BUCKET).createSignedUrl(item.cover_storage_path, 21600);
      if(!coverSigned.error) hydrated.cover_url = coverSigned.data.signedUrl;
    }
    return hydrated;
  }

  async function savePrivateLiveItem(suffix) {
    if(!requireAdmin()) return;
    if(liveRehearsal) return showAppNotice('leave rehearsal before uploading a new private item.','error');
    var suffixText = suffix || '';
    var fileInput = document.getElementById('livePrivateFileInput' + suffixText) || document.getElementById('livePrivateFileInput');
    var file = fileInput && fileInput.files && fileInput.files[0];
    if(!file) return alert('choose a private live file first.');
    var coverInput = document.getElementById('livePrivateCoverInput' + suffixText) || document.getElementById('livePrivateCoverInput');
    var coverFile = coverInput && coverInput.files && coverInput.files[0];
    var type = file.type.indexOf('audio/') === 0 ? 'audio' : (file.type.indexOf('video/') === 0 ? 'video' : 'image');
    var fileError = validateAssetFile(file, type);
    if(fileError) return alert(fileError);
    if(coverFile && validateAssetFile(coverFile, 'image')) return alert('private cover must be a valid image.');
    var title = cleanSingleLine((document.getElementById('livePrivateTitleInput' + suffixText)?.value || document.getElementById('livePrivateTitleInput')?.value) || file.name.replace(/\.[^/.]+$/, '').replace(/[_-]+/g, ' '), 120) || 'private live item';
    var notes = cleanMultiline((document.getElementById('livePrivateNotesInput' + suffixText)?.value || document.getElementById('livePrivateNotesInput')?.value) || '', 8000);
    var folder = normalizeFolderPath(document.getElementById('livePrivateFolderInput' + suffixText)?.value || document.getElementById('livePrivateFolderInput')?.value || 'private live') || 'private live';
    var fileUrl = URL.createObjectURL(file);
    var coverUrl = coverFile ? URL.createObjectURL(coverFile) : '';
    var storagePath = '', coverPath = '';
    if(isRemoteReady && supabaseClient) {
      var safeName = file.name.replace(/[^a-z0-9._-]+/gi, '-');
      storagePath = `live/private/${Date.now()}-${safeName}`;
      var upload = await supabaseClient.storage.from(PRIVATE_LIVE_BUCKET).upload(storagePath, file, { upsert:false });
      if(upload.error) return alert(upload.error.message || 'private upload failed.');
      var signedFile = await supabaseClient.storage.from(PRIVATE_LIVE_BUCKET).createSignedUrl(storagePath, 21600);
      if(signedFile.error) return alert('private file could not be signed.');
      fileUrl = signedFile.data.signedUrl;
      if(coverFile) {
        var safeCover = coverFile.name.replace(/[^a-z0-9._-]+/gi, '-');
        coverPath = `live/private/${Date.now()}-cover-${safeCover}`;
        var coverUpload = await supabaseClient.storage.from(PRIVATE_LIVE_BUCKET).upload(coverPath, coverFile, { upsert:false });
        if(!coverUpload.error) {
          var signedCover = await supabaseClient.storage.from(PRIVATE_LIVE_BUCKET).createSignedUrl(coverPath, 21600);
          if(!signedCover.error) coverUrl = signedCover.data.signedUrl;
        }
      }
    }
    var itemId = (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : String(Date.now()) + '-' + Math.random().toString(16).slice(2);
    var item = { id:itemId, title, notes, type, folder, mood_color:document.getElementById('liveCustomMoodColor')?.value || '#ffffff', file_url:fileUrl, cover_url:coverUrl, storage_path:storagePath, cover_storage_path:coverPath };
    if(isRemoteReady && supabaseClient) {
      var storedItem = Object.assign({}, item, { file_url:null, cover_url:null });
      var result = await supabaseClient.from('private_live_items').insert(storedItem).select().single();
      if(result.error) {
        var status = document.getElementById('authStatus');
        if(status) status.textContent = 'private not saved';
      } else if(result.data) item = await hydratePrivateLiveItemUrls(result.data);
    }
    privateLiveItems.unshift(item);
    renderPrivateLiveItems();
  }

  async function loadPrivateLiveItems() {
    if(!supabaseClient || !isAdmin) return renderPrivateLiveItems();
    var result = await supabaseClient.from('private_live_items').select('*').order('created_at', { ascending:false }).limit(100);
    if(result.data) privateLiveItems = await Promise.all(result.data.map(hydratePrivateLiveItemUrls));
    renderPrivateLiveItems();
  }

  function renderPrivateLiveItems() {
    ['privateLiveItemSelect', 'privateLiveItemSelectInline'].forEach(id => {
      var select = document.getElementById(id);
      if(!select) return;
      var current = select.value;
      select.innerHTML = '';
      privateLiveItems.forEach(item => {
        var option = document.createElement('option');
        option.value = item.id;
        option.textContent = `${item.title || 'private item'} / ${item.type || 'asset'}`;
        select.appendChild(option);
      });
      if(current && Array.from(select.options).some(option => option.value === current)) select.value = current;
    });
  }

  async function addPrivateLiveItemToQueue(selectId) {
    if(!requireAdmin()) return;
    var id = document.getElementById(selectId || 'privateLiveItemSelectInline')?.value || document.getElementById('privateLiveItemSelect')?.value;
    var item = privateLiveItems.find(entry => entry.id === id);
    if(!item) return;
    item = await hydratePrivateLiveItemUrls(item);
    if(!item.file_url) return alert('private live file is unavailable. run the private bucket SQL and try again.');
    liveQueue.push(privateToLiveQueueItem(item));
    if(liveQueueIndex < 0) liveQueueIndex = 0;
    renderLiveQueue();
  }

  function startLiveSyncLoop() {
    window.clearInterval(liveSyncTimer);
    liveSyncTimer = window.setInterval(() => {
      if(!isAdmin || !liveState || !liveState.is_live) return;
      if(activeLiveDirectState) return saveLiveState(liveStateFromDirect(activeLiveDirectState));
      var row = currentBroadcastRow();
      if(row) saveLiveState(liveStateFromRow(row));
    }, 1000);
  }

  function stopLiveRoom() {
    if(!requireAdmin()) return;
    if(liveRehearsal) return stopLiveRehearsal('completed');
    window.clearInterval(liveSyncTimer);
    window.clearTimeout(liveImageTimer);
    activeLiveDirectState = null;
    setLiveFollower(false);
    stopLivePlayback();
    liveState = { room_id: 'main', is_live: false, playing:false, phase:'ended', countdown_target: null, ended_at:new Date().toISOString(), updated_at: new Date().toISOString() };
    renderLiveState(liveState);
    saveLiveState(liveState);
    markActivePremiere('ended');
    setAppSection('live');
  }

  function applyLiveStateToViewer(state) {
    if(applyingLiveState || !state || !state.is_live) return;
    playLiveDirectState(state, false);
  }

  function setLiveFollower(enabled) {
    isLiveFollower = Boolean(enabled);
    document.body.classList.toggle('live-follower', isLiveFollower);
  }

  function exitLiveFollowerMode() {
    if(!isLiveFollower && !activeLiveDirectState) return;
    var wasFollowing = isLiveFollower;
    setLiveFollower(false);
    activeLiveDirectState = null;
    if(wasFollowing) stopLivePlayback();
    document.getElementById('playerBar').classList.remove('live-dock');
  }

  function livePlaybackKey(state) {
    if(!state || !state.is_live) return '';
    return [
      state.type || 'audio',
      state.file_url || '',
      state.asset_key || '',
      state.cover || state.live_cover || ''
    ].join('|');
  }

  function syncLivePlaybackElement(state, asHost) {
    var media = livePlaybackEl || document.querySelector('#livePreview video');
    if(!media) return false;
    if((state.type || 'audio') === 'video') {
      media.controls = Boolean(asHost && isAdmin);
      media.muted = !asHost;
    }
    var target = liveSyncedPosition(state);
    if(Number.isFinite(target) && Math.abs((media.currentTime || 0) - target) > 1.2) {
      try { media.currentTime = Math.min(media.duration || target, target); } catch(error) {}
    }
    if(state.playing && media.paused) media.play().catch(() => {});
    if(!state.playing && !media.paused) media.pause();
    return true;
  }

  function playLiveDirectState(state, asHost) {
    applyingLiveState = true;
    activeLiveDirectState = state;
    setLiveFollower(!asHost && !isAdmin);
    activeMediaType = state.type || 'audio';
    var type = activeMediaType;
    setAppSection('live');
    openAnimatedSurface(document.getElementById('liveRoom'));
    document.getElementById('liveRoom').setAttribute('aria-hidden', 'false');
    document.getElementById('fsPlayer').classList.remove('active');
    var cover = state.cover || (type === 'image' ? state.file_url : '');
    var colorSignature = [cover || state.file_url || '', state.mood_color || '#ffffff'].join('|');
    if(colorSignature !== liveColorSignature) {
      liveColorSignature = colorSignature;
      readCoverColor(cover || state.file_url, state.mood_color || '#ffffff');
    }
    renderLiveState(state);
    syncLiveStagePlayback(state, asHost);
    window.setTimeout(() => { applyingLiveState = false; }, 120);
  }

  function stopLivePlayback() {
    window.clearTimeout(liveImageTimer);
    liveImageTimerSignature = '';
    if(livePlaybackEl) {
      try { livePlaybackEl.pause(); } catch(error) {}
      if(livePlaybackEl.tagName === 'AUDIO') livePlaybackEl.removeAttribute('src');
    }
    livePlaybackEl = null;
    livePlaybackSignature = '';
  }

  function syncLiveStagePlayback(state, asHost) {
    var signature = livePlaybackKey(state);
    if(signature && signature === livePlaybackSignature && syncLivePlaybackElement(state, asHost)) return;
    if((state.type || 'audio') === 'image' && signature && signature === liveImageTimerSignature) return;
    stopLivePlayback();
    var type = state.type || 'audio';
    var source = state.file_url || '';
    if(type === 'audio' && source) {
      livePlaybackEl = createArchiveAudio(source);
      livePlaybackSignature = signature;
      livePlaybackEl.addEventListener('loadedmetadata', () => {
        var target = Math.min(livePlaybackEl.duration || liveSyncedPosition(state), liveSyncedPosition(state));
        if(Number.isFinite(target)) livePlaybackEl.currentTime = target;
      }, { once:true });
      livePlaybackEl.addEventListener('ended', () => handleLiveItemEnded());
      if(state.playing) livePlaybackEl.play().catch(() => {});
    } else if(type === 'video') {
      livePlaybackEl = document.querySelector('#livePreview video');
      if(livePlaybackEl) {
        livePlaybackSignature = signature;
        livePlaybackEl.controls = Boolean(asHost && isAdmin);
        livePlaybackEl.muted = !asHost;
        livePlaybackEl.addEventListener('ended', () => handleLiveItemEnded(), { once:true });
        var target = liveSyncedPosition(state);
        livePlaybackEl.addEventListener('loadedmetadata', () => {
          if(Number.isFinite(target)) livePlaybackEl.currentTime = Math.min(livePlaybackEl.duration || target, target);
          if(state.playing) livePlaybackEl.play().catch(() => {});
        }, { once:true });
        if(state.playing) livePlaybackEl.play().catch(() => {});
      }
    } else if(type === 'image' && state.playing && liveQueueAutoplay) {
      if(signature && signature === liveImageTimerSignature) return;
      liveImageTimerSignature = signature;
      var seconds = Math.max(3, Math.min(120, Number(document.getElementById('liveImageDuration')?.value) || 12));
      liveImageTimer = window.setTimeout(handleLiveItemEnded, seconds * 1000);
    }
  }

  function maybeBroadcastLiveRow(row, overrides) {
    var liveVisible = document.getElementById('liveRoom')?.classList.contains('active');
    if(!isAdmin || applyingLiveState || !liveVisible || !liveState || !liveState.is_live || !row) return;
    activeLiveDirectState = null;
    saveLiveState(liveStateFromRow(row, overrides));
  }
