/**
 * BATCH 6 — Model Management hardening: download finalize idempotency + retry.
 *
 * Drives the REAL download finalizer through modelManager's public download + watch API
 * (downloadModelBackground → watchDownload → watchBackgroundDownload in
 * src/services/modelManager/download.ts), over the REAL backgroundDownloadService and the
 * REAL storage layer that persists the model registry. Only the phone is faked
 * (modelManagerDevice: the native background downloader, which emits DownloadComplete and moves
 * the finished file; the disk; async-storage). The finalize state machine (mainCompleted /
 * mainCompleteHandled / isFinalizing guards) runs for real — deleting those guards MUST fail
 * these tests.
 *
 * Plan cases:
 *  - finalize idempotency: a completion delivered twice finalizes ONCE
 *    (onComplete fires exactly once) — the "double tryFinalize" case.
 *  - retry double-watcher: re-attaching the watcher after a retry must not
 *    double-fire onComplete when the download finally completes.
 */
import { installModelManagerDevice, type ModelManagerDevice } from '../harness/modelManagerDevice';

const FILE = {
  name: 'm.gguf',
  size: 1000,
  quantization: 'Q4_K_M',
  downloadUrl: 'https://huggingface.co/org/model/resolve/main/m.gguf',
} as never;

describe('BATCH 6 — download finalize idempotency + retry double-watcher', () => {
  let device: ModelManagerDevice;

  beforeEach(async () => {
    device = await installModelManagerDevice({ platform: 'android' });
  });

  /** Start the model's download; returns the native download id. */
  async function startDownload(): Promise<string> {
    const { downloadId } = await device.modelManager.downloadModelBackground('org/model', FILE);
    return downloadId;
  }

  /** The native downloader announces the completion again (a double-fire or catch-up race). */
  async function redeliverCompletion(downloadId: string): Promise<void> {
    device.boundary.download!.events.emit('DownloadComplete', {
      downloadId, fileName: 'm.gguf', modelId: 'org/model', bytesDownloaded: 1000, totalBytes: 1000, status: 'completed',
    });
    await device.settle();
  }

  const registeredModels = async () => (await device.readRegistry()).filter(m => m.fileName === 'm.gguf');

  it('finalizes ONCE when the main completion is delivered twice (double tryFinalize)', async () => {
    const downloadId = await startDownload();
    const completed: unknown[] = [];
    const errors: unknown[] = [];
    device.modelManager.watchDownload(downloadId, model => completed.push(model), error => errors.push(error));

    // Two DownloadComplete events for the same id (native double-fire / catch-up race).
    await device.finishDownload(downloadId, 1000);
    await redeliverCompletion(downloadId);

    // The move + persist + onComplete happen exactly once — the mainCompleteHandled /
    // isFinalizing guards collapse the second delivery.
    expect(completed).toHaveLength(1);
    expect(errors).toHaveLength(0);
    expect(await registeredModels()).toHaveLength(1);
    expect(await device.fs.exists(`${device.modelsDir}/m.gguf`)).toBe(true);
  });

  it('re-attaching the watcher after a retry does not double-finalize (retry double-watcher)', async () => {
    const downloadId = await startDownload();
    const completed: unknown[] = [];

    // The first watcher attaches (initial download), then the user retries and the provider
    // re-attaches a SECOND watcher on the SAME downloadId.
    device.modelManager.watchDownload(downloadId, model => completed.push(model), () => {});
    device.modelManager.watchDownload(downloadId, model => completed.push(model), () => {});

    // The download finally completes: both listeners are live.
    await device.finishDownload(downloadId, 1000);

    // ONE finalize / ONE onComplete across both watchers — no duplicate model persisted.
    expect(completed).toHaveLength(1);
    expect(await registeredModels()).toHaveLength(1);
  });

  it('finalize is idempotent across a fresh watcher on a context whose file is already on disk', async () => {
    // A completed download whose native move already ran in a prior session: the native row no
    // longer holds a finished file to move (the move is refused), but the file is on disk, so
    // finalize proceeds from disk and purges the stale native record (no loop).
    const downloadId = await startDownload();
    device.fs.seedFile(`${device.modelsDir}/m.gguf`, 1000);
    const completed: unknown[] = [];
    const errors: unknown[] = [];
    device.modelManager.watchDownload(downloadId, model => completed.push(model), error => errors.push(error));

    await redeliverCompletion(downloadId);

    expect(completed).toHaveLength(1);
    expect(errors).toHaveLength(0);
    expect(await registeredModels()).toHaveLength(1);
    // Stale native record purged so restore can't re-finalize it every foreground.
    expect(device.nativeRows().map(row => row.downloadId)).not.toContain(downloadId);
  });
});
