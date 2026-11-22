import { createHash, randomUUID } from 'node:crypto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { handle } from '../apps/sheets-script/main';
import { enrollment } from '../apps/sheets-script/migration';
import { fixture, hash } from './fixtures';
import { literal, revision } from '../packages/sheets-adapter/schema';

const token = 'ab'.repeat(32);
const workbook = 'synthetic-test-workbook';
const { row, id } = fixture();
const metadata = ['reading','todos','_sync_log','_sync_inbox','_sync_meta'].map((title, i) => ({ properties: { title, sheetId: i + 1 } }));
const command = () => ({ operationId: randomUUID(), target: id, type: 'SetProgress', expected: revision(row, hash), value: '157' });
const get = vi.fn();
const values = vi.fn();
const batch = vi.fn();
const lock = { tryLock: vi.fn(), releaseLock: vi.fn() };
let properties: Record<string, string>;
function post(body: object) {
  return handle({ postData: { contents: JSON.stringify({ binding:hash('storycursor-v1:' + workbook), ...body }) } });
}

beforeEach(() => {
  vi.resetAllMocks();
  properties = { CLIENT_TOKEN: token, SPREADSHEET_ID: workbook, EXCLUSIVE_WRITER: 'yes' };
  lock.tryLock.mockReturnValue(true);
  get.mockImplementation((_, opts) => ({ sheets: opts.ranges
    ? [{ properties: metadata[0]!.properties, data:[{ rowData:[{}, { values:row.cells }] }] }]
    : metadata }));
  values.mockImplementation((_, range) => range.includes('_sync_meta') ? { values:[['storycursor-v1']] } : {});
  vi.stubGlobal('PropertiesService', { getScriptProperties: () => ({ getProperty: (key: string) => properties[key] }) });
  vi.stubGlobal('LockService', { getScriptLock: () => lock });
  vi.stubGlobal('ContentService', { createTextOutput: (body: string) => ({ setMimeType: () => JSON.parse(body) }), MimeType: { JSON: 'json' } });
  vi.stubGlobal('Utilities', {
    DigestAlgorithm: {}, Charset: {},
    computeDigest: (_: unknown, text: string) => [...createHash('sha256').update(text).digest()],
  });
  vi.stubGlobal('Sheets', { Spreadsheets: { get, batchUpdate:batch, Values: { get: values } } });
});
afterEach(() => vi.unstubAllGlobals());

it('checks authorization before taking the lock or reading the workbook', () => {
  expect(post({ action:'list', token:'aa'.repeat(32) })).toMatchObject({ status:'failed', message:'Unauthorized.' });
  expect(handle({ postData: { contents:'{bad json' } })).toMatchObject({ status:'failed' });
  expect(lock.tryLock).not.toHaveBeenCalled();
  expect(get).not.toHaveBeenCalled();
});
it('checks writer configuration and takes the lock before opening Sheets', () => {
  properties.EXCLUSIVE_WRITER = 'no';
  expect(post({ action:'submit', token, command:command() })).toMatchObject({ status:'failed' });
  expect(batch).not.toHaveBeenCalled();
  lock.tryLock.mockReturnValue(false);
  get.mockClear();
  expect(post({ action:'list', token })).toMatchObject({ status:'retry' });
  expect(get).not.toHaveBeenCalled();
});
it('sends one atomic batch combining the field mask and audit entry', () => {
  const cmd = command();
  expect(post({ action:'submit', token, command:cmd })).toMatchObject({ status:'saved' });
  expect(batch).toHaveBeenCalledOnce();
  expect(batch).toHaveBeenCalledWith({ requests: [
    { updateCells: { start: { sheetId:1, rowIndex:1, columnIndex:1 },
      fields:'userEnteredValue', rows:[{ values:[literal('157')] }] } },
    { appendCells: { sheetId:3, fields:'userEnteredValue', rows:[{ values:[literal(cmd.operationId), expect.anything()] }] } },
  ] }, workbook);
  expect(lock.releaseLock).toHaveBeenCalledOnce();
});
it('reports an uncertain batch as retriable and releases the lock', () => {
  batch.mockImplementation(() => { throw new Error('Unknown commit outcome'); });
  expect(post({ action:'submit', token, command:command() })).toMatchObject({ status:'retry' });
  expect(lock.releaseLock).toHaveBeenCalledOnce();
});
it('enrolls only unchanged reviewed rows and accepts an exact migration replay', () => {
  const sample = structuredClone(row);
  sample.cells[6] = {};
  const plan = [{ sheet:'reading' as const, row:2, expected:revision(sample, hash) }];
  const added = enrollment([sample], plan, hash, () => id);
  expect(added).toHaveLength(1);
  sample.cells[6] = literal(added[0]!.value);
  expect(enrollment([sample], plan, hash, () => id)).toEqual([]);
  sample.cells[0] = literal('Changed title');
  expect(() => enrollment([sample], plan, hash, () => id)).toThrow('Enrollment row moved or changed.');
});

