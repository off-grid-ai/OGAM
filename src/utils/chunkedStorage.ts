import AsyncStorage from '@react-native-async-storage/async-storage';
import { open } from '@op-engineering/op-sqlite';
import { Platform } from 'react-native';
import type { StateStorage } from 'zustand/middleware';

/** The AsyncStorage calls a chunked value needs; the multi-key calls run as one transaction on Android. */
export interface ChunkStore {
  getItem(key: string): Promise<string | null>;
  multiGet(keys: readonly string[]): Promise<readonly (readonly [string, string | null])[]>;
  multiSet(pairs: [string, string][]): Promise<void>;
  multiRemove(keys: readonly string[]): Promise<void>;
}

/** Reads a saved value that is too large for the store's own read (see `readOversizedRow`). */
export type OversizedReader = (key: string) => Promise<string | null>;

const MANIFEST = 'offgrid-chunked:v1:';
// Android reads each AsyncStorage row through a ~2 MB cursor window. SQLite stores text as UTF-8, at
// most 3 bytes per UTF-16 unit, so 256K units stay under 1 MB.
const CHUNK_UNITS = 256 * 1024;

const chunkKey = (name: string, index: number): string => `${name}::chunk:${index}`;

function split(value: string): string[] {
  const chunks: string[] = [];
  let start = 0;
  while (start < value.length) {
    let end = Math.min(start + CHUNK_UNITS, value.length);
    // Never part a surrogate pair: a lone half does not survive the trip through native storage.
    const last = value.charCodeAt(end - 1);
    if (end < value.length && last >= 0xd800 && last <= 0xdbff) end -= 1;
    chunks.push(value.slice(start, end));
    start = end;
  }
  return chunks;
}

/**
 * Persist one large value as several rows, so a phone can read back what it saved.
 *
 * The chat store is one JSON value. On Android a row over the cursor window is written but can never be
 * read again, so a long history vanished at launch and sync rebuilt it from the op-log every time. The
 * value's own key holds a manifest; the parts sit beside it. A value saved by an older build is read as
 * before, and `readOversized` recovers one that already outgrew the window.
 */
export function createChunkedStorage(
  base: ChunkStore = AsyncStorage,
  readOversized?: OversizedReader,
): StateStorage {
  // Parts written last per key, so a shorter value removes the ones it no longer uses.
  const partCounts = new Map<string, number>();

  return {
    getItem: async name => {
      let head: string | null;
      try {
        head = await base.getItem(name);
      } catch (error) {
        if (!readOversized) throw error;
        head = await readOversized(name);
        if (head === null) throw error;
      }
      if (head === null || !head.startsWith(MANIFEST)) {
        partCounts.set(name, 0);
        return head;
      }
      const count = Number(head.slice(MANIFEST.length));
      if (!Number.isInteger(count) || count < 0) {
        throw new Error(`${name}: the saved manifest is unreadable`);
      }
      const pairs = await base.multiGet(
        Array.from({ length: count }, (_, index) => chunkKey(name, index)),
      );
      const parts = pairs.map(([, value]) => value);
      if (parts.some(part => part === null)) {
        throw new Error(`${name}: part of the saved value is missing`);
      }
      partCounts.set(name, count);
      return parts.join('');
    },
    setItem: async (name, value) => {
      const parts = split(value);
      const previous = partCounts.get(name) ?? 0;
      partCounts.set(name, parts.length);
      const stale = Array.from(
        { length: Math.max(0, previous - parts.length) },
        (_, index) => chunkKey(name, parts.length + index),
      );
      // Parts and manifest commit together. Both calls are issued before either is awaited, so the
      // native queue runs them in order ahead of any later write's parts.
      const written = base.multiSet([
        ...parts.map((part, index): [string, string] => [chunkKey(name, index), part]),
        [name, `${MANIFEST}${parts.length}`],
      ]);
      const removed = stale.length ? base.multiRemove(stale) : Promise.resolve();
      await Promise.all([written, removed]);
    },
    removeItem: async name => {
      const count = partCounts.get(name) ?? 0;
      partCounts.set(name, 0);
      await base.multiRemove([
        name,
        ...Array.from({ length: count }, (_, index) => chunkKey(name, index)),
      ]);
    },
  };
}

// AsyncStorage's Android database, in the app's databases folder where op-sqlite opens by name.
const ASYNC_STORAGE_DB = 'RKStorage';
const ASYNC_STORAGE_TABLE = 'catalystLocalStorage';

/**
 * Read an Android AsyncStorage row that outgrew the cursor window, in pieces through op-sqlite.
 *
 * Runs once per affected store: the next write replaces the row with a chunked value.
 */
export const readOversizedRow: OversizedReader = async key => {
  if (Platform.OS !== 'android') return null;
  const db = open({ name: ASYNC_STORAGE_DB });
  try {
    const { rows } = await db.execute(
      `SELECT length(value) AS units FROM ${ASYNC_STORAGE_TABLE} WHERE key = ?`,
      [key],
    );
    const units = rows[0]?.units;
    if (typeof units !== 'number') return null;
    const parts: string[] = [];
    // SQLite counts characters from 1 in both length() and substr().
    for (let start = 1; start <= units; start += CHUNK_UNITS) {
      const piece = await db.execute(
        `SELECT substr(value, ?, ?) AS part FROM ${ASYNC_STORAGE_TABLE} WHERE key = ?`,
        [start, CHUNK_UNITS, key],
      );
      parts.push(String(piece.rows[0]?.part ?? ''));
    }
    return parts.join('');
  } finally {
    db.close();
  }
};
