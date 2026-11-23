export const mediaKinds = ['manga', 'anime', 'movie', 'series', 'novel', 'book'] as const;
export type MediaKind = typeof mediaKinds[number];
export type Scalar = string | number;
export type Progress =
  | { kind: 'ordinal'; original: Scalar; value: number }
  | { kind: 'literal'; original: Scalar };
export const aliasDelimiter = '-;;;-';
export const aliases = (title: string) => title.split(aliasDelimiter).map(part => part.trim()).filter(Boolean);
export const titleKey = (title: string) => title.normalize('NFC').trim().replace(/\s+/g, ' ').toLowerCase();

export function parseProgress(original: Scalar): Progress {
  const value = Number(original);
  if (/^\d+(?:\.\d+)?$/.test(String(original)) && Number.isFinite(value) &&
      Math.abs(value) < 1e12 && String(original).replace(/^0+(?=\d)/, '').replace(/(\.\d*?[1-9])0+$/, '$1').replace(/\.0+$/, '') === String(value)) {
    return { kind: 'ordinal', original, value };
  }
  return { kind: 'literal', original };
}

export function sourceKey(input: string): string | undefined {
  if (!/^https?:\/\//i.test(input) || /[\s\\\u0000-\u001f]/.test(input)) return;
  if (typeof URL === 'function') {
    try {
      const parsed = new URL(input);
      if (!parsed.username && !parsed.password) return parsed.href;
    } catch { return; }
    return;
  }

  // Apps Script has no WHATWG URL. Accept ordinary ASCII web URLs there and
  // reject ambiguous authorities or paths instead of guessing a canonical URL.
  const parts = /^(https?):\/\/([a-z0-9.-]+)(?::([0-9]{1,5}))?([/?#][\x21-\x7e]*)?$/i.exec(input);
  if (!parts) return;
  const [, rawProtocol, rawHost, rawPort, suffix = ''] = parts;
  if (!rawProtocol || !rawHost || /["<>^`{}|]/.test(suffix)) return;
  const host = rawHost.toLowerCase();
  const labels = host.replace(/\.$/, '').split('.');
  if (host.length > 254 || labels.some(label => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))) return;
  const lastLabel = labels[labels.length - 1]!;
  if (/^(?:\d+|0x[0-9a-f]*)$/.test(lastLabel) &&
      (labels.length !== 4 || labels.some(label => !/^(?:0|[1-9]\d{0,2})$/.test(label) || Number(label) > 255))) return;
  const path = suffix.split(/[?#]/, 1)[0]!;
  if (path.split('/').some(segment => /^(?:\.|%2e){1,2}$/i.test(segment))) return;
  const protocol = rawProtocol.toLowerCase();
  const port = rawPort === undefined ? undefined : Number(rawPort);
  if (port !== undefined && port > 65535) return;
  const authority = host + (port === undefined || port === (protocol === 'https' ? 443 : 80) ? '' : ':' + port);
  return protocol + '://' + authority + (suffix.startsWith('/') ? '' : '/') + suffix;
}

export type Entry = {
  id: string;
  revision: string;
  sheet: 'reading' | 'todos';
  kind: MediaKind;
  title: string;
  progress?: Scalar;
  sources: [string, string];
};

export type Observation = { title: string; url: string; series?: string; progress?: string };
export type Mapping = { source: string; id: string };

export function candidates(observation: Observation, entries: Entry[], mapping?: Mapping, canonicalize = sourceKey, exactPageSource?: string) {
  const stable = sourceKey(observation.series ?? observation.url);
  const key = titleKey(observation.title);
  const exactUrl = (entry: Entry) => entry.sources.some(url =>
    (!!observation.series && canonicalize(url) === stable) ||
    (!!exactPageSource && sourceKey(url) === exactPageSource));
  const verified = entries.filter(entry => exactUrl(entry) || (stable && mapping?.source === stable && entry.id === mapping.id));
  const available = verified.length === 1 && verified[0]!.id ? verified[0] : undefined;
  return {
    verified: available,
    matches: entries.flatMap(entry => {
      const names = aliases(entry.title).map(titleKey);
      if (verified.includes(entry)) return [{ entry, evidence: 'source' }];
      if (key && names.includes(key)) return [{ entry, evidence: 'title' }];
      if (key.length >= 4 && names.some(name => name.length >= 4 && (name.includes(key) || key.includes(name)))) {
        return [{ entry, evidence: 'similar title' }];
      }
      return [];
    }),
  };
}
