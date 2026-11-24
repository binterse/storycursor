import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const cli = require.resolve('@playwright/test/cli');
const live = process.argv.includes('--live');
const google = process.argv.includes('--google');

function run(args, environment = {}) {
  const result = spawnSync(process.execPath, args, {
    stdio:'inherit', env:{ ...process.env, STORYCURSOR_SYSTEM_BUILD:'1', ...environment },
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

if (google) {
  run(['scripts/build.mjs', '--system', '--release'], { STORYCURSOR_GOOGLE_ENDPOINT: 'https://script.google.com/macros/s/storycursor-google-test/exec' });
  run([cli, 'test', 'tests/google-onboarding.spec.ts', '--project', 'release', '--output', 'test-results/google'], { STORYCURSOR_GOOGLE_TEST: '1' });
} else if (live) {
  run(['scripts/build.mjs', '--system']);
  run([cli, 'test', '--config', 'playwright.live.config.ts']);
} else {
  run(['scripts/build.mjs', '--system']);
  run(['scripts/build.mjs', '--system', '--release']);
  run([cli, 'test', '--project', 'debug', '--project', 'release']);
}
