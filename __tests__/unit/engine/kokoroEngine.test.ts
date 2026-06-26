/**
 * KokoroEngine unit tests — install-status detection.
 *
 * Regression coverage for the bug where a fully-downloaded Kokoro model
 * reverted to "downloading"/"not-downloaded" once its executorch bridge
 * unmounted (e.g. switching engines) or after an app restart, because status
 * was derived from the live engine phase + transient in-memory progress.
 *
 * The fix makes checkAssetStatus() consult executorch's on-disk cache
 * (BareResourceFetcher.listDownloadedModels) and treat isFullyDownloaded()
 * — phase==='ready' OR progress>=1 OR model files present on disk — as
 * 'downloaded'.
 */
import { BareResourceFetcher } from 'react-native-executorch-bare-resource-fetcher';
import { KokoroEngine, type KokoroBridgeHandle } from '../../../pro/audio/engine/tts/engines/kokoro/KokoroEngine';

const listDownloadedModels =
  BareResourceFetcher.listDownloadedModels as jest.Mock;
const deleteResources = BareResourceFetcher.deleteResources as jest.Mock;

// The two .pte files executorch caches for Kokoro Medium.
const KOKORO_FILES = ['duration_predictor.pte', 'synthesizer.pte'];

const noopHandle: KokoroBridgeHandle = {
  speak: jest.fn().mockResolvedValue(undefined),
  stop: jest.fn(),
  pause: jest.fn(),
  resume: jest.fn(),
  setSpeed: jest.fn(),
  setKeepAlive: jest.fn(),
};

describe('KokoroEngine install status', () => {
  beforeEach(() => {
    listDownloadedModels.mockReset();
    deleteResources.mockReset().mockResolvedValue(undefined);
    listDownloadedModels.mockResolvedValue([]);
  });

  it('reports not-downloaded when disk is empty and nothing has loaded', async () => {
    const engine = new KokoroEngine();
    const [state] = await engine.checkAssetStatus();
    expect(state.status).toBe('not-downloaded');
    expect(state.progress).toBe(0);
    expect(engine.isFullyDownloaded()).toBe(false);
  });

  it('reports downloaded when both model files exist on disk (cold start / no bridge)', async () => {
    listDownloadedModels.mockResolvedValue([
      `/data/react-native-executorch/${KOKORO_FILES[0]}`,
      `/data/react-native-executorch/${KOKORO_FILES[1]}`,
    ]);
    const engine = new KokoroEngine();

    // Phase is still 'idle' and no download happened this session — purely disk-derived.
    const [state] = await engine.checkAssetStatus();
    expect(state.status).toBe('downloaded');
    expect(state.progress).toBe(1);
    expect(engine.getPhase()).toBe('idle');
    expect(engine.isFullyDownloaded()).toBe(true);
    expect(engine.getOverallDownloadProgress()).toBe(1);
  });

  it('treats a partial disk cache (one file) as not-downloaded', async () => {
    listDownloadedModels.mockResolvedValue([
      `/data/react-native-executorch/${KOKORO_FILES[0]}`,
    ]);
    const engine = new KokoroEngine();
    const [state] = await engine.checkAssetStatus();
    expect(state.status).toBe('not-downloaded');
  });

  it('REGRESSION: stays downloaded after the bridge unmounts (engine switch)', async () => {
    // Model genuinely on disk for the whole test (a successful disk scan is the
    // authoritative signal).
    listDownloadedModels.mockResolvedValue([
      `/x/${KOKORO_FILES[0]}`,
      `/x/${KOKORO_FILES[1]}`,
    ]);
    const engine = new KokoroEngine();

    // 1. Bridge mounts, model finishes downloading, engine becomes ready.
    engine._setDownloadProgress(1);
    engine._setBridge(noopHandle, 'af_heart');
    expect(engine.getPhase()).toBe('ready');
    let [state] = await engine.checkAssetStatus();
    expect(state.status).toBe('downloaded');

    // 2. User switches engine → Kokoro bridge unmounts. Phase drops to idle.
    engine._setBridge(null, 'af_heart');
    expect(engine.getPhase()).toBe('idle');

    // Before the fix this reported 'downloading' forever (progress was 1, phase
    // not ready). It must remain 'downloaded' — the disk cache confirms it.
    [state] = await engine.checkAssetStatus();
    expect(state.status).toBe('downloaded');
    expect(state.progress).toBe(1);
  });

  it('stays downloaded across a voice switch that resets progress to 0', async () => {
    listDownloadedModels.mockResolvedValue([
      `/x/${KOKORO_FILES[0]}`,
      `/x/${KOKORO_FILES[1]}`,
    ]);
    const engine = new KokoroEngine();
    await engine.checkAssetStatus(); // primes _diskDownloaded = true

    // Voice change path resets in-memory progress to show a loader.
    engine._setDownloadProgress(0);

    const [state] = await engine.checkAssetStatus();
    expect(state.status).toBe('downloaded');
  });

  it('does not regress to not-downloaded if the fetcher throws', async () => {
    const engine = new KokoroEngine();
    engine._setDownloadProgress(1); // downloaded this session
    listDownloadedModels.mockRejectedValue(new Error('fetcher unavailable'));

    const [state] = await engine.checkAssetStatus();
    // Disk check failed but in-session progress still proves it's downloaded.
    expect(state.status).toBe('downloaded');
  });

  it('speak() asks the bridge to re-mount when the model was freed, then streams', async () => {
    const engine = new KokoroEngine();
    // The model was freed under memory pressure — no bridge attached. The bridge
    // registers a mount-requester that (re)attaches the handle when asked.
    engine._setMountRequester(() => engine._setBridge(noopHandle, 'af_heart'));

    await engine.speak('hello');

    expect(noopHandle.speak).toHaveBeenCalledWith('hello', 1);
    expect(engine.getPhase()).toBe('ready');
  });

  it('speak() resolves when the bridge attaches asynchronously after the request', async () => {
    const engine = new KokoroEngine();
    engine._setMountRequester(() => {
      // Simulate React mounting the hook on a later tick.
      setTimeout(() => engine._setBridge(noopHandle, 'af_heart'), 50);
    });

    await engine.speak('async hello');
    expect(noopHandle.speak).toHaveBeenCalledWith('async hello', 1);
  });

  it('speak() rejects when no bridge can mount (unsupported device)', async () => {
    const engine = new KokoroEngine();
    // No mount-requester registered at all.
    await expect(engine.speak('nope')).rejects.toThrow(/bridge not mounted/i);
  });

  it('deleteAssets clears state and removes resources from disk', async () => {
    listDownloadedModels.mockResolvedValue([
      `/x/${KOKORO_FILES[0]}`,
      `/x/${KOKORO_FILES[1]}`,
    ]);
    const engine = new KokoroEngine();
    engine._setDownloadProgress(1);
    await engine.checkAssetStatus();
    expect(engine.isFullyDownloaded()).toBe(true);

    await engine.deleteAssets();
    expect(deleteResources).toHaveBeenCalled();

    // After deletion, disk is empty → not-downloaded.
    listDownloadedModels.mockResolvedValue([]);
    const [state] = await engine.checkAssetStatus();
    expect(state.status).toBe('not-downloaded');
    expect(engine.isFullyDownloaded()).toBe(false);
  });

  it('a conclusive empty disk scan beats stale in-session progress', async () => {
    // After a delete, a transient bridge re-render can leave _downloadProgress
    // at 1. A successful (conclusive) disk scan finding nothing must still report
    // not-downloaded — otherwise the Voice panel keeps showing "downloaded" after
    // a removal. (Contrast: when the scan THROWS, progress>=1 is trusted — see
    // the fetcher-unavailable case above.)
    const engine = new KokoroEngine();
    engine._setDownloadProgress(1); // stale leftover
    listDownloadedModels.mockResolvedValue([]); // conclusive: nothing on disk
    await engine.checkAssetStatus();
    expect(engine.isFullyDownloaded()).toBe(false);
  });
});
