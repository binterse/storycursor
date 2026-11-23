import { expect, it, vi } from 'vitest';
import { chapterId, chapterMetadata, resolveChapter } from '../packages/site-adapters/mangadex';

const chapter = '0395641a-d662-4a40-b349-cbb04c683b3a';
const manga = '87ecbbcb-834b-47b7-9bf5-3160abff6075';
const url = 'https://mangadex.org/chapter/' + chapter;
const observation = { url, title: 'Orbit Library' };
const series = 'https://mangadex.org/title/' + manga;
const payload = {
  result: 'ok',
  data: { type: 'chapter', id: chapter, attributes: { chapter: '156.5' },
    relationships: [{ type: 'manga', id: manga }] },
};

it('uses one trusted chapter relationship and preserves its decimal label', async () => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(payload)));
  expect(chapterId(url + '/2')).toBe(chapter);
  expect(chapterMetadata(payload, chapter)).toEqual({ series, progress: '156.5' });
  expect(await resolveChapter(observation, fetcher)).toEqual({ ...observation, series, progress: '156.5' });
  expect(fetcher).toHaveBeenCalledExactlyOnceWith('https://api.mangadex.org/chapter/' + chapter,
    expect.objectContaining({ credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer' }));
});

it('rejects wrong chapter IDs, absent or ambiguous series and malformed data', () => {
  expect(chapterMetadata(payload, manga)).toBeUndefined();
  expect(chapterMetadata(null, chapter)).toBeUndefined();
  for (const relationships of [[], [null], [...payload.data.relationships, ...payload.data.relationships]]) {
    expect(chapterMetadata({ ...payload, data: { ...payload.data, relationships } }, chapter)).toBeUndefined();
  }
  expect(chapterMetadata({ ...payload, data: { ...payload.data, attributes: { chapter: 'bonus' } } }, chapter))
    .toEqual({ series, progress: undefined });
});

it('falls back without inventing progress after network failure or for unsupported URLs', async () => {
  const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new Error('Offline'));
  const hostile = { url: 'https://mangadex.org.example/chapter/' + chapter, title: 'Chapter 1' };
  expect(await resolveChapter(hostile, fetcher)).toBe(hostile);
  expect(fetcher).not.toHaveBeenCalled();
  expect(chapterId(url + '?series=another')).toBeUndefined();
  expect(await resolveChapter(observation, fetcher)).toBe(observation);
});

it('reads a MangaDex reader title when the chapter API is blocked', async () => {
  const page = { url: url + '/8', title: '8 | Chapter 3 - Boku wa Ohime-sama ni Narenai - MangaDex' };
  const blocked = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 403 }));
  expect(await resolveChapter(page, blocked)).toEqual({ ...page, title:'Boku wa Ohime-sama ni Narenai', progress:'3' });
  const offline = vi.fn<typeof fetch>().mockRejectedValue(new Error('Offline'));
  const decimal = { ...page, title: 'Chapter 156.5 - Orbit Library | MangaDex' };
  expect(await resolveChapter(decimal, offline)).toEqual({ ...decimal, title:'Orbit Library', progress:'156.5' });
  expect(await resolveChapter({ ...page, url:'https://mangadex.org/title/' + manga }, blocked))
    .not.toHaveProperty('progress');
});

it('prefers verified metadata and rejects title lookalikes', async () => {
  const title = 'Page 8 | Chapter 999 - Orbit Library - MangaDex';
  const success = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(payload)));
  expect(await resolveChapter({url,title}, success)).toMatchObject({ series, progress:'156.5' });
  const withoutNumber = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
    ...payload, data:{ ...payload.data, attributes:{ chapter:null } },
  })));
  expect(await resolveChapter({ url, title:'8 | Chapter 3 - Orbit Library - MangaDex' }, withoutNumber))
    .toMatchObject({ series, progress:'3' });
  const offline = vi.fn<typeof fetch>().mockRejectedValue(new Error('Offline'));
  for (const badTitle of ['Chapter 3 - Orbit Library', 'Bonus Chapter 3 - Orbit Library - MangaDex', 'Orbit Library - MangaDex']) {
    expect(await resolveChapter({url,title:badTitle}, offline)).not.toHaveProperty('progress');
  }
});
