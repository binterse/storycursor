import { chromium, expect, test } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { extensionPath, inspectPopup, popupCommand } from './chrome-popup';

const readers = [
  {
    name:'MangaKatana',
    title:'Return of the Frozen Player',
    chapters:[
      { number:'234', url:'https://mangakatana.com/manga/return-of-the-frozen-player.25775/c234' },
      { number:'235', url:'https://mangakatana.com/manga/return-of-the-frozen-player.25775/c235' },
    ],
  },
  {
    name:'MangaReader',
    title:'Vagabond',
    chapters:[{ number:'1', url:'https://mangareader.to/read/vagabond-4/en/chapter-1' }],
  },
];

for (const reader of readers) {
  test(reader.name + ' exposes the real series title and chapter in the installed toolbar popup', async ({ browserName }, info) => {
    test.skip(browserName !== 'chromium');
    const path = extensionPath(info.project.name);
    const profile = info.outputPath('profile');
    const ctx = await chromium.launchPersistentContext(profile,{
      channel:'chromium', headless:true,
      args:['--disable-extensions-except=' + path,'--load-extension=' + path,
        '--enable-unsafe-extension-debugging','--remote-debugging-port=0'],
    });
    let target: string | undefined;
    try {
      await ctx.route('**/*', route => {
        if (['image','font','media'].includes(route.request().resourceType())) return route.abort();
        return route.continue();
      });
      const worker = ctx.serviceWorkers()[0] ?? await ctx.waitForEvent('serviceworker');
      const id = new URL(worker.url()).hostname;
      const popupUrl = 'chrome-extension://' + id + '/popup.html';
      const page = ctx.pages()[0] ?? await ctx.newPage();
      const cdp = await ctx.browser()!.newBrowserCDPSession();
      for (const chapter of reader.chapters) {
        if (target) {
          await cdp.send('Target.closeTarget',{ targetId:target });
          await expect.poll(async () => (await cdp.send('Target.getTargets', { filter:[{}] })).targetInfos
            .some(candidate => candidate.targetId === target)).toBe(false);
        }
        const response = await page.goto(chapter.url,{ waitUntil:'load', timeout:18000 });
        expect(response?.status(), reader.name + ' must serve a reader page over HTTP').toBe(200);
        await page.bringToFront();
        const upstreamTitle = await page.title();
        expect(upstreamTitle, reader.name + ' must show its reader rather than a blocked page').toContain(reader.title);
        expect(new URL(page.url()).hostname).toBe(new URL(chapter.url).hostname);
        const tabs = await cdp.send('Target.getTargets',{ filter:[{ type:'tab' }] });
        const tab = tabs.targetInfos.find(candidate => candidate.url === page.url());
        expect(tab).toBeDefined();
        await cdp.send('Extensions.triggerAction',{ id,targetId:tab!.targetId });
        await expect.poll(async () => {
          target = (await cdp.send('Target.getTargets',{ filter:[{}] })).targetInfos
            .find(candidate => candidate.type === 'page' && candidate.url === popupUrl)?.targetId;
          return !!target;
        }).toBe(true);
        const visible = () => inspectPopup<{ title: string; chapter: string }>(profile,target!,
          "({title:document.querySelector('.page-title')?.textContent,chapter:document.querySelector('.chapter-summary')?.textContent})");
        await expect.poll(visible, { message: 'Reader URL: ' + page.url() + ', title: ' + upstreamTitle }).toEqual({ title:reader.title, chapter:'Chapter ' + chapter.number });
        const screenshot = await popupCommand<{ data: string }>(profile,target!,'Page.captureScreenshot',{ format:'png' });
        await writeFile(info.outputPath('chapter-' + chapter.number + '.png'),Buffer.from(screenshot.data,'base64'));
      }
    } finally {
      await ctx.close();
    }
  });
}

test('the public MangaDex chapter API still reports the expected manga and chapter', async ({ request }) => {
  const id = '0aaf8b27-0013-4ae0-8935-91a089466874';
  const response = await request.get('https://api.mangadex.org/chapter/' + id,{ timeout:8000, maxRedirects:0 });
  expect(response.status(),'MangaDex chapter metadata must be accessible').toBe(200);
  expect(await response.json()).toMatchObject({
    result:'ok',
    data:{ id, type:'chapter', attributes:{ chapter:'1' },
      relationships:expect.arrayContaining([{ type:'manga', id:'127820bd-8fc5-47b8-8782-e680317bf41d' }]) },
  });
});
