import type { Observation } from '../core/domain';

export type Extractor = (url: { origin: string; pathname: string }, title: string) => Partial<Pick<Observation, 'series' | 'progress' | 'title'>> | undefined;

const hierarchical = new Map([
  ['https://www.mangaread.org', {
    section: 'manga', suffix: '/', hyphenDecimal: true,
    seriesTitle: /^Read (.+) - manga Online in English$/i,
    chapterTitle: /^Read Manga (.+) - Chapter (\d+(?:\.\d+)?)$/i,
  }],
  ['https://manhuaplus.org', {
    section: 'manga', suffix: '', hyphenDecimal: false,
    seriesTitle: /^Read (.+) Fastest and highest quality updates$/i,
    chapterTitle: /^Read (.+) Chapter (\d+(?:\.\d+)?) \[Read new chapter at ManhuaPlus\]$/i,
  }],
  ['https://manhuatop.org', {
    section: 'manhua', suffix: '/', hyphenDecimal: false,
    seriesTitle: /^(.+) - Manhua Top$/i,
    chapterTitle: /^(.+) — Chapter (\d+(?:\.\d+)?) \| Manhua Top$/i,
  }],
]);

const cleanChapterTitle = (title: string, progress: string | undefined, pattern: RegExp) => {
  const [, name, chapter] = pattern.exec(title) ?? [];
  return progress && chapter === progress ? name : undefined;
};

const hierarchicalReader: Extractor = ({ origin, pathname }, title) => {
  const layout = hierarchical.get(origin);
  if (!layout) return;
  const [, section, slug, chapter] = /^\/(manga|manhua)\/([a-z0-9]+(?:-[a-z0-9]+)*)(?:\/chapter-(\d{1,12}(?:[.-]\d{1,10})?))?\/?$/.exec(pathname) ?? [];
  if (section !== layout.section || !slug || (chapter?.includes('-') && !layout.hyphenDecimal)) return {};
  const series = origin + '/' + section + '/' + slug + layout.suffix;
  if (!chapter) return { series, title: layout.seriesTitle.exec(title)?.[1] ?? title };
  const progress = chapter.replace('-', '.');
  const name = cleanChapterTitle(title, progress, layout.chapterTitle);
  // Require confirmation from the displayed reader before interpreting a second dash as a decimal.
  return { series, progress: !chapter.includes('-') || name ? progress : undefined, title: name ?? title };
};

const fanFox: Extractor = ({ origin, pathname }) => {
  if (origin !== 'https://m.fanfox.net') return;
  const [, section, slug, chapter] = /^\/(manga|roll_manga)\/([a-z0-9]+(?:[_-][a-z0-9]+)*)(?:\/c(\d{1,12}(?:\.\d{1,10})?)(?:\/[1-9]\d*\.html)?)?\/?$/.exec(pathname) ?? [];
  if (!slug || (section === 'roll_manga' && !chapter)) return {};
  return { series: origin + '/manga/' + slug + '/', progress: chapter?.replace(/^0+(?=\d)/, '') };
};

const mgeko: Extractor = ({ origin, pathname }, title) => {
  if (origin !== 'https://www.mgeko.cc') return;
  const [, slug, progress] = /^\/reader\/en\/([a-z0-9]+(?:-[a-z0-9]+)*)-chapter-(\d{1,12})-eng-li\/?$/.exec(pathname) ?? [];
  if (slug) return {
    series: origin + '/manga/' + slug + '/', progress,
    title: cleanChapterTitle(title, progress, /^Manga: (.+) Chapter - (\d+)-eng-li$/i) ?? title,
  };
  const seriesSlug = /^\/manga\/([a-z0-9]+(?:-[a-z0-9]+)*)\/?$/.exec(pathname)?.[1];
  return seriesSlug ? { series: origin + '/manga/' + seriesSlug + '/' } : {};
};

export const additionalReaders = [hierarchicalReader, fanFox, mgeko];
