import AdmZip from 'adm-zip';
const zip = new AdmZip();
zip.addLocalFolder('dist/extension');
zip.writeZip('dist/storycursor-0.1.0.zip');
