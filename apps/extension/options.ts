import { clearDebugCaptures, readDebugCaptures } from './debug-storage';
import { action, app, details, element, input, report } from '../../packages/ui/popup';
import { config, remote, validConfig, type Config, type FolderChoice } from './sync';

const content = element('section');

async function connect(connection: Config) {
  if (!validConfig(connection)) throw new Error('Enter the deployment URL and service token.');
  const service = remote(connection);
  const folderSetup = await service.folderSetup();
  if (folderSetup) {
    renderFolders(connection, folderSetup);
    return;
  }
  await finish(connection);
}

async function finish(connection: Config) {
  connection.binding = await remote(connection).check();
  await chrome.storage.local.set({ connection });
  report('Connected. You can return to your reading tab.');
  await render();
}

function renderFolders(connection: Config, choices: FolderChoice[]) {
  report('');
  content.replaceChildren();
  element('h2', 'Choose a Google Drive folder', content);
  const folder = element('select', '', element('label', 'Folder', content));
  for (const item of choices) folder.add(new Option(item.label, item.id));
  const defaults = choices.filter(item => item.id !== 'new' && item.name === 'StoryCursor');
  if (defaults.length > 1) {
    folder.add(new Option('Choose a folder…', '', true, true), 0);
  } else {
    folder.value = defaults[0]?.id ?? 'new';
  }
  const newName = input('New folder name', content, 'StoryCursor');
  newName.maxLength = 100;
  const showName = () => { newName.parentElement!.hidden = folder.value !== 'new'; };
  folder.addEventListener('change', showName);
  showName();
  action('Use folder', async () => {
    const item = choices.find(choice => choice.id === folder.value);
    if (!item) throw new Error('Select a folder.');
    await remote(connection).useFolder(item.id, item.id === 'new' ? newName.value.trim() : item.name);
    await finish(connection);
  }, content).className = 'primary';
  action('Back', render, content);
}

async function render() {
  content.replaceChildren();
  const connection = await config();
  if (connection) {
    element('p', 'Google Sheets connected', content);
    action('Disconnect', async () => {
      if (!window.confirm('Disconnect on this device? Your files and queued operations will stay.')) return;
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
  const endpoint = input('Deployment URL', content, '', 'url');
  const token = input('Service token', content, '', 'password');
  token.autocomplete = 'off';
  action('Continue', async () => {
    report('Checking connection…');
    try { await connect({ endpoint: endpoint.value.trim(), token: token.value.trim() }); }
    finally { token.value = ''; }
  }, content).className = 'primary';
  const help = details('About the test connection', content);
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
