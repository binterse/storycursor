import { build, context } from 'esbuild';
import { mkdir, copyFile } from 'node:fs/promises';
const outdir = 'dist/extension';
await mkdir(outdir, { recursive: true });
await Promise.all(['popup.html','popup.css','manifest.json'].map(file => copyFile('apps/extension/' + file, outdir + '/' + file)));
const options = { entryPoints: ['apps/extension/popup.ts','apps/extension/worker.ts'], bundle: true, format: 'esm', outdir, target: 'chrome120' };
if (process.argv.includes('--watch')) await (await context(options)).watch();
else await build(options);
