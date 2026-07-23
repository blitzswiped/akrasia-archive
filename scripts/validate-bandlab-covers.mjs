import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const mapPath = path.join(root, 'assets', 'data', 'bandlab-covers.json');
const backupRoot = path.join(root, 'bandlab downloading', 'BandLab Backup');
const shouldFix = process.argv.includes('--fix');
const shouldCheckRemote = process.argv.includes('--remote');
const payload = JSON.parse(fs.readFileSync(mapPath, 'utf8').replace(/^\uFEFF/, ''));
const manifestTitles = new Map();

for (const entry of fs.readdirSync(backupRoot, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const manifestPath = path.join(backupRoot, entry.name, 'manifest.json');
  if (!fs.existsSync(manifestPath)) continue;
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8').replace(/^\uFEFF/, ''));
  if (manifest.bandLabProjectId && manifest.projectTitle) {
    manifestTitles.set(String(manifest.bandLabProjectId).toLowerCase(), String(manifest.projectTitle).trim());
  }
}

for (const project of payload.projects || []) {
  const sourceTitle = manifestTitles.get(String(project.projectId || '').toLowerCase());
  if (sourceTitle) project.title = sourceTitle;
}

payload.projects.sort((a, b) => a.title.localeCompare(b.title) || a.projectId.localeCompare(b.projectId));
const ids = new Set(payload.projects.map(project => project.projectId));
const invalid = payload.projects.filter(project =>
  !/^[a-f0-9-]{36}$/i.test(project.projectId || '') ||
  !/^https:\/\/bl-prod-images\.azureedge\.net\//i.test(project.coverUrl || '') ||
  !/\/1024x1024$/.test(project.coverUrl || '')
);

if (payload.projects.length !== 106 || ids.size !== payload.projects.length || invalid.length) {
  throw new Error(`Invalid BandLab cover map: ${payload.projects.length} rows, ${ids.size} unique ids, ${invalid.length} invalid rows`);
}

if (shouldFix) fs.writeFileSync(mapPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');

if (shouldCheckRemote) {
  const uniqueUrls = [...new Set(payload.projects.map(project => project.coverUrl))];
  const failures = [];
  for (const url of uniqueUrls) {
    try {
      const response = await fetch(url);
      const type = response.headers.get('content-type') || '';
      if (!response.ok || !type.startsWith('image/')) failures.push(`${response.status} ${type} ${url}`);
      else await response.arrayBuffer();
    } catch (error) {
      failures.push(`${error.message} ${url}`);
    }
  }
  if (failures.length) throw new Error(`BandLab cover download failures:\n${failures.join('\n')}`);
}

console.log(JSON.stringify({
  projects: payload.projects.length,
  manifestTitles: manifestTitles.size,
  customCovers: payload.projects.filter(project => project.coverKind === 'song').length,
  profileCovers: payload.projects.filter(project => project.coverKind === 'profile').length,
  fixed: shouldFix,
  remoteChecked: shouldCheckRemote
}, null, 2));
