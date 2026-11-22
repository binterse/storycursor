import { createHash, randomUUID } from 'node:crypto';
import type { Audit, Transaction, Workbook } from '../packages/sheets-adapter/engine';
import { anchor, columns, literal, type Row } from '../packages/sheets-adapter/schema';

export const hash = (text: string) => createHash('sha256').update(text).digest('hex');
export const series = 'https://mangakatana.com/manga/orbit-library.1042';
export function fixture(sheet: Row['sheet'] = 'reading') {
  const col = columns[sheet];
  const row: Row = { sheet, sheetId: sheet === 'reading' ? 1 : 2, index: 1, cells: [] };
  for (let index = 0; index <= col.identity; index++) row.cells.push({});
  row.cells[col.title] = literal('Orbit Library-;;;-Library of Moons-;;;-Orbital Archive');
  row.cells[col.primary] = literal(series);
  row.cells[col.secondary] = literal('https://backup.example/orbit');
  if (col.progress !== undefined) row.cells[col.progress] = { ...literal(156.5), note: 'Synthetic note' };
  const id = randomUUID();
  row.cells[col.identity] = literal(id + ':' + anchor(row, hash));
  return { id, row };
}

export class MockBook implements Workbook {
  data: Row[] = [];
  log = new Map<string, Audit>();
  inbox: string[] = [];
  fault?: 'before' | 'after';
  last?: Transaction;
  hash = hash;
  rows() { return structuredClone(this.data); }
  readingSheetId() { return 1; }
  lookup(id: string) { return this.log.get(id); }
  commit(tx: Transaction) {
    if (this.fault === 'before') throw new Error('Atomic batch rejected');
    this.last = tx;
    if (tx.row) {
      const row = tx.append ? { ...tx.row, index: this.data.length + 1 } :
        this.data.find(row => row.sheetId === tx.row?.sheetId && row.index === tx.row.index)!;
      for (const change of tx.changes) {
        const old = { ...row.cells[change.index] };
        delete old.userEnteredValue;
        delete old.hyperlink;
        while (row.cells.length <= change.index) row.cells.push({});
        row.cells[change.index] = { ...old, ...change.cell };
      }
      if (tx.append) this.data.push(row);
    }
    this.log.set(tx.audit.command.operationId, JSON.parse(JSON.stringify(tx.audit)));
    if (tx.inbox !== undefined) this.inbox.push(tx.inbox);
    if (this.fault === 'after') throw new Error('Commit response lost');
  }
}
