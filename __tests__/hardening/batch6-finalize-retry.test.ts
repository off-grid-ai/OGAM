/**
 * BATCH 6 — Model Management hardening: download finalize idempotency + retry.
 *
 * Drives the REAL watchBackgroundDownload finalizer (src/services/modelManager/
 * download.ts) with a REAL context map. Boundaries mocked: the native download
 * bridge (moveCompletedDownload / getActiveDownloads via a stubbed
 * DownloadManagerModule), RNFS (disk), and the storage persist layer
 * (buildDownloadedModel / persistDownloadedModel). The finalize state machine
 * (mainCompleted / mainCompleteHandled / isFinalizing guards) runs for real —
 * deleting those guards MUST fail these tests.
 *
 * Plan cases:
 *  - finalize idempotency: a completion delivered twice finalizes ONCE
 *    (onComplete fires exactly once) — the "double tryFinalize" case.
 *  - retry double-watcher: re-attaching the watcher after a retry must not
 *    double-fire onComplete when the download finally completes.
 */

import RNFS from 'react-native-fs';
import { backgroundDownloadService } from '../../src/services/backgroundDownloadService';
import { watchBackgroundDownload } from '../../src/services/modelManager/download';
import * as storage from '../../src/services/modelManager/storage';
import type { BackgroundDownloadContext } from '../../src/services/modelManager/types';
import { createModelFile } from '../utils/factories';

const mockedRNFS = RNFS as jest.Mocked<typeof RNFS>;

// buildDownloadedModel/persistDownloadedModel are the storage boundary: stub them
// to plain data + no-op disk write, so the REAL finalize logic on top runs.
jest.spyOn(storage, 'buildDownloadedModel').mockImplementation(async ({ modelId }: any) => ({
  id: modelId, name: modelId, fileName: 'm.gguf', filePath: '/models/m.gguf',
  fileSize: 1000, quantization: 'Q4_K_M', downloadedAt: '', engine: 'llama',
} as any));
const persistSpy = jest.spyOn(storage, 'persistDownloadedModel').mockResolvedValue(undefined as any);

const MODELS_DIR = '/models';

function seedContext(map: Map<string, BackgroundDownloadContext>, downloadId: string) {
  // The shape performBackgroundDownload writes for a text-only (no mmproj) model.
  map.set(downloadId, {
    modelId: 'org/model',
    file: createModelFile({ name: 'm.gguf' }),
    localPath: `${MODELS_DIR}/m.gguf`,
    mmProjLocalPath: null,
    removeProgressListener: jest.fn(),
    mmProjDownloadId: undefined,
    mmProjCompleted: true, // no mmproj needed
    mainCompleted: false,
    mainCompleteHandled: false,
    mmProjCompleteHandled: false,
    isFinalizing: false,
    removeMmProjProgressListener: undefined,
  } as any);
}

describe('BATCH 6 — download finalize idempotency + retry double-watcher', () => {
  let completeHandlers: Array<(e: any) => void>;
  let _onCompleteSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    completeHandlers = [];

    // Capture every main-download onComplete handler the watcher registers, while
    // keeping the REAL registration (returns a real remover). Calling a captured
    // handler is exactly what a native 'DownloadComplete' event does.
    _onCompleteSpy = jest
      .spyOn(backgroundDownloadService, 'onComplete')
      .mockImplementation((_id: string, cb: any) => {
        completeHandlers.push(cb);
        return () => {};
      });
    jest.spyOn(backgroundDownloadService, 'onError').mockImplementation(() => () => {});
    jest.spyOn(backgroundDownloadService, 'onProgress').mockImplementation(() => () => {});
    // Native bridge boundary.
    jest.spyOn(backgroundDownloadService, 'moveCompletedDownload').mockResolvedValue(`${MODELS_DIR}/m.gguf`);
    jest.spyOn(backgroundDownloadService, 'getActiveDownloads').mockResolvedValue([]);
    jest.spyOn(backgroundDownloadService, 'purgeNativeRecord').mockResolvedValue(undefined);

    mockedRNFS.exists.mockResolvedValue(true);
    persistSpy.mockClear();
  });

  it('finalizes ONCE when the main completion is delivered twice (double tryFinalize)', async () => {
    const map = new Map<string, BackgroundDownloadContext>();
    seedContext(map, 'dl-1');
    const onComplete = jest.fn();
    const onError = jest.fn();

    watchBackgroundDownload({
      downloadId: 'dl-1',
      modelsDir: MODELS_DIR,
      backgroundDownloadContext: map,
      backgroundDownloadMetadataCallback: null,
      onComplete,
      onError,
    });

    const handler = completeHandlers[0];
    expect(handler).toBeDefined();

    // Two DownloadComplete events for the same id (native double-fire / catch-up race).
    await handler({ downloadId: 'dl-1' });
    await handler({ downloadId: 'dl-1' });

    // The move + persist + onComplete happen exactly once — the mainCompleteHandled /
    // isFinalizing guards collapse the second delivery.
    expect(backgroundDownloadService.moveCompletedDownload).toHaveBeenCalledTimes(1);
    expect(persistSpy).toHaveBeenCalledTimes(1);
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onError).not.toHaveBeenCalled();
    // Context is cleared after finalize so it can't be re-finalized.
    expect(map.has('dl-1')).toBe(false);
  });

  it('re-attaching the watcher after a retry does not double-finalize (retry double-watcher)', async () => {
    const map = new Map<string, BackgroundDownloadContext>();
    seedContext(map, 'dl-2');
    const onComplete = jest.fn();

    const watchOpts = {
      downloadId: 'dl-2',
      modelsDir: MODELS_DIR,
      backgroundDownloadContext: map,
      backgroundDownloadMetadataCallback: null,
      onComplete,
      onError: jest.fn(),
    };

    // First watcher attaches (initial download), then the user retries and the
    // provider re-attaches a SECOND watcher on the SAME downloadId + SAME context.
    watchBackgroundDownload(watchOpts);
    watchBackgroundDownload(watchOpts);

    // Both watchers registered their own main-complete handler against the shared ctx.
    expect(completeHandlers.length).toBe(2);

    // The download finally completes: BOTH handlers fire (both listeners are live).
    for (const h of completeHandlers) {
      await h({ downloadId: 'dl-2' });
    }

    // Shared ctx.mainCompleteHandled + isFinalizing guarantee ONE finalize / ONE
    // onComplete across both watchers — no duplicate model persisted.
    expect(persistSpy).toHaveBeenCalledTimes(1);
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it('finalize is idempotent across a fresh watcher on a context whose file is already on disk', async () => {
    // Simulates restore re-adopting a completed download whose native move already ran
    // in a prior session: moveCompletedDownload rejects, but the file is on disk, so
    // finalize proceeds from disk and purges the stale native record (no loop).
    const map = new Map<string, BackgroundDownloadContext>();
    seedContext(map, 'dl-3');
    (backgroundDownloadService.moveCompletedDownload as jest.Mock).mockRejectedValue(
      new Error('Download dl-3 not completed yet'),
    );
    mockedRNFS.exists.mockResolvedValue(true); // final file present on disk
    const onComplete = jest.fn();
    const onError = jest.fn();

    watchBackgroundDownload({
      downloadId: 'dl-3', modelsDir: MODELS_DIR, backgroundDownloadContext: map,
      backgroundDownloadMetadataCallback: null, onComplete, onError,
    });
    await completeHandlers[0]({ downloadId: 'dl-3' });

    expect(persistSpy).toHaveBeenCalledTimes(1);
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onError).not.toHaveBeenCalled();
    // Stale native record purged so restore can't re-finalize it every foreground.
    expect(backgroundDownloadService.purgeNativeRecord).toHaveBeenCalledWith('dl-3');
  });
});
