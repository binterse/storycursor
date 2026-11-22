import type { Entry, Scalar } from '../core/domain';
import type { Fields } from '../core/commands';

export type Cell = {
  userEnteredValue?: { stringValue?: string; numberValue?: number; formulaValue?: string; boolValue?: boolean };
  hyperlink?: string;
  textFormatRuns?: { format?: { link?: { uri?: string } } }[];
  chipRuns?: unknown[];
  userEnteredFormat?: { textFormat?: { link?: { uri?: string } } };
  note?: string;
};
export const columns = {
  reading: { title: 0, progress: 1, primary: 4, secondary: 5, identity: 6 },
  todos: { title: 0, progress: undefined, primary: 3, secondary: 4, identity: 5 },
} as const;
export type Sheet = keyof typeof columns;
export type Row = { sheet: Sheet; sheetId: number; index: number; cells: Cell[] };
export type Hash = (text: string) => string;
export function scalar(cell?: Cell): Scalar | undefined {
  return cell?.userEnteredValue?.stringValue ?? cell?.userEnteredValue?.numberValue;
}
function link(cell?: Cell) {
  const links = new Set([cell?.hyperlink, cell?.userEnteredFormat?.textFormat?.link?.uri,
    ...(cell?.textFormatRuns ?? []).map(run => run.format?.link?.uri)].filter(Boolean));
  if (links.size > 1) return '';
  return [...links][0] ?? String(scalar(cell) ?? '');
}
export function fields(row: Row): Fields {
  const col = columns[row.sheet];
  return {
    title: String(scalar(row.cells[col.title]) ?? ''),
    progress: col.progress === undefined ? undefined : scalar(row.cells[col.progress]),
    primary: link(row.cells[col.primary]),
    secondary: link(row.cells[col.secondary]),
  };
}
function ordered(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(ordered);
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, child]) => [key, ordered(child)]));
}
function snapshot(cell?: Cell) {
  const copy = { ...cell };
  if (copy.hyperlink === scalar(cell)) delete copy.hyperlink;
  return ordered(copy);
}
export function anchor(row: Row, hash: Hash) {
  const col = columns[row.sheet];
  return hash(JSON.stringify([row.sheet, ...[col.title,col.primary,col.secondary].map(i => snapshot(row.cells[i]))]));
}
export function revision(row: Row, hash: Hash) {
  return hash(JSON.stringify([row.sheet, Array.from({ length: columns[row.sheet].identity + 1 }, (_, i) => snapshot(row.cells[i]))]));
}
export function describe(row: Row, hash: Hash): Entry {
  const value = fields(row);
  const [id, signature] = String(scalar(row.cells[columns[row.sheet].identity]) ?? '').split(':');
  return {
    id: id && signature === anchor(row, hash) ? id : '',
    revision: revision(row, hash), sheet: row.sheet, kind: 'manga', title: value.title,
    progress: value.progress, sources: [value.primary, value.secondary],
  };
}
export function writable(cell?: Cell) {
  return !cell?.userEnteredValue?.formulaValue && cell?.userEnteredValue?.boolValue === undefined &&
    !cell?.textFormatRuns?.length && !cell?.chipRuns?.length && !cell?.userEnteredFormat?.textFormat?.link &&
    (!cell?.hyperlink || cell.hyperlink === scalar(cell));
}
export function literal(value: Scalar | undefined): Cell {
  return value === undefined ? {} : { userEnteredValue: typeof value === 'number' ? { numberValue: value } : { stringValue: value } };
}
