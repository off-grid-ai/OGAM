import AsyncStorage from '@react-native-async-storage/async-storage';
import { open } from '@op-engineering/op-sqlite';
import { Platform } from 'react-native';
import type { StateStorage } from 'zustand/middleware';
import logger from './logger';

/** The AsyncStorage calls a chunked value needs; the multi-key calls run as one transaction on Android. */
export interface ChunkStore {
  getItem(key: string): Promise<string | null>;
  multiGet(keys: readonly string[]): Promise<readonly (readonly [string, string | null])[]>;
  multiSet(pairs: [string, string][]): Promise<void>;
  multiRemove(keys: readonly string[]): Promise<void>;
  /** Lists every key, so parts a killed write left behind can be removed. */
  getAllKeys?(): Promise<readonly string[]>;
}

/** Reads a saved value that is too large for the store's own read (see `readOversizedRow`). */
export type OversizedReader = (key: string) => Promise<string | null>;

// v1: `<name>::chunk:<i>`, rewritten in place. v2: each save writes its parts under its own generation,
// `<name>::chunk:<gen>:<i>`, and only then points the manifest at them.
const MANIFEST_V1 = 'offgrid-chunked:v1:';
const MANIFEST_V2 = 'offgrid-chunked:v2:';
// Android reads each AsyncStorage row through a ~2 MB cursor window. SQLite stores text as UTF-8, at
// most 3 bytes per UTF-16 unit, so 256K units stay under 1 MB.
const CHUNK_UNITS = 256 * 1024;

const v1ChunkKey = (name: string, index: number): string => `${name}::chunk:${index}`;
const chunkKey = (name: string, gen: string, index: number): string =>
  `${name}::chunk:${gen}:${index}`;
/** Where a saved value that can no longer be read is kept, untouched, instead of being overwritten. */
export const unreadableKey = (name: string): string => `${name}::unreadable`;

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

function parseManifest(name: string, head: string): { gen?: string; keys: string[] } {
  if (head.startsWith(MANIFEST_V2)) {
    const [gen, countText] = head.slice(MANIFEST_V2.length).split(':');
    const count = Number(countText);
    if (!gen || !Number.isInteger(count) || count < 0) {
      throw new Error(`${name}: the saved manifest is unreadable`);
    }
    return { gen, keys: Array.from({ length: count }, (_, index) => chunkKey(name, gen, index)) };
  }
  const count = Number(head.slice(MANIFEST_V1.length));
  if (!Number.isInteger(count) || count < 0) {
    throw new Error(`${name}: the saved manifest is unreadable`);
  }
  return { keys: Array.from({ length: count }, (_, index) => v1ChunkKey(name, index)) };
}

function isWholeJson(value: string): boolean {
  try {
    JSON.parse(value);
    return true;
  } catch {
    return false;
  }
}

let generation = 0;
const nextGeneration = (): string => `${Date.now().toString(36)}${(generation++).toString(36)}`;

/**
 * Persist one large value as several rows, so a phone can read back what it saved.
 *
 * The chat store is one JSON value. On Android a row over the cursor window is written but can never be
 * read again, so a long history vanished at launch and sync rebuilt it from the op-log every time. The
 * value's own key holds a manifest; the parts sit beside it. A value saved by an older build is read as
 * before, and `readOversized` recovers one that already outgrew the window.
 *
 * A save never touches the parts the manifest points at. iOS writes each part as its own file, so a
 * phone that killed the app mid-save left parts of two saves under one manifest: the history could not
 * be read again, every later save was held back to protect it, and every launch rebuilt it from the
 * op-log. Each save now writes new parts and flips the manifest last, so a kill leaves the last whole
 * save in place.
 */
export function createChunkedStorage(
  base: ChunkStore = AsyncStorage,
  readOversized?: OversizedReader,
): StateStorage {
  // The parts the manifest points at, per key: removed once a later save's manifest replaces it.
  const live = new Map<string, string[]>();
  const swept = new Set<string>();

  /** Remove parts no manifest points at: a save killed before its manifest landed, or after it. */
  const sweep = async (name: string): Promise<void> => {
    if (swept.has(name) || !base.getAllKeys) return;
    swept.add(name);
    const keep = new Set(live.get(name) ?? []);
    // A value kept aside stays whole, parts and all.
    const asideHead = await base.getItem(unreadableKey(name));
    if (asideHead) {
      try {
        for (const key of parseManifest(name, asideHead).keys) keep.add(key);
      } catch {
        return;
      }
    }
    const prefix = `${name}::chunk:`;
    const orphans = (await base.getAllKeys()).filter(
      key => key.startsWith(prefix) && key.slice(prefix.length).includes(':') && !keep.has(key),
    );
    if (orphans.length) await base.multiRemove(orphans);
  };

  /** Keep a value that can't be read, parts and all, under its own key; the store starts afresh. */
  const setAside = async (name: string, head: string, reason: string): Promise<null> => {
    await base.multiSet([[unreadableKey(name), head]]);
    live.set(name, []);
    logger.warn(`[STORAGE-SM] ${name}: ${reason}; kept it aside as ${unreadableKey(name)} and saving afresh`);
    return null;
  };

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
      if (head === null || !(head.startsWith(MANIFEST_V1) || head.startsWith(MANIFEST_V2))) {
        live.set(name, []);
        return head;
      }
      const { gen, keys } = parseManifest(name, head);
      const pairs = await base.multiGet(keys);
      const parts = pairs.map(([, value]) => value);
      if (parts.some(part => part === null)) {
        return setAside(name, head, 'part of the saved value is missing');
      }
      const value = parts.join('');
      // Only a v1 save rewrote its parts in place, so only a v1 value can hold parts of two saves.
      if (!gen && !isWholeJson(value)) {
        return setAside(name, head, 'the saved value holds parts of two saves');
      }
      live.set(name, keys);
      sweep(name).catch(error => logger.warn(`[STORAGE-SM] ${name}: sweeping old parts failed:`, error));
      return value;
    },
    setItem: async (name, value) => {
      const parts = split(value);
      const gen = nextGeneration();
      const keys = parts.map((_, index) => chunkKey(name, gen, index));
      await base.multiSet(parts.map((part, index): [string, string] => [keys[index], part]));
      await base.multiSet([[name, `${MANIFEST_V2}${gen}:${parts.length}`]]);
      // Read at the flip, not at the call: a save issued meanwhile has replaced what this one saw.
      const replaced = live.get(name) ?? [];
      live.set(name, keys);
      if (replaced.length) await base.multiRemove(replaced);
    },
    removeItem: async name => {
      const keys = live.get(name) ?? [];
      live.set(name, []);
      await base.multiRemove([name, ...keys]);
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
