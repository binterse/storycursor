declare const Drive: { Files: DriveFiles };
import { folderChoices, managedWorkbook, type DriveFiles } from './folders';
import { enrollment, type Choice } from './migration';
import { apply, type Audit, type Transaction, type Workbook } from '../../packages/sheets-adapter/engine';
import { columns, describe, revision, scalar, type Cell, type Row, type Sheet } from '../../packages/sheets-adapter/schema';
import { uuid } from '../../packages/core/commands';

type Append = { appendCells: { sheetId: number; rows: { values: Cell[] }[]; fields: string } };
type Update = { updateCells: { start: { sheetId: number; rowIndex: number; columnIndex: number }; rows: { values: Cell[] }[]; fields: string } };
type Add = { addSheet: { properties: { title: string; sheetId: number } } };
type Grid = { properties: { sheetId: number; title: string }; data?: { rowData?: { values?: Cell[] }[] }[] };
declare const Sheets: { Spreadsheets: {
  get(id: string, opts: object): { sheets?: Grid[] };
  batchUpdate(body: { requests: (Append | Update | Add)[] }, id: string): unknown;
  Values: { get(id: string, range: string): { values?: string[][] } };
} };
declare const PropertiesService: { getScriptProperties(): { getProperty(key: string): string | null; setProperty(key: string, value: string): void } };
declare const LockService: { getScriptLock(): { tryLock(ms: number): boolean; releaseLock(): void } };
declare const Utilities: { getUuid(): string; computeDigest(algorithm: unknown, value: string, encoding: unknown): number[]; DigestAlgorithm: { SHA_256: unknown }; Charset: { UTF_8: unknown } };
declare const ContentService: { createTextOutput(value: string): { setMimeType(mime: unknown): unknown }; MimeType: { JSON: unknown } };

const hash = (value: string) => Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, value, Utilities.Charset.UTF_8)
  .map(byte => (byte & 255).toString(16).padStart(2, '0')).join('');
const headers = {
  reading: ['Title', 'Progress', 'Extra information', 'Rating', 'Primary link', 'Secondary link', 'Reserved ID'],
  todos: ['Title', 'Extra information', 'Rating', 'Primary link', 'Secondary link', 'Reserved ID'],
  _sync_log: ['operationId', 'audit'],
  _sync_inbox: ['operationId', 'observation'],
  _sync_meta: ['storycursor-v1'],
} as const;
const names = Object.keys(headers) as (keyof typeof headers)[];

function checkHeaders(id: string, sheets: readonly (keyof typeof headers)[]) {
  for (const name of sheets) {
    const expected = headers[name];
    const end = String.fromCharCode(64 + expected.length);
    const values = Sheets.Spreadsheets.Values.get(id, "'" + name + "'!A1:" + end + "1").values?.[0];
    if (!values || expected.some((value, index) => values[index] !== value)) throw new Error('Workbook schema or headers changed');
  }
}
function json(value: unknown) {
  return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON);
}
function authorized(candidate: unknown, secret: string | null) {
  if (!secret || !/^[0-9a-f]{64}$/i.test(secret) || typeof candidate !== 'string' || candidate.length !== 64) return false;
  let diff = 0;
  for (let index = 0; index < 64; index++) diff |= candidate.charCodeAt(index) ^ secret.charCodeAt(index);
  return diff === 0;
}
function append(sheetId: number, values: Cell[]): Append {
  return { appendCells: { sheetId, rows: [{ values }], fields: 'userEnteredValue' } };
}
const textCell = (stringValue: string): Cell => ({ userEnteredValue: { stringValue } });

function openWorkbook(id: string): Workbook {
  const sheets = Sheets.Spreadsheets.get(id, { fields: 'sheets(properties(sheetId,title))' }).sheets ?? [];
  const sheetId = (name: string) => {
    const sheet = sheets.find(item => item.properties.title === name);
    if (!sheet) throw new Error('Missing sheet');
    return sheet.properties.sheetId;
  };
  names.forEach(sheetId);
  checkHeaders(id, names);
  return {
    hash,
    readingSheetId: () => sheetId('reading'),
    lookup(operationId) {
      const rows = Sheets.Spreadsheets.Values.get(id, "'_sync_log'!A2:B").values ?? [];
      const matches = rows.filter(row => row[0] === operationId);
      if (matches.length > 1) throw new Error('Duplicate audit entries');
      return matches.length ? JSON.parse(matches[0]![1]!) as Audit : undefined;
    },
    rows() {
      const data = Sheets.Spreadsheets.get(id, {
        ranges: ['reading!A:G', 'todos!A:F'],
        fields: 'sheets(properties(sheetId,title),data(rowData(values(userEnteredValue,hyperlink,textFormatRuns,chipRuns,userEnteredFormat(textFormat(link),numberFormat),note))))',
      }).sheets ?? [];
      return data.flatMap(grid => (grid.data?.[0]?.rowData ?? []).flatMap(({ values = [] }, index): Row[] => {
        if (index === 0 || !values.some(cell => cell.userEnteredValue || cell.hyperlink || cell.note)) return [];
        const cells = [...values];
        while (cells.length && !Object.keys(cells[cells.length - 1]!).length) cells.pop();
        return [{ sheet: grid.properties.title as Sheet, sheetId: grid.properties.sheetId, index, cells }];
      }));
    },
    commit(tx: Transaction) {
      const requests: (Append | Update)[] = [];
      if (tx.row && tx.append) {
        const values = Array.from({length: columns[tx.row.sheet].identity + 1}, () => ({} as Cell));
        tx.changes.forEach(change => { values[change.index] = change.cell; });
        requests.push(append(tx.row.sheetId, values));
      } else if (tx.row) {
        const { sheetId, index } = tx.row;
        for (const change of tx.changes) requests.push({ updateCells: {
          start: { sheetId, rowIndex: index, columnIndex: change.index },
          rows: [{ values: [change.cell] }], fields: 'userEnteredValue',
        } });
      }
      if (tx.inbox !== undefined) requests.push(append(sheetId('_sync_inbox'), [textCell(tx.audit.command.operationId), textCell(tx.inbox)]));
      requests.push(append(sheetId('_sync_log'), [textCell(tx.audit.command.operationId), textCell(JSON.stringify(tx.audit))]));
      Sheets.Spreadsheets.batchUpdate({ requests }, id);
    },
  };
}

function prepareManagedSheet(id: string) {
  const sheets = Sheets.Spreadsheets.get(id, { fields: 'sheets(properties(sheetId,title))' }).sheets ?? [];
  if (sheets.some(sheet => names.includes(sheet.properties.title as keyof typeof headers))) {
    openWorkbook(id);
    return;
  }
  if (sheets.length !== 1) throw new Error('The managed workbook has an unexpected layout.');
  const taken = new Set(sheets.map(sheet => sheet.properties.sheetId));
  const requests: (Add | Append)[] = [];
  let next = 1;
  for (const title of names) {
    while (taken.has(next)) next++;
    requests.push({ addSheet: { properties: { title, sheetId: next } } }, append(next, headers[title].map(textCell)));
    next++;
  }
  Sheets.Spreadsheets.batchUpdate({ requests }, id);
  openWorkbook(id);
}

export function handle(event: { postData?: { contents?: string } }) {
  const props = PropertiesService.getScriptProperties();
  const raw = event.postData?.contents ?? '';
  let request;
  try {
    if (!raw || raw.length > 12000) return json({ status: 'failed', message: 'Invalid request.' });
    request = JSON.parse(raw);
  } catch { return json({ status: 'failed', message: 'Invalid request.' }); }
  if (!authorized(request?.token, props.getProperty('CLIENT_TOKEN'))) return json({ status: 'failed', message: 'Unauthorized.' });
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return json({ status: 'retry', message: 'Service busy.' });
  try {
    const id = props.getProperty('SPREADSHEET_ID');
    const managed = props.getProperty('MANAGED_DRIVE') === 'yes';
    if (request.action === 'folders') {
      return json({ status: 'ready', folders: managed && !id ? folderChoices(Drive.Files) : null });
    }
    if (request.action === 'useFolder') {
      if (!managed || id) return json({ status: 'conflict', message: 'This deployment already has a workbook or folder setup is disabled.' });
      if (props.getProperty('EXCLUSIVE_WRITER') === 'yes') return json({ status: 'failed', message: 'Disable sync writes before choosing a folder.' });
      const managedId = managedWorkbook(Drive.Files, request.folder, request.name);
      prepareManagedSheet(managedId);
      props.setProperty('SPREADSHEET_ID', managedId);
      return json({ status: 'ready' });
    }
    if (!id) return json({ status: 'failed', message: 'Test workbook is not configured.' });
    const book = openWorkbook(id);
    const binding = hash('storycursor-v1:' + id);
    if (request.action === 'check') return json({ status: 'ready', binding });
    if (request.binding !== binding) return json({ status: 'failed', message: 'Workbook changed. Reconnect before continuing.' });
    if (request.action === 'list') {
      const rows = book.rows();
      const entries = rows.map(row => describe(row, hash));
      const counts = new Map<string, number>();
      for (const row of rows) {
        const id = String(scalar(row.cells[columns[row.sheet].identity]) ?? '').split(':')[0]!;
        counts.set(id, (counts.get(id) ?? 0) + 1);
      }
      return json({ status: 'ready', entries: entries.map(entry => ({
        ...entry, id: uuid.test(entry.id) && counts.get(entry.id) === 1 ? entry.id : '',
      })) });
    }
    if (request.action !== 'submit') return json({ status: 'failed', message: 'Unknown action.' });
    if (props.getProperty('EXCLUSIVE_WRITER') !== 'yes') return json({ status: 'failed', message: 'Workbook writes are disabled.' });
    return json(apply(book, request.command));
  } catch {
    return json({ status: 'retry', message: 'Workbook unavailable or result uncertain. Retry the same operation.' });
  } finally {
    lock.releaseLock();
  }
}


function editorTask<T>(run: (id: string) => T): T {
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty('SPREADSHEET_ID');
  if (!id || props.getProperty('EXCLUSIVE_WRITER') === 'yes') throw new Error('Configure a staging workbook and disable service writes first.');
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) throw new Error('Service busy');
  try { return run(id); } finally { lock.releaseLock(); }
}

export function initialize() {
  return editorTask(id => {
    const sheets = Sheets.Spreadsheets.get(id, { fields: 'sheets(properties(sheetId,title))' }).sheets ?? [];
    for (const name of ['reading', 'todos']) {
      if (!sheets.some(sheet => sheet.properties.title === name)) throw new Error('Create reading and todos with headers first.');
    }
    const sync = names.slice(2);
    const existing = sheets.filter(sheet => sync.some(name => name === sheet.properties.title));
    if (existing.length) {
      openWorkbook(id);
      return 'Already initialized';
    }
    checkHeaders(id, ['reading', 'todos']);
    const taken = new Set(sheets.map(sheet => sheet.properties.sheetId));
    const requests: (Add | Append)[] = [];
    let next = 1;
    sync.forEach(title => {
      while (taken.has(next)) next++;
      requests.push({ addSheet: { properties: { title, sheetId: next } } });
      requests.push(append(next, headers[title].map(textCell)));
      next++;
    });
    Sheets.Spreadsheets.batchUpdate({ requests }, id);
    return 'Initialized';
  });
}

function choices(): Choice[] {
  const value: unknown = JSON.parse(PropertiesService.getScriptProperties().getProperty('ENROLL_PLAN') ?? '[]');
  if (!Array.isArray(value) || value.length > 100 || value.some(choice => !choice ||
      !['reading','todos'].includes(choice.sheet) || !Number.isSafeInteger(choice.row) || choice.row < 2 ||
      !/^[0-9a-f]{64}$/.test(choice.expected))) throw new Error('Invalid ENROLL_PLAN');
  return value;
}

export function preview() {
  return editorTask(id => openWorkbook(id).rows().map(row => ({
    sheet: row.sheet, row: row.index + 1, expected: revision(row, hash), enrolled: !!describe(row, hash).id,
  })));
}

export function enroll() {
  return editorTask(id => {
    const plan = enrollment(openWorkbook(id).rows(), choices(), hash, Utilities.getUuid);
    const requests: Update[] = plan.map(({ row, value }) => ({ updateCells: {
      start: { sheetId: row.sheetId, rowIndex: row.index, columnIndex: columns[row.sheet].identity },
      rows: [{ values: [textCell(value)] }], fields: 'userEnteredValue',
    } }));
    if (requests.length) Sheets.Spreadsheets.batchUpdate({ requests }, id);
    return plan.length;
  });
}
