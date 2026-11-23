import { confirmDebugCapture } from './debug-storage';
import { uuid } from '../../packages/core/commands';
import type { Mapping } from '../../packages/core/domain';
import { canonicalSeries } from '../../packages/site-adapters/extract';
import { config, queueKey, remote, sourceMappingKey, type Config, type QueueItem } from './sync';

const inFlight = new Map<string, Promise<QueueItem>>();
let mappingWrites = Promise.resolve();

function persistResult(key: string, item: QueueItem, connection: Config) {
  const source = item.rememberSeries;
  if (item.state !== 'Confirmed saved' || item.command.type !== 'SetProgress' || !source || canonicalSeries(source) !== source) {
    return chrome.storage.local.set({ [key]: item });
  }
  const mappingKey = sourceMappingKey(connection, source);
  const write = mappingWrites.then(async () => {
    const existing = (await chrome.storage.local.get(mappingKey))[mappingKey] as Mapping | undefined;
    if (existing && existing.id !== item.command.target) {
      item.message = 'This series already points to another record on this device.';
      await chrome.storage.local.set({ [key]: item });
      return;
    }
    await chrome.storage.local.set({ [key]: item, [mappingKey]: { source, id: item.command.target } satisfies Mapping });
  });
  mappingWrites = write.catch(() => {});
  return write;
}

async function submit(id: string): Promise<QueueItem> {
  const key = queueKey(id);
  const item: QueueItem | undefined = (await chrome.storage.local.get(key))[key] as QueueItem | undefined;
  const connection = await config();
  if (!item || !connection || item.endpoint !== connection.endpoint || item.binding !== connection.binding) throw new Error('Connect to the original service before retrying.');
  if (item.state === 'Confirmed saved' || item.state === 'Conflict') return item;
  const submitted: QueueItem = { ...item, state: 'Submitted' };
  await chrome.storage.local.set({ [key]: submitted });
  let next: QueueItem;
  try {
    const result = await remote(connection).submit(item.command);
    next = {
      ...submitted, state: result.status === 'saved' ? 'Confirmed saved' : result.status === 'conflict' ? 'Conflict' : 'Failed',
      message: result.status === 'saved' ? undefined : result.message, uncertain: false,
    };
  } catch {
    next = { ...submitted, state: 'Failed', message: 'Result unconfirmed. Retry this operation.', uncertain: true };
  }
  if (STORYCURSOR_DEBUG && item.command.type === 'CreateManga' && next.state === 'Confirmed saved') {
    await confirmDebugCapture(id).catch(() => {});
  }
  await persistResult(key, next, connection);
  return next;
}

chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (sender.id !== chrome.runtime.id || message?.type !== 'submit' || typeof message.id !== 'string' || !uuid.test(message.id)) return;
  let task = inFlight.get(message.id);
  if (!task) {
    task = submit(message.id).finally(() => inFlight.delete(message.id));
    inFlight.set(message.id, task);
  }
  void task.then(item => reply({ item }), (error: Error) => reply({ error: error.message }));
  return true;
});
