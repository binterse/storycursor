import { build, context } from 'esbuild';
import { mkdir, copyFile } from 'node:fs/promises';
const outdir = 'dist/extension';
await mkdir(outdir, { recursive: true });
await Promise.all(['popup.html','popup.css','manifest.json'].map(file => copyFile('apps/extension/' + file, outdir + '/' + file)));
const options = { entryPoints: ['apps/extension/popup.ts','apps/extension/worker.ts'], bundle: true, format: 'esm', outdir, target: 'chrome120' };
if (process.argv.includes('--watch')) await (await context(options)).watch();
else await build(options);
const service = { entryPoints: ['apps/sheets-script/main.ts'], bundle: true, format: 'iife', globalName: 'StoryCursorService', outfile: 'dist/sheets-script/Code.gs', target: 'es2022',
  footer: { js: `function doPost(e) { return StoryCursorService.handle(e); }
function initializeStoryCursor() { console.log(StoryCursorService.initialize()); }
function previewStoryCursorEnrollment() { console.log(JSON.stringify(StoryCursorService.preview())); }
function enrollStoryCursorRows() { console.log(StoryCursorService.enroll()); }` } };
await mkdir('dist/sheets-script', { recursive: true });
await copyFile('apps/sheets-script/appsscript.json', 'dist/sheets-script/appsscript.json');
if (process.argv.includes('--watch')) await (await context(service)).watch();
else await build(service);
