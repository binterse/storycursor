import { expect, it, vi } from 'vitest';
import { folderChoices, managedWorkbook, type DriveFiles } from '../apps/sheets-script/folders';

const folder = { id: 'test-folder-1', name: 'StoryCursor' };
const workbook = { id: 'test-workbook-1', name: 'StoryCursor' };

function fixture(seed: boolean) {
  const create = vi.fn<DriveFiles['create']>()
    .mockImplementation(file => file.mimeType.endsWith('.folder') ? folder : workbook);
  const list = vi.fn<DriveFiles['list']>().mockImplementation(({ q }) => q.includes('in parents')
    ? { files: seed ? [workbook] : [] } : { files: seed ? [folder] : [] });
  return { create, list };
}

it('suggests a visible StoryCursor folder first or offers to create it', () => {
  expect(folderChoices(fixture(true))[0]).toEqual({ ...folder, label: 'StoryCursor' });
  expect(folderChoices(fixture(false))).toEqual([{ id: 'new', name: 'StoryCursor', label: 'StoryCursor (create new)' }]);
});
it('creates a folder and tagged workbook only after selection', () => {
  const drive = fixture(false);
  expect(managedWorkbook(drive, 'new', 'StoryCursor')).toBe(workbook.id);
  expect(drive.create).toHaveBeenCalledTimes(2);
  expect(drive.create).toHaveBeenLastCalledWith(expect.objectContaining({ parents: [folder.id], appProperties: { storycursorWorkbook: 'v1' } }));
});
it('reuses the app workbook and rejects unavailable or duplicate folders', () => {
  const drive = fixture(true);
  expect(managedWorkbook(drive, folder.id, undefined)).toBe(workbook.id);
  expect(() => managedWorkbook(drive, 'missing-folder', undefined)).toThrow('no longer available');
  expect(() => managedWorkbook(drive, 'new', 'StoryCursor')).toThrow('already exists');
  expect(drive.create).not.toHaveBeenCalled();
});
