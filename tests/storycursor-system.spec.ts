import { chromium, expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { extensionPath, inspectPopup, popupCommand } from './chrome-popup';
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
  holdNextSave: () => { started: Promise<void>; resume: () => void };
  confirmedSaves: () => Promise<number>;
  page: (url: string, title: string) => Promise<void>;
  popup: (url: string, chapter: string) => Promise<{
    run: <T>(expression: string) => Promise<T>;
    label: () => Promise<string>;
    click: () => Promise<unknown>;
    close: () => Promise<void>;
    screenshot: (file: string) => Promise<void>;
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
    let pausedSave: { arrive: () => void; wait: Promise<void> } | undefined;
    function holdNextSave() {
      let arrive = () => {};
      let resume = () => {};
      const started = new Promise<void>(resolve => { arrive = resolve; });
      const wait = new Promise<void>(resolve => { resume = resolve; });
      pausedSave = { arrive, wait };
      return { started, resume };
    }
    const confirmedSaves = () => worker.evaluate(async () => {
      const items = await chrome.storage.local.get(null) as Record<string, { state?: string }>;
      return Object.entries(items).filter(([key, item]) => key.startsWith('queue:') && item.state === 'Confirmed saved').length;
    });
    await ctx.route(endpoint, async route => {
      const request = route.request().postDataJSON();
      if (request.token !== token) return route.fulfill({ status:403 });
      if (request.action === 'submit') {
        const paused = pausedSave;
        pausedSave = undefined;
        paused?.arrive();
        await paused?.wait;
        return route.fulfill({ json:apply(book,request.command) });
      }
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
      await expect.poll(label,{ timeout:9000 }).toMatch(/^(?:Add manga|Update .+|Remember this series|Chapter saved|Try again)$/);
      if (await label() === 'Try again') await click();
      await expect.poll(() => run("document.querySelector('.chapter-summary')?.textContent")).toBe('Chapter ' + chapter);
      async function screenshot(file: string) {
        const shot = await popupCommand<{ data: string }>(profile,target,'Page.captureScreenshot',{ format:'png' });
        await writeFile(info.outputPath(file),Buffer.from(shot.data,'base64'));
      }
      return { run, label, click, screenshot, close: () => closePopup(target) };
    }
    await use({ book, page, popup, holdNextSave, confirmedSaves });
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
  await expect.poll(third.label).toBe('Update to chapter 4');
  await expect.poll(() => third.run('document.body.innerText')).toContain('Suggested: ' + title);
  await third.run("window.confirm = message => { document.body.dataset.confirmation = message; return false; }; true");
  await third.click();
  await expect.poll(() => third.run('document.body.dataset.confirmation')).toBe('Update ' + title + ' to 4?');
  expect(reader.book.data).toHaveLength(1);
  expect(fields(reader.book.data[0]!).progress).toBe('3');
});

const chapterWorkflows = [
  { site:'MangaKatana', series:'https://mangakatana.com/manga/orbit-library.1042', chapters:[
    { path:'/c234', chapter:'234', heading:'Chapter 234 - Orbit Library' },
    { path:'/c235', chapter:'235', heading:'Chapter 235 - Orbit Library' },
  ] },
  { site:'MangaRead', series:'https://www.mangaread.org/manga/orbit-library/', chapters:[
    { path:'chapter-67/', chapter:'67', heading:'Read Manga Orbit Library - Chapter 67' },
    { path:'chapter-67-5/', chapter:'67.5', heading:'Read Manga Orbit Library - Chapter 67.5' },
  ] },
  { site:'ManhuaPlus', series:'https://manhuaplus.org/manga/orbit-library', chapters:[
    { path:'/chapter-1', chapter:'1', heading:'Read Orbit Library Chapter 1 [Read new chapter at ManhuaPlus]' },
    { path:'/chapter-2', chapter:'2', heading:'Read Orbit Library Chapter 2 [Read new chapter at ManhuaPlus]' },
  ] },
  { site:'ManhuaTop', series:'https://manhuatop.org/manhua/orbit-library/', chapters:[
    { path:'chapter-0/', chapter:'0', heading:'Orbit Library — Chapter 0 | Manhua Top' },
    { path:'chapter-1/', chapter:'1', heading:'Orbit Library — Chapter 1 | Manhua Top' },
  ] },
  { site:'FanFox', series:'https://m.fanfox.net/manga/orbit_library/', chapters:[
    { url:'https://m.fanfox.net/roll_manga/orbit_library/c001/1.html', chapter:'1', heading:'Orbit Library' },
    { url:'https://m.fanfox.net/roll_manga/orbit_library/c002/', chapter:'2', heading:'Orbit Library' },
  ] },
  { site:'MGeko', series:'https://www.mgeko.cc/manga/orbit-library/', chapters:[
    { url:'https://www.mgeko.cc/reader/en/orbit-library-chapter-169-eng-li/', chapter:'169', heading:'Manga: Orbit Library Chapter - 169-eng-li' },
    { url:'https://www.mgeko.cc/reader/en/orbit-library-chapter-170-eng-li/', chapter:'170', heading:'Manga: Orbit Library Chapter - 170-eng-li' },
  ] },
];

for (const { site, series, chapters } of chapterWorkflows) {
  system(site + ' adds a correctly titled manga and saves the next chapter in one click', async ({ reader }) => {
    for (const [index, page] of chapters.entries()) {
      const { chapter, heading } = page;
      const address = 'url' in page ? page.url : series + page.path;
      await reader.page(address, heading);
      const popup = await reader.popup(address, chapter);
      await expect.poll(popup.label).toBe(index === 0 ? 'Add manga' : 'Update to chapter ' + chapter);
      await popup.click();
      await expect.poll(() => popup.run("document.querySelector('[role=status]')?.textContent")).toBe('Confirmed saved');
      expect(reader.book.data.map(fields)).toEqual([{ title:'Orbit Library', progress:chapter, primary:series, secondary:'' }]);
      expect(reader.book.log.size).toBe(index + 1);
      await popup.close();
    }
  });
}

system('a newly detected source can update an existing manga from the main popup and is remembered', async ({ reader }) => {
  const name = 'Moonlit Index';
  const primary = 'https://mangakatana.com/manga/moonlit-index.25775';
  const source = 'https://mangareader.to/read/moonlit-index-42/en/chapter-';
  await reader.page(primary + '/c3', 'Chapter 3 - ' + name);
  await reader.page(source + '4', name);
  await reader.page(source + '5', name);
  const first = await reader.popup(primary + '/c3', '3');
  await first.click();
  await expect.poll(() => first.run("document.querySelector('[role=status]')?.textContent")).toBe('Confirmed saved');
  await first.close();

  const second = await reader.popup(source + '4', '4');
  await expect.poll(second.label).toBe('Update to chapter 4');
  await expect.poll(() => second.run('document.body.innerText')).toContain('Suggested: ' + name);
  await second.screenshot('suggested-update.png');
  await second.run("window.confirm = message => { document.body.dataset.confirmation = message; return false; }; true");
  await second.click();
  await expect.poll(() => second.run('document.body.dataset.confirmation')).toContain('Update ' + name);
  expect(reader.book.data.map(fields)).toEqual([{ title:name, progress:'3', primary, secondary:'' }]);
  await second.close();
  const retry = await reader.popup(source + '4', '4');
  await expect.poll(() => retry.run('document.body.innerText')).toContain('Suggested: ' + name);
  await retry.run("window.confirm = message => { document.body.dataset.confirmation = message; return true; }; true");
  const save = reader.holdNextSave();
  try {
    await retry.click();
    await save.started;
    expect(await retry.run('document.body.dataset.confirmation')).toContain('remember this series');
    await retry.close();
  } finally {
    save.resume();
  }
  await expect.poll(reader.confirmedSaves).toBe(2);
  expect(reader.book.data.map(fields)).toEqual([{ title:name, progress:'4', primary, secondary:'' }]);

  const next = await reader.popup(source + '5', '5');
  await expect.poll(next.label).toBe('Update to chapter 5');
  await next.screenshot('verified-update.png');
  await next.click();
  await expect.poll(() => next.run("document.querySelector('[role=status]')?.textContent")).toBe('Confirmed saved');
  expect(reader.book.data.map(fields)).toEqual([{ title:name, progress:'5', primary, secondary:'' }]);
});

system('matching titles require a manga selection before updating either record', async ({ reader }) => {
  const name = 'The Two Moons';
  const url = 'https://mangareader.to/read/two-moons-42/en/chapter-4';
  for (const progress of ['1', '3']) {
    expect(apply(reader.book, {
      type:'CreateManga', operationId:randomUUID(), target:randomUUID(), expected:'absent', value:name, confirmed:true,
      initial:{ source:'https://reader.example/edition-' + progress, progress },
    })).toHaveProperty('status', 'saved');
  }
  await reader.page(url, name);
  const popup = await reader.popup(url, '4');
  await expect.poll(popup.label).toBe('Update existing');
  await popup.click();
  await expect.poll(() => popup.run("document.querySelector('.quick-picker select')?.checkVisibility()")).toBe(true);
  expect(await popup.run("document.querySelector('.quick-picker select').value")).toBe('');
  expect(await popup.run("document.querySelector('.workspace button.primary').checkVisibility()")).toBe(false);
  await popup.run(`(() => {
    const select = document.querySelector('.quick-picker select');
    select.value = [...select.options].find(option => option.text.includes('edition-3')).value;
    select.dispatchEvent(new Event('change'));
    window.confirm = () => true;
    return true;
  })()`);
  await expect.poll(popup.label).toBe('Update to chapter 4');
  await popup.click();
  await expect.poll(() => popup.run("document.querySelector('[role=status]')?.textContent")).toBe('Confirmed saved');
  expect(reader.book.data.map(row => fields(row).progress)).toEqual(['1', '4']);
});
