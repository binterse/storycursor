import { chromium, expect, test } from '@playwright/test';
import { createHash } from 'node:crypto';
import { extensionPath } from './chrome-popup';

const endpoint = 'https://script.google.com/macros/s/storycursor-google-test/exec';
const state = '1a'.repeat(16);
const browserCode = '2b'.repeat(16);
const echoUrl = 'https://script.googleusercontent.com/macros/echo?fixture=oauth-return';

test('an existing Google session waits for a folder and keeps the last choice on this device', async ({ browserName }, info) => {
  test.skip(process.env.STORYCURSOR_GOOGLE_TEST !== '1' || browserName !== 'chromium');
  const path = extensionPath(info.project.name);
  const browser = await chromium.launchPersistentContext(info.outputPath('profile'), {
    channel: 'chromium', headless: true, args: ['--disable-extensions-except=' + path, '--load-extension=' + path],
  });
  try {
    const preferred = 'b'.repeat(64);
    const other = 'c'.repeat(64);
    const selected: string[] = [];
    await browser.route(endpoint, route => {
      const request = route.request().postDataJSON();
      if (request.action === 'folders') return route.fulfill({ json: { status: 'ready', folders: [
        { id: preferred, name: 'StoryCursor / Reading', label: 'StoryCursor / Reading' },
        { id: other, name: 'StoryCursor', label: 'StoryCursor' },
      ] } });
      if (request.action === 'useFolder') {
        selected.push(request.folder);
        return route.fulfill({ json: { status: 'ready', binding: request.folder } });
      }
      expect(request.action).toBe('check');
      return route.fulfill({ json: { status: 'ready', binding: request.binding } });
    });
    const worker = browser.serviceWorkers()[0] ?? await browser.waitForEvent('serviceworker');
    await worker.evaluate(session => chrome.storage.local.set({ connection: session }), {
      endpoint, token: 'a'.repeat(64), binding: 'd'.repeat(64), expiresAt: Date.now() + 3600_000,
    });
    const base = 'chrome-extension://' + new URL(worker.url()).hostname;
    const page = browser.pages()[0] ?? await browser.newPage();
    await page.goto(base + '/popup.html');
    await expect(page.getByRole('button', { name: 'Connect Google Drive' })).toBeVisible();
    await page.goto(base + '/options.html');
    const picker = page.getByRole('combobox', { name: 'Folder', exact: true });
    await expect(picker).toHaveValue(preferred);
    expect(selected).toEqual([]);
    await picker.selectOption(other);
    await page.getByRole('button', { name: 'Use folder' }).click();
    await expect(page.getByText('Google Sheets connected')).toBeVisible();
    await page.getByRole('button', { name: 'Change folder' }).click();
    await expect(picker).toHaveValue(other);
    await page.getByRole('button', { name: 'Cancel' }).click();
    expect(selected).toEqual([other]);
  } finally {
    await browser.close();
  }
});

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
          return route.fulfill({ json: { status: 'ready', binding } });
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
      const picker = page.getByRole('combobox', { name: 'Folder', exact: true });
      await expect(picker).toHaveValue('new');
      expect(selectedFolders).toEqual([]);
      const pending = await worker.evaluate(async () => (await chrome.storage.local.get('connection')).connection);
      expect(pending).toMatchObject({ expiresAt: expires * 1000 });
      expect(pending).not.toHaveProperty('binding');
      await page.reload();
      await expect(picker).toHaveValue('new');
      expect(selectedFolders).toEqual([]);
      if (!useDefault) await picker.selectOption('other-folder-id');
      await page.getByRole('button', { name: 'Use folder', exact: true }).click();
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
