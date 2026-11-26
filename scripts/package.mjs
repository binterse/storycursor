import AdmZip from 'adm-zip';
import { readFileSync } from 'node:fs';
const directory = 'dist/release/extension';
const manifest = JSON.parse(readFileSync(directory + '/manifest.json', 'utf8'));
if (manifest.name !== 'StoryCursor') throw new Error('Expected the release extension.');
const manualTest = process.argv.includes('--manual-test');
if (!manualTest && !readFileSync(directory + '/options.js', 'utf8').includes('Sign in with Google')) {
  throw new Error('Store packages require STORYCURSOR_GOOGLE_ENDPOINT. Set it in .env.storycursor and rebuild.');
}
const zip = new AdmZip();
for (const asset of [...Object.values(manifest.icons),'manifest.json','options.html','options.js','popup.css','popup.html','popup.js','worker.js']) {
  zip.addLocalFile(directory + '/' + asset);
}
const debugMarkers = ['storycursor-local-debug', 'Download diagnostics', 'Clear diagnostics', 'jsonLdCount', 'readDebugPage'];
for (const entry of zip.getEntries()) {
  if (!/\.(?:js|html|json)$/.test(entry.entryName)) continue;
  const text = entry.getData().toString('utf8');
  if (debugMarkers.some(marker => text.includes(marker))) throw new Error('Debug code found in release asset: ' + entry.entryName);
}
const suffix = manualTest ? '-manual-test' : '';
zip.writeZip('dist/release/storycursor-' + manifest.version + suffix + '.zip');
