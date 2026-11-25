import { chromium, expect, test } from '@playwright/test';
import { createHash } from 'node:crypto';
import { extensionPath } from './chrome-popup';

const endpoint = 'https://script.google.com/macros/s/storycursor-google-test/exec';
const state = '1a'.repeat(16);
const browserCode = '2b'.repeat(16);
const echoUrl = 'https://script.googleusercontent.com/macros/echo?fixture=oauth-return';

for (const useDefault of [true, false]) {
  test('Google sign-in connects using ' + (useDefault ? 'the default folder' : 'an explicitly selected folder'), async ({ browserName }, info) => {
    test.skip(process.env.STORYCURSOR_GOOGLE_TEST !== '1' || browserName !== 'chromium');
    const path = extensionPath(info.project.name);
    const browser = await chromium.launchPersistentContext(info.outputPath('profile'), {
      channel: 'chromium', headless: true, args: ['--disable-extensions-except=' + path, '--load-extension=' + path,
        '--host-resolver-rules=MAP accounts.google.com 127.0.0.1, MAP script.google.com 127.0.0.1, MAP script.googleusercontent.com 127.0.0.1'],
    });
    try {
      const expires = Math.floor(Date.now() / 1000) + 3600;
      const token = expires.toString(16).padStart(12, '0') + '0'.repeat(52);
      const binding = 'f'.repeat(64);
      const selectedFolders: string[] = [];
      let expectedProofHash = '';
      await browser.route(endpoint, route => {
        const request = route.request().postDataJSON();
        if (request.action === 'googleBegin') {
          expectedProofHash = request.proofHash;
          const parameters = new URLSearchParams({ state, redirect_uri: endpoint, response_type: 'code' });
          return route.fulfill({ json: { status: 'ready', state, url: 'https://accounts.google.com/o/oauth2/v2/auth?' + parameters } });
        }
        if (request.action === 'googleFinish') {
          const valid = request.state === state && request.browserCode === browserCode && typeof request.proof === 'string' &&
            createHash('sha256').update(request.proof).digest('hex') === expectedProofHash;
          return route.fulfill({ json: valid ? { status: 'ready', token } : { status: 'failed' } });
        }
        if (request.token !== token) return route.fulfill({ json: { status: 'failed' } });
        if (request.action === 'folders') return route.fulfill({ json: { status: 'ready', folders: [
          { id: 'other-folder-id', name: 'Reading', label: 'Reading' },
          { id: 'new', name: 'StoryCursor', label: 'StoryCursor (create new)' },
        ] } });
        if (request.action === 'useFolder') {
          selectedFolders.push(request.folder);
          return route.fulfill({ json: { status: 'ready' } });
        }
        return route.fulfill({ json: { status: 'ready', binding } });
      });
      await browser.route(url => url.origin === 'https://accounts.google.com' && url.pathname === '/o/oauth2/v2/auth', route => route.fulfill({
        contentType: 'text/html', body: '<a href="' + echoUrl + '">Authorize test account</a>',
      }));
      await browser.route(echoUrl, route => route.fulfill({ json: { status: 'ready', state, browserCode } }));
      const worker = browser.serviceWorkers()[0] ?? await browser.waitForEvent('serviceworker');
      const page = browser.pages()[0] ?? await browser.newPage();
      await page.goto('chrome-extension://' + new URL(worker.url()).hostname + '/options.html');
      await expect(page.getByLabel('Service token')).toBeHidden();
      await page.getByRole('button', { name: 'Sign in with Google' }).click({ timeout: 5000 });
      await expect.poll(() => browser.pages().map(tab => tab.url())).toContainEqual(expect.stringContaining('accounts.google.com'));
      const google = browser.pages().find(tab => tab.url().startsWith('https://accounts.google.com/'))!;
      await expect(google.getByRole('link', { name: 'Authorize test account' }), 'Google fixture page: ' + google.url()).toBeVisible();
      await google.getByRole('link', { name: 'Authorize test account' }).click({ timeout: 5000 });
      await expect(page.getByRole('button', { name: 'Use StoryCursor folder' })).toBeVisible();
      expect(selectedFolders).toEqual([]);
      if (useDefault) await page.getByRole('button', { name: 'Use StoryCursor folder' }).click();
      else {
        await page.getByRole('button', { name: 'Choose another folder' }).click();
        await page.getByRole('button', { name: 'Back', exact: true }).click();
        await expect(page.getByRole('button', { name: 'Use StoryCursor folder' })).toBeVisible();
        await page.getByRole('button', { name: 'Choose another folder' }).click();
        await page.getByRole('combobox', { name: 'Folder', exact: true }).selectOption({ value: 'other-folder-id' }, { timeout: 5000 });
        await page.getByRole('button', { name: 'Use folder', exact: true }).click({ timeout: 5000 });
      }
      await expect(page.getByText('Google Sheets connected')).toBeVisible();
      expect(selectedFolders).toEqual([useDefault ? 'new' : 'other-folder-id']);
      await expect(page.getByLabel('Service token')).toHaveCount(0);
      page.once('dialog', dialog => dialog.accept());
      await page.getByRole('button', { name: 'Disconnect', exact: true }).click();
      await page.reload();
      await expect(page.getByRole('button', { name: 'Sign in with Google' })).toBeVisible();
      expect(await worker.evaluate(async () => (await chrome.storage.local.get('connection')).connection)).toBeUndefined();
    } finally {
      await browser.close();
    }
  });
}
