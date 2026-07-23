  function showMediaInNowPlaying(row, type) {
    if(!applyingLiveState) leaveLiveViewForArchivePlayback();
    toggleLyricsFocus(false);
    activeMediaType = type;
    activeVisualRow = row;
    clearInterval(window.mockTimer);
    if(type !== 'audio') {
      activeWaveformKey = `${type}:${row.getAttribute('data-title') || ''}`;
      activeWaveformPeaks = fallbackWaveformPeaks(activeWaveformKey);
      setProgressDisplay(0, type === 'video' ? 'video preview' : 'image preview');
    }
    if(currentAudio) { currentAudio.pause(); setPlayIcon(true); }
    setPlayingState(false);
    document.querySelectorAll('.frow.playing').forEach(r => r.classList.remove('playing'));
    row.classList.add('playing');
    document.getElementById('fsPlayer').classList.add('media-mode', `${type}-mode`);
    closeNowInfo();
    document.getElementById('fsPlayer').classList.remove('audio-mode', type === 'image' ? 'video-mode' : 'image-mode');
    setModeLabel(`${type} viewer`);
    setAppSection(`${type} viewer`);

    var comboSub = `${row.getAttribute('data-sub')} / ${row.getAttribute('data-ver')} / ${type}`;
    document.getElementById('pbTitle').textContent = row.getAttribute('data-title');
    document.getElementById('pbSub').textContent = comboSub;
    document.getElementById('fsTitle').textContent = row.getAttribute('data-title');
    document.getElementById('fsSub').textContent = comboSub;
    document.getElementById('playerBar').classList.add('active', 'media-preview');
    document.getElementById('fsPlayer').classList.add('active');
    animateTrackSwap();
    updateNowPlayingDetails(row, type);
    renderFullscreenMedia(row, type);
    renderMeta(row);
    resizeCanvas();
    maybeBroadcastLiveRow(row, { playing: type === 'video', position: 0 });
  }

  function renderFullscreenMedia(row, type) {
    var stage = document.getElementById('fsMediaStage');
    var visualizer = document.getElementById('visualizerCanvas');
    var fsCover = document.getElementById('fsCover');
    stage.innerHTML = '';
    if(type === 'audio') {
      document.getElementById('fsPlayer').classList.remove('media-mode', 'image-mode', 'video-mode');
      document.getElementById('fsPlayer').classList.add('audio-mode');
      closeNowInfo();
      if(document.getElementById('fsPlayer').classList.contains('active')) setAppSection('now playing');
      stage.classList.remove('active');
      visualizer.classList.remove('hidden');
      return;
    }
    fsCover.src = '';
    fsCover.classList.remove('active');
    visualizer.classList.add('hidden');
    stage.classList.add('active');
    if(type === 'image') {
      var src = row.getAttribute('data-img-src') || row.getAttribute('data-cover') || '';
      var img = document.createElement('img');
      img.src = src;
      img.alt = row.getAttribute('data-title') || 'archive preview';
      img.loading = 'eager';
      stage.appendChild(img);
      readCoverColor(src, row.getAttribute('data-mood-color') || moodColorFor(row.getAttribute('data-mood') || 'raw'));
    } else if(type === 'video') {
      var video = document.createElement('video');
      video.src = row.getAttribute('data-video-src') || '';
      video.controls = true;
      video.playsInline = true;
      video.muted = true;
      video.autoplay = true;
      video.loop = true;
      stage.appendChild(video);
    }
    addGalleryControls(stage, type);
  }

  function addGalleryControls(stage, type) {
    var list = visualRows(type);
    if(list.length <= 1) return;
    var prev = document.createElement('button');
    prev.className = 'gallery-nav prev';
    prev.type = 'button';
    prev.textContent = '<';
    prev.onclick = (e) => { e.stopPropagation(); playVisualSibling(type, -1); };
    var next = document.createElement('button');
    next.className = 'gallery-nav next';
    next.type = 'button';
    next.textContent = '>';
    next.onclick = (e) => { e.stopPropagation(); playVisualSibling(type, 1); };
    var chip = document.createElement('div');
    var index = Math.max(0, list.findIndex(row => row === canonicalRow(activeVisualRow || list[0])));
    chip.className = 'gallery-chip';
    chip.textContent = `${index + 1}/${list.length}`;
    stage.appendChild(prev);
    stage.appendChild(next);
    stage.appendChild(chip);
  }

  function visualRows(type) {
    return baseRows().filter(row => row.getAttribute('data-type') === type);
  }

  function playVisualSibling(type, dir) {
    var list = visualRows(type);
    if(!list.length) return;
    var current = canonicalRow(activeVisualRow || list[0]);
    var index = list.findIndex(row => row === current);
    if(index === -1) index = 0;
    var nextIndex = (index + dir + list.length) % list.length;
    showMediaInNowPlaying(list[nextIndex], type);
  }

  function renderMeta(row) {
    var meta = document.getElementById('archiveMeta');
    if(!meta || !row) return;
    var links = [
      ['spotify', row.getAttribute('data-spotify')],
      ['apple music', row.getAttribute('data-apple')],
      ['youtube', row.getAttribute('data-youtube')],
      ['soundcloud', row.getAttribute('data-soundcloud')]
    ].map(item => [item[0], safeExternalUrl(item[1])]).filter(item => item[1]);
    var linkHtml = links.length ? links.map(item => `<a href="${escapeAttr(item[1])}" target="_blank" rel="noopener noreferrer">${escapeHtml(item[0])}</a>`).join('') : '<span>no links added</span>';
    meta.innerHTML = `
      <div class="meta-section-title">notes</div>
      ${renderNotesHtml(row.getAttribute('data-notes') || '')}
      <div class="meta-section-title">time synced lyrics</div>
      <div class="lyrics-card">
        ${renderLyricsHtml(parseSyncedLyrics(row.getAttribute('data-lyrics') || ''))}
        <div class="lyrics-actions admin-only">
          <textarea class="lyrics-edit-box" id="lyricsQuickEdit" placeholder="[0:12] main line || [adlib] background line&#10;[0:28] ...">${escapeHtml(row.getAttribute('data-lyrics') || '')}</textarea>
          <button class="mini-btn" type="button" onclick="saveLyricsFromPlayer()">save lyrics</button>
        </div>
      </div>
      <div class="meta-section-title">dsp / content links</div>
      <div class="link-stack">${linkHtml}</div>
      <div class="meta-grid">
        <div class="meta-chip">version<strong>${escapeHtml(row.getAttribute('data-ver') || 'unknown')}</strong></div>
        <div class="meta-chip">folder<strong>${escapeHtml(row.getAttribute('data-sub') || 'unknown')}</strong></div>
        <div class="meta-chip">size<strong>${escapeHtml(row.getAttribute('data-size') || 'unknown')}</strong></div>
        <div class="meta-chip">file<strong>${escapeHtml(row.getAttribute('data-name') || 'unknown')}</strong></div>
      </div>
      ${typeof enrichmentMetadataHtml === 'function' ? enrichmentMetadataHtml(row,false) : ''}
    `;
    renderLyricsForRow(row);
  }

  async function saveLyricsFromPlayer() {
    if(!requireAdmin()) return;
    var row = activeMediaType === 'audio' && queueIndex >= 0 ? audioQueue[queueIndex] : currentBroadcastRow();
    var input = document.getElementById('lyricsQuickEdit');
    if(!row || !input) return;
    row = canonicalRow(row);
    var lyrics = input.value.trim();
    row.setAttribute('data-lyrics', lyrics);
    var assetId = row.getAttribute('data-id');
    if(isRemoteReady && assetId) {
      var result = await supabaseClient.from('archive_assets').update({ synced_lyrics: lyrics }).eq('id', assetId);
      if(result.error && /synced_lyrics|schema cache|column/i.test(result.error.message || '')) {
        var status = document.getElementById('authStatus');
        if(status) status.textContent = 'add synced_lyrics column in supabase';
      } else if(result.error) {
        return alert(result.error.message);
      }
    }
    renderMeta(row);
    updateNowPlayingDetails(row, row.getAttribute('data-type') || activeMediaType);
  }

  function renderNotesHtml(notes) {
    var clean = String(notes || '').trim();
    if(!clean) return '<div class="notes-card notes-empty">no notes yet</div>';
    var paragraphs = clean.split(/\n{2,}/).map(part => `<p>${escapeHtml(part).replace(/\n/g, '<br>')}</p>`).join('');
    return `<div class="notes-card">${paragraphs}</div>`;
  }

  function parseLyricTime(value) {
    var match = String(value || '').trim().match(/^(?:(\d+):)?(\d{1,2})(?:[.:](\d{1,3}))?$/);
    if(!match) return null;
    var minutes = Number(match[1] || 0);
    var seconds = Number(match[2] || 0);
    var fraction = match[3] ? Number('0.' + match[3].padEnd(3, '0').slice(0, 3)) : 0;
    return minutes * 60 + seconds + fraction;
  }

  function parseSyncedLyrics(text) {
    var entries = [];
    String(text || '').slice(0, 40000).split(/\r?\n/).slice(0, 1500).forEach(line => {
      var clean = line.trim();
      if(!clean) return;
      var bracket = clean.match(/^\[([^\]]+)\]\s*(.+)$/);
      var loose = clean.match(/^((?:(?:\d+:)?\d{1,2})(?:[.:]\d{1,3})?)\s+(.+)$/);
      var time = bracket ? parseLyricTime(bracket[1]) : (loose ? parseLyricTime(loose[1]) : null);
      var lyric = bracket ? bracket[2] : (loose ? loose[2] : clean);
      if(time === null || !lyric) return;
      lyric.split(/\s*\|\|\s*/).forEach((part, splitIndex) => {
        var raw = cleanSingleLine(part, 500);
        if(!raw) return;
        var lane = splitIndex ? 'adlib' : 'main';
        var laneMatch = raw.match(/^\[(adlib|bg|background|lead|main|effect)\]\s*(.*)$/i);
        if(laneMatch) {
          lane = laneMatch[1].toLowerCase() === 'background' ? 'bg' : laneMatch[1].toLowerCase();
          raw = laneMatch[2].trim();
        }
        var isPause = /^(\.{3,}|pause|instrumental)$/i.test(raw);
        entries.push({ time, text: isPause ? '...' : raw, lane, isPause });
      });
    });
    return entries.sort((a, b) => a.time - b.time);
  }

  function groupSyncedLyrics(entries) {
    var groups = [];
    entries.forEach(entry => {
      var last = groups[groups.length - 1];
      if(last && Math.abs(last.time - entry.time) < 0.03) {
        last.lines.push(entry);
        last.isPause = last.isPause && entry.isPause;
      } else {
        groups.push({ time: entry.time, lines: [entry], isPause: entry.isPause });
      }
    });
    return groups;
  }

  function lyricDotsHtml() {
    return '<span class="lyric-dots" aria-label="instrumental pause"><i></i><i></i><i></i></span>';
  }

  function renderLyricsHtml(lyrics) {
    var groups = groupSyncedLyrics(lyrics);
    if(!groups.length) return '<div class="notes-card notes-empty">no synced lyrics yet. add lines like [0:12.30] lyric line.</div>';
    return '<div class="lyrics-mini" id="lyricsMiniList">' + groups.map((group, index) =>
      `<button class="lyrics-line${group.isPause ? ' pause' : ''}" type="button" data-lyric-index="${index}" onclick="seekToLyricGroup(${index})"><time>${fmt(group.time)}</time><span class="lyrics-mini-text">${group.isPause ? lyricDotsHtml() : group.lines.map(line => `<span data-lane="${escapeAttr(line.lane)}">${escapeHtml(line.text)}</span>`).join('')}</span></button>`
    ).join('') + '</div>';
  }

  function renderLyricsForRow(row) {
    activeLyrics = parseSyncedLyrics(row ? row.getAttribute('data-lyrics') : '');
    activeLyricGroups = groupSyncedLyrics(activeLyrics);
    activeLyricIndex = -1;
    updateLyricsArtwork(row);
    var panel = document.getElementById('lyricsFocusLines');
    if(panel) {
      panel.innerHTML = activeLyricGroups.length
        ? activeLyricGroups.map((group, index) => `<button class="lyrics-focus-group${group.isPause ? ' pause' : ''}" type="button" data-lyric-index="${index}" onclick="seekToLyricGroup(${index})">${group.isPause ? lyricDotsHtml() : group.lines.map(line => `<span class="lyrics-focus-line" data-lane="${escapeAttr(line.lane)}">${escapeHtml(line.text)}</span>`).join('')}</button>`).join('')
        : '<div class="lyrics-empty-focus">no synced lyrics for this track yet.</div>';
    }
    document.querySelectorAll('.lyrics-toggle').forEach(btn => btn.classList.toggle('has-lyrics', Boolean(activeLyricGroups.length)));
    updateLyricsDisplay(currentAudio ? currentAudio.currentTime : 0, true);
  }

  function updateLyricsDisplay(time, force) {
    if(!activeLyricGroups.length) {
      activeLyricIndex = -1;
      document.querySelectorAll('.lyrics-line.active,.lyrics-focus-group.active').forEach(line => line.classList.remove('active'));
      return;
    }
    var index = -1;
    for(var i = 0; i < activeLyricGroups.length; i++) {
      if(activeLyricGroups[i].time <= time + 0.04) index = i;
      else break;
    }
    if(index === activeLyricIndex && !force) return;
    activeLyricIndex = index;
    document.querySelectorAll('.lyrics-line').forEach((line, i) => line.classList.toggle('active', i === index));
    document.querySelectorAll('.lyrics-focus-group').forEach((group, i) => {
      group.classList.toggle('active', i === index);
      group.classList.toggle('past', i < index);
      group.classList.toggle('future', i > index);
      group.style.display = index < 0 ? (i <= 3 ? '' : 'none') : (Math.abs(i - index) <= 3 ? '' : 'none');
    });
    var activeMini = document.querySelector('.lyrics-line.active');
    if(activeMini) activeMini.scrollIntoView({ block:'center', behavior:'smooth' });
  }

  function seekToLyricGroup(index) {
    var group = activeLyricGroups[index];
    if(!group || !currentAudio || !currentAudio.duration) return;
    currentAudio.currentTime = Math.max(0, group.time);
    updateTime();
    if(currentAudio.paused) syncCurrentAudioState();
  }

  function updateLyricsArtwork(row) {
    var wrap = document.querySelector('.lyrics-focus-art-wrap');
    var img = document.getElementById('lyricsFocusArt');
    var ambient = document.getElementById('lyricsAmbientArt');
    var title = document.getElementById('lyricsFocusTitle');
    var sub = document.getElementById('lyricsFocusSub');
    if(!wrap || !img) return;
    var src = row ? (row.getAttribute('data-cover') || row.getAttribute('data-img-src') || '') : '';
    if(title) title.textContent = row ? (row.getAttribute('data-title') || 'untitled') : '--';
    if(sub) sub.textContent = row ? `${row.getAttribute('data-sub') || 'archive'} / ${row.getAttribute('data-ver') || 'version'}` : 'angel / akrasia archive';
    if(src) {
      img.src = src;
      if(ambient) ambient.src = src;
      wrap.classList.add('has-art');
    } else {
      img.removeAttribute('src');
      if(ambient) ambient.removeAttribute('src');
      wrap.classList.remove('has-art');
    }
  }

  function toggleLyricsFocus(force) {
    if(activeMediaType !== 'audio') return;
    var fs = document.getElementById('fsPlayer');
    var next = force === undefined ? !fs.classList.contains('lyrics-focus') : Boolean(force);
    fs.classList.toggle('lyrics-focus', next);
    document.querySelectorAll('.lyrics-toggle').forEach(btn => btn.classList.toggle('active', next));
    if(next) {
      closeNowInfo();
      fs.classList.add('active');
      setAppSection('lyrics');
      updateLyricsDisplay(currentAudio ? currentAudio.currentTime : 0, true);
      resizeCanvas();
    } else if(fs.classList.contains('active')) {
      setAppSection('now playing');
    }
  }

  function openLyricsFullscreen() {
    if(activeMediaType !== 'audio') return openMiniPlayerFullscreen();
    document.getElementById('fsPlayer').classList.add('active');
    toggleLyricsFocus(true);
  }

  function updateNowPlayingDetails(row, type) {
    var title = row.getAttribute('data-title') || 'untitled';
    var mood = row.getAttribute('data-mood') || 'raw';
    var moodColor = row.getAttribute('data-mood-color') || moodColorFor(mood);
    setMoodTheme(moodColor);
    var source = row.getAttribute('data-file-url') || row.getAttribute('data-file') || row.getAttribute('data-img-src') || row.getAttribute('data-video-src') ? 'indexed' : 'placeholder';
    var qText = '--';
    var nextText = 'none';
    if(type === 'audio') {
      var pos = audioQueue.findIndex(item => item === row);
      if(pos !== -1) {
        qText = `${pos + 1}/${audioQueue.length}`;
        if(audioQueue[pos + 1]) nextText = audioQueue[pos + 1].getAttribute('data-title') || 'next';
      }
    } else {
      qText = type;
    }
    document.getElementById('fsStateBadge').textContent = type === 'audio' ? 'playing' : (type === 'image' ? 'viewing' : 'previewing');
    document.getElementById('fsTypeBadge').textContent = type;
    document.getElementById('fsMoodBadge').textContent = mood;
    document.documentElement.style.setProperty('--active-mood-color', moodColor);
    document.getElementById('fsQueuePos').textContent = qText;
    document.getElementById('fsSource').textContent = source;
    document.getElementById('fsNextUp').textContent = nextText;
    document.getElementById('fsTitle').title = title;
    updateMiniPlayerArtwork(row, type);
    updateMiniPlayerNotes(row);
  }

  function updateMiniPlayerNotes(row) {
    var notesText = document.getElementById('pbNotesText');
    if(!notesText || !row) return;
    var notes = String(row.getAttribute('data-notes') || '').trim().replace(/\s+/g, ' ');
    notesText.textContent = notes || 'no notes yet';
    notesText.parentElement.classList.toggle('has-notes', Boolean(notes));
    notesText.parentElement.title = notes || 'Open notes and metadata';
  }

  function updateMiniPlayerArtwork(row, type) {
    var artwork = document.getElementById('pbCover');
    if(!artwork || !row) return;
    var source = type === 'image'
      ? (row.getAttribute('data-img-src') || row.getAttribute('data-cover') || '')
      : (row.getAttribute('data-cover') || '');
    if(source) {
      artwork.src = source;
      artwork.classList.add('active');
    } else {
      artwork.removeAttribute('src');
      artwork.classList.remove('active');
    }
  }

  function escapeHtml(value) {
    return String(value || '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  }

  function escapeAttr(value) {
    return escapeHtml(value).replace(/`/g, '&#96;');
  }

  function cssEscape(value) {
    if(window.CSS && CSS.escape) return CSS.escape(value);
    return String(value || '').replace(/["\\]/g, '\\$&');
  }

  function moodColorFor(mood) {
    var key = String(mood || '').toLowerCase();
    var defaults = { ambient:'#8fb7ff', aggressive:'#ff4f4f', raw:'#d8d8d8', text:'#ffffff' };
    return defaults[key] || '#ffffff';
  }

  function buildQueue() {
    var scope = (activeFilter === 'all') ? document.querySelectorAll('[data-batch-target] .frow[data-type="audio"], [data-root-target] > .frow[data-type="audio"]') : document.querySelectorAll('#smartFilterList .frow[data-type="audio"]');
    audioQueue = Array.from(scope);
    renderQueueList();
  }

  function renderQueueList() {
    var qList = document.getElementById('queueList'); qList.innerHTML = '';
    audioQueue.forEach((row, i) => {
      var el = document.createElement('div');
      el.className = 'queue-item' + (i === queueIndex ? ' active' : '');
      el.innerHTML = `<span>${i+1}. ${escapeHtml(row.getAttribute('data-title') || 'untitled')}</span> <span style="opacity:0.5">${escapeHtml(row.getAttribute('data-sub') || 'root')} / ${escapeHtml(row.getAttribute('data-ver') || 'v1')}</span>`;
      el.onclick = () => playTrackFromQueue(i);
      qList.appendChild(el);
    });
  }

  function playTrackFromQueue(index) {
    if(index < 0 || index >= audioQueue.length) return;
    if(!applyingLiveState) leaveLiveViewForArchivePlayback();
    activeMediaType = 'audio';
    activeVisualRow = null;
    document.getElementById('fsPlayer').classList.remove('media-mode', 'image-mode', 'video-mode');
    document.getElementById('fsPlayer').classList.add('audio-mode');
    closeNowInfo();
    if(document.getElementById('fsPlayer').classList.contains('active')) setAppSection('now playing');
    else setAppSection(document.getElementById('worldsViewport')?.classList.contains('active') ? 'worlds' : 'archive');
    queueIndex = index; var row = audioQueue[queueIndex];
    animateTrackSwap();
    document.querySelectorAll('.frow.playing').forEach(r => r.classList.remove('playing'));
    row.classList.add('playing');
    
    var comboSub = `${row.getAttribute('data-sub')} / ${row.getAttribute('data-ver')}`;

    document.getElementById('pbTitle').textContent = row.getAttribute('data-title'); 
    document.getElementById('fsTitle').textContent = row.getAttribute('data-title');
    document.getElementById('pbSub').textContent = comboSub; 
    document.getElementById('fsSub').textContent = comboSub;
    document.getElementById('playerBar').classList.add('active');
    document.getElementById('playerBar').classList.remove('media-preview');
    renderFullscreenMedia(row, 'audio');
    renderLyricsForRow(row);
    resetAudioProgress();
    
    var cover = row.getAttribute('data-cover');
    var fsCover = document.getElementById('fsCover');
    if(cover) { fsCover.src = cover; fsCover.classList.add('active'); } 
    else { fsCover.src = ''; fsCover.classList.remove('active'); }
    readCoverColor(cover, row.getAttribute('data-mood-color') || moodColorFor(row.getAttribute('data-mood') || 'raw'));

    renderQueueList();
    updateNowPlayingDetails(row, 'audio');
    renderMeta(row);

    if(currentAudio) {
      currentAudio.pause();
      currentAudio.removeAttribute('src');
    }

    var file = row.getAttribute('data-file');
    loadWaveformForAudio(file, row.getAttribute('data-id') || row.getAttribute('data-name') || file || row.getAttribute('data-title'));
    if(file) {
      currentAudio = createArchiveAudio(file);
      currentAudio.loop = isLooping;
      syncCurrentAudioState();
      setupWebAudio(currentAudio);
      var trackAudio = currentAudio;
      var historyResumeApplied = false;
      currentAudio.addEventListener('loadedmetadata', () => { if(currentAudio === trackAudio) { if(!historyResumeApplied) { resumeListeningPosition(row,trackAudio); historyResumeApplied = true; } updateTime(); } }, { once: true });
      currentAudio.addEventListener('timeupdate', () => { if(currentAudio === trackAudio) { updateTime(); recordListeningState(row); } });
      currentAudio.addEventListener('ended', () => { if(currentAudio === trackAudio) handleTrackEnd(); });
      currentAudio.addEventListener('play', () => { if(currentAudio === trackAudio) syncCurrentAudioState(); });
      currentAudio.addEventListener('pause', () => { if(currentAudio === trackAudio) syncCurrentAudioState(); });
      if(currentAudio.readyState >= 1 && !historyResumeApplied) { resumeListeningPosition(row,currentAudio); historyResumeApplied = true; }
      if(audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
      currentAudio.play().then(() => { syncCurrentAudioState(); trackPlayCount(row); maybeBroadcastLiveRow(row); }).catch(e => { syncCurrentAudioState(); maybeBroadcastLiveRow(row, { playing: false }); });
    } else {
      currentAudio = createArchiveAudio(); setPlayIcon(false); setPlayingState(true); updateTimeMock(); trackPlayCount(row); maybeBroadcastLiveRow(row);
    }
    resizeCanvas();
    if(document.getElementById('worldsViewport')?.classList.contains('active') && worldsCurrentView === 'radio') window.setTimeout(renderArchiveRadio,80);
  }

  function handleTrackEnd() {
    if(isLooping) return;
    if(queueIndex < audioQueue.length - 1) playTrackFromQueue(queueIndex + 1);
    else { setPlayIcon(true); setPlayingState(false); }
  }

  function playNextTrack() { if(queueIndex < audioQueue.length - 1) playTrackFromQueue(queueIndex + 1); }
  function playPrevTrack() { if(queueIndex > 0) playTrackFromQueue(queueIndex - 1); }
  function createArchiveAudio(url) {
    var audio = new Audio();
    audio.crossOrigin = 'anonymous';
    audio.preload = 'metadata';
    if(url) audio.src = url;
    return audio;
  }
  function toggleCurrentPlayback() {
    if(isLiveFollower && document.getElementById('liveRoom').classList.contains('active')) return;
    if(activeMediaType !== 'audio' || !currentAudio) return;
    if(currentAudio.paused) {
      if(audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
      setPlayIcon(false);
      setPlayingState(true);
      currentAudio.play()
        .then(() => { syncCurrentAudioState(); maybeBroadcastLiveRow(audioQueue[queueIndex]); })
        .catch(() => { syncCurrentAudioState(); maybeBroadcastLiveRow(audioQueue[queueIndex], { playing: false }); });
    } else {
      setPlayIcon(true);
      setPlayingState(false);
      currentAudio.pause();
      syncCurrentAudioState();
      maybeBroadcastLiveRow(audioQueue[queueIndex], { playing: false });
    }
  }

  document.getElementById('pbNext').onclick = playNextTrack;
  document.getElementById('pbPrev').onclick = playPrevTrack;
  document.getElementById('fsNext').onclick = playNextTrack;
  document.getElementById('fsPrev').onclick = playPrevTrack;
  
  var btnLoop = document.getElementById('pbLoop');
  btnLoop.onclick = () => { isLooping = !isLooping; btnLoop.classList.toggle('active', isLooping); if(currentAudio) currentAudio.loop = isLooping; };
  
  document.getElementById('pbPlay').onclick = toggleCurrentPlayback;
  document.getElementById('fsPlay').onclick = toggleCurrentPlayback;

  document.addEventListener('keydown', function(e) {
    var tag = (e.target && e.target.tagName || '').toLowerCase();
    if(['input','textarea','select'].includes(tag) || (e.target && e.target.isContentEditable)) return;
    var fsActive = document.getElementById('fsPlayer').classList.contains('active');
    var timelineActive = document.getElementById('timelinePanel').classList.contains('active');
    if(e.key === 'Escape') {
      if(fsActive) {
        var fs = document.getElementById('fsPlayer');
        if(fs.classList.contains('lyrics-focus')) { toggleLyricsFocus(false); return; }
        if(fs.classList.contains('info-open')) { closeNowInfo(); return; }
        toggleFullscreen();
        return;
      }
      var activeViewport = document.querySelector('.viewport-overlay.active');
      if(activeViewport) {
        closeViewport(activeViewport.id);
        return;
      }
      if(timelineActive) { closeTimelineView(); return; }
    }
    if(!fsActive) return;
    if(isLiveFollower && [' ','Space','ArrowRight','ArrowLeft'].includes(e.key) || (isLiveFollower && e.code === 'Space')) {
      e.preventDefault();
      return;
    }
    if(e.key === ' ' || e.code === 'Space') {
      e.preventDefault();
      toggleCurrentPlayback();
    } else if(e.key === 'ArrowRight') {
      e.preventDefault();
      if(activeMediaType === 'audio') playNextTrack();
    } else if(e.key === 'ArrowLeft') {
      e.preventDefault();
      if(activeMediaType === 'audio') playPrevTrack();
    }
  });

  document.getElementById('pbClose').onclick = () => {
    exitLiveFollowerMode();
    toggleLyricsFocus(false);
    document.getElementById('playerBar').classList.remove('active', 'media-preview'); document.getElementById('fsPlayer').classList.remove('active');
    if(currentAudio) currentAudio.pause();
    setPlayingState(false);
    document.getElementById('fsMediaStage').innerHTML = '';
    document.getElementById('fsMediaStage').classList.remove('active');
    document.getElementById('visualizerCanvas').classList.remove('hidden');
    document.getElementById('pbFill').style.width = '0%';
    document.getElementById('fsFill').style.width = '0%';
    document.getElementById('pbTime').textContent = '00:00 / 00:00';
    document.getElementById('fsTime').textContent = '00:00 / 00:00';
    document.querySelectorAll('.frow.playing').forEach(r => r.classList.remove('playing'));
    activeLyrics = []; activeLyricGroups = []; activeLyricIndex = -1; renderLyricsForRow(null);
    currentAudio = null; queueIndex = -1; activeMediaType = 'audio'; document.documentElement.style.setProperty('--reactive-pulse', '0'); setReactiveColor(reactiveBase); restoreUnderlyingSection(); viewerOrigin = 'archive'; syncViewerExitControl();
  };

  var miniPlayerTouchStartY = null;
  var miniPlayerSwipeHandled = false;
  function openMiniPlayerFullscreen() {
    if(isLiveFollower) {
      openLiveRoom();
      return;
    }
    exitLiveFollowerMode();
    var fs = document.getElementById('fsPlayer');
    if(fs.classList.contains('active')) return;
    openAnimatedSurface(fs);
    setAppSection(activeMediaType === 'audio' ? 'now playing' : `${activeMediaType} viewer`);
    resizeCanvas();
  }
  document.getElementById('playerBar').addEventListener('touchstart', function(event) {
    if(!window.matchMedia('(max-width: 980px)').matches) return;
    miniPlayerTouchStartY = event.touches && event.touches[0] ? event.touches[0].clientY : null;
    miniPlayerSwipeHandled = false;
  }, { passive:true });
  document.getElementById('playerBar').addEventListener('touchend', function(event) {
    if(miniPlayerTouchStartY === null || !event.changedTouches || !event.changedTouches[0]) return;
    var distance = event.changedTouches[0].clientY - miniPlayerTouchStartY;
    miniPlayerTouchStartY = null;
    if(distance < -30) {
      miniPlayerSwipeHandled = true;
      openMiniPlayerFullscreen();
    }
  }, { passive:true });
  document.getElementById('playerBar').addEventListener('click', function(event) {
    if(!window.matchMedia('(max-width: 980px)').matches) return;
    if(miniPlayerSwipeHandled) { miniPlayerSwipeHandled = false; return; }
    if(event.target.closest('button,.pb-progress-container')) return;
    openMiniPlayerFullscreen();
  });

  function setPlayIcon(isPaused) {
    var icon = isPaused
      ? '<path d="M9 7l7 5-7 5" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"/>'
      : '<path d="M9 5v14M15 5v14" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round"/>';
    document.getElementById('pbIcon').innerHTML = icon;
    document.getElementById('fsIcon').innerHTML = icon;
  }

  function syncCurrentAudioState() {
    var isPlaying = Boolean(currentAudio && !currentAudio.paused && !currentAudio.ended);
    setPlayIcon(!isPlaying);
    setPlayingState(isPlaying);
  }

  function setPlayingState(isPlaying) {
    document.getElementById('fsPlayer').classList.toggle('is-playing', isPlaying);
    if(activeMediaType === 'audio') {
      document.getElementById('fsStateBadge').textContent = isPlaying ? 'playing' : 'paused';
    }
  }

  function animateTrackSwap() {
    var fs = document.getElementById('fsPlayer');
    fs.classList.remove('track-swap');
    void fs.offsetWidth;
    fs.classList.add('track-swap');
  }
  function fmt(time) { if(isNaN(time)) return "00:00"; var m = Math.floor(time/60), s = Math.floor(time%60); return (m<10?'0':'')+m+':'+(s<10?'0':'')+s; }

  function setProgressDisplay(percent, text) {
    var safeNumber = Math.max(0, Math.min(100, Number(percent) || 0));
    activeProgressPercent = safeNumber;
    var safePercent = safeNumber + '%';
    var pbFill = document.getElementById('pbFill');
    var fsFill = document.getElementById('fsFill');
    pbFill.style.width = safePercent;
    fsFill.style.width = safePercent;
    [pbFill, fsFill].forEach(fill => {
      fill.style.setProperty('--progress-percent', safePercent);
      var track = fill.closest('.pb-progress');
      if(track) track.style.setProperty('--progress-percent', safePercent);
    });
    document.getElementById('pbTime').textContent = text;
    document.getElementById('fsTime').textContent = text;
    drawActiveWaveforms();
  }

  function resetAudioProgress() {
    clearInterval(window.mockTimer);
    setProgressDisplay(0, '00:00 / 00:00');
  }

  function loadWaveformForAudio(url, key) {
    key = key || url || 'unknown';
    activeWaveformKey = key;
    if(waveformCache.has(key)) {
      activeWaveformPeaks = waveformCache.get(key);
      drawActiveWaveforms();
      return;
    }
    var fallback = fallbackWaveformPeaks(key);
    waveformCache.set(key, fallback);
    if(activeWaveformKey === key) {
      activeWaveformPeaks = fallback;
      drawActiveWaveforms();
    }
  }

  function normalizePeaks(peaks) {
    var max = Math.max(0.1, ...peaks);
    return peaks.map(value => Math.max(0.055, Math.min(1, value / max)));
  }

  function fallbackWaveformPeaks(seed) {
    var text = String(seed || 'akrasia');
    var hash = 2166136261;
    for(var i = 0; i < text.length; i++) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    var peaks = [];
    var value = hash >>> 0;
    for(var index = 0; index < 180; index++) {
      value = Math.imul(value ^ (value >>> 15), 2246822507) >>> 0;
      var noise = (value % 1000) / 1000;
      var envelope = Math.sin((index / 179) * Math.PI);
      var wave = 0.24 + Math.abs(Math.sin(index * 0.19 + (hash % 19))) * 0.46 + noise * 0.34;
      peaks.push(Math.max(0.06, wave * (0.36 + envelope * 0.82)));
    }
    return normalizePeaks(peaks);
  }

  function drawActiveWaveforms() {
    var peaks = activeWaveformPeaks || fallbackWaveformPeaks(activeWaveformKey || 'empty');
    drawWaveformCanvas(document.getElementById('pbWaveform'), peaks, activeProgressPercent);
    drawWaveformCanvas(document.getElementById('fsWaveform'), peaks, activeProgressPercent);
    if(typeof drawEnrichmentReviewWaveform === 'function') drawEnrichmentReviewWaveform();
  }

  function drawWaveformCanvas(canvasEl, peaks, progress) {
    if(!canvasEl || !peaks || !peaks.length) return;
    var rect = canvasEl.getBoundingClientRect();
    var width = Math.max(1, Math.floor(rect.width * window.devicePixelRatio));
    var height = Math.max(1, Math.floor(rect.height * window.devicePixelRatio));
    if(canvasEl.width !== width || canvasEl.height !== height) {
      canvasEl.width = width;
      canvasEl.height = height;
    }
    var ctx = canvasEl.getContext('2d');
    ctx.clearRect(0, 0, width, height);
    var playedX = width * Math.max(0, Math.min(100, progress || 0)) / 100;
    var gap = Math.max(1, Math.floor(width / peaks.length * 0.35));
    var barW = Math.max(1, Math.floor(width / peaks.length) - gap);
    var center = height / 2;
    for(var i = 0; i < peaks.length; i++) {
      var x = Math.floor(i * width / peaks.length);
      var h = Math.max(2, peaks[i] * height * 0.82);
      ctx.fillStyle = x <= playedX ? '#ffffff' : 'rgba(255,255,255,0.34)';
      roundRect(ctx, x, center - h / 2, barW, h, Math.min(barW, 3));
      ctx.fill();
    }
  }

  function roundRect(ctx, x, y, w, h, r) {
    r = Math.max(0, Math.min(r, w / 2, h / 2));
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function updateTime() {
    if(!currentAudio || !currentAudio.duration) return;
    var c = currentAudio.currentTime, d = currentAudio.duration;
    setProgressDisplay(c / d * 100, fmt(c) + ' / ' + fmt(d));
    updateLyricsDisplay(c);
  }

  function updateTimeMock() {
    var c = 0, d = 180; clearInterval(window.mockTimer);
    var tick = 0;
    window.mockTimer = setInterval(() => {
      if(!currentAudio || currentAudio.paused) return;
      tick++;
      if(tick % 4 === 0) c++;
      if(c>d) handleTrackEnd();
      setProgressDisplay(c / d * 100, fmt(c) + ' / ' + fmt(d));
      updateLyricsDisplay(c);
      var pulse = 0.14 + Math.abs(Math.sin(tick * 0.36)) * (isCompactVisual ? 0.22 : 0.18);
      document.documentElement.style.setProperty('--reactive-pulse', pulse.toFixed(3));
    }, 250);
  }

  function applyScrubPosition(e, scrubberId) {
    if(!currentAudio || !currentAudio.duration) return;
    var scrubber = document.getElementById(scrubberId || 'pbScrubber');
    if(!scrubber) return;
    var rect = scrubber.getBoundingClientRect();
    var clientX = e.clientX;
    if(clientX === undefined && e.touches && e.touches[0]) clientX = e.touches[0].clientX;
    var ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    currentAudio.currentTime = ratio * currentAudio.duration;
    updateTime();
  }

  function setupScrubberDrag(scrubberId) {
    var scrubber = document.getElementById(scrubberId);
    if(!scrubber) return;
    scrubber.addEventListener('pointerdown', function(e) {
      if(isLiveFollower) return;
      if(!currentAudio || !currentAudio.duration) return;
      e.preventDefault();
      scrubber.classList.add('dragging');
      scrubber.setPointerCapture(e.pointerId);
      applyScrubPosition(e, scrubberId);
    });
    scrubber.addEventListener('pointermove', function(e) {
      if(!scrubber.classList.contains('dragging')) return;
      e.preventDefault();
      applyScrubPosition(e, scrubberId);
    });
    ['pointerup', 'pointercancel', 'lostpointercapture'].forEach(type => {
      scrubber.addEventListener(type, function() {
        scrubber.classList.remove('dragging');
      });
    });
  }

  setupScrubberDrag('pbScrubber');
  setupScrubberDrag('fsScrubber');

  function setupWebAudio(audio) {
    if(!audioCtx) {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      analyser = audioCtx.createAnalyser(); analyser.fftSize = isCompactVisual ? 128 : 256;
      analyser.smoothingTimeConstant = 0.88;
      dataArray = new Uint8Array(analyser.frequencyBinCount); drawVisualizer();
    }
    if(sourceNode) {
      try { sourceNode.disconnect(); } catch(error) {}
    }
    try {
      sourceNode = audioSourceNodes.get(audio);
      if(!sourceNode) {
        sourceNode = audioCtx.createMediaElementSource(audio);
        audioSourceNodes.set(audio, sourceNode);
      }
      sourceNode.connect(analyser);
      if(!analyserConnected) {
        analyser.connect(audioCtx.destination);
        analyserConnected = true;
      }
    } catch(error) {
      sourceNode = null;
      setPlayIcon(true);
      setPlayingState(false);
    }
  }

  function drawVisualizer(frameTime) {
    requestAnimationFrame(drawVisualizer);
    if(isCompactVisual && frameTime && frameTime - visualLastFrame < 34) return;
    if(frameTime) visualLastFrame = frameTime;
    if(!analyser || !currentAudio) return;
    var visualizerVisible = document.getElementById('fsPlayer')?.classList.contains('active') && !canvas.classList.contains('hidden');
    if(currentAudio.paused) {
      if(visualFade <= 0) return;
      var fadeRate = isCompactVisual ? 0.965 : 0.982;
      visualFade *= fadeRate;
      reactivePulseLevel *= fadeRate;
      visualEnergy *= 0.965;
      visualBass *= 0.965;
      visualBeat *= 0.94;
      if(visualizerVisible) {
        canvasCtx.save();
        canvasCtx.globalCompositeOperation = 'destination-in';
        canvasCtx.fillStyle = `rgba(0,0,0,${fadeRate})`;
        canvasCtx.fillRect(0, 0, canvas.width, canvas.height);
        canvasCtx.restore();
      }
      applyReactiveCssFrame(reactivePulseLevel, null, frameTime);
      if(visualFade < 0.012) {
        visualFade = 0;
        reactivePulseLevel = 0;
        visualEnergy = 0;
        visualBass = 0;
        visualBeat = 0;
        canvasCtx.clearRect(0, 0, canvas.width, canvas.height);
        applyReactiveCssFrame(0, reactiveBase, frameTime, true);
      }
      return;
    }
    visualFrame++;
    analyser.getByteFrequencyData(dataArray);
    
    var sum = 0, low = 0, mid = 0, high = 0;
    dataArray.forEach((v, i) => {
      sum += v;
      if(i < dataArray.length * 0.18) low += v;
      else if(i < dataArray.length * 0.58) mid += v;
      else high += v;
    });
    low = low / Math.max(1, Math.floor(dataArray.length * 0.18));
    mid = mid / Math.max(1, Math.floor(dataArray.length * 0.40));
    high = high / Math.max(1, Math.ceil(dataArray.length * 0.42));
    var energy = (sum / dataArray.length) / 255;
    var bass = low / 255;
    var treble = high / 255;
    visualEnergy += (energy - visualEnergy) * 0.075;
    visualBass += (bass - visualBass) * 0.11;
    visualBeatCooldown = Math.max(0, visualBeatCooldown - 1);
    var beatThreshold = Math.max(0.18, visualBass * 1.18 + 0.04);
    if(bass > beatThreshold && bass > visualBass + 0.055 && visualBeatCooldown === 0) {
      visualBeat = Math.min(1, visualBeat + 0.34 + bass * 0.26);
      visualBeatCooldown = isCompactVisual ? 14 : 11;
    }
    visualBeat *= 0.90;
    var hype = Math.max(0, Math.min(1, (visualEnergy - 0.20) * 2.6 + visualBass * 0.72 + visualBeat * 0.42));
    var tempoPulse = Math.min(0.92, visualEnergy * (0.62 + hype * 0.72) + visualBeat * (0.34 + hype * 0.28));
    var activeColor = reactiveBandColor(low, mid, high, energy);
    visualFade = 1;
    reactivePulseLevel = tempoPulse;
    applyReactiveCssFrame(tempoPulse, activeColor, frameTime);
    if(!visualizerVisible) return;

    canvasCtx.clearRect(0, 0, canvas.width, canvas.height);
    var w = canvas.width;
    var h = canvas.height;
    var glow = `rgba(${Math.round(activeColor.r)},${Math.round(activeColor.g)},${Math.round(activeColor.b)},`;
    var centerX = w * 0.5;
    var centerY = h * (isCompactVisual ? 0.38 : 0.43);
    canvasCtx.globalCompositeOperation = 'lighter';

    var haloRadius = Math.min(w, h) * (0.24 + visualBass * 0.15 + visualBeat * 0.06);
    var halo = canvasCtx.createRadialGradient(centerX, centerY, 0, centerX, centerY, haloRadius * 1.8);
    halo.addColorStop(0, `${glow}${0.10 + visualEnergy * 0.24})`);
    halo.addColorStop(0.42, `${glow}${0.05 + visualBass * 0.14})`);
    halo.addColorStop(1, `${glow}0)`);
    canvasCtx.fillStyle = halo;
    canvasCtx.fillRect(0, 0, w, h);

    for(var ring = 0; ring < 3; ring++) {
      var ringRadius = haloRadius * (0.62 + ring * 0.34) + visualBeat * (18 + ring * 9);
      canvasCtx.beginPath();
      canvasCtx.arc(centerX, centerY, ringRadius, 0, Math.PI * 2);
      canvasCtx.lineWidth = 1 + (ring === 0 ? visualBeat * 2.2 : visualEnergy * 0.8);
      canvasCtx.strokeStyle = `${glow}${Math.max(0.035,0.16 - ring * 0.04 + visualBeat * 0.13)})`;
      canvasCtx.stroke();
    }

    var ribbonY = h * (isCompactVisual ? 0.72 : 0.70);
    var ribbonStep = isCompactVisual ? 18 : 12;
    canvasCtx.beginPath();
    for(var x = 0; x <= w; x += ribbonStep) {
      var ribbonIndex = Math.min(dataArray.length - 1,Math.floor((x / w) * dataArray.length * 0.72));
      var sample = dataArray[ribbonIndex] / 255;
      var envelope = Math.sin((x / w) * Math.PI);
      var y = ribbonY - sample * h * (0.055 + hype * 0.045) * envelope + Math.sin(x * 0.008 + reactiveHueShift * 5) * (3 + visualEnergy * 8);
      if(x === 0) canvasCtx.moveTo(x,y); else canvasCtx.lineTo(x,y);
    }
    canvasCtx.lineWidth = 1.2 + visualBeat * 1.8;
    canvasCtx.strokeStyle = `${glow}${0.22 + visualEnergy * 0.34})`;
    canvasCtx.stroke();

    var barCount = isCompactVisual ? 18 : 36;
    var barW = w / barCount;
    for(var i = 0; i < barCount; i++) {
      var barIndex = Math.floor((i / barCount) * dataArray.length * 0.68);
      var nextIndex = Math.min(dataArray.length - 1,barIndex + 2);
      var value = ((dataArray[barIndex] + dataArray[nextIndex]) / 510) * (0.62 + hype * 0.24) + visualEnergy * 0.16;
      var barH = Math.max(2,value * h * (0.10 + hype * 0.06));
      canvasCtx.fillStyle = `${glow}${0.07 + value * 0.22})`;
      canvasCtx.fillRect(i * barW + 2,h - barH,Math.max(2,barW - 6),barH);
    }
    canvasCtx.globalCompositeOperation = 'source-over';
  }
