  const SUPABASE_URL = 'https://eorlnmqguyvnnpxepswv.supabase.co';
  const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVvcmxubXFndXl2bm5weGVwc3d2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI0MDAwMTQsImV4cCI6MjA5Nzk3NjAxNH0.vDIAXtRzu5CS0wmznYryX5Y-gscEoPzoTOlu4A-YGvg';
  const ADMIN_EMAIL = 'angelyzyy@gmail.com';
  const STORAGE_BUCKET = 'archive-assets';
  const PRIVATE_LIVE_BUCKET = 'private-live-assets';
  const ROOT_ARCHIVE_PATH = '__root__';
  const LOCAL_PLAY_STATS_KEY = 'akrasia_play_stats_v2';
  const FOLDER_STATE_KEY = 'akrasia_folder_states_v1';

  function normalizeVersionLabel(value, fallback) {
    var raw = String(value == null ? '' : value).trim();
    if(!raw) return fallback || 'v1';
    var versionMatch = raw.match(/^(?:v|ver(?:sion)?)\s*0*(\d+)(.*)$/i);
    if(versionMatch) {
      var suffix = String(versionMatch[2] || '').replace(/^\s+/, ' ');
      return `v${Number.parseInt(versionMatch[1], 10) || 0}${suffix}`;
    }
    var numericMatch = raw.match(/^0*(\d+)$/);
    if(numericMatch) return `v${Number.parseInt(numericMatch[1], 10) || 0}`;
    return raw;
  }


  var activeFilter = 'all';
  var explorerSortKey = '';
  var explorerSortDirection = 1;
  var isLooping = false;
  var currentAudio = null;
  var audioQueue = [];
  var queueIndex = -1;
  var activeLyrics = [];
  var activeLyricGroups = [];
  var activeLyricIndex = -1;
  var activeTimelineDate = null;
  var timelineAscending = false;
  var timelineMode = 'immersive';
  var timelineScale = 'days';
  var timelineAssetFilter = 'all';
  var timelineHasAnimated = false;
  var timelineReadyTimer = null;
  var timelineNeedsBuild = true;
  var timelineScrollFrame = 0;
  var timelineResizeFrame = 0;
  var immersiveTimelineMetrics = [];
  var currentImmersiveSection = null;
  var currentImmersiveRailMark = null;
  var liveAssetSelectNeedsRefresh = true;
  var activeVisualRow = null;
  var activeMediaType = 'audio';
  var viewerOrigin = 'archive';
  var supabaseClient = null;
  var isAdmin = false;
  var isRemoteReady = false;
  var adminTapCount = 0;
  var draggedExplorerItem = null;
  var editingRow = null;
  var liveChannel = null;
  var liveState = { is_live: false };
  var liveJoined = false;
  var liveSyncTimer = null;
  var livePresenceChannel = null;
  var liveViewerCount = 0;
  var applyingLiveState = false;
  var isLiveFollower = false;
  var liveTempUrls = [];
  var activeLiveDirectState = null;
  var livePlaybackEl = null;
  var livePlaybackSignature = '';
  var livePreviewSignature = '';
  var liveColorSignature = '';
  var liveSampleColorSignature = '';
  var liveQueue = [];
  var liveQueueIndex = -1;
  var liveQueuePlaying = false;
  var liveQueueAutoplay = true;
  var liveFolderAutoplay = true;
  var liveRehearsal = false;
  var liveRehearsalSnapshot = null;
  var liveRehearsalStartedAt = 0;
  var liveRehearsalEvents = [];
  var liveRehearsalSeenItems = new Set();
  var liveRehearsalLastSummary = '';
  var liveRehearsalClockTimer = null;
  var liveImageTimer = null;
  var liveImageTimerSignature = '';
  var privateLiveItems = [];
  var liveCountdownAction = 'room';
  var liveCountdownAutoStart = false;
  var countdownAutoStarted = false;
  var countdownTimer = null;
  var chatChannel = null;
  var chatPollTimer = null;
  var chatMessages = [];
  var chatBanned = false;
  var lastChatSentAt = 0;
  var bannedUsers = [];
  var announcementTimer = null;
  var announcementChannel = null;
  var statsTimer = null;
  var waveformCache = new Map();
  var activeWaveformKey = '';
  var activeWaveformPeaks = null;
  var activeProgressPercent = 0;
  var worldsCurrentView = 'worlds';
  var activeWorldKey = '';
  var activeWorldTab = 'overview';
  var worldsRenderLimit = 24;
  var worldsRenderTimer = null;
  var archivePremieres = [];
  var archiveChangelog = [];
  var compareState = { a:null, b:null, timer:null, playing:false, mix:50 };
  var pendingHistoryResume = null;
  var historyWriteAt = 0;
  var archiveSettings = null;
  var selectedArchiveEntries = new Set();
  var surfaceCloseTimers = new WeakMap();
  var playStatsRenderTimer = null;
  var remotePlayStatsCache = [];
  var remotePlayStatsLoadedAt = 0;
  var statsCloudLoading = false;
  var statsRenderLimits = { panel:120, worlds:120 };
  var bulkCoverPreviewUrl = '';
  var bandlabSourceHandle = null;
  var bandlabScanState = { entries:[], projects:[], selectedProjects:new Set(), warnings:[], sourceLabel:'' };
  var bandlabSyncCancelled = false;
  var bandlabSyncRunning = false;
  var bandlabCoverSyncRunning = false;
  var bandlabCoverMapPromise = null;
  var bandlabCoverStoragePromises = new Map();
  var bandlabAutoScanAttempted = false;
  const BANDLAB_SOURCE_DB = 'akrasia-source-handles';
  const BANDLAB_SOURCE_STORE = 'sources';

  var audioCtx = null, analyser = null, sourceNode = null, dataArray = null;
  var audioSourceNodes = new WeakMap();
  var analyserConnected = false;
  var reactiveBase = { r: 255, g: 255, b: 255 };
  var reactiveHueShift = 0;
  var visualEnergy = 0;
  var visualBass = 0;
  var visualBeat = 0;
  var visualBeatCooldown = 0;
  var visualFade = 0;
  var reactivePulseLevel = 0;
  var visualLastFrame = 0;
  var reactiveCssLastFrame = 0;
  var isCompactVisual = window.matchMedia('(max-width: 980px)').matches;
  var visualFrame = 0;
  const canvas = document.getElementById('visualizerCanvas');
  const canvasCtx = canvas.getContext('2d');

  function openAnimatedSurface(element) {
    if(!element) return;
    var timer = surfaceCloseTimers.get(element);
    if(timer) window.clearTimeout(timer);
    surfaceCloseTimers.delete(element);
    element.classList.remove('is-closing');
    element.classList.add('active');
  }

  function closeAnimatedSurface(element, afterClose) {
    var finish = function() {
      if(element) {
        element.classList.remove('active','is-closing');
        surfaceCloseTimers.delete(element);
      }
      if(typeof afterClose === 'function') afterClose();
    };
    if(!element || !element.classList.contains('active') || document.documentElement.dataset.motion === 'off' || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return finish();
    var prior = surfaceCloseTimers.get(element);
    if(prior) window.clearTimeout(prior);
    element.classList.add('is-closing');
    var timer = window.setTimeout(finish, 310);
    surfaceCloseTimers.set(element,timer);
  }

  function togglePanel(force) {
    if(!isAdmin) return alert('admin login required.');
    var panel = document.getElementById('controlPanel');
    var isOpen = typeof force === 'boolean' ? force : !panel.classList.contains('active');
    if(isOpen === panel.classList.contains('active')) return;
    if(isOpen) openAnimatedSurface(panel);
    else closeAnimatedSurface(panel, syncMobileExitControl);
    document.body.classList.toggle('admin-workspace-open',isOpen);
    if(isOpen) {
      if(document.querySelector('.panel-tab[data-tab="stats"].active')) startStatsInterval();
      renderAdminChatFeed();
      if(document.querySelector('.panel-tab[data-tab="live-control"].active')) refreshLiveAssetSelect();
    } else {
      stopStatsInterval();
    }
    if(isOpen) syncMobileExitControl();
  }

  function toggleArchiveOrganizeMode(force) {
    if(!isAdmin) return alert('admin login required.');
    returnToArchive();
    var active = typeof force === 'boolean' ? force : !document.body.classList.contains('archive-organize-mode');
    document.body.classList.toggle('archive-organize-mode',active);
    var button = document.getElementById('archiveOrganizeToggle');
    if(button) {
      button.textContent = active ? 'done' : 'organize';
      button.classList.toggle('active',active);
      button.setAttribute('aria-pressed',active ? 'true' : 'false');
    }
    if(active) {
      document.getElementById('archiveExplorer')?.scrollIntoView({ behavior:document.documentElement.dataset.motion === 'off' ? 'auto' : 'smooth',block:'start' });
      window.setTimeout(() => document.getElementById('archiveSearchInput')?.focus({ preventScroll:true }),220);
    } else {
      clearArchiveSelection();
      if(typeof setArchiveSmartView === 'function') setArchiveSmartView('all');
    }
  }

  function returnToArchive() {
    if(document.getElementById('settingsViewport')?.classList.contains('active')) closeSettings();
    if(document.getElementById('worldsViewport')?.classList.contains('active')) closeWorldsHub();
    if(document.getElementById('timelinePanel')?.classList.contains('active')) closeTimelineView();
    if(document.getElementById('liveRoom')?.classList.contains('active')) closeLiveRoom();
    if(document.getElementById('fsPlayer')?.classList.contains('active')) toggleFullscreen();
    if(document.getElementById('controlPanel')?.classList.contains('active')) togglePanel();
    setAppSection('archive');
  }

  function switchPanelTab(name) {
    document.querySelectorAll('.panel-tab').forEach(btn => btn.classList.toggle('active', btn.dataset.tab === name));
    document.querySelectorAll('.panel-tab-pane').forEach(pane => pane.classList.toggle('active', pane.id === 'tab-' + name));
    if(name === 'stats') {
      loadPlayStats();
      startStatsInterval();
    } else {
      stopStatsInterval();
    }
    if(name === 'rules' && typeof renderArchiveRules === 'function') renderArchiveRules();
    if(name === 'review' && typeof renderAdminWorkspace === 'function') renderAdminWorkspace();
  }

  function startStatsInterval() {
    window.clearInterval(statsTimer);
    statsTimer = window.setInterval(loadPlayStats, 60000);
  }

  function stopStatsInterval() {
    window.clearInterval(statsTimer);
  }

  function restoreUnderlyingSection() {
    if(document.getElementById('settingsViewport')?.classList.contains('active')) { setAppSection('settings'); return; }
    if(document.getElementById('worldsViewport')?.classList.contains('active')) { setAppSection('worlds'); return; }
    var timeline = document.getElementById('timelinePanel');
    var live = document.getElementById('liveRoom');
    var fs = document.getElementById('fsPlayer');
    if(fs && fs.classList.contains('active')) {
      setAppSection(activeMediaType === 'audio' ? 'now playing' : `${activeMediaType} viewer`);
      return;
    }
    setAppSection(live && live.classList.contains('active') ? 'live' : (timeline && timeline.classList.contains('active') ? 'timeline' : 'archive'));
  }

  function syncMobileExitControl() {
    var button = document.getElementById('mobileExitBtn');
    if(!button) return;
    var drawerOpen = document.getElementById('liveAdminDrawer')?.classList.contains('open');
    var viewportOpen = Boolean(document.querySelector('.viewport-overlay.active'));
    var fs = document.getElementById('fsPlayer');
    var fsOpen = fs?.classList.contains('active');
    var lyricsOpen = fsOpen && fs.classList.contains('lyrics-focus');
    var liveOpen = document.getElementById('liveRoom')?.classList.contains('active');
    var timelineOpen = document.getElementById('timelinePanel')?.classList.contains('active');
    var panelOpen = document.getElementById('controlPanel')?.classList.contains('active');
    var visible = Boolean(drawerOpen || viewportOpen || fsOpen || liveOpen || timelineOpen || panelOpen);
    document.body.classList.toggle('mobile-exit-visible', visible);
    var compactView = window.matchMedia('(max-width:1180px)').matches;
    button.textContent = liveOpen && !drawerOpen && !fsOpen && !viewportOpen ? 'leave' : (fsOpen && (!lyricsOpen || !compactView) ? 'close' : (panelOpen || drawerOpen || viewportOpen ? 'close' : 'back'));
    button.setAttribute('aria-label', button.textContent === 'leave' ? 'leave live room' : 'go back');
  }

  function exitActiveMobileView() {
    var drawer = document.getElementById('liveAdminDrawer');
    if(drawer?.classList.contains('open')) return toggleLiveAdminDrawer(false);
    var transientViewport = document.querySelector('.viewport-overlay.active:not(#worldsViewport):not(#settingsViewport)');
    if(transientViewport) return closeViewport(transientViewport.id);
    var fs = document.getElementById('fsPlayer');
    if(fs?.classList.contains('active')) {
      if(fs.classList.contains('lyrics-focus')) {
        if(window.matchMedia('(max-width:1180px)').matches) return toggleLyricsFocus(false);
        toggleLyricsFocus(false);
        toggleFullscreen();
        return;
      }
      if(fs.classList.contains('info-open')) { closeNowInfo(); syncMobileExitControl(); return; }
      toggleFullscreen();
      return;
    }
    var baseViewport = document.querySelector('#settingsViewport.active,#worldsViewport.active');
    if(baseViewport) return closeViewport(baseViewport.id);
    if(document.getElementById('liveRoom')?.classList.contains('active')) return closeLiveRoom();
    if(document.getElementById('timelinePanel')?.classList.contains('active')) return closeTimelineView();
    if(document.getElementById('controlPanel')?.classList.contains('active')) return togglePanel();
    setAppSection('archive');
  }

  function syncViewerExitControl() {
    var button = document.getElementById('fsMinimizeBtn');
    if(!button) return;
    var timelineActive = document.getElementById('timelinePanel')?.classList.contains('active');
    var worldsActive = document.getElementById('worldsViewport')?.classList.contains('active');
    button.textContent = viewerOrigin === 'timeline' && timelineActive ? 'back to timeline' : (viewerOrigin === 'worlds' && worldsActive ? 'back to worlds' : 'minimize [-]');
  }

  function leaveLiveViewForArchivePlayback() {
    liveJoined = false;
    setLiveFollower(false);
    activeLiveDirectState = null;
    var live = document.getElementById('liveRoom');
    if(live) {
      live.classList.remove('active');
      live.setAttribute('aria-hidden', 'true');
    }
    toggleLiveAdminDrawer(false);
    teardownLivePresence();
    teardownChatRealtime();
    document.getElementById('playerBar').classList.remove('live-dock');
  }

  function toggleFullscreen() {
    if(isLiveFollower && document.getElementById('liveRoom').classList.contains('active')) {
      openLiveRoom();
      return;
    }
    var fs = document.getElementById('fsPlayer');
    if(fs.classList.contains('active')) {
      toggleLyricsFocus(false);
      closeNowInfo();
      closeAnimatedSurface(fs, function(){
        restoreUnderlyingSection();
        viewerOrigin = 'archive';
        syncViewerExitControl();
        resizeCanvas();
      });
      return;
    }
    openAnimatedSurface(fs);
    setAppSection(activeMediaType === 'audio' ? 'now playing' : `${activeMediaType} viewer`);
    syncViewerExitControl();
    resizeCanvas();
  }
  function toggleNowInfo() {
    var fs = document.getElementById('fsPlayer');
    var isOpen = fs.classList.toggle('info-open');
    var btn = document.getElementById('fsInfoToggle');
    if(btn) btn.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    window.setTimeout(resizeCanvas, 260);
  }
  function closeNowInfo() {
    document.getElementById('fsPlayer').classList.remove('info-open');
    var btn = document.getElementById('fsInfoToggle');
    if(btn) btn.setAttribute('aria-expanded', 'false');
    window.setTimeout(resizeCanvas, 260);
  }
  function openMiniPlayerNotes() {
    if(isLiveFollower) {
      openLiveRoom();
      return;
    }
    var fs = document.getElementById('fsPlayer');
    fs.classList.add('active', 'info-open');
    toggleLyricsFocus(false);
    var btn = document.getElementById('fsInfoToggle');
    if(btn) btn.setAttribute('aria-expanded', 'true');
    setAppSection(activeMediaType === 'audio' ? 'now playing' : `${activeMediaType} viewer`);
    window.setTimeout(resizeCanvas, 80);
  }
  function setSectionTitle(el, label) {
    if(!el) return;
    var mode = String(label || 'archive');
    if(el.textContent === mode) return;
    el.textContent = mode;
    el.classList.remove('is-switching');
    void el.offsetWidth;
    el.classList.add('is-switching');
  }
  function setModeLabel(label) {
    setAppSection(label);
  }
  function setAppSection(label) {
    var mode = String(label || 'archive');
    document.body.setAttribute('data-section', mode.toLowerCase().replace(/\s+/g, '-'));
    setSectionTitle(document.getElementById('appSectionLabel'), mode);
    syncMobileExitControl();
  }
  function closeViewport(id) {
    if(id === 'worldsViewport') return closeWorldsHub();
    if(id === 'settingsViewport') return closeSettings();
    var viewport = document.getElementById(id);
    if(viewport) viewport.setAttribute('aria-hidden','true');
    closeAnimatedSurface(viewport, function(){
      restoreUnderlyingSection();
      if(viewerOrigin === 'timeline') viewerOrigin = 'archive';
      syncViewerExitControl();
      syncMobileExitControl();
    });
  }
  window.addEventListener('resize', () => {
    isCompactVisual = window.matchMedia('(max-width: 980px)').matches;
    resizeCanvas();
    window.cancelAnimationFrame(timelineResizeFrame);
    timelineResizeFrame = window.requestAnimationFrame(function(){
      if(typeof alignImmersiveRail === 'function') alignImmersiveRail();
      if(typeof updateImmersiveTimelineFocus === 'function') updateImmersiveTimelineFocus();
      if(typeof syncTimelineCardHeights === 'function') syncTimelineCardHeights();
      if(typeof drawActiveWaveforms === 'function') drawActiveWaveforms();
    });
  });
  var timelineTrackElement = document.getElementById('timelineTrack');
  if(timelineTrackElement) {
    timelineTrackElement.addEventListener('scroll', function(){ if(typeof scheduleImmersiveTimelineFocus === 'function') scheduleImmersiveTimelineFocus(); }, { passive:true });
    timelineTrackElement.addEventListener('click', function(e){
      var target = e.target && e.target.closest ? e.target : null;
      var button = target?.closest('.timeline-asset, .immersive-file');
      if(!button || !this.contains(button)) return;
      e.stopPropagation();
      var info = target.closest('.timeline-info, .immersive-info');
      var key = (info || button).getAttribute('data-row-key');
      if(info) openTimelineInfo(key);
      else openTimelineAsset(key);
    });
  }
  function resizeCanvas() {
    var scale = isCompactVisual ? 0.55 : 1;
    canvas.width = Math.max(1, Math.floor(canvas.clientWidth * scale));
    canvas.height = Math.max(1, Math.floor(canvas.clientHeight * scale));
  }

  function hexToRgb(hex) {
    var clean = String(hex || '#ffffff').replace('#', '').trim();
    if(clean.length === 3) clean = clean.split('').map(ch => ch + ch).join('');
    var num = parseInt(clean, 16);
    if(Number.isNaN(num)) return { r: 255, g: 255, b: 255 };
    return { r: (num >> 16) & 255, g: (num >> 8) & 255, b: num & 255 };
  }

  function rgbToHex(rgb) {
    return '#' + [rgb.r, rgb.g, rgb.b].map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
  }

  function setReactiveColor(rgb) {
    reactiveBase = rgb || reactiveBase;
    document.documentElement.style.setProperty('--reactive-r', reactiveBase.r);
    document.documentElement.style.setProperty('--reactive-g', reactiveBase.g);
    document.documentElement.style.setProperty('--reactive-b', reactiveBase.b);
    document.documentElement.style.setProperty('--reactive-accent', rgbToHex(reactiveBase));
  }

  function applyReactiveCssFrame(pulse, rgb, frameTime, force) {
    var now = frameTime || performance.now();
    if(!force && now - reactiveCssLastFrame < 48) return;
    reactiveCssLastFrame = now;
    document.documentElement.style.setProperty('--reactive-pulse', Math.max(0, pulse || 0).toFixed(3));
    if(!rgb) return;
    document.documentElement.style.setProperty('--reactive-r', Math.round(rgb.r));
    document.documentElement.style.setProperty('--reactive-g', Math.round(rgb.g));
    document.documentElement.style.setProperty('--reactive-b', Math.round(rgb.b));
    document.documentElement.style.setProperty('--reactive-accent', rgbToHex(rgb));
  }

  function setMoodTheme(color) {
    var rgb = hexToRgb(color || '#ffffff');
    document.documentElement.style.setProperty('--theme-r', rgb.r);
    document.documentElement.style.setProperty('--theme-g', rgb.g);
    document.documentElement.style.setProperty('--theme-b', rgb.b);
  }

  function readCoverColor(src, fallbackColor) {
    setReactiveColor(hexToRgb(fallbackColor));
    if(!src) return;
    var img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = function() {
      try {
        var sample = document.createElement('canvas');
        sample.width = 24;
        sample.height = 24;
        var ctx = sample.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(img, 0, 0, sample.width, sample.height);
        var pixels = ctx.getImageData(0, 0, sample.width, sample.height).data;
        var r = 0, g = 0, b = 0, count = 0;
        for(var i = 0; i < pixels.length; i += 16) {
          var alpha = pixels[i + 3];
          if(alpha < 80) continue;
          var brightness = (pixels[i] + pixels[i + 1] + pixels[i + 2]) / 3;
          if(brightness < 18) continue;
          r += pixels[i]; g += pixels[i + 1]; b += pixels[i + 2]; count++;
        }
        if(count) setReactiveColor({ r: r / count, g: g / count, b: b / count });
      } catch(err) {}
    };
    img.src = src;
  }

  function reactiveBandColor(low, mid, high, energy) {
    var swing = Math.max(0, Math.min(1, (high - low + 80) / 180));
    var bpmFeel = Math.max(0, Math.min(1, (low * 0.7 + mid * 0.3) / 255));
    reactiveHueShift = (reactiveHueShift + 0.006 + bpmFeel * 0.018) % 1;
    var tint = {
      r: reactiveBase.r * (0.78 + low / 900) + 255 * swing * 0.22,
      g: reactiveBase.g * (0.78 + mid / 950) + 255 * reactiveHueShift * 0.14,
      b: reactiveBase.b * (0.82 + high / 900) + 255 * (1 - swing) * 0.16
    };
    var lift = 1 + energy * 0.34;
    return { r: Math.min(255, tint.r * lift), g: Math.min(255, tint.g * lift), b: Math.min(255, tint.b * lift) };
  }

  function supabaseConfigured() {
    return SUPABASE_URL.indexOf('PASTE_') !== 0 && SUPABASE_ANON_KEY.indexOf('PASTE_') !== 0 && ADMIN_EMAIL !== 'your@email.com';
  }

  async function initSupabase() {
    if(!supabaseConfigured()) {
      document.getElementById('authStatus').textContent = 'local preview';
      document.body.classList.add('is-admin');
      isAdmin = true;
      setTimeout(autoRescanBandlabSource,0);
      return;
    }
    if(!window.supabase) {
      isAdmin = false;
      isRemoteReady = false;
      document.body.classList.remove('is-admin');
      syncAdminControls();
      return;
    }

    try {
      supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
      isRemoteReady = true;
      var sessionData = await supabaseClient.auth.getSession();
      updateAuthState(sessionData.data.session);
      supabaseClient.auth.onAuthStateChange((event, session) => updateAuthState(session));
      await loadRemoteArchive();
      await loadArchiveExtras();
      setupLiveRealtime();
      await loadLiveState();
    } catch(error) {
      isAdmin = false;
      isRemoteReady = false;
      document.body.classList.remove('is-admin');
      syncAdminControls();
    }
  }

  function updateAuthState(session) {
    var email = session && session.user ? session.user.email : '';
    isAdmin = email && email.toLowerCase() === ADMIN_EMAIL.toLowerCase();
    document.body.classList.toggle('is-admin', isAdmin);
    document.getElementById('authStatus').textContent = isAdmin ? 'admin' : '';
    document.getElementById('authLogin').style.display = 'none';
    document.getElementById('authLogout').style.display = isAdmin ? 'inline' : 'none';
    document.getElementById('authEmail').style.display = 'none';
    if(!isAdmin) {
      document.getElementById('controlPanel').classList.remove('active');
      document.body.classList.remove('admin-workspace-open');
      if(typeof archiveEnrichment !== 'undefined') {
        archiveEnrichment.suggestions = [];
        archiveEnrichment.suggestionsByAsset = new Map();
        enrichmentSelectedSuggestionId = '';
        enrichmentBulkSelection.clear();
        if(typeof hydrateArchiveEnrichmentRows === 'function') hydrateArchiveEnrichmentRows();
      }
    }
    else setTimeout(autoRescanBandlabSource,0);
    if(supabaseClient && typeof loadArchiveEnrichmentData === 'function') setTimeout(() => loadArchiveEnrichmentData({ force:true }),450);
    syncAdminControls();
    updateCounts();
  }

  function syncAdminControls() {
    document.querySelectorAll('.admin-only').forEach(el => {
      el.setAttribute('aria-hidden', isAdmin ? 'false' : 'true');
      if(!isAdmin && (el.matches('button') || el.matches('input') || el.matches('select'))) el.disabled = true;
      else if(isAdmin && (el.matches('button') || el.matches('input') || el.matches('select'))) el.disabled = false;
    });
  }

  async function adminLogin() {
    if(!supabaseConfigured() || !supabaseClient) return;
    var email = ADMIN_EMAIL;
    var result = await supabaseClient.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: window.location.href.split('#')[0] }
    });
    if(result.error) return;
  }

  function adminIndexTap() {
    if(isAdmin || !isRemoteReady) return;
    adminTapCount++;
    clearTimeout(window.adminTapReset);
    window.adminTapReset = setTimeout(() => adminTapCount = 0, 1200);
    if(adminTapCount >= 3) {
      adminTapCount = 0;
      adminLogin();
    }
  }

  async function adminLogout() {
    if(supabaseClient) await supabaseClient.auth.signOut();
  }

  function requireAdmin() {
    if(!isAdmin) {
      alert('admin login required.');
      return false;
    }
    return true;
  }
