import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const html = fs.readFileSync(path.join(root,'index.html'),'utf8');
const jsDir = path.join(root,'assets','js');
const jsFiles = fs.readdirSync(jsDir).filter(file => file.endsWith('.js')).sort();
const failures = [];

function check(condition,message) {
  if(!condition) failures.push(message);
}

const assetRefs = [...html.matchAll(/(?:src|href)="(assets\/(?:js|css)\/[^"]+)"/g)].map(match => match[1]);
const assetPaths = assetRefs.map(reference => new URL(reference,'https://akrasia.local/').pathname.replace(/^\/+/,''));
const missingAssets = assetPaths.filter(relativePath => !fs.existsSync(path.join(root,relativePath)));
check(!missingAssets.length,`missing assets: ${missingAssets.join(', ')}`);
check(!/<style>[\s\S]*?<\/style>/i.test(html),'index.html still contains an inline application stylesheet');
check(!/<script>\s*const SUPABASE_URL/.test(html),'index.html still contains the monolithic application script');

const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map(match => match[1]);
const duplicateIds = [...new Set(ids.filter((id,index) => ids.indexOf(id) !== index))];
check(!duplicateIds.length,`duplicate IDs: ${duplicateIds.join(', ')}`);

const functions = [];
const sources = new Map();
for(const file of jsFiles) {
  const source = fs.readFileSync(path.join(jsDir,file),'utf8');
  sources.set(file,source);
  try { new Function(source); }
  catch(error) { failures.push(`${file} syntax: ${error.message}`); }
  for(const match of source.matchAll(/(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/g)) functions.push([match[1],file]);
}

const functionNames = functions.map(entry => entry[0]);
const duplicateFunctions = [...new Set(functionNames.filter((name,index) => functionNames.indexOf(name) !== index))];
check(!duplicateFunctions.length,`duplicate functions: ${duplicateFunctions.map(name => `${name} (${functions.filter(entry => entry[0] === name).map(entry => entry[1]).join(', ')})`).join('; ')}`);

const live = sources.get('live.js') || '';
const saveStart = live.indexOf('async function saveLiveState');
const saveEnd = live.indexOf('function receiveLiveState',saveStart);
const saveBody = live.slice(saveStart,saveEnd);
check(saveStart >= 0,'saveLiveState is missing from live.js');
check(saveBody.indexOf('if(liveRehearsal || (state && state.rehearsal)) return;') >= 0,'saveLiveState does not stop rehearsal writes');
check(saveBody.indexOf('if(liveRehearsal || (state && state.rehearsal)) return;') < saveBody.indexOf("liveChannel.send"),'rehearsal guard runs after realtime broadcast');
check(saveBody.indexOf('if(liveRehearsal || (state && state.rehearsal)) return;') < saveBody.indexOf("from('archive_live_state').upsert"),'rehearsal guard runs after Supabase write');
check(/function receiveLiveState\(state\) \{\s*if\(liveRehearsal\) return;/.test(live),'incoming public state can overwrite rehearsal');
check(/async function loadLiveState\(\) \{\s*if\(!supabaseClient \|\| liveRehearsal\) return;/.test(live),'cloud state can load during rehearsal');
check(/async function scheduleLivePremiere[\s\S]*?if\(liveRehearsal\) return/.test(sources.get('worlds.js') || ''),'premiere scheduling is not blocked in rehearsal');
check((html.match(/data-rehearsal-toggle/g) || []).length >= 3,'rehearsal controls are missing from the UI');
check((html.match(/id="liveAdminDrawer"/g) || []).length === 1,'live control room must have exactly one overlay');
check(!html.includes('id="tab-live-control"'),'obsolete admin live-control pane is still present');
check((html.match(/data-live-control-tab=/g) || []).length === 3,'live control room needs set, details, and room views');
check((html.match(/data-control-section=/g) || []).length === 8,'live control sections are not partitioned consistently');
check(html.includes('id="timelineModeSelect"') && html.includes('id="timelineScaleSelect"') && html.includes('id="timelineFilterSelect"'),'compact timeline controls are missing');
check(!html.includes('class="worlds-nav"'),'obsolete Song Worlds mega-navigation is still present');
check(/function setLiveControlView\(view\)/.test(live),'live control-room view switch is missing');
check(/var LIVE_PHASES = \['offline','armed','countdown','live','paused','ended'\]/.test(live),'live phase vocabulary is missing');

console.log(JSON.stringify({
  indexBytes:Buffer.byteLength(html),
  stylesheets:assetPaths.filter(ref => ref.endsWith('.css')).length,
  scripts:jsFiles.length,
  ids:ids.length,
  functions:functions.length,
  rehearsalControls:(html.match(/data-rehearsal-toggle/g) || []).length,
  failures
},null,2));

if(failures.length) process.exitCode = 1;
