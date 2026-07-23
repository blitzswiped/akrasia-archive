  // Init
  document.addEventListener('input', function(event){
    if(event.target && event.target.matches && event.target.matches('input[type="range"]')) syncRangeControl(event.target);
  });
  initRangeControls(document);
  var liveChatNameEl = document.getElementById('liveChatUsername');
  if(liveChatNameEl) {
    var savedLiveChatName = localStorage.getItem('akrasia_chat_name') || sessionStorage.getItem('akrasia_chat_name') || '';
    if(savedLiveChatName) lockLiveChatName(savedLiveChatName);
  }
  var liveChatInputEl = document.getElementById('liveChatInput');
  if(liveChatInputEl) {
    liveChatInputEl.addEventListener('keydown', function(event) {
      if(event.key !== 'Enter') return;
      event.preventDefault();
      sendLiveChat();
    });
  }
  var statsSearchEl = document.getElementById('statsSearch');
  if(statsSearchEl) statsSearchEl.addEventListener('input', () => loadPlayStats());
  var worldsSearchEl = document.getElementById('worldsSearch');
  if(worldsSearchEl) worldsSearchEl.addEventListener('input', event => renderWorldSearch(event.target.value));
  var worldsBodyEl = document.getElementById('worldsBody');
  if(worldsBodyEl) {
    var worldsBodyObserver = new MutationObserver(function(){
      worldsBodyEl.classList.remove('resolving');
      void worldsBodyEl.offsetWidth;
      worldsBodyEl.classList.add('resolving');
    });
    worldsBodyObserver.observe(worldsBodyEl,{ childList:true });
  }
  loadArchiveSettings();
  document.querySelectorAll('.folder-block[data-standard-folder]').forEach(folder => setFolderCollapsed(folder,folderShouldStartCollapsed(folder.getAttribute('data-standard-folder')),false));
  toggleCoverInput();
  setDefaultAssetDate();
  updateDirectoryDropdown();
  toggleRootPlacement(false);
  updateCounts();
  initExplorerDrag();
  initBandlabImporter();
  if(typeof initArchiveRules === 'function') initArchiveRules();
  if(typeof initAdminWorkspace === 'function') initAdminWorkspace();
  var mobileExitObserver = new MutationObserver(syncMobileExitControl);
  ['controlPanel','liveAdminDrawer','liveRoom','timelinePanel','fsPlayer'].forEach(id => {
    var element = document.getElementById(id);
    if(element) mobileExitObserver.observe(element, { attributes:true, attributeFilter:['class'] });
  });
  document.querySelectorAll('.viewport-overlay').forEach(viewport => mobileExitObserver.observe(viewport, { attributes:true, attributeFilter:['class'] }));
  window.addEventListener('resize', syncMobileExitControl, { passive:true });
  syncMobileExitControl();
  var archiveSetupNext = '';

  function archiveChatName() {
    try { return localStorage.getItem('akrasia_chat_name') || sessionStorage.getItem('akrasia_chat_name') || ''; }
    catch(error) { return ''; }
  }

  function showArchiveSetup(next) {
    if(archiveChatName()) return true;
    archiveSetupNext = next || '';
    var setup = document.getElementById('archiveSetup');
    if(!setup) return true;
    setup.hidden = false;
    setup.setAttribute('aria-hidden','false');
    document.body.classList.add('archive-setup-open');
    window.setTimeout(() => document.getElementById('archiveSetupName')?.focus(),80);
    return false;
  }

  function completeArchiveSetup(event) {
    event?.preventDefault();
    var input = document.getElementById('archiveSetupName');
    var name = cleanSingleLine(input?.value || '',24);
    if(!name) return;
    lockLiveChatName(name);
    try { localStorage.setItem('akrasia_entry_setup_v1','1'); } catch(error) {}
    var setup = document.getElementById('archiveSetup');
    if(setup) {
      setup.classList.add('is-leaving');
      window.setTimeout(() => { setup.hidden = true; setup.classList.remove('is-leaving'); },320);
      setup.setAttribute('aria-hidden','true');
    }
    document.body.classList.remove('archive-setup-open');
    var next = archiveSetupNext;
    archiveSetupNext = '';
    if(next === 'live') window.setTimeout(openLiveRoom,360);
  }

  function ensureArchiveSetupForLive() {
    return archiveChatName() ? true : showArchiveSetup('live');
  }

  var archiveSignalTimers = [];
  var archiveSignalPhase = 0;
  var archiveSignalDwell = 5200;
  var archiveSignalBeats = [
    { kicker:'akrasia / entering', title:'not a portfolio. a place that remembers.', copy:'Unreleased music, versions, notes, visuals, and live moments begin as connected files instead of disappearing into folders.', features:['root archive','folders + drag','private files','notes + links'] },
    { kicker:'time resolves around every file', title:'the archive becomes a history.', copy:'Exact dates, sessions, versions, notes, and visuals form one immersive timeline that always returns you to the moment.', features:['date rail','session history','versions','connections'] },
    { kicker:'the file begins to speak', title:'listening opens what lives inside it.', copy:'Artwork, queue, waveform, notes, synced lead vocals, adlibs, pauses, and lyric seeking move with the song.', features:['fullscreen player','synced lyrics','adlibs','instrumental space'] },
    { kicker:'sound leaves an image behind', title:'visual memory stays attached.', copy:'Covers, photographs, videos, and unfinished studies keep their own viewers without becoming disconnected from the music.', features:['image viewer','video viewer','cover studies','archive artifacts'] },
    { kicker:'the archive enters the present', title:'sometimes the room goes live.', copy:'Angel runs the broadcast, queue, countdown, cover, notes, announcements, and moderation while listeners watch without controlling playback.', features:['control room','auto queue','countdown','chat + moderation'] },
    { kicker:'files stop being flat', title:'every version becomes part of a world.', copy:'Version constellations, A/B comparison, archive radio, connections, premieres, history, and accessibility settings turn the archive into one connected place.', features:['song worlds','a / b versions','connections + premieres','radio + history','settings'] }
  ];

  function setArchiveSignalPhase(index) {
    var intro = document.getElementById('archiveIntro');
    if(!intro) return;
    archiveSignalPhase = Math.max(0, Math.min(archiveSignalBeats.length - 1, Number(index) || 0));
    intro.setAttribute('data-phase', archiveSignalPhase);
    var beat = archiveSignalBeats[archiveSignalPhase];
    var narration = intro.querySelector('.signal-narration');
    if(narration) {
      narration.classList.remove('resolving');
      void narration.offsetWidth;
      narration.classList.add('resolving');
    }
    document.getElementById('signalKicker').textContent = beat.kicker;
    document.getElementById('signalTitle').textContent = beat.title;
    document.getElementById('signalCopy').textContent = beat.copy;
    document.getElementById('signalCounter').textContent = `signal ${String(archiveSignalPhase + 1).padStart(2,'0')} / ${String(archiveSignalBeats.length).padStart(2,'0')}`;
    var features = document.getElementById('signalFeatures');
    if(features) features.innerHTML = beat.features.map(feature => `<span>${escapeHtml(feature)}</span>`).join('');
    var progress = document.getElementById('signalProgress');
    if(progress) {
      progress.classList.remove('running');
      void progress.offsetWidth;
      progress.classList.add('running');
    }
  }

  function scheduleArchiveSignal(fromPhase) {
    archiveSignalTimers.forEach(timer => clearTimeout(timer));
    archiveSignalTimers = [];
    for(var phase = fromPhase + 1; phase < archiveSignalBeats.length; phase++) {
      ((targetPhase, delay) => archiveSignalTimers.push(setTimeout(() => setArchiveSignalPhase(targetPhase), delay)))(phase, (phase - fromPhase) * archiveSignalDwell);
    }
    archiveSignalTimers.push(setTimeout(() => finishArchiveIntro(false), (archiveSignalBeats.length - fromPhase) * archiveSignalDwell + 800));
  }

  function revealArchiveShell(delay) {
    setTimeout(() => {
      document.body.classList.remove('shell-loading');
      document.body.classList.add('archive-ready');
    }, delay || 0);
  }

  function finishArchiveIntro(skipped) {
    var intro = document.getElementById('archiveIntro');
    if(!intro || intro.classList.contains('is-leaving')) return;
    archiveSignalTimers.forEach(timer => clearTimeout(timer));
    archiveSignalTimers = [];
    var mark = document.getElementById('introMark');
    var target = document.querySelector('.topbar .wordmark');
    if(mark && target && !skipped && mark.animate) {
      var from = mark.getBoundingClientRect();
      var to = target.getBoundingClientRect();
      var dx = to.left + to.width / 2 - (from.left + from.width / 2);
      var dy = to.top + to.height / 2 - (from.top + from.height / 2);
      var scale = Math.max(.12, to.width / Math.max(1, from.width));
      mark.animate([{transform:'translate(0,0) scale(1)',opacity:1},{transform:`translate(${dx}px,${dy}px) scale(${scale})`,opacity:.92}],{duration:780,easing:'cubic-bezier(.16,1,.3,1)',fill:'forwards'});
    }
    intro.classList.add('is-leaving');
    document.body.classList.remove('intro-active');
    revealArchiveShell(skipped ? 80 : 340);
    try { localStorage.setItem('akrasia_tour_seen_v7','1'); } catch(error) {}
    window.setTimeout(() => showArchiveSetup(''),skipped ? 260 : 920);
    setTimeout(() => intro.remove(), 820);
  }

  function startArchiveIntro() {
    var drawer = document.getElementById('liveAdminDrawer');
    if(drawer && drawer.parentElement !== document.body) document.body.appendChild(drawer);
    var alreadySeen = false;
    try { alreadySeen = localStorage.getItem('akrasia_tour_seen_v7') === '1'; } catch(error) {}
    if(alreadySeen) {
      var intro = document.getElementById('archiveIntro');
      if(intro) intro.remove();
      document.body.classList.remove('intro-active');
      revealArchiveShell(90);
      window.setTimeout(() => showArchiveSetup(''),260);
      return;
    }
    setArchiveSignalPhase(0);
    scheduleArchiveSignal(0);
  }

  startArchiveIntro();
  initSupabase();
