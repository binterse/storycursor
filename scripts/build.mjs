import { build, context } from 'esbuild';
import { mkdir, copyFile, readFile, writeFile } from 'node:fs/promises';
const debug = !process.argv.includes('--release');
const system = process.argv.includes('--system');
const googleEndpoint = process.env.STORYCURSOR_GOOGLE_ENDPOINT?.trim() ?? '';
if (googleEndpoint && !/^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(googleEndpoint)) {
  throw new Error('STORYCURSOR_GOOGLE_ENDPOINT must be an Apps Script /exec URL.');
}
const root = system ? ('dist/system/' + (debug ? 'debug' : 'release')) : (debug ? 'dist' : 'dist/release');
const outdir = root + '/extension';
await mkdir(outdir, { recursive: true });
await Promise.all(['popup.html','options.html','popup.css','icon-128.png'].map(file => copyFile('apps/extension/' + file, outdir + '/' + file)));
const manifest = JSON.parse(await readFile('apps/extension/manifest.json', 'utf8'));
if (debug) manifest.name += ' (Debug)';
await writeFile(outdir + '/manifest.json', JSON.stringify(manifest));
const options = { entryPoints: ['apps/extension/popup.ts','apps/extension/options.ts','apps/extension/worker.ts'], bundle: true, format: 'esm', outdir, target: 'chrome120', define: { STORYCURSOR_DEBUG: String(debug), STORYCURSOR_GOOGLE_ENDPOINT: JSON.stringify(googleEndpoint) }, minifySyntax: !debug };
if (process.argv.includes('--watch')) await (await context(options)).watch();
else await build(options);
const service = { entryPoints: ['apps/sheets-script/main.ts'], bundle: true, format: 'iife', globalName: 'StoryCursorService', outfile: root + '/sheets-script/Code.gs', target: 'es2022',
  footer: { js: `function doPost(e) { return StoryCursorService.handle(e); }
function doGet(e) { return StoryCursorService.handleGet(e); }
function initializeStoryCursor() { console.log(StoryCursorService.initialize()); }
function previewStoryCursorEnrollment() { console.log(JSON.stringify(StoryCursorService.preview())); }
function enrollStoryCursorRows() { console.log(StoryCursorService.enroll()); }` } };
await mkdir(root + '/sheets-script', { recursive: true });
const scriptManifest = JSON.parse(await readFile('apps/sheets-script/appsscript.json', 'utf8'));
if (googleEndpoint) scriptManifest.oauthScopes.push('https://www.googleapis.com/auth/script.external_request');
await writeFile(root + '/sheets-script/appsscript.json', JSON.stringify(scriptManifest));
if (process.argv.includes('--watch')) await (await context(service)).watch();
else await build(service);
