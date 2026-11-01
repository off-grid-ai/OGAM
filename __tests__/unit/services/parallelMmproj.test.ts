/**
 * Parallel mmproj download tests.
 *
 * A vision model downloads its projector (mmproj) beside the main GGUF instead of one after the
 * other. Covered: parallel start, combined progress, finalize only when both files are in, error
 * handling, downloads that ended while the app was closed, and restore after a relaunch.
 *
 * Fakes: the native background downloader (NativeModules.DownloadManagerModule), the disk
 * (react-native-fs in memory) and async-storage, from harness/modelManagerDevice. The download
 * functions, backgroundDownloadService, the Hugging Face URL builder and the download store run for
 * real. A transfer finishes only when the fake native downloader says so; the app's own finalize
 * moves the file into the models folder.
 */
import { installModelManagerDevice, type ModelManagerDevice } from '../../harness/modelManagerDevice';
import { mmProjLocalName } from '../../../src/services/modelManager/download';
import { mmProjBelongsToModel, pickMmProjForDownload } from '../../../src/services/mmproj';
import { createModelFile, createModelFileWithMmProj } from '../../utils/factories';
import type { DownloadedModel, ModelFile, PersistedDownloadInfo } from '../../../src/types';
import type { BackgroundDownloadContext } from '../../../src/services/modelManager/types';

type DownloadModule = typeof import('../../../src/services/modelManager/download');
type RestoreModule = typeof import('../../../src/services/modelManager/restore');
type DownloadStoreModule = typeof import('../../../src/stores/downloadStore');

const MMPROJ_URL = 'https://huggingface.co/test/model/resolve/main/mmproj.gguf';

function visionFile(mainSize = 4_000_000_000, mmProjSize = 500_000_000): ModelFile {
  return createModelFileWithMmProj({
    name: 'vision.gguf',
    size: mainSize,
    quantization: 'Q4_K_M',
    mmProjName: 'mmproj.gguf',
    mmProjSize,
    mmProjDownloadUrl: MMPROJ_URL,
  });
}

describe('Parallel mmproj download', () => {
  let device: ModelManagerDevice;
  let dl: DownloadModule;
  let restore: RestoreModule;
  let store: DownloadStoreModule['useDownloadStore'];
  let bgContext: Map<string, BackgroundDownloadContext>;
  let metadata: Array<[string, unknown]>;

  const modelsDir = () => device.modelsDir;
  const metadataCallback = (id: string | number, info: unknown) => { metadata.push([String(id), info]); };

  beforeEach(async () => {
    device = await installModelManagerDevice();
    dl = require('../../../src/services/modelManager/download');
    restore = require('../../../src/services/modelManager/restore');
    store = (require('../../../src/stores/downloadStore') as DownloadStoreModule).useDownloadStore;
    bgContext = new Map();
    metadata = [];
  });

  /** Start a download the way modelManager does; returns the main and sidecar native ids. */
  async function start(file: ModelFile = visionFile(), onProgress?: (p: { bytesDownloaded: number; totalBytes: number; progress: number }) => void) {
    const info = await dl.performBackgroundDownload({
      modelId: 'test/model',
      file,
      modelsDir: modelsDir(),
      backgroundDownloadContext: bgContext,
      backgroundDownloadMetadataCallback: metadataCallback,
      onProgress,
    });
    const sidecarId = device.nativeRows().find(row => /mmproj/.test(row.fileName ?? ''))?.downloadId;
    return { info, mainId: info.downloadId, sidecarId };
  }

  /** Attach the finalize watcher; what it delivers lands in done/errors. */
  function watch(downloadId: string) {
    const done: DownloadedModel[] = [];
    const errors: Error[] = [];
    dl.watchBackgroundDownload({
      downloadId,
      modelsDir: modelsDir(),
      backgroundDownloadContext: bgContext,
      backgroundDownloadMetadataCallback: metadataCallback,
      onComplete: model => done.push(model),
      onError: error => errors.push(error),
    });
    return { done, errors };
  }

  /** The native downloader reports the transfer finished, but no file waits in its temp folder. */
  async function announceCompleteWithoutFile(downloadId: string) {
    const download = device.boundary.download!;
    const row = device.nativeRows().find(r => r.downloadId === downloadId)!;
    download.seedActive({ ...row, status: 'completed' });
    download.events.emit('DownloadComplete', {
      downloadId, fileName: row.fileName, modelId: row.modelId, status: 'completed',
      bytesDownloaded: row.totalBytes, totalBytes: row.totalBytes,
    });
    await device.settle();
  }

  const onDisk = (name: string) => device.fs.exists(`${modelsDir()}/${name}`);

  // ========================================================================
  // performBackgroundDownload — parallel start
  // ========================================================================

  describe('performBackgroundDownload', () => {
    it('starts the projector first, then the main, both from their own URLs', async () => {
      // Regression: the main used to be started first, then this function blocked awaiting the
      // sidecar's queued start; during that wait the main could complete with no listener yet
      // (lost event, finalize hang at 100%). Sidecar-first means nothing long is awaited after the
      // main starts.
      const { mainId, sidecarId } = await start();

      const rows = device.nativeRows() as Array<{ fileName?: string; url?: string; status?: string }>;
      expect(rows.map(row => [row.fileName, row.url, row.status])).toEqual([
        ['vision-mmproj.gguf', MMPROJ_URL, 'running'],
        ['vision.gguf', visionFile().downloadUrl, 'running'],
      ]);
      expect(mainId).toBe(device.nativeRows()[1].downloadId);
      expect(sidecarId).toBe(device.nativeRows()[0].downloadId);
    });

    it('hands the projector id and name to the metadata callback with the main id', async () => {
      const { mainId, sidecarId } = await start();

      expect(metadata).toEqual([[mainId, expect.objectContaining({
        mmProjDownloadId: sidecarId,
        mmProjFileName: 'vision-mmproj.gguf',
      })]]);
    });

    it('persists metadataJson (with mmProjDownloadUrl) on the store entry so a same-session iOS retry can re-fetch the vision projector', async () => {
      // The BUG: the store row carried mmProjFileName/Size but NOT metadataJson, so metadataJson
      // (which holds mmProjDownloadUrl) only appeared after a hydrate from native, i.e. after an app
      // restart. On a same-session retry, iOS's restartIosTextDownload found meta=null and re-issued
      // ONLY the main GGUF, silently dropping the vision projector.
      expect(store.getState().downloads['test/model/vision.gguf']).toBeUndefined();
      const { sidecarId } = await start();

      const entry = store.getState().downloads['test/model/vision.gguf'];
      expect(entry.mmProjFileName).toBe('vision-mmproj.gguf');
      expect(entry.mmProjDownloadId).toBe(sidecarId);
      expect(JSON.parse(entry.metadataJson as string).mmProjDownloadUrl).toBe(MMPROJ_URL);
    });

    it('waits for both files before it registers the model', async () => {
      const { mainId, sidecarId } = await start();
      const { done } = watch(mainId);

      await device.finishDownload(mainId, 4_000_000_000);
      expect(done).toEqual([]);
      expect(await device.readRegistry()).toEqual([]);

      await device.finishDownload(sidecarId!, 500_000_000);
      expect(done).toEqual([expect.objectContaining({ isVisionModel: true, mmProjPath: `${modelsDir()}/vision-mmproj.gguf` })]);
    });

    it('skips the projector when a complete one is already on disk, and finishes on the main alone', async () => {
      device.fs.seedFile(`${modelsDir()}/vision-mmproj.gguf`, 500_000_000);

      const { mainId, sidecarId } = await start();
      expect(sidecarId).toBeUndefined();
      expect(device.nativeRows().map(row => row.fileName)).toEqual(['vision.gguf']);

      const { done } = watch(mainId);
      await device.finishDownload(mainId, 4_000_000_000);

      expect(done).toEqual([expect.objectContaining({ isVisionModel: true, mmProjPath: `${modelsDir()}/vision-mmproj.gguf` })]);
    });

    it('starts only the main for a model with no projector, and finishes it alone', async () => {
      const { mainId, sidecarId } = await start(createModelFile({ name: 'model.gguf', size: 4_000_000_000 }));

      expect(sidecarId).toBeUndefined();
      expect(device.nativeRows().map(row => row.fileName)).toEqual(['model.gguf']);
      const { done } = watch(mainId);
      await device.finishDownload(mainId, 4_000_000_000);
      expect(done).toEqual([expect.objectContaining({ id: 'test/model/model.gguf' })]);
    });

    it('returns at once, with nothing started, when both files are already on disk', async () => {
      device.fs.seedFile(`${modelsDir()}/vision.gguf`, 4_000_000_000);
      device.fs.seedFile(`${modelsDir()}/vision-mmproj.gguf`, 500_000_000);

      const { info } = await start();

      expect(info.downloadId).toBe('already-downloaded:test/model/vision.gguf');
      expect(info.status).toBe('completed');
      expect(device.nativeRows()).toEqual([]);
    });

    it('re-downloads a projector that is only partly written, and removes the partial file', async () => {
      device.fs.seedFile(`${modelsDir()}/vision-mmproj.gguf`, 123);
      expect(await onDisk('vision-mmproj.gguf')).toBe(true);

      await start();

      expect(await onDisk('vision-mmproj.gguf')).toBe(false);
      expect(device.nativeRows().map(row => row.fileName)).toEqual(['vision-mmproj.gguf', 'vision.gguf']);
    });

    it('re-downloads a projector whose size the disk cannot read', async () => {
      device.fs.seedFile(`${modelsDir()}/vision-mmproj.gguf`, 500_000_000);
      device.fs.module.readDir.mockRejectedValueOnce(new Error('readDir failed'));

      await start();

      expect(await onDisk('vision-mmproj.gguf')).toBe(false);
      expect(device.nativeRows().map(row => row.fileName)).toEqual(['vision-mmproj.gguf', 'vision.gguf']);
    });

    it('a second start of the same model cancels the old transfers and points the store row at the new ones', async () => {
      const first = await start();
      expect(store.getState().downloads['test/model/vision.gguf'].downloadId).toBe(first.mainId);

      const second = await start();

      const ids = device.nativeRows().map(row => row.downloadId);
      expect(ids).not.toContain(first.mainId);
      expect(ids).not.toContain(first.sidecarId);
      expect(ids.sort()).toEqual([second.mainId, second.sidecarId].sort());
      const entry = store.getState().downloads['test/model/vision.gguf'];
      expect(entry.downloadId).toBe(second.mainId);
      expect(entry.mmProjDownloadId).toBe(second.sidecarId);
      expect(Object.keys(store.getState().downloads)).toEqual(['test/model/vision.gguf']);
    });
  });

  // ========================================================================
  // Combined progress
  // ========================================================================

  describe('combined progress', () => {
    it('reports combined progress from both downloads', async () => {
      const progress: Array<{ bytesDownloaded: number; totalBytes: number; progress: number }> = [];
      const { mainId, sidecarId } = await start(visionFile(4_000_000_000, 1_000_000_000), p => progress.push(p));

      await device.reportProgress(mainId, 2_000_000_000, 4_000_000_000);
      expect(progress.at(-1)).toEqual(expect.objectContaining({ bytesDownloaded: 2_000_000_000, totalBytes: 5_000_000_000 }));

      await device.reportProgress(sidecarId!, 500_000_000, 1_000_000_000);
      expect(progress.at(-1)).toEqual(expect.objectContaining({
        bytesDownloaded: 2_500_000_000,
        totalBytes: 5_000_000_000,
        progress: 0.5,
      }));
    });

    it('counts a projector already on disk as downloaded', async () => {
      device.fs.seedFile(`${modelsDir()}/vision-mmproj.gguf`, 1_000_000_000);
      const progress: Array<{ bytesDownloaded: number; totalBytes: number }> = [];
      const { mainId } = await start(visionFile(4_000_000_000, 1_000_000_000), p => progress.push(p));

      await device.reportProgress(mainId, 2_000_000_000, 4_000_000_000);

      expect(progress.at(-1)).toEqual(expect.objectContaining({ bytesDownloaded: 3_000_000_000, totalBytes: 5_000_000_000 }));
    });

    it('updates the native combined-progress notification when the platform has one', async () => {
      const notification: unknown[][] = [];
      device.boundary.download!.module.updateCombinedProgress = jest.fn((...args: unknown[]) => { notification.push(args); });
      const { mainId } = await start(visionFile(4_000_000_000, 1_000_000_000), () => {});

      await device.reportProgress(mainId, 1_000_000_000, 4_000_000_000);

      expect(notification).toEqual([['test/model', 'vision.gguf', 'mmproj.gguf', 1_000_000_000, 4_000_000_000, 0, 1_000_000_000]]);
    });

    it('still reports progress in the app when the native notification update throws', async () => {
      device.boundary.download!.module.updateCombinedProgress = jest.fn(() => { throw new Error('native failure'); });
      const progress: Array<{ bytesDownloaded: number }> = [];
      const { mainId } = await start(visionFile(4_000_000_000, 1_000_000_000), p => progress.push(p));

      await device.reportProgress(mainId, 1_000_000_000, 4_000_000_000);

      expect(progress).toEqual([expect.objectContaining({ bytesDownloaded: 1_000_000_000 })]);
    });
  });

  // ========================================================================
  // watchBackgroundDownload — dual completion gating
  // ========================================================================

  describe('watchBackgroundDownload — completion gating', () => {
    it('does not finish until both downloads finish (projector first), then moves both files in', async () => {
      const { mainId, sidecarId } = await start();
      const { done } = watch(mainId);

      await device.finishDownload(sidecarId!, 500_000_000);
      expect(done).toEqual([]);
      expect(await onDisk('vision-mmproj.gguf')).toBe(true);
      expect(await onDisk('vision.gguf')).toBe(false);

      await device.finishDownload(mainId, 4_000_000_000);
      expect(done).toHaveLength(1);
      expect(await onDisk('vision.gguf')).toBe(true);
    });

    it('does not finish until both downloads finish (main first)', async () => {
      const { mainId, sidecarId } = await start();
      const { done } = watch(mainId);

      await device.finishDownload(mainId, 4_000_000_000);
      expect(done).toEqual([]);

      await device.finishDownload(sidecarId!, 500_000_000);
      expect(done).toHaveLength(1);
    });

    it('finalizes idempotently when the native move rejects but the file is already on disk (no re-finalize loop)', async () => {
      // Device case: a record reports completed across relaunch but its localUri was cleared (moved
      // in a prior session), so moveCompletedDownload rejects NOT_COMPLETED. The file is already at
      // localPath: finalize from it, and purge the stale native record so restore can't re-adopt and
      // re-fail it every foreground.
      const { mainId } = await start(createModelFile({ name: 'model.gguf', size: 4_000_000_000 }));
      const { done, errors } = watch(mainId);
      device.fs.seedFile(`${modelsDir()}/model.gguf`, 4_000_000_000);

      await announceCompleteWithoutFile(mainId);

      expect(errors).toEqual([]);
      expect(done).toEqual([expect.objectContaining({ id: 'test/model/model.gguf' })]);
      expect(device.nativeRows()).toEqual([]);
    });

    it('fails (not loops) when the native move rejects AND the file is genuinely absent', async () => {
      const { mainId } = await start(createModelFile({ name: 'model.gguf', size: 4_000_000_000 }));
      const { done, errors } = watch(mainId);

      await announceCompleteWithoutFile(mainId);

      expect(done).toEqual([]);
      expect(errors.map(e => e.message)).toEqual([`Download ${mainId} not completed yet`]);
      expect(await device.readRegistry()).toEqual([]);
    });

    it('hands the metadata slot back when both complete', async () => {
      const { mainId, sidecarId } = await start();
      watch(mainId);
      expect(metadata.at(-1)?.[1]).not.toBeNull();

      await device.finishDownload(sidecarId!, 500_000_000);
      await device.finishDownload(mainId, 4_000_000_000);

      expect(metadata.at(-1)).toEqual([mainId, null]);
    });

    it('a duplicate main completion event registers the model once', async () => {
      const { mainId, sidecarId } = await start();
      const { done, errors } = watch(mainId);
      await device.finishDownload(mainId, 4_000_000_000);

      // The OS repeats the completion before the projector finishes.
      device.boundary.download!.events.emit('DownloadComplete', { downloadId: mainId, fileName: 'vision.gguf', modelId: 'test/model', status: 'completed' });
      await device.settle();
      await device.finishDownload(sidecarId!, 500_000_000);

      expect(done).toHaveLength(1);
      expect(errors).toEqual([]);
      expect(await device.readRegistry()).toHaveLength(1);
    });

    it('drops vision when the projector move fails and its file is missing', async () => {
      const { mainId, sidecarId } = await start();
      const { done } = watch(mainId);

      await announceCompleteWithoutFile(sidecarId!);
      await device.finishDownload(mainId, 4_000_000_000);

      expect(done).toEqual([expect.objectContaining({
        mmProjPath: undefined,
        mmProjFileName: 'mmproj.gguf',
        isVisionModel: false,
      })]);
    });
  });

  // ========================================================================
  // watchBackgroundDownload — error handling
  // ========================================================================

  describe('watchBackgroundDownload — error handling', () => {
    it('a failed main reports its reason and leaves the projector transfer running', async () => {
      // The sidecar is NOT cancelled: a cancelled native worker refuses retryDownload, which used to
      // deadlock the retried main (see handleError in download.ts).
      const { mainId, sidecarId } = await start();
      const { errors } = watch(mainId);

      await device.failDownload(mainId, 'Network error');

      expect(errors.map(e => e.message)).toEqual(['Network error']);
      expect(device.nativeRows().find(row => row.downloadId === sidecarId)?.status).toBe('running');
    });

    it('after a failed main, a retried main that finishes still finalizes with vision', async () => {
      const { mainId, sidecarId } = await start();
      watch(mainId);
      await device.failDownload(mainId, 'Network error');

      // The person retries: the native worker restarts the same id and the watcher re-attaches.
      device.boundary.download!.seedActive({ ...device.nativeRows().find(r => r.downloadId === mainId)!, status: 'running' });
      const { done, errors } = watch(mainId);
      await device.finishDownload(sidecarId!, 500_000_000);
      await device.finishDownload(mainId, 4_000_000_000);

      expect(errors).toEqual([]);
      expect(done).toEqual([expect.objectContaining({ isVisionModel: true })]);
    });

    it('continues as text-only when the projector download fails', async () => {
      const { mainId, sidecarId } = await start();
      const { done, errors } = watch(mainId);

      await device.failDownload(sidecarId!, 'Storage full');
      expect(errors).toEqual([]);
      expect(store.getState().downloads['test/model/vision.gguf'].mmProjStatus).toBe('failed');

      await device.finishDownload(mainId, 4_000_000_000);
      expect(done).toEqual([expect.objectContaining({ isVisionModel: false, mmProjPath: undefined })]);
    });
  });

  describe('watchBackgroundDownload — already-downloaded recovery', () => {
    beforeEach(() => {
      device.fs.seedFile(`${modelsDir()}/vision.gguf`, 4_000_000_000);
      device.fs.seedFile(`${modelsDir()}/vision-mmproj.gguf`, 500_000_000);
    });

    it('persists already-downloaded models before reporting them done', async () => {
      const { info } = await start();
      const { done } = watch(info.downloadId);
      await device.settle();

      expect(await device.readRegistry()).toEqual([expect.objectContaining({ id: 'test/model/vision.gguf' })]);
      expect(done).toEqual([expect.objectContaining({
        id: 'test/model/vision.gguf',
        filePath: `${modelsDir()}/vision.gguf`,
        mmProjPath: `${modelsDir()}/vision-mmproj.gguf`,
      })]);
      // A second watcher finds nothing left to deliver.
      expect(watch(info.downloadId).done).toEqual([]);
    });

    it('still reports the model done when the storage write fails', async () => {
      const storage = require('@react-native-async-storage/async-storage');
      storage.setItem.mockImplementationOnce(async () => { throw new Error('storage write failed'); });
      const { info } = await start();

      const { done } = watch(info.downloadId);
      await device.settle();

      expect(done).toEqual([expect.objectContaining({ id: 'test/model/vision.gguf' })]);
    });
  });

  // ========================================================================
  // syncCompletedBackgroundDownloads — mmproj handling
  // ========================================================================

  describe('syncCompletedBackgroundDownloads', () => {
    const persisted = (extra: Partial<PersistedDownloadInfo> = {}): Record<string, PersistedDownloadInfo> => ({
      main: {
        modelId: 'test/model', fileName: 'vision.gguf', quantization: 'Q4_K_M', author: 'test',
        totalBytes: 4_500_000_000, mmProjDownloadId: 'side', ...extra,
      },
    });

    it('moves a model and its projector that both finished while the app was closed', async () => {
      device.seedFinishedNativeRow({ downloadId: 'main', fileName: 'vision.gguf', modelId: 'test/model', sizeBytes: 4_000_000_000 });
      device.seedFinishedNativeRow({ downloadId: 'side', fileName: 'mmproj.gguf', modelId: 'test/model', sizeBytes: 500_000_000 });
      const cleared: string[] = [];

      const models = await dl.syncCompletedBackgroundDownloads({
        persistedDownloads: persisted({
          mmProjFileName: 'vision-mmproj.gguf',
          mmProjLocalPath: `${modelsDir()}/vision-mmproj.gguf`,
        }),
        modelsDir: modelsDir(),
        clearDownloadCallback: id => cleared.push(id),
      });

      expect(await onDisk('vision.gguf')).toBe(true);
      expect(await onDisk('vision-mmproj.gguf')).toBe(true);
      expect(models).toEqual([expect.objectContaining({ id: 'test/model/vision.gguf', mmProjPath: `${modelsDir()}/vision-mmproj.gguf` })]);
      expect(cleared).toEqual(['main']);
    });

    it('waits while the projector is still running', async () => {
      device.seedFinishedNativeRow({ downloadId: 'main', fileName: 'vision.gguf', modelId: 'test/model', sizeBytes: 4_000_000_000 });
      device.boundary.download!.seedActive({ downloadId: 'side', fileName: 'mmproj.gguf', modelId: 'test/model', status: 'running', bytesDownloaded: 200_000_000, totalBytes: 500_000_000 });
      const cleared: string[] = [];

      const models = await dl.syncCompletedBackgroundDownloads({
        persistedDownloads: persisted(), modelsDir: modelsDir(), clearDownloadCallback: id => cleared.push(id),
      });

      expect(models).toEqual([]);
      expect(cleared).toEqual([]);
      expect(await onDisk('vision.gguf')).toBe(false);
    });

    it('cancels the projector when the main failed while the app was closed', async () => {
      device.seedFinishedNativeRow({ downloadId: 'main', fileName: 'vision.gguf', modelId: 'test/model', sizeBytes: 4_000_000_000, status: 'failed' });
      device.boundary.download!.seedActive({ downloadId: 'side', fileName: 'mmproj.gguf', modelId: 'test/model', status: 'running', totalBytes: 500_000_000 });
      const cleared: string[] = [];

      await dl.syncCompletedBackgroundDownloads({
        persistedDownloads: persisted(), modelsDir: modelsDir(), clearDownloadCallback: id => cleared.push(id),
      });
      await device.settle();

      expect(device.nativeRows().map(row => row.downloadId)).toEqual(['main']);
      expect(cleared).toEqual(['main']);
    });
  });

  // ========================================================================
  // restoreInProgressDownloads — mmproj recovery
  // ========================================================================

  describe('restoreInProgressDownloads — mmproj recovery', () => {
    /** The native rows a relaunch finds: the main (linked to its projector) and the projector. */
    function seedRelaunchRows(main: { bytes: number }, side: { status: string; bytes: number }) {
      const download = device.boundary.download!;
      download.seedActive({
        downloadId: 'main', status: 'running', fileName: 'vision.gguf', modelId: 'test/model',
        bytesDownloaded: main.bytes, totalBytes: 4_000_000_000, combinedTotalBytes: 4_500_000_000,
        quantization: 'Q4_K_M', mmProjDownloadId: 'side',
      });
      if (side.status === 'completed') {
        device.seedFinishedNativeRow({ downloadId: 'side', fileName: 'vision-mmproj.gguf', modelId: 'test/model', sizeBytes: 500_000_000 });
      } else {
        download.seedActive({
          downloadId: 'side', status: side.status, fileName: 'vision-mmproj.gguf', modelId: 'test/model',
          bytesDownloaded: side.bytes, totalBytes: 500_000_000,
        });
      }
    }

    async function restoreNow() {
      const progress: Array<{ bytesDownloaded: number; totalBytes: number }> = [];
      const restored = await restore.restoreInProgressDownloads({
        modelsDir: modelsDir(),
        backgroundDownloadContext: bgContext,
        backgroundDownloadMetadataCallback: metadataCallback,
        onProgress: p => progress.push(p),
      });
      return { restored, progress };
    }

    it('restores the main once (not the projector) and follows progress from both', async () => {
      seedRelaunchRows({ bytes: 1_000_000_000 }, { status: 'running', bytes: 100_000_000 });

      const { restored, progress } = await restoreNow();

      expect(restored).toEqual(['main']);
      expect(progress.at(-1)).toEqual(expect.objectContaining({ bytesDownloaded: 1_100_000_000, totalBytes: 4_500_000_000 }));
      await device.reportProgress('main', 2_000_000_000, 4_000_000_000);
      expect(progress.at(-1)).toEqual(expect.objectContaining({ bytesDownloaded: 2_100_000_000 }));
      await device.reportProgress('side', 500_000_000, 500_000_000);
      expect(progress.at(-1)).toEqual(expect.objectContaining({ bytesDownloaded: 2_500_000_000 }));
    });

    it('a projector already in the models folder counts as done: the main alone finishes the model with vision', async () => {
      seedRelaunchRows({ bytes: 2_000_000_000 }, { status: 'completed', bytes: 500_000_000 });
      device.fs.seedFile(`${modelsDir()}/vision-mmproj.gguf`, 500_000_000);

      const { progress } = await restoreNow();
      expect(progress.at(-1)).toEqual(expect.objectContaining({ bytesDownloaded: 2_500_000_000 }));

      const { done } = watch('main');
      await device.settle();
      expect(done).toEqual([]);
      await device.finishDownload('main', 4_000_000_000);

      expect(done).toEqual([expect.objectContaining({ isVisionModel: true, mmProjPath: `${modelsDir()}/vision-mmproj.gguf` })]);
    });

    it('a projector that failed while the app was closed does not hold the model back', async () => {
      seedRelaunchRows({ bytes: 2_000_000_000 }, { status: 'failed', bytes: 0 });

      await restoreNow();
      const { done } = watch('main');
      await device.finishDownload('main', 4_000_000_000);

      expect(done).toEqual([expect.objectContaining({ id: 'test/model/vision.gguf' })]);
    });

    it('a projector that finished while closed but is not moved yet is moved by the watcher, not by restore', async () => {
      seedRelaunchRows({ bytes: 0 }, { status: 'completed', bytes: 500_000_000 });

      await restoreNow();
      expect(await onDisk('vision-mmproj.gguf')).toBe(false);

      const { done } = watch('main');
      await device.settle();
      expect(await onDisk('vision-mmproj.gguf')).toBe(true);
      await device.finishDownload('main', 4_000_000_000);

      expect(done).toEqual([expect.objectContaining({ isVisionModel: true, mmProjPath: `${modelsDir()}/vision-mmproj.gguf` })]);
    });
  });

  describe('watchBackgroundDownload — catch-up paths', () => {
    it('finalizes with vision when the projector finished before the watcher attached', async () => {
      const { mainId, sidecarId } = await start();
      // The sidecar's one DownloadComplete fires before anyone listens.
      const download = device.boundary.download!;
      const row = device.nativeRows().find(r => r.downloadId === sidecarId)!;
      device.seedFinishedNativeRow({ downloadId: sidecarId!, fileName: row.fileName!, modelId: 'test/model', sizeBytes: 500_000_000 });
      expect(download.active().find(r => r.downloadId === sidecarId)?.status).toBe('completed');

      const { done } = watch(mainId);
      await device.settle();
      await device.finishDownload(mainId, 4_000_000_000);

      expect(done).toEqual([expect.objectContaining({ mmProjPath: `${modelsDir()}/vision-mmproj.gguf`, isVisionModel: true })]);
    });

    it('continues without vision when the projector reported done before the watcher but its file is gone', async () => {
      const { mainId, sidecarId } = await start();
      const download = device.boundary.download!;
      download.seedActive({ ...device.nativeRows().find(r => r.downloadId === sidecarId)!, status: 'completed' });

      const { done } = watch(mainId);
      await device.settle();
      await device.finishDownload(mainId, 4_000_000_000);

      expect(done).toEqual([expect.objectContaining({ mmProjPath: undefined, mmProjFileName: 'mmproj.gguf' })]);
    });

    it('finalizes a non-vision main that completed before listener registration (main catch-up, no live event)', async () => {
      // Under the 3-concurrent cap, the main GGUF can finish in native before watchBackgroundDownload
      // subscribes. The DownloadComplete event fires once with no subscriber and is lost. The
      // reconcile must query native and finalize itself, with no live complete event.
      const { mainId } = await start(createModelFile({ name: 'model.gguf', size: 4_000_000_000 }));
      device.seedFinishedNativeRow({ downloadId: mainId, fileName: 'model.gguf', modelId: 'test/model', sizeBytes: 4_000_000_000 });

      const { done } = watch(mainId);
      await device.settle();

      expect(done).toEqual([expect.objectContaining({ id: 'test/model/model.gguf' })]);
      expect(await onDisk('model.gguf')).toBe(true);
    });
  });
});

// DEVICE 2026-07-14 — the projector is quant-independent (one F16/BF16 file serves every quant), so
// downloading a 2nd quant of a model must NOT re-fetch it. The on-disk name is model-base + the projector's
// own precision, so all quants of one model share ONE file, while different models stay separate.
describe('mmProjLocalName — one shared projector per model (dedup across quants), separate per model', () => {
  it('every quant of a model maps to the SAME projector file (2 quants → 1 mmproj)', () => {
    const q4 = mmProjLocalName('gemma-4-E2B-it-Q4_K_M.gguf', 'mmproj-F16.gguf');
    const q8 = mmProjLocalName('gemma-4-E2B-it-Q8_0.gguf', 'mmproj-F16.gguf');
    expect(q4).toBe(q8);
    expect(q4).toBe('gemma-4-e2b-it-mmproj-F16.gguf');
  });

  it('E2B and E4B get DIFFERENT projector files (different architectures — never shared)', () => {
    expect(mmProjLocalName('gemma-4-E2B-it-Q4_K_M.gguf', 'mmproj-F16.gguf'))
      .not.toBe(mmProjLocalName('gemma-4-E4B-it-Q4_K_M.gguf', 'mmproj-F16.gguf'));
  });

  it('keeps the projector precision and strips a repo model-prefix from the source name', () => {
    expect(mmProjLocalName('gemma-4-E2B-it-Q4_K_M.gguf', 'gemma-4-E2B-it-mmproj-BF16.gguf'))
      .toBe('gemma-4-e2b-it-mmproj-BF16.gguf');
  });

  it('the generated name matches its model under the strict rule (so it is recognized after download)', () => {
    const name = mmProjLocalName('gemma-4-E2B-it-Q4_K_M.gguf', 'mmproj-F16.gguf');
    expect(mmProjBelongsToModel('gemma-4-E2B-it-Q8_0.gguf', name)).toBe(true);
    expect(mmProjBelongsToModel('gemma-4-E4B-it-Q8_0.gguf', name)).toBe(false);
  });

  // A1 (device 2026-07-23, iOS): ggml-org names projectors `mmproj-<ModelName>-<quant>.gguf` — the model name
  // sits AFTER the "mmproj" token. The old `/mmproj.*$/` kept that model name, doubling the on-disk stem so
  // mmProjBelongsToModel refused it → link cleared → "Multimodal support not enabled". Offline guard so the
  // regression is caught without the network (the live-HF proof is the .network integration test).
  it('ggml-org shape: model name AFTER the mmproj token is dropped, on-disk name still belongs (SmolVLM/Qwen-VL)', () => {
    const smol = mmProjLocalName('SmolVLM-256M-Instruct-Q8_0.gguf', 'mmproj-SmolVLM-256M-Instruct-Q8_0.gguf');
    expect(smol).toBe('smolvlm-256m-instruct-mmproj-Q8_0.gguf');
    expect(mmProjBelongsToModel('SmolVLM-256M-Instruct-Q8_0.gguf', smol)).toBe(true);

    const qwen = mmProjLocalName('Qwen2.5-VL-3B-Instruct-Q4_K_M.gguf', 'mmproj-Qwen2.5-VL-3B-Instruct-f16.gguf');
    expect(qwen).toBe('qwen2.5-vl-3b-instruct-mmproj-f16.gguf');
    expect(mmProjBelongsToModel('Qwen2.5-VL-3B-Instruct-Q8_0.gguf', qwen)).toBe(true);

    // every quant of the ggml-org model still shares ONE projector file (quant-independent dedup preserved)
    expect(mmProjLocalName('SmolVLM-256M-Instruct-Q8_0.gguf', 'mmproj-SmolVLM-256M-Instruct-f16.gguf'))
      .toBe(mmProjLocalName('SmolVLM-256M-Instruct-Q4_K_M.gguf', 'mmproj-SmolVLM-256M-Instruct-f16.gguf'));
  });
});

// A1 no-pairing shapes (found in the live-HF sweep) — pickMmProjForDownload must pair these too.
describe('pickMmProjForDownload — additional real-world projector shapes', () => {
  it('literal `mmproj-model-<prec>` placeholder is generic (ggml-org gemma-3, openbmb MiniCPM)', () => {
    expect(pickMmProjForDownload('gemma-3-4b-it-Q4_K_M.gguf', ['mmproj-model-f16.gguf']))
      .toBe('mmproj-model-f16.gguf');
    expect(pickMmProjForDownload('ggml-model-Q4_K_M.gguf', ['mmproj-model-f16.gguf']))
      .toBe('mmproj-model-f16.gguf');
  });

  it('unsloth UD- dynamic-quant packaging is stripped so the model matches its non-UD projector', () => {
    expect(mmProjBelongsToModel(
      'Mistral-Small-3.1-24B-Instruct-2503-UD-IQ2_M.gguf',
      'mmproj-Mistral-Small-3.1-24B-Instruct-2503-Q8_0.gguf',
    )).toBe(true);
  });

  it('moondream `-text-model` weights match the `-mmproj` projector of the same base', () => {
    expect(mmProjBelongsToModel('moondream2-text-model-f16.gguf', 'moondream2-mmproj-f16.gguf')).toBe(true);
  });

  it('still REFUSES a genuinely different model+variant (no over-loosening: E2B ≠ E4B)', () => {
    expect(pickMmProjForDownload('gemma-4-E2B-it-Q4_K_M.gguf', ['gemma-4-E4B-it-mmproj-F16.gguf']))
      .toBeUndefined();
  });
});
