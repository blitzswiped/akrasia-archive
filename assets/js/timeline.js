  function timelineDateForRow(row) {
    return row.getAttribute('data-asset-date') || dateFromSortKey(row.getAttribute('data-date')) || '';
  }

  function timelineTimeForRow(row) {
    return row.getAttribute('data-asset-time') || timeFromSortKey(row.getAttribute('data-date')) || '';
  }

  function timelineDisplayTimeForRow(row) {
    var time = timelineTimeForRow(row);
    return time ? `${formatTwelveHourTime(time)} ${easternTimeLabel(timelineDateForRow(row))}` : '';
  }

  function timelineRowMatchesFilter(row) {
    var type = row.getAttribute('data-type') || '';
    var role = row.getAttribute('data-asset-role') || '';
    if(timelineAssetFilter === 'audio') return type === 'audio';
    if(timelineAssetFilter === 'visual') return type === 'image' || type === 'video' || role === 'visual';
    if(timelineAssetFilter === 'notes') return type === 'text' || role === 'note';
    return true;
  }

  function timelineBucketForDate(date) {
    if(timelineScale === 'eras') return String(date || '').slice(0, 4);
    if(timelineScale === 'months') return String(date || '').slice(0, 7);
    return date;
  }

  function timelineLabelForKey(key) {
    if(timelineScale === 'eras') return String(key || 'undated');
    if(timelineScale === 'months') {
      var monthDate = new Date(`${key}-01T12:00:00`);
      return Number.isFinite(monthDate.getTime()) ? monthDate.toLocaleDateString('en-US',{ month:'long', year:'numeric' }) : key;
    }
    return displayDateFromISO(key);
  }

  function timelineScaleLabel() {
    return timelineScale === 'creative' ? 'creative era' : (timelineScale === 'eras' ? 'year' : (timelineScale === 'months' ? 'month' : 'session'));
  }

  function syncTimelineControls() {
    var modeSelect = document.getElementById('timelineModeSelect');
    var scaleSelect = document.getElementById('timelineScaleSelect');
    var filterSelect = document.getElementById('timelineFilterSelect');
    if(modeSelect) modeSelect.value = timelineMode;
    if(scaleSelect) scaleSelect.value = timelineScale;
    if(filterSelect) filterSelect.value = timelineAssetFilter;
    document.querySelectorAll('[data-timeline-mode]').forEach(button => {
      var active = button.getAttribute('data-timeline-mode') === timelineMode;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
    document.querySelectorAll('[data-timeline-scale]').forEach(button => {
      var active = button.getAttribute('data-timeline-scale') === timelineScale;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
    document.querySelectorAll('[data-timeline-filter]').forEach(button => {
      var active = button.getAttribute('data-timeline-filter') === timelineAssetFilter;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
  }

  function setTimelineScale(scale) {
    if(!['days','months','eras','creative'].includes(scale) || timelineScale === scale) return;
    timelineScale = scale;
    activeTimelineDate = null;
    buildTimeline({ animate:true });
  }

  function setTimelineAssetFilter(filter) {
    if(!['all','audio','visual','notes'].includes(filter) || timelineAssetFilter === filter) return;
    timelineAssetFilter = filter;
    activeTimelineDate = null;
    buildTimeline({ animate:true });
  }

  function setTimelineMode(mode) {
    if(!['immersive','calendar','classic'].includes(mode) || timelineMode === mode) return;
    timelineMode = mode;
    activeTimelineDate = null;
    var next = { immersive:'calendar', calendar:'cards', classic:'immersive' }[timelineMode];
    var btn = document.getElementById('timelineModeBtn');
    if(btn) {
      btn.textContent = next;
      btn.classList.toggle('active', timelineMode !== 'classic');
    }
    buildTimeline({ animate:true });
  }

  function dateFromSortKey(value) {
    var raw = String(value || '');
    if(raw.length < 8) return '';
    return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
  }

  function timeFromSortKey(value) {
    var raw = String(value || '');
    if(raw.length < 12) return '';
    return `${raw.slice(8, 10)}:${raw.slice(10, 12)}`;
  }

  function toggleTimelineView() {
    var panel = document.getElementById('timelinePanel');
    if(!panel) return;
    var isActive = !panel.classList.contains('active');
    if(!isActive) return closeTimelineView();
    openAnimatedSurface(panel);
    if(isActive) document.getElementById('liveRoom').classList.remove('active');
    setAppSection(isActive ? 'timeline' : 'archive');
    syncTimelineControls();
    if(timelineNeedsBuild || !document.getElementById('timelineTrack')?.childElementCount) {
      buildTimeline({ animate: !timelineHasAnimated });
    } else {
      alignImmersiveRail();
      updateImmersiveTimelineFocus();
    }
  }

  function closeTimelineView() {
    var panel = document.getElementById('timelinePanel');
    closeAnimatedSurface(panel, function(){ setAppSection('archive'); syncMobileExitControl(); });
  }

  function toggleTimelineMode() {
    var modes = ['immersive','calendar','classic'];
    setTimelineMode(modes[(modes.indexOf(timelineMode) + 1) % modes.length]);
  }

  function toggleTimelineSort() {
    timelineAscending = !timelineAscending;
    var btn = document.getElementById('timelineSortBtn');
    if(btn) btn.textContent = timelineAscending ? 'oldest' : 'newest';
    buildTimeline();
  }

  function timelineGroups() {
    var groups = {};
    baseRows().filter(timelineRowMatchesFilter).forEach(row => {
      var day = timelineDateForRow(row);
      if(!day) return;
      var bucket = timelineBucketForDate(day);
      if(!bucket) return;
      if(!groups[bucket]) groups[bucket] = { rows: [], moods: {} };
      groups[bucket].rows.push(row);
      var mood = row.getAttribute('data-mood') || 'raw';
      groups[bucket].moods[mood] = row.getAttribute('data-mood-color') || moodColorFor(mood);
    });
    var days = Object.keys(groups).sort();
    Object.keys(groups).forEach(day => {
      groups[day].rows.sort((a, b) => sortKeyFromDateTime(timelineDateForRow(a), timelineTimeForRow(a)).localeCompare(sortKeyFromDateTime(timelineDateForRow(b), timelineTimeForRow(b))));
      if(!timelineAscending) groups[day].rows.reverse();
    });
    if(!timelineAscending) days.reverse();
    return { groups, days };
  }

  function buildTimeline(options) {
    options = options || {};
    var track = document.getElementById('timelineTrack');
    var panel = document.getElementById('timelinePanel');
    if(!track) return;
    timelineNeedsBuild = false;
    immersiveTimelineMetrics = [];
    currentImmersiveSection = null;
    currentImmersiveRailMark = null;
    window.cancelAnimationFrame(timelineScrollFrame);
    timelineScrollFrame = 0;
    if(panel) {
      panel.classList.toggle('immersive', timelineMode === 'immersive');
      panel.classList.toggle('calendar', timelineMode === 'calendar');
      panel.classList.toggle('creative-era', timelineScale === 'creative');
      panel.setAttribute('data-timeline-scale', timelineScale);
      panel.setAttribute('data-timeline-filter', timelineAssetFilter);
      window.clearTimeout(timelineReadyTimer);
      if(options.animate) {
        panel.classList.remove('timeline-ready');
        timelineHasAnimated = true;
        timelineReadyTimer = window.setTimeout(() => panel.classList.add('timeline-ready'), 360);
      } else {
        panel.classList.add('timeline-ready');
      }
    }
    syncTimelineControls();
    if(timelineScale === 'creative' && typeof buildCreativeEraTimeline === 'function') return buildCreativeEraTimeline(track);
    if(timelineMode === 'calendar') return buildCalendarTimeline(track);
    var data = timelineGroups();
    if(timelineMode === 'immersive') return buildImmersiveTimeline(track, data.groups, data.days);
    var groups = data.groups;
    var days = data.days;
    track.innerHTML = days.length ? '' : `<div class="timeline-node"><div class="timeline-date">no ${escapeHtml(timelineAssetFilter === 'all' ? 'dated files' : timelineAssetFilter + ' files')}</div><div class="timeline-count">change the filter or add dated assets</div></div>`;
    days.forEach(day => {
      var node = document.createElement('section');
      node.className = 'timeline-node' + (day === activeTimelineDate ? ' active' : '');
      node.dataset.timelineDay = day;
      var moodColors = Object.values(groups[day].moods);
      var leadColor = moodColors[0] || '#ffffff';
      node.style.setProperty('--dot-color', leadColor);
      node.style.animationDelay = `${Math.min(0.36, days.indexOf(day) * 0.035)}s`;
      var dots = moodColors.slice(0, 5).map(color => `<span class="timeline-dot" style="--dot-color:${escapeAttr(color)}"></span>`).join('');
      var assets = groups[day].rows.map((row, index) => {
        return `<button class="timeline-asset" type="button" data-row-key="${escapeAttr(timelineRowKey(row))}">
          <span class="timeline-asset-icon"></span>
          <strong>${escapeHtml(row.getAttribute('data-title') || 'untitled')}</strong>
          <span class="timeline-asset-meta">${escapeHtml(timelineDisplayTimeForRow(row) || row.getAttribute('data-type') || 'asset')}</span>
          <span class="timeline-asset-ver">${escapeHtml(row.getAttribute('data-ver') || 'v1')}</span>
          <span class="timeline-info" data-row-key="${escapeAttr(timelineRowKey(row))}">[info]</span>
        </button>`;
      }).join('');
      node.innerHTML = `
        <div class="timeline-day-head" onclick="toggleTimelineDay('${escapeAttr(day)}')">
          <div>
            <div class="timeline-date">${timelineLabelForKey(day)}</div>
            <div class="timeline-count">${groups[day].rows.length} indexed</div>
            <div class="timeline-moods">${dots}</div>
          </div>
          <div class="timeline-expand">${day === activeTimelineDate ? 'collapse' : 'expand'}</div>
        </div>
        <div class="timeline-assets">${assets}</div>
      `;
      track.appendChild(node);
    });
    window.requestAnimationFrame(syncTimelineCardHeights);
  }

  function timelineCalendarGroups() {
    var groups = {};
    baseRows().filter(timelineRowMatchesFilter).forEach(row => {
      var date = timelineDateForRow(row);
      if(!/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
      if(!groups[date]) groups[date] = [];
      groups[date].push(row);
    });
    Object.values(groups).forEach(rows => {
      rows.sort((a,b) => sortKeyFromDateTime(timelineDateForRow(a),timelineTimeForRow(a)).localeCompare(sortKeyFromDateTime(timelineDateForRow(b),timelineTimeForRow(b))));
      if(!timelineAscending) rows.reverse();
    });
    return groups;
  }

  function calendarMonthMarkup(year, month, groups, maxCount) {
    var monthName = new Date(Date.UTC(year,month,1)).toLocaleDateString('en-US',{ month:'long', timeZone:'UTC' });
    var firstDay = new Date(Date.UTC(year,month,1)).getUTCDay();
    var daysInMonth = new Date(Date.UTC(year,month + 1,0)).getUTCDate();
    var cells = Array.from({ length:firstDay },() => '<span class="calendar-day calendar-day-blank" aria-hidden="true"></span>');
    for(var day = 1; day <= daysInMonth; day++) {
      var key = `${year}-${String(month + 1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
      var count = groups[key]?.length || 0;
      var heat = count ? Math.min(1,Math.max(.16,Math.sqrt(count / Math.max(1,maxCount)))) : 0;
      var selected = key === activeTimelineDate;
      if(count) {
        cells.push(`<button class="calendar-day has-content${selected ? ' selected' : ''}" type="button" style="--calendar-heat:${heat.toFixed(3)}" onclick="openCalendarDay('${key}')" title="${count} file${count === 1 ? '' : 's'} on ${key}"><span>${day}</span><strong>${count}</strong></button>`);
      } else {
        cells.push(`<span class="calendar-day"><span>${day}</span></span>`);
      }
    }
    return `<section class="calendar-month"><header><strong>${monthName}</strong><span>${Object.keys(groups).filter(date => date.startsWith(`${year}-${String(month + 1).padStart(2,'0')}`)).reduce((sum,date) => sum + groups[date].length,0)} files</span></header><div class="calendar-weekdays"><span>s</span><span>m</span><span>t</span><span>w</span><span>t</span><span>f</span><span>s</span></div><div class="calendar-days">${cells.join('')}</div></section>`;
  }

  function calendarDayDetailMarkup(groups) {
    var rows = activeTimelineDate && groups[activeTimelineDate] || [];
    if(!rows.length) return '';
    var files = rows.map(row => `<button class="timeline-asset calendar-day-file" type="button" data-row-key="${escapeAttr(timelineRowKey(row))}">
      <span class="timeline-asset-icon"></span><strong>${escapeHtml(row.getAttribute('data-title') || 'untitled')}</strong>
      <span class="timeline-asset-meta">${escapeHtml(timelineDisplayTimeForRow(row) || row.getAttribute('data-type') || 'asset')}</span>
      <span class="timeline-asset-ver">${escapeHtml(row.getAttribute('data-ver') || 'v1')}</span><span class="timeline-info" data-row-key="${escapeAttr(timelineRowKey(row))}">info</span>
    </button>`).join('');
    return `<section class="calendar-day-detail"><header><div><small>selected session</small><strong>${escapeHtml(displayDateFromISO(activeTimelineDate))}</strong><span>${rows.length} indexed</span></div><button type="button" onclick="openCalendarDay('')">close</button></header><div class="calendar-day-files">${files}</div></section>`;
  }

  function buildCalendarTimeline(track) {
    var groups = timelineCalendarGroups();
    var dates = Object.keys(groups).sort();
    var years = Array.from(new Set(dates.map(date => date.slice(0,4)))).sort();
    if(!timelineAscending) years.reverse();
    if(!years.length) {
      track.innerHTML = `<div class="calendar-empty">no dated ${escapeHtml(timelineAssetFilter === 'all' ? 'archive files' : timelineAssetFilter + ' files')} to map yet.</div>`;
      return;
    }
    var counts = dates.map(date => groups[date].length).sort((a,b) => a - b);
    var maxCount = counts[Math.max(0,Math.ceil(counts.length * .95) - 1)] || counts[counts.length - 1] || 1;
    var total = counts.reduce((sum,count) => sum + count,0);
    var detail = calendarDayDetailMarkup(groups);
    var yearMarkup = years.map(year => {
      var yearDates = dates.filter(date => date.startsWith(year + '-'));
      var yearTotal = yearDates.reduce((sum,date) => sum + groups[date].length,0);
      var months = Array.from({ length:12 },(_,month) => calendarMonthMarkup(Number(year),month,groups,maxCount)).join('');
      return `<section class="calendar-year"><header class="calendar-year-head"><div><small>archive year</small><strong>${year}</strong></div><span>${yearTotal} files / ${yearDates.length} active days</span></header><div class="calendar-months">${months}</div></section>`;
    }).join('');
    track.innerHTML = `<div class="calendar-shell"><div class="calendar-overview"><div><small>creation density</small><strong>${dates.length} active days</strong><span>${total} dated files</span></div><div class="calendar-legend"><span>quiet</span><i></i><i></i><i></i><i></i><i></i><span>busy</span></div></div>${detail}${yearMarkup}</div>`;
  }

  function openCalendarDay(date) {
    activeTimelineDate = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null;
    buildTimeline({ animate:false });
    if(activeTimelineDate) document.querySelector('.calendar-day-detail')?.scrollIntoView({ behavior:archiveSettings?.motion === 'off' ? 'auto' : 'smooth', block:'start' });
  }

  function timelineRailDays(days,limit) {
    limit = Math.max(3,Number(limit) || 9);
    if(days.length <= limit) return days.slice();
    var indices = new Set([0,days.length - 1]);
    for(var index = 1; index < limit - 1; index++) indices.add(Math.round(index * (days.length - 1) / (limit - 1)));
    return Array.from(indices).sort((a,b) => a - b).map(index => days[index]);
  }

  function buildImmersiveTimeline(track, groups, days) {
    if(!days.length) {
      track.innerHTML = `<div class="immersive-empty">no ${escapeHtml(timelineAssetFilter === 'all' ? 'dated files' : timelineAssetFilter + ' files')} at this scale</div>`;
      return;
    }
    var railDays = timelineRailDays(days,9);
    var rails = railDays.map(day => {
      var index = days.indexOf(day);
      return `<button class="immersive-rail-mark" type="button" data-rail-day="${escapeAttr(day)}" onclick="jumpToTimelineDay(decodeURIComponent('${encodeURIComponent(day)}'))"><span>${String(index + 1).padStart(2,'0')}</span>${timelineLabelForKey(day)}</button>`;
    }).join('');
    var body = days.map((day, dayIndex) => {
      var rows = groups[day].rows;
      var moods = Array.from(new Set(rows.map(row => row.getAttribute('data-mood')).filter(Boolean))).slice(0,3);
      var files = rows.map((row, index) => {
        var type = row.getAttribute('data-type') || 'asset';
        var sub = row.getAttribute('data-sub') || 'archive';
        var ver = row.getAttribute('data-ver') || 'v1';
        var mood = row.getAttribute('data-mood') || 'raw';
        var color = row.getAttribute('data-mood-color') || moodColorFor(mood);
        return `<button class="immersive-file" type="button" data-row-key="${escapeAttr(timelineRowKey(row))}" style="--dot-color:${escapeAttr(color)};--file-index:${Math.min(index, 12)}">
          <span class="immersive-file-number">${String(index + 1).padStart(2,'0')}</span>
          <span class="immersive-file-icon"></span>
          <span class="immersive-file-main">
            <strong>${escapeHtml(row.getAttribute('data-title') || 'untitled')}</strong>
            <span class="immersive-file-sub">${escapeHtml(sub)} / ${escapeHtml(type)} / ${escapeHtml(ver)}</span>
          </span>
          <span class="immersive-file-actions">
            <span class="immersive-file-time">${escapeHtml(timelineDisplayTimeForRow(row) || String(index + 1).padStart(2, '0'))}</span>
            <span class="immersive-info" data-row-key="${escapeAttr(timelineRowKey(row))}">info</span>
          </span>
        </button>`;
      }).join('');
      var dayColor = rows[0]?.getAttribute('data-mood-color') || moodColorFor(rows[0]?.getAttribute('data-mood') || 'raw');
      return `<section class="immersive-day" data-immersive-day="${escapeAttr(day)}" style="--day-index:${dayIndex};--dot-color:${escapeAttr(dayColor)}">
        <div class="immersive-day-label"><small>${timelineScaleLabel()} ${String(dayIndex + 1).padStart(2,'0')}</small><strong>${timelineLabelForKey(day)}</strong><span>${rows.length} indexed${moods.length ? ` / ${escapeHtml(moods.join(' + '))}` : ''}</span></div>
        <div class="immersive-files">${files}</div>
      </section>`;
    }).join('');
    track.innerHTML = `<div class="immersive-timeline-list">${body}</div><div class="immersive-rail"><div class="immersive-rail-anchors">${rails}</div><button class="immersive-rail-current" type="button" data-rail-day="${escapeAttr(days[0])}" onclick="jumpToTimelineDay(this.getAttribute('data-rail-day'))"><span>current</span><strong>${timelineLabelForKey(days[0])}</strong></button></div>`;
    alignImmersiveRail();
    updateImmersiveTimelineFocus();
    window.setTimeout(function(){ alignImmersiveRail(); updateImmersiveTimelineFocus(); }, 120);
  }

  function cacheImmersiveTimelineLayout() {
    var track = document.getElementById('timelineTrack');
    if(!track || timelineMode !== 'immersive') {
      immersiveTimelineMetrics = [];
      return immersiveTimelineMetrics;
    }
    var trackRect = track.getBoundingClientRect();
    immersiveTimelineMetrics = Array.from(track.querySelectorAll('.immersive-day')).map(section => {
      var rect = section.getBoundingClientRect();
      var top = rect.top - trackRect.top + track.scrollTop;
      return {
        section,
        day: section.getAttribute('data-immersive-day'),
        top,
        focus: top + Math.min(rect.height * .24, 150)
      };
    });
    return immersiveTimelineMetrics;
  }

  function alignImmersiveRail() {
    var track = document.getElementById('timelineTrack');
    if(!track || timelineMode !== 'immersive') return;
    var rail = track.querySelector('.immersive-rail');
    if(!rail) return;
    var railRect = rail.getBoundingClientRect();
    var usableRail = Math.max(1, railRect.height - 40);
    var metrics = cacheImmersiveTimelineLayout();
    var metricsByDay = new Map(metrics.map(metric => [metric.day, metric]));
    var firstTop = metrics[0]?.top || 0;
    var lastTop = metrics[metrics.length - 1]?.top || firstTop + 1;
    var contentRange = Math.max(1,lastTop - firstTop);
    rail.querySelectorAll('.immersive-rail-mark').forEach(mark => {
      var day = mark.getAttribute('data-rail-day');
      var metric = metricsByDay.get(day);
      if(!metric) return;
      var ratio = Math.max(0, Math.min(1, (metric.top - firstTop) / contentRange));
      mark.style.top = (20 + ratio * usableRail) + 'px';
    });
  }

  function jumpToTimelineDay(day) {
    var track = document.getElementById('timelineTrack');
    if(!track) return;
    if(!immersiveTimelineMetrics.length) cacheImmersiveTimelineLayout();
    var metric = immersiveTimelineMetrics.find(item => item.day === day);
    if(!metric) return;
    var top = Math.max(0, metric.top - track.clientHeight * .12);
    track.scrollTo({ top, behavior:archiveSettings?.motion === 'off' ? 'auto' : 'smooth' });
  }

  function scheduleImmersiveTimelineFocus() {
    if(timelineScrollFrame) return;
    timelineScrollFrame = window.requestAnimationFrame(function(){
      timelineScrollFrame = 0;
      updateImmersiveTimelineFocus();
    });
  }

  function updateImmersiveTimelineFocus() {
    var track = document.getElementById('timelineTrack');
    if(!track || timelineMode !== 'immersive') return;
    if(!immersiveTimelineMetrics.length) cacheImmersiveTimelineLayout();
    if(!immersiveTimelineMetrics.length) return;
    var focusY = track.scrollTop + track.clientHeight * .38;
    var currentMetric = immersiveTimelineMetrics.reduce((closest, metric) => {
      var distance = Math.abs(metric.focus - focusY);
      return !closest || distance < closest.distance ? { metric, distance } : closest;
    }, null)?.metric;
    var current = currentMetric?.section || null;
    if(current !== currentImmersiveSection) {
      currentImmersiveSection?.classList.remove('is-current');
      current?.classList.add('is-current');
      currentImmersiveSection = current;
      currentImmersiveRailMark?.classList.remove('is-current');
      currentImmersiveRailMark = currentMetric ? track.querySelector(`[data-rail-day="${cssEscape(currentMetric.day)}"]`) : null;
      currentImmersiveRailMark?.classList.add('is-current');
    }
    var range = Math.max(1, track.scrollHeight - track.clientHeight);
    var rail = track.querySelector('.immersive-rail');
    var currentRail = rail?.querySelector('.immersive-rail-current');
    if(currentMetric && currentRail && rail) {
      var railRect = rail.getBoundingClientRect();
      var usableRail = Math.max(1,railRect.height - 40);
      var firstTop = immersiveTimelineMetrics[0]?.top || 0;
      var lastTop = immersiveTimelineMetrics[immersiveTimelineMetrics.length - 1]?.top || firstTop + 1;
      var markerRatio = Math.max(0,Math.min(1,(currentMetric.top - firstTop) / Math.max(1,lastTop - firstTop)));
      currentRail.style.top = (20 + markerRatio * usableRail) + 'px';
      currentRail.setAttribute('data-rail-day',currentMetric.day);
      var currentDate = currentRail.querySelector('strong');
      if(currentDate) currentDate.textContent = timelineLabelForKey(currentMetric.day);
    }
    track.style.setProperty('--timeline-progress', Math.max(0, Math.min(1, track.scrollTop / range)));
  }

  function timelineRowKey(row) {
    return row.getAttribute('data-id') || row.getAttribute('data-name') || row.getAttribute('data-title') || '';
  }

  function toggleTimelineDay(day) {
    activeTimelineDate = activeTimelineDate === day ? null : day;
    document.querySelectorAll('.timeline-node').forEach(node => {
      var isActive = node.dataset.timelineDay === activeTimelineDate;
      node.classList.toggle('active', isActive);
      node.style.height = '';
      var expand = node.querySelector('.timeline-expand');
      if(expand) expand.textContent = isActive ? 'collapse' : 'expand';
    });
    window.requestAnimationFrame(syncTimelineCardHeights);
  }

  function triggerSort(key) {
    if(explorerSortKey === key) {
      explorerSortDirection *= -1;
    } else {
      explorerSortKey = key;
      explorerSortDirection = key === 'date' ? -1 : 1;
    }
    sortExplorerRows();
    updateSortIndicators();
    buildQueue();
    renderQueueList();
  }

  function sortExplorerRows() {
    if(!explorerSortKey) return;
    var lists = Array.from(document.querySelectorAll('[data-batch-target], [data-root-target]'));
    var smartList = document.getElementById('smartFilterList');
    if(smartList) lists.push(smartList);
    lists.forEach(list => {
      var rows = Array.from(list.children).filter(child => child.classList && child.classList.contains('frow'));
      rows.sort((a, b) => {
        var aValue = explorerSortValue(a, explorerSortKey);
        var bValue = explorerSortValue(b, explorerSortKey);
        var result = aValue.localeCompare(bValue, undefined, { numeric: true, sensitivity: 'base' });
        if(result === 0) result = (a.getAttribute('data-title') || '').localeCompare(b.getAttribute('data-title') || '', undefined, { numeric: true, sensitivity: 'base' });
        return result * explorerSortDirection;
      });
      rows.forEach(row => list.appendChild(row));
    });
  }

  function explorerSortValue(row, key) {
    if(key === 'title') return row.getAttribute('data-title') || row.getAttribute('data-name') || '';
    if(key === 'date') return row.getAttribute('data-date') || '';
    if(key === 'ver') return row.getAttribute('data-ver') || '';
    if(key === 'mood') return row.getAttribute('data-mood') || '';
    return '';
  }

  function updateSortIndicators() {
    document.querySelectorAll('.sort-trigger[data-sort]').forEach(button => {
      var active = button.getAttribute('data-sort') === explorerSortKey;
      button.classList.toggle('active', active);
      button.classList.toggle('asc', active && explorerSortDirection === 1);
      button.classList.toggle('desc', active && explorerSortDirection === -1);
      button.setAttribute('aria-label', `sort by ${button.getAttribute('data-sort')}${active ? (explorerSortDirection === 1 ? ', ascending' : ', descending') : ''}`);
    });
  }

  function syncTimelineCardHeights() {
    document.querySelectorAll('.timeline-node').forEach(node => {
      node.style.height = '';
      if(!node.classList.contains('active')) return;
      var requiredHeight = Math.ceil(node.scrollHeight + 22);
      node.style.height = requiredHeight + 'px';
    });
  }

  function openTimelineAsset(key) {
    var row = baseRows().find(item => timelineRowKey(item) === key);
    if(!row) return;
    viewerOrigin = 'timeline';
    handleRowClick({ target: row, fromTimeline: true }, row);
    if(row.getAttribute('data-type') === 'audio') {
      document.getElementById('fsPlayer').classList.add('active');
      setAppSection('now playing');
      resizeCanvas();
    }
    syncViewerExitControl();
  }

  function openTimelineInfo(key) {
    var row = baseRows().find(item => timelineRowKey(item) === key);
    if(row) showProperties(row);
  }
