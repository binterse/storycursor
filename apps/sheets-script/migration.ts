import { anchor, columns, revision, scalar, type Hash, type Row, type Sheet } from '../../packages/sheets-adapter/schema';
import { Conflict, uuid } from '../../packages/core/commands';

export type Choice = { sheet: Sheet; row: number; expected: string };
export function enrollment(rows: Row[], choices: Choice[], hash: Hash, nextId: () => string) {
  const positions = new Set<string>();
  const ids = new Set(rows.flatMap(row => {
    const identity = scalar(row.cells[columns[row.sheet].identity]);
    return typeof identity === 'string' ? [identity.split(':')[0]] : [];
  }));
  return choices.flatMap(choice => {
    const position = choice.sheet + ':' + choice.row;
    if (positions.has(position)) throw new Conflict('Duplicate enrollment selection.');
    positions.add(position);
    const row = rows.find(row => row.sheet === choice.sheet && row.index + 1 === choice.row);
    if (!row) throw new Conflict('Enrollment row moved or changed.');
    const index = columns[row.sheet].identity;
    const current = scalar(row.cells[index]);
    if (typeof current === 'string') {
      const [id, signature] = current.split(':');
      const prior = { ...row, cells: [...row.cells] };
      prior.cells[index] = {};
      if (id && uuid.test(id) && signature === anchor(row, hash) && revision(prior, hash) === choice.expected) return [];
    }
    if (revision(row, hash) !== choice.expected) throw new Conflict('Enrollment row moved or changed.');
    if (Object.keys(row.cells[columns[row.sheet].identity] ?? {}).length) throw new Conflict('Identity cell is already in use.');
    const signature = anchor(row, hash);
    if (rows.filter(candidate => anchor(candidate, hash) === signature).length !== 1) throw new Conflict('Ambiguous enrollment identity.');
    const id = nextId();
    if (!uuid.test(id) || ids.has(id)) throw new Conflict('Invalid enrollment identity.');
    ids.add(id);
    return [{ row, value: id + ':' + signature }];
  });
}

