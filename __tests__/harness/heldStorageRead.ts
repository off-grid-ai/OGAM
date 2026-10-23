/**
 * BOUNDARY: AsyncStorage as a device store whose read can be SLOW. Data lives in one in-memory map that
 * survives `jest.resetModules()` (a relaunch), as the device disk does. `holdNextReadOf(key)` makes the
 * next read of that key wait until the test releases it — the window in which the app has booted but
 * Zustand's hydration of that store is still pending.
 *
 * Use it as the module for AsyncStorage, at the top of the test file (it is hoisted):
 *
 *   jest.mock('@react-native-async-storage/async-storage', () =>
 *     require('../../harness/heldStorageRead').heldAsyncStorageModule());
 */
type Disk = {
  data: Record<string, string>;
  holdKey: string | null;
  held: Array<() => void>;
  heldReads: number;
};

function disk(): Disk {
  const g = globalThis as unknown as { __HELD_STORAGE_DISK__?: Disk };
  g.__HELD_STORAGE_DISK__ ??= { data: {}, holdKey: null, held: [], heldReads: 0 };
  return g.__HELD_STORAGE_DISK__;
}

/** The next read of `key` waits until releaseHeldRead(). One-shot. */
export function holdNextReadOf(key: string): void {
  disk().holdKey = key;
}

/** How many reads are parked right now. */
export function heldReadCount(): number {
  return disk().held.length;
}

/** Let every parked read go on to the disk (it then reads what is stored at that moment). */
export function releaseHeldRead(): void {
  disk().held.splice(0).forEach(go => go());
}

/** Wipe the disk (a fresh install). */
export function wipeHeldStorage(): void {
  const d = disk();
  d.data = {};
  d.holdKey = null;
  d.held = [];
  d.heldReads = 0;
}

export function heldAsyncStorageModule() {
  const read = (key: string): Promise<string | null> => {
    const d = disk();
    if (d.holdKey === key) {
      d.holdKey = null;
      d.heldReads += 1;
      return new Promise(resolve => {
        d.held.push(() => resolve(disk().data[key] ?? null));
      });
    }
    return Promise.resolve(d.data[key] ?? null);
  };
  const module = {
    getItem: jest.fn(read),
    setItem: jest.fn((key: string, value: string) => {
      disk().data[key] = value;
      return Promise.resolve();
    }),
    removeItem: jest.fn((key: string) => {
      delete disk().data[key];
      return Promise.resolve();
    }),
    multiGet: jest.fn(async (keys: string[]) =>
      Promise.all(keys.map(async key => [key, await read(key)] as [string, string | null])),
    ),
    multiSet: jest.fn((pairs: [string, string][]) => {
      pairs.forEach(([key, value]) => {
        disk().data[key] = value;
      });
      return Promise.resolve();
    }),
    multiRemove: jest.fn((keys: string[]) => {
      keys.forEach(key => delete disk().data[key]);
      return Promise.resolve();
    }),
    clear: jest.fn(() => {
      disk().data = {};
      return Promise.resolve();
    }),
    getAllKeys: jest.fn(() => Promise.resolve(Object.keys(disk().data))),
  };
  return { __esModule: true, default: module, ...module };
}
