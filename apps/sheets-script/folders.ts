export const defaultFolder = 'StoryCursor';
type Destination = { folder: string; workbook: string; name: string };
export function destinations(raw: string, hash: (s: string) => string) {
  const rows: Destination[] = JSON.parse(raw);
  const validId = (id: unknown) => typeof id === 'string' && /^[\w-]{10,200}$/.test(id);
  if (!Array.isArray(rows) || !rows.length || rows.length > 100 ||
      rows.some(r => !r || !validId(r.folder) || !validId(r.workbook) || typeof r.name !== 'string' || !r.name.trim()) ||
      ['folder','workbook','name'].some(k => new Set(rows.map(r => r[k as keyof Destination])).size !== rows.length)) {
    throw new Error('Invalid staging folder configuration.');
  }
  return rows.map(r => ({ ...r, binding: hash('storycursor-folder-v1:' + r.folder + ':' + r.workbook) }));
}
const folderMime = 'application/vnd.google-apps.folder';
const sheetMime = 'application/vnd.google-apps.spreadsheet';
const fields = 'nextPageToken,files(id,name,mimeType,appProperties,parents,trashed)';
const marker = { storycursorWorkbook: 'v1' };

type File = { id: string; name: string; mimeType?: string; appProperties?: Record<string, string>; parents?: string[]; trashed?: boolean };
export interface DriveFiles {
  list(options: { q: string; fields: string; pageSize: number; pageToken?: string }): { files?: File[]; nextPageToken?: string };
  create(file: { name: string; mimeType: string; parents?: string[]; appProperties?: Record<string, string> }): File;
}

function quote(value: string) {
  return "'" + value.replaceAll('\\', '\\\\').replaceAll("'", "\\'") + "'";
}
function list(drive: DriveFiles, q: string) {
  const output: File[] = [];
  let pageToken: string | undefined;
  do {
    const page = drive.list({ q: 'trashed = false and ' + q, fields, pageSize: 100, pageToken });
    output.push(...(page.files ?? []));
    pageToken = page.nextPageToken;
    if (output.length > 500 || (pageToken && !(page.files?.length))) throw new Error('Too many Drive results.');
  } while (pageToken);
  return output;
}
export function folders(drive: DriveFiles) {
  return list(drive, 'mimeType = ' + quote(folderMime))
    .sort((a,b) => Number(b.name === defaultFolder) - Number(a.name === defaultFolder) || a.name.localeCompare(b.name));
}

export function folderChoices(drive: DriveFiles) {
  const available = folders(drive);
  return [
    ...available.map(folder => ({
      id: folder.id, name: folder.name,
      label: available.some(other => other.id !== folder.id && other.name === folder.name)
        ? folder.name + ' · ' + folder.id.slice(-6) : folder.name,
    })),
    { id: 'new', name: defaultFolder, label: defaultFolder + ' (create new)' },
  ];
}

export function managedWorkbook(drive: DriveFiles, choice: unknown, input: unknown) {
  if (typeof choice !== 'string' || !/^(?:new|[A-Za-z0-9_-]{10,200})$/.test(choice)) throw new Error('Invalid folder selection.');
  const available = folders(drive);
  let folder = available.find(file => file.id === choice);
  if (choice === 'new') {
    if (typeof input !== 'string' || !input.trim() || input.length > 100 || /[\u0000-\u001f]/.test(input)) throw new Error('Invalid folder name.');
    const name = input.trim();
    const sameName = available.filter(file => file.name === name);
    if (sameName.length) throw new Error('That folder already exists. Refresh and select it from the list.');
    folder = drive.create({ name, mimeType: folderMime });
  }
  if (!folder?.id) throw new Error('The selected folder is no longer available.');
  const existing = list(drive, quote(folder.id) + ' in parents and mimeType = ' + quote(sheetMime) +
    " and appProperties has { key='storycursorWorkbook' and value='v1' }");
  if (existing.length > 1) throw new Error('More than one StoryCursor workbook exists in this folder.');
  const workbook = existing[0] ?? drive.create({ name: defaultFolder, mimeType: sheetMime, parents: [folder.id], appProperties: marker });
  if (!workbook.id) throw new Error('Google Drive did not return the workbook ID.');
  return workbook.id;
}
