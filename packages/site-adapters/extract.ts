import { sourceKey, type Observation } from '../core/domain';

type Extractor = (url: URL) => Pick<Observation, 'series' | 'progress'> | undefined;

const mangaDex: Extractor = url => {
  if (url.origin !== 'https://mangadex.org') return;
  const match = /^\/title\/([0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12})(?:\/[a-z0-9-]+)?\/?$/.exec(url.pathname);
  return match ? { series: url.origin + '/title/' + match[1] } : {};
};
const mangaKatana: Extractor = url => {
  if (url.origin !== 'https://mangakatana.com') return;
  const match = /^\/manga\/([a-z0-9]+(?:-[a-z0-9]+)*\.\d+)(?:\/c(\d+(?:\.\d+)?))?\/?$/.exec(url.pathname);
  return match ? { series: url.origin + '/manga/' + match[1], progress: match[2] } : {};
};
const mangaReader: Extractor = url => {
  if (url.origin !== 'https://mangareader.to') return;
  const reading = /^\/read\/([a-z0-9]+(?:-[a-z0-9]+)*-\d+)\/en\/chapter-(\d+(?:\.\d+)?)\/?$/.exec(url.pathname);
  if (reading) return { series: url.origin + '/' + reading[1], progress: reading[2] };
  const series = /^\/([a-z0-9]+(?:-[a-z0-9]+)*-\d+)\/?$/.exec(url.pathname);
  return series ? { series: url.origin + '/' + series[1] } : {};
};

export function extract(page: { url: string; title: string }): Observation {
  const base = { url: page.url.length <= 2000 ? page.url : '', title: page.title.slice(0, 400).trim() };
  const normalized = sourceKey(base.url);
  if (!normalized) return base;
  const url = new URL(normalized);
  if (url.search) return base;
  for (const adapter of [mangaDex, mangaKatana, mangaReader]) {
    const detected = adapter(url);
    if (detected) return { ...base, ...detected };
  }
  return base;
}

export const canonicalSeries = (url: string) => extract({ url, title: '' }).series;
