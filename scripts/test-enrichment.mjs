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
  function cleanSourceToken(value,maxLength){return String(value||'').replace(/[^a-z0-9._:-]+/gi,'-').replace(/^-+|-+$/g,'').slice(0,maxLength||180)}
  function stableSourceHash(value){let h=2166136261;for(const c of String(value||'')){h^=c.charCodeAt(0);h=Math.imul(h,16777619)}return (h>>>0).toString(16).padStart(8,'0')}
  function parseLyricTime(value){const m=String(value||'').trim().match(/^(?:(\\d+):)?(\\d{1,2})(?:[.:](\\d{1,3}))?$/);if(!m)return null;return Number(m[1]||0)*60+Number(m[2]||0)+(m[3]?Number('0.'+m[3].padEnd(3,'0').slice(0,3)):0)}
  function parseSyncedLyrics(text){const out=[];cleanSyncedLyrics(text).split('\\n').forEach(line=>{const m=line.trim().match(/^\\[([^\\]]+)\\]\\s*(.+)$/);if(!m)return;const time=parseLyricTime(m[1]);let lyric=m[2];let lane='main';const laneMatch=lyric.match(/^\\[(adlib|bg|background|lead|main|effect)\\]\\s*(.*)$/i);if(laneMatch){lane=laneMatch[1].toLowerCase()==='background'?'bg':laneMatch[1].toLowerCase();lyric=laneMatch[2]}out.push({time,text:lyric,lane,isPause:lyric==='...'})});return out}
`;
const { privateLyricsPayload, privateAudioMetadataPayload, privateTagSuggestions, bandlabAnalysisSuggestionRecords, repairEnrichmentLyricBreaks, enrichmentErrorIsBrokenNullSanitizer, acceptEnrichmentLyricsCompatibility } = new Function(
  `${enrichmentHelpers}\n${enrichmentSource}\nreturn { privateLyricsPayload, privateAudioMetadataPayload, privateTagSuggestions, bandlabAnalysisSuggestionRecords, repairEnrichmentLyricBreaks, enrichmentErrorIsBrokenNullSanitizer, acceptEnrichmentLyricsCompatibility };`
)();

const lyrics = privateLyricsPayload({
  syncedText:'[0:01.00] hello',detectedLanguage:'en',vocalInstrumentalStatus:'vocal',
  segments:[{start:1,end:2,text:'hello',confidence:.8,lane:'main',words:[{start:1,end:1.4,text:'hello',probability:.82}]}],
  model:{adapter:'faster-whisper',name:'test',version:'1'}
});
assert.equal(lyrics.segments[0].words[0].text,'hello');
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
assert.equal(privateAudioMetadataPayload({ estimatedBpm:900 }).estimatedBpm,null);
assert.equal(privateAudioMetadataPayload({ energyScore:.72 }).energyScore,.72);
assert.equal(privateTagSuggestions([{ value:'late-night',category:'time-of-day',confidence:.7 }]).length,1);
assert.equal(privateTagSuggestions([{ value:'made-up',category:'unsupported',confidence:.9 }]).length,0);

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

const archiveSource = fs.readFileSync(new URL('../assets/js/archive.js', import.meta.url),'utf8');
assert.match(archiveSource,/hydrateArchiveEnrichmentRows === 'function'/);
assert.match(enrichmentSource,/data-analysis-status/);
assert.match(enrichmentSource,/data-lyrics-review/);
assert.match(enrichmentSource,/ENRICHMENT_SUGGESTION_SUMMARY_COLUMNS/);
assert.match(enrichmentSource,/assignEraToFolder/);

console.log('enrichment contract tests passed');
