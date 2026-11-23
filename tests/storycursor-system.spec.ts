import { chromium, expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { extensionPath, inspectPopup } from './chrome-popup';
import { apply } from '../packages/sheets-adapter/engine';
import { describe, fields } from '../packages/sheets-adapter/schema';
import { hash, MockBook } from './fixtures';

const endpoint = 'https://script.google.com/macros/s/storycursor-system-fixture/exec';
const mdApi = 'https://api.mangadex.org/chapter/';
const mdChapter = 'https://mangadex.org/chapter/22222222-2222-4222-8222-222222222222';
const unrelatedChapter = 'https://mangadex.org/chapter/11111111-1111-4111-8111-111111111111/1';
const title = 'The Observatory at the End of the Valley';

async function interceptPopup(profile: string, target: string, book: MockBook) {
  const [port] = (await readFile(join(profile,'DevToolsActivePort'),'utf8')).split('\n');
  const socket = new WebSocket('ws://127.0.0.1:' + port?.trim() + '/devtools/page/' + target);
  let id = 1;
  await new Promise<void>((resolve, reject) => {
    socket.addEventListener('open', () => socket.send(JSON.stringify({
      id, method:'Fetch.enable', params:{ patterns:[{ urlPattern:endpoint }, { urlPattern:mdApi + '*' }] },
    })), { once:true });
    socket.addEventListener('error', () => reject(new Error('Cannot intercept popup test requests')), { once:true });
    socket.addEventListener('message', event => {
      const message = JSON.parse(String(event.data));
      if (message.id === 1) {
        if (message.error) reject(new Error('Cannot enable popup request interception'));
        else resolve();
      } else if (message.method === 'Fetch.requestPaused') {
        const isMangaDex = message.params.request.url.startsWith(mdApi);
        socket.send(JSON.stringify({
          id: ++id, method:'Fetch.fulfillRequest', params:{
            requestId:message.params.requestId, responseCode:isMangaDex ? 403 : 200,
            responseHeaders:[{ name:'Content-Type', value:'application/json' }],
            body:Buffer.from(JSON.stringify(isMangaDex ? {} : {
              status:'ready', entries:book.rows().map(row => describe(row, hash)),
            })).toString('base64'),
          },
        }));
      }
    });
  });
  return socket;
}

const system = test.extend<{ reader: {
  book: MockBook;
  page: (url: string, title: string) => Promise<void>;
  popup: (url: string, chapter: string) => Promise<{
    run: <T>(expression: string) => Promise<T>;
    label: () => Promise<string>;
    click: () => Promise<unknown>;
    close: () => Promise<void>;
  }>;
} }>({ reader:async ({ browserName }, use, info) => {
  test.skip(browserName !== 'chromium');
  const path = extensionPath(info.project.name);
  const profile = info.outputPath('profile');
  const ctx = await chromium.launchPersistentContext(profile, {
    channel:'chromium', headless:true,
    args:['--disable-extensions-except=' + path,'--load-extension=' + path,
      '--enable-unsafe-extension-debugging','--remote-debugging-port=0'],
  });
  let interceptor: WebSocket | undefined;
  try {
    const book = new MockBook();
    const token = 'a'.repeat(64);
    const worker = ctx.serviceWorkers()[0] ?? await ctx.waitForEvent('serviceworker');
    const id = new URL(worker.url()).hostname;
    await worker.evaluate(connection => chrome.storage.local.set({ connection }), { endpoint, token, binding:hash('system-fixture') });
    await ctx.route(endpoint, route => {
      const request = route.request().postDataJSON();
      if (request.token !== token) return route.fulfill({ status:403 });
      if (request.action === 'submit') return route.fulfill({ json:apply(book,request.command) });
      return route.fulfill({ json:{ status:'ready', entries:book.rows().map(row => describe(row,hash)) } });
    });
    await ctx.route(mdApi + '**', route => route.fulfill({ status:403 }));
    async function page(url: string, title: string) {
      await ctx.route(url, route => route.fulfill({
        contentType:'text/html; charset=utf-8',
        body:'<title>' + title + '</title>',
      }));
    }
    const reading = ctx.pages()[0] ?? await ctx.newPage();
    const browser = await ctx.browser()!.newBrowserCDPSession();
    async function closePopup(targetId: string) {
      await browser.send('Target.closeTarget', { targetId });
      await expect.poll(async () => (await browser.send('Target.getTargets', { filter:[{}] })).targetInfos
        .some(target => target.targetId === targetId)).toBe(false);
    }
    async function popup(url: string, chapter: string) {
      await reading.goto(url);
      await reading.bringToFront();
      const tabs = await browser.send('Target.getTargets', { filter:[{ type:'tab' }] });
      await browser.send('Extensions.triggerAction', { id, targetId:tabs.targetInfos.find(tab => tab.url === url)!.targetId });
      let target = '';
      await expect.poll(async () => {
        const { targetInfos } = await browser.send('Target.getTargets', { filter:[{}] });
        target = targetInfos.find(tab => tab.type === 'page' && tab.url === 'chrome-extension://' + id + '/popup.html')?.targetId ?? '';
        return !!target;
      }).toBe(true);
      interceptor?.close();
      interceptor = await interceptPopup(profile,target,book);
      const run = <T>(expr: string) => inspectPopup<T>(profile,target,expr);
      const label = () => run<string>("document.querySelector('.workspace button.primary')?.innerText");
      const click = () => run("document.querySelector('.workspace button.primary').click(); true");
      await expect.poll(label,{ timeout:9000 }).toMatch(/^(?:Add manga|Save progress|Chapter saved|Try again)$/);
      if (await label() === 'Try again') await click();
      await expect.poll(() => run("document.querySelector('.chapter-summary')?.textContent")).toBe('Chapter ' + chapter);
      return { run, label, click, close: () => closePopup(target) };
    }
    await use({ book, page, popup });
  } finally {
    interceptor?.close();
    await ctx.close();
  }
} });

system('MangaDex keeps an exact chapter link through an API outage and requires evidence for a different chapter', async ({ reader }) => {
  for (const pageNumber of [8,9]) {
    await reader.page(mdChapter + '/' + pageNumber, pageNumber + ' | Chapter 3 - ' + title + ' - MangaDex');
  }
  await reader.page(unrelatedChapter, '1 | Chapter 4 - ' + title + ' - MangaDex');
  const first = await reader.popup(mdChapter + '/8', '3');
  await expect.poll(first.label).toBe('Add manga');
  await first.click();
  await expect.poll(() => first.run("document.querySelector('[role=status]')?.textContent")).toBe('Confirmed saved');
  expect(reader.book.data.map(fields)).toEqual([expect.objectContaining({ title, progress:'3', primary:mdChapter })]);
  await first.close();
  const second = await reader.popup(mdChapter + '/9', '3');
  await expect.poll(second.label).toBe('Chapter saved');
  await second.close();
  const third = await reader.popup(unrelatedChapter, '4');
  await expect.poll(third.label).toBe('Add manga');
  await expect.poll(() => third.run('document.body.innerText')).toContain('Possible match under Record actions.');
  expect(reader.book.data).toHaveLength(1);
});

system('MangaKatana adds a correctly titled manga and saves the next chapter in one click', async ({ reader }) => {
  const title = 'Return of the Frozen Player';
  const series = 'https://mangakatana.com/manga/return-of-the-frozen-player.25775';
  await reader.page(series + '/c234', 'Chapter 234 - ' + title);
  await reader.page(series + '/c235', 'Chapter 235 - ' + title);
  const first = await reader.popup(series + '/c234', '234');
  await expect.poll(first.label).toBe('Add manga');
  await first.click();
  await expect.poll(() => first.run("document.querySelector('[role=status]')?.textContent")).toBe('Confirmed saved');
  expect(reader.book.data.map(fields)).toEqual([expect.objectContaining({ title, progress:'234', primary:series })]);
  await first.close();
  const second = await reader.popup(series + '/c235', '235');
  await expect.poll(second.label).toBe('Save progress');
  await second.click();
  await expect.poll(() => second.run("document.querySelector('[role=status]')?.textContent")).toBe('Confirmed saved');
  expect(reader.book.data.map(fields)).toEqual([expect.objectContaining({ title, progress:'235', primary:series })]);
});
