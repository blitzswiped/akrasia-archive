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

  var archiveMotionTimers = [];
  var archiveMotionAct = 0;
  var archiveMotionActs = [
    { label:'source signal / 01',duration:3200 },
    { label:'revision memory / 02',duration:3700 },
    { label:'connected history / 03',duration:4100 },
    { label:'archive in motion / 04',duration:3900 },
    { label:'akrasia / resolved',duration:3600 }
  ];

  function clearArchiveMotionTimers() {
    archiveMotionTimers.forEach(timer => clearTimeout(timer));
    archiveMotionTimers = [];
  }

  function setArchiveMotionAct(index) {
    var intro = document.getElementById('archiveIntro');
    if(!intro) return;
    archiveMotionAct = Math.max(0,Math.min(archiveMotionActs.length - 1,Number(index) || 0));
    intro.setAttribute('data-act',archiveMotionAct);
    intro.querySelectorAll('[data-motion-copy]').forEach(section => {
      var active = Number(section.getAttribute('data-motion-copy')) === archiveMotionAct;
      section.setAttribute('aria-hidden',active ? 'false' : 'true');
    });
    var label = document.getElementById('motionActLabel');
    if(label) label.textContent = archiveMotionActs[archiveMotionAct].label;
  }

  function scheduleArchiveMotion() {
    clearArchiveMotionTimers();
    var elapsed = 0;
    archiveMotionActs.forEach((act,index) => {
      if(index) archiveMotionTimers.push(setTimeout(() => setArchiveMotionAct(index),elapsed));
      elapsed += act.duration;
    });
    var progress = document.getElementById('motionProgress');
    if(progress) {
      progress.style.setProperty('--motion-duration',`${elapsed}ms`);
      progress.classList.remove('running');
      void progress.offsetWidth;
      progress.classList.add('running');
    }
    archiveMotionTimers.push(setTimeout(() => finishArchiveIntro(false),elapsed));
  }

  function revealArchiveShell(delay) {
    setTimeout(() => {
      document.body.classList.remove('shell-loading');
      document.body.classList.add('archive-ready');
    }, delay || 0);
    setTimeout(() => document.documentElement.classList.remove('intro-running'),Math.max(1300,(delay || 0) + 1050));
  }

  function finishArchiveIntro(skipped) {
    var intro = document.getElementById('archiveIntro');
    if(!intro || intro.classList.contains('is-leaving')) return;
    clearArchiveMotionTimers();
    if(!skipped && archiveMotionAct < archiveMotionActs.length - 1) setArchiveMotionAct(archiveMotionActs.length - 1);
    var mark = document.getElementById('introMark');
    var target = document.querySelector('.topbar .wordmark');
    if(mark && target && !skipped && mark.animate) {
      var from = mark.getBoundingClientRect();
      var to = target.getBoundingClientRect();
      var dx = to.left + to.width / 2 - (from.left + from.width / 2);
      var dy = to.top + to.height / 2 - (from.top + from.height / 2);
      var scale = Math.max(.12, to.width / Math.max(1, from.width));
      mark.classList.add('is-landing');
      mark.animate([{transform:'translate3d(0,0,0) scale(1)',opacity:1},{transform:`translate3d(${dx}px,${dy}px,0) scale(${scale})`,opacity:.96}],{duration:900,easing:'cubic-bezier(.16,1,.3,1)',fill:'forwards'});
    }
    intro.classList.add('is-leaving');
    document.body.classList.remove('intro-active');
    revealArchiveShell(skipped ? 80 : 260);
    try { localStorage.setItem('akrasia_motion_intro_seen_v1','1'); } catch(error) {}
    window.setTimeout(() => showArchiveSetup(''),skipped ? 260 : 1080);
    setTimeout(() => {
      intro.remove();
      document.documentElement.classList.remove('intro-running');
    }, skipped ? 520 : 980);
  }

  function startArchiveIntro() {
    var drawer = document.getElementById('liveAdminDrawer');
    if(drawer && drawer.parentElement !== document.body) document.body.appendChild(drawer);
    var alreadySeen = false;
    try { alreadySeen = localStorage.getItem('akrasia_motion_intro_seen_v1') === '1'; } catch(error) {}
    if(alreadySeen) {
      var intro = document.getElementById('archiveIntro');
      if(intro) intro.remove();
      document.documentElement.classList.remove('intro-running');
      document.body.classList.remove('intro-active');
      revealArchiveShell(90);
      window.setTimeout(() => showArchiveSetup(''),260);
      return;
    }
    document.documentElement.classList.add('intro-running');
    var reducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if(reducedMotion) {
      setArchiveMotionAct(archiveMotionActs.length - 1);
      archiveMotionTimers.push(setTimeout(() => finishArchiveIntro(false),2600));
      return;
    }
    setArchiveMotionAct(0);
    scheduleArchiveMotion();
  }

  startArchiveIntro();
  initSupabase();
