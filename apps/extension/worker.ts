import { uuid } from '../../packages/core/commands';
import { config, queueKey, remote, type QueueItem } from './sync';

const inFlight = new Map<string, Promise<QueueItem>>();
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
  await chrome.storage.local.set({ [key]: next });
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


