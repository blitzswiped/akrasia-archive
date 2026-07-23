import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const indexPath = path.join(root,'index.html');
let html = fs.readFileSync(indexPath,'utf8');

if(html.includes('assets/css/base.css') && html.includes('assets/js/bootstrap.js')) {
  console.log('index.html is already split.');
  process.exit(0);
}

function markerIndex(source,marker,label) {
  const index = source.indexOf(marker);
  if(index < 0) throw new Error(`Missing ${label || marker}`);
  return index;
}

function writePart(relativePath,content) {
  const target = path.join(root,relativePath);
  fs.mkdirSync(path.dirname(target),{recursive:true});
  const normalized = content.replace(/^\r?\n/,'').replace(/\s*$/,'') + '\n';
  fs.writeFileSync(target,normalized,'utf8');
  console.log(`${relativePath}: ${normalized.split(/\r?\n/).length - 1} lines`);
}

const styleMatch = /<style>([\s\S]*?)<\/style>/i.exec(html);
if(!styleMatch) throw new Error('Inline application stylesheet was not found.');
const css = styleMatch[1];
const cssLive = markerIndex(css,'  /* ===== LIVE ROOM ===== */','live CSS marker');
const cssPlayer = markerIndex(css,'  /* ===== VIEWPORTS ===== */','player CSS marker');
const cssArchive = markerIndex(css,'  /* ===== IMMERSIVE ARCHIVE DIRECTION ===== */','archive CSS marker');
const cssPolish = markerIndex(css,'  /* Final progress treatment: waveform scrubber with played/remaining split. */','polish CSS marker');
const cssWorlds = markerIndex(css,'  /* Continuous first-visit archive journey. This replaces the old slide tour. */','worlds CSS marker');

writePart('assets/css/base.css',css.slice(0,cssLive));
writePart('assets/css/live.css',css.slice(cssLive,cssPlayer));
writePart('assets/css/player.css',css.slice(cssPlayer,cssArchive));
writePart('assets/css/archive-timeline.css',css.slice(cssArchive,cssPolish));
writePart('assets/css/polish-responsive.css',css.slice(cssPolish,cssWorlds));
writePart('assets/css/intro-worlds.css',css.slice(cssWorlds));

const styleLinks = [
  '  <link rel="stylesheet" href="assets/css/base.css">',
  '  <link rel="stylesheet" href="assets/css/live.css">',
  '  <link rel="stylesheet" href="assets/css/player.css">',
  '  <link rel="stylesheet" href="assets/css/archive-timeline.css">',
  '  <link rel="stylesheet" href="assets/css/polish-responsive.css">',
  '  <link rel="stylesheet" href="assets/css/intro-worlds.css">'
].join('\n');
html = html.slice(0,styleMatch.index) + styleLinks + html.slice(styleMatch.index + styleMatch[0].length);

const inlineScripts = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)];
const appScriptMatch = inlineScripts.find(match => match[1].includes('const SUPABASE_URL'));
if(!appScriptMatch) throw new Error('Inline application script was not found.');
const script = appScriptMatch[1];
const jsLive = markerIndex(script,'  function cloneLiveState(state) {','live JS marker');
const jsArchive = markerIndex(script,'  function readFolderStates() {','archive JS marker');
const jsPlayer = markerIndex(script,'  function showMediaInNowPlaying(row, type) {','player JS marker');
const jsWorlds = markerIndex(script,'  // ---- ARCHIVE WORLDS','worlds JS marker');
const jsBootstrap = markerIndex(script,'  // Init','bootstrap JS marker');

const liveBlock = script.slice(jsLive,jsArchive);
const statsStart = markerIndex(liveBlock,'  function playStatKey(row) {','stats start marker');
const statsEnd = markerIndex(liveBlock,'  async function saveLiveState(state) {','stats end marker');
const liveWithoutStats = liveBlock.slice(0,statsStart).replace(/\s*$/,'') + '\n\n' + liveBlock.slice(statsEnd).replace(/^\s*\r?\n/,'');

const archiveBlock = script.slice(jsArchive,jsPlayer);
const timelineStart = markerIndex(archiveBlock,'  function timelineDateForRow(row) {','timeline start marker');
const bandlabStart = markerIndex(archiveBlock,'  // ---- FILE INJECTION ----','BandLab start marker');
const bandlabEnd = markerIndex(archiveBlock,'  async function loadRemoteArchive() {','BandLab end marker');
const archiveWithoutFeatures = archiveBlock.slice(0,timelineStart).replace(/\s*$/,'') + '\n\n' + archiveBlock.slice(bandlabEnd).replace(/^\s*\r?\n/,'');

writePart('assets/js/core.js',script.slice(0,jsLive));
writePart('assets/js/live.js',liveWithoutStats);
writePart('assets/js/stats.js',liveBlock.slice(statsStart,statsEnd));
writePart('assets/js/timeline.js',archiveBlock.slice(timelineStart,bandlabStart));
writePart('assets/js/bandlab-sync.js',archiveBlock.slice(bandlabStart,bandlabEnd));
writePart('assets/js/archive.js',archiveWithoutFeatures);
writePart('assets/js/player.js',script.slice(jsPlayer,jsWorlds));
writePart('assets/js/worlds.js',script.slice(jsWorlds,jsBootstrap));
writePart('assets/js/bootstrap.js',script.slice(jsBootstrap));

const scriptTags = [
  '<script src="assets/js/core.js"></script>',
  '<script src="assets/js/live.js"></script>',
  '<script src="assets/js/stats.js"></script>',
  '<script src="assets/js/timeline.js"></script>',
  '<script src="assets/js/bandlab-sync.js"></script>',
  '<script src="assets/js/archive.js"></script>',
  '<script src="assets/js/player.js"></script>',
  '<script src="assets/js/worlds.js"></script>',
  '<script src="assets/js/bootstrap.js"></script>'
].join('\n');
html = html.slice(0,appScriptMatch.index) + scriptTags + html.slice(appScriptMatch.index + appScriptMatch[0].length);
fs.writeFileSync(indexPath,html,'utf8');
console.log('index.html now loads ordered stylesheets and classic scripts.');
