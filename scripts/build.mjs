import { build, context } from 'esbuild';
import { mkdir, copyFile, readFile, writeFile } from 'node:fs/promises';
const debug = !process.argv.includes('--release');
const root = debug ? 'dist' : 'dist/release';
const outdir = root + '/extension';
await mkdir(outdir, { recursive: true });
await Promise.all(['popup.html','options.html','popup.css','icon-128.png'].map(file => copyFile('apps/extension/' + file, outdir + '/' + file)));
const manifest = JSON.parse(await readFile('apps/extension/manifest.json', 'utf8'));
if (debug) manifest.name += ' (Debug)';
await writeFile(outdir + '/manifest.json', JSON.stringify(manifest));
const options = { entryPoints: ['apps/extension/popup.ts','apps/extension/options.ts','apps/extension/worker.ts'], bundle: true, format: 'esm', outdir, target: 'chrome120', define: { STORYCURSOR_DEBUG: String(debug) }, minifySyntax: !debug };
if (process.argv.includes('--watch')) await (await context(options)).watch();
else await build(options);
const service = { entryPoints: ['apps/sheets-script/main.ts'], bundle: true, format: 'iife', globalName: 'StoryCursorService', outfile: root + '/sheets-script/Code.gs', target: 'es2022',
  footer: { js: `function doPost(e) { return StoryCursorService.handle(e); }
function initializeStoryCursor() { console.log(StoryCursorService.initialize()); }
function previewStoryCursorEnrollment() { console.log(JSON.stringify(StoryCursorService.preview())); }
function enrollStoryCursorRows() { console.log(StoryCursorService.enroll()); }` } };
await mkdir(root + '/sheets-script', { recursive: true });
await copyFile('apps/sheets-script/appsscript.json', root + '/sheets-script/appsscript.json');
if (process.argv.includes('--watch')) await (await context(service)).watch();
else await build(service);
