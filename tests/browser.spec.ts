import { popupSnapshot } from './chrome-popup';
import { chromium, expect, test } from '@playwright/test';
import { resolve } from 'node:path';
import { fixture, series, hash, MockBook } from './fixtures';
import { apply } from '../packages/sheets-adapter/engine';
import { describe } from '../packages/sheets-adapter/schema';

test('MV3 action detects the active tab and retries an uncertain save with the same ID', async ({ browserName }, info) => {
  test.skip(browserName !== 'chromium');
  const extensionPath = resolve('dist/extension');
  const profile = info.outputPath('profile');
  const context = await chromium.launchPersistentContext(profile, {
    channel: 'chromium', headless: true,
    args: ['--disable-extensions-except=' + extensionPath, '--load-extension=' + extensionPath, '--enable-unsafe-extension-debugging', '--remote-debugging-port=0'],
  });
  try {
    const [existing] = context.serviceWorkers();
    const worker = existing ?? await context.waitForEvent('serviceworker');
    const id = new URL(worker.url()).hostname;
    const page = context.pages()[0] ?? await context.newPage();
    const book = new MockBook();
    const { row } = fixture();
    book.data.push(row);
    const token = 'a'.repeat(64);
    const endpoint = 'https://script.google.com/macros/s/fixture/exec';
    const requests: string[] = [];
    let networkLost = true;
    await context.route(series + '/c157.5', route => route.fulfill({
      contentType: 'text/html; charset=utf-8', body: '<title>Orbit Library – Synthetic Reader</title>',
    }));
    await context.route(endpoint, async route => {
      const body = JSON.parse(route.request().postData()!);
      if (body.token !== token) return route.fulfill({ json: { status:'failed', message:'Unauthorized.' } });
      if (body.action === 'list') return route.fulfill({ json: { status:'ready', entries:book.rows().map(record => describe(record, hash)) } });
      if (body.action !== 'submit') return route.fulfill({ json: { status:'ready', binding:hash('synthetic') } });
      requests.push(body.command.operationId);
      const result = apply(book, body.command);
      if (networkLost) {
        networkLost = false;
        return route.abort('internetdisconnected');
      }
      return route.fulfill({ json: result });
    });
    await page.goto(series + '/c157.5');
    const cdp = await context.browser()!.newBrowserCDPSession();
    const { targetInfos } = await cdp.send('Target.getTargets', { filter: [{ type: 'tab' }] });
    const popupUrl = 'chrome-extension://' + id + '/popup.html';
    await cdp.send('Extensions.triggerAction', { id, targetId: targetInfos.find(target => target.url === page.url())!.targetId });
    await expect.poll(async () => (await cdp.send('Target.getTargets', { filter: [{}] })).targetInfos.some(target => target.url === popupUrl)).toBe(true);
    const toolbarTargets = await cdp.send('Target.getTargets', { filter: [{}] });
    const toolbarPopup = toolbarTargets.targetInfos.find(target => target.type === 'page' && target.url === popupUrl);
    await expect.poll(() => popupSnapshot(profile, toolbarPopup!.targetId)).toEqual({
      title: 'Orbit Library – Synthetic Reader', progress: '157.5',
    });
    const popup = await context.newPage();
    await popup.goto(popupUrl);
    await expect(popup.getByText('Open a reading tab to detect progress.')).toBeVisible();

    await expect(popup.getByRole('button', { name:'Save progress' })).toBeDisabled();
    await expect(popup.getByText('Connect Google Sheets to save this chapter.')).toBeVisible();
    await popup.getByRole('button', { name:'Set up Google Sheets' }).click();
    await popup.getByLabel('Apps Script deployment URL').fill(endpoint);
    await popup.getByLabel('Service token').fill('b'.repeat(64));
    await popup.getByRole('button', { name:'Connect' }).click();
    await expect(popup.getByRole('status')).toHaveText('Unauthorized.');
    await popup.getByLabel('Service token').fill(token);
    await popup.getByRole('button', { name:'Connect' }).click();
    await popup.getByLabel('Workbook record').selectOption('0');
    await expect(popup.getByRole('button', { name:'Save progress' })).toBeDisabled();
    await popup.getByLabel('Chapter or progress').fill('157.5');
    await expect(popup.getByRole('button', { name:'Save progress' })).toBeEnabled();
    popup.once('dialog', dialog => dialog.accept());
    await popup.getByRole('button', { name:'Save progress' }).click();
    await expect(popup.getByRole('status')).toContainText('Result unconfirmed');
    await popup.getByText('Operation queue').click();
    await popup.getByRole('button', { name:'Retry' }).click();
    await expect(popup.getByRole('status')).toHaveText('Confirmed saved');
    expect(requests).toHaveLength(2);
    expect(new Set(requests).size).toBe(1);
    expect(book.log.size).toBe(1);
    await popup.reload();
    await popup.getByText('Operation queue').click();
    await expect(popup.getByText('SetProgress · Confirmed saved')).toBeVisible();
  } finally {
    await context.close();
  }
});
