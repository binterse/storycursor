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
function redundantLink(cell?: Cell) {
  const value = scalar(cell);
  return typeof value === 'string' && !!value &&
    cell?.userEnteredFormat?.textFormat?.link?.uri === value &&
    !cell.textFormatRuns?.length && !cell.chipRuns?.length;
}

function snapshot(cell?: Cell, keepRedundantLink = false) {
  const copy = { ...cell };
  if (copy.hyperlink === scalar(cell)) delete copy.hyperlink;
  if (!keepRedundantLink && redundantLink(cell)) {
    const format = { ...copy.userEnteredFormat };
    delete format.textFormat;
    if (Object.keys(format).length) copy.userEnteredFormat = format;
    else delete copy.userEnteredFormat;
  }
  return ordered(copy);
}
export function anchor(row: Row, hash: Hash) {
  const col = columns[row.sheet];
  return hash(JSON.stringify([row.sheet, ...[col.title,col.primary,col.secondary].map(i => snapshot(row.cells[i]))]));
}

function matchesAnchor(row: Row, hash: Hash, signature: string | undefined) {
  if (!signature) return false;
  if (anchor(row, hash) === signature) return true;
  const col = columns[row.sheet];
  const title = row.cells[col.title];
  const first = row.cells[col.primary];
  const second = row.cells[col.secondary];
  if (![title, first, second].some(redundantLink)) return false;
  // Older versions hashed plain links both with and without Google's automatic formatting.
  const possible = (cell?: Cell) => redundantLink(cell) ? [snapshot(cell), snapshot(cell, true)] : [snapshot(cell)];
  const titles = possible(title);
  return titles.some(name => possible(first).some(primary => possible(second).some(secondary =>
    hash(JSON.stringify([row.sheet, name, primary, secondary])) === signature)));
}

export function revision(row: Row, hash: Hash) {
  return hash(JSON.stringify([row.sheet, Array.from({ length: columns[row.sheet].identity + 1 }, (_, i) => snapshot(row.cells[i]))]));
}
export function describe(row: Row, hash: Hash): Entry {
  const value = fields(row);
  const [id, signature] = String(scalar(row.cells[columns[row.sheet].identity]) ?? '').split(':');
  return {
    id: id && matchesAnchor(row, hash, signature) ? id : '',
    revision: revision(row, hash), sheet: row.sheet, kind: 'manga', title: value.title,
    progress: value.progress, sources: [value.primary, value.secondary],
  };
}
export function writable(cell?: Cell) {
  return !cell?.userEnteredValue?.formulaValue && cell?.userEnteredValue?.boolValue === undefined &&
    !cell?.textFormatRuns?.length && !cell?.chipRuns?.length && (!cell?.userEnteredFormat?.textFormat?.link || redundantLink(cell)) &&
    (!cell?.hyperlink || cell.hyperlink === scalar(cell));
}
export function literal(value: Scalar | undefined): Cell {
  return value === undefined ? {} : { userEnteredValue: typeof value === 'number' ? { numberValue: value } : { stringValue: value } };
}
