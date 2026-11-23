import { activePage } from './browser';
import { canonicalSeries, extract } from '../../packages/site-adapters/extract';
import { chapterId, resolveChapter } from '../../packages/site-adapters/mangadex';
import { aliases, candidates, parseProgress, sourceKey, titleKey, type Entry, type Mapping } from '../../packages/core/domain';
import type { Command, CommandName } from '../../packages/core/commands';
import { config, queue, queueKey, remote, type Config, type QueueItem } from './sync';

import { action, app, details, element, errorMessage, input, report } from '../../packages/ui/popup';
const header = document.createElement('header');
const heading = app.querySelector('h1')!;
heading.before(header);
header.append(heading);
const settings = action('⚙', () => chrome.runtime.openOptionsPage(), header);
settings.setAttribute('aria-label', 'Settings');
settings.className = 'icon-button';
const workspace = element('section');
workspace.className = 'workspace';
const history = details('Operation queue');
history.hidden = true;
const historyList = element('div', '', history);
async function send(item: QueueItem) {
  report('Submitted…');
  const response = await chrome.runtime.sendMessage({ type: 'submit', id: item.command.operationId });
  if (response.error) throw new Error(response.error);
  const result = response.item as QueueItem;
  report(result.state + (result.message ? ' · ' + result.message : ''));
  await renderQueue();
  return result;
}
async function renderQueue() {
  historyList.replaceChildren();
  const items = (await queue()).reverse();
  history.hidden = !items.length;
  for (const item of items) {
    const line = element('p', item.command.type + ' · ' + item.state, historyList);
    line.title = item.command.operationId;
    if (!['Confirmed saved', 'Conflict'].includes(item.state)) action('Retry', async () => {
      if ((await send(item)).state === 'Confirmed saved') await renderWorkspace();
    }, line);
    if (item.state === 'Confirmed saved' && !['CreateEntry','QueueForReview'].includes(item.command.type)) {
      action('Restore', async () => {
        const connection = await config();
        if (!connection || item.endpoint !== connection.endpoint || item.binding !== connection.binding) throw new Error('Connect to the original service.');
        const entry = (await remote(connection).list()).find(record => record.id === item.command.target);
        if (!entry) throw new Error('Record no longer available.');
        if (window.confirm('Restore the fields changed by this operation?')) {
          await submit(connection, 'RestoreChange', entry, item.command.operationId, true);
        }
      }, line);
    }
  }
}

async function submit(connection: Config, type: CommandName, entry: Entry | undefined, value: string, confirmed?: boolean) {
  const operationId = crypto.randomUUID();
  const command: Command = { operationId, type, target: entry?.id ?? (type === 'CreateEntry' ? crypto.randomUUID() : operationId),
    expected: entry?.revision ?? 'absent', value, confirmed };
  const item: QueueItem = { command, endpoint: connection.endpoint, binding: connection.binding, state: 'Pending locally' };
  await chrome.storage.local.set({ [queueKey(operationId)]: item });
  const result = await send(item);
  if (result.state === 'Confirmed saved') await renderWorkspace(type === 'CreateEntry' ? command.target : undefined);
}

async function renderWorkspace(selectedId?: string) {
  workspace.replaceChildren();
  app.querySelector('.source-credit')?.remove();
  const page = await activePage().catch(() => undefined);
  const observation = page ? await resolveChapter(extract(page)) : undefined;
  const connection = await config();
  const pageTitle = observation?.title.replace(/\s+/g, ' ').trim() || 'Reading progress';
  const title = element('h2', pageTitle, workspace);
  title.className = 'page-title';
  title.title = pageTitle;
  const mangaDexChapter = observation && chapterId(observation.url);
  if (mangaDexChapter) {
    const credit = element('a', 'Metadata by MangaDex', workspace);
    credit.className = 'source-credit';
    credit.href = 'https://mangadex.org/';
    credit.target = '_blank';
    credit.rel = 'noopener noreferrer';
    workspace.after(credit);
    if (!observation.series) element('p', 'MangaDex chapter unavailable. Enter progress manually.', workspace).className = 'secondary-text';
  }
  const progress = input('Chapter or progress', workspace, observation?.progress ?? '');
  progress.id = 'progress-value';
  const current = element('p', '', workspace);
  current.id = 'save-guidance';
  current.setAttribute('aria-live', 'polite');
  const save = element('button', 'Save progress', workspace);
  save.type = 'button';
  save.className = 'primary';
  save.setAttribute('aria-describedby', current.id);
  save.disabled = true;

  if (!connection) {
    current.textContent = 'Connect Google Drive to save progress.';
    action('Connect Google Drive', () => chrome.runtime.openOptionsPage(), workspace).className = 'primary';
    save.hidden = true;
    return;
  }
  current.textContent = 'Loading workbook records…';
  let entries: Entry[];
  try {
    entries = await remote(connection).list();
  } catch (error) {
    current.textContent = 'Could not load workbook records. Check the connection and try again.';
    action('Try again', async () => renderWorkspace(), workspace);
    report(errorMessage(error));
    return;
  }
  const stable = observation && sourceKey(observation.series ?? observation.url);
  const mappingKey = stable && 'mapping:' + connection.endpoint + ':' + connection.binding + ':' + stable;
  const mapping: Mapping | undefined = mappingKey ? (await chrome.storage.local.get(mappingKey))[mappingKey] as Mapping | undefined : undefined;
  const match = observation && candidates(observation, entries, mapping, canonicalSeries);
  const selection = element('div', '', workspace);
  selection.className = 'record-picker';
  const filter = input('Find a title or source', selection);
  const dropdown = element('select', '', element('label', 'Workbook record', selection));
  const byValue = new Map<string, Entry>();
  const matches = new Map(match?.matches.map(candidate => [candidate.entry, candidate.evidence]));
  const ordered = [...entries].sort((a,b) => Number(matches.has(b)) - Number(matches.has(a)));
  function fillOptions(search: string, selected?: Entry) {
    dropdown.replaceChildren(new Option('Choose a record…', ''));
    dropdown.options[0]!.disabled = true;
    byValue.clear();
    ordered.forEach((entry, index) => {
      if (search && ![entry.title, ...entry.sources].some(value => titleKey(value).includes(search))) return;
      const key = String(index);
      const title = aliases(entry.title)[0] || '(Untitled)';
      const evidence = matches.get(entry);
      const option = new Option([title, entry.sheet, evidence, entry.sources.find(Boolean), entry.id ? entry.id.slice(0, 8) : 'read only'].filter(Boolean).join(' · '), key);
      option.disabled = !entry.id;
      dropdown.add(option);
      byValue.set(key, entry);
    });
    dropdown.value = [...byValue].find(([, entry]) => entry === selected)?.[0] ?? '';
  }
  fillOptions('', selectedId ? entries.find(entry => entry.id === selectedId) : match?.verified);
  const target = () => {
    const entry = byValue.get(dropdown.value);
    if (!entry?.id) throw new Error('Choose an enrolled workbook record.');
    return entry;
  };
  const changeRecord = action('Change record', async () => {
    selection.hidden = !selection.hidden;
    if (!selection.hidden) dropdown.focus();
  }, workspace);
  changeRecord.className = 'text-button';
  selection.hidden = !!match?.verified || !!selectedId;
  changeRecord.hidden = !selection.hidden;
  const series = observation?.series;
  const seriesClaimed = series && entries.some(record =>
    record.sources.some(url => canonicalSeries(url) === series || sourceKey(url) === series));
  const linkSite = action('Link this site', async () => {
    const entry = target();
    if (!series || seriesClaimed || entry.sources[1]) return;
    const name = aliases(entry.title)[0] || '(Untitled)';
    const host = new URL(series).hostname;
    if (window.confirm('Link ' + host + ' to ' + name + ' as a backup source?')) {
      await submit(connection, 'LinkExistingEntry', entry, series, true);
    }
  }, workspace);
  linkSite.className = 'text-button';
  let saving = false;
  function showCurrent() {
    const entry = byValue.get(dropdown.value);
    const missingProgress = !progress.value.trim();
    save.disabled = saving || entry?.sheet !== 'reading' || missingProgress;
    linkSite.hidden = !series || !!seriesClaimed || !entry || !!entry.sources[1];
    if (!entry) {
      current.textContent = ordered.some(record => record.id && record.sheet === 'reading')
        ? 'Choose the matching reading record below.'
        : 'Create a reading record or enroll an existing one to save progress.';
    } else if (entry.sheet === 'todos') {
      current.textContent = 'This is a to-do record. Select a reading record to save progress.';
    } else {
      const title = aliases(entry.title)[0] || '(Untitled)';
      current.replaceChildren();
      if (title !== pageTitle) {
        const label = element('span', title, current);
        label.className = 'record-title';
        label.title = title;
      }
      element('span', missingProgress ? 'Enter progress to save.' : 'Saved: ' + (entry.progress ?? '—'), current);
    }
  }
  save.addEventListener('click', async () => {
    if (app.dataset.busy) return;
    app.dataset.busy = 'true';
    saving = true;
    save.disabled = true;
    try {
      const entry = target();
      if (observation && (await activePage()).url !== observation.url) throw new Error('The page changed. Reopen StoryCursor.');
      const value = progress.value;
      if (!value.trim()) throw new Error('Enter progress.');
      if (entry !== match?.verified && !window.confirm('Save progress to ' + (entry.title || '(Untitled)') + '?')) return;
      const previous = entry.progress;
      const before = previous === undefined ? undefined : parseProgress(previous);
      const after = parseProgress(value);
      const needsApproval = previous !== undefined && previous !== '' && previous !== value &&
        (before?.kind !== 'ordinal' || after.kind !== 'ordinal' || after.value <= before.value);
      if (needsApproval && !window.confirm('Replace ' + previous + ' with ' + value + '?')) return;
      await submit(connection, 'SetProgress', entry, value, needsApproval);
    } catch (error) {
      report(errorMessage(error));
    } finally {
      saving = false;
      delete app.dataset.busy;
      showCurrent();
    }
  });
  progress.addEventListener('input', showCurrent);
  dropdown.addEventListener('change', showCurrent);
  filter.addEventListener('input', () => {
    fillOptions(titleKey(filter.value), byValue.get(dropdown.value));
    showCurrent();
  });
  showCurrent();

  const more = element('details', '', workspace);
  element('summary', 'Record actions', more);
  const value = input('Title, alias or source URL', more);
  action('Create manga', async () => {
    const title = value.value || observation?.title || '';
    if (entries.some(entry => aliases(entry.title).some(alias => titleKey(alias) === titleKey(title))) &&
      !window.confirm('An existing record has this title. Create a separate record?')) return;
    await submit(connection, 'CreateEntry', undefined, title);
  }, more);
  action('Add alias', async () => submit(connection, 'AppendAlias', target(), value.value), more);
  action('Set primary source', async () => submit(connection, 'SetPrimarySource', target(), value.value || stable || ''), more);
  action('Add backup source', async () => submit(connection, 'AddSource', target(), value.value || stable || ''), more);
  action('Link another website', async () => submit(connection, 'LinkExistingEntry', target(), value.value || stable || ''), more);
  for (const slot of ['primary', 'secondary']) action('Remove ' + slot, async () => {
    if (window.confirm('Remove the ' + slot + ' source?')) await submit(connection, 'RemoveSource', target(), slot, true);
  }, more);
  action('Remember this page or series', async () => {
    if (!mappingKey || !stable) throw new Error('No eligible source URL.');
    const entry = target();
    if (window.confirm('Remember this source for ' + (entry.title || '(Untitled)') + '?')) {
      await chrome.storage.local.set({ [mappingKey]: { source: stable, id: entry.id } satisfies Mapping });
      report('Mapping saved on this device.');
      await renderWorkspace();
    }
  }, more);
  action('Send to review', async () => {
    const payload = JSON.stringify({ title: (observation?.title || value.value).slice(0,400), source: (stable || '').slice(0,900), progress: progress.value.slice(0,400) });
    if (!observation && !value.value.trim()) throw new Error('Enter a title or open a page first.');
    await submit(connection, 'QueueForReview', undefined, payload);
  }, more);
}

await Promise.all([renderQueue(), renderWorkspace()]).catch(error => report(errorMessage(error)));
