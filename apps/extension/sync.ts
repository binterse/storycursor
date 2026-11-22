import type { Command, Result, Storage } from '../../packages/core/commands';
import type { Entry } from '../../packages/core/domain';

export type FolderChoice = { id: string; name: string; label: string };
export type Config = { endpoint: string; token: string; binding?: string };
export function validConfig(config: Config) {
  return /^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(config.endpoint) &&
    /^[0-9a-f]{64}$/i.test(config.token);
}
export async function config(): Promise<Config | undefined> {
  const { connection } = await chrome.storage.local.get('connection') as { connection?: Config };
  return connection && validConfig(connection) && /^[0-9a-f]{64}$/.test(connection.binding ?? '') ? connection : undefined;
}
export function remote(connection: Config): Storage & { check(): Promise<string>; folderSetup(): Promise<FolderChoice[] | undefined>; useFolder(folder: string, name: string): Promise<void> } {
  async function request(action: string, fields?: { command?: Command; folder?: string; name?: string }) {
    if (!validConfig(connection)) throw new Error('Enter a valid deployment URL and token.');
    const response = await fetch(connection.endpoint, {
      method: 'POST', body: JSON.stringify({ action, ...fields, token: connection.token, binding: connection.binding }),
      credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer', signal: AbortSignal.timeout(25000),
    });
    if (!response.ok) throw new Error('The server could not confirm the result.');
    return await response.json();
  }
  return {
    async folderSetup() {
      const result = await request('folders');
      if (result.status === 'ready' && result.folders === null) return;
      if (result.status === 'ready' && Array.isArray(result.folders) &&
          result.folders.every((item: FolderChoice) => item && typeof item.id === 'string' &&
            typeof item.name === 'string' && typeof item.label === 'string')) return result.folders;
      if (result.status === 'failed' && ['Unknown action.', 'Workbook changed. Reconnect before continuing.'].includes(result.message)) return;
      throw new Error(result.message ?? 'Could not load Drive folders.');
    },
    async useFolder(folder, name) {
      const result = await request('useFolder', { folder, name });
      if (result.status !== 'ready') throw new Error(result.message ?? 'Could not set up the folder.');
    },
    async check() {
      const result = await request('check');
      if (result.status !== 'ready' || !/^[0-9a-f]{64}$/.test(result.binding)) throw new Error(result.message ?? 'Connection failed.');
      return result.binding;
    },
    async list() {
      const result = await request('list');
      if (result.status !== 'ready' || !Array.isArray(result.entries)) throw new Error(result.message ?? 'Could not load records.');
      return result.entries as Entry[];
    },
    async submit(command) {
      const result = await request('submit', { command });
      if (result.status === 'saved' && result.operationId === command.operationId && result.target === command.target) return result as Result;
      if (result.status === 'conflict' || result.status === 'failed') return result as Result;
      throw new Error(result.message ?? 'The server could not confirm the result.');
    },
  };
}
export type QueueItem = { command: Command; endpoint: string; binding?: string; state: 'Pending locally' | 'Submitted' | 'Confirmed saved' | 'Conflict' | 'Failed'; message?: string; uncertain?: boolean };
export const queueKey = (id: string) => 'queue:' + id;
export async function queue() {
  return Object.entries(await chrome.storage.local.get(null)).filter(([key]) => key.startsWith('queue:')).map(([, value]) => value as QueueItem);
}
