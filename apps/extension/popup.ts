import { captureNewManga } from './debug-storage';
import { activePage } from './browser';
import { canonicalSeries, extract } from '../../packages/site-adapters/extract';
import { chapterId, chapterSource, resolveChapter } from '../../packages/site-adapters/mangadex';
import { aliases, candidates, parseProgress, sourceKey, titleKey, type Entry, type Mapping, type Observation } from '../../packages/core/domain';
import type { Command, CommandName, MangaStart } from '../../packages/core/commands';
import { config, queue, queueKey, remote, sourceMappingKey, type Config, type QueueItem } from './sync';

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
    if (item.state === 'Confirmed saved' && !['CreateEntry','CreateManga','QueueForReview'].includes(item.command.type)) {
      action('Restore', async () => {
        const connection = await config();
        if (!connection || item.endpoint !== connection.endpoint || item.binding !== connection.binding) throw new Error('Connect to the original service.');
        const entry = (await remote(connection).list()).find(record => record.id === item.command.target);
        if (!entry) throw new Error('Record no longer available.');
        if (window.confirm('Restore the fields changed by this operation?')) {
          await submit(connection, 'RestoreChange', entry, item.command.operationId, { confirmed: true });
        }
      }, line);
    }
  }
}

async function submit(connection: Config, type: CommandName, entry: Entry | undefined, value: string,
  { confirmed, initial, debugUrl, rememberSeries }: { confirmed?: boolean; initial?: MangaStart; debugUrl?: string; rememberSeries?: string } = {}) {
  const operationId = crypto.randomUUID();
  const creating = type === 'CreateEntry' || type === 'CreateManga';
  const command: Command = { operationId, type, target: entry?.id ?? (creating ? crypto.randomUUID() : operationId),
    expected: entry?.revision ?? 'absent', value, confirmed, initial };
  const item: QueueItem = { command, endpoint: connection.endpoint, binding: connection.binding, state: 'Pending locally', rememberSeries };
  if (STORYCURSOR_DEBUG && type === 'CreateManga' && debugUrl) {
    await captureNewManga(operationId, debugUrl).catch(() => {});
  }
  await chrome.storage.local.set({ [queueKey(operationId)]: item });
  const result = await send(item);
  if (result.state === 'Confirmed saved') await renderWorkspace(creating ? command.target : undefined);
}

async function renderWorkspace(selectedId?: string) {
  workspace.replaceChildren();
  app.querySelector('.source-credit')?.remove();
  const page = await activePage().catch(() => undefined);
  const observation = page ? await resolveChapter(extract(page)) : undefined;
  const connection = await config();
  const pageTitle = readerTitle(observation);
  const title = element('h2', pageTitle || 'Reading progress', workspace);
  title.className = 'page-title';
  title.title = title.textContent ?? '';
  const chapter = element('p', '', workspace);
  chapter.className = 'chapter-summary';
  const showChapter = (value?: string) => {
    chapter.classList.toggle('unavailable', !value);
    chapter.textContent = value ? (parseProgress(value).kind === 'ordinal' ? 'Chapter ' + value : value) : 'Chapter unavailable';
  };
  showChapter(observation?.progress);
  if (observation && chapterId(observation.url)) {
    const credit = element('a', 'Metadata by MangaDex', workspace);
    credit.className = 'source-credit';
    credit.href = 'https://mangadex.org/';
    credit.target = '_blank';
    credit.rel = 'noopener noreferrer';
    workspace.after(credit);
  }
  const guidance = element('p', '', workspace);
  guidance.id = 'save-guidance';
  guidance.setAttribute('aria-live', 'polite');

  if (!connection) {
    action('Connect Google Drive', () => chrome.runtime.openOptionsPage(), workspace).className = 'primary';
    return;
  }
  guidance.textContent = 'Loading records…';
  let entries: Entry[];
  try {
    entries = await remote(connection).list();
  } catch {
    guidance.textContent = 'Could not load workbook records.';
    action('Try again', async () => renderWorkspace(), workspace).className = 'primary';
    return;
  }

  const series = observation?.series;
  const exactChapter = observation && chapterSource(observation.url);
  const stable = observation && sourceKey(series ?? observation.url);
  const mappingKey = stable && sourceMappingKey(connection, stable);
  const mapping: Mapping | undefined = mappingKey ? (await chrome.storage.local.get(mappingKey))[mappingKey] as Mapping | undefined : undefined;
  const match = observation && candidates({ ...observation, title: pageTitle }, entries, mapping, canonicalSeries, exactChapter);
  const sourceClaimed = entries.some(record => record.sources.some(url =>
    (!!series && canonicalSeries(url) === series) || (!!exactChapter && sourceKey(url) === exactChapter)));
  const evidence = new Map(match?.matches.map(({ entry, evidence }) => [entry, evidence === 'source' ? 3 : evidence === 'title' ? 2 : 1]));
  const ordered = [...entries].sort((a,b) => (evidence.get(b) ?? 0) - (evidence.get(a) ?? 0));
  const soleMatch = match?.matches.length === 1 ? match.matches[0] : undefined;
  const suggestion = !sourceClaimed && soleMatch?.evidence === 'title' && soleMatch.entry.sheet === 'reading' &&
    soleMatch.entry.id ? soleMatch.entry : undefined;

  async function verifyPage() {
    if (observation && (await activePage()).url !== observation.url) {
      throw new Error('The page changed. Reopen StoryCursor.');
    }
  }

  const selected = selectedId ? entries.find(entry => entry.id === selectedId) : match?.verified;
  const selectedTitle = () => newTitle.value.trim();
  const chapterValue = () => progress.value.trim();
  const selectedEntry = () => byValue.get(dropdown.value);
  const hasReadingRecords = entries.some(entry => entry.sheet === 'reading' && entry.id);
  const canUpdate = () => hasReadingRecords && !!chapterValue();
  const pageTitleUnchanged = () => titleKey(selectedTitle()) === titleKey(pageTitle);
  const prefersUpdate = () => canUpdate() && (sourceClaimed || (pageTitleUnchanged() && evidence.size > 0) || !selectedTitle());
  const proposedEntry = () => quickPicker.hidden && !selectedEntry() && prefersUpdate() && pageTitleUnchanged() ? suggestion : undefined;
  const upToDate = (entry: Entry) => !!chapterValue() && String(entry.progress ?? '') === chapterValue();
  const canRemember = (entry: Entry) => (!quickPicker.hidden || entry === proposedEntry()) && entry !== match?.verified &&
    !!series && !!mappingKey && !mapping && !sourceClaimed;
  function target() {
    const entry = selectedEntry();
    if (!entry?.id) throw new Error('Choose a workbook record.');
    return entry;
  }

  const addManga = async () => {
    await verifyPage();
    const name = selectedTitle();
    const duplicate = entries.some(record => aliases(record.title).some(alias => titleKey(alias) === titleKey(name)));
    if (duplicate && !window.confirm('A record already uses this title. Add a separate manga?')) return;
    await submit(connection, 'CreateManga', undefined, name, {
      confirmed: duplicate, initial: { source: series ?? exactChapter, progress: chapterValue() || undefined }, debugUrl: observation?.url,
    });
  };

  async function remember(entry: Entry) {
    if (!mappingKey || !stable) throw new Error('No eligible source URL.');
    await chrome.storage.local.set({ [mappingKey]: { source: stable, id: entry.id } satisfies Mapping });
  }

  const updateProgress = async (entry: Entry) => {
    await verifyPage();
    const value = chapterValue();
    const name = aliases(entry.title)[0] || '(Untitled)';
    const rememberSeries = canRemember(entry);
    if (upToDate(entry) && rememberSeries) {
      if (!window.confirm('Remember this series for ' + name + ' on this device?')) return;
      await remember(entry);
      report('Series remembered on this device.');
      await renderWorkspace();
      return;
    }
    const previous = entry.progress;
    const before = previous === undefined ? undefined : parseProgress(previous);
    const after = parseProgress(value);
    const needsApproval = previous !== undefined && previous !== '' && previous !== value &&
      (before?.kind !== 'ordinal' || after.kind !== 'ordinal' || after.value <= before.value);
    if (entry !== match?.verified || needsApproval) {
      const confirmation = needsApproval ? 'Replace saved progress for ' + name + ' from ' + previous + ' to ' + value :
        'Update ' + name + ' to ' + value;
      if (!window.confirm(confirmation + (rememberSeries ? ' and remember this series on this device?' : '?'))) return;
    }
    await submit(connection, 'SetProgress', entry, value, {
      confirmed: needsApproval, rememberSeries: rememberSeries ? series : undefined,
    });
  };

  const quickPicker = element('section', '', workspace);
  quickPicker.className = 'quick-picker';
  quickPicker.hidden = true;
  const quickSearch = details('Search records', quickPicker);
  const primary = action('', async () => {
    const entry = selectedEntry() ?? proposedEntry();
    if (entry) await updateProgress(entry);
    else if (prefersUpdate()) togglePicker(true);
    else await addManga();
  }, workspace);
  primary.className = 'primary';
  primary.setAttribute('aria-describedby', guidance.id);
  const choices = element('div', '', workspace);
  choices.className = 'save-choices';
  const alternate = action('', async () => {
    if (!quickPicker.hidden) togglePicker(false);
    else if (prefersUpdate()) await addManga();
    else togglePicker(true);
  }, choices);
  const choose = action('Choose a different manga', async () => togglePicker(true), choices);

  const more = details('Record actions', workspace);
  more.className = 'record-actions';
  const form = element('div', '', more);
  form.className = 'record-tools';
  const filter = input('Find a record', form);
  filter.type = 'search';
  const recordLabel = element('label', 'Workbook record', form);
  const dropdown = element('select', '', recordLabel);
  const filterLabel = filter.parentElement!;
  const byValue = new Map<string, Entry>();
  function fillRecords(search: string, current?: Entry) {
    dropdown.replaceChildren(new Option(quickPicker.hidden ? 'New manga' : 'Choose a manga…', ''));
    byValue.clear();
    ordered.forEach((entry, index) => {
      const name = aliases(entry.title)[0] || '(Untitled)';
      const source = entry.sources.find(Boolean);
      if (entry !== current && search && ![entry.title, ...entry.sources].some(value => titleKey(value).includes(search))) return;
      const key = String(index);
      const saved = entry.progress === undefined || entry.progress === '' ? '' : 'saved ' + entry.progress;
      const option = new Option([name, entry.sheet, saved, source].filter(Boolean).join(' · '), key);
      option.disabled = !entry.id || (!quickPicker.hidden && entry.sheet !== 'reading');
      dropdown.add(option);
      byValue.set(key, entry);
    });
    dropdown.value = [...byValue].find(([, entry]) => entry === current)?.[0] ?? '';
  }
  function togglePicker(open: boolean) {
    quickPicker.hidden = !open;
    if (open) {
      more.open = false;
      quickPicker.prepend(recordLabel);
      quickSearch.append(filterLabel);
    } else {
      quickSearch.open = false;
      form.prepend(filterLabel, recordLabel);
    }
    filter.value = '';
    fillRecords('');
    refresh();
    (open ? dropdown : !choose.hidden ? choose : prefersUpdate() ? primary : alternate).focus();
  }
  fillRecords('', selected);
  const newTitle = input('Manga title', form, pageTitle);
  const progress = input('Chapter or progress', form, observation?.progress ?? '');
  progress.id = 'progress-value';

  const shortcuts: {
    name: string; label: string; placeholder?: string; run: (value: string) => Promise<void>;
  }[] = [
    { name:'link', label:'Link this site', run: async () => {
      const entry = target();
      if (!series || sourceClaimed || entry.sources[1]) throw new Error('No free backup slot for this site.');
      await verifyPage();
      const name = aliases(entry.title)[0] || '(Untitled)';
      if (window.confirm('Link ' + new URL(series).hostname + ' to ' + name + '?')) {
        await submit(connection, 'LinkExistingEntry', entry, series, { confirmed: true });
      }
    } },
    { name:'alias', label:'Add alternate title', placeholder:'Alternate title',
      run: async value => submit(connection, 'AppendAlias', target(), value) },
    { name:'primary', label:'Change primary source', placeholder:'Website URL',
      run: async value => submit(connection, 'SetPrimarySource', target(), value || stable || '') },
    { name:'backup', label:'Add backup source', placeholder:'Website URL',
      run: async value => submit(connection, 'AddSource', target(), value || stable || '') },
    { name:'unlinkPrimary', label:'Remove primary source', run: async () => {
      if (window.confirm('Remove the primary source?')) await submit(connection, 'RemoveSource', target(), 'primary', { confirmed: true });
    } },
    { name:'unlinkBackup', label:'Remove backup source', run: async () => {
      if (window.confirm('Remove the backup source?')) await submit(connection, 'RemoveSource', target(), 'secondary', { confirmed: true });
    } },
    { name:'remember', label:'Remember this page or series', run: async () => {
      const entry = target();
      if (window.confirm('Remember this source for ' + (entry.title || '(Untitled)') + '?')) {
        await remember(entry);
        report('Mapping saved on this device.');
        await renderWorkspace();
      }
    } },
    { name:'review', label:'Send to review', run: async () => {
      const payload = JSON.stringify({ title: selectedTitle().slice(0,400), source: (stable || '').slice(0,900), progress: chapterValue().slice(0,400) });
      if (!selectedTitle()) throw new Error('Open a reading page or enter a manga title.');
      await submit(connection, 'QueueForReview', undefined, payload);
    } },
  ];
  const tools = element('div', '', form);
  tools.className = 'record-tools';
  const operation = element('select', '', element('label', 'Manage record', tools));
  operation.add(new Option('Choose an action…', ''));
  for (const shortcut of shortcuts) operation.add(new Option(shortcut.label, shortcut.name));
  const detail = input('Details', tools);
  const detailLabel = detail.parentElement!;
  const applyAction = action('Apply', async () => {
    const selected = shortcuts.find(option => option.name === operation.value);
    if (selected) await selected.run(detail.value.trim());
  }, tools);
  function showTool() {
    const selected = shortcuts.find(option => option.name === operation.value);
    detailLabel.hidden = !selected?.placeholder;
    detail.placeholder = selected?.placeholder ?? '';
    detail.setAttribute('aria-label', selected?.placeholder ?? 'Details');
    applyAction.hidden = !selected;
  }

  function refresh() {
    const entry = selectedEntry();
    const value = chapterValue();
    showChapter(value);
    const displayTitle = entry ? aliases(entry.title)[0] || '(Untitled)' : selectedTitle() || 'Reading progress';
    title.textContent = displayTitle;
    title.title = displayTitle;
    newTitle.parentElement!.hidden = !!entry;
    const eligible = entry?.sheet === 'reading';
    const quick = !quickPicker.hidden;
    const updateFirst = prefersUpdate();
    const proposed = proposedEntry();
    const candidate = entry ?? proposed;
    const alreadySaved = !!candidate && upToDate(candidate);
    const rememberOnly = alreadySaved && canRemember(candidate);
    const updateLabel = parseProgress(value).kind === 'ordinal' ? 'Update to chapter ' + value : 'Update progress';
    primary.hidden = quick && !entry;
    primary.textContent = candidate ? rememberOnly ? 'Remember this series' : alreadySaved ? 'Chapter saved' : updateLabel :
      updateFirst ? 'Update existing' : 'Add manga';
    primary.disabled = candidate ? candidate.sheet !== 'reading' || !value || (alreadySaved && !rememberOnly) :
      !updateFirst && (!selectedTitle() || sourceClaimed);
    alternate.hidden = !quick && (!!entry || !canUpdate() || (updateFirst && (!selectedTitle() || sourceClaimed)));
    alternate.textContent = quick ? 'Cancel' : updateFirst ? 'Add manga' : 'Update existing';
    choose.hidden = !proposed;
    choices.hidden = alternate.hidden && choose.hidden;
    if (entry) {
      guidance.textContent = !eligible ? 'Choose a reading record to save progress.' :
        !value ? 'Enter a chapter under Record actions.' :
        !alreadySaved && entry.progress !== undefined ? 'Saved: ' + entry.progress : '';
    } else if (proposed) {
      const name = aliases(proposed.title)[0] || '(Untitled)';
      guidance.textContent = 'Suggested: ' + name + (proposed.progress === undefined || proposed.progress === '' ? '' : ' · Saved: ' + proposed.progress);
    } else {
      guidance.textContent = !selectedTitle() && !canUpdate() ? 'Open a manga page or enter a title.' : '';
    }
    const link = Array.from(operation.options).find(option => option.value === 'link')!;
    link.disabled = !entry || !series || sourceClaimed || !!entry.sources[1];
    for (const option of Array.from(operation.options)) {
      if (option.value && option.value !== 'review' && option.value !== 'link') option.disabled = !entry;
    }
    if (operation.selectedOptions[0]?.disabled) operation.value = '';
    showTool();
  }
  dropdown.addEventListener('change', refresh);
  filter.addEventListener('input', () => { fillRecords(titleKey(filter.value), selectedEntry()); refresh(); });
  newTitle.addEventListener('input', refresh);
  progress.addEventListener('input', refresh);
  operation.addEventListener('change', () => { detail.value = ''; showTool(); });
  refresh();
}

function readerTitle(observation: Observation | undefined) {
  const title = observation?.title.replace(/\s+/g, ' ').trim() ?? '';
  if (!observation) return title;
  if (chapterId(observation.url) || observation.series?.startsWith('https://mangadex.org/')) {
    return title.replace(/^(?:\d+\s*\|\s*)?Chapter\s+\d+(?:\.\d+)?\s*[-–|:]\s*/i, '')
      .replace(/\s+[-–|]\s+MangaDex$/i, '').trim();
  }
  return title;
}

await Promise.all([renderQueue(), renderWorkspace()]).catch(error => report(errorMessage(error)));
