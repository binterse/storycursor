import AdmZip from 'adm-zip';
import { readFileSync } from 'node:fs';
const { version } = JSON.parse(readFileSync('dist/extension/manifest.json', 'utf8'));
const zip = new AdmZip();
zip.addLocalFolder('dist/extension');
zip.writeZip('dist/storycursor-' + version + '.zip');
