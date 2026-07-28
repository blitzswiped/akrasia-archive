  // ---- CATALOG ENRICHMENT -------------------------------------------------
  var archiveEnrichment = {
    ready:false, loading:false, schemaMissing:false, error:'', refreshError:'', waiters:[],
    suggestions:[], tags:[], aliases:[], assetTags:[], metadata:[], eras:[], assetEras:[],
    suggestionsByAsset:new Map(), suggestionsById:new Map(), tagsById:new Map(), assetTagsByAsset:new Map(),
    aliasesByTag:new Map(), metadataByAsset:new Map(), erasById:new Map(), assetErasByAsset:new Map()
  };
  var enrichmentWorkspaceTab = 'review';
  var enrichmentReviewStatus = 'pending';
  var enrichmentReviewKind = 'all';
  var enrichmentReviewSignal = 'all';
  var enrichmentReviewConfidence = 0;
  var enrichmentSelectedSuggestionId = '';
  var enrichmentBulkSelection = new Set();
  var enrichmentEditorDraft = '';
  var enrichmentEditorDraftInitializedFor = '';
  var enrichmentReviewLimit = 80;
  var enrichmentRowsByAsset = new Map();
  var enrichmentPayloadPromises = new Map();
  var enrichmentDraftSaveTimer = 0;
  var enrichmentEraGuesses = [];
  var enrichmentFocusedLineIndex = -1;
  var enrichmentLineBreakUndoDraft = '';
  var enrichmentLineBreakUndoSuggestionId = '';
  var ENRICHMENT_REVIEW_STATE_KEY = 'akrasia-enrichment-review-state-v2';
  var ENRICHMENT_DRAFTS_KEY = 'akrasia-enrichment-local-drafts-v1';
  var ENRICHMENT_SUGGESTION_SUMMARY_COLUMNS = 'id,asset_id,kind,confidence,evidence,model_name,model_version,source_revision_id,source_sha256,cache_key,status,review_note,reviewed_at,reviewed_by,created_at,updated_at';
  var ENRICHMENT_TAG_CATEGORIES = ['mood','vibe','genre','subgenre','lyrical-theme','production-style','vocal-style','instrumentation','listening-situation','time-of-day','weather-season','energy','narrative-tone','completion-state','release-state'];

  function emptyArchiveEnrichment() {
    archiveEnrichment.ready = false;
    archiveEnrichment.suggestions = [];
    archiveEnrichment.tags = [];
    archiveEnrichment.aliases = [];
    archiveEnrichment.assetTags = [];
    archiveEnrichment.metadata = [];
    archiveEnrichment.eras = [];
    archiveEnrichment.assetEras = [];
    archiveEnrichment.suggestionsByAsset = new Map();
    archiveEnrichment.suggestionsById = new Map();
    archiveEnrichment.tagsById = new Map();
    archiveEnrichment.assetTagsByAsset = new Map();
    archiveEnrichment.aliasesByTag = new Map();
    archiveEnrichment.metadataByAsset = new Map();
    archiveEnrichment.erasById = new Map();
    archiveEnrichment.assetErasByAsset = new Map();
  }

  function readEnrichmentLocalDrafts() {
    try {
      var value = JSON.parse(localStorage.getItem(ENRICHMENT_DRAFTS_KEY) || '{}');
      return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    } catch(error) {
      return {};
    }
  }

  function enrichmentLocalDraft(id) {
    var entry = readEnrichmentLocalDrafts()[id];
    return entry && typeof entry.text === 'string' ? cleanSyncedLyrics(entry.text) : null;
  }

  function saveEnrichmentLocalDraft(id,text) {
    if(!id) return;
    var drafts = readEnrichmentLocalDrafts();
    drafts[id] = { text:cleanSyncedLyrics(text),updatedAt:Date.now() };
    var trimmed = Object.entries(drafts)
      .sort((a,b) => Number(b[1]?.updatedAt || 0) - Number(a[1]?.updatedAt || 0))
      .slice(0,12);
    try { localStorage.setItem(ENRICHMENT_DRAFTS_KEY,JSON.stringify(Object.fromEntries(trimmed))); } catch(error) {}
  }

  function removeEnrichmentLocalDraft(id) {
    if(!id) return;
    var drafts = readEnrichmentLocalDrafts();
    if(!Object.prototype.hasOwnProperty.call(drafts,id)) return;
    delete drafts[id];
    try { localStorage.setItem(ENRICHMENT_DRAFTS_KEY,JSON.stringify(drafts)); } catch(error) {}
  }

  function persistEnrichmentReviewState() {
    var state = {
      tab:enrichmentWorkspaceTab,status:enrichmentReviewStatus,kind:enrichmentReviewKind,
      signal:enrichmentReviewSignal,confidence:enrichmentReviewConfidence,
      selectedId:enrichmentSelectedSuggestionId,limit:enrichmentReviewLimit
    };
    try { localStorage.setItem(ENRICHMENT_REVIEW_STATE_KEY,JSON.stringify(state)); } catch(error) {}
  }

  function restoreEnrichmentReviewState() {
    try {
      var state = JSON.parse(localStorage.getItem(ENRICHMENT_REVIEW_STATE_KEY) || '{}');
      if(['review','eras','tags'].includes(state.tab)) enrichmentWorkspaceTab = state.tab;
      if(['pending','draft','needs_review','stale','rejected','accepted','all'].includes(state.status)) enrichmentReviewStatus = state.status;
      if(['all','lyrics','tags','audio_metadata','era'].includes(state.kind)) enrichmentReviewKind = state.kind;
      if(['all','unsure','missing-cover','failed','ready'].includes(state.signal)) enrichmentReviewSignal = state.signal;
      enrichmentReviewConfidence = Math.max(0,Math.min(1,Number(state.confidence) || 0));
      enrichmentSelectedSuggestionId = cleanSingleLine(state.selectedId,80);
      enrichmentReviewLimit = Math.max(80,Math.min(2000,Number(state.limit) || 80));
    } catch(error) {}
  }

  function scheduleEnrichmentDraftCapture() {
    window.clearTimeout(enrichmentDraftSaveTimer);
    enrichmentDraftSaveTimer = window.setTimeout(function(){
      if(!enrichmentSelectedSuggestionId) return;
      enrichmentEditorDraft = cleanSyncedLyrics(collectEnrichmentLyricsEditor());
      saveEnrichmentLocalDraft(enrichmentSelectedSuggestionId,enrichmentEditorDraft);
    },420);
  }

  function flushEnrichmentDraftCapture() {
    window.clearTimeout(enrichmentDraftSaveTimer);
    if(!enrichmentSelectedSuggestionId || !document.querySelector('[data-enrichment-lyric-row]')) return;
    enrichmentEditorDraft = cleanSyncedLyrics(collectEnrichmentLyricsEditor());
    enrichmentEditorDraftInitializedFor = enrichmentSelectedSuggestionId;
    saveEnrichmentLocalDraft(enrichmentSelectedSuggestionId,enrichmentEditorDraft);
  }

  function captureEnrichmentRawDraft(value) {
    enrichmentEditorDraft = String(value == null ? '' : value);
    window.clearTimeout(enrichmentDraftSaveTimer);
    enrichmentDraftSaveTimer = window.setTimeout(function(){
      if(enrichmentSelectedSuggestionId) saveEnrichmentLocalDraft(enrichmentSelectedSuggestionId,enrichmentEditorDraft);
    },420);
  }

  function groupEnrichmentBy(list, key) {
    var map = new Map();
    (list || []).forEach(item => {
      var value = item && item[key];
      if(!value) return;
      if(!map.has(value)) map.set(value,[]);
      map.get(value).push(item);
    });
    return map;
  }

  function enrichmentErrorIsMissingSchema(error) {
    return /does not exist|schema cache|relation .* not found|could not find the table/i.test(error && error.message || '');
  }

  function enrichmentErrorIsBrokenNullSanitizer(error) {
    return /null character not permitted/i.test(error && error.message || '');
  }

  async function hydrateEraSignedCovers(eras) {
    if(!supabaseClient || !Array.isArray(eras)) return;
    var paths = Array.from(new Set(eras.map(era => era.cover_storage_path).filter(Boolean)));
    if(!paths.length) return;
    var result = await supabaseClient.storage.from(STORAGE_BUCKET).createSignedUrls(paths,21600);
    if(result.error || !Array.isArray(result.data)) return;
    var signed = new Map(result.data.filter(item => item && item.path && item.signedUrl).map(item => [item.path,item.signedUrl]));
    eras.forEach(era => {
      if(era.cover_storage_path && signed.has(era.cover_storage_path)) era.resolved_cover_url = signed.get(era.cover_storage_path);
      else era.resolved_cover_url = safeExternalUrl(era.cover_url || '');
    });
  }

  async function loadArchiveEnrichmentData(options) {
    options = options || {};
    if(!supabaseClient) return archiveEnrichment;
    if(archiveEnrichment.ready && !options.force) {
      hydrateArchiveEnrichmentRows();
      return archiveEnrichment;
    }
    if(archiveEnrichment.loading) {
      await new Promise(resolve => archiveEnrichment.waiters.push(resolve));
      hydrateArchiveEnrichmentRows();
      return archiveEnrichment;
    }
    var hadReadyData = archiveEnrichment.ready;
    var cachedSuggestions = archiveEnrichment.suggestionsById;
    archiveEnrichment.loading = true;
    archiveEnrichment.error = '';
    archiveEnrichment.refreshError = '';
    try {
      var names = ['tags','aliases','assetTags','metadata','eras','assetEras'];
      var requests = [
        supabaseClient.from('archive_tags').select('*').order('category').order('name').limit(3000),
        supabaseClient.from('archive_tag_aliases').select('*').limit(5000),
        supabaseClient.from('archive_asset_tags').select('*').limit(10000),
        supabaseClient.from('archive_audio_metadata').select('*').limit(5000),
        supabaseClient.from('archive_eras').select('*').order('display_order').order('name').limit(500),
        supabaseClient.from('archive_asset_eras').select('*').limit(10000)
      ];
      if(isAdmin) {
        names.push('suggestions');
        requests.push(supabaseClient.from('archive_enrichment_suggestions').select(ENRICHMENT_SUGGESTION_SUMMARY_COLUMNS).order('updated_at',{ ascending:false }).limit(5000));
      }
      var results = await Promise.all(requests);
      var firstError = results.find(result => result.error)?.error;
      if(firstError) {
        archiveEnrichment.schemaMissing = enrichmentErrorIsMissingSchema(firstError);
        var message = archiveEnrichment.schemaMissing ? 'Run the enrichment section in supabase-setup.sql.' : firstError.message;
        if(hadReadyData) archiveEnrichment.refreshError = message;
        else {
          archiveEnrichment.error = message;
          emptyArchiveEnrichment();
        }
        hydrateArchiveEnrichmentRows();
        return archiveEnrichment;
      }
      emptyArchiveEnrichment();
      names.forEach((name,index) => archiveEnrichment[name] = results[index].data || []);
      archiveEnrichment.suggestions = archiveEnrichment.suggestions.map(summary => {
        var cached = cachedSuggestions.get(summary.id);
        if(cached?._payloadLoaded) return Object.assign({},summary,{ payload:cached.payload,_payloadLoaded:true });
        return Object.assign({},summary,{ payload:null,_payloadLoaded:false });
      });
      await hydrateEraSignedCovers(archiveEnrichment.eras);
      archiveEnrichment.tagsById = new Map(archiveEnrichment.tags.map(tag => [tag.id,tag]));
      archiveEnrichment.aliasesByTag = groupEnrichmentBy(archiveEnrichment.aliases,'tag_id');
      archiveEnrichment.assetTagsByAsset = groupEnrichmentBy(archiveEnrichment.assetTags,'asset_id');
      archiveEnrichment.metadataByAsset = new Map(archiveEnrichment.metadata.map(item => [item.asset_id,item]));
      archiveEnrichment.erasById = new Map(archiveEnrichment.eras.map(era => [era.id,era]));
      archiveEnrichment.assetErasByAsset = groupEnrichmentBy(archiveEnrichment.assetEras,'asset_id');
      archiveEnrichment.suggestionsByAsset = groupEnrichmentBy(archiveEnrichment.suggestions,'asset_id');
      archiveEnrichment.suggestionsById = new Map(archiveEnrichment.suggestions.map(item => [item.id,item]));
      archiveEnrichment.ready = true;
      archiveEnrichment.schemaMissing = false;
      hydrateArchiveEnrichmentRows();
      timelineNeedsBuild = true;
      return archiveEnrichment;
    } catch(error) {
      var message = cleanSingleLine(error.message || 'enrichment load failed',240);
      archiveEnrichment.schemaMissing = enrichmentErrorIsMissingSchema(error);
      if(hadReadyData) archiveEnrichment.refreshError = message;
      else {
        archiveEnrichment.error = message;
        emptyArchiveEnrichment();
      }
      hydrateArchiveEnrichmentRows();
      return archiveEnrichment;
    } finally {
      archiveEnrichment.loading = false;
      archiveEnrichment.waiters.splice(0).forEach(resolve => resolve());
      if(adminWorkspaceMode === 'enrichment' && adminWorkspaceIsOpen()) renderAdminWorkspace();
      if(document.getElementById('worldsViewport')?.classList.contains('active') && ['worlds','eras'].includes(worldsCurrentView)) renderWorldsView(worldsCurrentView);
    }
  }

  async function ensureEnrichmentSuggestionPayload(id) {
    var suggestion = enrichmentSuggestionById(id);
    if(!suggestion || suggestion._payloadLoaded) return suggestion;
    if(enrichmentPayloadPromises.has(id)) return enrichmentPayloadPromises.get(id);
    var promise = (async function(){
      suggestion._payloadLoading = true;
      suggestion._payloadError = '';
      var result = await supabaseClient.from('archive_enrichment_suggestions').select('*').eq('id',id).single();
      suggestion._payloadLoading = false;
      if(result.error) {
        suggestion._payloadError = cleanSingleLine(result.error.message || 'private suggestion could not be loaded',240);
        throw result.error;
      }
      Object.assign(suggestion,result.data || {},{ _payloadLoaded:true,_payloadLoading:false,_payloadError:'' });
      return suggestion;
    })().finally(() => enrichmentPayloadPromises.delete(id));
    enrichmentPayloadPromises.set(id,promise);
    return promise;
  }

  async function ensureEnrichmentSuggestionPayloads(items) {
    var missing = (items || []).filter(item => item && !item._payloadLoaded).map(item => item.id);
    for(var offset=0; offset<missing.length; offset+=100) {
      var result = await supabaseClient.from('archive_enrichment_suggestions').select('*').in('id',missing.slice(offset,offset+100));
      if(result.error) throw result.error;
      (result.data || []).forEach(value => {
        var suggestion = enrichmentSuggestionById(value.id);
        if(suggestion) Object.assign(suggestion,value,{ _payloadLoaded:true,_payloadLoading:false,_payloadError:'' });
      });
    }
    return items;
  }

  function acceptedTagsForRow(row) {
    var id = row && row.getAttribute('data-id');
    return (archiveEnrichment.assetTagsByAsset.get(id) || []).map(relation => {
      var tag = archiveEnrichment.tagsById.get(relation.tag_id);
      return tag ? Object.assign({},tag,{ relation }) : null;
    }).filter(Boolean);
  }

  function acceptedAudioMetadataForRow(row) {
    return archiveEnrichment.metadataByAsset.get(row && row.getAttribute('data-id')) || null;
  }

  function acceptedErasForRow(row) {
    var id = row && row.getAttribute('data-id');
    return (archiveEnrichment.assetErasByAsset.get(id) || []).filter(relation => relation.review_status === 'confirmed').map(relation => {
      var era = archiveEnrichment.erasById.get(relation.era_id);
      return era ? Object.assign({},era,{ relation }) : null;
    }).filter(Boolean).sort((a,b) => Number(a.display_order || 0) - Number(b.display_order || 0));
  }

  function analysisStatusForRow(row) {
    var suggestions = archiveEnrichment.suggestionsByAsset.get(row && row.getAttribute('data-id')) || [];
    var priority = ['needs_review','pending','draft','stale','rejected','accepted'];
    var found = priority.find(status => suggestions.some(item => item.status === status));
    if(found) return found;
    if(acceptedTagsForRow(row).length || acceptedAudioMetadataForRow(row) || acceptedErasForRow(row).length) return 'accepted';
    return 'none';
  }

  function lyricsReviewStatusForRow(row) {
    var suggestions = (archiveEnrichment.suggestionsByAsset.get(row && row.getAttribute('data-id')) || []).filter(item => item.kind === 'lyrics');
    return ['needs_review','pending','draft','stale','rejected','accepted'].find(status => suggestions.some(item => item.status === status)) || (row?.getAttribute('data-lyrics') ? 'accepted' : 'none');
  }

  function hydrateArchiveEnrichmentRows() {
    var rows = baseRows();
    enrichmentRowsByAsset = new Map(rows.map(row => [row.getAttribute('data-id'),row]).filter(entry => entry[0]));
    rows.forEach(row => {
      var tags = acceptedTagsForRow(row);
      var metadata = acceptedAudioMetadataForRow(row);
      var eras = acceptedErasForRow(row);
      row.setAttribute('data-tags',tags.slice(0,80).flatMap(tag => {
        var aliases = (archiveEnrichment.aliasesByTag.get(tag.id) || []).slice(0,8).map(item => item.alias_slug || item.alias);
        return [`${tag.category}:${tag.slug}`,tag.slug].concat(aliases);
      }).join(' ').slice(0,1200));
      row.setAttribute('data-bpm',metadata?.estimated_bpm == null ? '' : String(Number(metadata.estimated_bpm)));
      row.setAttribute('data-musical-key',cleanSingleLine(metadata?.estimated_musical_key || '',40));
      row.setAttribute('data-era-ids',eras.map(era => era.id).join(',').slice(0,1000));
      row.setAttribute('data-era-names',eras.map(era => era.name).join(' ').slice(0,1000));
      row.setAttribute('data-analysis-status',analysisStatusForRow(row));
      row.setAttribute('data-lyrics-review',lyricsReviewStatusForRow(row));
      archiveSearchIndex.delete(row);
    });
  }

  function enrichmentTagValues(row, category) {
    return acceptedTagsForRow(row).filter(tag => !category || tag.category === category).map(tag => tag.slug);
  }

  function enrichmentTagMatches(tag, value) {
    var needle = String(value || '').toLowerCase();
    if(tag.slug.includes(needle) || tag.name.toLowerCase().includes(needle)) return true;
    return (archiveEnrichment.aliasesByTag.get(tag.id) || []).some(item =>
      String(item.alias_slug || item.alias || '').toLowerCase().includes(needle)
    );
  }

  function enrichmentBpmMatches(value, query) {
    var bpm = Number(value);
    if(!Number.isFinite(bpm)) return false;
    var range = String(query || '').match(/^(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)$/);
    if(range) return bpm >= Number(range[1]) && bpm <= Number(range[2]);
    var comparison = String(query || '').match(/^(>=|<=|>|<)(\d+(?:\.\d+)?)$/);
    if(comparison) return ({ '>':bpm > Number(comparison[2]), '<':bpm < Number(comparison[2]), '>=':bpm >= Number(comparison[2]), '<=':bpm <= Number(comparison[2]) })[comparison[1]];
    var exact = Number(query);
    return Number.isFinite(exact) && Math.abs(bpm - exact) <= 1;
  }

  function archiveStructuredSearchParts(query) {
    var filters = [];
    var terms = [];
    var value = cleanSingleLine(query,240).toLowerCase();
    var months = { january:'01',jan:'01',february:'02',feb:'02',march:'03',mar:'03',april:'04',apr:'04',may:'05',june:'06',jun:'06',july:'07',jul:'07',august:'08',aug:'08',september:'09',sep:'09',sept:'09',october:'10',oct:'10',november:'11',nov:'11',december:'12',dec:'12' };
    value = value
      .replace(/\blyrics\s+(?:unsure|uncertain|review)\b/g,'lyrics:unsure')
      .replace(/\bmissing\s+cover\b/g,'missing:cover')
      .replace(/\bworked\s+on\s+([a-z]+)\s+(\d{1,2})(?:[ ,]+(\d{4}))?/g,(match,month,day,year) => months[month] ? `date:${year ? `${year}-` : ''}${months[month]}-${String(day).padStart(2,'0')}` : match);
    value.split(/\s+/).filter(Boolean).forEach(token => {
      var match = token.match(/^(tag|genre|theme|bpm|key|era|analysis|lyrics|type|folder|date|version|missing):(.*)$/);
      if(match && match[2]) filters.push({ key:match[1], value:match[2] });
      else terms.push(token);
    });
    return { filters,terms };
  }

  function archiveRowMatchesStructuredSearch(row, query) {
    var parts = archiveStructuredSearchParts(query);
    var tags = acceptedTagsForRow(row);
    var matchesFilters = parts.filters.every(filter => {
      if(filter.key === 'tag') return tags.some(tag => enrichmentTagMatches(tag,filter.value));
      if(filter.key === 'genre') return tags.some(tag => ['genre','subgenre'].includes(tag.category) && enrichmentTagMatches(tag,filter.value));
      if(filter.key === 'theme') return tags.some(tag => tag.category === 'lyrical-theme' && enrichmentTagMatches(tag,filter.value));
      if(filter.key === 'bpm') return enrichmentBpmMatches(row.getAttribute('data-bpm'),filter.value);
      if(filter.key === 'key') return String(row.getAttribute('data-musical-key') || '').toLowerCase().replace(/\s+/g,'-').includes(filter.value.replace(/\s+/g,'-'));
      if(filter.key === 'era') return String(row.getAttribute('data-era-names') || '').toLowerCase().includes(filter.value.replace(/-/g,' ')) || acceptedErasForRow(row).some(era => era.slug.includes(filter.value));
      if(filter.key === 'analysis') return String(row.getAttribute('data-analysis-status') || 'none') === filter.value;
      if(filter.key === 'lyrics') {
        var status = String(row.getAttribute('data-lyrics-review') || 'none');
        return filter.value === 'unsure' ? ['pending','draft','needs_review','stale','review'].includes(status) : status === filter.value;
      }
      if(filter.key === 'type') return String(row.getAttribute('data-type') || '').toLowerCase() === filter.value;
      if(filter.key === 'folder') return normalizeFolderPath(row.getAttribute('data-sub')).includes(normalizeFolderPath(filter.value.replace(/-/g,' ')));
      if(filter.key === 'date') return String(row.getAttribute('data-asset-date') || '').endsWith(filter.value);
      if(filter.key === 'version') return normalizeVersionLabel(row.getAttribute('data-ver'),'v1') === normalizeVersionLabel(filter.value,'v1');
      if(filter.key === 'missing') {
        if(filter.value === 'cover') return !String(row.getAttribute('data-cover') || row.getAttribute('data-cover-url') || '').trim();
        if(filter.value === 'lyrics') return !String(row.getAttribute('data-lyrics') || '').trim();
        if(filter.value === 'era') return !String(row.getAttribute('data-era-ids') || '').trim();
        if(filter.value === 'metadata') return !acceptedAudioMetadataForRow(row);
        return false;
      }
      return true;
    });
    return matchesFilters && parts.terms.every(term => archiveSearchText(row).includes(term));
  }

  function enrichmentMetadataHtml(row, compact) {
    var tags = acceptedTagsForRow(row);
    var metadata = acceptedAudioMetadataForRow(row);
    var eras = acceptedErasForRow(row);
    if(!tags.length && !metadata && !eras.length) return '';
    var tagHtml = tags.length ? `<div class="enrichment-chip-line">${tags.slice(0,compact ? 8 : 20).map(tag => `<span data-category="${escapeAttr(tag.category)}">${escapeHtml(tag.name)}</span>`).join('')}</div>` : '';
    var facts = [];
    if(metadata?.estimated_bpm != null) facts.push(`<span>bpm<strong>${escapeHtml(Number(metadata.estimated_bpm).toFixed(1))}${Number(metadata.bpm_confidence || 0) < .55 ? ' est.' : ''}</strong></span>`);
    if(metadata?.estimated_musical_key) facts.push(`<span>key<strong>${escapeHtml(metadata.estimated_musical_key)}${Number(metadata.key_confidence || 0) < .55 ? ' est.' : ''}</strong></span>`);
    if(metadata?.detected_language) facts.push(`<span>language<strong>${escapeHtml(metadata.detected_language)}</strong></span>`);
    if(metadata?.vocal_instrumental_status) facts.push(`<span>signal<strong>${escapeHtml(metadata.vocal_instrumental_status)}</strong></span>`);
    var eraHtml = eras.length ? `<div class="enrichment-era-line">${eras.map(era => `<span style="--era-color:${escapeAttr(era.accent_color || '#ffffff')}">${escapeHtml(era.name)}${era.relation.relationship === 'secondary' ? ' / secondary' : ''}</span>`).join('')}</div>` : '';
    return `<section class="accepted-enrichment${compact ? ' compact' : ''}"><div class="meta-section-title">accepted catalog signal</div>${eraHtml}${tagHtml}${facts.length ? `<div class="enrichment-facts">${facts.join('')}</div>` : ''}</section>`;
  }

  function enrichmentPropertyPairs(row) {
    var metadata = acceptedAudioMetadataForRow(row);
    var tags = acceptedTagsForRow(row);
    var eras = acceptedErasForRow(row);
    return [
      ['creative era',eras.map(era => era.name).join(', ') || 'unassigned'],
      ['tags',tags.map(tag => `${tag.category}: ${tag.name}`).join(', ') || 'none'],
      ['estimated bpm',metadata?.estimated_bpm == null ? 'unknown' : `${Number(metadata.estimated_bpm).toFixed(1)} / ${Math.round(Number(metadata.bpm_confidence || 0) * 100)}% confidence`],
      ['estimated key',metadata?.estimated_musical_key ? `${metadata.estimated_musical_key} / ${Math.round(Number(metadata.key_confidence || 0) * 100)}% confidence` : 'unknown'],
      ['duration',metadata?.duration_seconds == null ? 'unknown' : fmt(Number(metadata.duration_seconds))],
      ['loudness',metadata?.integrated_loudness_lufs == null ? 'unknown' : `${Number(metadata.integrated_loudness_lufs).toFixed(1)} LUFS`]
    ];
  }

  function worldEnrichmentSummary(group) {
    var rows = group?.audio || [];
    var chronological = rows.slice().sort((a,b) => String(a.getAttribute('data-date') || '').localeCompare(String(b.getAttribute('data-date') || '')));
    var tags = rows.flatMap(acceptedTagsForRow);
    var counts = new Map();
    tags.forEach(tag => counts.set(`${tag.category}:${tag.slug}`,{ tag,count:(counts.get(`${tag.category}:${tag.slug}`)?.count || 0) + 1 }));
    var common = Array.from(counts.values()).sort((a,b) => b.count - a.count).slice(0,8).map(item => item.tag);
    var bpms = rows.map(row => Number(acceptedAudioMetadataForRow(row)?.estimated_bpm)).filter(Number.isFinite);
    var themes = common.filter(tag => tag.category === 'lyrical-theme');
    var progression = categories => {
      var values = [];
      chronological.forEach(row => acceptedTagsForRow(row).filter(tag => categories.includes(tag.category)).forEach(tag => {
        if(values[values.length - 1] !== tag.name) values.push(tag.name);
      }));
      return values.slice(0,10);
    };
    var moods = progression(['mood','vibe']);
    var production = progression(['production-style']);
    var dates = rows.map(row => row.getAttribute('data-asset-date')).filter(Boolean).sort();
    return { common,bpms,themes,moods,production,earliest:dates[0] || '',latest:dates[dates.length - 1] || '' };
  }

  function worldEnrichmentSummaryHtml(group) {
    var summary = worldEnrichmentSummary(group);
    if(!summary.common.length && !summary.bpms.length) return '';
    var bpm = summary.bpms.length ? `${Math.min(...summary.bpms).toFixed(0)}${Math.max(...summary.bpms) !== Math.min(...summary.bpms) ? `-${Math.max(...summary.bpms).toFixed(0)}` : ''} estimated bpm` : 'tempo not accepted yet';
    return `<section class="world-section world-enrichment"><div class="world-section-head"><h3>accepted analysis</h3><span>derived across ${group.audio.length} revisions</span></div><div class="enrichment-chip-line">${summary.common.map(tag => `<span data-category="${escapeAttr(tag.category)}">${escapeHtml(tag.name)}</span>`).join('')}</div><div class="world-enrichment-range"><span>${escapeHtml(bpm)}</span><span>${escapeHtml(summary.earliest && summary.latest ? `${summary.earliest} to ${summary.latest}` : 'revision range incomplete')}</span><span>${escapeHtml(summary.themes.length ? `themes / ${summary.themes.map(tag => tag.name).join(' + ')}` : 'themes still open')}</span><span>${escapeHtml(summary.moods.length ? `mood movement / ${summary.moods.join(' to ')}` : 'mood movement still open')}</span><span>${escapeHtml(summary.production.length ? `production movement / ${summary.production.join(' to ')}` : 'production movement still open')}</span></div></section>`;
  }

  function enrichmentSuggestionById(id) {
    return archiveEnrichment.suggestionsById.get(id) || null;
  }

  function enrichmentRowForSuggestion(suggestion) {
    if(!suggestion) return null;
    var cached = enrichmentRowsByAsset.get(suggestion.asset_id);
    if(cached?.isConnected) return cached;
    var row = document.querySelector(`.file-row[data-id="${cssEscape(suggestion.asset_id)}"]`);
    if(row) enrichmentRowsByAsset.set(suggestion.asset_id,row);
    return row || null;
  }

  function enrichmentSuggestionConfidence(suggestion) {
    var value = Number(suggestion?.confidence);
    return Number.isFinite(value) ? Math.max(0,Math.min(1,value)) : 0;
  }

  function enrichmentSuggestionReason(suggestion) {
    var payload = suggestion?.payload || {};
    var evidence = suggestion?.evidence || {};
    if(Array.isArray(payload.warnings) && payload.warnings[0]) return payload.warnings[0];
    if(evidence.explanation) return evidence.explanation;
    if(suggestion.kind === 'lyrics') return suggestion._payloadLoaded ? `${Array.isArray(payload.segments) ? payload.segments.length : parseSyncedLyrics(payload.syncedText || '').length} timed vocal lines` : 'timed lyric draft / open to review';
    if(suggestion.kind === 'tags') return suggestion._payloadLoaded ? `${(payload.suggestions || []).length} controlled tag suggestions` : 'controlled tag suggestions / open to review';
    if(suggestion.kind === 'audio_metadata') return 'measured and estimated audio properties';
    if(suggestion.kind === 'era') return 'creative-era evidence awaiting an artist decision';
    return 'local analysis suggestion';
  }

  function enrichmentReviewItems() {
    return archiveEnrichment.suggestions.filter(item => {
      if(enrichmentReviewStatus !== 'all' && item.status !== enrichmentReviewStatus) return false;
      if(enrichmentReviewKind !== 'all' && item.kind !== enrichmentReviewKind) return false;
      if(enrichmentSuggestionConfidence(item) < enrichmentReviewConfidence) return false;
      if(!enrichmentSuggestionMatchesSignal(item,enrichmentReviewSignal)) return false;
      if(adminWorkspaceQuery) {
        var row = enrichmentRowForSuggestion(item);
        var text = [item.kind,item.status,item.model_name,item.model_version,enrichmentSuggestionReason(item),row && archiveSearchText(row)].filter(Boolean).join(' ').toLowerCase();
        if(!adminWorkspaceQuery.split(/\s+/).every(term => text.includes(term))) return false;
      }
      return true;
    });
  }

  function enrichmentSuggestionHasUncertainty(item) {
    if(item?.kind !== 'lyrics') return false;
    if(!item._payloadLoaded) return ['pending','draft','needs_review'].includes(item.status);
    var payload = item.payload || {};
    return /\[unclear\]/i.test(payload.syncedText || '') || (payload.segments || []).some(segment => segment?.unclear || Number(segment?.confidence) < .55 || (segment?.words || []).some(word => word?.unclear || Number(word?.probability) < .45));
  }

  function enrichmentSuggestionMatchesSignal(item,signal) {
    if(!signal || signal === 'all') return true;
    var row = enrichmentRowForSuggestion(item);
    if(signal === 'unsure') return enrichmentSuggestionHasUncertainty(item);
    if(signal === 'missing-cover') return Boolean(row && !String(row.getAttribute('data-cover') || row.getAttribute('data-cover-url') || '').trim());
    if(signal === 'failed') return item.status === 'stale' || /fail|error/i.test(String(item.payload?.analysisStatus || '')) || Boolean((item.evidence?.warnings || item.payload?.warnings || []).length);
    if(signal === 'ready') return ['pending','draft','needs_review'].includes(item.status) && ((item.kind === 'audio_metadata' && enrichmentSuggestionConfidence(item) >= .75) || (item.kind === 'tags' && enrichmentSuggestionConfidence(item) >= .65));
    return true;
  }

  function enrichmentWorkspaceTabsHtml() {
    return `<div class="enrichment-workspace-tabs" role="tablist" aria-label="catalog enrichment tools">
      <button class="${enrichmentWorkspaceTab === 'review' ? 'active' : ''}" type="button" onclick="setEnrichmentWorkspaceTab('review')">review queue<span>${archiveEnrichment.suggestions.filter(item => ['pending','draft','needs_review','stale'].includes(item.status)).length}</span></button>
      <button class="${enrichmentWorkspaceTab === 'eras' ? 'active' : ''}" type="button" onclick="setEnrichmentWorkspaceTab('eras')">creative eras<span>${archiveEnrichment.eras.length}</span></button>
      <button class="${enrichmentWorkspaceTab === 'tags' ? 'active' : ''}" type="button" onclick="setEnrichmentWorkspaceTab('tags')">tag library<span>${archiveEnrichment.tags.length}</span></button>
    </div>`;
  }

  function renderEnrichmentWorkspace() {
    var list = document.getElementById('adminWorkspaceList');
    var workspace = document.getElementById('adminFileWorkspace');
    if(!list || !workspace) return;
    workspace.classList.add('enrichment-mode');
    document.getElementById('adminWorkspaceTitle').textContent = enrichmentWorkspaceTab === 'review' ? 'enrichment review' : (enrichmentWorkspaceTab === 'eras' ? 'creative eras' : 'tag library');
    document.getElementById('adminWorkspaceKicker').textContent = 'private analysis / accepted metadata stays separate';
    document.getElementById('adminWorkspaceCount').textContent = archiveEnrichment.loading && !archiveEnrichment.ready ? 'loading' : (archiveEnrichment.error ? 'setup required' : `${archiveEnrichment.suggestions.length} suggestions / ${archiveEnrichment.metadata.length} accepted analyses${archiveEnrichment.loading ? ' / refreshing' : ''}`);
    document.getElementById('adminWorkspaceEmpty').hidden = true;
    document.getElementById('adminWorkspaceSelection').hidden = true;
    if(archiveEnrichment.loading && !archiveEnrichment.ready) {
      list.innerHTML = '<div class="enrichment-loading"><i></i><span>resolving private suggestions and accepted catalog metadata...</span></div>';
      return;
    }
    if(archiveEnrichment.error) {
      list.innerHTML = `${enrichmentWorkspaceTabsHtml()}<div class="enrichment-setup"><small>enrichment schema unavailable</small><h3>the archive is intact.</h3><p>${escapeHtml(archiveEnrichment.error)}</p><button type="button" onclick="loadArchiveEnrichmentData({ force:true }).then(renderAdminWorkspace)">check again</button></div>`;
      renderEnrichmentInspector();
      return;
    }
    if(enrichmentWorkspaceTab === 'eras') list.innerHTML = enrichmentWorkspaceTabsHtml() + enrichmentEraManagerHtml();
    else if(enrichmentWorkspaceTab === 'tags') list.innerHTML = enrichmentWorkspaceTabsHtml() + enrichmentTagManagerHtml();
    else list.innerHTML = enrichmentWorkspaceTabsHtml() + enrichmentReviewHtml();
    renderEnrichmentInspector();
    window.setTimeout(drawEnrichmentReviewWaveform,0);
  }

  function setEnrichmentWorkspaceTab(tab) {
    if(!['review','eras','tags'].includes(tab)) return;
    if(enrichmentSelectedSuggestionId && document.querySelector('[data-enrichment-lyric-row]')) {
      enrichmentEditorDraft = cleanSyncedLyrics(collectEnrichmentLyricsEditor());
      saveEnrichmentLocalDraft(enrichmentSelectedSuggestionId,enrichmentEditorDraft);
    }
    enrichmentWorkspaceTab = tab;
    enrichmentSelectedSuggestionId = '';
    enrichmentEditorDraftInitializedFor = '';
    enrichmentBulkSelection.clear();
    persistEnrichmentReviewState();
    renderAdminWorkspace();
  }

  function setEnrichmentReviewFilter(kind,value) {
    if(kind === 'status') enrichmentReviewStatus = value;
    if(kind === 'kind') enrichmentReviewKind = value;
    if(kind === 'confidence') enrichmentReviewConfidence = Math.max(0,Math.min(1,Number(value) || 0));
    if(kind === 'signal') enrichmentReviewSignal = ['all','unsure','missing-cover','failed','ready'].includes(value) ? value : 'all';
    enrichmentReviewLimit = 80;
    persistEnrichmentReviewState();
    renderAdminWorkspace();
  }

  function showMoreEnrichmentReviews() {
    enrichmentReviewLimit += 80;
    persistEnrichmentReviewState();
    renderAdminWorkspace();
  }

  function stepEnrichmentReview(direction) {
    var items = enrichmentReviewItems();
    if(!items.length) return;
    var current = items.findIndex(item => item.id === enrichmentSelectedSuggestionId);
    var next = current < 0 ? 0 : (current + direction + items.length) % items.length;
    selectEnrichmentSuggestion(items[next].id);
    window.setTimeout(() => document.querySelector(`.enrichment-review-item[data-suggestion-id="${cssEscape(items[next].id)}"]`)?.scrollIntoView({ behavior:'smooth',block:'center' }),0);
  }

  function handleEnrichmentReviewKeys(event) {
    if(!adminWorkspaceIsOpen() || adminWorkspaceMode !== 'enrichment' || enrichmentWorkspaceTab !== 'review') return;
    if(event.target?.matches('input,textarea,select,[contenteditable="true"]')) return;
    if(['j','ArrowDown'].includes(event.key)) { event.preventDefault(); stepEnrichmentReview(1); }
    else if(['k','ArrowUp'].includes(event.key)) { event.preventDefault(); stepEnrichmentReview(-1); }
    else if(event.key === ' ' && enrichmentSelectedSuggestionId) { event.preventDefault(); toggleEnrichmentBulk(event,enrichmentSelectedSuggestionId); }
  }

  function enrichmentReviewHtml() {
    var items = enrichmentReviewItems();
    var visibleItems = items.slice(0,enrichmentReviewLimit);
    var statuses = ['pending','draft','needs_review','stale','rejected','accepted','all'];
    var kinds = ['all','lyrics','tags','audio_metadata','era'];
    var signals = [['all','all'],['unsure','unsure lyrics'],['missing-cover','missing cover'],['failed','failed'],['ready','ready']];
    var signalBar = `<div class="enrichment-signal-bar"><span>show</span>${signals.map(signal => `<button class="${enrichmentReviewSignal === signal[0] ? 'active' : ''}" type="button" onclick="setEnrichmentReviewFilter('signal','${signal[0]}')">${signal[1]}</button>`).join('')}<em>J/K moves / space selects</em></div>`;
    var toolbar = `<div class="enrichment-review-toolbar">
      <label><span>status</span><select onchange="setEnrichmentReviewFilter('status',this.value)">${statuses.map(status => `<option value="${status}"${status === enrichmentReviewStatus ? ' selected' : ''}>${status.replace('_',' ')}</option>`).join('')}</select></label>
      <label><span>kind</span><select onchange="setEnrichmentReviewFilter('kind',this.value)">${kinds.map(kind => `<option value="${kind}"${kind === enrichmentReviewKind ? ' selected' : ''}>${kind.replace('_',' ')}</option>`).join('')}</select></label>
      <label class="enrichment-confidence"><span>confidence / ${Math.round(enrichmentReviewConfidence * 100)}%</span><input type="range" min="0" max="1" step=".05" value="${enrichmentReviewConfidence}" oninput="this.previousElementSibling.textContent='confidence / '+Math.round(this.value*100)+'%'" onchange="setEnrichmentReviewFilter('confidence',this.value)"></label>
      <button type="button" onclick="loadArchiveEnrichmentData({ force:true }).then(renderAdminWorkspace)">refresh</button>
    </div>`;
    var selected = Array.from(enrichmentBulkSelection).map(enrichmentSuggestionById).filter(Boolean);
    var bulk = `<div class="enrichment-bulk"${selected.length ? '' : ' hidden'}><strong>${selected.length} selected</strong><button type="button" onclick="bulkReviewEnrichment('rejected')">reject</button><button type="button" onclick="bulkReviewEnrichment('pending')">reopen</button><button type="button" onclick="bulkReviewEnrichment('needs_review')">manual review</button><button type="button" onclick="bulkAcceptSafeEnrichment()">accept safe metadata</button><button type="button" onclick="clearEnrichmentBulkSelection()">clear</button></div>`;
    var cards = visibleItems.map(item => {
      var row = enrichmentRowForSuggestion(item);
      var confidence = enrichmentSuggestionConfidence(item);
      var selectedItem = enrichmentSelectedSuggestionId === item.id;
      var checked = enrichmentBulkSelection.has(item.id);
      return `<article class="enrichment-review-item${selectedItem ? ' selected' : ''}" data-suggestion-id="${escapeAttr(item.id)}" data-status="${escapeAttr(item.status)}" data-kind="${escapeAttr(item.kind)}">
        <button class="enrichment-review-check${checked ? ' checked' : ''}" type="button" aria-label="select suggestion" aria-pressed="${checked}" onclick="toggleEnrichmentBulk(event,'${escapeAttr(item.id)}')"></button>
        <button class="enrichment-review-open" type="button" onclick="selectEnrichmentSuggestion('${escapeAttr(item.id)}')">
          <span class="enrichment-kind">${escapeHtml(item.kind.replace('_',' '))}</span>
          <span class="enrichment-review-copy"><strong>${escapeHtml(row?.getAttribute('data-title') || 'missing archive revision')}</strong><small>${escapeHtml(`${row?.getAttribute('data-sub') || 'archive'} / ${row?.getAttribute('data-ver') || item.source_revision_id || 'revision'} / ${row?.getAttribute('data-asset-date') || 'undated'}`)}</small><span>${escapeHtml(enrichmentSuggestionReason(item))}</span></span>
          <span class="enrichment-review-model">${escapeHtml(item.model_name || 'local analyzer')}<small>${escapeHtml(item.model_version || '')}</small></span>
          <span class="enrichment-confidence-meter" style="--confidence:${confidence}"><i></i><strong>${Math.round(confidence * 100)}%</strong></span>
          <span class="enrichment-review-status">${escapeHtml(item.status.replace('_',' '))}</span>
        </button>
      </article>`;
    }).join('');
    var empty = archiveEnrichment.suggestions.length
      ? '<div class="enrichment-empty">No suggestions match this review signal. Try another filter.</div>'
      : '<div class="enrichment-empty enrichment-import-empty"><strong>no private analysis has been imported yet.</strong><span>Choose the BandLab backup again. Akrasia will scan each <code>akrasia-analysis.json</code> sidecar and import finished lyrics, tags, and technical metadata into this review queue without publishing them.</span><button type="button" onclick="openAdminUploadTool(true)">scan BandLab + analysis</button></div>';
    var more = items.length > visibleItems.length ? `<button class="enrichment-load-more" type="button" onclick="showMoreEnrichmentReviews()">show 80 more <span>${visibleItems.length} / ${items.length}</span></button>` : '';
    return `${signalBar}${toolbar}${bulk}<div class="enrichment-review-list">${cards || empty}</div>${more}`;
  }

  async function selectEnrichmentSuggestion(id) {
    if(enrichmentSelectedSuggestionId && document.querySelector('[data-enrichment-lyric-row]')) {
      enrichmentEditorDraft = cleanSyncedLyrics(collectEnrichmentLyricsEditor());
      saveEnrichmentLocalDraft(enrichmentSelectedSuggestionId,enrichmentEditorDraft);
    }
    enrichmentSelectedSuggestionId = id;
    enrichmentFocusedLineIndex = -1;
    enrichmentLineBreakUndoDraft = '';
    enrichmentLineBreakUndoSuggestionId = '';
    var recoveredDraft = enrichmentLocalDraft(id);
    enrichmentEditorDraft = recoveredDraft === null ? '' : recoveredDraft;
    enrichmentEditorDraftInitializedFor = recoveredDraft === null ? '' : id;
    persistEnrichmentReviewState();
    renderAdminWorkspace();
    document.getElementById('adminFileWorkspace')?.classList.add('has-selection');
    try {
      var suggestion = await ensureEnrichmentSuggestionPayload(id);
      if(enrichmentSelectedSuggestionId !== id) return;
      if(enrichmentEditorDraftInitializedFor !== id && suggestion?.kind === 'lyrics') {
        enrichmentEditorDraft = initialEnrichmentLyricsDraft(suggestion);
        enrichmentEditorDraftInitializedFor = id;
      }
      renderAdminWorkspace();
      document.getElementById('adminFileWorkspace')?.classList.add('has-selection');
    } catch(error) {
      if(enrichmentSelectedSuggestionId === id) {
        renderEnrichmentInspector();
        showAppNotice(cleanSingleLine(error.message || 'Private suggestion could not be loaded.',240),'error');
      }
    }
  }

  function closeEnrichmentInspector() {
    if(enrichmentSelectedSuggestionId && document.querySelector('[data-enrichment-lyric-row]')) {
      enrichmentEditorDraft = cleanSyncedLyrics(collectEnrichmentLyricsEditor());
      saveEnrichmentLocalDraft(enrichmentSelectedSuggestionId,enrichmentEditorDraft);
    }
    enrichmentSelectedSuggestionId = '';
    enrichmentEditorDraft = '';
    enrichmentEditorDraftInitializedFor = '';
    enrichmentFocusedLineIndex = -1;
    enrichmentLineBreakUndoDraft = '';
    enrichmentLineBreakUndoSuggestionId = '';
    persistEnrichmentReviewState();
    document.getElementById('adminFileWorkspace')?.classList.remove('has-selection','enrichment-lyrics-open');
    renderAdminWorkspace();
  }

  function toggleEnrichmentBulk(event,id) {
    event?.preventDefault();
    event?.stopPropagation();
    if(enrichmentBulkSelection.has(id)) enrichmentBulkSelection.delete(id);
    else enrichmentBulkSelection.add(id);
    renderAdminWorkspace();
  }

  function clearEnrichmentBulkSelection() {
    enrichmentBulkSelection.clear();
    renderAdminWorkspace();
  }

  async function bulkReviewEnrichment(status) {
    if(!requireAdmin()) return;
    var ids = Array.from(enrichmentBulkSelection).slice(0,200);
    if(!ids.length || !['rejected','pending','needs_review'].includes(status)) return;
    var result = await supabaseClient.from('archive_enrichment_suggestions').update({ status,review_note:'bulk review' }).in('id',ids);
    if(result.error) return showAppNotice(result.error.message,'error');
    enrichmentBulkSelection.clear();
    await loadArchiveEnrichmentData({ force:true });
    renderAdminWorkspace();
  }

  async function bulkAcceptEnrichmentTags() {
    if(!requireAdmin()) return;
    var items = Array.from(enrichmentBulkSelection).map(enrichmentSuggestionById).filter(item => item && item.kind === 'tags' && ['pending','draft','needs_review'].includes(item.status) && enrichmentSuggestionConfidence(item) >= .65);
    if(!items.length) return showAppNotice('Select tag suggestions at 65% confidence or higher. Lyrics and eras always require direct review.','error');
    if(!confirm(`accept reviewed tags from ${items.length} suggestion(s)? no lyrics, eras, or moods will be auto-applied.`)) return;
    var failures = [];
    try { await ensureEnrichmentSuggestionPayloads(items); }
    catch(error) { return showAppNotice(cleanSingleLine(error.message || 'Could not load selected private suggestions.',240),'error'); }
    for(var item of items) {
      var tags = Array.isArray(item.payload?.suggestions) ? item.payload.suggestions.filter(tag => Number(tag.confidence || 0) >= .65) : [];
      var result = await supabaseClient.rpc('accept_archive_tags',{ p_suggestion_id:item.id,p_tags:tags,p_apply_mood:false,p_primary_mood:null });
      if(result.error) failures.push(result.error.message);
    }
    enrichmentBulkSelection.clear();
    await loadArchiveEnrichmentData({ force:true });
    renderAdminWorkspace();
    showAppNotice(failures.length ? `${items.length - failures.length} tag drafts accepted / ${failures.length} failed` : `${items.length} tag drafts accepted.`,failures.length ? 'error' : undefined);
  }

  async function bulkAcceptSafeEnrichment() {
    if(!requireAdmin()) return;
    var items = Array.from(enrichmentBulkSelection).map(enrichmentSuggestionById).filter(item => item && ['pending','draft','needs_review'].includes(item.status));
    var safe = items.filter(item => (item.kind === 'tags' && enrichmentSuggestionConfidence(item) >= .65) || (item.kind === 'audio_metadata' && enrichmentSuggestionConfidence(item) >= .75));
    if(!safe.length) return showAppNotice('Select high-confidence tags or technical metadata. Lyrics and eras always need direct review.','error');
    if(!confirm(`Accept safe metadata from ${safe.length} suggestion(s)? Lyrics, eras, and the old mood field will not change.`)) return;
    var failures = [];
    try { await ensureEnrichmentSuggestionPayloads(safe); }
    catch(error) { return showAppNotice(cleanSingleLine(error.message || 'Could not load selected private suggestions.',240),'error'); }
    for(var item of safe) {
      var result;
      if(item.kind === 'tags') {
        var tags = (item.payload?.suggestions || []).filter(tag => Number(tag.confidence || 0) >= .65);
        result = await supabaseClient.rpc('accept_archive_tags',{ p_suggestion_id:item.id,p_tags:tags,p_apply_mood:false,p_primary_mood:null });
      } else {
        result = await supabaseClient.rpc('accept_archive_audio_metadata',{ p_suggestion_id:item.id,p_values:item.payload || {} });
      }
      if(result.error) failures.push(result.error.message);
    }
    enrichmentBulkSelection.clear();
    await loadArchiveEnrichmentData({ force:true });
    renderAdminWorkspace();
    showAppNotice(failures.length ? `${safe.length - failures.length} accepted / ${failures.length} failed` : `${safe.length} safe metadata drafts accepted.`,failures.length ? 'error' : undefined);
  }

  function renderEnrichmentInspector() {
    var target = document.getElementById('adminWorkspaceInspector');
    var workspace = document.getElementById('adminFileWorkspace');
    if(!target) return;
    if(enrichmentWorkspaceTab !== 'review' || !enrichmentSelectedSuggestionId) {
      target.innerHTML = `<div class="admin-inspector-empty enrichment-inspector-empty"><span>${enrichmentWorkspaceTab === 'review' ? 'select a private suggestion' : enrichmentWorkspaceTab === 'eras' ? 'creative-era tools' : 'controlled vocabulary'}</span><p>${enrichmentWorkspaceTab === 'review' ? 'Drafts stay private until you edit and accept them.' : enrichmentWorkspaceTab === 'eras' ? 'Era edits and assignments happen in the main workspace.' : 'Create, merge, alias, and hide tags without fragmenting search.'}</p></div>`;
      workspace?.classList.remove('has-selection','enrichment-lyrics-open');
      document.body.classList.remove('enrichment-reviewing-lyrics');
      return;
    }
    var suggestion = enrichmentSuggestionById(enrichmentSelectedSuggestionId);
    if(!suggestion) return closeEnrichmentInspector();
    workspace?.classList.add('has-selection');
    workspace?.classList.toggle('enrichment-lyrics-open',suggestion.kind === 'lyrics');
    document.body.classList.toggle('enrichment-reviewing-lyrics',suggestion.kind === 'lyrics');
    var row = enrichmentRowForSuggestion(suggestion);
    var head = `<div class="admin-inspector-head"><small>${escapeHtml(suggestion.kind.replace('_',' '))} / ${escapeHtml(suggestion.status.replace('_',' '))}</small><button type="button" onclick="closeEnrichmentInspector()">close</button></div>
      <div class="enrichment-inspector-title"><h3>${escapeHtml(row?.getAttribute('data-title') || 'missing revision')}</h3><p>${escapeHtml(`${row?.getAttribute('data-sub') || 'archive'} / ${row?.getAttribute('data-ver') || suggestion.source_revision_id || 'revision'}`)}</p><div><span>${Math.round(enrichmentSuggestionConfidence(suggestion) * 100)}% confidence</span><span>${escapeHtml(suggestion.model_name || 'local')}</span><span>${escapeHtml(suggestion.status)}</span></div></div>`;
    if(!suggestion._payloadLoaded) {
      target.innerHTML = head + `<div class="enrichment-loading compact"><i></i><span>${escapeHtml(suggestion._payloadError || 'opening this private suggestion...')}</span>${suggestion._payloadError ? `<button type="button" onclick="retryEnrichmentSuggestionPayload('${escapeAttr(suggestion.id)}')">retry</button>` : ''}</div>`;
      if(!suggestion._payloadLoading && !suggestion._payloadError) {
        ensureEnrichmentSuggestionPayload(suggestion.id).then(value => {
          if(enrichmentSelectedSuggestionId !== value.id) return;
          if(value.kind === 'lyrics' && enrichmentEditorDraftInitializedFor !== value.id) {
            var recovered = enrichmentLocalDraft(value.id);
            enrichmentEditorDraft = recovered === null ? initialEnrichmentLyricsDraft(value) : recovered;
            enrichmentEditorDraftInitializedFor = value.id;
          }
          renderEnrichmentInspector();
          window.setTimeout(drawEnrichmentReviewWaveform,0);
        }).catch(() => renderEnrichmentInspector());
      }
      return;
    }
    var body = suggestion.kind === 'lyrics' ? enrichmentLyricsInspectorHtml(suggestion,row)
      : suggestion.kind === 'tags' ? enrichmentTagsInspectorHtml(suggestion,row)
      : suggestion.kind === 'audio_metadata' ? enrichmentAudioInspectorHtml(suggestion,row)
      : enrichmentEraSuggestionInspectorHtml(suggestion,row);
    target.innerHTML = head + body + enrichmentInspectorActionsHtml(suggestion,row);
    if(suggestion.kind === 'lyrics') window.requestAnimationFrame(resizeAllEnrichmentLyricTextareas);
  }

  function retryEnrichmentSuggestionPayload(id) {
    var suggestion = enrichmentSuggestionById(id);
    if(!suggestion) return;
    suggestion._payloadError = '';
    renderEnrichmentInspector();
  }

  function enrichmentInspectorActionsHtml(suggestion,row) {
    return `<div class="enrichment-inspector-actions">
      ${row ? `<button type="button" onclick="playEnrichmentSuggestion('${escapeAttr(suggestion.id)}')">play revision</button><button type="button" onclick="showEnrichmentSuggestionInArchive('${escapeAttr(suggestion.id)}')">show in folder</button><button type="button" onclick="openEnrichmentSuggestionWorld('${escapeAttr(suggestion.id)}')">open world</button>` : ''}
      <button type="button" onclick="setEnrichmentSuggestionStatus('${escapeAttr(suggestion.id)}','needs_review')">manual review</button>
      <button type="button" onclick="setEnrichmentSuggestionStatus('${escapeAttr(suggestion.id)}','rejected')">reject</button>
      ${['rejected','accepted','stale'].includes(suggestion.status) ? `<button type="button" onclick="setEnrichmentSuggestionStatus('${escapeAttr(suggestion.id)}','pending')">reopen</button>` : ''}
    </div>`;
  }

  async function setEnrichmentSuggestionStatus(id,status) {
    if(!requireAdmin()) return;
    var result = await supabaseClient.rpc('review_archive_enrichment',{ p_suggestion_id:id,p_status:status,p_payload:null,p_note:'' });
    if(result.error) return showAppNotice(result.error.message,'error');
    await loadArchiveEnrichmentData({ force:true });
    enrichmentSelectedSuggestionId = id;
    renderAdminWorkspace();
  }

  function playEnrichmentSuggestion(id) {
    var row = enrichmentRowForSuggestion(enrichmentSuggestionById(id));
    if(!row || row.getAttribute('data-type') !== 'audio') return showAppNotice('The linked audio revision is unavailable.','error');
    buildQueue();
    var index = audioQueue.indexOf(row);
    if(index >= 0) playTrackFromQueue(index);
    window.setTimeout(drawEnrichmentReviewWaveform,80);
  }

  function showEnrichmentSuggestionInArchive(id) {
    var row = enrichmentRowForSuggestion(enrichmentSuggestionById(id));
    if(!row) return;
    openAdminWorkspacePlace('folder',row.getAttribute('data-sub') || '');
    adminSelectWorkspaceRow(adminRowKey(row));
  }

  function openEnrichmentSuggestionWorld(id) {
    var row = enrichmentRowForSuggestion(enrichmentSuggestionById(id));
    if(!row) return;
    togglePanel(false);
    openWorldsHub('worlds');
    window.setTimeout(() => openSongWorld(projectKeyForRow(row),'overview'),100);
  }

  function enrichmentTimeText(seconds) {
    seconds = Math.max(0,Number(seconds) || 0);
    var minutes = Math.floor(seconds / 60);
    return `${minutes}:${(seconds - minutes * 60).toFixed(2).padStart(5,'0')}`;
  }

  function enrichmentDraftLines(text) {
    return parseSyncedLyrics(text).map(entry => ({
      time:entry.time,
      lane:entry.lane || 'main',
      glow:normalizeLyricGlow(entry.glow,entry.lane || 'main'),
      speed:normalizeLyricSpeed(entry.speed),
      text:entry.isPause ? '...' : entry.text
    }));
  }

  function enrichmentLyricEvidence(payload,line) {
    var segments = Array.isArray(payload?.segments) ? payload.segments : [];
    var closest = null;
    var distance = Infinity;
    segments.forEach(segment => {
      var value = Math.abs(Number(segment.start || 0) - Number(line.time || 0));
      if(value < distance) {
        closest = segment;
        distance = value;
      }
    });
    if(!closest || distance > .4) {
      return { unsure:/\[unclear\]/i.test(line.text),confidence:null,words:[] };
    }
    var words = (Array.isArray(closest.words) ? closest.words : [])
      .filter(word => word?.unclear)
      .map(word => String(word.text || '').trim())
      .filter(Boolean)
      .slice(0,8);
    var confidence = Number(closest.confidence);
    var unsure = Boolean(
      closest.unclear || words.length ||
      (Number.isFinite(confidence) && confidence < .55) ||
      /\[unclear\]/i.test(line.text)
    );
    return { unsure,confidence:Number.isFinite(confidence) ? confidence : null,words };
  }

  function serializeEnrichmentDraftLines(lines) {
    return cleanSyncedLyrics((lines || []).map(line => {
      var text = line.isPause || line.text === '...' ? '...' : cleanSingleLine(line.text,500);
      if(!text) return '';
      var lane = ['main','lead','adlib','bg','effect'].includes(line.lane) ? line.lane : 'main';
      var glow = normalizeLyricGlow(line.glow,lane);
      var speed = normalizeLyricSpeed(line.speed);
      var directives = [];
      if(lane !== 'main') directives.push(`[${lane}]`);
      if(glow !== normalizeLyricGlow('',lane)) directives.push(`[glow:${glow}]`);
      if(speed !== 'slow') directives.push(`[speed:${speed}]`);
      return `[${enrichmentTimeText(line.time)}] ${directives.length ? `${directives.join(' ')} ` : ''}${text}`;
    }).filter(Boolean).join('\n'));
  }

  function enrichmentSegmentNear(payload,time) {
    var segments = Array.isArray(payload?.segments) ? payload.segments : [];
    var closest = null;
    var distance = Infinity;
    segments.forEach(segment => {
      var value = Math.abs(Number(segment?.start || 0) - Number(time || 0));
      if(value < distance) {
        closest = segment;
        distance = value;
      }
    });
    return closest && distance <= .55 ? closest : null;
  }

  function enrichmentShiftedLineTime(line,payload,movedWords,totalWords) {
    var segment = enrichmentSegmentNear(payload,line.time);
    var words = Array.isArray(segment?.words) ? segment.words : [];
    var timedWord = words[movedWords];
    if(Number.isFinite(Number(timedWord?.start))) return Number(timedWord.start);
    var start = Number(segment?.start);
    var end = Number(segment?.end);
    if(Number.isFinite(start) && Number.isFinite(end) && end > start && totalWords > 0) {
      return start + (end - start) * Math.min(.92,movedWords / totalWords);
    }
    return Number(line.time || 0);
  }

  function repairEnrichmentLyricBreaksResult(text,payload) {
    var lines = enrichmentDraftLines(cleanSyncedLyrics(text));
    if(!lines.length) return { text:cleanSyncedLyrics(text),merges:0,shifts:0,periodsRemoved:0 };
    var vocalLines = lines.filter(line => line.text !== '...');
    var periodRatio = vocalLines.length ? vocalLines.filter(line => /\.$/.test(line.text) && !/\.{3,}$/.test(line.text)).length / vocalLines.length : 0;
    var periodsRemoved = 0;
    if(periodRatio >= .58) vocalLines.forEach(line => {
      var cleaned = line.text.replace(/\.$/,'');
      if(cleaned !== line.text) periodsRemoved++;
      line.text = cleaned;
    });
    lines.forEach(line => { line.isPause = line.text === '...'; });
    var merges = 0;
    var shifts = 0;
    var dangling = /\b(?:a|an|and|are|as|at|be|because|been|but|cause|could|did|do|does|for|from|had|has|have|he|her|him|his|how|i|if|in|is|it|its|like|my|of|on|or|our|she|should|so|some|that|the|their|them|they|this|to|was|we|were|what|when|where|which|while|who|why|will|with|would|you|your)$/i;
    for(var index=0; index<lines.length - 1; index++) {
      var current = lines[index];
      var next = lines[index + 1];
      if(current.isPause || next.isPause || current.lane !== next.lane) continue;
      var currentWords = current.text.trim().split(/\s+/).filter(Boolean);
      var nextWords = next.text.trim().split(/\s+/).filter(Boolean);
      if(!currentWords.length || !nextWords.length) continue;
      var currentSegment = enrichmentSegmentNear(payload,current.time);
      var segmentEnd = Number(currentSegment?.end);
      var silence = Number.isFinite(segmentEnd)
        ? Number(next.time || 0) - segmentEnd
        : Number(next.time || 0) - Number(current.time || 0);
      var continuous = Number.isFinite(segmentEnd) ? silence >= -.25 && silence <= .82 : silence >= 0 && silence <= 4.8;
      var terminal = /[.!?\u2026]$/.test(current.text);
      var endsDangling = dangling.test(current.text);
      var nextStartsLower = /^(?:\[unclear\]\s*)?(?:[a-z]|['"(])/.test(next.text);
      var segmentWords = Array.isArray(currentSegment?.words) ? currentSegment.words.length : 0;
      var hitModelWordCap = segmentWords >= 10 && segmentWords <= 12 && silence <= .2;
      var obviouslySplit = currentWords.length <= 2 || nextWords.length <= 3 || endsDangling || hitModelWordCap || (!terminal && nextStartsLower && currentWords.length <= 8);
      if(!continuous || terminal || !obviouslySplit) continue;
      var combinedCount = currentWords.length + nextWords.length;
      if(combinedCount <= 16) {
        current.text = cleanSingleLine(`${current.text} ${next.text}`,500);
        lines.splice(index + 1,1);
        merges++;
        index = Math.max(-1,index - 1);
        continue;
      }
      var room = Math.max(0,16 - currentWords.length);
      var maximumMove = Math.min(room,Math.max(0,nextWords.length - 3),4);
      if(maximumMove < 1) continue;
      var moveCount = 0;
      for(var moveIndex=0; moveIndex<maximumMove; moveIndex++) {
        moveCount = moveIndex + 1;
        if(/[,:;.!?\u2026]$/.test(nextWords[moveIndex]) && moveCount >= 2) break;
      }
      if(endsDangling && moveCount < Math.min(2,maximumMove)) moveCount = Math.min(2,maximumMove);
      if(moveCount < 1) continue;
      var originalNextCount = nextWords.length;
      current.text = cleanSingleLine(`${current.text} ${nextWords.slice(0,moveCount).join(' ')}`,500);
      next.text = cleanSingleLine(nextWords.slice(moveCount).join(' '),500);
      next.time = enrichmentShiftedLineTime(next,payload,moveCount,originalNextCount);
      shifts++;
    }
    return { text:serializeEnrichmentDraftLines(lines),merges,shifts,periodsRemoved };
  }

  function repairEnrichmentLyricBreaks(text,payload) {
    return repairEnrichmentLyricBreaksResult(text,payload).text;
  }

  function initialEnrichmentLyricsDraft(suggestion) {
    return cleanSyncedLyrics(suggestion?.payload?.syncedText || '');
  }

  function cleanEnrichmentLyricBreaks() {
    var before = cleanSyncedLyrics(collectEnrichmentLyricsEditor());
    var suggestion = enrichmentSuggestionById(enrichmentSelectedSuggestionId);
    var repaired = repairEnrichmentLyricBreaksResult(before,suggestion?.payload);
    if(repaired.text === before) {
      return showAppNotice('No clear automatic breaks found. Select a lyric row, then use join selected + next.');
    }
    enrichmentLineBreakUndoDraft = before;
    enrichmentLineBreakUndoSuggestionId = enrichmentSelectedSuggestionId;
    enrichmentEditorDraft = repaired.text;
    saveEnrichmentLocalDraft(enrichmentSelectedSuggestionId,enrichmentEditorDraft);
    renderEnrichmentInspector();
    window.setTimeout(resizeAllEnrichmentLyricTextareas,0);
    var changes = repaired.merges + repaired.shifts;
    showAppNotice(`Reflowed ${changes} broken ${changes === 1 ? 'line' : 'lines'}${repaired.periodsRemoved ? ` and removed ${repaired.periodsRemoved} automatic periods` : ''}.`);
  }

  function setEnrichmentFocusedLine(index) {
    enrichmentFocusedLineIndex = Number(index);
    document.querySelectorAll('[data-enrichment-lyric-row]').forEach((row,rowIndex) => {
      row.classList.toggle('is-selected-line',rowIndex === enrichmentFocusedLineIndex);
    });
  }

  function joinFocusedEnrichmentLyricLine() {
    var lines = enrichmentDraftLines(collectEnrichmentLyricsEditor());
    var index = Number(enrichmentFocusedLineIndex);
    if(!Number.isInteger(index) || index < 0 || index >= lines.length) {
      return showAppNotice('Select the lyric row whose text should continue into the next row.');
    }
    if(index >= lines.length - 1) return showAppNotice('That is already the final lyric row.');
    var current = lines[index];
    var next = lines[index + 1];
    if(current.text === '...' || next.text === '...') return showAppNotice('Instrumental pauses stay as their own row.');
    if(current.lane !== next.lane) return showAppNotice('Different vocal lanes stay separate. Change the lane first if they belong together.');
    enrichmentLineBreakUndoDraft = serializeEnrichmentDraftLines(lines);
    enrichmentLineBreakUndoSuggestionId = enrichmentSelectedSuggestionId;
    current.text = cleanSingleLine(`${current.text} ${next.text}`,500);
    lines.splice(index + 1,1);
    enrichmentEditorDraft = serializeEnrichmentDraftLines(lines);
    saveEnrichmentLocalDraft(enrichmentSelectedSuggestionId,enrichmentEditorDraft);
    renderEnrichmentInspector();
    window.setTimeout(() => {
      setEnrichmentFocusedLine(Math.min(index,lines.length - 1));
      document.querySelectorAll('[data-enrichment-lyric-row] textarea')[Math.min(index,lines.length - 1)]?.focus();
      resizeAllEnrichmentLyricTextareas();
    },0);
    showAppNotice('Joined the selected lyric with the next line.');
  }

  function undoEnrichmentLineBreakEdit() {
    if(!enrichmentLineBreakUndoDraft || enrichmentLineBreakUndoSuggestionId !== enrichmentSelectedSuggestionId) {
      return showAppNotice('There is no line-break change to undo.');
    }
    var current = cleanSyncedLyrics(collectEnrichmentLyricsEditor());
    enrichmentEditorDraft = cleanSyncedLyrics(enrichmentLineBreakUndoDraft);
    enrichmentLineBreakUndoDraft = current;
    saveEnrichmentLocalDraft(enrichmentSelectedSuggestionId,enrichmentEditorDraft);
    renderEnrichmentInspector();
    window.setTimeout(resizeAllEnrichmentLyricTextareas,0);
    showAppNotice('Restored the previous line layout.');
  }

  function resetEnrichmentLyricsToSuggestion() {
    var suggestion = enrichmentSuggestionById(enrichmentSelectedSuggestionId);
    var imported = cleanSyncedLyrics(suggestion?.payload?.syncedText || '');
    if(!imported) return showAppNotice('This suggestion has no imported transcript to restore.');
    var current = cleanSyncedLyrics(collectEnrichmentLyricsEditor());
    if(current === imported) return showAppNotice('The editor already matches the imported AI transcript.');
    if(!confirm('Reset the current lyric edits to the imported AI transcript? You can undo this once.')) return;
    enrichmentLineBreakUndoDraft = current;
    enrichmentLineBreakUndoSuggestionId = enrichmentSelectedSuggestionId;
    enrichmentEditorDraft = imported;
    enrichmentFocusedLineIndex = -1;
    saveEnrichmentLocalDraft(enrichmentSelectedSuggestionId,enrichmentEditorDraft);
    renderEnrichmentInspector();
    window.setTimeout(resizeAllEnrichmentLyricTextareas,0);
    showAppNotice('Restored the imported transcript. Reflow will now show exactly what it changes.');
  }

  function toggleEnrichmentReviewPlayback(id) {
    var suggestion = enrichmentSuggestionById(id);
    var row = enrichmentRowForSuggestion(suggestion);
    var activeRow = audioQueue[queueIndex];
    if(!row || !activeRow || canonicalRow(activeRow) !== canonicalRow(row)) {
      playEnrichmentSuggestion(id);
      return;
    }
    if(!currentAudio) return;
    if(currentAudio.paused) currentAudio.play().catch(() => {});
    else currentAudio.pause();
  }

  function focusNextUnsureLyric() {
    var rows = Array.from(document.querySelectorAll('.enrichment-lyric-edit-row.is-unsure'));
    if(!rows.length) return showAppNotice('No unsure lyric lines in this draft.');
    var active = document.activeElement?.closest?.('.enrichment-lyric-edit-row');
    var index = active ? rows.indexOf(active) : -1;
    var next = rows[(index + 1) % rows.length];
    next.scrollIntoView({ behavior:'smooth',block:'center' });
    next.querySelector('textarea')?.focus({ preventScroll:true });
    next.querySelector('button')?.click();
  }

  function enrichmentLyricsInspectorHtml(suggestion,row) {
    if(enrichmentEditorDraftInitializedFor !== suggestion.id) {
      var recovered = enrichmentLocalDraft(suggestion.id);
      enrichmentEditorDraft = recovered === null ? initialEnrichmentLyricsDraft(suggestion) : recovered;
      enrichmentEditorDraftInitializedFor = suggestion.id;
    }
    var lines = enrichmentDraftLines(enrichmentEditorDraft);
    var accepted = row?.getAttribute('data-lyrics') || '';
    var unsureCount = 0;
    var lineHtml = lines.map((line,index) => {
      var evidence = enrichmentLyricEvidence(suggestion.payload,line);
      if(evidence.unsure) unsureCount++;
      var certaintyText = evidence.confidence === null ? '?' : `? ${Math.round(evidence.confidence * 100)}%`;
      var certaintyTitle = evidence.words.length ? `Unsure words: ${evidence.words.join(', ')}` : 'Low-confidence transcription. Listen and correct this line.';
      var glow = normalizeLyricGlow(line.glow,line.lane);
      var speed = normalizeLyricSpeed(line.speed);
      return `<div class="enrichment-lyric-edit-row${evidence.unsure ? ' is-unsure' : ''}${index === enrichmentFocusedLineIndex ? ' is-selected-line' : ''}" data-enrichment-lyric-row${evidence.unsure ? ' data-unsure="true"' : ''} onclick="setEnrichmentFocusedLine(${index})">
      <button type="button" onclick="seekEnrichmentLyric('${escapeAttr(suggestion.id)}',${Number(line.time).toFixed(3)})" title="seek to this line">${escapeHtml(enrichmentTimeText(line.time))}</button>
      <input data-lyric-time type="text" inputmode="decimal" value="${escapeAttr(enrichmentTimeText(line.time))}" aria-label="line timestamp" oninput="scheduleEnrichmentDraftCapture()">
      <select data-lyric-lane aria-label="vocal lane" onchange="scheduleEnrichmentDraftCapture()">${['main','lead','adlib','bg','effect'].map(lane => `<option value="${lane}"${lane === line.lane ? ' selected' : ''}>${lane}</option>`).join('')}</select>
      <span class="enrichment-lyric-certainty" title="${escapeAttr(certaintyTitle)}"${evidence.unsure ? '' : ' aria-hidden="true"'}>${evidence.unsure ? escapeHtml(certaintyText) : ''}</span>
      <textarea data-lyric-text rows="1" maxlength="500" aria-label="lyric text" oninput="resizeEnrichmentLyricTextarea(this);scheduleEnrichmentDraftCapture()">${escapeHtml(line.text)}</textarea>
      <div class="enrichment-line-effects" aria-label="line appearance">
        <label><span>glow</span><select data-lyric-glow aria-label="line glow" onchange="scheduleEnrichmentDraftCapture()">${['off','soft','normal','high'].map(value => `<option value="${value}"${value === glow ? ' selected' : ''}>${value}</option>`).join('')}</select></label>
        <label><span>speed</span><select data-lyric-speed aria-label="line motion speed" onchange="scheduleEnrichmentDraftCapture()">${['still','slow','normal','fast'].map(value => `<option value="${value}"${value === speed ? ' selected' : ''}>${value}</option>`).join('')}</select></label>
      </div>
      <button type="button" onclick="removeEnrichmentLyricLine(${index})" aria-label="remove line">x</button>
    </div>`;
    }).join('');
    var comparison = accepted ? `<details class="enrichment-lyrics-compare"><summary>compare accepted lyrics / ${parseSyncedLyrics(accepted).length} lines</summary><div><section><small>currently accepted</small><pre>${escapeHtml(accepted)}</pre></section><section><small>private draft</small><pre>${escapeHtml(enrichmentEditorDraft)}</pre></section></div></details>` : '<div class="enrichment-no-accepted">No accepted transcript exists for this revision yet.</div>';
    return `<div class="enrichment-lyrics-editor">
      <div class="enrichment-editor-dock">
        <div class="enrichment-wave"><canvas id="enrichmentWaveform"></canvas><span>click a timestamp to seek / the real player remains the audio source</span></div>
        <div class="enrichment-editor-tools"><button class="enrichment-review-play" type="button" onclick="toggleEnrichmentReviewPlayback('${escapeAttr(suggestion.id)}')">play / pause</button><button class="enrichment-unsure-jump" type="button" onclick="focusNextUnsureLyric()"${unsureCount ? '' : ' disabled'}>next unsure / ${unsureCount}</button><button type="button" onclick="cleanEnrichmentLyricBreaks()">reflow broken lines</button><button type="button" onclick="joinFocusedEnrichmentLyricLine()">join selected + next</button><button type="button" onclick="undoEnrichmentLineBreakEdit()"${enrichmentLineBreakUndoSuggestionId === suggestion.id && enrichmentLineBreakUndoDraft ? '' : ' disabled'}>undo reflow</button><button type="button" onclick="resetEnrichmentLyricsToSuggestion()">reset AI draft</button><button type="button" onclick="addEnrichmentLyricLine('main',false)">+ lead line</button><button type="button" onclick="addEnrichmentLyricLine('adlib',false)">+ adlib</button><button type="button" onclick="addEnrichmentLyricLine('main',true)">+ instrumental pause</button><button type="button" onclick="previewEnrichmentLyrics('${escapeAttr(suggestion.id)}')">preview in lyrics mode</button></div>
      </div>
      <div class="enrichment-lyric-column-head" aria-hidden="true"><span>seek</span><span>timestamp</span><span>lane</span><span>confidence</span><span>lyric</span><span>appearance</span><span>remove</span></div>
      <div class="enrichment-lyric-rows">${lineHtml || '<div class="enrichment-empty compact">The model returned no timed vocal lines. Add a line or mark the revision instrumental.</div>'}</div>
      <details class="enrichment-raw-draft"><summary>edit Akrasia synced text directly</summary><textarea id="enrichmentLyricsRaw" rows="10" oninput="captureEnrichmentRawDraft(this.value)">${escapeHtml(enrichmentEditorDraft)}</textarea><button type="button" onclick="applyRawEnrichmentLyrics()">apply raw edit</button></details>
      ${comparison}
      <div class="enrichment-editor-commit"><span>local recovery stays on while you edit</span><button type="button" onclick="saveEnrichmentLyricsDraft('${escapeAttr(suggestion.id)}')">save private draft</button><button class="primary" type="button" onclick="acceptEnrichmentLyrics('${escapeAttr(suggestion.id)}')">accept edited lyrics</button></div>
    </div>`;
  }

  function resizeEnrichmentLyricTextarea(textarea) {
    if(!textarea) return;
    textarea.style.height = 'auto';
    textarea.style.height = `${Math.min(190,Math.max(44,textarea.scrollHeight))}px`;
  }

  function resizeAllEnrichmentLyricTextareas() {
    document.querySelectorAll('.enrichment-lyric-edit-row textarea').forEach(resizeEnrichmentLyricTextarea);
  }

  function collectEnrichmentLyricsEditor() {
    var rows = Array.from(document.querySelectorAll('[data-enrichment-lyric-row]'));
    if(!rows.length) return cleanSyncedLyrics(enrichmentEditorDraft);
    return serializeEnrichmentDraftLines(rows.map(row => ({
      time:parseLyricTime(row.querySelector('[data-lyric-time]')?.value),
      lane:row.querySelector('[data-lyric-lane]')?.value || 'main',
      glow:row.querySelector('[data-lyric-glow]')?.value || 'soft',
      speed:row.querySelector('[data-lyric-speed]')?.value || 'slow',
      text:cleanSingleLine(row.querySelector('[data-lyric-text]')?.value,500)
    })).filter(line => line.time !== null && line.text));
  }

  function applyRawEnrichmentLyrics() {
    enrichmentEditorDraft = cleanSyncedLyrics(document.getElementById('enrichmentLyricsRaw')?.value || enrichmentEditorDraft);
    saveEnrichmentLocalDraft(enrichmentSelectedSuggestionId,enrichmentEditorDraft);
    renderEnrichmentInspector();
    window.setTimeout(drawEnrichmentReviewWaveform,0);
  }

  function addEnrichmentLyricLine(lane,pause) {
    enrichmentEditorDraft = cleanSyncedLyrics(collectEnrichmentLyricsEditor());
    var time = currentAudio && Number.isFinite(currentAudio.currentTime) ? currentAudio.currentTime : 0;
    enrichmentEditorDraft += `${enrichmentEditorDraft ? '\n' : ''}[${enrichmentTimeText(time)}] ${pause ? '...' : lane === 'main' ? 'new line' : `[${lane}] new line`}`;
    saveEnrichmentLocalDraft(enrichmentSelectedSuggestionId,enrichmentEditorDraft);
    renderEnrichmentInspector();
    document.querySelector('.enrichment-lyric-edit-row:last-child textarea')?.focus();
  }

  function removeEnrichmentLyricLine(index) {
    var lines = enrichmentDraftLines(collectEnrichmentLyricsEditor());
    lines.splice(index,1);
    enrichmentEditorDraft = serializeEnrichmentDraftLines(lines);
    saveEnrichmentLocalDraft(enrichmentSelectedSuggestionId,enrichmentEditorDraft);
    renderEnrichmentInspector();
  }

  function seekEnrichmentLyric(id,time) {
    var row = enrichmentRowForSuggestion(enrichmentSuggestionById(id));
    var activeRow = audioQueue[queueIndex];
    var needsTrack = Boolean(row && (!activeRow || canonicalRow(activeRow) !== canonicalRow(row)));
    if(needsTrack) playEnrichmentSuggestion(id);
    window.setTimeout(() => {
      if(currentAudio) {
        currentAudio.currentTime = Math.max(0,Number(time) || 0);
        updateTime();
      }
    },needsTrack ? 120 : 0);
  }

  function drawEnrichmentReviewWaveform() {
    var canvas = document.getElementById('enrichmentWaveform');
    if(!canvas || typeof drawWaveformCanvas !== 'function') return;
    var suggestion = enrichmentSuggestionById(enrichmentSelectedSuggestionId);
    var row = enrichmentRowForSuggestion(suggestion);
    var activeQueueRow = audioQueue[queueIndex];
    var active = Boolean(row && activeQueueRow && canonicalRow(activeQueueRow) === canonicalRow(row));
    var progress = active && currentAudio?.duration ? currentAudio.currentTime / currentAudio.duration * 100 : 0;
    drawWaveformCanvas(canvas,active ? activeWaveformPeaks : fallbackWaveformPeaks(worldRowKey(row) || suggestion?.id || 'review'),progress);
  }

  async function saveEnrichmentLyricsDraft(id) {
    if(!requireAdmin()) return;
    var suggestion;
    try { suggestion = await ensureEnrichmentSuggestionPayload(id); }
    catch(error) { return showAppNotice(cleanSingleLine(error.message || 'Private suggestion could not be loaded.',240),'error'); }
    if(!suggestion) return;
    enrichmentEditorDraft = cleanSyncedLyrics(collectEnrichmentLyricsEditor());
    var payload = Object.assign({},suggestion.payload || {},{ syncedText:enrichmentEditorDraft,format:'akrasia-synced-text' });
    var result = await supabaseClient.rpc('review_archive_enrichment',{ p_suggestion_id:id,p_status:'draft',p_payload:payload,p_note:'edited in Akrasia' });
    if(result.error) return showAppNotice(result.error.message,'error');
    suggestion.payload = payload;
    suggestion._payloadLoaded = true;
    removeEnrichmentLocalDraft(id);
    await loadArchiveEnrichmentData({ force:true });
    enrichmentSelectedSuggestionId = id;
    enrichmentEditorDraft = payload.syncedText;
    renderAdminWorkspace();
    showAppNotice('Private lyric draft saved.');
  }

  function previewEnrichmentLyrics(id) {
    var suggestion = enrichmentSuggestionById(id);
    var row = enrichmentRowForSuggestion(suggestion);
    if(!row) return;
    enrichmentEditorDraft = cleanSyncedLyrics(collectEnrichmentLyricsEditor());
    saveEnrichmentLocalDraft(id,enrichmentEditorDraft);
    playEnrichmentSuggestion(id);
    var original = row.getAttribute('data-lyrics') || '';
    row.setAttribute('data-lyrics',enrichmentEditorDraft);
    renderLyricsForRow(row);
    row.setAttribute('data-lyrics',original);
    openLyricsFullscreen();
  }

  async function acceptEnrichmentLyricsCompatibility(suggestion,row,syncedText) {
    var assetId = String(suggestion?.asset_id || '');
    if(!assetId || row?.getAttribute('data-id') !== assetId) {
      return { error:new Error('The lyric suggestion no longer matches this archive revision.') };
    }
    var cleanText = cleanSyncedLyrics(syncedText);
    var assetWrite = await supabaseClient
      .from('archive_assets')
      .update({ synced_lyrics:cleanText })
      .eq('id',assetId)
      .select('id');
    if(assetWrite.error) return { error:assetWrite.error };
    if(!Array.isArray(assetWrite.data) || assetWrite.data.length !== 1) {
      return { error:new Error('The archive revision could not be updated.') };
    }
    var payload = Object.assign({},suggestion.payload || {},{
      syncedText:cleanText,
      format:'akrasia-synced-text'
    });
    var suggestionWrite = await supabaseClient
      .from('archive_enrichment_suggestions')
      .update({
        status:'accepted',
        payload,
        reviewed_at:new Date().toISOString(),
        review_note:''
      })
      .eq('id',suggestion.id)
      .eq('asset_id',assetId)
      .select('id');
    if(suggestionWrite.error) {
      return { error:new Error(`Lyrics were saved, but the review state could not be updated: ${suggestionWrite.error.message}`) };
    }
    if(!Array.isArray(suggestionWrite.data) || suggestionWrite.data.length !== 1) {
      return { error:new Error('Lyrics were saved, but the private suggestion was not marked accepted.') };
    }
    suggestion.payload = payload;
    suggestion.status = 'accepted';
    suggestion._payloadLoaded = true;
    return { error:null,compatibilityFallback:true };
  }

  async function acceptEnrichmentLyrics(id) {
    if(!requireAdmin()) return;
    var suggestion;
    try { suggestion = await ensureEnrichmentSuggestionPayload(id); }
    catch(error) { return showAppNotice(cleanSingleLine(error.message || 'Private suggestion could not be loaded.',240),'error'); }
    var row = enrichmentRowForSuggestion(suggestion);
    if(!suggestion || !row) return;
    enrichmentEditorDraft = cleanSyncedLyrics(collectEnrichmentLyricsEditor());
    if(!parseSyncedLyrics(enrichmentEditorDraft).length && !confirm('This draft has no valid timed lyric lines. Accept it as an empty transcript?')) return;
    var accepted = row.getAttribute('data-lyrics') || '';
    var replace = Boolean(accepted && accepted !== enrichmentEditorDraft);
    if(replace && !confirm(`Replace the ${parseSyncedLyrics(accepted).length} currently accepted lines with this ${parseSyncedLyrics(enrichmentEditorDraft).length}-line edited draft?`)) return;
    var result = await supabaseClient.rpc('accept_archive_lyrics',{ p_suggestion_id:id,p_synced_text:enrichmentEditorDraft,p_replace_existing:replace });
    if(result.error && enrichmentErrorIsBrokenNullSanitizer(result.error)) {
      result = await acceptEnrichmentLyricsCompatibility(suggestion,row,enrichmentEditorDraft);
    }
    if(result.error) return showAppNotice(result.error.message,'error');
    row.setAttribute('data-lyrics',enrichmentEditorDraft);
    removeEnrichmentLocalDraft(id);
    archiveSearchIndex.delete(row);
    await loadArchiveEnrichmentData({ force:true });
    enrichmentSelectedSuggestionId = id;
    renderAdminWorkspace();
    showAppNotice('Edited synced lyrics accepted.');
  }

  function enrichmentTagSuggestions(suggestion) {
    return Array.isArray(suggestion?.payload?.suggestions) ? suggestion.payload.suggestions.slice(0,80) : [];
  }

  function enrichmentTagsInspectorHtml(suggestion) {
    var tags = enrichmentTagSuggestions(suggestion);
    var moodOptions = tags.filter(tag => tag.category === 'mood');
    return `<div class="enrichment-tag-review">
      <p class="enrichment-review-note">Correct the private suggestion before accepting it. Confidence and evidence remain review context; only accepted relationships appear publicly.</p>
      <div class="enrichment-tag-suggestions">${tags.map((tag,index) => `<div class="enrichment-tag-suggestion"><input type="checkbox" data-enrichment-tag-index="${index}" aria-label="accept tag ${escapeAttr(tag.value || tag.name || '')}"${Number(tag.confidence || 0) >= .5 ? ' checked' : ''}><span><input type="text" data-enrichment-tag-value="${index}" maxlength="80" value="${escapeAttr(tag.value || tag.name || '')}" aria-label="reviewed tag value"><select data-enrichment-tag-category="${index}" aria-label="reviewed tag category">${ENRICHMENT_TAG_CATEGORIES.map(category => `<option value="${category}"${category === tag.category ? ' selected' : ''}>${category.replace(/-/g,' ')}</option>`).join('')}</select><small>${Math.round(Number(tag.confidence || 0) * 100)}% confidence</small><em>${escapeHtml(tag.explanation || tag.evidenceSource || '')}</em></span></div>`).join('') || '<div class="enrichment-empty compact">No controlled tags were suggested.</div>'}</div>
      ${moodOptions.length ? `<label class="enrichment-apply-mood"><input id="enrichmentApplyMood" type="checkbox"><span>also update the old primary mood field</span><select id="enrichmentPrimaryMood">${moodOptions.map(tag => { var index=tags.indexOf(tag); return `<option value="${index}">${escapeHtml(tag.value)}</option>`; }).join('')}</select><small>The existing mood color is preserved.</small></label>` : ''}
      <button class="primary enrichment-accept" type="button" onclick="acceptEnrichmentTags('${escapeAttr(suggestion.id)}')">accept checked tags</button>
    </div>`;
  }

  async function acceptEnrichmentTags(id) {
    if(!requireAdmin()) return;
    var suggestion;
    try { suggestion = await ensureEnrichmentSuggestionPayload(id); }
    catch(error) { return showAppNotice(cleanSingleLine(error.message || 'Private suggestion could not be loaded.',240),'error'); }
    if(!suggestion) return;
    var all = enrichmentTagSuggestions(suggestion);
    var selected = Array.from(document.querySelectorAll('[data-enrichment-tag-index]:checked')).map(input => {
      var index = Number(input.getAttribute('data-enrichment-tag-index'));
      var original = all[index];
      if(!original) return null;
      var value = cleanSingleLine(document.querySelector(`[data-enrichment-tag-value="${index}"]`)?.value,80).toLowerCase();
      var category = document.querySelector(`[data-enrichment-tag-category="${index}"]`)?.value || '';
      if(!value || !ENRICHMENT_TAG_CATEGORIES.includes(category)) return null;
      return Object.assign({},original,{ value,name:value,category });
    }).filter(Boolean);
    if(!selected.length) return showAppNotice('Select at least one reviewed tag.','error');
    var applyMood = Boolean(document.getElementById('enrichmentApplyMood')?.checked);
    var primaryMoodIndex = Number(document.getElementById('enrichmentPrimaryMood')?.value);
    var primaryMood = Number.isInteger(primaryMoodIndex) ? cleanSingleLine(document.querySelector(`[data-enrichment-tag-value="${primaryMoodIndex}"]`)?.value,80).toLowerCase() : null;
    var result = await supabaseClient.rpc('accept_archive_tags',{ p_suggestion_id:id,p_tags:selected,p_apply_mood:applyMood,p_primary_mood:primaryMood });
    if(result.error) return showAppNotice(result.error.message,'error');
    await loadArchiveEnrichmentData({ force:true });
    enrichmentSelectedSuggestionId = id;
    renderAdminWorkspace();
    showAppNotice(`${selected.length} accepted tag${selected.length === 1 ? '' : 's'} attached.`);
  }

  var ENRICHMENT_AUDIO_FIELDS = [
    ['durationSeconds','duration seconds','number'],['bitrateKbps','bitrate kbps','number'],['sampleRateHz','sample rate','number'],['channels','channels','number'],
    ['estimatedBpm','estimated bpm','number'],['bpmConfidence','bpm confidence','number'],['estimatedMusicalKey','estimated key','text'],['keyConfidence','key confidence','number'],
    ['estimatedTimeSignature','time signature','text'],['timeSignatureConfidence','time signature confidence','number'],['integratedLoudnessLufs','loudness lufs','number'],
    ['tempoCategory','tempo category','text'],['detectedLanguage','language','text'],['vocalInstrumentalStatus','vocal / instrumental','text']
  ];

  function enrichmentAudioInspectorHtml(suggestion) {
    var payload = suggestion.payload || {};
    return `<div class="enrichment-audio-review"><p class="enrichment-review-note">BPM, key, and meter are estimates. Keep the confidence beside the value instead of presenting weak guesses as facts.</p><div class="enrichment-audio-grid">${ENRICHMENT_AUDIO_FIELDS.map(field => `<label><span>${escapeHtml(field[1])}</span><input data-enrichment-audio="${field[0]}" type="${field[2]}"${field[2] === 'number' ? ' step="any"' : ''} value="${escapeAttr(payload[field[0]] == null ? '' : payload[field[0]])}"></label>`).join('')}</div><button class="primary enrichment-accept" type="button" onclick="acceptEnrichmentAudioMetadata('${escapeAttr(suggestion.id)}')">accept reviewed metadata</button></div>`;
  }

  async function acceptEnrichmentAudioMetadata(id) {
    if(!requireAdmin()) return;
    var suggestion;
    try { suggestion = await ensureEnrichmentSuggestionPayload(id); }
    catch(error) { return showAppNotice(cleanSingleLine(error.message || 'Private suggestion could not be loaded.',240),'error'); }
    if(!suggestion) return;
    var values = privateAudioMetadataPayload(suggestion.payload);
    document.querySelectorAll('[data-enrichment-audio]').forEach(input => {
      var key = input.getAttribute('data-enrichment-audio');
      values[key] = input.type === 'number' ? (input.value === '' ? null : Number(input.value)) : cleanSingleLine(input.value,80);
    });
    var result = await supabaseClient.rpc('accept_archive_audio_metadata',{ p_suggestion_id:id,p_values:values });
    if(result.error) return showAppNotice(result.error.message,'error');
    await loadArchiveEnrichmentData({ force:true });
    enrichmentSelectedSuggestionId = id;
    renderAdminWorkspace();
    showAppNotice('Reviewed technical metadata accepted.');
  }

  function enrichmentEraSuggestionInspectorHtml(suggestion) {
    var payload = suggestion.payload?.eraEvidence || {};
    var evidence = suggestion.evidence || payload;
    var guessed = archiveEnrichment.erasById.get(payload.suggestedEraId)
      || archiveEnrichment.eras.find(era => String(era.name || '').toLowerCase() === String(payload.suggestedEraName || '').toLowerCase())
      || null;
    var candidates = Array.isArray(payload.candidates) ? payload.candidates : [];
    var candidateHtml = candidates.map((candidate,index) => `<span${guessed && candidate.eraId === guessed.id ? ' class="is-leading"' : ''}><b>${index + 1}</b>${escapeHtml(candidate.eraName || 'unnamed era')}<strong>${Math.round(Number(candidate.confidence || 0) * 100)}%</strong></span>`).join('');
    var options = archiveEnrichment.eras.map(era => `<option value="${escapeAttr(era.id)}"${guessed?.id === era.id ? ' selected' : ''}>${escapeHtml(era.name)}</option>`).join('');
    return `<div class="enrichment-era-review"><p class="enrichment-review-note">This is a private ranked guess learned from dates and eras you already confirmed. Correct it here; nothing is published automatically.</p>${candidateHtml ? `<div class="enrichment-era-candidates">${candidateHtml}</div>` : ''}<div class="enrichment-evidence"><span>revision date<strong>${escapeHtml(evidence.revisionDateTime || payload.revisionDateTime || 'unknown')}</strong></span><span>reason<strong>${escapeHtml(evidence.explanation || payload.explanation || enrichmentSuggestionReason(suggestion))}</strong></span></div><label><span>creative era</span><select id="enrichmentSuggestionEra"><option value="">choose an era</option>${options}</select></label><label><span>relationship</span><select id="enrichmentSuggestionEraRelationship"><option value="primary">primary</option><option value="secondary">secondary</option></select></label><button class="primary enrichment-accept" type="button" onclick="acceptEnrichmentEra('${escapeAttr(suggestion.id)}')">accept assignment</button></div>`;
  }

  async function acceptEnrichmentEra(id) {
    if(!requireAdmin()) return;
    try { await ensureEnrichmentSuggestionPayload(id); }
    catch(error) { return showAppNotice(cleanSingleLine(error.message || 'Private suggestion could not be loaded.',240),'error'); }
    var eraId = document.getElementById('enrichmentSuggestionEra')?.value;
    var relationship = document.getElementById('enrichmentSuggestionEraRelationship')?.value || 'primary';
    if(!eraId) return showAppNotice('Choose an artist-defined era first.','error');
    var result = await supabaseClient.rpc('accept_archive_era',{ p_suggestion_id:id,p_era_id:eraId,p_relationship:relationship });
    if(result.error) return showAppNotice(result.error.message,'error');
    await loadArchiveEnrichmentData({ force:true });
    enrichmentSelectedSuggestionId = id;
    renderAdminWorkspace();
    showAppNotice('Creative-era assignment accepted.');
  }

  function eraTrainingAudioMetadata(value) {
    value = value && typeof value === 'object' ? value : {};
    var advanced = value.analysis_features && typeof value.analysis_features === 'object' ? value.analysis_features : {};
    var fields = {
      estimatedBpm:value.estimated_bpm,
      integratedLoudnessLufs:value.integrated_loudness_lufs,
      rmsMeanDb:advanced.rmsMeanDb,
      rmsStdDb:advanced.rmsStdDb,
      dynamicRangeDb:advanced.dynamicRangeDb,
      onsetRatePerSecond:advanced.onsetRatePerSecond,
      spectralCentroidHz:advanced.spectralCentroidHz,
      spectralBandwidthHz:advanced.spectralBandwidthHz,
      zeroCrossingRate:advanced.zeroCrossingRate,
      energyScore:advanced.energyScore
    };
    return Object.fromEntries(Object.entries(fields).map(([key,value]) => [key,Number(value)]).filter(([_key,value]) => Number.isFinite(value)));
  }

  function buildEraTrainingExport() {
    var examplesByEra = new Map(archiveEnrichment.eras.map(era => [era.id,[]]));
    baseRows().forEach(row => {
      if(row.getAttribute('data-type') !== 'audio') return;
      var assetId = row.getAttribute('data-id');
      var projectId = cleanSourceToken(row.getAttribute('data-source-project-id'),180);
      var revisionId = cleanSourceToken(row.getAttribute('data-source-revision-id'),180);
      if(!assetId || !projectId || !revisionId) return;
      var relations = (archiveEnrichment.assetErasByAsset.get(assetId) || []).filter(item => item.review_status === 'confirmed');
      if(!relations.length) return;
      var sourceMetadata = {};
      try { sourceMetadata = JSON.parse(row.getAttribute('data-source-metadata') || '{}'); } catch(error) {}
      var example = {
        projectId,
        revisionId,
        revisionNumber:cleanSingleLine(row.getAttribute('data-ver'),24),
        revisionDateTime:cleanSingleLine(sourceMetadata.revisionDateTime || row.getAttribute('data-asset-date') || row.getAttribute('data-date'),120),
        audioMetadata:eraTrainingAudioMetadata(acceptedAudioMetadataForRow(row)),
        tags:acceptedTagsForRow(row).map(tag => `${tag.category}:${tag.slug}`).slice(0,80)
      };
      relations.forEach(relation => examplesByEra.get(relation.era_id)?.push(example));
    });
    return {
      schemaVersion:1,
      generatedAt:new Date().toISOString(),
      source:'confirmed Akrasia admin decisions',
      eras:archiveEnrichment.eras.map(era => ({
        id:era.id,
        name:cleanSingleLine(era.name,120),
        startDate:era.start_date || null,
        endDate:era.end_date || null,
        examples:(examplesByEra.get(era.id) || []).slice(0,5000)
      }))
    };
  }

  async function writableEraTrainingDirectory() {
    if(typeof window.showDirectoryPicker !== 'function') throw new Error('This browser cannot write the private era-training file. Open Akrasia in Edge or Chrome.');
    var handle = bandlabSourceHandle;
    var permission = 'prompt';
    if(handle?.kind === 'directory') {
      try { permission = await handle.queryPermission({ mode:'readwrite' }); } catch(error) {}
      if(permission !== 'granted') {
        try { permission = await handle.requestPermission({ mode:'readwrite' }); } catch(error) {}
      }
    }
    if(!handle || permission !== 'granted') {
      handle = await window.showDirectoryPicker({ mode:'readwrite',id:'akrasia-era-training' });
      permission = 'granted';
    }
    var target = handle;
    if(String(handle.name || '').toLowerCase() !== 'bandlab backup') {
      try { target = await handle.getDirectoryHandle('BandLab Backup'); } catch(error) {}
    }
    return target;
  }

  async function exportArchiveEraTraining() {
    if(!requireAdmin()) return;
    if(!archiveEnrichment.eras.length) return showAppNotice('Define at least one creative era first.','error');
    try {
      var target = await writableEraTrainingDirectory();
      var payload = buildEraTrainingExport();
      var exampleCount = payload.eras.reduce((sum,era) => sum + era.examples.length,0);
      var fileHandle = await target.getFileHandle('akrasia-era-training.json',{ create:true });
      var writable = await fileHandle.createWritable();
      await writable.write(JSON.stringify(payload,null,2) + '\n');
      await writable.close();
      showAppNotice(`${payload.eras.length} eras and ${exampleCount} confirmed revision examples sent to the private analyzer.`);
    } catch(error) {
      if(error?.name === 'AbortError') return;
      showAppNotice(cleanSingleLine(error.message || 'Era training export failed.',240),'error');
    }
  }

  function archiveEraGuessDate(row) {
    var value = String(row?.getAttribute('data-asset-date') || row?.getAttribute('data-date') || '').match(/\d{4}-\d{2}-\d{2}/);
    return value ? value[0] : '';
  }

  function archiveEraGuessDateLabel(value,monthOnly) {
    if(!value) return 'undated';
    try {
      var date = new Date(`${monthOnly ? value + '-15' : value}T12:00:00`);
      return new Intl.DateTimeFormat(undefined,monthOnly ? { month:'long',year:'numeric' } : { month:'long',day:'numeric',year:'numeric' }).format(date);
    } catch(error) {
      return value;
    }
  }

  function deriveArchiveEraGuesses() {
    var rows = baseRows().filter(row => row.getAttribute('data-type') === 'audio' && row.getAttribute('data-id'));
    var candidates = [];
    var batchGroups = new Map();
    var dayGroups = new Map();
    var monthGroups = new Map();
    rows.forEach(row => {
      var source = [row.getAttribute('data-title'),row.getAttribute('data-name'),row.getAttribute('data-sub'),row.getAttribute('data-project-key')].filter(Boolean).join(' ');
      var batch = source.match(/(?:^|[\s/_-])batch[\s_-]*([a-z0-9]+)/i);
      if(batch) {
        var token = cleanSingleLine(batch[1],30).toLowerCase();
        if(token) {
          if(!batchGroups.has(token)) batchGroups.set(token,[]);
          batchGroups.get(token).push(row);
        }
      }
      var date = archiveEraGuessDate(row);
      if(!date) return;
      if(!dayGroups.has(date)) dayGroups.set(date,[]);
      dayGroups.get(date).push(row);
      var month = date.slice(0,7);
      if(!monthGroups.has(month)) monthGroups.set(month,[]);
      monthGroups.get(month).push(row);
    });
    batchGroups.forEach((group,token) => {
      var unique = Array.from(new Set(group));
      if(unique.length < 3) return;
      var dates = unique.map(archiveEraGuessDate).filter(Boolean).sort();
      candidates.push({
        id:`batch:${token}`,type:'title pattern',name:`batch ${token}`,rows:unique,
        startDate:dates[0] || '',endDate:dates[dates.length - 1] || '',
        confidence:Math.min(.96,.72 + unique.length / 100),
        evidence:`"${`batch ${token}`}" repeats across ${unique.length} audio revisions`
      });
    });
    dayGroups.forEach((group,date) => {
      var worlds = new Set(group.map(projectKeyForRow).filter(Boolean));
      if(group.length < 4 || worlds.size < 2) return;
      candidates.push({
        id:`day:${date}`,type:'dense session',name:`${archiveEraGuessDateLabel(date,false)} sessions`,rows:group,
        startDate:date,endDate:date,confidence:Math.min(.9,.62 + worlds.size * .035 + group.length * .008),
        evidence:`${group.length} revisions from ${worlds.size} Song Worlds were worked on this day`
      });
    });
    monthGroups.forEach((group,month) => {
      var worlds = new Set(group.map(projectKeyForRow).filter(Boolean));
      if(group.length < 14 || worlds.size < 5) return;
      candidates.push({
        id:`month:${month}`,type:'date cluster',name:`${archiveEraGuessDateLabel(month,true)} cluster`,rows:group,
        startDate:`${month}-01`,endDate:group.map(archiveEraGuessDate).filter(Boolean).sort().at(-1) || `${month}-01`,
        confidence:Math.min(.84,.56 + worlds.size * .018 + group.length * .004),
        evidence:`${group.length} revisions across ${worlds.size} Song Worlds cluster in this month`
      });
    });
    var existingNames = new Set(archiveEnrichment.eras.map(era => String(era.name || '').trim().toLowerCase()));
    var existingRanges = new Set(archiveEnrichment.eras.map(era => `${era.start_date || ''}|${era.end_date || ''}`));
    return candidates
      .filter(candidate => !existingNames.has(candidate.name.toLowerCase()) && !existingRanges.has(`${candidate.startDate}|${candidate.endDate}`))
      .sort((a,b) => b.confidence - a.confidence || b.rows.length - a.rows.length)
      .slice(0,12);
  }

  function enrichmentEraGuessesHtml() {
    enrichmentEraGuesses = deriveArchiveEraGuesses();
    if(!enrichmentEraGuesses.length) return `<section class="era-guesses"><div class="era-editor-head"><strong>archive guesses</strong><span>no strong unconfirmed date or title clusters right now</span></div></section>`;
    return `<section class="era-guesses"><div class="era-editor-head"><strong>archive guesses</strong><span>private patterns / nothing changes until you confirm</span></div><div class="era-guess-grid">${enrichmentEraGuesses.map(guess => `<article class="era-guess-card"><small>${escapeHtml(guess.type)} / ${Math.round(guess.confidence * 100)}%</small><strong>${escapeHtml(guess.name)}</strong><p>${escapeHtml(guess.evidence)}</p><span>${guess.rows.length} revisions / ${escapeHtml(guess.startDate || 'open')} to ${escapeHtml(guess.endDate || 'open')}</span><button type="button" onclick="createEraFromArchiveGuess('${escapeAttr(guess.id)}')">review + create</button></article>`).join('')}</div></section>`;
  }

  async function createEraFromArchiveGuess(id) {
    if(!requireAdmin()) return;
    var guess = enrichmentEraGuesses.find(item => item.id === id) || deriveArchiveEraGuesses().find(item => item.id === id);
    if(!guess) return showAppNotice('That archive pattern is no longer available.','error');
    var name = cleanSingleLine(prompt('Name this creative era:',guess.name) || '',100);
    if(!name) return;
    if(!confirm(`Create "${name}" as a private era and assign ${guess.rows.length} matching audio revisions? You can edit every assignment afterward.`)) return;
    var payload = {
      name,slug:'',description:`Archive-assisted suggestion. ${guess.evidence}. Confirmed from the private era review.`,
      start_date:guess.startDate || null,end_date:guess.endDate || null,accent_color:'#ffffff',
      visibility:'private',display_order:archiveEnrichment.eras.length ? Math.max(...archiveEnrichment.eras.map(era => Number(era.display_order || 0))) + 1 : 0
    };
    var result = await supabaseClient.from('archive_eras').insert(payload).select().single();
    if(result.error) return showAppNotice(result.error.message,'error');
    try {
      var count = await assignEraToRows(guess.rows,result.data.id,'primary');
      await loadArchiveEnrichmentData({ force:true });
      renderAdminWorkspace();
      showAppNotice(`${name} created privately with ${count} confirmed revisions.`);
    } catch(error) {
      await loadArchiveEnrichmentData({ force:true });
      renderAdminWorkspace();
      showAppNotice(`The era was created, but its files were not assigned: ${cleanSingleLine(error.message,180)}`,'error');
    }
  }

  function enrichmentEraManagerHtml() {
    var assignedIds = new Set(archiveEnrichment.assetEras.filter(item => item.review_status === 'confirmed').map(item => item.asset_id));
    var unassigned = baseRows().filter(row => row.getAttribute('data-type') === 'audio' && row.getAttribute('data-id') && !assignedIds.has(row.getAttribute('data-id')));
    var conflicts = baseRows().filter(row => (archiveEnrichment.assetErasByAsset.get(row.getAttribute('data-id')) || []).filter(item => item.relationship === 'primary' && item.review_status === 'confirmed').length > 1);
    var selectionCount = selectedArchiveRows().length;
    var worldOptions = worldGroups().map(group => `<option value="${escapeAttr(group.key)}">${escapeHtml(group.title)} / ${group.rows.length} files</option>`).join('');
    var folderOptions = adminFolderPaths().map(path => `<option value="${escapeAttr(path)}">${escapeHtml(path)} / ${adminDescendantRows(path).length} files</option>`).join('');
    var eraOptions = archiveEnrichment.eras.map(era => `<option value="${escapeAttr(era.id)}">${escapeHtml(era.name)}</option>`).join('');
    var cards = archiveEnrichment.eras.map((era,index) => {
      var count = archiveEnrichment.assetEras.filter(item => item.era_id === era.id && item.review_status === 'confirmed').length;
      var cover = era.resolved_cover_url || era.cover_url;
      return `<article class="era-manager-card" style="--era-color:${escapeAttr(era.accent_color || '#ffffff')}">
        <div class="era-manager-art">${cover ? `<img src="${escapeAttr(cover)}" alt="" onerror="this.remove()">` : `<span>${escapeHtml(era.name.slice(0,2).toLowerCase())}</span>`}</div>
        <div class="era-manager-copy"><small>${escapeHtml(era.visibility)} / order ${Number(era.display_order || 0)}</small><strong>${escapeHtml(era.name)}</strong><p>${escapeHtml(era.description || 'No era note yet.')}</p><span>${escapeHtml(era.start_date || 'open')} to ${escapeHtml(era.end_date || 'open')} / ${count} files</span></div>
        <div class="era-manager-actions"><button type="button" onclick="editArchiveEra('${escapeAttr(era.id)}')">edit</button><button type="button" onclick="moveArchiveEra('${escapeAttr(era.id)}',-1)"${index === 0 ? ' disabled' : ''}>up</button><button type="button" onclick="moveArchiveEra('${escapeAttr(era.id)}',1)"${index === archiveEnrichment.eras.length - 1 ? ' disabled' : ''}>down</button><button type="button" onclick="deleteArchiveEra('${escapeAttr(era.id)}')">delete</button></div>
      </article>`;
    }).join('');
    var unassignedRows = unassigned.slice(0,24).map(row => `<button type="button" onclick="openEraUnassignedRow('${escapeAttr(adminRowKey(row))}')"><strong>${escapeHtml(row.getAttribute('data-title'))}</strong><span>${escapeHtml(row.getAttribute('data-ver'))} / ${escapeHtml(row.getAttribute('data-asset-date') || 'undated')}</span></button>`).join('');
    return `<div class="era-manager">
      <section class="era-manager-intro"><div><small>artist-defined chronology + archive-assisted guesses</small><h3>creative eras organize meaning, not files.</h3><p>Akrasia can propose private eras from dense work dates and repeated title patterns such as batches. You still decide what becomes real, and no original file moves.</p><button type="button" onclick="exportArchiveEraTraining()">teach the private analyzer from confirmed eras</button></div><div><span>eras<strong>${archiveEnrichment.eras.length}</strong></span><span>unassigned audio<strong>${unassigned.length}</strong></span><span>conflicts<strong>${conflicts.length}</strong></span></div></section>
      ${enrichmentEraGuessesHtml()}
      <section class="era-editor" id="eraEditor"><input type="hidden" id="eraEditId"><div class="era-editor-head"><strong>define an era</strong><button type="button" onclick="resetArchiveEraEditor()">clear</button></div><div class="era-editor-grid"><label><span>name</span><input id="eraName" maxlength="100" placeholder="artist-defined era name"></label><label><span>visibility</span><select id="eraVisibility"><option value="public">public</option><option value="private">private</option><option value="hidden">hidden</option></select></label><label><span>start date / optional</span><input id="eraStartDate" type="date"></label><label><span>end date / optional</span><input id="eraEndDate" type="date"></label><label><span>accent</span><input id="eraAccent" type="color" value="#ffffff"></label><label><span>cover / optional</span><input id="eraCoverFile" type="file" accept="image/jpeg,image/png,image/webp,image/gif"></label><label class="era-description"><span>what changed in this era</span><textarea id="eraDescription" maxlength="4000" rows="4"></textarea></label></div><button class="primary" type="button" onclick="saveArchiveEra()">save era</button></section>
      <section class="era-assignment"><div class="era-editor-head"><strong>assign without moving files</strong><span>${selectionCount} archive files currently selected</span></div><div class="era-assignment-controls"><select id="eraAssignEra"><option value="">choose era</option>${eraOptions}</select><select id="eraAssignRelationship"><option value="primary">primary</option><option value="secondary">secondary</option></select><button type="button" onclick="assignEraToArchiveSelection()"${selectionCount ? '' : ' disabled'}>assign selection</button><button type="button" onclick="removeEraFromArchiveSelection()"${selectionCount ? '' : ' disabled'}>remove from selection</button></div><div class="era-world-assignment"><select id="eraAssignWorld"><option value="">choose Song World</option>${worldOptions}</select><button type="button" onclick="assignEraToWorld()">assign every revision in world</button></div><div class="era-folder-assignment"><select id="eraAssignFolder"><option value="">choose archive folder</option>${folderOptions}</select><button type="button" onclick="assignEraToFolder()">assign folder contents</button></div></section>
      <section class="era-manager-list"><div class="era-editor-head"><strong>defined eras</strong><span>drag-free order controls preserve a stable chronology</span></div>${cards || '<div class="enrichment-empty">No eras are hard-coded. Define the first one when you are ready.</div>'}</section>
      <details class="era-unassigned"><summary>unassigned audio / ${unassigned.length}</summary><div>${unassignedRows || '<span>Every audio revision has an era.</span>'}</div></details>
    </div>`;
  }

  function resetArchiveEraEditor() {
    ['eraEditId','eraName','eraStartDate','eraEndDate','eraDescription'].forEach(id => { var input=document.getElementById(id); if(input) input.value=''; });
    if(document.getElementById('eraVisibility')) document.getElementById('eraVisibility').value='public';
    if(document.getElementById('eraAccent')) document.getElementById('eraAccent').value='#ffffff';
    if(document.getElementById('eraCoverFile')) document.getElementById('eraCoverFile').value='';
  }

  function editArchiveEra(id) {
    var era = archiveEnrichment.erasById.get(id);
    if(!era) return;
    document.getElementById('eraEditId').value = era.id;
    document.getElementById('eraName').value = era.name || '';
    document.getElementById('eraVisibility').value = era.visibility || 'public';
    document.getElementById('eraStartDate').value = era.start_date || '';
    document.getElementById('eraEndDate').value = era.end_date || '';
    document.getElementById('eraAccent').value = era.accent_color || '#ffffff';
    document.getElementById('eraDescription').value = era.description || '';
    document.getElementById('eraEditor')?.scrollIntoView({ behavior:archiveSettings?.motion === 'off' ? 'auto' : 'smooth',block:'start' });
    document.getElementById('eraName')?.focus();
  }

  async function saveArchiveEra() {
    if(!requireAdmin()) return;
    var id = document.getElementById('eraEditId')?.value || '';
    var payload = {
      name:cleanSingleLine(document.getElementById('eraName')?.value,100),
      slug:'',description:String(document.getElementById('eraDescription')?.value || '').slice(0,4000),
      start_date:document.getElementById('eraStartDate')?.value || null,
      end_date:document.getElementById('eraEndDate')?.value || null,
      accent_color:document.getElementById('eraAccent')?.value || '#ffffff',
      visibility:document.getElementById('eraVisibility')?.value || 'public'
    };
    if(!payload.name) return showAppNotice('Enter an era name.','error');
    if(payload.start_date && payload.end_date && payload.start_date > payload.end_date) return showAppNotice('The era start date is after its end date.','error');
    if(!id) payload.display_order = archiveEnrichment.eras.length ? Math.max(...archiveEnrichment.eras.map(era => Number(era.display_order || 0))) + 1 : 0;
    var result = id ? await supabaseClient.from('archive_eras').update(payload).eq('id',id).select().single() : await supabaseClient.from('archive_eras').insert(payload).select().single();
    if(result.error) return showAppNotice(result.error.message,'error');
    var era = result.data;
    var file = document.getElementById('eraCoverFile')?.files?.[0];
    if(file) {
      var validation = validateAssetFile(file,'image');
      if(validation) return showAppNotice(validation,'error');
      var extension = String(file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g,'') || 'jpg';
      var storagePath = `era-covers/${era.id}.${extension}`;
      var upload = await supabaseClient.storage.from(STORAGE_BUCKET).upload(storagePath,file,{ upsert:true,contentType:file.type || undefined,cacheControl:'3600' });
      if(upload.error) return showAppNotice(`Era saved, but cover upload failed: ${upload.error.message}`,'error');
      var coverUpdate = await supabaseClient.from('archive_eras').update({ cover_storage_path:storagePath,cover_url:'' }).eq('id',era.id);
      if(coverUpdate.error) return showAppNotice(coverUpdate.error.message,'error');
    }
    resetArchiveEraEditor();
    await loadArchiveEnrichmentData({ force:true });
    renderAdminWorkspace();
    showAppNotice('Creative era saved.');
  }

  async function moveArchiveEra(id,direction) {
    if(!requireAdmin()) return;
    var list = archiveEnrichment.eras.slice();
    var index = list.findIndex(era => era.id === id);
    var target = index + Number(direction || 0);
    if(index < 0 || target < 0 || target >= list.length) return;
    [list[index],list[target]] = [list[target],list[index]];
    for(var offset=0; offset<list.length; offset++) {
      var update = await supabaseClient.from('archive_eras').update({ display_order:offset }).eq('id',list[offset].id);
      if(update.error) return showAppNotice(update.error.message,'error');
    }
    await loadArchiveEnrichmentData({ force:true });
    renderAdminWorkspace();
  }

  async function deleteArchiveEra(id) {
    if(!requireAdmin()) return;
    var era = archiveEnrichment.erasById.get(id);
    if(!era || !confirm(`Delete the era "${era.name}" and its assignments? Archive files are not moved or deleted.`)) return;
    var result = await supabaseClient.from('archive_eras').delete().eq('id',id);
    if(result.error) return showAppNotice(result.error.message,'error');
    if(era.cover_storage_path) await supabaseClient.storage.from(STORAGE_BUCKET).remove([era.cover_storage_path]);
    await loadArchiveEnrichmentData({ force:true });
    renderAdminWorkspace();
  }

  async function assignEraToRows(rows,eraId,relationship) {
    var ids = Array.from(new Set((rows || []).map(row => row.getAttribute('data-id')).filter(Boolean))).slice(0,2000);
    if(!ids.length || !eraId) throw new Error('Choose archive revisions and an era.');
    if(relationship === 'primary') {
      for(var offset=0; offset<ids.length; offset+=100) {
        var demote = await supabaseClient.from('archive_asset_eras').update({ relationship:'secondary' }).in('asset_id',ids.slice(offset,offset+100)).eq('relationship','primary').eq('review_status','confirmed');
        if(demote.error) throw demote.error;
      }
    }
    var values = ids.map(asset_id => ({ asset_id,era_id:eraId,relationship,source:'manual',confidence:null,review_status:'confirmed' }));
    for(var index=0; index<values.length; index+=200) {
      var result = await supabaseClient.from('archive_asset_eras').upsert(values.slice(index,index+200),{ onConflict:'asset_id,era_id' });
      if(result.error) throw result.error;
    }
    return ids.length;
  }

  async function assignEraToArchiveSelection() {
    if(!requireAdmin()) return;
    var eraId = document.getElementById('eraAssignEra')?.value;
    var relationship = document.getElementById('eraAssignRelationship')?.value || 'primary';
    try {
      var count = await assignEraToRows(selectedArchiveRows(),eraId,relationship);
      await loadArchiveEnrichmentData({ force:true });
      renderAdminWorkspace();
      showAppNotice(`${count} selected revision${count === 1 ? '' : 's'} assigned.`);
    } catch(error) { showAppNotice(error.message,'error'); }
  }

  async function assignEraToWorld() {
    if(!requireAdmin()) return;
    var eraId = document.getElementById('eraAssignEra')?.value;
    var relationship = document.getElementById('eraAssignRelationship')?.value || 'primary';
    var world = getWorld(document.getElementById('eraAssignWorld')?.value || '');
    if(!world) return showAppNotice('Choose a Song World.','error');
    if(!confirm(`Assign all ${world.rows.length} revisions and artifacts in "${world.title}" to this era? Individual versions can be changed afterward.`)) return;
    try {
      var count = await assignEraToRows(world.rows,eraId,relationship);
      await loadArchiveEnrichmentData({ force:true });
      renderAdminWorkspace();
      showAppNotice(`${count} world files assigned.`);
    } catch(error) { showAppNotice(error.message,'error'); }
  }

  async function assignEraToFolder() {
    if(!requireAdmin()) return;
    var eraId = document.getElementById('eraAssignEra')?.value;
    var relationship = document.getElementById('eraAssignRelationship')?.value || 'primary';
    var path = normalizeFolderPath(document.getElementById('eraAssignFolder')?.value || '');
    if(!eraId || !path) return showAppNotice('Choose an era and an archive folder.','error');
    var rows = adminDescendantRows(path);
    if(!rows.length) return showAppNotice('That folder has no indexed files.','error');
    if(!confirm(`Assign the ${rows.length} current files inside "${path}" to this era? The folder and files stay where they are.`)) return;
    try {
      var count = await assignEraToRows(rows,eraId,relationship);
      await loadArchiveEnrichmentData({ force:true });
      renderAdminWorkspace();
      showAppNotice(`${count} files from ${folderDisplayName(path)} assigned.`);
    } catch(error) { showAppNotice(error.message,'error'); }
  }

  async function removeEraFromArchiveSelection() {
    if(!requireAdmin()) return;
    var eraId = document.getElementById('eraAssignEra')?.value;
    var ids = selectedArchiveRows().map(row => row.getAttribute('data-id')).filter(Boolean);
    if(!eraId || !ids.length) return showAppNotice('Choose an era and selected archive revisions.','error');
    var result = await supabaseClient.from('archive_asset_eras').delete().eq('era_id',eraId).in('asset_id',ids.slice(0,2000));
    if(result.error) return showAppNotice(result.error.message,'error');
    await loadArchiveEnrichmentData({ force:true });
    renderAdminWorkspace();
  }

  function openEraUnassignedRow(key) {
    var row = adminRowFromKey(key);
    if(!row) return;
    setArchiveEntrySelected(row,true);
    openAdminWorkspacePlace('folder',row.getAttribute('data-sub') || '');
    adminSelectWorkspaceRow(key);
  }

  function enrichmentTagManagerHtml() {
    var filtered = archiveEnrichment.tags.filter(tag => !adminWorkspaceQuery || [tag.name,tag.slug,tag.category,tag.description].join(' ').toLowerCase().includes(adminWorkspaceQuery));
    var targetOptions = archiveEnrichment.tags.map(tag => `<option value="${escapeAttr(tag.id)}">${escapeHtml(tag.category)} / ${escapeHtml(tag.name)}</option>`).join('');
    var rows = filtered.map(tag => {
      var uses = archiveEnrichment.assetTags.filter(item => item.tag_id === tag.id).length;
      var aliases = archiveEnrichment.aliases.filter(item => item.tag_id === tag.id);
      return `<article class="tag-manager-row"><span class="tag-manager-category">${escapeHtml(tag.category)}</span><div><strong>${escapeHtml(tag.name)}</strong><small>${escapeHtml(tag.slug)}${aliases.length ? ` / aliases: ${escapeHtml(aliases.map(item => item.alias).join(', '))}` : ''}</small><p>${escapeHtml(tag.description || 'No vocabulary note.')}</p></div><span class="tag-manager-use">${uses} files<br>${escapeHtml(tag.visibility)}</span><div><button type="button" onclick="editArchiveTag('${escapeAttr(tag.id)}')">edit</button><button type="button" onclick="addArchiveTagAlias('${escapeAttr(tag.id)}')">alias</button><button type="button" onclick="deleteArchiveTag('${escapeAttr(tag.id)}')">delete</button></div></article>`;
    }).join('');
    return `<div class="tag-manager">
      <section class="tag-manager-intro"><div><small>one controlled language</small><h3>tags should connect the archive, not split into spelling variants.</h3><p>Aliases resolve searches without creating duplicate public tags. Hiding a tag removes it from public metadata while preserving its relationships.</p></div><div><span>tags<strong>${archiveEnrichment.tags.length}</strong></span><span>aliases<strong>${archiveEnrichment.aliases.length}</strong></span><span>relationships<strong>${archiveEnrichment.assetTags.length}</strong></span></div></section>
      <section class="tag-editor"><input type="hidden" id="tagEditId"><div class="tag-editor-grid"><label><span>name</span><input id="tagName" maxlength="80"></label><label><span>category</span><select id="tagCategory">${ENRICHMENT_TAG_CATEGORIES.map(category => `<option value="${category}">${category.replace(/-/g,' ')}</option>`).join('')}</select></label><label><span>visibility</span><select id="tagVisibility"><option value="public">public</option><option value="private">private</option><option value="hidden">hidden</option></select></label><label class="tag-description"><span>definition</span><input id="tagDescription" maxlength="1000"></label></div><div><button class="primary" type="button" onclick="saveArchiveTag()">save tag</button><button type="button" onclick="resetArchiveTagEditor()">clear</button></div></section>
      <section class="tag-merge"><strong>merge duplicates</strong><select id="tagMergeSource"><option value="">source tag</option>${targetOptions}</select><span>into</span><select id="tagMergeTarget"><option value="">target tag</option>${targetOptions}</select><button type="button" onclick="mergeArchiveTags()">merge</button></section>
      <section class="tag-manager-list">${rows || '<div class="enrichment-empty">No tags match this search.</div>'}</section>
    </div>`;
  }

  function resetArchiveTagEditor() {
    ['tagEditId','tagName','tagDescription'].forEach(id => { var input=document.getElementById(id); if(input) input.value=''; });
    if(document.getElementById('tagVisibility')) document.getElementById('tagVisibility').value='public';
  }

  function editArchiveTag(id) {
    var tag = archiveEnrichment.tagsById.get(id);
    if(!tag) return;
    document.getElementById('tagEditId').value=tag.id;
    document.getElementById('tagName').value=tag.name;
    document.getElementById('tagCategory').value=tag.category;
    document.getElementById('tagVisibility').value=tag.visibility;
    document.getElementById('tagDescription').value=tag.description || '';
    document.querySelector('.tag-editor')?.scrollIntoView({ behavior:archiveSettings?.motion === 'off' ? 'auto' : 'smooth',block:'start' });
  }

  async function saveArchiveTag() {
    if(!requireAdmin()) return;
    var id=document.getElementById('tagEditId')?.value || '';
    var payload={ name:cleanSingleLine(document.getElementById('tagName')?.value,80),slug:'',category:document.getElementById('tagCategory')?.value,visibility:document.getElementById('tagVisibility')?.value,description:cleanSingleLine(document.getElementById('tagDescription')?.value,1000) };
    if(!payload.name) return showAppNotice('Enter a tag name.','error');
    var result=id ? await supabaseClient.from('archive_tags').update(payload).eq('id',id) : await supabaseClient.from('archive_tags').insert(payload);
    if(result.error) return showAppNotice(result.error.message,'error');
    resetArchiveTagEditor();
    await loadArchiveEnrichmentData({ force:true });
    renderAdminWorkspace();
  }

  async function addArchiveTagAlias(id) {
    if(!requireAdmin()) return;
    var alias=cleanSingleLine(prompt('Alias spelling or phrase:') || '',80);
    if(!alias) return;
    var result=await supabaseClient.from('archive_tag_aliases').insert({ alias,alias_slug:'',tag_id:id });
    if(result.error) return showAppNotice(result.error.message,'error');
    await loadArchiveEnrichmentData({ force:true });
    renderAdminWorkspace();
  }

  async function mergeArchiveTags() {
    if(!requireAdmin()) return;
    var source=document.getElementById('tagMergeSource')?.value;
    var target=document.getElementById('tagMergeTarget')?.value;
    if(!source || !target || source===target) return showAppNotice('Choose two different tags.','error');
    if(!confirm('Merge every relationship and alias into the target tag?')) return;
    var result=await supabaseClient.rpc('merge_archive_tags',{ p_source_tag:source,p_target_tag:target });
    if(result.error) return showAppNotice(result.error.message,'error');
    await loadArchiveEnrichmentData({ force:true });
    renderAdminWorkspace();
  }

  async function deleteArchiveTag(id) {
    if(!requireAdmin()) return;
    var tag=archiveEnrichment.tagsById.get(id);
    if(!tag || !confirm(`Delete "${tag.name}" and remove it from every file?`)) return;
    var result=await supabaseClient.from('archive_tags').delete().eq('id',id);
    if(result.error) return showAppNotice(result.error.message,'error');
    await loadArchiveEnrichmentData({ force:true });
    renderAdminWorkspace();
  }

  function initArchiveEnrichment() {
    restoreEnrichmentReviewState();
    document.addEventListener('keydown',handleEnrichmentReviewKeys);
    document.addEventListener('visibilitychange',function(){ if(document.hidden) flushEnrichmentDraftCapture(); });
    window.addEventListener('pagehide',flushEnrichmentDraftCapture);
    window.addEventListener('storage',function(event){
      if(event.key !== ENRICHMENT_DRAFTS_KEY || !enrichmentSelectedSuggestionId) return;
      if(document.hasFocus() && document.activeElement?.closest?.('.enrichment-lyrics-editor')) return;
      var recovered = enrichmentLocalDraft(enrichmentSelectedSuggestionId);
      if(recovered === null) return;
      enrichmentEditorDraft = recovered;
      enrichmentEditorDraftInitializedFor = enrichmentSelectedSuggestionId;
      if(adminWorkspaceMode === 'enrichment' && adminWorkspaceIsOpen()) renderEnrichmentInspector();
    });
    if(supabaseClient) loadArchiveEnrichmentData();
  }

  function eraRows(eraId) {
    var assetIds = new Set(archiveEnrichment.assetEras.filter(item => item.era_id === eraId && item.review_status === 'confirmed').map(item => item.asset_id));
    return baseRows().filter(row => assetIds.has(row.getAttribute('data-id')));
  }

  function renderCreativeErasWorlds() {
    var body = document.getElementById('worldsBody');
    if(!body) return;
    var assigned = new Set(archiveEnrichment.assetEras.filter(item => item.review_status === 'confirmed').map(item => item.asset_id));
    var unassigned = baseRows().filter(row => row.getAttribute('data-id') && !assigned.has(row.getAttribute('data-id')));
    var cards = archiveEnrichment.eras.map((era,index) => {
      var rows = eraRows(era.id);
      var worlds = new Set(rows.map(projectKeyForRow));
      var cover = era.resolved_cover_url || era.cover_url;
      return `<button class="creative-era-card" type="button" style="--era-color:${escapeAttr(era.accent_color || '#ffffff')};--era-index:${index}" onclick="openCreativeEraWorld('${escapeAttr(era.id)}')">${cover ? `<img src="${escapeAttr(cover)}" alt="" onerror="this.remove()">` : '<span class="creative-era-field"></span>'}<span class="creative-era-card-copy"><small>${escapeHtml(`${era.start_date || 'open'} / ${era.end_date || 'open'}`)}</small><strong>${escapeHtml(era.name)}</strong><span>${escapeHtml(era.description || 'Artist-defined archive era.')}</span><em>${rows.length} files / ${worlds.size} song worlds</em></span><i>enter era</i></button>`;
    }).join('');
    body.innerHTML = `<section class="worlds-intro creative-era-intro"><div class="worlds-intro-copy"><div class="worlds-kicker">creative eras / artist-defined chronology</div><h1 class="worlds-title">the archive changes when angel changes.</h1><p class="worlds-copy">Eras connect revisions by creative identity without moving the original files. A Song World can cross boundaries, and each version keeps its own place in time.</p></div><div class="world-summary"><div>eras<strong>${archiveEnrichment.eras.length}</strong></div><div>assigned<strong>${assigned.size}</strong></div><div>unassigned<strong>${unassigned.length}</strong></div></div></section><section class="creative-era-grid">${cards || '<div class="world-empty">No public creative eras have been defined yet. The normal archive and timeline remain complete.</div>'}</section>${unassigned.length ? `<section class="world-section creative-era-unassigned"><div class="world-section-head"><h3>outside an era</h3><span>${unassigned.length} files remain visible in the archive</span></div><div class="world-file-list">${unassigned.slice(0,40).map((row,index) => worldFileHtml(row,index)).join('')}</div></section>` : ''}`;
  }

  function openCreativeEraWorld(id) {
    var era = archiveEnrichment.erasById.get(id);
    var body = document.getElementById('worldsBody');
    if(!era || !body) return;
    var rows = eraRows(id).sort((a,b) => String(a.getAttribute('data-date') || '').localeCompare(String(b.getAttribute('data-date') || '')));
    var groups = new Map();
    rows.forEach(row => {
      var key = projectKeyForRow(row);
      if(!groups.has(key)) groups.set(key,{ title:worldTitleForRow(row),rows:[] });
      groups.get(key).rows.push(row);
    });
    var cover = era.resolved_cover_url || era.cover_url;
    var groupHtml = Array.from(groups.values()).map(group => `<section class="world-section"><div class="world-section-head"><h3>${escapeHtml(group.title)}</h3><span>${group.rows.length} files in this era</span></div><div class="world-file-list">${group.rows.map((row,index) => worldFileHtml(row,index)).join('')}</div></section>`).join('');
    body.innerHTML = `<section class="creative-era-detail" style="--era-color:${escapeAttr(era.accent_color || '#ffffff')}"><button type="button" class="creative-era-back" onclick="renderCreativeErasWorlds()">back to eras</button><div class="creative-era-detail-hero">${cover ? `<img src="${escapeAttr(cover)}" alt="">` : '<span></span>'}<div><small>${escapeHtml(`${era.start_date || 'open beginning'} to ${era.end_date || 'open ending'}`)}</small><h1>${escapeHtml(era.name)}</h1><p>${escapeHtml(era.description || 'This era has no public note yet.')}</p><em>${rows.length} connected files / ${groups.size} song worlds</em></div></div>${groupHtml || '<div class="world-empty">This era is defined, but no public archive revisions are assigned yet.</div>'}</section>`;
    body.scrollTo({ top:0,behavior:archiveSettings?.motion === 'off' ? 'auto' : 'smooth' });
  }

  function creativeEraTimelineGroups() {
    var groups = archiveEnrichment.eras.map(era => ({ key:era.id,era,rows:[] }));
    var byId = new Map(groups.map(group => [group.key,group]));
    var unassigned = { key:'unassigned',era:{ name:'outside an era',description:'Dated archive files without a confirmed creative-era assignment.',accent_color:'#777777' },rows:[] };
    baseRows().filter(timelineRowMatchesFilter).forEach(row => {
      var relations = archiveEnrichment.assetErasByAsset.get(row.getAttribute('data-id')) || [];
      var primary = relations.find(item => item.review_status === 'confirmed' && item.relationship === 'primary') || relations.find(item => item.review_status === 'confirmed');
      var target = primary && byId.get(primary.era_id);
      (target || unassigned).rows.push(row);
    });
    groups.forEach(group => group.rows.sort((a,b) => String(a.getAttribute('data-date') || '').localeCompare(String(b.getAttribute('data-date') || ''))));
    unassigned.rows.sort((a,b) => String(a.getAttribute('data-date') || '').localeCompare(String(b.getAttribute('data-date') || '')));
    if(!timelineAscending) groups.forEach(group => group.rows.reverse());
    return groups.filter(group => group.rows.length).concat(unassigned.rows.length ? [unassigned] : []);
  }

  function buildCreativeEraTimeline(track) {
    var groups = creativeEraTimelineGroups();
    if(!groups.length) {
      track.innerHTML = '<div class="immersive-empty">no files match this creative-era signal</div>';
      return;
    }
    var sections = groups.map((group,index) => {
      var era = group.era;
      var dates = group.rows.map(timelineDateForRow).filter(Boolean).sort();
      var files = group.rows.map((row,rowIndex) => {
        var otherEras = acceptedErasForRow(row).filter(item => item.id !== group.key).map(item => item.name);
        return `<button class="immersive-file creative-era-file" type="button" data-row-key="${escapeAttr(timelineRowKey(row))}" style="--dot-color:${escapeAttr(era.accent_color || '#ffffff')};--file-index:${Math.min(rowIndex,12)}"><span class="immersive-file-number">${String(rowIndex + 1).padStart(2,'0')}</span><span class="immersive-file-icon"></span><span class="immersive-file-main"><strong>${escapeHtml(row.getAttribute('data-title') || 'untitled')}</strong><span class="immersive-file-sub">${escapeHtml(row.getAttribute('data-sub') || 'archive')} / ${escapeHtml(row.getAttribute('data-ver') || 'v1')}${otherEras.length ? ` / also ${escapeHtml(otherEras.join(' + '))}` : ''}</span></span><span class="immersive-file-actions"><span class="immersive-file-time">${escapeHtml(timelineDisplayTimeForRow(row) || row.getAttribute('data-type') || 'asset')}</span><span class="immersive-info" data-row-key="${escapeAttr(timelineRowKey(row))}">info</span></span></button>`;
      }).join('');
      return `<section class="immersive-day creative-era-timeline-section" data-immersive-day data-creative-era="${escapeAttr(group.key)}" style="--day-index:${index};--dot-color:${escapeAttr(era.accent_color || '#ffffff')}"><div class="immersive-day-label"><small>creative era ${String(index + 1).padStart(2,'0')}</small><strong>${escapeHtml(era.name)}</strong><span>${group.rows.length} indexed / ${escapeHtml(dates.length ? `${dates[0]} to ${dates[dates.length - 1]}` : 'undated')}<br>${escapeHtml(era.description || '')}</span></div><div class="immersive-files">${files}</div></section>`;
    }).join('');
    var rail = groups.map((group,index) => `<button type="button" onclick="jumpToCreativeEra('${escapeAttr(group.key)}')"><span>${String(index + 1).padStart(2,'0')}</span>${escapeHtml(group.era.name)}</button>`).join('');
    track.innerHTML = `<div class="immersive-timeline-list creative-era-timeline-list">${sections}</div><div class="creative-era-rail">${rail}</div>`;
  }

  function jumpToCreativeEra(id) {
    var track = document.getElementById('timelineTrack');
    var section = track?.querySelector(`[data-creative-era="${cssEscape(id)}"]`);
    if(!track || !section) return;
    track.scrollTo({ top:Math.max(0,section.offsetTop - track.clientHeight * .1),behavior:archiveSettings?.motion === 'off' ? 'auto' : 'smooth' });
  }

  function boundedAnalysisNumber(value,min,max) {
    var number = Number(value);
    return Number.isFinite(number) && number >= min && number <= max ? number : null;
  }

  function privateLyricsPayload(value) {
    value = value && typeof value === 'object' ? value : {};
    var wordBudget = 12000;
    var segments = Array.isArray(value.segments) ? value.segments.slice(0,1500).map(segment => {
      var words = Array.isArray(segment.words) ? segment.words.slice(0,wordBudget).map(word => ({
        start:boundedAnalysisNumber(word.start,0,86400),end:boundedAnalysisNumber(word.end,0,86400),
        text:cleanSingleLine(word.text,120),probability:boundedAnalysisNumber(word.probability,0,1),unclear:Boolean(word.unclear)
      })) : [];
      wordBudget -= words.length;
      return {
        start:boundedAnalysisNumber(segment.start,0,86400),end:boundedAnalysisNumber(segment.end,0,86400),
        text:cleanSingleLine(segment.text,500),renderedText:cleanSingleLine(segment.renderedText || segment.text,500),
        confidence:boundedAnalysisNumber(segment.confidence,0,1),
        lane:['lead','main','adlib','bg','background','effect'].includes(segment.lane) ? segment.lane : 'main',
        unclear:Boolean(segment.unclear),words
      };
    }) : [];
    var payload = {
      syncedText:cleanSyncedLyrics(value.syncedText || ''),format:'akrasia-synced-text',
      detectedLanguage:cleanSingleLine(value.detectedLanguage,24),languageProbability:boundedAnalysisNumber(value.languageProbability,0,1),
      vocalInstrumentalStatus:cleanSingleLine(value.vocalInstrumentalStatus,32),
      instrumentalSections:Array.isArray(value.instrumentalSections) ? value.instrumentalSections.slice(0,500).map(section => ({ start:boundedAnalysisNumber(section.start,0,86400),end:boundedAnalysisNumber(section.end,0,86400) })) : [],
      segments,
      model:{ adapter:cleanSingleLine(value.model?.adapter,80),name:cleanSingleLine(value.model?.name,120),version:cleanSingleLine(value.model?.version,160) }
    };
    if(JSON.stringify(payload).length > 1800000) payload.segments.forEach(segment => { segment.words=[]; });
    return payload;
  }

  function privateAudioMetadataPayload(value) {
    value = value && typeof value === 'object' ? value : {};
    return {
      durationSeconds:boundedAnalysisNumber(value.durationSeconds,0,86400),bitrateKbps:boundedAnalysisNumber(value.bitrateKbps,0,100000),
      sampleRateHz:boundedAnalysisNumber(value.sampleRateHz,1000,768000),channels:boundedAnalysisNumber(value.channels,1,64),
      estimatedBpm:boundedAnalysisNumber(value.estimatedBpm,20,400),bpmConfidence:boundedAnalysisNumber(value.bpmConfidence,0,1),
      estimatedMusicalKey:cleanSingleLine(value.estimatedMusicalKey,40),keyConfidence:boundedAnalysisNumber(value.keyConfidence,0,1),
      estimatedTimeSignature:cleanSingleLine(value.estimatedTimeSignature,20),timeSignatureConfidence:boundedAnalysisNumber(value.timeSignatureConfidence,0,1),
      integratedLoudnessLufs:boundedAnalysisNumber(value.integratedLoudnessLufs,-100,20),tempoCategory:cleanSingleLine(value.tempoCategory,32),
      detectedLanguage:cleanSingleLine(value.detectedLanguage,24),vocalInstrumentalStatus:cleanSingleLine(value.vocalInstrumentalStatus,32),
      rmsMeanDb:boundedAnalysisNumber(value.rmsMeanDb,-160,20),rmsStdDb:boundedAnalysisNumber(value.rmsStdDb,0,100),
      dynamicRangeDb:boundedAnalysisNumber(value.dynamicRangeDb,0,160),onsetRatePerSecond:boundedAnalysisNumber(value.onsetRatePerSecond,0,100),
      spectralCentroidHz:boundedAnalysisNumber(value.spectralCentroidHz,0,100000),spectralBandwidthHz:boundedAnalysisNumber(value.spectralBandwidthHz,0,100000),
      zeroCrossingRate:boundedAnalysisNumber(value.zeroCrossingRate,0,1),energyScore:boundedAnalysisNumber(value.energyScore,0,1),
      energyConfidence:boundedAnalysisNumber(value.energyConfidence,0,1),
      analyzer:cleanSingleLine(value.analyzer,120),analyzerVersion:cleanSingleLine(value.analyzerVersion,160)
    };
  }

  function privateTagSuggestions(value) {
    return (Array.isArray(value) ? value : []).slice(0,80).map(tag => ({
      value:cleanSingleLine(tag.value,80).toLowerCase(),name:cleanSingleLine(tag.name || tag.value,80),
      category:ENRICHMENT_TAG_CATEGORIES.includes(tag.category) ? tag.category : '',confidence:boundedAnalysisNumber(tag.confidence,0,1),
      evidenceSource:cleanSingleLine(tag.evidenceSource,80),explanation:cleanSingleLine(tag.explanation,280),
      model:cleanSingleLine(tag.model,120),modelVersion:cleanSingleLine(tag.modelVersion,160),createdAt:cleanSingleLine(tag.createdAt,80)
    })).filter(tag => tag.value && tag.category);
  }

  function suggestionAverageConfidence(values) {
    var numbers = values.map(Number).filter(Number.isFinite);
    return numbers.length ? numbers.reduce((sum,value) => sum + value,0) / numbers.length : 0;
  }

  function bandlabAnalysisSuggestionRecords(item) {
    var analysis = item?.analysis;
    if(!analysis || !item.existingRow && item.status === 'unchanged') return [];
    var fingerprint = cleanSourceToken(analysis.cache?.fingerprint,128) || stableSourceHash(`${item.revisionId}|${analysis.sourceSha256}|${analysis.analyzedAt}`);
    var status = item.analysisStale ? 'stale' : (analysis.analysisStatus === 'complete' && !analysis.warnings?.length ? 'pending' : 'needs_review');
    var common = {
      asset_id:item.existingRow?.getAttribute('data-id') || '',source_revision_id:item.revisionId,
      source_sha256:analysis.sourceSha256 || item.sha256 || '',status,
      evidence:{ analyzedAt:analysis.analyzedAt || '',warnings:(analysis.warnings || []).slice(0,30),sidecarSchema:1 }
    };
    var records = [];
    var lyrics = privateLyricsPayload(analysis.lyrics);
    if(lyrics.syncedText || lyrics.vocalInstrumentalStatus === 'instrumental') records.push(Object.assign({},common,{
      kind:'lyrics',payload:lyrics,confidence:suggestionAverageConfidence(lyrics.segments.map(segment => segment.confidence).concat([lyrics.languageProbability])),
      model_name:lyrics.model.name || lyrics.model.adapter || 'local transcription',model_version:lyrics.model.version || '',cache_key:`${fingerprint}:lyrics`
    }));
    var metadata = privateAudioMetadataPayload(analysis.audioMetadata);
    if(Object.values(metadata).some(value => value !== null && value !== '')) records.push(Object.assign({},common,{
      kind:'audio_metadata',payload:metadata,confidence:suggestionAverageConfidence([metadata.bpmConfidence,metadata.keyConfidence,metadata.timeSignatureConfidence]),
      model_name:metadata.analyzer || 'local audio analyzer',model_version:metadata.analyzerVersion || '',cache_key:`${fingerprint}:audio`
    }));
    var tags = privateTagSuggestions(analysis.tagSuggestions);
    if(tags.length) records.push(Object.assign({},common,{
      kind:'tags',payload:{ suggestions:tags },confidence:suggestionAverageConfidence(tags.map(tag => tag.confidence)),
      model_name:tags[0].model || 'local tagger',model_version:tags[0].modelVersion || '',cache_key:`${fingerprint}:tags`
    }));
    var eraEvidence = analysis.eraEvidence || {};
    var eraCandidates = (Array.isArray(eraEvidence.candidates) ? eraEvidence.candidates : []).slice(0,5).map(candidate => ({
      eraId:cleanSourceToken(candidate.eraId,100),eraName:cleanSingleLine(candidate.eraName,100),
      confidence:boundedAnalysisNumber(candidate.confidence,0,1) || 0,
      evidence:(Array.isArray(candidate.evidence) ? candidate.evidence : []).slice(0,8).map(value => cleanSingleLine(value,240)).filter(Boolean)
    })).filter(candidate => candidate.eraId || candidate.eraName);
    if(eraEvidence.suggestedEraId || eraEvidence.suggestedEraName || eraCandidates.length) records.push(Object.assign({},common,{
      kind:'era',payload:{ eraEvidence:{
        suggestedEraId:cleanSourceToken(eraEvidence.suggestedEraId,100),suggestedEraName:cleanSingleLine(eraEvidence.suggestedEraName,100),
        confidence:boundedAnalysisNumber(eraEvidence.confidence,0,1) || 0,candidates:eraCandidates,
        revisionDateTime:cleanSingleLine(eraEvidence.revisionDateTime,120),explanation:cleanSingleLine(eraEvidence.explanation,500)
      } },
      evidence:{ analyzedAt:analysis.analyzedAt || '',revisionDateTime:cleanSingleLine(eraEvidence.revisionDateTime,120),explanation:cleanSingleLine(eraEvidence.explanation,500) },
      confidence:boundedAnalysisNumber(eraEvidence.confidence,0,1) || 0,model_name:cleanSingleLine(eraEvidence.model,120) || 'local era evidence',model_version:cleanSingleLine(eraEvidence.modelVersion,160),cache_key:`${fingerprint}:era`
    }));
    return records.map(record => { record.cache_key=record.cache_key.slice(0,180); return record; });
  }

  function bandlabAnalysisNeedsSync(item) {
    if(!item?.analysis) return false;
    var records = bandlabAnalysisSuggestionRecords(item);
    if(!records.length) return false;
    var assetId = item.existingRow?.getAttribute('data-id');
    if(!assetId || !archiveEnrichment.ready) return true;
    var current = archiveEnrichment.suggestionsByAsset.get(assetId) || [];
    return records.some(record => !current.some(suggestion => suggestion.kind === record.kind && suggestion.cache_key === record.cache_key));
  }

  async function saveBandlabAnalysisSuggestions(assetId,item) {
    if(!assetId || !item?.analysis) return 0;
    var records = bandlabAnalysisSuggestionRecords(item).map(record => Object.assign({},record,{ asset_id:assetId }));
    if(!records.length) return 0;
    if(item.sha256) {
      var stale = await supabaseClient.from('archive_enrichment_suggestions').update({ status:'stale',review_note:'source audio hash changed during BandLab resync' }).eq('asset_id',assetId).in('status',['pending','draft','needs_review']).neq('source_sha256',item.sha256);
      if(stale.error && !enrichmentErrorIsMissingSchema(stale.error)) throw stale.error;
    }
    var result = await supabaseClient.from('archive_enrichment_suggestions').upsert(records,{ onConflict:'asset_id,kind,cache_key',ignoreDuplicates:true });
    if(result.error) {
      if(enrichmentErrorIsMissingSchema(result.error)) throw new Error('The private enrichment tables are missing. Run the updated supabase-setup.sql first.');
      throw result.error;
    }
    item.analysisSyncNeeded = false;
    return records.length;
  }
