/**
 * Unit — the PURE serialize function + the thin AsyncStorage adapter for the queued-download persistence.
 *
 * serializeQueue is zero-IO: queue records → the serializable params[] a relaunch replays. It must strip
 * the runtime-only promise/resolve/reject (keeping ONLY params) and drop any sidecar (never queued). The
 * adapter round-trips through the in-memory AsyncStorage fake (jest.setup), and load() tolerates absence
 * and corruption without throwing.
 */
import {
  serializeQueue,
  saveQueuedDownloads,
  loadQueuedDownloads,
} from '../../../src/services/queuedDownloadPersistence';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { DownloadParams } from '../../../src/services/backgroundDownloadTypes';

const params = (over: Partial<DownloadParams> = {}): DownloadParams => ({
  url: 'https://example.com/m.gguf',
  fileName: 'm.gguf',
  modelId: 'org/m',
  modelKey: 'org/m/m.gguf',
  modelType: 'text',
  totalBytes: 1000,
  ...over,
});

const KEY = '@offgrid/queued_downloads';

describe('serializeQueue (pure)', () => {
  it('projects a queue record to JUST its params (drops promise/resolve/reject)', () => {
    const p = params();
    const queue = [
      { params: p, key: 'k', promise: Promise.resolve(), resolve: () => {}, reject: () => {} },
    ];
    expect(serializeQueue(queue as never)).toEqual([p]);
  });

  it('preserves FIFO order across multiple queued items', () => {
    const a = params({ modelKey: 'org/a/a.gguf', fileName: 'a.gguf' });
    const b = params({ modelKey: 'org/b/b.gguf', fileName: 'b.gguf' });
    const out = serializeQueue([{ params: a }, { params: b }] as never);
    expect(out.map((p) => p.modelKey)).toEqual(['org/a/a.gguf', 'org/b/b.gguf']);
  });

  it('drops a sidecar entry (a sidecar is never admission-controlled / queued)', () => {
    const main = params();
    const sidecar = params({ modelKey: 'org/m/mmproj.gguf', fileName: 'mmproj.gguf', isSidecar: true });
    expect(serializeQueue([{ params: main }, { params: sidecar }] as never)).toEqual([main]);
  });

  it('returns [] for an empty queue', () => {
    expect(serializeQueue([])).toEqual([]);
  });
});

describe('saveQueuedDownloads / loadQueuedDownloads (adapter)', () => {
  it('round-trips params through storage', async () => {
    const p = [params()];
    await saveQueuedDownloads(p);
    expect(await loadQueuedDownloads()).toEqual(p);
  });

  it('REMOVES the key when saving an empty list (no stale queue lingers)', async () => {
    await saveQueuedDownloads([params()]);
    await saveQueuedDownloads([]);
    expect(await AsyncStorage.getItem(KEY)).toBeNull();
    expect(await loadQueuedDownloads()).toEqual([]);
  });

  it('load returns [] when nothing is persisted', async () => {
    expect(await loadQueuedDownloads()).toEqual([]);
  });

  it('load returns [] on a corrupt (non-JSON) payload', async () => {
    await AsyncStorage.setItem(KEY, 'not json{');
    expect(await loadQueuedDownloads()).toEqual([]);
  });

  it('load returns [] when the persisted payload is not an array', async () => {
    await AsyncStorage.setItem(KEY, JSON.stringify({ not: 'an array' }));
    expect(await loadQueuedDownloads()).toEqual([]);
  });

  it('save swallows a storage failure (fire-and-forget, never throws)', async () => {
    const spy = jest.spyOn(AsyncStorage, 'setItem').mockRejectedValueOnce(new Error('disk full'));
    await expect(saveQueuedDownloads([params()])).resolves.toBeUndefined();
    spy.mockRestore();
  });

  it('load swallows a storage read failure and returns []', async () => {
    const spy = jest.spyOn(AsyncStorage, 'getItem').mockRejectedValueOnce(new Error('read fail'));
    expect(await loadQueuedDownloads()).toEqual([]);
    spy.mockRestore();
  });

  it('save swallows a removeItem failure on the empty path', async () => {
    const spy = jest.spyOn(AsyncStorage, 'removeItem').mockRejectedValueOnce(new Error('rm fail'));
    await expect(saveQueuedDownloads([])).resolves.toBeUndefined();
    spy.mockRestore();
  });

  it('save swallows a NON-Error rejection (String(e) branch)', async () => {
    const spy = jest.spyOn(AsyncStorage, 'setItem').mockRejectedValueOnce('a string, not an Error');
    await expect(saveQueuedDownloads([params()])).resolves.toBeUndefined();
    spy.mockRestore();
  });

  it('load swallows a NON-Error rejection and returns [] (String(e) branch)', async () => {
    const spy = jest.spyOn(AsyncStorage, 'getItem').mockRejectedValueOnce('a string, not an Error');
    expect(await loadQueuedDownloads()).toEqual([]);
    spy.mockRestore();
  });
});
