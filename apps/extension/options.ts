import { clearDebugCaptures, readDebugCaptures } from './debug-storage';
import { googleSignIn } from './google-sign-in';
import { action, app, details, element, input, report } from '../../packages/ui/popup';
import { config, remote, validConfig, type Config, type FolderChoice } from './sync';

const content = element('section');

async function connect(connection: Config, requireFolder = false) {
  if (!validConfig(connection)) throw new Error('Enter the deployment URL and service token.');
  const service = remote(connection);
  const folderSetup = await service.folderSetup();
  if (folderSetup) {
    renderFolders(connection, folderSetup);
    return;
  }
  if (requireFolder) throw new Error('The sync service needs a configured Drive folder.');
  await finish(connection);
}

async function finish(connection: Config) {
  const binding = await remote(connection).check();
  if (connection.binding && connection.binding !== binding) throw new Error('The workbook changed. Choose the folder again.');
  connection.binding = binding;
  await chrome.storage.local.set({ connection, lastEndpoint: connection.endpoint });
  report('Connected. You can return to your reading tab.');
  await render();
}

function renderFolders(connection: Config, choices: FolderChoice[]) {
  report('');
  content.replaceChildren();
  element('h2', 'Choose a Google Drive folder', content);
  const folder = element('select', '', element('label', 'Folder', content));
  for (const item of choices) folder.add(new Option(item.label, item.id));
  const defaults = choices.filter(item => item.id !== 'new' && item.name === (connection.folderName ?? 'StoryCursor'));
  const current = choices.find(item => item.id === connection.folderId || item.id === connection.binding);
  if (current) {
    folder.value = current.id;
  } else if (!choices.some(item => item.id === 'new') && choices[0]) {
    folder.value = choices[0].id;
  } else if (defaults.length > 1) {
    folder.add(new Option('Choose a folder…', '', true, true), 0);
  } else {
    folder.value = defaults[0]?.id ?? choices.find(item => item.id === 'new')?.id ?? choices[0]?.id ?? '';
  }
  const newName = input('New folder name', content, 'StoryCursor');
  newName.maxLength = 100;
  const showName = () => { newName.parentElement!.hidden = folder.value !== 'new'; };
  folder.addEventListener('change', showName);
  showName();
  action('Use folder', async () => {
    const item = choices.find(choice => choice.id === folder.value);
    if (!item) throw new Error('Select a folder.');
    const name = item.id === 'new' ? newName.value.trim() : item.name;
    const binding = await remote(connection).useFolder(item.id, name);
    if (!choices.some(choice => choice.id === 'new') && binding !== item.id) throw new Error('The service confirmed a different folder.');
    await finish({ ...connection, binding, folderName: name, folderId: item.id === 'new' ? undefined : item.id });
  }, content).className = 'primary';
  if (connection.folderName) action('Cancel', render, content);
}

async function render() {
  content.replaceChildren();
  const connection = await config(true);
  if (connection?.expiresAt && !connection.folderName) {
    try { await connect(connection, true); return; }
    catch { report('Please sign in again to choose your Drive folder.'); }
  }
  if (connection && (!connection.expiresAt || connection.folderName)) {
    element('p', 'Google Sheets connected', content);
    if (connection.folderName) {
      element('p', connection.folderName, content);
      action('Change folder', () => connect(connection, true), content);
    }
    action('Disconnect', async () => {
      if (!window.confirm('Disconnect on this device? Your files and queued operations will stay.')) return;
      await chrome.storage.local.set({ lastEndpoint: connection.endpoint });
      await chrome.storage.local.remove('connection');
      report('Disconnected on this device.');
      await render();
    }, content);
    const revoke = element('a', 'Manage Google access', content);
    revoke.href = 'https://myaccount.google.com/connections';
    revoke.target = '_blank';
    revoke.rel = 'noopener noreferrer';
    return;
  }
  element('h2', 'Connect Google Drive', content);
  let setup: HTMLElement = content;
  if (STORYCURSOR_GOOGLE_ENDPOINT) {
    action('Sign in with Google', async () => {
      report('Complete sign-in in the Google tab.');
      const session = await googleSignIn(STORYCURSOR_GOOGLE_ENDPOINT);
      await chrome.storage.local.set({ connection: session });
      await connect(session, true);
    }, content).className = 'primary';
    setup = details('Advanced setup', content);
  }
  const { lastEndpoint } = await chrome.storage.local.get('lastEndpoint');
  const endpoint = input('Deployment URL', setup, typeof lastEndpoint === 'string' ? lastEndpoint : STORYCURSOR_GOOGLE_ENDPOINT, 'url');
  const token = input('Service token', setup, '', 'password');
  token.autocomplete = 'off';
  action('Continue', async () => {
    report('Checking connection…');
    try { await connect({ endpoint: endpoint.value.trim(), token: token.value.trim() }); }
    finally { token.value = ''; }
  }, setup).className = 'primary';
  const help = details('About the test connection', setup);
  element('p', 'The private test uses a StoryCursor sync deployment. A Drive-enabled deployment can suggest an existing StoryCursor folder or create one for you.', help);
}
app.querySelector('h1')!.textContent = 'StoryCursor settings';
await render();

if (STORYCURSOR_DEBUG) {
  const diagnostics = details('Debug diagnostics');
  element('p', 'Saved manga captures stay in this browser profile. Review the export before sharing it.', diagnostics);
  action('Download diagnostics', async () => {
    const captures = await readDebugCaptures();
    if (!captures.length) { report('No diagnostics for saved manga yet.'); return; }
    const file = new Blob([JSON.stringify({ version:1, captures }, null, 2)], { type:'application/json' });
    const url = URL.createObjectURL(file);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'storycursor-diagnostics.json';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    report('Exported ' + captures.length + ' capture(s).');
  }, diagnostics);
  action('Clear diagnostics', async () => {
    if (!window.confirm('Clear local debug captures?')) return;
    await clearDebugCaptures();
    report('Local debug captures cleared.');
  }, diagnostics);
}
