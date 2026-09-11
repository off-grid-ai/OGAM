/**
 * The Mobile download host adapter, against a stood-in native module.
 *
 * Everything the adapter itself decides runs for real: the per-transfer listener map, the
 * `terminalOperations` handoff that makes an abort racing a completion await the SAME promise,
 * and the reconciliation projection. The ONLY things replaced are `NativeModules.DownloadManagerModule`
 * and the `NativeEventEmitter` over it - the true device boundary. Event dispatch is real
 * (`NativeEventBus`), so a listener that was never attached, or removed too early, shows up as an
 * event that goes nowhere rather than as an assertion on a spy.
 *
 * These cover the paths that had no JS coverage before pause/resume landed on this seam: an abort
 * that arrives while a completion is already moving the file, an abort before any completion, and
 * the durable-row projection the composition layer reconciles against after a process restart.
 */
import { NativeEventBus } from '../../utils/nativeEventBus';

/** The mock factory is hoisted above the fake's construction, so it reads the module through
 *  this declared slot rather than a closure the factory cannot see. */
declare global {
  var __downloadNativeFake: NativeEventBus | undefined;
}

jest.mock('react-native', () => {
  const { FakeNativeEventEmitter } = require('../../utils/nativeEventBus');
  return {
    NativeModules: { DownloadManagerModule: globalThis.__downloadNativeFake },
    NativeEventEmitter: FakeNativeEventEmitter,
    Platform: { OS: 'ios' },
  };
});

jest.mock('react-native-fs', () => ({ mkdir: jest.fn(async () => undefined) }));

const PROGRESS = 'DownloadProgress';
const COMPLETE = 'DownloadComplete';
const ERROR = 'DownloadError';

interface TransferProgress {
  bytesDownloaded: number;
  totalBytes: number;
}

interface ActiveRow {
  downloadId: string;
  status: string;
}

/** The native module: also the event source, exactly as both platforms' modules are. */
class DownloadNativeFake extends NativeEventBus {
  activeRows: ActiveRow[] = [];
  readonly stops: Array<{ transferId: string; retainPartial: boolean }> = [];
  readonly moved: Array<{ transferId: string; destination: string }> = [];
  pollingStarted = 0;
  /** Held open so a test can observe the window while the move is in flight. */
  releaseMove: (() => void) | null = null;

  startDownload = jest.fn(async () => ({ downloadId: 'transfer-1' }));

  getActiveDownloads = jest.fn(async () => this.activeRows.map(row => ({ ...row })));

  startProgressPolling = jest.fn(() => {
    this.pollingStarted += 1;
  });

  stopDownload = jest.fn(async (transferId: string, retainPartial: boolean) => {
    this.stops.push({ transferId, retainPartial });
    return 'stopped';
  });

  moveCompletedDownload = jest.fn(async (transferId: string, destination: string) => {
    this.moved.push({ transferId, destination });
    if (this.releaseMove) {
      await new Promise<void>(resolve => {
        this.releaseMove = () => resolve();
      });
    }
  });
}

let native: DownloadNativeFake;

const flush = async (): Promise<void> => {
  for (let turn = 0; turn < 8; turn += 1) await Promise.resolve();
};

type AdapterModule =
  typeof import('../../../src/services/adapters/downloads/nativeDownloadTransferAdapter');

/**
 * A fresh adapter over a fresh native module. The registry is reset first so the adapter's
 * constructor re-subscribes to THIS test's emitter rather than a previous test's.
 */
async function makeAdapter(): Promise<{
  adapter: InstanceType<AdapterModule['NativeDownloadTransferAdapter']>;
}> {
  jest.resetModules();
  globalThis.__downloadNativeFake = native;
  const module: AdapterModule = require('../../../src/services/adapters/downloads/nativeDownloadTransferAdapter');
  return { adapter: new module.NativeDownloadTransferAdapter() };
}

beforeEach(() => {
  native = new DownloadNativeFake();
  globalThis.__downloadNativeFake = native;
});

describe('the Mobile download host adapter', () => {
  describe('an abort that races a completion', () => {
    it('awaits the in-flight move instead of issuing a second native cancel', async () => {
      native.releaseMove = () => undefined; // hold the move open
      const { adapter } = await makeAdapter();
      const controller = new AbortController();

      const started = adapter.start({
        id: 'model-a',
        url: 'https://example.test/model.gguf',
        destination: '/models/model.gguf',
        signal: controller.signal,
        onProgress: () => undefined,
      } as unknown as Parameters<typeof adapter.start>[0]);

      await flush();
      // The transfer completes: ownership passes to the move, which is still running.
      native.emit(COMPLETE, { downloadId: 'transfer-1' });
      await flush();
      expect(native.moveCompletedDownload).toHaveBeenCalledTimes(1);

      // The user aborts WHILE the move is in flight.
      controller.abort();
      const stop = adapter.stop({ transferId: 'transfer-1', disposition: 'delete-partial' });

      // A second native cancel cannot make the move safer, so none is issued.
      expect(native.stops).toEqual([]);
      expect(native.stopDownload).not.toHaveBeenCalled();

      native.releaseMove?.();
      await expect(stop).resolves.toEqual({ outcome: 'completed' });
      await expect(started).resolves.toEqual({ transferId: 'transfer-1' });
      // The move still completed: bytes are not abandoned half-placed.
      expect(native.moved).toEqual([
        { transferId: 'transfer-1', destination: '/models/model.gguf' },
      ]);
    });

    it('keeps completion when the move owned the file before the stop request', async () => {
      native.releaseMove = () => undefined;
      const { adapter } = await makeAdapter();
      const controller = new AbortController();
      const started = adapter.start({
        id: 'model-a',
        url: 'https://example.test/model.gguf',
        destination: '/models/model.gguf',
        signal: controller.signal,
        onProgress: () => undefined,
      } as unknown as Parameters<typeof adapter.start>[0]);

      await flush();
      native.emit(COMPLETE, { downloadId: 'transfer-1' });
      await flush();
      controller.abort();
      await flush();
      const stop = adapter.stop({
        transferId: 'transfer-1',
        disposition: 'delete-partial',
      });
      native.releaseMove?.();

      await expect(stop).resolves.toEqual({ outcome: 'completed' });
      await expect(started).resolves.toEqual({ transferId: 'transfer-1' });
    });
  });

  describe('an abort with no completion in flight', () => {
    it('cancels natively once and rejects as cancelled', async () => {
      const { adapter } = await makeAdapter();
      const controller = new AbortController();
      const started = adapter.start({
        id: 'model-a',
        url: 'https://example.test/model.gguf',
        destination: '/models/model.gguf',
        signal: controller.signal,
        onProgress: () => undefined,
      } as unknown as Parameters<typeof adapter.start>[0]);

      await flush();
      controller.abort();
      const stop = adapter.stop({ transferId: 'transfer-1', disposition: 'retain-partial' });

      await expect(started).rejects.toMatchObject({ name: 'DownloadAbortedError' });
      await expect(stop).resolves.toEqual({ outcome: 'stopped' });
      expect(native.stops).toEqual([{ transferId: 'transfer-1', retainPartial: true }]);
      expect(native.moveCompletedDownload).not.toHaveBeenCalled();
    });

    it('deletes partial bytes only when Shared selects delete-partial', async () => {
      const { adapter } = await makeAdapter();

      await expect(adapter.stop({
        transferId: 'transfer-9',
        disposition: 'delete-partial',
      })).resolves.toEqual({ outcome: 'stopped' });

      expect(native.stops).toEqual([{ transferId: 'transfer-9', retainPartial: false }]);
    });
  });

  describe('progress from the device', () => {
    it('reports only this transfer’s bytes, never another transfer’s', async () => {
      const { adapter } = await makeAdapter();
      const seen: Array<{ bytesDownloaded: number; totalBytes: number }> = [];
      const controller = new AbortController();
      const started = adapter.start({
        id: 'model-a',
        url: 'https://example.test/model.gguf',
        destination: '/models/model.gguf',
        signal: controller.signal,
        onProgress: (progress: TransferProgress) => seen.push(progress),
      } as unknown as Parameters<typeof adapter.start>[0]);

      await flush();
      native.emit(PROGRESS, { downloadId: 'transfer-1', bytesDownloaded: 10, totalBytes: 100 });
      // A DIFFERENT transfer's progress must not be attributed to this one.
      native.emit(PROGRESS, { downloadId: 'transfer-9', bytesDownloaded: 99, totalBytes: 100 });
      await flush();

      expect(seen).toEqual([{ bytesDownloaded: 10, totalBytes: 100 }]);

      native.emit(COMPLETE, { downloadId: 'transfer-1' });
      await started;
    });

    it('stops delivering progress once the transfer has settled', async () => {
      const { adapter } = await makeAdapter();
      const seen: number[] = [];
      const controller = new AbortController();
      const started = adapter.start({
        id: 'model-a',
        url: 'https://example.test/model.gguf',
        destination: '/models/model.gguf',
        signal: controller.signal,
        onProgress: (progress: TransferProgress) => seen.push(progress.bytesDownloaded),
      } as unknown as Parameters<typeof adapter.start>[0]);

      await flush();
      native.emit(COMPLETE, { downloadId: 'transfer-1' });
      await started;

      native.emit(PROGRESS, { downloadId: 'transfer-1', bytesDownloaded: 50, totalBytes: 100 });
      await flush();
      // The listener was removed on settle; a late event goes nowhere.
      expect(seen).toEqual([]);
    });
  });

  describe('a device-reported failure', () => {
    it('rejects with the reason the device gave, not a generic one', async () => {
      const { adapter } = await makeAdapter();
      const controller = new AbortController();
      const started = adapter.start({
        id: 'model-a',
        url: 'https://example.test/model.gguf',
        destination: '/models/model.gguf',
        signal: controller.signal,
        onProgress: () => undefined,
      } as unknown as Parameters<typeof adapter.start>[0]);

      await flush();
      native.emit(ERROR, { downloadId: 'transfer-1', reason: 'Insufficient storage' });

      await expect(started).rejects.toThrow('Insufficient storage');
    });
  });

  describe('reconciling the device’s durable rows', () => {
    it('projects the native rows the composition layer reconciles after a restart', async () => {
      native.activeRows = [
        { downloadId: 'transfer-1', status: 'running' },
        { downloadId: 'transfer-2', status: 'failed' },
      ];
      const { adapter } = await makeAdapter();

      await expect(adapter.listActiveDownloads()).resolves.toEqual([
        { downloadId: 'transfer-1', status: 'running' },
        { downloadId: 'transfer-2', status: 'failed' },
      ]);
    });

    it('answers no rows rather than throwing when the device cannot enumerate them', async () => {
      const { adapter } = await makeAdapter();
      (native as unknown as { getActiveDownloads: unknown }).getActiveDownloads = undefined;

      await expect(adapter.listActiveDownloads()).resolves.toEqual([]);
    });

    it('answers false for a paused download’s stale transfer id, so it is never adopted as live', async () => {
      // A paused download keeps the transferId it had when it stopped. Shared asks
      // `hasActiveTransfer` (coordinator.ts:158-163) through this method during recovery; if the
      // host said "yes" for a transfer the device no longer holds, a download the user
      // deliberately paused would be adopted as live and resume itself. The device is the
      // authority on what is still running, and it no longer lists this one.
      native.activeRows = [{ downloadId: 'transfer-live', status: 'running' }];
      const { adapter } = await makeAdapter();

      await expect(adapter.isActive('transfer-paused-earlier')).resolves.toBe(false);
      await expect(adapter.isActive('transfer-live')).resolves.toBe(true);
    });

    it('treats a failed row as not active, so a dead transfer is never attached to', async () => {
      native.activeRows = [
        { downloadId: 'transfer-1', status: 'running' },
        { downloadId: 'transfer-2', status: 'failed' },
      ];
      const { adapter } = await makeAdapter();

      await expect(adapter.isActive('transfer-1')).resolves.toBe(true);
      await expect(adapter.isActive('transfer-2')).resolves.toBe(false);
      await expect(adapter.isActive('transfer-absent')).resolves.toBe(false);
    });
  });

  describe('resuming a paused download', () => {
    // Shared's transfer port has no pause verb: a pause is `cancel`, a resume is `start` again with
    // `resume: true`. Native retained the bytes on cancel; this flag is the ONLY thing that tells it
    // to continue from them, so dropping it here would silently restart every resume from zero.
    it('passes resume: true through to the native start', async () => {
      const { adapter } = await makeAdapter();
      const controller = new AbortController();
      const started = adapter.start({
        id: 'model-a',
        url: 'https://example.test/model.gguf',
        destination: '/models/model.gguf',
        resume: true,
        signal: controller.signal,
        onProgress: () => undefined,
      } as unknown as Parameters<typeof adapter.start>[0]);

      await flush();
      expect(native.startDownload).toHaveBeenCalledWith(expect.objectContaining({ resume: true }));

      native.emit(COMPLETE, { downloadId: 'transfer-1' });
      await started;
    });

    it('asks for a fresh transfer (resume: false) when Shared did not ask to resume', async () => {
      const { adapter } = await makeAdapter();
      const controller = new AbortController();
      const started = adapter.start({
        id: 'model-a',
        url: 'https://example.test/model.gguf',
        destination: '/models/model.gguf',
        resume: false,
        signal: controller.signal,
        onProgress: () => undefined,
      } as unknown as Parameters<typeof adapter.start>[0]);

      await flush();
      expect(native.startDownload).toHaveBeenCalledWith(expect.objectContaining({ resume: false }));

      native.emit(COMPLETE, { downloadId: 'transfer-1' });
      await started;
    });
  });

  describe('attaching to a transfer already running on the device', () => {
    it('settles from a terminal row the device already holds, with no second start', async () => {
      native.activeRows = [{ downloadId: 'transfer-1', status: 'completed' }];
      const { adapter } = await makeAdapter();
      const controller = new AbortController();

      await adapter.attach({
        transferId: 'transfer-1',
        destination: '/models/model.gguf',
        signal: controller.signal,
        onProgress: () => undefined,
      } as unknown as Parameters<NonNullable<typeof adapter.attach>>[0]);

      expect(native.startDownload).not.toHaveBeenCalled();
      expect(native.moved).toEqual([
        { transferId: 'transfer-1', destination: '/models/model.gguf' },
      ]);
    });
  });
});
