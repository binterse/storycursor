import { Conflict, prepare, uuid, validateCommand, type Command, type Fields, type Patch, type Result } from '../core/commands';
import { anchor, columns, describe, fields, literal, revision, scalar, writable, type Cell, type Hash, type Row } from './schema';

export type Audit = { command: Command; before: Patch; afterRevision: string; at: string };
export type Change = { index: number; cell: Cell };
export type Transaction = { row?: Row; append?: boolean; changes: Change[]; audit: Audit; inbox?: string };
export interface Workbook {
  rows(): Row[];
  readingSheetId(): number;
  lookup(operationId: string): Audit | undefined;
  commit(transaction: Transaction): void;
  hash: Hash;
}

export function apply(book: Workbook, input: unknown): Result {
  try {
    const cmd = validateCommand(input);
    const saved = { status: 'saved', operationId: cmd.operationId, target: cmd.target } as const;
    const earlier = book.lookup(cmd.operationId);
    if (earlier) {
      if (JSON.stringify(validateCommand(earlier.command)) !== JSON.stringify(cmd)) throw new Conflict('Operation ID already used.');
      return saved;
    }
    const audit: Audit = { command: cmd, before: {}, afterRevision: '', at: new Date().toISOString() };
    if (cmd.type === 'QueueForReview') {
      if (cmd.expected !== 'absent' || cmd.target !== cmd.operationId) throw new Conflict('Invalid inbox identity.');
      prepare(cmd, { title: '', primary: '', secondary: '', progress: undefined });
      book.commit({ changes: [], audit, inbox: String(cmd.value) });
      return saved;
    }
    const rows = book.rows();
    const collisions = rows.filter(row => String(scalar(row.cells[columns[row.sheet].identity]) ?? '').split(':')[0] === cmd.target);
    const creating = cmd.type === 'CreateEntry';
    let row = collisions[0];
    if (creating) {
      if (cmd.expected !== 'absent' || collisions.length) throw new Conflict('Entry already exists.');
      row = { sheet: 'reading', sheetId: book.readingSheetId(), index: -1, cells: [] };
    } else {
      if (!row || collisions.length !== 1 || describe(row, book.hash).id !== cmd.target) throw new Conflict('Record identity is missing or detached.');
      const signature = anchor(row, book.hash);
      if (rows.filter(candidate => anchor(candidate, book.hash) === signature).length !== 1) throw new Conflict('Duplicate record identity.');
      if (revision(row, book.hash) !== cmd.expected) throw new Conflict('Record changed. Reload and review.');
    }
    const before = fields(row);
    const referenced = cmd.type === 'RestoreChange' && typeof cmd.value === 'string' && uuid.test(cmd.value)
      ? book.lookup(cmd.value) : undefined;
    const restore = referenced?.command.target === cmd.target && referenced.afterRevision === cmd.expected &&
      referenced.command.type !== 'CreateEntry' ? referenced.before : undefined;
    const patch = prepare(cmd, before, restore);
    const col = columns[row.sheet];
    const after: Row = { ...row, cells: [...row.cells] };
    const changes: Change[] = [];
    function stage(index: number, cell: Cell) {
      changes.push({ index, cell });
      const updated = { ...after.cells[index] };
      delete updated.hyperlink;
      delete updated.userEnteredValue;
      after.cells[index] = { ...updated, ...cell };
    }
    for (const key of Object.keys(patch) as (keyof Fields)[]) {
      const index = col[key];
      if (index === undefined || !writable(row.cells[index])) throw new Conflict('The target cell cannot be edited without changing its structure.');
      const old = scalar(row.cells[index]);
      if (old !== undefined) Object.assign(audit.before, { [key]: old });
      else Object.assign(audit.before, { [key]: null });
      stage(index, literal(patch[key] ?? undefined));
    }
    if (creating || anchor(after, book.hash) !== anchor(row, book.hash)) {
      if (rows.some(candidate => candidate !== row && anchor(candidate, book.hash) === anchor(after, book.hash))) throw new Conflict('The resulting identity would be ambiguous.');
      if (!writable(row.cells[col.identity])) throw new Conflict('The identity cell cannot be edited.');
      stage(col.identity, literal(cmd.target + ':' + anchor(after, book.hash)));
    }
    audit.afterRevision = revision(after, book.hash);
    book.commit({ row, append: creating, changes, audit });
    return saved;
  } catch (error) {
    if (error instanceof Conflict) return { status: 'conflict', message: error.message };
    throw error;
  }
}

