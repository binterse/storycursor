import { chromium, expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { inspectPopup } from './chrome-popup';
import { readDebugPage } from '../apps/extension/debug-page';

const endpoint = 'https://script.google.com/macros/s/debug-fixture/exec';
const pageUrl = 'https://mangareader.to/read/moon-index-42/en/chapter-3';
const privateUrl = pageUrl + '?view=full&token=DO_NOT_EXPORT';
const body = `<!doctype html><html lang="en"><head>
  <title>The Moon Index</title>
  <link rel="canonical" href="https://mangareader.to/moon-index-42?private=CANONICAL_SECRET#FRAGMENT_SECRET">
  <meta property="og:title" content="The Moon Index">
  <meta name="twitter:title" content="The Moon Index by alice@example.test">
  <script type="application/ld+json">{"secret":"UNREAD_SCRIPT_CONTENT"}</script>
  <script src="https://cdn.example.test/assets/reader.js?secret=SCRIPT_QUERY_SECRET" defer></script>
  </head><body><main><h1>The Moon Index</h1><p>DO_NOT_EXPORT_FULL_BODY</p>
  <input value="FORM_SECRET" /></main>
  <script>document.cookie = 'session=COOKIE_SECRET';</script></body></html>`;

test('debug page snapshot bounds and removes private browser data', async ({ page }) => {
  await page.route(privateUrl, route => route.fulfill({ contentType:'text/html', body }));
  await page.route('https://cdn.example.test/**', route => route.fulfill({ body:'' }));
  await page.goto(privateUrl);
  const { observedUrl, snapshot } = await page.evaluate(readDebugPage);
  expect(observedUrl).toBe(privateUrl);
  expect(snapshot).toMatchObject({
    title:'The Moon Index', jsonLdCount:1, canonical:{ host:'mangareader.to', route:'/moon-index-42' },
    metadata:[{ name:'og:title', value:'The Moon Index' }, { name:'twitter:title', value:'The Moon Index by [email]' }],
    headings:[{ tag:'h1', text:'The Moon Index' }], scripts:[{ host:'cdn.example.test', route:'/assets/reader.js' }],
  });
  expect(JSON.stringify(snapshot)).not.toMatch(/SECRET|DO_NOT_EXPORT|alice@example/);
});

async function mockPopupList(profile: string, target: string) {
  const [port] = (await readFile(join(profile,'DevToolsActivePort'),'utf8')).split('\n');
  const socket = new WebSocket('ws://127.0.0.1:' + port?.trim() + '/devtools/page/' + target);
  let id = 1;
  await new Promise<void>((resolve, reject) => {
    socket.addEventListener('open', () => socket.send(JSON.stringify({
      id, method:'Fetch.enable', params:{ patterns:[{ urlPattern:endpoint }] },
    })), { once:true });
    socket.addEventListener('error', () => reject(new Error('Cannot mock the popup')), { once:true });
    socket.addEventListener('message', event => {
      const message = JSON.parse(String(event.data));
      if (message.id === 1) {
        if (message.error) reject(new Error('Could not enable popup request interception'));
        else resolve();
      } else if (message.method === 'Fetch.requestPaused') {
        socket.send(JSON.stringify({
          id: ++id, method:'Fetch.fulfillRequest', params:{
            requestId:message.params.requestId, responseCode:200,
            responseHeaders:[{ name:'Content-Type', value:'application/json' }],
            body:Buffer.from(JSON.stringify({ status:'ready', entries:[] })).toString('base64'),
          },
        }));
      }
    });
  });
  return socket;
}

test('toolbar creation keeps debug context local and exposes export only in debug', async ({ browserName }, info) => {
  test.skip(browserName !== 'chromium');
  const release = info.project.name === 'release';
  const path = resolve(release ? 'dist/release/extension' : 'dist/extension');
  const profile = info.outputPath('profile');
  const ctx = await chromium.launchPersistentContext(profile, {
    channel:'chromium', headless:true, acceptDownloads:true,
    args:['--disable-extensions-except=' + path,'--load-extension=' + path,
      '--enable-unsafe-extension-debugging','--remote-debugging-port=0'],
  });
  let interceptor: WebSocket | undefined;
  try {
    const worker = ctx.serviceWorkers()[0] ?? await ctx.waitForEvent('serviceworker');
    const connection = { endpoint, token:'a'.repeat(64), binding:'b'.repeat(64) };
    await worker.evaluate(connection => chrome.storage.local.set({ connection }), connection);
    const submitted: unknown[] = [];
    await ctx.route(endpoint, route => {
      const request = route.request().postDataJSON();
      if (request.action === 'submit') {
        submitted.push(request);
        return route.fulfill({ json:{ status:'saved', operationId:request.command.operationId, target:request.command.target } });
      }
      return route.fulfill({ json:{ status:'ready', entries:[] } });
    });
    await ctx.route(pageUrl, route => route.fulfill({ contentType:'text/html', body }));
    await ctx.route('https://cdn.example.test/**', route => route.fulfill({ body:'' }));
    const page = ctx.pages()[0] ?? await ctx.newPage();
    await page.goto(pageUrl);
    const id = new URL(worker.url()).hostname;
    const client = await ctx.browser()!.newBrowserCDPSession();
    const tabs = await client.send('Target.getTargets', { filter:[{ type:'tab' }] });
    await client.send('Extensions.triggerAction', { id, targetId:tabs.targetInfos.find(target => target.url === pageUrl)!.targetId });
    let popup = '';
    await expect.poll(async () => {
      const { targetInfos } = await client.send('Target.getTargets', { filter:[{}] });
      popup = targetInfos.find(target => target.type === 'page' && target.url === 'chrome-extension://' + id + '/popup.html')?.targetId ?? '';
      return !!popup;
    }).toBe(true);
    const run = <T>(expression: string) => inspectPopup<T>(profile,popup,expression);
    interceptor = await mockPopupList(profile,popup);
    const actionLabel = () => run<string>("document.querySelector('.workspace button.primary')?.innerText");
    await expect.poll(actionLabel).toMatch(/^(?:Try again|Add manga)$/);
    if (await actionLabel() === 'Try again') await run("document.querySelector('.workspace button.primary').click(); true");
    await expect.poll(() => run("document.querySelector('.workspace button.primary')?.innerText")).toBe('Add manga');
    await run("document.querySelector('.workspace button.primary').click(); true");
    await expect.poll(() => submitted.length).toBe(1);
    expect(submitted[0]).toMatchObject({ command:{ type:'CreateManga', initial:{ progress:'3' } } });
    expect(JSON.stringify(submitted[0])).not.toMatch(/DO_NOT_EXPORT|SECRET|snapshot|metadata|headings/);
    await expect.poll(() => run("document.querySelector('[role=status]')?.textContent")).toBe('Confirmed saved');
    const options = await ctx.newPage();
    await options.goto('chrome-extension://' + id + '/options.html');
    if (release) {
      await expect(options.getByText('Debug diagnostics', { exact:true })).toHaveCount(0);
      expect(await options.evaluate(async () => (await indexedDB.databases()).map(db => db.name))).not.toContain('storycursor-local-debug');
    } else {
      await options.getByText('Debug diagnostics', { exact:true }).click();
      const download = options.waitForEvent('download');
      await options.getByRole('button',{ name:'Download diagnostics' }).click();
      const file = await download;
      const exported = await readFile(await file.path(), 'utf8');
      expect(JSON.parse(exported)).toMatchObject({ version:1, captures:[{ confirmed:true, snapshot:{ title:'The Moon Index' } }] });
      expect(exported).not.toMatch(/DO_NOT_EXPORT|SECRET|alice@example/);
    }
  } finally {
    interceptor?.close();
    await ctx.close();
  }
});
