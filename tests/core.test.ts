import { describe, expect, it } from 'vitest';
import { aliases, candidates, parseProgress, sourceKey } from '../packages/core/domain';
import { describe as entry, fields } from '../packages/sheets-adapter/schema';
import { extract } from '../packages/site-adapters/extract';
import { fixture, hash, series } from './fixtures';

describe('import and matching', () => {
  it('retains alternatives and checks both schemas for duplicate evidence', () => {
    const reading = entry(fixture().row, hash);
    const todos = entry(fixture('todos').row, hash);
    expect(aliases(reading.title)).toHaveLength(3);
    expect(todos.sources[0]).toBe(series);
    expect(todos.progress).toBeUndefined();
    expect(candidates({ url: series, series, title: '' }, [reading]).verified).toEqual(reading);
    expect(candidates({ url: series, series, title: '' }, [reading, todos]).verified).toBeUndefined();
    const title = candidates({ title: 'Orbital Archive', url: 'https://example.test/1' }, [reading, todos]);
    expect(title.verified).toBeUndefined();
    expect(title.matches).toHaveLength(2);
    expect(candidates({ title: '', url: series + '/c2' }, [reading]).verified).toBeUndefined();
    expect(candidates({ title: '', url: series, series }, [reading], { id: todos.id, source: series }).verified).toEqual(reading);
  });

  it('imports untitled rows and rich hyperlinks with display text', () => {
    const { row } = fixture();
    row.cells[0] = {};
    row.cells[4] = { userEnteredValue: { stringValue: 'Open reader' }, textFormatRuns: [{ format: { link: { uri: series } } }] };
    expect(fields(row)).toMatchObject({ title: '', primary: series });
    expect(entry(row, hash).id).toBe('');
  });
});

describe('progress', () => {
  it.each([156.5, '156.5', '0001.100', 'ej.p', 'läst', 'KLAR', '17/17', '33.6/33.6', '48/267+', 'c?/164'])('preserves %s exactly', value => {
    expect(parseProgress(value).original).toBe(value);
  });
  it('only compares faithful decimals', () => {
    expect(parseProgress('156.5')).toEqual({ kind: 'ordinal', original: '156.5', value: 156.5 });
    expect(parseProgress('156.500000000000000001').kind).toBe('literal');
    expect(parseProgress('33.6/33.6').kind).toBe('literal');
  });
});

describe('extraction', () => {
  it('preserves distinct queries, fragments and paths', () => {
    const urls = ['/a?series=1','/a?series=2','/a#one','/a#two','/a/','/a','/A'];
    expect(new Set(urls.map(path => sourceKey('https://example.test' + path))).size).toBe(urls.length);
    expect(sourceKey('https://reader.test@example.test/a')).toBeUndefined();
  });
  it('recognizes only supported shapes without guessing', () => {
    expect(extract({ url: series + '/c156.5', title: 'Orbit' })).toMatchObject({ series, progress: '156.5' });
    expect(extract({ url: 'https://mangareader.to/read/orbit-library-42/en/chapter-1', title: '' })).toMatchObject({
      series: 'https://mangareader.to/orbit-library-42', progress: '1',
    });
    expect(extract({ url: 'https://mangadex.org/title/0395641a-d662-4a40-b349-cbb04c683b3a/orbit-library', title: '' }).series)
      .toBe('https://mangadex.org/title/0395641a-d662-4a40-b349-cbb04c683b3a');
    for (const url of [series + '/c1-extra', 'https://mangadex.org/chapter/0395641a-d662-4a40-b349-cbb04c683b3a',
      'https://mangakatana.com.attacker.test/manga/orbit-library.1042/c1', 'javascript:alert(1)', 'https://example.test/chapter/123']) {
      const title = '<img onerror=alert(1)>'.repeat(100);
      expect(extract({ url, title })).toEqual({ url, title: title.slice(0,400) });
    }
  });
});
