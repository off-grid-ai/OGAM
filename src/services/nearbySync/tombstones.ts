import { sha256 } from 'js-sha256';

export type SyncKind = 'projects' | 'conversations' | 'agents' | 'recordings';
const KINDS: SyncKind[] = ['projects', 'conversations', 'agents', 'recordings'];
export type Tombstones = Record<SyncKind, Record<string, number>>;
export const emptyTombstones = (): Tombstones => ({
  projects: {}, conversations: {}, agents: {}, recordings: {},
});
const goodId = (id: string) => /^[a-zA-Z0-9_.-]{1,160}$/.test(id);
const protectedItem = (record: { pinVerifier?: string; protectedBlob?: string; isPrivate?: boolean }) =>
  Boolean(record.pinVerifier || record.protectedBlob || record.isPrivate);
/** A locked chat or project (it has its own PIN). Its id is recorded when it is deleted, like any other item's. */
const isLocked = (record: { pinVerifier?: string; isPrivate?: boolean }) => Boolean(record.pinVerifier) && !record.isPrivate;
const timestamp = (value: string) => Number.isFinite(Date.parse(value)) ? Date.parse(value) : 0;

export function validateTombstones(value: unknown): Tombstones {
  if (value === undefined) return emptyTombstones();
  if (!value || typeof value !== 'object') throw new Error('Invalid deleted-items ledger');
  const raw = value as Record<string, unknown>;
  const result = emptyTombstones();
  for (const kind of KINDS) {
    const part = raw[kind];
    // Phones on an older Atlas do not send recordings yet.
    if (part === undefined && kind === 'recordings') continue;
    if (!part || typeof part !== 'object' || Array.isArray(part)) throw new Error(`Invalid deletions for ${  kind}`);
    const rows = Object.entries(part);
    if (rows.length > 25000) throw new Error('Too many deleted items in sync');
    for (const [id, at] of rows) {
      if (!goodId(id) || typeof at !== 'number' || !Number.isFinite(at) ||
          at < 1 || at > Date.now() + 86_400_000) throw new Error('Invalid deletion entry');
      result[kind][id] = at;
    }
  }
  return result;
}
export function combineTombstones(a: Tombstones, b: Tombstones): Tombstones {
  const result = emptyTombstones();
  for (const kind of KINDS) {
    result[kind] = { ...a[kind] };
    for (const [id, at] of Object.entries(b[kind] ?? {})) {
      result[kind][id] = Math.max(at, result[kind][id] ?? 0);
    }
  }
  return result;
}
/**
 * Track deliberate removals. Temporary private chats are never recorded. A locked chat or project is:
 * its id alone says nothing about its content, and without it a deleted locked item comes back
 * from the other phone's copy on the next sync.
 */
export function captureRemovals<T extends { id: string; pinVerifier?: string; protectedBlob?: string; isPrivate?: boolean }>(
  previous: T[], next: T[], options: { current: Tombstones; kind: SyncKind; now?: number },
): Tombstones {
  const { current, kind, now = Date.now() } = options;
  const kept = new Set(next.map(v => v.id));
  const changes = { ...current[kind] };
  for (const record of previous) {
    if (!kept.has(record.id) && (!protectedItem(record) || isLocked(record)) && goodId(record.id))
      changes[record.id] = Math.max(changes[record.id] ?? 0, now);
  }
  return { ...current, [kind]: changes };
}
/** Delete wins by ID. Later edits receive a separate recovered copy. */
export function applyTombstones<T extends { id: string; updatedAt: string; name?: string; title?: string;
  pinVerifier?: string; protectedBlob?: string; isPrivate?: boolean }>(
  records: T[], deleted: Record<string, number>,
): T[] {
  const output: T[] = [];
  for (const item of records) {
    const at = deleted[item.id];
    // A locked item deleted on the other phone goes here too, unless it was edited after that.
    if (at && isLocked(item) && timestamp(item.updatedAt) <= at) continue;
    if (!at || protectedItem(item)) { output.push(item); continue; }
    if (timestamp(item.updatedAt) > at) {
      const id = `${item.id  }-saved-${  sha256(JSON.stringify(item)).slice(0, 12)}`;
      if (output.some(record => record.id === id)) continue;
      const renamed = {
        ...item, id,
        ...('title' in item ? { title: `${String(item.title)  } (edited after deletion)` }
          : 'name' in item ? { name: `${String(item.name)  } (edited after deletion)` } : {}),
      };
      output.push(renamed as T);
    }
  }
  return output;
}