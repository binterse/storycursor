import { parseProgress, sourceKey, type Observation } from '../core/domain';
import { uuid } from '../core/commands';

const origin = 'https://mangadex.org';
const api = 'https://api.mangadex.org';

export function chapterId(pageUrl: string): string | undefined {
  const source = sourceKey(pageUrl);
  if (!source) return;
  const url = new URL(source);
  if (url.origin !== origin || url.search) return;
  const [, id] = /^\/chapter\/([0-9a-f-]+)(?:\/\d+)?\/?$/.exec(url.pathname) ?? [];
  if (id && uuid.test(id)) return id;
}

export function chapterSource(pageUrl: string) {
  const id = chapterId(pageUrl);
  return id ? origin + '/chapter/' + id : undefined;
}
function object(value: unknown): Record<string, unknown> | undefined {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
}

export function chapterMetadata(input: unknown, expectedId: string): Pick<Observation, 'series' | 'progress'> | undefined {
  const payload = object(input);
  const data = object(payload?.data);
  if (!uuid.test(expectedId) || payload?.result !== 'ok' || data?.type !== 'chapter' || data.id !== expectedId ||
      !Array.isArray(data.relationships)) return;
  const manga = data.relationships.map(object).filter(relation => relation?.type === 'manga');
  const id = manga[0]?.id;
  if (manga.length !== 1 || typeof id !== 'string' || !uuid.test(id)) return;
  const chapter = object(data.attributes)?.chapter;
  const progress = typeof chapter === 'string' && chapter.length <= 32 && parseProgress(chapter).kind === 'ordinal'
    ? chapter : undefined;
  return { series: origin + '/title/' + id.toLowerCase(), progress };
}

function readerTitle(observation: Observation): Observation {
  const parsed = /^(?:\d+\s*\|\s*)?Chapter\s+(\d{1,12}(?:\.\d{1,10})?)\s+[-–|:]\s+(.+?)\s+[-–|]\s+MangaDex$/i.exec(observation.title.trim());
  if (!parsed?.[1] || !parsed[2] || parseProgress(parsed[1]).kind !== 'ordinal') return observation;
  return { ...observation, title: parsed[2], progress: parsed[1] };
}

export async function resolveChapter(observation: Observation, fetcher: typeof fetch = fetch): Promise<Observation> {
  const id = chapterId(observation.url);
  if (!id) return observation;
  // A reader title can identify the displayed chapter but cannot establish a series relationship.
  const fallback = readerTitle(observation);
  try {
    const response = await fetcher(api + '/chapter/' + id, {
      credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer',
      signal: AbortSignal.timeout(4500),
    });
    if (!response.ok) return fallback;
    const metadata = chapterMetadata(await response.json(), id);
    return metadata ? { ...fallback, series: metadata.series, progress: metadata.progress ?? fallback.progress } : fallback;
  } catch {
    return fallback;
  }
}
