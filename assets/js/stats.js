  function playStatKey(row) {
    if(!row) return '';
    row = canonicalRow(row);
    return row.getAttribute('data-id') || row.getAttribute('data-name') || row.getAttribute('data-title') || '';
  }

  function readLocalPlayStats() {
    try {
      var value = JSON.parse(localStorage.getItem(LOCAL_PLAY_STATS_KEY) || '{}');
      return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    } catch(error) { return {}; }
  }

  function writeLocalPlayStats(stats) {
    try { localStorage.setItem(LOCAL_PLAY_STATS_KEY,JSON.stringify(stats || {})); } catch(error) {}
  }

  function rowPlayStat(row) {
    var key = playStatKey(row);
    var local = readLocalPlayStats()[key] || {};
    return {
      play_count: Math.max(Number(local.play_count) || 0,Number(row?.getAttribute('data-play-count')) || 0),
      last_played: local.last_played || row?.getAttribute('data-last-played') || ''
    };
  }

  function trackPlayCount(row) {
    if(!row) return;
    row = canonicalRow(row);
    var key = playStatKey(row);
    if(!key) return;
    var stats = readLocalPlayStats();
    var prior = stats[key] || {};
    var next = { play_count:(Number(prior.play_count) || 0) + 1, last_played:new Date().toISOString() };
    stats[key] = next;
    writeLocalPlayStats(stats);
    row.setAttribute('data-play-count',next.play_count);
    row.setAttribute('data-last-played',next.last_played);
    window.clearTimeout(playStatsRenderTimer);
    playStatsRenderTimer = window.setTimeout(function(){
      if(document.querySelector('.panel-tab[data-tab="stats"].active')) renderPlayStats(remotePlayStatsCache,'panel');
      if(worldsCurrentView === 'stats' && document.getElementById('worldsViewport')?.classList.contains('active')) renderPlayStats(remotePlayStatsCache,'worlds');
    },120);
    if(supabaseClient) supabaseClient.rpc('increment_play_count', { p_key:key }).catch(() => {});
  }

  function statsDateValue(value) {
    var time = value ? new Date(value).getTime() : 0;
    return Number.isFinite(time) ? time : 0;
  }

  function statsDateLabel(value) {
    return statsDateValue(value) ? new Date(value).toLocaleString([], { month:'2-digit', day:'2-digit', hour:'numeric', minute:'2-digit' }).toLowerCase() : 'never';
  }

  function openStatItem(key) {
    var row = findLiveRow(key);
    if(!row) return showAppNotice('that archive item is no longer available.','error');
    var type = row.getAttribute('data-type');
    if(type === 'audio') {
      buildQueue();
      var index = audioQueue.findIndex(item => liveRowKey(item) === liveRowKey(row));
      if(index >= 0) playTrackFromQueue(index);
    } else showMediaInNowPlaying(row,type);
  }

  function renderPlayStats(remoteRows, context) {
    var contextKey = context === 'worlds' ? 'worlds' : 'panel';
    var idPrefix = contextKey === 'worlds' ? 'worldStats' : 'stats';
    var list = document.getElementById(idPrefix + 'PlayList');
    var summary = document.getElementById(idPrefix + 'TotalPlays');
    if(!list || !summary) return;
    var localStats = readLocalPlayStats();
    var remoteByKey = new Map((remoteRows || []).map(stat => [String(stat.asset_key || ''),stat]));
    var items = baseRows().map(row => {
      var key = playStatKey(row);
      var local = localStats[key] || {};
      var remote = remoteByKey.get(key) || {};
      remoteByKey.delete(key);
      var localCount = Number(local.play_count) || 0;
      var remoteCount = Number(remote.play_count) || 0;
      var lastPlayed = statsDateValue(local.last_played) >= statsDateValue(remote.last_played) ? local.last_played : remote.last_played;
      var count = Math.max(localCount,remoteCount);
      row.setAttribute('data-play-count',count);
      row.setAttribute('data-last-played',lastPlayed || '');
      return { key,row,play_count:count,last_played:lastPlayed || '',title:row.getAttribute('data-title') || 'untitled',version:row.getAttribute('data-ver') || '--',folder:row.getAttribute('data-sub') || 'archive root',type:row.getAttribute('data-type') || 'asset' };
    });
    remoteByKey.forEach((stat,key) => items.push({ key,row:null,play_count:Number(stat.play_count) || 0,last_played:stat.last_played || '',title:key,version:'--',folder:'removed from archive',type:'missing' }));
    var allItems = items.slice();
    var search = (document.getElementById(idPrefix + 'Search')?.value || '').toLowerCase().trim();
    if(search) items = items.filter(item => `${item.title} ${item.version} ${item.folder} ${item.type}`.toLowerCase().includes(search));
    var sort = document.getElementById(idPrefix + 'Sort')?.value || 'plays';
    if(sort === 'recent') items.sort((a,b) => statsDateValue(b.last_played) - statsDateValue(a.last_played) || String(a.title).localeCompare(String(b.title)));
    else if(sort === 'title') items.sort((a,b) => String(a.title).localeCompare(String(b.title)));
    else if(sort === 'folder') items.sort((a,b) => String(a.folder).localeCompare(String(b.folder)) || String(a.title).localeCompare(String(b.title)));
    else items.sort((a,b) => b.play_count - a.play_count || statsDateValue(b.last_played) - statsDateValue(a.last_played) || String(a.title).localeCompare(String(b.title)));
    var total = allItems.reduce((sum,item) => sum + item.play_count,0);
    var played = allItems.filter(item => item.play_count > 0).length;
    var latest = allItems.slice().sort((a,b) => statsDateValue(b.last_played) - statsDateValue(a.last_played))[0];
    summary.innerHTML = `<div>library files<strong>${baseRows().length}</strong></div><div>played files<strong>${played}</strong></div><div>total plays<strong>${total}</strong></div><div>last played<strong title="${escapeAttr(latest?.title || 'none')}">${escapeHtml(latest && statsDateValue(latest.last_played) ? latest.title : 'none')}</strong></div>`;
    var visibleItems = items.slice(0,statsRenderLimits[contextKey] || 120);
    var remaining = Math.max(0,items.length - visibleItems.length);
    list.innerHTML = items.length ? visibleItems.map((item,index) => `<button class="stats-row" type="button" data-key="${escapeAttr(item.key)}" ${item.row ? `onclick="openStatItem(decodeURIComponent('${encodeURIComponent(item.key)}'))"` : 'disabled'}><span class="stats-rank">${item.play_count ? '#' + (index + 1) : '--'}</span><span class="stats-name">${escapeHtml(item.title)}<small>${escapeHtml(item.folder)}</small></span><span class="stats-folder">${escapeHtml(item.version)}<small>${escapeHtml(item.type)}</small></span><span class="stats-count"><strong>${item.play_count}</strong> plays</span><span class="stats-date">${escapeHtml(statsDateLabel(item.last_played))}<small>last played</small></span><span class="stats-date">${item.row ? 'open item' : 'missing'}<small>${escapeHtml(item.key.slice(0,18) || 'no key')}</small></span></button>`).join('') + (remaining ? `<button class="stats-more" type="button" onclick="showMoreStats('${contextKey}')">show ${Math.min(120,remaining)} more files / ${remaining} waiting</button>` : '') : '<div class="world-empty" style="min-height:180px">No songs match this stats search.</div>';
  }

  function showMoreStats(context) {
    var contextKey = context === 'worlds' ? 'worlds' : 'panel';
    statsRenderLimits[contextKey] = (statsRenderLimits[contextKey] || 120) + 120;
    renderPlayStats(remotePlayStatsCache,contextKey);
  }

  async function loadPlayStats(forceCloud, context) {
    var contextKey = context === 'worlds' ? 'worlds' : 'panel';
    var idPrefix = contextKey === 'worlds' ? 'worldStats' : 'stats';
    renderPlayStats(remotePlayStatsCache,contextKey);
    var source = document.getElementById(idPrefix + 'SourceState');
    if(!supabaseClient) {
      if(source) source.textContent = 'device stats / cloud unavailable';
      return;
    }
    if(statsCloudLoading || (!forceCloud && remotePlayStatsLoadedAt && Date.now() - remotePlayStatsLoadedAt < 60000)) {
      if(source) source.textContent = statsCloudLoading ? 'device stats / syncing cloud' : 'device + cloud stats';
      return;
    }
    statsCloudLoading = true;
    if(source) source.textContent = 'device stats / syncing cloud';
    try {
      var result = await supabaseClient.from('play_counts').select('*').limit(5000);
      if(result.error) throw result.error;
      remotePlayStatsCache = result.data || [];
      remotePlayStatsLoadedAt = Date.now();
      if(source) source.textContent = 'device + cloud stats';
    } catch(error) {
      if(source) source.textContent = 'device stats / cloud table unavailable';
    } finally {
      statsCloudLoading = false;
      renderPlayStats(remotePlayStatsCache,contextKey);
    }
  }
