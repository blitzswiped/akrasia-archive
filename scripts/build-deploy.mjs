import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const output = path.resolve(root, 'dist');
const expectedOutput = path.join(path.resolve(root), 'dist');

if (output !== expectedOutput) {
  throw new Error(`Refusing to clean unexpected output path: ${output}`);
}

fs.rmSync(output, { recursive: true, force: true });
fs.mkdirSync(output, { recursive: true });
fs.copyFileSync(path.join(root, 'index.html'), path.join(output, 'index.html'));
fs.cpSync(path.join(root, 'assets'), path.join(output, 'assets'), { recursive: true });

const html = fs.readFileSync(path.join(output, 'index.html'), 'utf8');
const references = [...html.matchAll(/(?:src|href)=["'](assets\/(?:js|css)\/[^"']+)["']/g)]
  .map(match => match[1]);
const referencePaths = references.map(reference => new URL(reference,'https://akrasia.local/').pathname.replace(/^\/+/,''));
const missing = referencePaths.filter(relativePath => !fs.existsSync(path.join(output, relativePath)));

if (missing.length) {
  throw new Error(`Deployment is missing referenced assets: ${missing.join(', ')}`);
}

const files = [];
for (const directory of ['assets/css', 'assets/js']) {
  for (const file of fs.readdirSync(path.join(output, directory))) {
    files.push(`${directory}/${file}`);
  }
}

console.log(JSON.stringify({
  output,
  files: files.length + 1,
  stylesheets: referencePaths.filter(reference => reference.endsWith('.css')).length,
  scripts: referencePaths.filter(reference => reference.endsWith('.js')).length,
  missing
}, null, 2));
