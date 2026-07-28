import assert from 'node:assert/strict';
import fs from 'node:fs';

const bandlabSource = fs.readFileSync(new URL('../assets/js/bandlab-sync.js', import.meta.url),'utf8');
const bandlabHelpers = `
  function cleanSingleLine(value,maxLength){return String(value||'').replace(/[\\r\\n\\t]+/g,' ').trim().slice(0,maxLength||500)}
`;
const { stableUtf8SourceHash, sourcePathRelativeToSelectedRoot, cleanBandlabAnalysisRevision } = new Function(
  `${bandlabHelpers}\n${bandlabSource}\nreturn { stableUtf8SourceHash, sourcePathRelativeToSelectedRoot, cleanBandlabAnalysisRevision };`
)();

function independentFnv(value) {
  let hash = 2166136261;
  for(const byte of Buffer.from(String(value),'utf8')) {
    hash ^= byte;
    hash = Math.imul(hash,16777619);
  }
  return (hash >>> 0).toString(16).padStart(8,'0');
}

assert.equal(stableUtf8SourceHash('project|v2|song/song.mp3|' + 'A'.repeat(64)),independentFnv('project|v2|song/song.mp3|' + 'A'.repeat(64)));
assert.equal(stableUtf8SourceHash('akrasia cafe'),independentFnv('akrasia cafe'));
assert.equal(sourcePathRelativeToSelectedRoot('BandLab Backup/nested/song.mp3'),'nested/song.mp3');
assert.equal(sourcePathRelativeToSelectedRoot('BandLab Backup/nested/manifest.json'),'nested/manifest.json');
assert.match(bandlabSource,/analysisSidecar\.byId\.get\(item\.revisionId\)/);
assert.match(bandlabSource,/bandlabVersion\(item\.analysis\.revisionNumber\) !== item\.version/);

const revision = cleanBandlabAnalysisRevision({
  revisionId:'revision-id',revisionNumber:'v001',sourceSha256:'A'.repeat(64),
  analysisStatus:'complete',cache:{fingerprint:'f'.repeat(64)},
  lyrics:{syncedText:'[0:01.00] line'},audioMetadata:{estimatedBpm:120},
  tagSuggestions:[],eraEvidence:{},warnings:[]
});
assert.equal(revision.revisionNumber,'v001');
assert.equal(revision.lyrics.syncedText,'[0:01.00] line');
assert.throws(() => cleanBandlabAnalysisRevision({ revisionId:'x',revisionNumber:'v1',analysisStatus:'complete' }),/identity/);

const enrichmentSource = fs.readFileSync(new URL('../assets/js/enrichment.js', import.meta.url),'utf8');
const playerSource = fs.readFileSync(new URL('../assets/js/player.js', import.meta.url),'utf8');
const playerLyricsStart = playerSource.indexOf('  function parseLyricTime');
const playerLyricsEnd = playerSource.indexOf('  function groupSyncedLyrics');
assert.ok(playerLyricsStart >= 0 && playerLyricsEnd > playerLyricsStart);
const playerLyricsBlock = playerSource.slice(playerLyricsStart,playerLyricsEnd);
const { parseSyncedLyrics:parsePlayerSyncedLyrics } = new Function(`
  function cleanSingleLine(value,maxLength){return String(value||'').replace(/[\\r\\n\\t]+/g,' ').trim().slice(0,maxLength||500)}
  function cleanSyncedLyrics(value){return String(value==null?'':value).replace(/\\r\\n?/g,'\\n').replace(/[\\x00-\\x08\\x0b\\x0c\\x0e-\\x1f\\x7f]/g,'').trim().slice(0,40000)}
  ${playerLyricsBlock}
  return { parseSyncedLyrics };
`)();
assert.deepEqual(
  parsePlayerSyncedLyrics('[0:07.20] [adlib] [glow:high] [speed:fast] still here'),
  [{
    time:7.2,text:'still here',lane:'adlib',glow:'high',speed:'fast',
    words:[{ text:'still',speed:1 },{ text:'here',speed:1 }],
    isPause:false
  }]
);
assert.equal(parsePlayerSyncedLyrics('[0:08.00] ordinary line')[0].glow,'soft');
assert.equal(parsePlayerSyncedLyrics('[0:08.00] ordinary line')[0].speed,'slow');
assert.deepEqual(
  parsePlayerSyncedLyrics('[0:09.00] I [word:.5x]need [word:2x]this still')[0].words,
  [
    { text:'I',speed:1 },
    { text:'need',speed:.5 },
    { text:'this',speed:2 },
    { text:'still',speed:1 }
  ]
);
const lyricFocusStart = playerSource.indexOf('  function lyricFocusLineHtml');
const lyricFocusEnd = playerSource.indexOf('  var lyricCenterFrame');
assert.ok(lyricFocusStart >= 0 && lyricFocusEnd > lyricFocusStart);
const lyricFocusBlock = playerSource.slice(lyricFocusStart,lyricFocusEnd);
const wordTimingMarkup = new Function(`
  function cleanSingleLine(value,maxLength){return String(value||'').replace(/[\\r\\n\\t]+/g,' ').trim().slice(0,maxLength||500)}
  function cleanSyncedLyrics(value){return String(value==null?'':value).replace(/\\r\\n?/g,'\\n').trim().slice(0,40000)}
  function escapeHtml(value){return String(value||'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]))}
  function escapeAttr(value){return escapeHtml(value)}
  ${playerLyricsBlock}
  var activeLyricGroups = [{ time:9,lines:[] },{ time:13,lines:[] }];
  ${lyricFocusBlock}
  return lyricFocusLineHtml({
    text:'I need this still',lane:'main',glow:'soft',speed:'slow',
    words:[{text:'I',speed:1},{text:'need',speed:.5},{text:'this',speed:2},{text:'still',speed:1}]
  },0,0);
`)();
const renderedWordWindows = Array.from(wordTimingMarkup.matchAll(/data-word-start="([0-9.]+)" data-word-end="([0-9.]+)" data-word-speed="([0-9.]+)"/g))
  .map(match => ({ duration:Number(match[2]) - Number(match[1]),speed:Number(match[3]) }));
assert.equal(renderedWordWindows.length,4);
assert.ok(renderedWordWindows.find(word => word.speed === .5).duration > renderedWordWindows.find(word => word.speed === 2).duration * 3);
assert.doesNotMatch(wordTimingMarkup,/\[word:/);
const compatibilityWrites = [];
globalThis.__enrichmentTestSupabase = {
  from(table) {
    return {
      update(values) {
        const filters = {};
        return {
          eq(column,value) {
            filters[column] = value;
            return this;
          },
          async select() {
            compatibilityWrites.push({ table,values,filters });
            return { data:[{ id:filters.id || 'asset-id' }],error:null };
          }
        };
      }
    };
  }
};
const enrichmentHelpers = `
  var supabaseClient = globalThis.__enrichmentTestSupabase;
  function cleanSingleLine(value,maxLength){return String(value||'').replace(/[\\r\\n\\t]+/g,' ').trim().slice(0,maxLength||500)}
  function cleanSyncedLyrics(value){return String(value==null?'':value).replace(/\\r\\n?/g,'\\n').replace(/[\\x00-\\x08\\x0b\\x0c\\x0e-\\x1f\\x7f]/g,'').trim().slice(0,40000)}
  function escapeHtml(value){return String(value||'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]))}
  function escapeAttr(value){return escapeHtml(value).replace(/\`/g,'&#96;')}
  function cleanSourceToken(value,maxLength){return String(value||'').replace(/[^a-z0-9._:-]+/gi,'-').replace(/^-+|-+$/g,'').slice(0,maxLength||180)}
  function stableSourceHash(value){let h=2166136261;for(const c of String(value||'')){h^=c.charCodeAt(0);h=Math.imul(h,16777619)}return (h>>>0).toString(16).padStart(8,'0')}
  ${playerLyricsBlock}
`;
const { privateLyricsPayload, privateAudioMetadataPayload, privateTagSuggestions, bandlabAnalysisSuggestionRecords, repairEnrichmentLyricBreaks, repairEnrichmentLyricBreaksResult, enrichmentDraftLines, enrichmentLyricEvidence, serializeEnrichmentDraftLines, enrichmentWordTimingHtml, buildEnrichmentFlowGroups, enrichmentErrorIsBrokenNullSanitizer, acceptEnrichmentLyricsCompatibility, archiveEraNameSignals, archiveEraTextMentionsWorld, archiveEraTextTitleSignal, archiveEraWorldOrigin, archiveEnrichment, archiveEraParentId, archiveEraChildren, archiveEraRoots, archiveEraDescendantIds, archiveEraAncestors, archiveEraHierarchyFlat, archiveEraPathLabel, archiveEraParentOptions, archiveEraAssignedRowsForWorld } = new Function(
  `${enrichmentHelpers}\n${enrichmentSource}\nreturn { privateLyricsPayload, privateAudioMetadataPayload, privateTagSuggestions, bandlabAnalysisSuggestionRecords, repairEnrichmentLyricBreaks, repairEnrichmentLyricBreaksResult, enrichmentDraftLines, enrichmentLyricEvidence, serializeEnrichmentDraftLines, enrichmentWordTimingHtml, buildEnrichmentFlowGroups, enrichmentErrorIsBrokenNullSanitizer, acceptEnrichmentLyricsCompatibility, archiveEraNameSignals, archiveEraTextMentionsWorld, archiveEraTextTitleSignal, archiveEraWorldOrigin, archiveEnrichment, archiveEraParentId, archiveEraChildren, archiveEraRoots, archiveEraDescendantIds, archiveEraAncestors, archiveEraHierarchyFlat, archiveEraPathLabel, archiveEraParentOptions, archiveEraAssignedRowsForWorld };`
)();

const lyrics = privateLyricsPayload({
  syncedText:'[0:01.00] hello',detectedLanguage:'en',vocalInstrumentalStatus:'vocal',
  segments:[{
    start:1.42,end:2,text:'hello',confidence:.8,lane:'main',
    source:'rescue-vocal-stem',rescued:true,
    reviewReason:'recovered by the permissive second transcription pass',
    words:[{start:1.42,end:1.7,text:'hello',probability:.82}]
  }],
  model:{adapter:'faster-whisper',name:'test',version:'1'}
});
assert.equal(lyrics.segments[0].words[0].text,'hello');
assert.equal(lyrics.segments[0].rescued,true);
assert.equal(
  enrichmentLyricEvidence(lyrics,{ time:1,text:'hello' }).reason,
  'recovered by the permissive second transcription pass'
);
assert.equal(enrichmentLyricEvidence(lyrics,{ time:1,text:'hello' }).unsure,true);
assert.equal(lyrics.format,'akrasia-synced-text');
assert.equal(privateLyricsPayload({ syncedText:'[0:01.00] hel\u0000lo' }).syncedText,'[0:01.00] hello');
assert.equal(enrichmentErrorIsBrokenNullSanitizer({ message:'null character not permitted' }),true);
assert.equal(enrichmentErrorIsBrokenNullSanitizer({ message:'permission denied' }),false);
const compatibilityResult = await acceptEnrichmentLyricsCompatibility(
  { id:'suggestion-id',asset_id:'asset-id',payload:{ format:'akrasia-synced-text' } },
  { getAttribute(name){ return name === 'data-id' ? 'asset-id' : ''; } },
  '[0:01.00] hel\u0000lo'
);
assert.equal(compatibilityResult.error,null);
assert.equal(compatibilityWrites.length,2);
assert.equal(compatibilityWrites[0].table,'archive_assets');
assert.equal(compatibilityWrites[0].values.synced_lyrics,'[0:01.00] hello');
assert.equal(compatibilityWrites[1].table,'archive_enrichment_suggestions');
assert.equal(compatibilityWrites[1].values.status,'accepted');
assert.equal(
  repairEnrichmentLyricBreaks('[0:01.00] this is a template and.\n[0:02.00] i was saying.'),
  '[0:01.00] this is a template and i was saying'
);
const cadenceRepair = repairEnrichmentLyricBreaksResult(
  "[0:35.34] God bless you folks cutting them matrix Get us up, I\n[0:38.74] don't know, holy the fray grinch genesis of a god what",
  {
    segments:[
      { start:35.34,end:38.74,words:[] },
      { start:38.74,end:42.06,words:[
        { start:38.74,text:"don't" },
        { start:39.08,text:'know,' },
        { start:39.42,text:'holy' }
      ] }
    ]
  }
);
assert.equal(cadenceRepair.shifts,1);
assert.match(cadenceRepair.text,/I don't know,/);
assert.match(cadenceRepair.text,/\[0:39\.42\] holy the fray/);
const cappedSegmentRepair = repairEnrichmentLyricBreaksResult(
  '[0:55.94] they killed themselves off in so many ways felt like hunting\n[0:59.98] them down for so many days man i was feeling so',
  {
    segments:[
      { start:55.94,end:59.98,words:Array.from({ length:11 },(_,index) => ({ start:55.94 + index * .34,text:`w${index}` })) },
      { start:59.98,end:62.84,words:[
        { start:59.98,text:'them' },
        { start:60.22,text:'down' },
        { start:60.48,text:'for' },
        { start:60.72,text:'so' },
        { start:60.96,text:'many' }
      ] }
    ]
  }
);
assert.equal(cappedSegmentRepair.shifts,1);
assert.match(cappedSegmentRepair.text,/hunting them down for so/);
const styledLines = enrichmentDraftLines('[0:07.20] [adlib] [glow:off] [speed:fast] still here');
assert.deepEqual(styledLines,[{
  time:7.2,lane:'adlib',glow:'off',speed:'fast',
  words:[{ text:'still',speed:1 },{ text:'here',speed:1 }],
  text:'still here'
}]);
assert.equal(serializeEnrichmentDraftLines(styledLines),'[0:07.20] [adlib] [glow:off] [speed:fast] still here');
assert.equal(
  serializeEnrichmentDraftLines(enrichmentDraftLines('[0:08.00] ordinary line')),
  '[0:08.00] ordinary line'
);
const wordTimedLines = enrichmentDraftLines('[0:09.00] I [word:.5x]need [word:2x]this still');
assert.equal(
  serializeEnrichmentDraftLines(wordTimedLines),
  '[0:09.00] I [word:0.5x]need [word:2x]this still'
);
assert.equal(wordTimedLines[0].text,'I need this still');
const wordTimingControls = enrichmentWordTimingHtml(wordTimedLines[0]);
assert.match(wordTimingControls,/word timing/);
assert.match(wordTimingControls,/2 changed/);
assert.match(wordTimingControls,/data-word-settings=/);
assert.equal((wordTimingControls.match(/data-lyric-word-speed/g) || []).length,0);
const flowGroups = buildEnrichmentFlowGroups([
  { time:12,lane:'main',text:'lead line' },
  { time:12.02,lane:'adlib',text:'response' },
  { time:18,lane:'main',text:'next line' }
]);
assert.equal(flowGroups.length,2);
assert.deepEqual(flowGroups[0].lines.map(line => line.lane),['main','adlib']);
assert.deepEqual(flowGroups[0].lines.map(line => line.editorIndex),[0,1]);
assert.equal(privateAudioMetadataPayload({ estimatedBpm:900 }).estimatedBpm,null);
assert.equal(privateAudioMetadataPayload({ energyScore:.72 }).energyScore,.72);
assert.equal(privateTagSuggestions([{ value:'late-night',category:'time-of-day',confidence:.7 }]).length,1);
assert.equal(privateTagSuggestions([{ value:'made-up',category:'unsupported',confidence:.9 }]).length,0);

function makeEraRow(values) {
  return {
    getAttribute(name) {
      return Object.hasOwn(values,name) ? values[name] : '';
    }
  };
}

assert.ok(archiveEraNameSignals('June 15 sessions','text file').some(signal => signal.name === 'june 15 sessions'));
assert.ok(archiveEraNameSignals('these songs are from Before Akrasia.','folder note').some(signal => signal.name === 'before akrasia'));
assert.ok(archiveEraNameSignals('project name: glass hallway','text file').some(signal => signal.name === 'glass hallway'));
assert.equal(archiveEraNameSignals('mix notes for tomorrow','song note').length,0);
assert.equal(
  archiveEraTextMentionsWorld(
    makeEraRow({ 'data-text-content':'come back\nanother song', 'data-notes':'' }),
    'come back'
  ),
  true
);
assert.equal(
  archiveEraTextTitleSignal(makeEraRow({
    'data-title':'DAYS AFTER/BEFORE AKRASIA TRACKLIST IDEA.txt',
    'data-text-content':'song one\nsong two\nsong three'
  })).name,
  'days after/before akrasia'
);
assert.equal(
  archiveEraTextTitleSignal(makeEraRow({
    'data-title':'inspirations.txt',
    'data-text-content':'artist one\nartist two\nartist three'
  })),
  null
);
const originV1 = makeEraRow({
  'data-id':'song-v1','data-type':'audio','data-ver':'v001','data-name':'Song - v001.mp3',
  'data-asset-date':'2026-06-15T12:00:00Z','data-date':'2026-06-15'
});
const laterV4 = makeEraRow({
  'data-id':'song-v4','data-type':'audio','data-ver':'v004','data-name':'Song - v004.mp3',
  'data-asset-date':'2026-07-15T12:00:00Z','data-date':'2026-07-15'
});
const originSummary = archiveEraWorldOrigin({
  key:'song-world',title:'song',audio:[laterV4,originV1],rows:[laterV4,originV1]
});
assert.equal(originSummary.originRow,originV1);
assert.equal(originSummary.originDate,'2026-06-15');
assert.equal(originSummary.latestDate,'2026-07-15');
assert.equal(originSummary.revisionCount,2);

const albumEra = { id:'album-era',name:'Album Era',display_order:0,parent_era_id:null };
const batchEra = { id:'batch-4',name:'Batch 4',display_order:1,parent_era_id:'album-era' };
const sessionEra = { id:'night-session',name:'Night Session',display_order:0,parent_era_id:'batch-4' };
const orphanEra = { id:'orphan-era',name:'Orphan Era',display_order:2,parent_era_id:'missing-era' };
archiveEnrichment.eras = [batchEra,orphanEra,sessionEra,albumEra];
archiveEnrichment.erasById = new Map(archiveEnrichment.eras.map(era => [era.id,era]));
assert.equal(archiveEraParentId(batchEra),'album-era');
assert.deepEqual(archiveEraChildren('album-era').map(era => era.id),['batch-4']);
assert.deepEqual(archiveEraRoots().map(era => era.id),['album-era','orphan-era']);
assert.deepEqual(Array.from(archiveEraDescendantIds('album-era',true)).sort(),['album-era','batch-4','night-session']);
assert.deepEqual(archiveEraAncestors('night-session').map(era => era.id),['album-era','batch-4']);
assert.deepEqual(
  archiveEraHierarchyFlat().map(item => `${item.depth}:${item.era.id}`),
  ['0:album-era','1:batch-4','2:night-session','0:orphan-era']
);
assert.equal(archiveEraPathLabel(sessionEra),'Album Era / Batch 4 / Night Session');
assert.doesNotMatch(archiveEraParentOptions('album-era',''),/batch-4|night-session/);
const assignedEraRow = makeEraRow({ 'data-id':'assigned-asset' });
const otherEraRow = makeEraRow({ 'data-id':'other-asset' });
archiveEnrichment.assetErasByAsset = new Map([
  ['assigned-asset',[{ era_id:'batch-4',review_status:'confirmed' }]],
  ['other-asset',[{ era_id:'album-era',review_status:'confirmed' }]]
]);
assert.deepEqual(
  archiveEraAssignedRowsForWorld('batch-4',{ rows:[assignedEraRow,otherEraRow] }),
  [assignedEraRow]
);

const fakeRow = { getAttribute(name){ return name === 'data-id' ? 'asset-id' : ''; } };
const suggestions = bandlabAnalysisSuggestionRecords({
  revisionId:'revision-id',sha256:'A'.repeat(64),status:'unchanged',existingRow:fakeRow,analysisStale:false,
  analysis:{
    analysisStatus:'complete',sourceSha256:'A'.repeat(64),analyzedAt:'2026-07-18T00:00:00Z',warnings:[],
    cache:{fingerprint:'f'.repeat(64)},lyrics,
    audioMetadata:{estimatedBpm:120,bpmConfidence:.7,analyzer:'test',analyzerVersion:'1'},
    tagSuggestions:[{value:'high-energy',category:'energy',confidence:.7,model:'rules',modelVersion:'1'}],
    eraEvidence:{
      suggestedEraId:'era-id',suggestedEraName:'Akrasia v1',confidence:.71,
      candidates:[{eraId:'era-id',eraName:'Akrasia v1',confidence:.71,evidence:['date + confirmed examples']}],
      explanation:'ranked from confirmed examples'
    }
  }
});
assert.deepEqual(suggestions.map(item => item.kind).sort(),['audio_metadata','era','lyrics','tags']);
assert.equal(suggestions.find(item => item.kind === 'era').payload.eraEvidence.candidates[0].eraName,'Akrasia v1');
assert.ok(suggestions.every(item => item.asset_id === 'asset-id' && item.cache_key.length <= 180));
assert.equal(JSON.stringify(suggestions).includes('localFolderPath'),false);

const sql = fs.readFileSync(new URL('../supabase-setup.sql', import.meta.url),'utf8');
assert.match(sql,/archive_enrichment_suggestions enable row level security/);
assert.match(sql,/revoke all on public\.archive_enrichment_suggestions from anon,public/);
assert.match(sql,/accept_archive_lyrics/);
assert.match(sql,/clean_lyrics := left\(coalesce\(p_synced_text,''\),40000\)/);
assert.doesNotMatch(sql,/replace\(coalesce\(p_synced_text,''\),chr\(0\),''\)/);
assert.match(sql,/archive_asset_primary_era_unique/);
assert.match(sql,/archive_tag_aliases\.tag_id/);
assert.match(sql,/archive_asset_tags\.tag_id/);
assert.match(sql,/archive_asset_eras\.era_id/);
assert.match(sql,/invalid loudness/);
assert.match(sql,/analysis_features jsonb/);
assert.match(sql,/invalid era cover storage path/);
assert.match(sql,/parent_era_id uuid references public\.archive_eras\(id\) on delete set null/);
assert.match(sql,/notes text not null default ''/);
assert.match(sql,/archive_eras_parent_order_idx/);
assert.match(sql,/era hierarchy cycle detected/);

const eraHierarchySql = fs.readFileSync(new URL('../supabase-era-hierarchy.sql', import.meta.url),'utf8');
assert.match(eraHierarchySql,/^begin;/);
assert.match(eraHierarchySql,/add column if not exists parent_era_id/);
assert.match(eraHierarchySql,/add column if not exists notes/);
assert.match(eraHierarchySql,/with recursive era_ancestors/);
assert.match(eraHierarchySql,/create trigger archive_era_validation/);
assert.match(eraHierarchySql,/commit;\s*$/);

const archiveSource = fs.readFileSync(new URL('../assets/js/archive.js', import.meta.url),'utf8');
assert.match(archiveSource,/hydrateArchiveEnrichmentRows === 'function'/);
assert.match(enrichmentSource,/data-analysis-status/);
assert.match(enrichmentSource,/data-lyrics-review/);
assert.match(enrichmentSource,/ENRICHMENT_SUGGESTION_SUMMARY_COLUMNS/);
assert.match(enrichmentSource,/assignEraToFolder/);
assert.match(enrichmentSource,/collapseEnrichmentEraSuggestions/);
assert.match(enrichmentSource,/archiveEraTextRowsForWorld/);
assert.match(enrichmentSource,/renderArchiveEraShelf/);
assert.match(enrichmentSource,/accept for entire song world/);
assert.match(enrichmentSource,/joinFocusedEnrichmentLyricLine/);
assert.match(enrichmentSource,/No clear automatic breaks found/);
assert.match(enrichmentSource,/data-lyric-glow/);
assert.match(enrichmentSource,/data-lyric-speed/);
assert.match(enrichmentSource,/enrichmentReviewSearch/);
assert.match(enrichmentSource,/enrichmentLyricFlowHtml/);
assert.match(enrichmentSource,/archiveEraJournalHtml/);
assert.match(enrichmentSource,/removeWorldFromArchiveEra/);
assert.match(enrichmentSource,/The archive files were not deleted/);
assert.match(enrichmentSource,/prepareArchiveSubEra/);
assert.match(enrichmentSource,/creativeEraChapterCardsHtml/);
assert.match(enrichmentSource,/chapters inside this era/);
assert.match(playerSource,/data-glow="\$\{escapeAttr\(glow\)\}"/);
assert.match(playerSource,/data-speed="\$\{escapeAttr\(speed\)\}"/);

const worldsSource = fs.readFileSync(new URL('../assets/js/worlds.js', import.meta.url),'utf8');
assert.match(worldsSource,/function worldNoteEntries/);
assert.match(worldsSource,/from the archive journal/);
assert.match(worldsSource,/\['overview','versions','artifacts','notes','lyrics','credits'\]/);

console.log('enrichment contract tests passed');
