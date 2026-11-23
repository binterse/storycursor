import { chromium, expect, test } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { inspectPopup, popupCommand } from './chrome-popup';

const fixtures = [
  {
    site: 'MangaKatana', url: 'https://mangakatana.com/manga/orbit-library.1042/c157.5', progress: '157.5',
    title: 'The Archivist Who Opened a Library on the Moon and Ended Up Cataloguing Every Forgotten Star in the Known Universe — Chapter 157.5',
  },
  {
    site: 'MangaReader', url: 'https://mangareader.to/read/orbit-library-42/en/chapter-3', progress: '3',
    title: 'Orbit Library',
  },
  {
    site: 'MangaDex', url: 'https://mangadex.org/title/0395641a-d662-4a40-b349-cbb04c683b3a/orbit-library', progress: '',
    title: '月の図書館と星の秘密を巡る長い物語'.repeat(9),
  },
  {
    site: 'MangaDex reader without API metadata',
    url: 'https://mangadex.org/chapter/0395641a-d662-4a40-b349-cbb04c683b3a/8', progress: '3',
    title: '8 | Chapter 3 - Orbit Library - MangaDex', visibleTitle: 'Orbit Library',
  },
  {
    site: 'Unrecognized site', url: 'https://reader.example.test/books/orbit', progress: '',
    title: 'UnbrokenTitle'.repeat(27),
  },
];
const measure = `(() => {
  const title = document.querySelector('.page-title');
  const summary = document.querySelector('.chapter-summary');
  const button = [...document.querySelectorAll('button')].find(button => button.textContent === 'Connect Google Drive');
  if (!title || !summary || !button) return null;
  const rect = title.getBoundingClientRect();
  const action = button.getBoundingClientRect();
  return {
    fullTitle: title.title,
    width: innerWidth,
    progress: (summary.textContent ?? "").replace(/^Chapter /, "").replace(/^unavailable$/, ""),
    lines: rect.height / parseFloat(getComputedStyle(title).lineHeight),
    overflow: document.documentElement.scrollWidth > innerWidth + 1,
    buttonOnScreen: action.height >= 40 && action.bottom <= innerHeight,
  };
})()`;
type Layout = { fullTitle: string; progress: string; lines: number; width: number; overflow: boolean; buttonOnScreen: boolean };

for (const fixture of fixtures) {
  test(fixture.site + ' keeps the title and action within the popup', async ({ browserName }, info) => {
    test.skip(browserName !== 'chromium');
    const extensionPath = resolve(info.project.name === 'release' ? 'dist/release/extension' : 'dist/extension');
    const profile = info.outputPath('profile');
    const context = await chromium.launchPersistentContext(profile, {
      channel: 'chromium', headless: true,
      args: ['--disable-extensions-except=' + extensionPath, '--load-extension=' + extensionPath,
        '--enable-unsafe-extension-debugging', '--remote-debugging-port=0'],
    });
    try {
      const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
      const id = new URL(worker.url()).hostname;
      await context.route('https://api.mangadex.org/chapter/**', route => route.fulfill({ status:403 }));
      await context.route(fixture.url, route => route.fulfill({
        contentType: 'text/html; charset=utf-8', body: '<title>' + fixture.title + '</title>',
      }));
      const page = context.pages()[0] ?? await context.newPage();
      await page.goto(fixture.url);
      const cdp = await context.browser()!.newBrowserCDPSession();
      const { targetInfos } = await cdp.send('Target.getTargets', { filter: [{ type: 'tab' }] });
      await cdp.send('Extensions.triggerAction', { id, targetId: targetInfos.find(target => target.url === fixture.url)!.targetId });
      const popupUrl = 'chrome-extension://' + id + '/popup.html';
      let targetId: string | undefined;
      await expect.poll(async () => {
        targetId = (await cdp.send('Target.getTargets', { filter: [{}] })).targetInfos
          .find(target => target.type === 'page' && target.url === popupUrl)?.targetId;
        return !!targetId;
      }).toBe(true);
      let result: Layout | null = null;
      await expect.poll(async () => {
        result = await inspectPopup<Layout | null>(profile, targetId!, measure);
        return result?.buttonOnScreen && result.width >= 320;
      }).toBe(true);
      expect(result).toMatchObject({ fullTitle: fixture.visibleTitle ?? fixture.title, progress: fixture.progress, overflow: false });
      expect(result!.lines).toBeLessThanOrEqual(2.01);
      const screenshot = await popupCommand<{ data: string }>(profile, targetId!, 'Page.captureScreenshot', { format: 'png' });
      await writeFile(info.outputPath('popup.png'), Buffer.from(screenshot.data, 'base64'));
    } finally {
      await context.close();
    }
  });
}
