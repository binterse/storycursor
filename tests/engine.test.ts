import { randomUUID } from 'node:crypto';
import { beforeEach, expect, it } from 'vitest';
import { apply } from '../packages/sheets-adapter/engine';
import { anchor, fields, literal, revision, scalar } from '../packages/sheets-adapter/schema';
import type { Command } from '../packages/core/commands';
import { fixture, hash, MockBook, series } from './fixtures';

let book: MockBook;
let original: ReturnType<typeof fixture>;
beforeEach(() => {
  book = new MockBook();
  original = fixture();
  book.data.push(original.row);
});
function command(overrides: Partial<Command> = {}): Command {
  return { operationId: randomUUID(), target: original.id, expected: revision(original.row, hash),
    type: 'SetProgress', value: '157.5', ...overrides };
}

it('updates just the progress cell and preserves notes and unrelated cells', () => {
  const before = structuredClone(original.row);
  expect(apply(book, command()).status).toBe('saved');
  expect(book.last?.changes.map(change => change.index)).toEqual([1]);
  expect(original.row.cells[1]).toEqual({ ...literal('157.5'), note: 'Synthetic note' });
  expect(original.row.cells.slice(2)).toEqual(before.cells.slice(2));
});
it('rejects regression or unknown comparisons without confirmation', () => {
  expect(apply(book, command({ value: '156' })).status).toBe('conflict');
  expect(apply(book, command({ value: 'KLAR' })).status).toBe('conflict');
  expect(apply(book, command({ value: 'KLAR', confirmed: true })).status).toBe('saved');
  expect(fields(original.row).progress).toBe('KLAR');
});
it('appends a new entry and aliases without replacing old aliases', () => {
  const create = command({ type:'CreateEntry', target:randomUUID(), expected:'absent', value:'Solar Index' });
  expect(apply(book, create).status).toBe('saved');
  expect(apply(book, create).status).toBe('saved');
  expect(book.data).toHaveLength(2);
  expect(apply(book, command({ type:'AppendAlias', value:'Moon Files' })).status).toBe('saved');
  expect(fields(original.row).title).toBe('Orbit Library-;;;-Library of Moons-;;;-Orbital Archive-;;;-Moon Files');
});
it('promotes a backup and preserves the prior source; refuses loss of a third source', () => {
  expect(apply(book, command({ type:'SetPrimarySource', value:'https://third.example/series' })).status).toBe('conflict');
  expect(apply(book, command({ type:'SetPrimarySource', value:'https://backup.example/orbit' })).status).toBe('saved');
  expect(fields(original.row)).toMatchObject({ primary: 'https://backup.example/orbit', secondary: series });
});
it('does not overwrite formulas or richly linked source cells', () => {
  original.row.cells[4] = { userEnteredValue: { formulaValue: '=HYPERLINK("https://fixture.example","Read")' }, hyperlink: 'https://fixture.example' };
  original.row.cells[6] = literal(original.id + ':' + anchor(original.row, hash));
  expect(apply(book, command({ type:'RemoveSource', value:'primary', confirmed:true })).status).toBe('conflict');
  expect(book.log.size).toBe(0);
});
it('detects stale commands prepared concurrently by two clients', async () => {
  const first = command();
  const second = command({ value:'158' });
  const replies = await Promise.all([first,second].map(item => Promise.resolve().then(() => apply(book,item))));
  expect(replies.map(reply => reply.status)).toEqual(['saved','conflict']);
});
it('locates a fully moved row and refuses deleted or detached identities', () => {
  const cmd = command();
  original.row.index = 32;
  expect(apply(book, cmd).status).toBe('saved');
  const stale = command();
  original.row.cells[0] = literal('Other identity');
  expect(apply(book, stale).status).toBe('conflict');
  book.data.length = 0;
  expect(apply(book, command()).status).toBe('conflict');
});
it('rejects duplicate IDs and indistinguishable anchors', () => {
  const copy = structuredClone(original.row);
  copy.index++;
  book.data.push(copy);
  expect(apply(book, command()).status).toBe('conflict');
  copy.cells[6] = literal(randomUUID() + ':' + anchor(copy, hash));
  expect(apply(book, command()).status).toBe('conflict');
});
it('retries the same operation after atomic rejection or a lost confirmation', () => {
  const cmd = command();
  book.fault = 'before';
  expect(() => apply(book, cmd)).toThrow('Atomic batch rejected');
  expect(fields(original.row).progress).toBe(156.5);
  expect(book.log.size).toBe(0);
  book.fault = 'after';
  expect(() => apply(book, cmd)).toThrow('Commit response lost');
  book.fault = undefined;
  expect(apply(book, cmd).status).toBe('saved');
  expect(apply(book, { ...cmd, value:'170' }).status).toBe('conflict');
  expect(book.log.size).toBe(1);
});
it('restores the exact original type or blank and rejects stale restores', () => {
  for (const old of [156.5, undefined]) {
    original.row.cells[1] = literal(old);
    const cmd = command();
    expect(apply(book, cmd).status).toBe('saved');
    const restore = command({ type:'RestoreChange', value:cmd.operationId, confirmed:true });
    expect(apply(book, restore).status).toBe('saved');
    expect(scalar(original.row.cells[1])).toBe(old);
    expect(apply(book, { ...restore, operationId:randomUUID() }).status).toBe('conflict');
  }
});
it('stores uncertainties in the inbox only and validates hostile payloads', () => {
  const id = randomUUID();
  const before = structuredClone(book.data);
  const inbox = command({ type:'QueueForReview', target:id, operationId:id, expected:'absent', value:'Uncertain' });
  expect(apply(book, inbox).status).toBe('saved');
  expect(apply(book, inbox).status).toBe('saved');
  expect(book.data).toEqual(before);
  expect(book.inbox).toEqual(['Uncertain']);
  expect(apply(book, { ...inbox, operationId:'=invalid' }).status).toBe('conflict');
});

it('links and removes a backup without touching the primary or progress', () => {
  original.row.cells[5] = {};
  original.row.cells[6] = literal(original.id + ':' + anchor(original.row, hash));
  const source = 'https://second.example/series';
  expect(apply(book, command({ type: 'LinkExistingEntry', value: source })).status).toBe('saved');
  expect(fields(original.row)).toMatchObject({ secondary: source, primary: series, progress: 156.5 });
  expect(apply(book, command({ type: 'AddSource', value: 'https://third.example/series' })).status).toBe('conflict');
  expect(apply(book, command({ type: 'RemoveSource', value: 'secondary' })).status).toBe('conflict');
  expect(apply(book, command({ type: 'RemoveSource', value: 'secondary', confirmed: true })).status).toBe('saved');
  expect(fields(original.row)).toMatchObject({ secondary: '', primary: series, progress: 156.5 });
});
