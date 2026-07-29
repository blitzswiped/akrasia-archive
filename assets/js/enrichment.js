  // ---- CATALOG ENRICHMENT -------------------------------------------------
  var archiveEnrichment = {
    ready:false, loading:false, schemaMissing:false, eraHierarchyAvailable:false, eraNotesAvailable:false, error:'', refreshError:'', waiters:[],
    suggestions:[], tags:[], aliases:[], assetTags:[], metadata:[], eras:[], assetEras:[],
    suggestionsByAsset:new Map(), suggestionsById:new Map(), tagsById:new Map(), assetTagsByAsset:new Map(),
    aliasesByTag:new Map(), metadataByAsset:new Map(), erasById:new Map(), assetErasByAsset:new Map()
  };
  var enrichmentWorkspaceTab = 'review';
  var enrichmentReviewStatus = 'pending';
  var enrichmentReviewKind = 'all';
  var enrichmentReviewSignal = 'all';
  var enrichmentReviewConfidence = 0;
  var enrichmentReviewQuery = '';
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
  var enrichmentFlowRefreshTimer = 0;
  var enrichmentFlowLines = [];
  var enrichmentFlowGroups = [];
  var enrichmentFlowDurationValue = 1;
  var enrichmentFlowActiveKey = '';
  var ENRICHMENT_REVIEW_STATE_KEY = 'akrasia-enrichment-review-state-v2';
  var ENRICHMENT_DRAFTS_KEY = 'akrasia-enrichment-local-drafts-v1';
  var ENRICHMENT_ERA_EDITOR_DRAFT_KEY = 'akrasia-era-editor-draft-v1';
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
    archiveEnrichment.eraHierarchyAvailable = false;
    archiveEnrichment.eraNotesAvailable = false;
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

  function readArchiveEraEditorDraft() {
    try {
      var value = JSON.parse(sessionStorage.getItem(ENRICHMENT_ERA_EDITOR_DRAFT_KEY) || 'null');
      return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
    } catch(error) {
      return null;
    }
  }

  function captureArchiveEraEditorDraft() {
    var editor = document.getElementById('eraEditor');
    if(!editor) return;
    var value = id => document.getElementById(id)?.value || '';
    var draft = {
      id:value('eraEditId'),name:value('eraName'),parentId:value('eraParent'),
      visibility:value('eraVisibility') || 'public',startDate:value('eraStartDate'),endDate:value('eraEndDate'),
      accent:value('eraAccent') || '#ffffff',description:value('eraDescription'),notes:value('eraNotes'),
      removeCover:Boolean(document.getElementById('eraRemoveCover')?.checked),
      coverFileName:document.getElementById('eraCoverFile')?.files?.[0]?.name || '',
      panelOpen:Boolean(document.getElementById('eraEditorPanel')?.open)
    };
    try { sessionStorage.setItem(ENRICHMENT_ERA_EDITOR_DRAFT_KEY,JSON.stringify(draft)); } catch(error) {}
  }

  function clearArchiveEraEditorDraft() {
    try { sessionStorage.removeItem(ENRICHMENT_ERA_EDITOR_DRAFT_KEY); } catch(error) {}
  }

  function updateArchiveEraCoverControls() {
    var id = document.getElementById('eraEditId')?.value || '';
    var era = archiveEnrichment.erasById.get(id);
    var cover = era?.resolved_cover_url || era?.cover_url || '';
    var current = document.getElementById('eraCurrentCover');
    var removeWrap = document.getElementById('eraRemoveCoverWrap');
    if(current) {
      current.hidden = !cover;
      current.innerHTML = cover ? `<img src="${escapeAttr(cover)}" alt=""><span>current era cover</span>` : '';
    }
    if(removeWrap) removeWrap.hidden = !cover;
  }

  function restoreArchiveEraEditorDraft() {
    var draft = readArchiveEraEditorDraft();
    if(!draft || !document.getElementById('eraEditor')) return;
    var set = function(id,value) {
      var input = document.getElementById(id);
      if(input) input.value = value == null ? '' : value;
    };
    set('eraEditId',draft.id);
    set('eraName',draft.name);
    set('eraVisibility',draft.visibility || 'public');
    set('eraStartDate',draft.startDate);
    set('eraEndDate',draft.endDate);
    set('eraAccent',draft.accent || '#ffffff');
    set('eraDescription',draft.description);
    set('eraNotes',draft.notes);
    var parent = document.getElementById('eraParent');
    if(parent && archiveEnrichment.eraHierarchyAvailable) {
      parent.innerHTML = `<option value="">top-level era</option>${archiveEraParentOptions(draft.id || '',draft.parentId || '')}`;
      parent.value = draft.parentId || '';
    }
    var remove = document.getElementById('eraRemoveCover');
    if(remove) remove.checked = Boolean(draft.removeCover);
    var panel = document.getElementById('eraEditorPanel');
    if(panel) panel.open = draft.panelOpen !== false;
    var era = archiveEnrichment.erasById.get(draft.id);
    var title = document.getElementById('eraEditorTitle');
    if(title) title.textContent = era ? `edit ${era.name}` : (draft.parentId && archiveEnrichment.erasById.get(draft.parentId) ? `new sub-era inside ${archiveEnrichment.erasById.get(draft.parentId).name}` : 'create or edit an era');
    var fileState = document.getElementById('eraCoverFileState');
    if(fileState) fileState.textContent = draft.coverFileName ? `${draft.coverFileName} was selected before this panel refreshed; choose it again before saving.` : '';
    updateArchiveEraCoverControls();
  }

  function handleArchiveEraCoverSelection(input) {
    if(input?.files?.length && document.getElementById('eraRemoveCover')) document.getElementById('eraRemoveCover').checked = false;
    var state = document.getElementById('eraCoverFileState');
    if(state) state.textContent = input?.files?.[0]?.name || '';
    captureArchiveEraEditorDraft();
  }

  function toggleArchiveEraCoverRemoval(input) {
    if(input?.checked && document.getElementById('eraCoverFile')) document.getElementById('eraCoverFile').value = '';
    var state = document.getElementById('eraCoverFileState');
    if(state) state.textContent = input?.checked ? 'the current cover will be removed when this era is saved.' : '';
    captureArchiveEraEditorDraft();
  }

  function persistEnrichmentReviewState() {
    var state = {
      tab:enrichmentWorkspaceTab,status:enrichmentReviewStatus,kind:enrichmentReviewKind,
      signal:enrichmentReviewSignal,confidence:enrichmentReviewConfidence,
      query:enrichmentReviewQuery,selectedId:enrichmentSelectedSuggestionId,limit:enrichmentReviewLimit
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
      enrichmentReviewQuery = cleanSingleLine(state.query,160).toLowerCase();
      enrichmentSelectedSuggestionId = cleanSingleLine(state.selectedId,80);
      enrichmentReviewLimit = Math.max(80,Math.min(2000,Number(state.limit) || 80));
    } catch(error) {}
  }

  function scheduleEnrichmentDraftCapture() {
    scheduleEnrichmentLyricFlowRefresh();
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
      var eraCapabilityProbe = await supabaseClient.from('archive_eras').select('parent_era_id,notes').limit(1);
      var eraHierarchyProbe = eraCapabilityProbe;
      if(eraCapabilityProbe.error) eraHierarchyProbe = await supabaseClient.from('archive_eras').select('parent_era_id').limit(1);
      emptyArchiveEnrichment();
      names.forEach((name,index) => archiveEnrichment[name] = results[index].data || []);
      archiveEnrichment.eraHierarchyAvailable = !eraHierarchyProbe.error;
      archiveEnrichment.eraNotesAvailable = !eraCapabilityProbe.error;
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
      renderArchiveEraShelf();
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
    return collapseEnrichmentEraSuggestions(archiveEnrichment.suggestions).filter(item => {
      // A direct song search must not silently miss drafts hidden by a remembered
      // status filter from an earlier review session.
      if(!enrichmentReviewQuery && enrichmentReviewStatus !== 'all' && item.status !== enrichmentReviewStatus) return false;
      if(enrichmentReviewKind !== 'all' && item.kind !== enrichmentReviewKind) return false;
      if(enrichmentSuggestionConfidence(item) < enrichmentReviewConfidence) return false;
      if(!enrichmentSuggestionMatchesSignal(item,enrichmentReviewSignal)) return false;
      if(enrichmentReviewQuery) {
        var row = enrichmentRowForSuggestion(item);
        var text = [item.kind,item.status,item.model_name,item.model_version,enrichmentSuggestionReason(item),row && archiveSearchText(row)].filter(Boolean).join(' ').toLowerCase();
        var directMatch = enrichmentReviewQuery.split(/\s+/).every(term => text.includes(term));
        var structuredMatch = Boolean(row && typeof archiveRowMatchesStructuredSearch === 'function' && archiveRowMatchesStructuredSearch(row,enrichmentReviewQuery));
        if(!directMatch && !structuredMatch) return false;
      }
      return true;
    });
  }

  function collapseEnrichmentEraSuggestions(items) {
    var chosen = new Map();
    var passthrough = [];
    (items || []).forEach(item => {
      if(item.kind !== 'era') return passthrough.push(item);
      var row = enrichmentRowForSuggestion(item);
      var key = row ? projectKeyForRow(row) : `missing:${item.asset_id || item.id}`;
      var date = archiveEraGuessDate(row) || '9999-99-99';
      var version = archiveEraVersionNumber(row);
      var current = chosen.get(key);
      var currentRow = current && enrichmentRowForSuggestion(current);
      var currentDate = currentRow ? archiveEraGuessDate(currentRow) || '9999-99-99' : '9999-99-99';
      var currentVersion = archiveEraVersionNumber(currentRow);
      var earlier = !current || date < currentDate || (date === currentDate && version < currentVersion);
      var sameOriginNewer = current && date === currentDate && version === currentVersion && String(item.updated_at || '') > String(current.updated_at || '');
      if(earlier || sameOriginNewer) chosen.set(key,item);
    });
    return passthrough.concat(Array.from(chosen.values())).sort((a,b) => String(b.updated_at || b.created_at || '').localeCompare(String(a.updated_at || a.created_at || '')));
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
    var reviewCount = collapseEnrichmentEraSuggestions(archiveEnrichment.suggestions).filter(item => ['pending','draft','needs_review','stale'].includes(item.status)).length;
    return `<div class="enrichment-workspace-tabs" role="tablist" aria-label="catalog enrichment tools">
      <button class="${enrichmentWorkspaceTab === 'review' ? 'active' : ''}" type="button" onclick="setEnrichmentWorkspaceTab('review')">review queue<span>${reviewCount}</span></button>
      <button class="${enrichmentWorkspaceTab === 'eras' ? 'active' : ''}" type="button" onclick="setEnrichmentWorkspaceTab('eras')">creative eras<span>${archiveEnrichment.eras.length}</span></button>
      <button class="${enrichmentWorkspaceTab === 'tags' ? 'active' : ''}" type="button" onclick="setEnrichmentWorkspaceTab('tags')">tag library<span>${archiveEnrichment.tags.length}</span></button>
    </div>`;
  }

  function renderEnrichmentWorkspace() {
    var list = document.getElementById('adminWorkspaceList');
    var workspace = document.getElementById('adminFileWorkspace');
    if(!list || !workspace) return;
    if(enrichmentWorkspaceTab === 'eras') captureArchiveEraEditorDraft();
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
    if(enrichmentWorkspaceTab === 'eras') restoreArchiveEraEditorDraft();
    renderEnrichmentInspector();
    window.setTimeout(drawEnrichmentReviewWaveform,0);
  }

  function setEnrichmentWorkspaceTab(tab) {
    if(!['review','eras','tags'].includes(tab)) return;
    if(enrichmentWorkspaceTab === 'eras') captureArchiveEraEditorDraft();
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

  function filterEnrichmentReviewQueue(value) {
    enrichmentReviewQuery = cleanSingleLine(value,160).toLowerCase();
    enrichmentReviewLimit = 80;
    persistEnrichmentReviewState();
    var target = document.getElementById('enrichmentReviewResults');
    if(target) target.innerHTML = enrichmentReviewResultsHtml();
  }

  function handleEnrichmentReviewSearchKey(event) {
    if(event.key !== 'Escape') return;
    event.preventDefault();
    event.target.value = '';
    filterEnrichmentReviewQueue('');
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

  function enrichmentReviewResultsHtml() {
    var items = enrichmentReviewItems();
    var visibleItems = items.slice(0,enrichmentReviewLimit);
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
      ? `<div class="enrichment-empty">No songs match ${enrichmentReviewQuery ? `"${escapeHtml(enrichmentReviewQuery)}"` : 'this review signal'}. Try another search or filter.</div>`
      : '<div class="enrichment-empty enrichment-import-empty"><strong>no private analysis has been imported yet.</strong><span>Choose the BandLab backup again. Akrasia will scan each <code>akrasia-analysis.json</code> sidecar and import finished lyrics, tags, and technical metadata into this review queue without publishing them.</span><button type="button" onclick="openAdminUploadTool(true)">scan BandLab + analysis</button></div>';
    var more = items.length > visibleItems.length ? `<button class="enrichment-load-more" type="button" onclick="showMoreEnrichmentReviews()">show 80 more <span>${visibleItems.length} / ${items.length}</span></button>` : '';
    return `${bulk}<div class="enrichment-review-list">${cards || empty}</div>${more}`;
  }

  function enrichmentReviewHtml() {
    var statuses = ['pending','draft','needs_review','stale','rejected','accepted','all'];
    var kinds = ['all','lyrics','tags','audio_metadata','era'];
    var signals = [['all','all'],['unsure','unsure lyrics'],['missing-cover','missing cover'],['failed','failed'],['ready','ready']];
    var signalBar = `<div class="enrichment-signal-bar"><span>show</span>${signals.map(signal => `<button class="${enrichmentReviewSignal === signal[0] ? 'active' : ''}" type="button" onclick="setEnrichmentReviewFilter('signal','${signal[0]}')">${signal[1]}</button>`).join('')}<em>J/K moves / space selects</em></div>`;
    var toolbar = `<div class="enrichment-review-toolbar">
      <label class="enrichment-review-search"><span>find a song${enrichmentReviewQuery ? ' / all statuses' : ''}</span><input id="enrichmentReviewSearch" type="search" maxlength="160" value="${escapeAttr(enrichmentReviewQuery)}" placeholder="title, version, folder, era..." oninput="filterEnrichmentReviewQueue(this.value)" onkeydown="handleEnrichmentReviewSearchKey(event)"></label>
      <label><span>status</span><select onchange="setEnrichmentReviewFilter('status',this.value)">${statuses.map(status => `<option value="${status}"${status === enrichmentReviewStatus ? ' selected' : ''}>${status.replace('_',' ')}</option>`).join('')}</select></label>
      <label><span>kind</span><select onchange="setEnrichmentReviewFilter('kind',this.value)">${kinds.map(kind => `<option value="${kind}"${kind === enrichmentReviewKind ? ' selected' : ''}>${kind.replace('_',' ')}</option>`).join('')}</select></label>
      <label class="enrichment-confidence"><span>confidence / ${Math.round(enrichmentReviewConfidence * 100)}%</span><input type="range" min="0" max="1" step=".05" value="${enrichmentReviewConfidence}" oninput="this.previousElementSibling.textContent='confidence / '+Math.round(this.value*100)+'%'" onchange="setEnrichmentReviewFilter('confidence',this.value)"></label>
      <button type="button" onclick="loadArchiveEnrichmentData({ force:true }).then(renderAdminWorkspace)">refresh</button>
    </div>`;
    return `${signalBar}${toolbar}<div id="enrichmentReviewResults">${enrichmentReviewResultsHtml()}</div>`;
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
      words:Array.isArray(entry.words) ? entry.words.map(word => ({
        text:cleanSingleLine(word.text,120),
        speed:normalizeLyricWordSpeed(word.speed)
      })).filter(word => word.text) : [],
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
    if(!closest || distance > .65) {
      return { unsure:/\[unclear\]/i.test(line.text),confidence:null,words:[],reason:'' };
    }
    var words = (Array.isArray(closest.words) ? closest.words : [])
      .filter(word => word?.unclear)
      .map(word => String(word.text || '').trim())
      .filter(Boolean)
      .slice(0,8);
    var confidence = Number(closest.confidence);
    var rescueReason = closest.rescued
      ? cleanSingleLine(closest.reviewReason || 'recovered by the second transcription listen',240)
      : '';
    var unsure = Boolean(
      closest.unclear || closest.rescued || words.length ||
      (Number.isFinite(confidence) && confidence < .55) ||
      /\[unclear\]/i.test(line.text)
    );
    return {
      unsure,
      confidence:Number.isFinite(confidence) ? confidence : null,
      words,
      reason:rescueReason
    };
  }

  function serializeEnrichmentDraftLines(lines) {
    return cleanSyncedLyrics((lines || []).map(line => {
      var text = line.isPause || line.text === '...'
        ? '...'
        : serializeLyricWordSpeeds(cleanSingleLine(line.text,500),line.words);
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
        current.words = [...(current.words || []),...(next.words || [])];
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
      current.words = [...(current.words || []),...(next.words || []).slice(0,moveCount)];
      next.words = (next.words || []).slice(moveCount);
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
    updateEnrichmentLyricFlow(true);
  }

  function buildEnrichmentFlowGroups(lines) {
    var groups = [];
    (lines || []).map((line,index) => Object.assign({ editorIndex:index },line))
      .sort((a,b) => Number(a.time || 0) - Number(b.time || 0) || a.editorIndex - b.editorIndex)
      .forEach(line => {
        var current = groups[groups.length - 1];
        if(!current || Math.abs(current.time - Number(line.time || 0)) > .04) {
          current = { time:Number(line.time || 0),lines:[] };
          groups.push(current);
        }
        current.lines.push(line);
      });
    return groups;
  }

  function enrichmentFlowDuration(suggestion,row,lines) {
    var activeRow = audioQueue[queueIndex];
    var active = Boolean(row && activeRow && canonicalRow(activeRow) === canonicalRow(row));
    var values = [];
    if(active && Number.isFinite(Number(currentAudio?.duration))) values.push(Number(currentAudio.duration));
    var accepted = acceptedAudioMetadataForRow(row);
    if(Number.isFinite(Number(accepted?.duration_seconds))) values.push(Number(accepted.duration_seconds));
    var siblingMetadata = (archiveEnrichment.suggestionsByAsset.get(suggestion?.asset_id) || []).find(item => item.kind === 'audio_metadata' && item._payloadLoaded);
    if(Number.isFinite(Number(siblingMetadata?.payload?.durationSeconds))) values.push(Number(siblingMetadata.payload.durationSeconds));
    (suggestion?.payload?.segments || []).forEach(segment => {
      if(Number.isFinite(Number(segment?.end))) values.push(Number(segment.end));
    });
    (suggestion?.payload?.instrumentalSections || []).forEach(section => {
      if(Number.isFinite(Number(section?.end))) values.push(Number(section.end));
    });
    (lines || []).forEach(line => {
      if(Number.isFinite(Number(line?.time))) values.push(Number(line.time) + 6);
    });
    return Math.max(1,...values.filter(value => value > 0));
  }

  function enrichmentFlowLineMarkup(line,group,nextGroup) {
    var lane = line?.lane || 'main';
    if(line?.text === '...') return '<span class="is-pause" data-lane="pause"><i>instrumental</i><b><u></u><u></u><u></u></b></span>';
    var schedule = lyricWordTimingSchedule(line,group?.time || line?.time || 0,nextGroup?.time);
    var words = schedule.words.map((word,index) =>
      `<span class="enrichment-flow-word" data-flow-word-start="${word.start.toFixed(3)}" data-flow-word-end="${word.end.toFixed(3)}" data-flow-word-speed="${word.speed}" style="--flow-word-grow:${Math.max(.04,word.share).toFixed(4)}"><u>${escapeHtml(word.text)}</u><em>${escapeHtml(lyricWordSpeedLabel(word.speed))} / ${word.duration.toFixed(2)}s</em></span>`
    ).join('');
    return `<span data-lane="${escapeAttr(lane)}"><i>${escapeHtml(`${lane} / ${normalizeLyricSpeed(line?.speed)}`)}</i><b class="enrichment-flow-word-run">${words || escapeHtml(line?.text || '')}</b></span>`;
  }

  function enrichmentFlowSlotMarkup(label,group) {
    if(!group) return `<small>${escapeHtml(label)}</small><span class="enrichment-flow-empty">${label === 'current' ? 'waiting for the first line' : '--'}</span>`;
    var groupIndex = enrichmentFlowGroups.indexOf(group);
    var nextGroup = groupIndex >= 0 ? enrichmentFlowGroups[groupIndex + 1] : null;
    return `<small>${escapeHtml(label)} / ${escapeHtml(enrichmentTimeText(group.time))}</small><span class="enrichment-flow-lines">${group.lines.map(line => enrichmentFlowLineMarkup(line,group,nextGroup)).join('')}</span>`;
  }

  function enrichmentLyricFlowHtml(suggestion,row,lines) {
    enrichmentFlowLines = (lines || []).slice();
    enrichmentFlowGroups = buildEnrichmentFlowGroups(enrichmentFlowLines);
    enrichmentFlowDurationValue = enrichmentFlowDuration(suggestion,row,enrichmentFlowLines);
    enrichmentFlowActiveKey = '';
    var laneLevel = { main:0,lead:0,adlib:1,bg:1,effect:2 };
    var markers = enrichmentFlowGroups.flatMap((group,groupIndex) => {
      var next = enrichmentFlowGroups[groupIndex + 1];
      var left = Math.max(0,Math.min(100,group.time / enrichmentFlowDurationValue * 100));
      return group.lines.map((line,lineIndex) => {
        var schedule = lyricWordTimingSchedule(line,group.time,next?.time);
        var end = group.time + Math.max(.35,schedule.duration);
        var width = Math.max(.42,Math.min(12,(end - group.time) / enrichmentFlowDurationValue * 100));
        var level = Number(laneLevel[line.lane] ?? 0) + lineIndex * .16;
        var wordSegments = schedule.words.map(word =>
          `<span data-flow-word-start="${word.start.toFixed(3)}" data-flow-word-end="${word.end.toFixed(3)}" style="--flow-segment-left:${((word.start - group.time) / Math.max(.01,schedule.duration) * 100).toFixed(2)}%;--flow-segment-width:${(word.duration / Math.max(.01,schedule.duration) * 100).toFixed(2)}%"></span>`
        ).join('');
        return `<button class="enrichment-flow-marker" type="button" data-flow-group="${groupIndex}" data-flow-index="${line.editorIndex}" data-lane="${escapeAttr(line.text === '...' ? 'pause' : line.lane || 'main')}" style="--flow-left:${left.toFixed(3)}%;--flow-width:${width.toFixed(3)}%;--flow-lane:${level}" onclick="event.stopPropagation();seekEnrichmentFlowLine('${escapeAttr(suggestion.id)}',${line.editorIndex},${Number(line.time || 0).toFixed(3)})" aria-label="${escapeAttr(`${enrichmentTimeText(line.time)} ${line.lane || 'main'} ${line.text}`)}">${wordSegments}</button>`;
      });
    }).join('');
    return `<section class="enrichment-lyric-flow" id="enrichmentLyricFlow" data-suggestion-id="${escapeAttr(suggestion.id)}" data-duration="${enrichmentFlowDurationValue}">
      <header><span>lyric flow / live editor</span><strong id="enrichmentFlowTime">0:00 / ${escapeHtml(fmt(enrichmentFlowDurationValue))}</strong></header>
      <div class="enrichment-flow-stage">
        <button type="button" data-flow-slot="previous" onclick="seekEnrichmentFlowSlot(this,'${escapeAttr(suggestion.id)}')">${enrichmentFlowSlotMarkup('before',null)}</button>
        <button type="button" data-flow-slot="current" onclick="seekEnrichmentFlowSlot(this,'${escapeAttr(suggestion.id)}')">${enrichmentFlowSlotMarkup('current',null)}</button>
        <button type="button" data-flow-slot="next" onclick="seekEnrichmentFlowSlot(this,'${escapeAttr(suggestion.id)}')">${enrichmentFlowSlotMarkup('next',enrichmentFlowGroups[0] || null)}</button>
      </div>
      <div class="enrichment-flow-timeline" id="enrichmentFlowTimeline" onclick="seekEnrichmentFlowTimeline(event,'${escapeAttr(suggestion.id)}')"><span class="enrichment-flow-axis"></span>${markers}<i class="enrichment-flow-playhead" id="enrichmentFlowPlayhead"></i></div>
      <footer><span>word width = sung time</span><span>badge = word rate</span><span>lanes stay separate</span><em>change rates in each row's word timing panel</em></footer>
    </section>`;
  }

  function seekEnrichmentFlowLine(id,index,time) {
    setEnrichmentFocusedLine(index);
    seekEnrichmentLyric(id,time);
  }

  function seekEnrichmentFlowSlot(button,id) {
    var index = Number(button?.getAttribute('data-flow-index'));
    var time = Number(button?.getAttribute('data-flow-time'));
    if(!Number.isInteger(index) || !Number.isFinite(time)) return;
    seekEnrichmentFlowLine(id,index,time);
  }

  function seekEnrichmentFlowTimeline(event,id) {
    var track = document.getElementById('enrichmentFlowTimeline');
    if(!track || event.target?.closest?.('.enrichment-flow-marker')) return;
    var bounds = track.getBoundingClientRect();
    if(!bounds.width) return;
    var ratio = Math.max(0,Math.min(1,(event.clientX - bounds.left) / bounds.width));
    seekEnrichmentLyric(id,ratio * enrichmentFlowDurationValue);
  }

  function refreshEnrichmentLyricFlow() {
    var current = document.getElementById('enrichmentLyricFlow');
    var suggestion = enrichmentSuggestionById(enrichmentSelectedSuggestionId);
    var row = enrichmentRowForSuggestion(suggestion);
    if(!current || !suggestion || suggestion.kind !== 'lyrics') return;
    var lines = enrichmentDraftLines(collectEnrichmentLyricsEditor());
    current.outerHTML = enrichmentLyricFlowHtml(suggestion,row,lines);
    updateEnrichmentLyricFlow(true);
  }

  function scheduleEnrichmentLyricFlowRefresh() {
    window.clearTimeout(enrichmentFlowRefreshTimer);
    enrichmentFlowRefreshTimer = window.setTimeout(refreshEnrichmentLyricFlow,220);
  }

  function updateEnrichmentLyricFlow(force) {
    var host = document.getElementById('enrichmentLyricFlow');
    if(!host || !enrichmentFlowGroups.length) return;
    var suggestion = enrichmentSuggestionById(enrichmentSelectedSuggestionId);
    var row = enrichmentRowForSuggestion(suggestion);
    var activeRow = audioQueue[queueIndex];
    var active = Boolean(row && activeRow && canonicalRow(activeRow) === canonicalRow(row) && currentAudio);
    if(active && Number.isFinite(Number(currentAudio.duration)) && Math.abs(Number(currentAudio.duration) - enrichmentFlowDurationValue) > .55) {
      refreshEnrichmentLyricFlow();
      return;
    }
    var currentTime = active && Number.isFinite(Number(currentAudio.currentTime)) ? Number(currentAudio.currentTime) : 0;
    var groupIndex = -1;
    if(active) {
      enrichmentFlowGroups.forEach((group,index) => { if(group.time <= currentTime + .035) groupIndex = index; });
    } else if(Number.isInteger(enrichmentFocusedLineIndex) && enrichmentFocusedLineIndex >= 0) {
      groupIndex = enrichmentFlowGroups.findIndex(group => group.lines.some(line => line.editorIndex === enrichmentFocusedLineIndex));
      if(groupIndex >= 0) currentTime = enrichmentFlowGroups[groupIndex].time;
    }
    var activeKey = `${enrichmentSelectedSuggestionId}:${groupIndex}`;
    if(force || enrichmentFlowActiveKey !== activeKey) {
      enrichmentFlowActiveKey = activeKey;
      var previous = groupIndex > 0 ? enrichmentFlowGroups[groupIndex - 1] : null;
      var current = groupIndex >= 0 ? enrichmentFlowGroups[groupIndex] : null;
      var next = enrichmentFlowGroups[groupIndex + 1] || (groupIndex < 0 ? enrichmentFlowGroups[0] : null);
      [['previous',previous],['current',current],['next',next]].forEach(item => {
        var button = host.querySelector(`[data-flow-slot="${item[0]}"]`);
        if(!button) return;
        button.innerHTML = enrichmentFlowSlotMarkup(item[0] === 'previous' ? 'before' : item[0],item[1]);
        if(item[1]) {
          button.setAttribute('data-flow-index',item[1].lines[0].editorIndex);
          button.setAttribute('data-flow-time',item[1].time);
        } else {
          button.removeAttribute('data-flow-index');
          button.removeAttribute('data-flow-time');
        }
      });
      host.querySelectorAll('.enrichment-flow-marker').forEach(marker => {
        var markerGroup = Number(marker.getAttribute('data-flow-group'));
        marker.classList.toggle('is-active',markerGroup === groupIndex);
        marker.classList.toggle('is-past',groupIndex >= 0 && markerGroup < groupIndex);
      });
      var playingIndices = new Set(current?.lines.map(line => line.editorIndex) || []);
      document.querySelectorAll('[data-enrichment-lyric-row]').forEach((editorRow,index) => editorRow.classList.toggle('is-playing-line',playingIndices.has(index)));
    }
    var progress = Math.max(0,Math.min(1,currentTime / Math.max(1,enrichmentFlowDurationValue)));
    var playhead = document.getElementById('enrichmentFlowPlayhead');
    if(playhead) playhead.style.left = `${(progress * 100).toFixed(3)}%`;
    var time = document.getElementById('enrichmentFlowTime');
    if(time) time.textContent = `${fmt(currentTime)} / ${fmt(enrichmentFlowDurationValue)}`;
    host.querySelectorAll('[data-flow-word-start]').forEach(word => {
      var start = Number(word.getAttribute('data-flow-word-start')) || 0;
      var end = Math.max(start + .04,Number(word.getAttribute('data-flow-word-end')) || start + .2);
      var wordProgress = Math.max(0,Math.min(1,(currentTime - start) / (end - start)));
      word.style.setProperty('--flow-word-progress',wordProgress.toFixed(3));
      word.classList.toggle('is-current',wordProgress > 0 && wordProgress < 1);
      word.classList.toggle('is-past',wordProgress >= 1);
    });
    host.classList.toggle('is-playing',Boolean(active && !currentAudio.paused));
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
    current.words = [...(current.words || []),...(next.words || [])];
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

  var ENRICHMENT_WORD_SPEED_PRESETS = [
    { value:0,label:'still' },
    { value:.5,label:'.5x' },
    { value:.75,label:'.75x' },
    { value:1,label:'1x' },
    { value:1.25,label:'1.25x' },
    { value:1.5,label:'1.5x' },
    { value:2,label:'2x' }
  ];

  function enrichmentLineWordSettings(line) {
    var parsed = parseLyricWordSpeeds(line?.text || '');
    var stored = Array.isArray(line?.words) ? line.words : [];
    return parsed.words.map((word,index) => ({
      text:word.text,
      speed:normalizeLyricWordSpeed(stored[index]?.speed ?? word.speed)
    }));
  }

  function enrichmentWordSpeedControlHtml(word,index) {
    var speed = normalizeLyricWordSpeed(word?.speed);
    var options = ENRICHMENT_WORD_SPEED_PRESETS.map(option =>
      `<option value="${option.value}"${Math.abs(option.value - speed) < .01 ? ' selected' : ''}>${option.label}</option>`
    ).join('');
    return `<label class="enrichment-word-speed"><span>${escapeHtml(word?.text || '')}</span><select data-lyric-word-speed data-word-index="${index}" aria-label="motion speed for ${escapeAttr(word?.text || `word ${index + 1}`)}" onchange="updateEnrichmentWordTimingSummary(this);scheduleEnrichmentDraftCapture()">${options}</select></label>`;
  }

  function enrichmentWordTimingHtml(line) {
    if(line?.text === '...') return '';
    var words = enrichmentLineWordSettings(line);
    if(!words.length) return '';
    var changed = words.filter(word => normalizeLyricWordSpeed(word.speed) !== 1).length;
    return `<details class="enrichment-word-timing${changed ? ' has-custom' : ''}" data-word-settings="${escapeAttr(JSON.stringify(words))}" ontoggle="hydrateEnrichmentWordTiming(this)">
      <summary><span>word timing</span><small data-word-timing-count>${changed ? `${changed} changed` : 'all 1x'}</small></summary>
      <div class="enrichment-word-timing-grid"></div>
      <div class="enrichment-word-timing-foot"><span>slower values linger; faster values move and fill sooner.</span><button type="button" onclick="resetEnrichmentWordTiming(this)">reset words</button></div>
    </details>`;
  }

  function enrichmentWordSettingsFromDetails(details) {
    try {
      var words = JSON.parse(details?.getAttribute?.('data-word-settings') || '[]');
      return Array.isArray(words) ? words.map(word => ({
        text:cleanSingleLine(word?.text,120),
        speed:normalizeLyricWordSpeed(word?.speed)
      })).filter(word => word.text) : [];
    } catch(error) {
      return [];
    }
  }

  function setEnrichmentWordSettings(details,words) {
    if(!details) return;
    details.setAttribute('data-word-settings',JSON.stringify((words || []).map(word => ({
      text:cleanSingleLine(word?.text,120),
      speed:normalizeLyricWordSpeed(word?.speed)
    })).filter(word => word.text)));
  }

  function hydrateEnrichmentWordTiming(details) {
    if(!details?.open) return;
    var grid = details.querySelector('.enrichment-word-timing-grid');
    if(!grid || grid.getAttribute('data-ready') === 'true') return;
    var words = enrichmentWordSettingsFromDetails(details);
    grid.innerHTML = words.map(enrichmentWordSpeedControlHtml).join('');
    grid.setAttribute('data-ready','true');
  }

  function updateEnrichmentWordTimingSummary(control) {
    var details = control?.closest?.('.enrichment-word-timing');
    if(!details) return;
    var controls = Array.from(details.querySelectorAll('[data-lyric-word-speed]'));
    var words = controls.length
      ? controls.map(select => ({
          text:cleanSingleLine(select.closest('.enrichment-word-speed')?.querySelector('span')?.textContent,120),
          speed:normalizeLyricWordSpeed(select.value)
        }))
      : enrichmentWordSettingsFromDetails(details);
    if(controls.length) setEnrichmentWordSettings(details,words);
    var changed = words.filter(word => normalizeLyricWordSpeed(word.speed) !== 1).length;
    var count = details.querySelector('[data-word-timing-count]');
    if(count) count.textContent = changed ? `${changed} changed` : 'all 1x';
    details.classList.toggle('has-custom',Boolean(changed));
  }

  function resetEnrichmentWordTiming(button) {
    var details = button?.closest?.('.enrichment-word-timing');
    if(!details) return;
    details.querySelectorAll('[data-lyric-word-speed]').forEach(select => { select.value = '1'; });
    var words = enrichmentWordSettingsFromDetails(details).map(word => ({ text:word.text,speed:1 }));
    setEnrichmentWordSettings(details,words);
    updateEnrichmentWordTimingSummary(details);
    scheduleEnrichmentDraftCapture();
  }

  function syncEnrichmentWordTiming(textarea) {
    var row = textarea?.closest?.('[data-enrichment-lyric-row]');
    var details = row?.querySelector?.('.enrichment-word-timing');
    if(!row || !details) return;
    updateEnrichmentWordTimingSummary(details);
    var previous = enrichmentWordSettingsFromDetails(details).map(word => ({
      text:cleanSingleLine(word.text,120).toLowerCase(),
      speed:normalizeLyricWordSpeed(word.speed)
    }));
    var buckets = new Map();
    previous.forEach(word => {
      if(!buckets.has(word.text)) buckets.set(word.text,[]);
      buckets.get(word.text).push(word.speed);
    });
    var parsed = parseLyricWordSpeeds(textarea.value);
    var words = parsed.words.map(word => {
      var key = cleanSingleLine(word.text,120).toLowerCase();
      var matching = buckets.get(key);
      return {
        text:word.text,
        speed:normalizeLyricWordSpeed(word.speed) !== 1
          ? word.speed
          : (matching?.length ? matching.shift() : word.speed)
      };
    });
    var grid = details.querySelector('.enrichment-word-timing-grid');
    setEnrichmentWordSettings(details,words);
    if(grid?.getAttribute('data-ready') === 'true') grid.innerHTML = words.map(enrichmentWordSpeedControlHtml).join('');
    details.hidden = !words.length;
    updateEnrichmentWordTimingSummary(details);
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
      var certaintyTitle = evidence.reason || (evidence.words.length ? `Unsure words: ${evidence.words.join(', ')}` : 'Low-confidence transcription. Listen and correct this line.');
      var glow = normalizeLyricGlow(line.glow,line.lane);
      var speed = normalizeLyricSpeed(line.speed);
      return `<div class="enrichment-lyric-edit-row${evidence.unsure ? ' is-unsure' : ''}${index === enrichmentFocusedLineIndex ? ' is-selected-line' : ''}" data-enrichment-lyric-row${evidence.unsure ? ' data-unsure="true"' : ''} onclick="setEnrichmentFocusedLine(${index})">
      <button type="button" onclick="seekEnrichmentLyric('${escapeAttr(suggestion.id)}',${Number(line.time).toFixed(3)})" title="seek to this line">${escapeHtml(enrichmentTimeText(line.time))}</button>
      <input data-lyric-time type="text" inputmode="decimal" value="${escapeAttr(enrichmentTimeText(line.time))}" aria-label="line timestamp" oninput="scheduleEnrichmentDraftCapture()">
      <select data-lyric-lane aria-label="vocal lane" onchange="scheduleEnrichmentDraftCapture()">${['main','lead','adlib','bg','effect'].map(lane => `<option value="${lane}"${lane === line.lane ? ' selected' : ''}>${lane}</option>`).join('')}</select>
      <span class="enrichment-lyric-certainty" title="${escapeAttr(certaintyTitle)}"${evidence.unsure ? '' : ' aria-hidden="true"'}>${evidence.unsure ? escapeHtml(certaintyText) : ''}</span>
      <textarea data-lyric-text rows="1" maxlength="500" aria-label="lyric text" oninput="resizeEnrichmentLyricTextarea(this);syncEnrichmentWordTiming(this);scheduleEnrichmentDraftCapture()">${escapeHtml(line.text)}</textarea>
      <div class="enrichment-line-effects" aria-label="line appearance">
        <label><span>glow</span><select data-lyric-glow aria-label="line glow" onchange="scheduleEnrichmentDraftCapture()">${['off','soft','normal','high'].map(value => `<option value="${value}"${value === glow ? ' selected' : ''}>${value}</option>`).join('')}</select></label>
        <label><span>speed</span><select data-lyric-speed aria-label="line motion speed" onchange="scheduleEnrichmentDraftCapture()">${['still','slow','normal','fast'].map(value => `<option value="${value}"${value === speed ? ' selected' : ''}>${value}</option>`).join('')}</select></label>
        ${enrichmentWordTimingHtml(line)}
      </div>
      <button type="button" onclick="removeEnrichmentLyricLine(${index})" aria-label="remove line">x</button>
    </div>`;
    }).join('');
    var comparison = accepted ? `<details class="enrichment-lyrics-compare"><summary>compare accepted lyrics / ${parseSyncedLyrics(accepted).length} lines</summary><div><section><small>currently accepted</small><pre>${escapeHtml(accepted)}</pre></section><section><small>private draft</small><pre>${escapeHtml(enrichmentEditorDraft)}</pre></section></div></details>` : '<div class="enrichment-no-accepted">No accepted transcript exists for this revision yet.</div>';
    return `<div class="enrichment-lyrics-editor">
      <div class="enrichment-editor-dock">
        ${enrichmentLyricFlowHtml(suggestion,row,lines)}
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
    return serializeEnrichmentDraftLines(rows.map(row => {
      var text = cleanSingleLine(row.querySelector('[data-lyric-text]')?.value,500);
      var parsedWords = parseLyricWordSpeeds(text).words;
      var controls = Array.from(row.querySelectorAll('[data-lyric-word-speed]'));
      var storedWords = enrichmentWordSettingsFromDetails(row.querySelector('.enrichment-word-timing'));
      return {
        time:parseLyricTime(row.querySelector('[data-lyric-time]')?.value),
        lane:row.querySelector('[data-lyric-lane]')?.value || 'main',
        glow:row.querySelector('[data-lyric-glow]')?.value || 'soft',
        speed:row.querySelector('[data-lyric-speed]')?.value || 'slow',
        words:parsedWords.map((word,index) => ({
          text:word.text,
          speed:normalizeLyricWordSpeed(controls[index]?.value ?? storedWords[index]?.speed ?? word.speed)
        })),
        text:parsedWords.map(word => word.text).join(' ')
      };
    }).filter(line => line.time !== null && line.text));
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
    updateEnrichmentLyricFlow();
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
    var row = enrichmentRowForSuggestion(suggestion);
    var world = row && typeof getWorld === 'function' ? getWorld(projectKeyForRow(row)) : null;
    var origin = world ? archiveEraWorldOrigin(world) : null;
    var guessed = archiveEnrichment.erasById.get(payload.suggestedEraId)
      || archiveEnrichment.eras.find(era => String(era.name || '').toLowerCase() === String(payload.suggestedEraName || '').toLowerCase())
      || null;
    var candidates = Array.isArray(payload.candidates) ? payload.candidates : [];
    var candidateHtml = candidates.map((candidate,index) => `<span${guessed && candidate.eraId === guessed.id ? ' class="is-leading"' : ''}><b>${index + 1}</b>${escapeHtml(candidate.eraName || 'unnamed era')}<strong>${Math.round(Number(candidate.confidence || 0) * 100)}%</strong></span>`).join('');
    var options = archiveEnrichment.eras.map(era => `<option value="${escapeAttr(era.id)}"${guessed?.id === era.id ? ' selected' : ''}>${escapeHtml(era.name)}</option>`).join('');
    var worldEvidence = origin
      ? `<span>song world<strong>${escapeHtml(origin.title)} / ${origin.revisionCount} revision${origin.revisionCount === 1 ? '' : 's'}</strong></span><span>song began<strong>${escapeHtml(origin.originDate || 'undated')}</strong></span><span>latest work<strong>${escapeHtml(origin.latestDate || origin.originDate || 'undated')} / does not change the starting era</strong></span>`
      : `<span>song began<strong>${escapeHtml(evidence.revisionDateTime || payload.revisionDateTime || 'unknown')}</strong></span>`;
    return `<div class="enrichment-era-review"><p class="enrichment-review-note">This private guess appears once for the Song World. Akrasia uses where the song began; later revisions stay with that starting era. Correct it here and nothing is published automatically.</p>${candidateHtml ? `<div class="enrichment-era-candidates">${candidateHtml}</div>` : ''}<div class="enrichment-evidence">${worldEvidence}<span>analyzer reason<strong>${escapeHtml(evidence.explanation || payload.explanation || enrichmentSuggestionReason(suggestion))}</strong></span></div><label><span>creative era</span><select id="enrichmentSuggestionEra"><option value="">choose an era</option>${options}</select></label><label><span>relationship</span><select id="enrichmentSuggestionEraRelationship"><option value="primary">primary</option><option value="secondary">secondary</option></select></label><button class="primary enrichment-accept" type="button" onclick="acceptEnrichmentEra('${escapeAttr(suggestion.id)}')">accept for entire song world</button></div>`;
  }

  async function acceptEnrichmentEra(id) {
    if(!requireAdmin()) return;
    try { await ensureEnrichmentSuggestionPayload(id); }
    catch(error) { return showAppNotice(cleanSingleLine(error.message || 'Private suggestion could not be loaded.',240),'error'); }
    var suggestion = enrichmentSuggestionById(id);
    var row = enrichmentRowForSuggestion(suggestion);
    var world = row && typeof getWorld === 'function' ? getWorld(projectKeyForRow(row)) : null;
    var eraId = document.getElementById('enrichmentSuggestionEra')?.value;
    var relationship = document.getElementById('enrichmentSuggestionEraRelationship')?.value || 'primary';
    if(!eraId) return showAppNotice('Choose an artist-defined era first.','error');
    var result = await supabaseClient.rpc('accept_archive_era',{ p_suggestion_id:id,p_era_id:eraId,p_relationship:relationship });
    if(result.error) return showAppNotice(result.error.message,'error');
    var assignedCount = 1;
    if(world?.rows?.length) {
      try {
        assignedCount = await assignEraToRows(world.rows,eraId,relationship);
      } catch(error) {
        await loadArchiveEnrichmentData({ force:true });
        enrichmentSelectedSuggestionId = id;
        renderAdminWorkspace();
        return showAppNotice(`The starting revision was accepted, but the rest of "${world.title}" could not be assigned: ${cleanSingleLine(error.message,180)}`,'error');
      }
    }
    await loadArchiveEnrichmentData({ force:true });
    enrichmentSelectedSuggestionId = id;
    renderAdminWorkspace();
    showAppNotice(world ? `${world.title} assigned to this era across ${assignedCount} connected files.` : 'Creative-era assignment accepted.');
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

  function archiveEraVersionNumber(row) {
    var match = String(row?.getAttribute('data-ver') || row?.getAttribute('data-name') || '').match(/\bv0*(\d+)\b/i);
    return match ? Number(match[1]) || 0 : 0;
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

  function archiveEraComparable(value) {
    return cleanSingleLine(value,160).toLowerCase().replace(/[^a-z0-9]+/g,' ').trim().replace(/\s+/g,' ');
  }

  function archiveEraCanonicalName(value) {
    return cleanSingleLine(value,100)
      .replace(/^[#>*\-\s]+/,'')
      .replace(/\s*(?:[-_/|:]\s*)?(?:notes?|text(?:\s+file)?|images?|visuals?|art(?:work)?|covers?(?:\s+art)?|photos?|track\s*list(?:\s+idea)?|tracklist(?:\s+idea)?)\s*$/i,'')
      .replace(/[,:;.\-]+$/,'')
      .trim();
  }

  function archiveEraMergeSignal(signals,signal) {
    if(!signals || !signal?.key) return;
    var current = signals.get(signal.key);
    var sources = Array.from(new Set(
      (current?.sources || (current?.source ? [current.source] : []))
        .concat(signal.sources || (signal.source ? [signal.source] : []))
    )).filter(Boolean).slice(0,24);
    if(!current || Number(signal.strength) > Number(current.strength)) {
      signals.set(signal.key,Object.assign({},signal,{ sources }));
      return;
    }
    current.sources = sources;
  }

  function archiveEraNameSignals(value,source) {
    var text = String(value || '').replace(/\r/g,'\n').slice(0,16000);
    var signals = new Map();
    var add = function(name,strength,kind) {
      name = archiveEraCanonicalName(name);
      var key = archiveEraComparable(name);
      if(!key || key.length < 3) return;
      var next = { key,name:name.toLowerCase(),strength:Math.max(0,Math.min(1,Number(strength) || 0)),kind:kind || 'text signal',source:source || 'archive context' };
      if(!signals.has(key) || signals.get(key).strength < next.strength) signals.set(key,next);
    };
    [
      { pattern:/\b((?:days?\s+)?(?:before|after)\s+akrasia)\b/gi,strength:.99,kind:'named chronology' },
      { pattern:/\b(akrasia\s+(?:v(?:ersion)?\s*)?\d+)\b/gi,strength:.98,kind:'named chronology' },
      { pattern:/\b((?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|sept(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+\d{1,2}(?:st|nd|rd|th)?(?:\s*,?\s*(?:19|20)?\d{2})?\s+(?:sessions?|era|phase))\b/gi,strength:.96,kind:'named session' },
      { pattern:/\b(batch\s+[a-z0-9]+(?:\s+\d{5,8})?)\b/gi,strength:.94,kind:'batch name' },
      { pattern:/^\s*(?:era|project|album|mixtape|tape|session|phase|working\s+title|name)\s*(?:name|title)?\s*[:=\-]\s*([^\n]{3,84})$/gim,strength:.93,kind:'named in text' }
    ].forEach(rule => {
      var match;
      while((match = rule.pattern.exec(text))) add(match[1],rule.strength,rule.kind);
    });
    text.split(/\n+/).slice(0,180).forEach(line => {
      var heading = cleanSingleLine(line,100).replace(/^[#>*\-\s]+/,'').trim();
      if(!heading || heading.length > 84 || heading.split(/\s+/).length > 10) return;
      if(/\b(?:sessions?|era|batch|phase|chapter)\b/i.test(heading)) add(heading,.82,'text heading');
    });
    return Array.from(signals.values()).sort((a,b) => b.strength - a.strength || a.name.localeCompare(b.name));
  }

  function archiveEraTextMentionsWorld(row,title) {
    var wanted = archiveEraComparable(title);
    var wantedKey = typeof normalizedWorldKey === 'function' ? normalizedWorldKey(title) : '';
    if(wanted.length < 4) return false;
    var text = [row?.getAttribute('data-text-content'),row?.getAttribute('data-notes')].filter(Boolean).join('\n');
    return text.split(/\r?\n/).slice(0,500).some(line => {
      var clean = archiveEraComparable(String(line || '').replace(/^\s*(?:[-*]|\d+\s*[:.)-])\s*/,''));
      var lineKey = typeof normalizedWorldKey === 'function' ? normalizedWorldKey(line) : '';
      return clean === wanted || Boolean(wantedKey && lineKey === wantedKey);
    });
  }

  function archiveEraTextTitleSignal(row) {
    var title = archiveEraCanonicalName(cleanSingleLine(row?.getAttribute('data-title') || row?.getAttribute('data-name'),100)
      .replace(/\.(?:txt|md|rtf)$/i,'')
      .replace(/\s+(?:track\s*list|tracklist)(?:\s+idea)?$/i,'')
      .trim());
    var key = archiveEraComparable(title);
    if(!key || /^(?:notes?|folder notes?|readme|manifest|inspirations?|lyrics?|untitled)$/i.test(key)) return null;
    var content = String(row?.getAttribute('data-text-content') || row?.getAttribute('data-notes') || '');
    var substantial = content.split(/\r?\n/).filter(line => cleanSingleLine(line,200)).length >= 3;
    var explicit = /\b(?:akrasia|before|after|sessions?|era|phase|batch|project|album|mixtape|tape)\b/i.test(title);
    if(!explicit && !substantial) return null;
    return {
      key,
      name:title.toLowerCase(),
      strength:explicit ? .94 : .72,
      kind:explicit ? 'text file title' : 'possible text file title',
      source:`text file title / ${title}`
    };
  }

  function archiveEraWorldOrigin(group) {
    var audioRows = (group?.audio || group?.rows || []).filter(row => row?.getAttribute('data-type') === 'audio' && row.getAttribute('data-id'));
    if(!audioRows.length) return null;
    var chronological = audioRows.slice().sort((a,b) => {
      var aDate = archiveEraGuessDate(a) || '9999-99-99';
      var bDate = archiveEraGuessDate(b) || '9999-99-99';
      return aDate.localeCompare(bDate) || archiveEraVersionNumber(a) - archiveEraVersionNumber(b);
    });
    var originRow = chronological.find(archiveEraGuessDate) || chronological[0];
    var dates = audioRows.map(archiveEraGuessDate).filter(Boolean).sort();
    return {
      key:group.key,
      title:group.title || worldTitleForRow(originRow),
      group,
      rows:(group.rows || audioRows).filter(row => row?.getAttribute('data-id')),
      audioRows,
      originRow,
      originDate:archiveEraGuessDate(originRow),
      latestDate:dates[dates.length - 1] || archiveEraGuessDate(originRow),
      revisionCount:audioRows.length
    };
  }

  function archiveEraTextRowsForWorld(entry,textRows) {
    var folders = Array.from(new Set(entry.rows.map(row => normalizeFolderPath(row.getAttribute('data-sub'))).filter(Boolean)));
    var projectKeys = new Set(entry.rows.map(row => normalizedWorldKey(row.getAttribute('data-project-key'))).filter(Boolean));
    return (textRows || []).filter(row => {
      if(entry.rows.includes(row)) return true;
      var noteProject = normalizedWorldKey(row.getAttribute('data-project-key'));
      if(noteProject && projectKeys.has(noteProject)) return true;
      var noteFolder = normalizeFolderPath(row.getAttribute('data-sub'));
      if(noteFolder && folders.some(folder => folder === noteFolder || folder.startsWith(noteFolder + '/') || noteFolder.startsWith(folder + '/'))) return true;
      return !noteFolder && archiveEraTextMentionsWorld(row,entry.title);
    });
  }

  function archiveEraWorldEntries() {
    if(typeof worldGroups !== 'function') return [];
    var textRows = baseRows().filter(row => row.getAttribute('data-type') === 'text');
    return worldGroups().map(group => {
      var entry = archiveEraWorldOrigin(group);
      if(!entry) return null;
      entry.folders = Array.from(new Set(entry.rows.map(row => normalizeFolderPath(row.getAttribute('data-sub'))).filter(Boolean)));
      entry.topFolders = Array.from(new Set(entry.folders.map(folder => folder.split('/')[0]).filter(Boolean)));
      entry.textRows = archiveEraTextRowsForWorld(entry,textRows);
      var signalSources = [];
      entry.topFolders.forEach(folder => signalSources.push({ value:folder,source:`folder / ${folder}` }));
      signalSources.push({ value:entry.title,source:`song title / ${entry.title}` });
      entry.rows.forEach(row => {
        var title = row.getAttribute('data-title') || row.getAttribute('data-name') || '';
        if(title) signalSources.push({ value:title,source:`${row.getAttribute('data-type') || 'file'} title / ${title}` });
      });
      var songNotes = entry.rows.map(row => row.getAttribute('data-notes') || '').filter(Boolean);
      if(songNotes.length) signalSources.push({ value:songNotes.join('\n'),source:'song notes' });
      entry.textRows.forEach(row => signalSources.push({
        value:[row.getAttribute('data-title'),row.getAttribute('data-text-content'),row.getAttribute('data-notes')].filter(Boolean).join('\n'),
        source:`text file / ${row.getAttribute('data-title') || row.getAttribute('data-name') || 'note'}`
      }));
      var signals = new Map();
      signalSources.forEach(item => archiveEraNameSignals(item.value,item.source).forEach(signal => archiveEraMergeSignal(signals,signal)));
      entry.textRows.forEach(row => {
        var signal = archiveEraTextTitleSignal(row);
        if(!signal) return;
        archiveEraMergeSignal(signals,signal);
      });
      entry.signals = Array.from(signals.values()).sort((a,b) => b.strength - a.strength || a.name.localeCompare(b.name));
      entry.folderPath = entry.folders.slice().sort((a,b) => a.length - b.length || a.localeCompare(b))[0] || '';
      entry.noteEvidence = entry.textRows.map(row => row.getAttribute('data-title') || row.getAttribute('data-name')).filter(Boolean).slice(0,8);
      entry.hasConfirmedPrimary = entry.rows.some(row => (archiveEnrichment.assetErasByAsset.get(row.getAttribute('data-id')) || []).some(relation => relation.review_status === 'confirmed' && relation.relationship === 'primary'));
      return entry;
    }).filter(Boolean);
  }

  function archiveEraPreferredSignal(entries) {
    var ranked = new Map();
    entries.forEach(entry => entry.signals.forEach(signal => {
      if(!ranked.has(signal.key)) ranked.set(signal.key,Object.assign({},signal,{ worlds:new Set(),sources:new Set() }));
      ranked.get(signal.key).worlds.add(entry.key);
      (signal.sources || [signal.source]).filter(Boolean).forEach(source => ranked.get(signal.key).sources.add(source));
    }));
    return Array.from(ranked.values())
      .filter(item => item.worlds.size >= 2 || item.strength >= .98)
      .map(item => Object.assign(item,{ score:item.strength + Math.min(.18,item.worlds.size * .04) }))
      .sort((a,b) => b.score - a.score || b.worlds.size - a.worlds.size || a.name.localeCompare(b.name))[0] || null;
  }

  function archiveEraGuessFromEntries(options) {
    var worlds = Array.from(new Map((options.entries || []).map(entry => [entry.key,entry])).values());
    var rows = Array.from(new Map(worlds.flatMap(entry => entry.rows).map(row => [row.getAttribute('data-id'),row])).values());
    var originDates = worlds.map(entry => entry.originDate).filter(Boolean).sort();
    var activityDates = worlds.map(entry => entry.latestDate).filter(Boolean).sort();
    return {
      id:options.id,
      type:options.type,
      name:(archiveEraCanonicalName(options.name) || cleanSingleLine(options.name,100)).toLowerCase(),
      worlds,
      rows,
      revisionCount:worlds.reduce((sum,entry) => sum + entry.revisionCount,0),
      startDate:originDates[0] || '',
      endDate:activityDates[activityDates.length - 1] || originDates[originDates.length - 1] || '',
      originDate:originDates.length && originDates.every(date => date === originDates[0]) ? originDates[0] : '',
      confidence:Math.max(0,Math.min(1,Number(options.confidence) || 0)),
      evidence:cleanSingleLine(options.evidence,500),
      evidenceDetails:Array.from(new Set(options.evidenceDetails || [])).slice(0,24),
      aliases:Array.from(new Set(options.aliases || [])).filter(Boolean).slice(0,8)
    };
  }

  function deriveArchiveEraGuesses() {
    var entries = archiveEraWorldEntries();
    var candidates = [];
    var signalGroups = new Map();
    var dayGroups = new Map();
    var monthGroups = new Map();
    entries.forEach(entry => {
      entry.signals.forEach(signal => {
        if(!signalGroups.has(signal.key)) signalGroups.set(signal.key,{ signal,entries:new Map() });
        signalGroups.get(signal.key).entries.set(entry.key,entry);
      });
      var date = entry.originDate;
      if(!date) return;
      if(!dayGroups.has(date)) dayGroups.set(date,[]);
      dayGroups.get(date).push(entry);
      var month = date.slice(0,7);
      if(!entry.hasConfirmedPrimary) {
        if(!monthGroups.has(month)) monthGroups.set(month,[]);
        monthGroups.get(month).push(entry);
      }
    });
    signalGroups.forEach(({ signal,entries:group },key) => {
      var worlds = Array.from(group.values());
      if(worlds.length < 2 && signal.strength < .98) return;
      candidates.push(archiveEraGuessFromEntries({
        id:`signal:${key.replace(/\s+/g,'-')}`,
        type:signal.kind,
        name:signal.name,
        entries:worlds,
        confidence:Math.min(.98,signal.strength + Math.min(.08,worlds.length * .012)),
        evidence:`"${signal.name}" appears in ${signal.source} and connects ${worlds.length} song${worlds.length === 1 ? '' : 's'}.`,
        evidenceDetails:Array.from(new Set(worlds.flatMap(entry => entry.signals
          .filter(item => item.key === key)
          .flatMap(item => item.sources || [item.source])
        ).filter(Boolean)))
      }));
    });
    dayGroups.forEach((group,date) => {
      if(group.length < 2) return;
      var preferred = archiveEraPreferredSignal(group);
      var fallbackName = `${archiveEraGuessDateLabel(date,false)} sessions`;
      var name = preferred && preferred.worlds.size >= Math.ceil(group.length / 2) ? preferred.name : fallbackName;
      candidates.push(archiveEraGuessFromEntries({
        id:`day:${date}`,
        type:'song-origin session',
        name,
        entries:group,
        confidence:Math.min(.94,.68 + group.length * .04 + (preferred ? .05 : 0)),
        evidence:`${group.length} songs began on ${archiveEraGuessDateLabel(date,false)}. Later revisions stay in this starting session through their latest work date.`,
        evidenceDetails:(preferred ? [`possible archive name "${preferred.name}" found in ${Array.from(preferred.sources).join(', ')}`] : []).concat(group.flatMap(entry => entry.noteEvidence.map(note => `text evidence / ${note}`))),
        aliases:name === fallbackName ? [] : [fallbackName]
      }));
    });
    monthGroups.forEach((group,month) => {
      if(group.length < 5) return;
      var preferred = archiveEraPreferredSignal(group);
      var fallbackName = `${archiveEraGuessDateLabel(month,true)} beginnings`;
      var name = preferred && preferred.worlds.size >= Math.ceil(group.length * .6) ? preferred.name : fallbackName;
      candidates.push(archiveEraGuessFromEntries({
        id:`month:${month}`,
        type:'song-origin month',
        name,
        entries:group,
        confidence:Math.min(.86,.58 + group.length * .025 + (preferred ? .04 : 0)),
        evidence:`${group.length} different songs began in ${archiveEraGuessDateLabel(month,true)}; revision volume did not affect this cluster.`,
        evidenceDetails:preferred ? [`possible archive name "${preferred.name}" found in ${Array.from(preferred.sources).join(', ')}`] : [],
        aliases:name === fallbackName ? [] : [fallbackName]
      }));
    });
    var byCanonicalName = new Map();
    candidates.forEach(candidate => {
      var key = archiveEraComparable(archiveEraCanonicalName(candidate.name));
      if(!key) return;
      var current = byCanonicalName.get(key);
      if(!current) {
        byCanonicalName.set(key,candidate);
        return;
      }
      var currentIsDate = /^song-origin /.test(current.type);
      var candidateIsDate = /^song-origin /.test(candidate.type);
      var winner = currentIsDate && !candidateIsDate ? candidate : (!currentIsDate && candidateIsDate ? current : (candidate.confidence > current.confidence ? candidate : current));
      var other = winner === current ? candidate : current;
      byCanonicalName.set(key,archiveEraGuessFromEntries({
        id:winner.id,type:winner.type,name:winner.name,
        entries:Array.from(new Map(winner.worlds.concat(other.worlds).map(entry => [entry.key,entry])).values()),
        confidence:Math.min(.99,Math.max(winner.confidence,other.confidence) + .025),
        evidence:`Multiple archive signals point to "${winner.name}".`,
        evidenceDetails:Array.from(new Set([winner.evidence,other.evidence].concat(winner.evidenceDetails || [],other.evidenceDetails || []))),
        aliases:Array.from(new Set((winner.aliases || []).concat(other.aliases || [],other.name))).filter(name => archiveEraComparable(name) !== key)
      }));
    });
    candidates = Array.from(byCanonicalName.values());
    var existingNames = new Set(archiveEnrichment.eras.map(era => archiveEraComparable(archiveEraCanonicalName(era.name))));
    var merged = new Map();
    candidates.filter(candidate => candidate.worlds.length && !existingNames.has(archiveEraComparable(candidate.name))).forEach(candidate => {
      var fingerprint = candidate.worlds.map(world => world.key).sort().join('|');
      var current = merged.get(fingerprint);
      if(!current) return merged.set(fingerprint,candidate);
      var currentNamed = current.type !== 'song-origin session' && current.type !== 'song-origin month';
      var candidateNamed = candidate.type !== 'song-origin session' && candidate.type !== 'song-origin month';
      var winner = candidateNamed && !currentNamed ? candidate : ((!candidateNamed && currentNamed) ? current : (candidate.confidence > current.confidence ? candidate : current));
      var other = winner === candidate ? current : candidate;
      winner.aliases = Array.from(new Set((winner.aliases || []).concat(other.name,other.aliases || []))).filter(name => name && name !== winner.name).slice(0,8);
      winner.evidenceDetails = Array.from(new Set((winner.evidenceDetails || []).concat(other.evidenceDetails || [],other.evidence))).slice(0,24);
      merged.set(fingerprint,winner);
    });
    return Array.from(merged.values())
      .sort((a,b) => b.confidence - a.confidence || b.worlds.length - a.worlds.length || a.startDate.localeCompare(b.startDate))
      .slice(0,16);
  }

  function archiveEraGuessWorldsHtml(guess,limit) {
    var worlds = (guess?.worlds || []).slice(0,limit || 18);
    var rows = worlds.map(entry => {
      var activity = entry.latestDate && entry.latestDate !== entry.originDate ? ` / worked through ${entry.latestDate}` : '';
      return `<button class="era-world-row" type="button" onclick="openSongWorld(decodeURIComponent('${encodeURIComponent(entry.key)}'),'overview')"><span class="era-world-folder" aria-hidden="true"></span><span><strong>${escapeHtml(entry.title)}</strong><small>${escapeHtml(entry.folderPath || 'root')} / began ${escapeHtml(entry.originDate || 'undated')}${escapeHtml(activity)}</small></span><em>${entry.revisionCount} revision${entry.revisionCount === 1 ? '' : 's'}</em></button>`;
    }).join('');
    var remaining = Math.max(0,(guess?.worlds || []).length - worlds.length);
    return `<div class="era-world-list">${rows}${remaining ? `<span class="era-world-more">${remaining} more songs remain in this suggestion</span>` : ''}</div>`;
  }

  function enrichmentEraGuessesHtml() {
    enrichmentEraGuesses = deriveArchiveEraGuesses();
    if(!enrichmentEraGuesses.length) return `<section class="era-guesses"><div class="era-editor-head"><strong>archive guesses</strong><span>no strong unconfirmed date or title clusters right now</span></div></section>`;
    var cards = enrichmentEraGuesses.map(guess => {
      var suggestedParent = archiveEraSuggestedParent(guess);
      var parentControl = archiveEnrichment.eraHierarchyAvailable && archiveEnrichment.eras.length
        ? `<label class="era-guess-parent"><span>place inside</span><select id="eraGuessParent-${escapeAttr(stableSourceHash(guess.id))}"><option value="">top-level era</option>${archiveEraParentOptions('',suggestedParent?.id || '')}</select>${suggestedParent ? `<small>Akrasia found the same parent era across these songs.</small>` : '<small>Choose an album or larger creative era when this was a chapter inside it.</small>'}</label>`
        : '';
      return `<details class="era-guess-card" data-era-guess-id="${escapeAttr(guess.id)}"><summary><small>${escapeHtml(guess.type)} / ${Math.round(guess.confidence * 100)}%</small><strong>${escapeHtml(guess.name)}</strong><span>${guess.worlds.length} song${guess.worlds.length === 1 ? '' : 's'} / ${guess.revisionCount} revisions${suggestedParent ? ` / inside ${escapeHtml(suggestedParent.name)}` : ''}</span><i>preview contents</i></summary><div class="era-guess-preview"><p>${escapeHtml(guess.evidence)}</p><div class="era-guess-range"><span>songs began<strong>${escapeHtml(guess.startDate || 'open')}</strong></span><span>latest work<strong>${escapeHtml(guess.endDate || 'open')}</strong></span></div>${guess.aliases.length ? `<div class="era-guess-aliases"><small>other names found</small>${guess.aliases.map(name => `<span>${escapeHtml(name)}</span>`).join('')}</div>` : ''}${guess.evidenceDetails.length ? `<div class="era-guess-evidence">${guess.evidenceDetails.map(value => `<span>${escapeHtml(value)}</span>`).join('')}</div>` : ''}${archiveEraGuessWorldsHtml(guess)}${parentControl}<button type="button" onclick="createEraFromArchiveGuess('${escapeAttr(guess.id)}')">create this ${suggestedParent ? 'sub-era' : 'archive era'}</button></div></details>`;
    }).join('');
    return `<section class="era-guesses"><div class="era-editor-head"><strong>archive guesses</strong><span>song origins + folders + text files / batches and sessions can live inside larger eras</span></div><div class="era-guess-grid">${cards}</div></section>`;
  }

  async function createEraFromArchiveGuess(id) {
    if(!requireAdmin()) return;
    var guess = enrichmentEraGuesses.find(item => item.id === id) || deriveArchiveEraGuesses().find(item => item.id === id);
    if(!guess) return showAppNotice('That archive pattern is no longer available.','error');
    var parentId = archiveEnrichment.eraHierarchyAvailable ? document.getElementById(`eraGuessParent-${stableSourceHash(guess.id)}`)?.value || '' : '';
    var parent = archiveEnrichment.erasById.get(parentId) || null;
    var name = cleanSingleLine(prompt('Name this creative era:',guess.name) || '',100);
    if(!name) return;
    if(!confirm(`Create "${name}" as a private ${parent ? `sub-era inside "${parent.name}"` : 'top-level era'} for ${guess.worlds.length} song${guess.worlds.length === 1 ? '' : 's'}? Every revision and attached artifact in those Song Worlds will follow the song's most specific starting era.`)) return;
    var siblings = archiveEraChildren(parentId);
    var payload = {
      name,slug:'',description:`Archive-assisted song-origin suggestion. ${guess.evidence}. Confirmed from folder, date, and text evidence in the private era review.`,
      start_date:guess.startDate || null,end_date:guess.endDate || null,accent_color:parent?.accent_color || '#ffffff',
      visibility:'private',display_order:siblings.length ? Math.max(...siblings.map(era => Number(era.display_order || 0))) + 1 : 0
    };
    if(archiveEnrichment.eraHierarchyAvailable) payload.parent_era_id = parentId || null;
    var result = await supabaseClient.from('archive_eras').insert(payload).select().single();
    if(result.error) return showAppNotice(result.error.message,'error');
    try {
      var count = await assignEraToRows(guess.rows,result.data.id,'primary');
      await loadArchiveEnrichmentData({ force:true });
      renderAdminWorkspace();
      showAppNotice(`${name} created privately${parent ? ` inside ${parent.name}` : ''} for ${guess.worlds.length} songs and ${count} connected files.`);
    } catch(error) {
      await loadArchiveEnrichmentData({ force:true });
      renderAdminWorkspace();
      showAppNotice(`The era was created, but its files were not assigned: ${cleanSingleLine(error.message,180)}`,'error');
    }
  }

  function archiveEraParentId(era) {
    var value = cleanSingleLine(era?.parent_era_id,80);
    return value && value !== era?.id ? value : '';
  }

  function archiveEraChildren(parentId) {
    return archiveEnrichment.eras
      .filter(era => archiveEraParentId(era) === String(parentId || ''))
      .sort((a,b) => Number(a.display_order || 0) - Number(b.display_order || 0) || String(a.name || '').localeCompare(String(b.name || '')));
  }

  function archiveEraRoots() {
    return archiveEnrichment.eras
      .filter(era => {
        var parentId = archiveEraParentId(era);
        return !parentId || !archiveEnrichment.erasById.has(parentId);
      })
      .sort((a,b) => Number(a.display_order || 0) - Number(b.display_order || 0) || String(a.name || '').localeCompare(String(b.name || '')));
  }

  function archiveEraDescendantIds(id,includeSelf) {
    var found = new Set(includeSelf === false ? [] : [id]);
    var queue = [id];
    while(queue.length) {
      var parentId = queue.shift();
      archiveEraChildren(parentId).forEach(child => {
        if(found.has(child.id)) return;
        found.add(child.id);
        queue.push(child.id);
      });
    }
    return found;
  }

  function archiveEraAncestors(id) {
    var list = [];
    var seen = new Set([id]);
    var current = archiveEnrichment.erasById.get(id);
    while(current) {
      var parentId = archiveEraParentId(current);
      if(!parentId || seen.has(parentId)) break;
      var parent = archiveEnrichment.erasById.get(parentId);
      if(!parent) break;
      list.unshift(parent);
      seen.add(parentId);
      current = parent;
    }
    return list;
  }

  function archiveEraHierarchyFlat() {
    var output = [];
    var seen = new Set();
    var visit = function(era,depth) {
      if(!era || seen.has(era.id)) return;
      seen.add(era.id);
      output.push({ era,depth,parent:archiveEnrichment.erasById.get(archiveEraParentId(era)) || null });
      archiveEraChildren(era.id).forEach(child => visit(child,depth + 1));
    };
    archiveEraRoots().forEach(era => visit(era,0));
    archiveEnrichment.eras.forEach(era => visit(era,0));
    return output;
  }

  function archiveEraTreeRows(id) {
    var ids = archiveEraDescendantIds(id,true);
    var assetIds = new Set(archiveEnrichment.assetEras
      .filter(item => ids.has(item.era_id) && item.review_status === 'confirmed')
      .map(item => item.asset_id));
    return baseRows().filter(row => assetIds.has(row.getAttribute('data-id')));
  }

  function archiveEraTreeEntries(id,entries) {
    var ids = archiveEraDescendantIds(id,true);
    var assetIds = new Set(archiveEnrichment.assetEras
      .filter(item => ids.has(item.era_id) && item.review_status === 'confirmed')
      .map(item => item.asset_id));
    return (entries || archiveEraWorldEntries()).filter(entry => entry.rows.some(row => assetIds.has(row.getAttribute('data-id'))));
  }

  function archiveEraPathLabel(era) {
    return archiveEraAncestors(era?.id).concat(era || []).filter(Boolean).map(item => item.name).join(' / ');
  }

  function archiveEraParentOptions(excludeId,selectedId) {
    var blocked = excludeId ? archiveEraDescendantIds(excludeId,true) : new Set();
    return archiveEraHierarchyFlat()
      .filter(item => !blocked.has(item.era.id))
      .map(item => `<option value="${escapeAttr(item.era.id)}"${item.era.id === selectedId ? ' selected' : ''}>${escapeHtml(`${'— '.repeat(item.depth)}${archiveEraPathLabel(item.era)}`)}</option>`)
      .join('');
  }

  function archiveEraPrimaryForEntry(entry) {
    var counts = new Map();
    (entry?.rows || []).forEach(row => {
      (archiveEnrichment.assetErasByAsset.get(row.getAttribute('data-id')) || [])
        .filter(relation => relation.review_status === 'confirmed' && relation.relationship === 'primary')
        .forEach(relation => counts.set(relation.era_id,(counts.get(relation.era_id) || 0) + 1));
    });
    var winner = Array.from(counts.entries()).sort((a,b) => b[1] - a[1])[0];
    return winner ? archiveEnrichment.erasById.get(winner[0]) || null : null;
  }

  function archiveEraSuggestedParent(guess) {
    if(!archiveEnrichment.eraHierarchyAvailable || !guess?.worlds?.length) return null;
    var directParents = guess.worlds.map(archiveEraPrimaryForEntry).filter(Boolean);
    if(directParents.length === guess.worlds.length && directParents.every(era => era.id === directParents[0].id)) return directParents[0];
    if(!guess.startDate) return null;
    return archiveEraRoots().filter(era => {
      if(era.start_date && guess.startDate < era.start_date) return false;
      if(era.end_date && guess.startDate > era.end_date) return false;
      return Boolean(era.start_date || era.end_date);
    }).sort((a,b) => {
      var aSpan = `${a.start_date || '0000-00-00'}:${a.end_date || '9999-99-99'}`;
      var bSpan = `${b.start_date || '0000-00-00'}:${b.end_date || '9999-99-99'}`;
      return bSpan.localeCompare(aSpan);
    })[0] || null;
  }

  function archiveEraEntriesForId(eraId,entries) {
    var assetIds = new Set(archiveEnrichment.assetEras.filter(item => item.era_id === eraId && item.review_status === 'confirmed').map(item => item.asset_id));
    return (entries || archiveEraWorldEntries()).filter(entry => entry.rows.some(row => assetIds.has(row.getAttribute('data-id'))));
  }

  function openCreativeEraFromArchive(id) {
    openWorldsHub('eras');
    window.setTimeout(function(){
      if(document.getElementById('worldsViewport')?.classList.contains('active')) openCreativeEraWorld(id);
    },140);
  }

  function openArchiveEraSuggestionReview(id) {
    if(!requireAdmin()) return;
    openAdminReviewTool('eras');
    window.setTimeout(function(){
      var target = document.querySelector(`[data-era-guess-id="${cssEscape(id)}"]`);
      if(!target) return;
      target.open = true;
      target.scrollIntoView({ behavior:archiveSettings?.motion === 'off' ? 'auto' : 'smooth',block:'center' });
    },160);
  }

  function archiveEraJournalText(era) {
    return String(era?.notes || era?.description || '').trim();
  }

  function archiveEraJournalHtml(era,compact) {
    var notes = String(era?.notes || '').trim();
    if(!notes) return '';
    var value = compact && notes.length > 760 ? `${notes.slice(0,760).trim()}...` : notes;
    return `<section class="creative-era-journal${compact ? ' compact' : ''}"><small>${archiveEraParentId(era) ? 'sub-era journal' : 'era journal'}</small><div>${escapeHtml(value).replace(/\n/g,'<br>')}</div></section>`;
  }

  function archiveSubEraTilesHtml(parentId,entries,context) {
    var children = archiveEraChildren(parentId);
    if(!children.length) return '';
    return `<section class="archive-subera-passage"><header><small>inside this era</small><strong>${children.length} chapter${children.length === 1 ? '' : 's'}</strong></header><div>${children.map((child,index) => {
      var cover = child.resolved_cover_url || child.cover_url;
      var worlds = archiveEraTreeEntries(child.id,entries);
      var rows = archiveEraTreeRows(child.id);
      var journal = archiveEraJournalText(child);
      return `<button class="archive-subera-tile" type="button" style="--era-color:${escapeAttr(child.accent_color || '#ffffff')};--sub-index:${index}" onclick="${context === 'manager' ? `editArchiveEra('${escapeAttr(child.id)}')` : `openCreativeEraFromArchive('${escapeAttr(child.id)}')`}">${cover ? `<img src="${escapeAttr(cover)}" alt="" onerror="this.remove()">` : '<span class="archive-subera-field"></span>'}<span><small>${escapeHtml(child.start_date || 'open beginning')} / ${worlds.length} songs</small><strong>${escapeHtml(child.name)}</strong><em>${escapeHtml(journal ? (journal.length > 92 ? `${journal.slice(0,92).trim()}...` : journal) : `${rows.length} connected files`)}</em></span><i>${context === 'manager' ? 'edit' : 'enter'}</i></button>`;
    }).join('')}</div></section>`;
  }

  function archiveEraHomeItem(era,entries) {
    var worlds = archiveEraTreeEntries(era.id,entries);
    var rows = archiveEraTreeRows(era.id);
    var worldAssetIds = new Set(worlds.flatMap(world => world.rows).map(row => row.getAttribute('data-id')).filter(Boolean));
    return { era,worlds,rows,children:archiveEraChildren(era.id),looseCount:rows.filter(row => !worldAssetIds.has(row.getAttribute('data-id'))).length };
  }

  function archiveEraHomeCardHtml(item,entries) {
    var era = item.era;
    var cover = era.resolved_cover_url || era.cover_url;
    var chapterLabel = item.children.length ? ` / ${item.children.length} chapter${item.children.length === 1 ? '' : 's'}` : '';
    return `<details class="archive-era-home-card" style="--era-color:${escapeAttr(era.accent_color || '#ffffff')}"><summary>${cover ? `<img src="${escapeAttr(cover)}" alt="" onerror="this.remove()">` : '<span class="archive-era-home-field"></span>'}<span class="archive-era-home-copy"><small>${escapeHtml(era.visibility)} / ${escapeHtml(era.start_date || 'open beginning')}</small><strong>${escapeHtml(era.name)}</strong><span>${item.worlds.length} song${item.worlds.length === 1 ? '' : 's'} / ${item.rows.length} files${chapterLabel}</span></span><i>enter</i></summary><div class="archive-era-home-detail"><p>${escapeHtml(era.description || (!era.notes ? 'This archive era has no note yet.' : ''))}</p>${archiveEraJournalHtml(era,true)}${archiveSubEraTilesHtml(era.id,entries,'home')}${archiveEraGuessWorldsHtml({ worlds:item.worlds },12)}${item.looseCount ? `<span class="era-world-more">${item.looseCount} additional note${item.looseCount === 1 ? '' : 's'}, visual${item.looseCount === 1 ? '' : 's'}, or loose artifact${item.looseCount === 1 ? '' : 's'} also belong to this era.</span>` : ''}<button type="button" onclick="openCreativeEraFromArchive('${escapeAttr(era.id)}')">enter ${escapeHtml(era.name)}</button></div></details>`;
  }

  function renderArchiveEraShelf() {
    var shelf = document.getElementById('archiveEraShelf');
    if(!shelf) return;
    if(!archiveEnrichment.ready && !isAdmin) {
      shelf.hidden = true;
      shelf.innerHTML = '';
      return;
    }
    var entries = archiveEraWorldEntries();
    var accepted = archiveEraRoots().map(era => archiveEraHomeItem(era,entries));
    var allGuesses = isAdmin ? deriveArchiveEraGuesses() : [];
    var guesses = allGuesses.slice(0,6);
    if(!accepted.length && !guesses.length) {
      shelf.hidden = true;
      shelf.innerHTML = '';
      return;
    }
    if(isAdmin) enrichmentEraGuesses = allGuesses;
    var acceptedHtml = accepted.map(item => archiveEraHomeCardHtml(item,entries)).join('');
    var guessHtml = guesses.map(guess => {
      var parent = archiveEraSuggestedParent(guess);
      return `<details class="archive-era-home-card suggested" data-home-era-guess="${escapeAttr(guess.id)}"><summary><span class="archive-era-home-field suggested"></span><span class="archive-era-home-copy"><small>suggested / ${Math.round(guess.confidence * 100)}% / private</small><strong>${escapeHtml(guess.name)}</strong><span>${guess.worlds.length} songs began ${escapeHtml(guess.startDate || 'across an undated session')}${parent ? ` / possible chapter inside ${escapeHtml(parent.name)}` : ''}</span></span><i>inspect</i></summary><div class="archive-era-home-detail"><p>${escapeHtml(guess.evidence)}</p>${guess.aliases.length ? `<div class="era-guess-aliases"><small>other names found</small>${guess.aliases.map(name => `<span>${escapeHtml(name)}</span>`).join('')}</div>` : ''}${archiveEraGuessWorldsHtml(guess,10)}<button type="button" onclick="openArchiveEraSuggestionReview('${escapeAttr(guess.id)}')">review this suggestion</button></div></details>`;
    }).join('');
    var assignedKeys = new Set(accepted.flatMap(item => item.worlds.map(world => world.key)));
    var subEraCount = Math.max(0,archiveEnrichment.eras.length - accepted.length);
    shelf.hidden = false;
    shelf.innerHTML = `<header class="archive-era-home-head"><div><small>archive / eras</small><strong>creative worlds with chapters inside them.</strong><span>Songs keep the era where they began. Sessions, batches, and phases can live inside something larger.</span></div><div><span>${accepted.length} main era${accepted.length === 1 ? '' : 's'}</span><span>${subEraCount} sub-era${subEraCount === 1 ? '' : 's'}</span><span>${assignedKeys.size} songs placed</span>${isAdmin ? '<button type="button" onclick="openAdminReviewTool(\'eras\')">manage eras</button>' : ''}</div></header><div class="archive-era-home-list">${acceptedHtml}${guessHtml}</div>`;
  }

  function archiveEraManagerBranchHtml(era,entries,depth) {
    var parent = archiveEnrichment.erasById.get(archiveEraParentId(era)) || null;
    var siblings = parent ? archiveEraChildren(parent.id) : archiveEraRoots();
    var index = siblings.findIndex(item => item.id === era.id);
    var directCount = archiveEnrichment.assetEras.filter(item => item.era_id === era.id && item.review_status === 'confirmed').length;
    var directWorlds = archiveEraEntriesForId(era.id,entries);
    var treeWorlds = archiveEraTreeEntries(era.id,entries);
    var treeRows = archiveEraTreeRows(era.id);
    var children = archiveEraChildren(era.id);
    var cover = era.resolved_cover_url || era.cover_url;
    var branch = children.map(child => archiveEraManagerBranchHtml(child,entries,depth + 1)).join('');
    return `<div class="era-manager-branch" data-era-depth="${depth}"><details class="era-manager-card" style="--era-color:${escapeAttr(era.accent_color || '#ffffff')}"><summary><div class="era-manager-art">${cover ? `<img src="${escapeAttr(cover)}" alt="" onerror="this.remove()">` : `<span>${escapeHtml(era.name.slice(0,2).toLowerCase())}</span>`}</div><div class="era-manager-copy"><small>${parent ? `sub-era inside ${escapeHtml(parent.name)}` : 'top-level era'} / ${escapeHtml(era.visibility)}</small><strong>${escapeHtml(era.name)}</strong><p>${escapeHtml(archiveEraJournalText(era) || 'No era note yet.')}</p><span>${directWorlds.length} direct songs / ${treeWorlds.length} including chapters / ${treeRows.length} files</span></div><i>${children.length ? `${children.length} chapter${children.length === 1 ? '' : 's'}` : 'expand'}</i></summary><div class="era-manager-expanded">${archiveEraJournalHtml(era,true)}${archiveSubEraTilesHtml(era.id,entries,'manager')}${archiveEraGuessWorldsHtml({ worlds:directWorlds },12)}${!directWorlds.length ? '<span class="era-world-more">No songs are assigned directly here yet.</span>' : ''}<div class="era-manager-actions"><button type="button" onclick="openCreativeEraFromArchive('${escapeAttr(era.id)}')">open</button>${archiveEnrichment.eraHierarchyAvailable ? `<button type="button" onclick="prepareArchiveSubEra('${escapeAttr(era.id)}')">+ sub-era</button>` : ''}<button type="button" onclick="editArchiveEra('${escapeAttr(era.id)}')">edit</button><button type="button" onclick="moveArchiveEra('${escapeAttr(era.id)}',-1)"${index <= 0 ? ' disabled' : ''}>up</button><button type="button" onclick="moveArchiveEra('${escapeAttr(era.id)}',1)"${index < 0 || index >= siblings.length - 1 ? ' disabled' : ''}>down</button><button type="button" onclick="deleteArchiveEra('${escapeAttr(era.id)}')">delete</button><span>${directCount} direct relations</span></div></div></details>${branch ? `<div class="era-manager-children">${branch}</div>` : ''}</div>`;
  }

  function enrichmentEraManagerHtml() {
    var entries = archiveEraWorldEntries();
    var unassigned = entries.filter(entry => !entry.hasConfirmedPrimary);
    var conflicts = baseRows().filter(row => (archiveEnrichment.assetErasByAsset.get(row.getAttribute('data-id')) || []).filter(item => item.relationship === 'primary' && item.review_status === 'confirmed').length > 1);
    var selectionCount = selectedArchiveRows().length;
    var worldOptions = entries.map(entry => `<option value="${escapeAttr(entry.key)}">${escapeHtml(entry.title)} / began ${escapeHtml(entry.originDate || 'undated')} / ${entry.revisionCount} revisions</option>`).join('');
    var folderOptions = adminFolderPaths().map(path => `<option value="${escapeAttr(path)}">${escapeHtml(path)} / ${adminDescendantRows(path).length} files</option>`).join('');
    var eraOptions = archiveEraHierarchyFlat().map(item => `<option value="${escapeAttr(item.era.id)}">${escapeHtml(`${'— '.repeat(item.depth)}${archiveEraPathLabel(item.era)}`)}</option>`).join('');
    var cards = archiveEraRoots().map(era => archiveEraManagerBranchHtml(era,entries,0)).join('');
    var unassignedRows = unassigned.slice(0,24).map(entry => `<button type="button" onclick="openEraUnassignedRow('${escapeAttr(adminRowKey(entry.originRow))}')"><strong>${escapeHtml(entry.title)}</strong><span>began ${escapeHtml(entry.originDate || 'undated')} / ${entry.revisionCount} revisions</span></button>`).join('');
    var rootCount = archiveEraRoots().length;
    var subEraCount = Math.max(0,archiveEnrichment.eras.length - rootCount);
    var hierarchySetup = archiveEnrichment.eraHierarchyAvailable ? '' : `<section class="era-hierarchy-setup"><strong>sub-era storage needs one Supabase migration</strong><span>Run <code>supabase-era-hierarchy.sql</code>. Existing eras and song assignments remain untouched.</span></section>`;
    var parentControl = archiveEnrichment.eraHierarchyAvailable
      ? `<label class="era-parent-field"><span>inside / optional</span><select id="eraParent"><option value="">top-level era</option>${archiveEraParentOptions('','')}</select><small>Use this for an album era containing Batch 4, sessions, or other chapters.</small></label>`
      : `<label class="era-parent-field disabled"><span>inside / migration required</span><select id="eraParent" disabled><option value="">top-level era</option></select><small>Apply the private hierarchy migration before creating sub-eras.</small></label>`;
    var narrativeFields = archiveEnrichment.eraNotesAvailable
      ? `<label class="era-description"><span>short public story</span><textarea id="eraDescription" maxlength="4000" rows="3" placeholder="the one-paragraph identity shown on the era cover"></textarea></label><label class="era-notes"><span>era journal / notes</span><textarea id="eraNotes" maxlength="12000" rows="8" placeholder="sessions, decisions, track ideas, memories, or anything this era should keep"></textarea></label>`
      : `<label class="era-description"><span>era / sub-era note</span><textarea id="eraDescription" maxlength="4000" rows="7" placeholder="sessions, decisions, context, or anything this era should remember"></textarea><small>Run supabase-era-hierarchy.sql to unlock a separate long-form journal field.</small></label>`;
    return `<div class="era-manager">
      <section class="era-manager-intro"><div><small>eras / chapters / song origins</small><h3>the album can hold the session.</h3><p>A larger creative era can contain batches, sessions, and phases without flattening them. Songs belong to their most specific starting chapter; parent eras gather everything below them automatically.</p><button type="button" onclick="exportArchiveEraTraining()">teach the private analyzer from confirmed eras</button></div><div><span>main eras<strong>${rootCount}</strong></span><span>sub-eras<strong>${subEraCount}</strong></span><span>unassigned<strong>${unassigned.length}</strong></span></div></section>
      ${hierarchySetup}
      <section class="era-manager-list"><div class="era-editor-head"><strong>archive era hierarchy</strong><span>enter any era or add a chapter inside it</span></div>${cards || '<div class="enrichment-empty">No eras are hard-coded. Define the first larger creative era below.</div>'}</section>
      ${enrichmentEraGuessesHtml()}
      <div class="era-manager-tools">
        <details class="era-tool-panel" id="eraEditorPanel" open><summary><strong id="eraEditorTitle">create or edit an era</strong><span>identity, parent, dates, cover, journal</span></summary><section class="era-editor" id="eraEditor" oninput="captureArchiveEraEditorDraft()" onchange="captureArchiveEraEditorDraft()"><input type="hidden" id="eraEditId"><div class="era-editor-head"><strong>era identity</strong><button type="button" onclick="resetArchiveEraEditor()">clear</button></div><div class="era-editor-grid"><label><span>name</span><input id="eraName" maxlength="100" placeholder="artist-defined era name"></label>${parentControl}<label><span>visibility</span><select id="eraVisibility"><option value="public">public</option><option value="private">private</option><option value="hidden">hidden</option></select></label><label><span>start date / optional</span><input id="eraStartDate" type="date"></label><label><span>end date / optional</span><input id="eraEndDate" type="date"></label><label><span>accent</span><input id="eraAccent" type="color" value="#ffffff"></label><section class="era-cover-editor"><label><span>cover / optional</span><input id="eraCoverFile" type="file" accept="image/jpeg,image/png,image/webp,image/gif" onchange="handleArchiveEraCoverSelection(this)"></label><div class="era-current-cover" id="eraCurrentCover" hidden></div><label class="era-remove-cover" id="eraRemoveCoverWrap" hidden><input id="eraRemoveCover" type="checkbox" onchange="toggleArchiveEraCoverRemoval(this)"><span>remove current era cover</span></label><small id="eraCoverFileState"></small></section>${narrativeFields}</div><button class="primary" type="button" onclick="saveArchiveEra()">save era</button></section></details>
        <details class="era-tool-panel"><summary><strong>place songs and folders</strong><span>${selectionCount} archive files selected</span></summary><section class="era-assignment"><div class="era-editor-head"><strong>assign without moving files</strong><span>choose the most specific era or sub-era</span></div><div class="era-assignment-controls"><select id="eraAssignEra"><option value="">choose era</option>${eraOptions}</select><select id="eraAssignRelationship"><option value="primary">primary</option><option value="secondary">secondary</option></select><button type="button" onclick="assignEraToArchiveSelection()"${selectionCount ? '' : ' disabled'}>assign selection</button><button type="button" onclick="removeEraFromArchiveSelection()"${selectionCount ? '' : ' disabled'}>remove from selection</button></div><div class="era-world-assignment"><select id="eraAssignWorld"><option value="">choose Song World</option>${worldOptions}</select><button type="button" onclick="assignEraToWorld()">assign every revision in world</button></div><div class="era-folder-assignment"><select id="eraAssignFolder"><option value="">choose archive folder</option>${folderOptions}</select><button type="button" onclick="assignEraToFolder()">assign folder contents</button></div></section></details>
      </div>
      <details class="era-unassigned"><summary>unassigned songs / ${unassigned.length}</summary><div>${unassignedRows || '<span>Every Song World has a starting era.</span>'}</div></details>
    </div>`;
  }

  function resetArchiveEraEditor() {
    clearArchiveEraEditorDraft();
    ['eraEditId','eraName','eraStartDate','eraEndDate','eraDescription','eraNotes'].forEach(id => { var input=document.getElementById(id); if(input) input.value=''; });
    if(document.getElementById('eraVisibility')) document.getElementById('eraVisibility').value='public';
    if(document.getElementById('eraAccent')) document.getElementById('eraAccent').value='#ffffff';
    if(document.getElementById('eraCoverFile')) document.getElementById('eraCoverFile').value='';
    if(document.getElementById('eraRemoveCover')) document.getElementById('eraRemoveCover').checked=false;
    if(document.getElementById('eraCoverFileState')) document.getElementById('eraCoverFileState').textContent='';
    var parent = document.getElementById('eraParent');
    if(parent && archiveEnrichment.eraHierarchyAvailable) {
      parent.innerHTML = `<option value="">top-level era</option>${archiveEraParentOptions('','')}`;
      parent.value = '';
    }
    if(document.getElementById('eraEditorTitle')) document.getElementById('eraEditorTitle').textContent = 'create or edit an era';
    updateArchiveEraCoverControls();
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
    if(document.getElementById('eraNotes')) document.getElementById('eraNotes').value = era.notes || '';
    if(document.getElementById('eraRemoveCover')) document.getElementById('eraRemoveCover').checked = false;
    if(document.getElementById('eraCoverFile')) document.getElementById('eraCoverFile').value = '';
    var parent = document.getElementById('eraParent');
    if(parent && archiveEnrichment.eraHierarchyAvailable) {
      parent.innerHTML = `<option value="">top-level era</option>${archiveEraParentOptions(era.id,archiveEraParentId(era))}`;
      parent.value = archiveEraParentId(era);
    }
    var panel = document.getElementById('eraEditorPanel');
    if(panel) panel.open = true;
    if(document.getElementById('eraEditorTitle')) document.getElementById('eraEditorTitle').textContent = `edit ${era.name}`;
    updateArchiveEraCoverControls();
    captureArchiveEraEditorDraft();
    document.getElementById('eraEditor')?.scrollIntoView({ behavior:archiveSettings?.motion === 'off' ? 'auto' : 'smooth',block:'start' });
    document.getElementById('eraName')?.focus();
  }

  function prepareArchiveSubEra(parentId) {
    if(!requireAdmin()) return;
    if(!archiveEnrichment.eraHierarchyAvailable) return showAppNotice('Run supabase-era-hierarchy.sql before creating sub-eras.','error');
    var parentEra = archiveEnrichment.erasById.get(parentId);
    if(!parentEra) return showAppNotice('That parent era is no longer available.','error');
    resetArchiveEraEditor();
    var parent = document.getElementById('eraParent');
    if(parent) parent.value = parentEra.id;
    if(document.getElementById('eraAccent')) document.getElementById('eraAccent').value = parentEra.accent_color || '#ffffff';
    if(document.getElementById('eraStartDate')) document.getElementById('eraStartDate').value = parentEra.start_date || '';
    if(document.getElementById('eraEndDate')) document.getElementById('eraEndDate').value = parentEra.end_date || '';
    if(document.getElementById('eraEditorTitle')) document.getElementById('eraEditorTitle').textContent = `new sub-era inside ${parentEra.name}`;
    captureArchiveEraEditorDraft();
    var panel = document.getElementById('eraEditorPanel');
    if(panel) panel.open = true;
    document.getElementById('eraEditor')?.scrollIntoView({ behavior:archiveSettings?.motion === 'off' ? 'auto' : 'smooth',block:'center' });
    document.getElementById('eraName')?.focus();
  }

  async function saveArchiveEra() {
    if(!requireAdmin()) return;
    captureArchiveEraEditorDraft();
    var id = document.getElementById('eraEditId')?.value || '';
    var existingEra = archiveEnrichment.erasById.get(id) || null;
    var parentId = archiveEnrichment.eraHierarchyAvailable ? document.getElementById('eraParent')?.value || '' : '';
    if(id && archiveEraDescendantIds(id,true).has(parentId)) return showAppNotice('An era cannot be placed inside itself or one of its own sub-eras.','error');
    var payload = {
      name:cleanSingleLine(document.getElementById('eraName')?.value,100),
      slug:'',description:String(document.getElementById('eraDescription')?.value || '').slice(0,4000),
      start_date:document.getElementById('eraStartDate')?.value || null,
      end_date:document.getElementById('eraEndDate')?.value || null,
      accent_color:document.getElementById('eraAccent')?.value || '#ffffff',
      visibility:document.getElementById('eraVisibility')?.value || 'public'
    };
    if(archiveEnrichment.eraNotesAvailable) payload.notes = cleanMultiline(document.getElementById('eraNotes')?.value || '',12000);
    if(archiveEnrichment.eraHierarchyAvailable) payload.parent_era_id = parentId || null;
    if(!payload.name) return showAppNotice('Enter an era name.','error');
    if(payload.start_date && payload.end_date && payload.start_date > payload.end_date) return showAppNotice('The era start date is after its end date.','error');
    if(!id) {
      var siblings = parentId ? archiveEraChildren(parentId) : archiveEraRoots();
      payload.display_order = siblings.length ? Math.max(...siblings.map(era => Number(era.display_order || 0))) + 1 : 0;
    }
    var result = id ? await supabaseClient.from('archive_eras').update(payload).eq('id',id).select().single() : await supabaseClient.from('archive_eras').insert(payload).select().single();
    if(result.error) return showAppNotice(result.error.message,'error');
    var era = result.data;
    var file = document.getElementById('eraCoverFile')?.files?.[0];
    var removeCover = Boolean(document.getElementById('eraRemoveCover')?.checked);
    if(removeCover && existingEra) {
      var coverRemoval = await supabaseClient.from('archive_eras').update({ cover_storage_path:'',cover_url:'' }).eq('id',era.id);
      if(coverRemoval.error) return showAppNotice(`Era saved, but its cover could not be removed: ${coverRemoval.error.message}`,'error');
      if(existingEra.cover_storage_path) {
        var storageRemoval = await supabaseClient.storage.from(STORAGE_BUCKET).remove([existingEra.cover_storage_path]);
        if(storageRemoval.error) showAppNotice(`Era cover was detached, but its stored file could not be removed: ${storageRemoval.error.message}`,'error');
      }
    } else if(file) {
      var validation = validateAssetFile(file,'image');
      if(validation) return showAppNotice(validation,'error');
      var extension = String(file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g,'') || 'jpg';
      var storagePath = `era-covers/${era.id}.${extension}`;
      var upload = await supabaseClient.storage.from(STORAGE_BUCKET).upload(storagePath,file,{ upsert:true,contentType:file.type || undefined,cacheControl:'3600' });
      if(upload.error) return showAppNotice(`Era saved, but cover upload failed: ${upload.error.message}`,'error');
      var coverUpdate = await supabaseClient.from('archive_eras').update({ cover_storage_path:storagePath,cover_url:'' }).eq('id',era.id);
      if(coverUpdate.error) return showAppNotice(coverUpdate.error.message,'error');
      if(existingEra?.cover_storage_path && existingEra.cover_storage_path !== storagePath) {
        await supabaseClient.storage.from(STORAGE_BUCKET).remove([existingEra.cover_storage_path]);
      }
    }
    resetArchiveEraEditor();
    await loadArchiveEnrichmentData({ force:true });
    renderAdminWorkspace();
    var parentEra = archiveEnrichment.erasById.get(parentId);
    showAppNotice(parentEra ? `Sub-era saved inside ${parentEra.name}.` : 'Creative era saved.');
  }

  async function moveArchiveEra(id,direction) {
    if(!requireAdmin()) return;
    var era = archiveEnrichment.erasById.get(id);
    if(!era) return;
    var parentId = archiveEraParentId(era);
    var list = parentId ? archiveEraChildren(parentId) : archiveEraRoots();
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
    var children = archiveEraChildren(id);
    if(!era || !confirm(`Delete the era "${era.name}" and its direct assignments? Archive files are not moved or deleted.${children.length ? ` Its ${children.length} sub-era${children.length === 1 ? '' : 's'} will become top-level eras.` : ''}`)) return;
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

  async function removeWorldFromArchiveEra(eraId,worldKey,button) {
    if(!requireAdmin()) return;
    var era = archiveEnrichment.erasById.get(eraId);
    var world = getWorld(worldKey);
    var rows = archiveEraAssignedRowsForWorld(eraId,world);
    var ids = Array.from(new Set(rows.map(row => row.getAttribute('data-id')).filter(Boolean)));
    if(!era || !world || !ids.length) return showAppNotice('This song is no longer assigned directly to that era.','error');
    if(!confirm(`Remove "${world.title}" from "${era.name}"? This only removes ${ids.length} era assignment${ids.length === 1 ? '' : 's'}. The song, revisions, artwork, notes, and archive folders stay untouched.`)) return;
    var originalText = button?.textContent || 'remove from era';
    if(button) {
      button.disabled = true;
      button.textContent = 'removing...';
    }
    try {
      for(var offset=0; offset<ids.length; offset+=100) {
        var result = await supabaseClient.from('archive_asset_eras').delete().eq('era_id',eraId).in('asset_id',ids.slice(offset,offset+100));
        if(result.error) throw result.error;
      }
      await loadArchiveEnrichmentData({ force:true });
      if(archiveEnrichment.erasById.has(eraId)) openCreativeEraWorld(eraId);
      else renderCreativeErasWorlds();
      showAppNotice(`${world.title} was removed from ${era.name}. The archive files were not deleted.`);
    } catch(error) {
      if(button) {
        button.disabled = false;
        button.textContent = originalText;
      }
      showAppNotice(error.message || 'The era assignment could not be removed.','error');
    }
  }

  async function removeAssetFromArchiveEra(eraId,assetId,button) {
    if(!requireAdmin()) return;
    var era = archiveEnrichment.erasById.get(eraId);
    var row = enrichmentRowsByAsset.get(assetId) || document.querySelector(`.file-row[data-id="${cssEscape(assetId)}"]`);
    if(!era || !row) return showAppNotice('That era file is no longer available.','error');
    var title = row.getAttribute('data-title') || row.getAttribute('data-name') || 'this file';
    if(!confirm(`Remove "${title}" from "${era.name}"? The archive file itself will not be deleted.`)) return;
    var originalText = button?.textContent || 'remove from era';
    if(button) {
      button.disabled = true;
      button.textContent = 'removing...';
    }
    var result = await supabaseClient.from('archive_asset_eras').delete().eq('era_id',eraId).eq('asset_id',assetId);
    if(result.error) {
      if(button) {
        button.disabled = false;
        button.textContent = originalText;
      }
      return showAppNotice(result.error.message,'error');
    }
    await loadArchiveEnrichmentData({ force:true });
    openCreativeEraWorld(eraId);
    showAppNotice(`${title} was removed from ${era.name}. The archive file was kept.`);
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
    document.addEventListener('visibilitychange',function(){
      if(!document.hidden) return;
      flushEnrichmentDraftCapture();
      captureArchiveEraEditorDraft();
    });
    window.addEventListener('pagehide',function(){
      flushEnrichmentDraftCapture();
      captureArchiveEraEditorDraft();
    });
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
    else renderArchiveEraShelf();
  }

  function eraRows(eraId) {
    var assetIds = new Set(archiveEnrichment.assetEras.filter(item => item.era_id === eraId && item.review_status === 'confirmed').map(item => item.asset_id));
    return baseRows().filter(row => assetIds.has(row.getAttribute('data-id')));
  }

  function archiveEraAssignedRowsForWorld(eraId,world) {
    return (world?.rows || []).filter(row => {
      var assetId = row.getAttribute('data-id');
      if(!assetId) return false;
      return (archiveEnrichment.assetErasByAsset.get(assetId) || []).some(relation =>
        relation.era_id === eraId && relation.review_status === 'confirmed'
      );
    });
  }

  function creativeEraChapterCardsHtml(parentId,entries) {
    var children = archiveEraChildren(parentId);
    if(!children.length) return '';
    return `<section class="creative-era-chapters"><header><div><small>chapters inside this era</small><strong>${children.length} sub-era${children.length === 1 ? '' : 's'}</strong></div><span>sessions, batches, and phases keep their own identity here.</span></header><div class="creative-era-chapter-grid">${children.map((child,index) => {
      var cover = child.resolved_cover_url || child.cover_url;
      var worlds = archiveEraTreeEntries(child.id,entries);
      var rows = archiveEraTreeRows(child.id);
      var grandchildren = archiveEraChildren(child.id);
      return `<button class="creative-era-chapter" type="button" style="--era-color:${escapeAttr(child.accent_color || '#ffffff')};--chapter-index:${index}" onclick="openCreativeEraWorld('${escapeAttr(child.id)}')">${cover ? `<img src="${escapeAttr(cover)}" alt="" onerror="this.remove()">` : '<span class="creative-era-chapter-field"></span>'}<span class="creative-era-chapter-copy"><small>${escapeHtml(child.start_date || 'open beginning')}${grandchildren.length ? ` / ${grandchildren.length} nested` : ''}</small><strong>${escapeHtml(child.name)}</strong><span>${escapeHtml(archiveEraJournalText(child) || `A chapter inside ${archiveEnrichment.erasById.get(parentId)?.name || 'this era'}.`)}</span><em>${worlds.length} song${worlds.length === 1 ? '' : 's'} / ${rows.length} files</em></span><i>enter chapter</i></button>`;
    }).join('')}</div></section>`;
  }

  function renderCreativeErasWorlds() {
    var body = document.getElementById('worldsBody');
    if(!body) return;
    var entries = archiveEraWorldEntries();
    var assigned = entries.filter(entry => entry.hasConfirmedPrimary);
    var unassigned = entries.filter(entry => !entry.hasConfirmedPrimary);
    var roots = archiveEraRoots();
    var portals = roots.map((era,index) => {
      var rows = archiveEraTreeRows(era.id);
      var worlds = archiveEraTreeEntries(era.id,entries);
      var children = archiveEraChildren(era.id);
      var cover = era.resolved_cover_url || era.cover_url;
      var directWorlds = archiveEraEntriesForId(era.id,entries);
      var chapterHtml = children.length ? `<div class="creative-era-portal-chapters">${children.map((child,childIndex) => {
        var childCover = child.resolved_cover_url || child.cover_url;
        var childWorlds = archiveEraTreeEntries(child.id,entries);
        return `<button type="button" style="--chapter-index:${childIndex}" onclick="openCreativeEraWorld('${escapeAttr(child.id)}')">${childCover ? `<img src="${escapeAttr(childCover)}" alt="" onerror="this.remove()">` : '<span></span>'}<i>${escapeHtml(child.name)}</i><small>${childWorlds.length} songs</small></button>`;
      }).join('')}</div>` : '';
      return `<article class="creative-era-portal" style="--era-color:${escapeAttr(era.accent_color || '#ffffff')};--era-index:${index}"><button class="creative-era-portal-main" type="button" onclick="openCreativeEraWorld('${escapeAttr(era.id)}')"><span class="creative-era-portal-media">${cover ? `<img src="${escapeAttr(cover)}" alt="" onerror="this.remove()">` : '<span class="creative-era-field"></span>'}</span><span class="creative-era-portal-shade"></span><span class="creative-era-portal-copy"><small>main era ${String(index + 1).padStart(2,'0')} / ${escapeHtml(`${era.start_date || 'open beginning'} to ${era.end_date || 'open ending'}`)}</small><strong>${escapeHtml(era.name)}</strong><span>${escapeHtml(archiveEraJournalText(era) || 'Artist-defined archive era.')}</span><em>${worlds.length} song${worlds.length === 1 ? '' : 's'} / ${rows.length} connected files / ${children.length} chapter${children.length === 1 ? '' : 's'}${directWorlds.length ? ` / ${directWorlds.length} songs at the main level` : ''}</em></span><i>enter world</i></button>${chapterHtml}</article>`;
    }).join('');
    body.innerHTML = `<section class="worlds-intro creative-era-intro"><div class="worlds-intro-copy"><div class="worlds-kicker">creative eras / worlds with chapters</div><h1 class="worlds-title">the archive changes when angel changes.</h1><p class="worlds-copy">Albums can hold sessions. Sessions can hold batches. A song keeps the most specific place where it began, while every larger world gathers the history underneath it.</p></div><div class="world-summary"><div>main eras<strong>${roots.length}</strong></div><div>sub-eras<strong>${Math.max(0,archiveEnrichment.eras.length - roots.length)}</strong></div><div>placed songs<strong>${assigned.length}</strong></div></div></section><section class="creative-era-portals">${portals || '<div class="world-empty">No public creative eras have been defined yet. The normal archive and timeline remain complete.</div>'}</section>${unassigned.length ? `<section class="world-section creative-era-unassigned"><div class="world-section-head"><h3>outside an era</h3><span>${unassigned.length} songs still need a starting era</span></div>${archiveEraGuessWorldsHtml({ worlds:unassigned },40)}</section>` : ''}`;
  }

  function openCreativeEraWorld(id) {
    var era = archiveEnrichment.erasById.get(id);
    var body = document.getElementById('worldsBody');
    if(!era || !body) return;
    var entries = archiveEraWorldEntries();
    var directRows = eraRows(id).sort((a,b) => String(a.getAttribute('data-date') || '').localeCompare(String(b.getAttribute('data-date') || '')));
    var treeRows = archiveEraTreeRows(id).sort((a,b) => String(a.getAttribute('data-date') || '').localeCompare(String(b.getAttribute('data-date') || '')));
    var treeWorlds = archiveEraTreeEntries(id,entries);
    var assignedIds = new Set(directRows.map(row => row.getAttribute('data-id')).filter(Boolean));
    var coveredIds = new Set();
    var groups = archiveEraEntriesForId(id,entries).map(entry => {
      var assignedRows = entry.rows.filter(row => assignedIds.has(row.getAttribute('data-id')));
      assignedRows.forEach(row => coveredIds.add(row.getAttribute('data-id')));
      return { entry,rows:assignedRows };
    }).filter(group => group.rows.length);
    var looseRows = directRows.filter(row => !coveredIds.has(row.getAttribute('data-id')));
    var cover = era.resolved_cover_url || era.cover_url;
    var groupHtml = groups.map(group => `<section class="world-section creative-era-song-group"><div class="world-section-head creative-era-song-head"><div><h3>${escapeHtml(group.entry.title)}</h3><span>began ${escapeHtml(group.entry.originDate || 'undated')} / ${group.rows.length} assigned files</span></div>${isAdmin ? `<button class="creative-era-song-remove" type="button" onclick="removeWorldFromArchiveEra('${escapeAttr(id)}',decodeURIComponent('${encodeURIComponent(group.entry.key)}'),this)">remove from era</button>` : ''}</div><div class="world-file-list">${group.rows.map((row,index) => worldFileHtml(row,index)).join('')}</div></section>`).join('');
    var looseHtml = looseRows.length ? `<section class="world-section creative-era-loose"><div class="world-section-head"><h3>notes, visuals + loose artifacts</h3><span>${looseRows.length} files assigned directly to this era</span></div><div class="world-file-list">${looseRows.map((row,index) => `<div class="creative-era-loose-row">${worldFileHtml(row,index)}${isAdmin ? `<button type="button" onclick="removeAssetFromArchiveEra('${escapeAttr(id)}','${escapeAttr(row.getAttribute('data-id'))}',this)">remove from era</button>` : ''}</div>`).join('')}</div></section>` : '';
    var ancestors = archiveEraAncestors(id);
    var breadcrumb = ancestors.map(parent => `<button type="button" onclick="openCreativeEraWorld('${escapeAttr(parent.id)}')">${escapeHtml(parent.name)}</button><span>/</span>`).join('');
    var parent = ancestors[ancestors.length - 1] || null;
    var directWorldCount = groups.length;
    var chapterHtml = creativeEraChapterCardsHtml(id,entries);
    var emptyDirect = !groupHtml && !looseHtml ? `<div class="world-empty creative-era-direct-empty">${archiveEraChildren(id).length ? 'This level holds its history through the chapters below. Enter a sub-era to see its direct songs and artifacts.' : 'This era is defined, but no public archive revisions are assigned yet.'}</div>` : '';
    body.innerHTML = `<section class="creative-era-detail" style="--era-color:${escapeAttr(era.accent_color || '#ffffff')}"><nav class="creative-era-breadcrumb"><button type="button" onclick="renderCreativeErasWorlds()">all eras</button><span>/</span>${breadcrumb}<strong>${escapeHtml(era.name)}</strong></nav><div class="creative-era-detail-hero"><span class="creative-era-detail-backdrop">${cover ? `<img src="${escapeAttr(cover)}" alt="" onerror="this.remove()">` : '<span></span>'}</span><span class="creative-era-detail-veil"></span><div class="creative-era-detail-cover">${cover ? `<img src="${escapeAttr(cover)}" alt="" onerror="this.remove()">` : '<span></span>'}</div><div class="creative-era-detail-copy"><small>${parent ? `sub-era inside ${escapeHtml(parent.name)}` : 'main creative era'} / ${escapeHtml(`${era.start_date || 'open beginning'} to ${era.end_date || 'open ending'}`)}</small><h1>${escapeHtml(era.name)}</h1><p>${escapeHtml(era.description || (!era.notes ? 'This era has no public note yet.' : ''))}</p><div class="creative-era-detail-stats"><span>all songs<strong>${treeWorlds.length}</strong></span><span>all files<strong>${treeRows.length}</strong></span><span>direct songs<strong>${directWorldCount}</strong></span><span>chapters<strong>${archiveEraChildren(id).length}</strong></span></div></div><button type="button" class="creative-era-back" onclick="${parent ? `openCreativeEraWorld('${escapeAttr(parent.id)}')` : 'renderCreativeErasWorlds()'}">${parent ? `back to ${escapeHtml(parent.name)}` : 'back to all eras'}</button></div>${archiveEraJournalHtml(era,false)}${chapterHtml}<section class="creative-era-direct"><header><small>${archiveEraChildren(id).length ? 'at this level' : 'inside this era'}</small><strong>songs and artifacts placed directly in ${escapeHtml(era.name)}</strong><span>Sub-era content stays inside its own chapter instead of appearing twice.</span></header>${groupHtml}${looseHtml}${emptyDirect}</section></section>`;
    body.scrollTo({ top:0,behavior:archiveSettings?.motion === 'off' ? 'auto' : 'smooth' });
  }

  function creativeEraTimelineGroups() {
    var groups = archiveEraHierarchyFlat().map(item => ({ key:item.era.id,era:item.era,depth:item.depth,parent:item.parent,rows:[] }));
    var byId = new Map(groups.map(group => [group.key,group]));
    var unassigned = { key:'unassigned',depth:0,parent:null,era:{ name:'outside an era',description:'Dated archive files without a confirmed creative-era assignment.',accent_color:'#777777' },rows:[] };
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
      var path = group.key === 'unassigned' ? era.name : archiveEraPathLabel(era);
      var files = group.rows.map((row,rowIndex) => {
        var otherEras = acceptedErasForRow(row).filter(item => item.id !== group.key).map(item => item.name);
        return `<button class="immersive-file creative-era-file" type="button" data-row-key="${escapeAttr(timelineRowKey(row))}" style="--dot-color:${escapeAttr(era.accent_color || '#ffffff')};--file-index:${Math.min(rowIndex,12)}"><span class="immersive-file-number">${String(rowIndex + 1).padStart(2,'0')}</span><span class="immersive-file-icon"></span><span class="immersive-file-main"><strong>${escapeHtml(row.getAttribute('data-title') || 'untitled')}</strong><span class="immersive-file-sub">${escapeHtml(row.getAttribute('data-sub') || 'archive')} / ${escapeHtml(row.getAttribute('data-ver') || 'v1')}${otherEras.length ? ` / also ${escapeHtml(otherEras.join(' + '))}` : ''}</span></span><span class="immersive-file-actions"><span class="immersive-file-time">${escapeHtml(timelineDisplayTimeForRow(row) || row.getAttribute('data-type') || 'asset')}</span><span class="immersive-info" data-row-key="${escapeAttr(timelineRowKey(row))}">info</span></span></button>`;
      }).join('');
      return `<section class="immersive-day creative-era-timeline-section" data-immersive-day data-creative-era="${escapeAttr(group.key)}" data-era-depth="${group.depth || 0}" style="--day-index:${index};--era-depth:${group.depth || 0};--dot-color:${escapeAttr(era.accent_color || '#ffffff')}"><div class="immersive-day-label"><small>${group.depth ? `sub-era / level ${group.depth}` : 'main creative era'} ${String(index + 1).padStart(2,'0')}</small><strong>${escapeHtml(era.name)}</strong><em>${escapeHtml(path)}</em><span>${group.rows.length} indexed / ${escapeHtml(dates.length ? `${dates[0]} to ${dates[dates.length - 1]}` : 'undated')}<br>${escapeHtml(era.description || '')}</span></div><div class="immersive-files">${files}</div></section>`;
    }).join('');
    var rail = groups.map((group,index) => `<button type="button" data-era-depth="${group.depth || 0}" style="--era-depth:${group.depth || 0}" onclick="jumpToCreativeEra('${escapeAttr(group.key)}')"><span>${String(index + 1).padStart(2,'0')}</span><i>${escapeHtml(group.era.name)}</i></button>`).join('');
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
        unclear:Boolean(segment.unclear),words,
        source:cleanSingleLine(segment.source,80),
        rescued:Boolean(segment.rescued),
        reviewReason:cleanSingleLine(segment.reviewReason,240),
        originalStart:boundedAnalysisNumber(segment.originalStart,0,86400),
        boundaryDeduplicatedWords:boundedAnalysisNumber(segment.boundaryDeduplicatedWords,0,100)
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
