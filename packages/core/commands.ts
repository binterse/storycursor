import { aliasDelimiter, aliases, parseProgress, sourceKey, titleKey, type Scalar } from './domain';

export type Fields = { title: string; progress: Scalar | undefined; primary: string; secondary: string };
export type Patch = Partial<{ [Key in keyof Fields]: Fields[Key] | null }>;
export type CommandName = 'SetProgress' | 'CreateEntry' | 'AppendAlias' | 'AddSource' | 'SetPrimarySource' |
  'RemoveSource' | 'LinkExistingEntry' | 'QueueForReview' | 'RestoreChange';
export type Command = { operationId: string; type: CommandName; target: string; expected: string; value: Scalar; confirmed?: boolean };
export type Result = { status: 'saved'; operationId: string; target: string } |
  { status: 'conflict' | 'failed'; message: string };
export interface Storage {
  list(): Promise<import('./domain').Entry[]>;
  submit(command: Command): Promise<Result>;
}
export class Conflict extends Error {}
export const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const names = new Set<CommandName>(['SetProgress','CreateEntry','AppendAlias','AddSource','SetPrimarySource','RemoveSource','LinkExistingEntry','QueueForReview','RestoreChange']);

export function validateCommand(input: unknown): Command {
  if (!input || typeof input !== 'object') throw new Conflict('Invalid command.');
  const cmd = input as Command;
  if (!names.has(cmd.type) || typeof cmd.operationId !== 'string' || !uuid.test(cmd.operationId) ||
      typeof cmd.target !== 'string' || !uuid.test(cmd.target) || typeof cmd.expected !== 'string' ||
      !/^(?:absent|[0-9a-f]{64})$/.test(cmd.expected) ||
      !(typeof cmd.value === 'string' && cmd.value.length <= 2000 || typeof cmd.value === 'number' && Number.isFinite(cmd.value)) ||
      !(cmd.confirmed === undefined || typeof cmd.confirmed === 'boolean')) throw new Conflict('Invalid command.');
  return { operationId: cmd.operationId, type: cmd.type, target: cmd.target, expected: cmd.expected, value: cmd.value, confirmed: cmd.confirmed };
}

function plain(value: Scalar) {
  if (typeof value !== 'string' || !value.trim() || /[\u0000-\u001f]/.test(value)) throw new Conflict('Enter a valid value.');
  return value;
}

export function prepare(command: Command, fields: Fields, restore?: Patch): Patch {
  const value = command.value;
  switch (command.type) {
    case 'SetProgress': {
      if (typeof value === 'string') plain(value);
      const old = fields.progress;
      if (old === value) return {};
      if (old !== undefined && old !== '' && !command.confirmed) {
        const before = parseProgress(old);
        const after = parseProgress(value);
        if (before.kind !== 'ordinal' || after.kind !== 'ordinal' || after.value < before.value ||
          (after.value === before.value && old !== value)) throw new Conflict('Confirm replacing the existing progress.');
      }
      return { progress: value };
    }
    case 'CreateEntry':
      if (plain(value).includes(aliasDelimiter)) throw new Conflict('Enter a single title.');
      return { title: String(value) };
    case 'AppendAlias':
      if (plain(value).includes(aliasDelimiter)) throw new Conflict('Enter a single alias.');
      if (aliases(fields.title).some(alias => titleKey(alias) === titleKey(String(value)))) return {};
      return { title: fields.title ? fields.title + aliasDelimiter + value : String(value) };
    case 'AddSource':
    case 'LinkExistingEntry':
    case 'SetPrimarySource': {
      const source = sourceKey(plain(value));
      if (!source) throw new Conflict('Enter a valid HTTP or HTTPS source URL.');
      if (sourceKey(fields.primary) === source) return {};
      if (command.type !== 'SetPrimarySource' && sourceKey(fields.secondary) === source) return {};
      if (command.type === 'SetPrimarySource') {
        if (fields.primary && fields.secondary && sourceKey(fields.secondary) !== source) throw new Conflict('Both source slots are occupied.');
        return fields.primary || sourceKey(fields.secondary) === source
          ? { primary: source, secondary: fields.primary } : { primary: source };
      }
      if (fields.secondary) throw new Conflict('The backup source slot is occupied.');
      return { secondary: source };
    }
    case 'RemoveSource':
      if (!command.confirmed || (value !== 'primary' && value !== 'secondary')) throw new Conflict('Confirm the source slot to remove.');
      return { [value]: '' };
    case 'RestoreChange':
      if (!restore || !command.confirmed) throw new Conflict('Confirm an eligible restore.');
      return restore;
    case 'QueueForReview':
      plain(value);
      return {};
  }
}
