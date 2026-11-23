import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const cli = require.resolve('@playwright/test/cli');
const live = process.argv.includes('--live');

function run(args) {
  const result = spawnSync(process.execPath, args, {
    stdio:'inherit', env:{ ...process.env, STORYCURSOR_SYSTEM_BUILD:'1' },
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

run(['scripts/build.mjs', '--system']);
if (live) {
  run([cli, 'test', '--config', 'playwright.live.config.ts']);
} else {
  run(['scripts/build.mjs', '--system', '--release']);
  run([cli, 'test', '--project', 'debug', '--project', 'release']);
}
