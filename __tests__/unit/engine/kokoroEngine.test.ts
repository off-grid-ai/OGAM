/**
 * KokoroEngine unit tests — install-status detection.
 *
 * The LIVE download lifecycle is the single source of truth for completeness.
 * A disk presence scan is NOT used: executorch creates each destination file
 * before its bytes finish (and a prior interrupted attempt leaves the whole set
 * behind), so file presence is a false positive mid-download — the bug where the
 * Download Manager showed Kokoro "completed" (82MB) while the Voice panel honestly
 * showed 3-61%.
 *
 * "Downloaded" is therefore true only when the asset fetch GENUINELY finished this
 * session (downloadAssets/setVoice's fetch resolved) or the persisted cross-restart
 * flag was hydrated in (hydrateDownloaded) — the single _genuineCompletion signal.
 * It is NOT inferred from a mounted runtime (phase==='ready' means the executorch
 * bridge attached, which happens mid-download too) nor from a raw progress tick, and
 * it is NEVER true while phase==='downloading' or 0<progress<1.
 */
import { BareResourceFetcher } from 'react-native-executorch-bare-resource-fetcher';
import { KokoroEngine, type KokoroBridgeHandle } from '../../../pro/audio/engine/tts/engines/kokoro/KokoroEngine';

const listDownloadedFiles =
  BareResourceFetcher.listDownloadedFiles as jest.Mock;
const deleteResources = BareResourceFetcher.deleteResources as jest.Mock;
const fetchResources = (BareResourceFetcher as any).fetch as jest.Mock;

// The two shared core .pte models.
const KOKORO_CORE_FILES = ['duration_predictor.pte', 'synthesizer.pte'];
// The active voice's own assets (see the enriched mockVoiceConfig in jest.setup).
const KOKORO_VOICE_FILES = ['af_heart.bin', 'tagger.pt', 'lexicon.json'];
// A COMPLETE download = core models + the active voice's assets.
const KOKORO_FILES = [...KOKORO_CORE_FILES, ...KOKORO_VOICE_FILES];

const noopHandle: KokoroBridgeHandle = {
  speak: jest.fn().mockResolvedValue(undefined),
  stop: jest.fn(),
  pause: jest.fn(),
  resume: jest.fn(),
  setSpeed: jest.fn(),
  setKeepAlive: jest.fn(),
};

// All cached files for a COMPLETE download, as executorch-style cache paths.
const allOnDisk = () => KOKORO_FILES.map((f) => `/data/react-native-executorch/${f}`);

describe('KokoroEngine install status', () => {
  beforeEach(() => {
    listDownloadedFiles.mockReset();
    deleteResources.mockReset().mockResolvedValue(undefined);
    fetchResources?.mockReset().mockResolvedValue(undefined);
    listDownloadedFiles.mockResolvedValue([]);
  });

  it('REGRESSION: a benign "already downloading" collision does not leave the voice stuck at downloading (F23)', async () => {
    // Two overlapping downloadAssets() for the same shared sources: executorch throws
    // "already downloading" on the losing one. That fetch drives progress on ITS own
    // instance, not this one, so returning early here would strand this instance at
    // phase 'downloading' forever (the stuck Voice-row bug). We settle off our own
    // genuine-completion state — never stuck 'downloading'. This instance never
    // recorded a completion, so it settles to idle (the concurrent path / persisted
    // flag establishes completion for the shared cache).
    const engine = new KokoroEngine();
    fetchResources.mockRejectedValueOnce(new Error('Resource is already downloading'));

    await engine.downloadAssets(); // must not throw

    expect(engine.getPhase()).not.toBe('downloading');
    expect(engine.getPhase()).toBe('idle');
    expect(engine.isFullyDownloaded()).toBe(false);
  });

  it('REGRESSION: a fresh downloadAssets() discards a stale hydrated flag; a benign collision then settles to not-downloaded (F23)', async () => {
    // A fresh downloadAssets() is an authoritative (re)download intent, so the stale
    // hydrated completion is reset up front — it must NOT let the fresh download
    // short-circuit (the deleted-files-but-latched-flag bug: DM showed "downloaded" the
    // instant a re-download began). With completion reset and no runtime ready, a benign
    // "already downloading" collision can't confirm the concurrent fetch finished, so we
    // settle to idle / not-downloaded rather than resurrecting the stale flag.
    const engine = new KokoroEngine();
    engine.hydrateDownloaded(true); // stale/latched persisted completion
    fetchResources.mockRejectedValueOnce(new Error('already downloading'));

    await engine.downloadAssets();

    expect(engine.getPhase()).toBe('idle');
    expect(engine.isFullyDownloaded()).toBe(false); // stale flag was discarded, not honored
  });

  it('REGRESSION: a live runtime that is ready short-circuits downloadAssets() and stays downloaded (F23)', async () => {
    // The ONE legitimate short-circuit: the model is verifiably ready THIS session
    // (bridge mounted + phase 'ready'), so the assets are present-and-usable and no
    // fetch is needed. This is present-and-usable proof, not a stale persisted flag.
    const engine = new KokoroEngine();
    engine._setBridge({} as never, 'af_heart' as never); // ready + bridge mounted this session
    expect(engine.getPhase()).toBe('ready');

    await engine.downloadAssets();

    expect(fetchResources).not.toHaveBeenCalled(); // short-circuited, no re-fetch
    expect(engine.isFullyDownloaded()).toBe(true);
    expect(engine.getOverallDownloadProgress()).toBe(1);
  });

  it('reports not-downloaded when nothing has loaded or downloaded', async () => {
    const engine = new KokoroEngine();
    const [state] = await engine.checkAssetStatus();
    expect(state.status).toBe('not-downloaded');
    expect(state.progress).toBe(0);
    expect(engine.isFullyDownloaded()).toBe(false);
  });

  it('REGRESSION: files present on disk WITHOUT a genuine completion reads NOT downloaded', async () => {
    // The device-confirmed bug: executorch creates each destination file before its
    // bytes finish and a prior interrupted attempt leaves the whole set behind, so
    // the full basename set is present on disk mid-download. A pure disk-presence
    // scan reported the Download Manager "downloaded"/82MB while the Voice tab
    // honestly showed live progress. The live lifecycle — not disk presence — is the
    // source of truth, so presence alone is NOT downloaded.
    listDownloadedFiles.mockResolvedValue(allOnDisk()); // every basename present…
    const engine = new KokoroEngine(); // …but no fetch finished this session
    const [state] = await engine.checkAssetStatus();
    expect(state.status).toBe('not-downloaded');
    expect(engine.isFullyDownloaded()).toBe(false);
  });

  it('reports downloaded once the persisted flag is hydrated (cold start / no bridge)', async () => {
    const engine = new KokoroEngine();
    engine.hydrateDownloaded(true); // the store seeds the cross-restart flag

    const [state] = await engine.checkAssetStatus();
    expect(state.status).toBe('downloaded');
    expect(state.progress).toBe(1);
    expect(engine.getPhase()).toBe('idle');
    expect(engine.isFullyDownloaded()).toBe(true);
    expect(engine.getOverallDownloadProgress()).toBe(0); // raw live progress, NOT forced to 1
  });

  it('REGRESSION: a live download reports downloading even when ALL files are already on disk', async () => {
    // executorch lists a destination basename before its bytes finish (and a prior
    // interrupted attempt leaves files behind), so mid-download the full asset set
    // can be present on disk. The Download Manager then showed Kokoro completed
    // (82MB) while the Voice panel correctly showed 3%. A live download (phase
    // 'downloading' / fractional progress) must win.
    listDownloadedFiles.mockResolvedValue(allOnDisk()); // every basename present
    const engine = new KokoroEngine();
    engine._setDownloadProgress(0.03); // → phase 'downloading', progress 3%
    expect(engine.getPhase()).toBe('downloading');
    const [state] = await engine.checkAssetStatus();
    expect(state.status).toBe('downloading');
    expect(engine.isFullyDownloaded()).toBe(false);
    // getOverallDownloadProgress returns the RAW byte-stream fraction, never 1 from a scan.
    expect(engine.getOverallDownloadProgress()).toBeCloseTo(0.03);
    expect(state.progress).toBeCloseTo(0.03);
  });

  it('REGRESSION: mid-download progress is the raw fraction, not forced to 1 by disk presence', async () => {
    // getOverallDownloadProgress() must reflect the actual byte stream. Returning
    // isFullyDownloaded()?1:progress polluted progress with the disk scan and fed the
    // DM a premature "completed" — that path is gone.
    listDownloadedFiles.mockResolvedValue(allOnDisk());
    const engine = new KokoroEngine();
    engine._setDownloadProgress(0.61); // Voice panel shows 61%
    expect(engine.getOverallDownloadProgress()).toBeCloseTo(0.61);
    expect(engine.isFullyDownloaded()).toBe(false);
  });

  it('REGRESSION: stays downloaded after the bridge unmounts (engine switch)', async () => {
    const engine = new KokoroEngine();

    // 1. Model genuinely finishes downloading (fetch resolves → genuine completion),
    //    then the bridge mounts and the engine becomes ready.
    fetchResources.mockResolvedValueOnce(undefined);
    await engine.downloadAssets();
    engine._setBridge(noopHandle, 'af_heart');
    expect(engine.getPhase()).toBe('ready');
    let [state] = await engine.checkAssetStatus();
    expect(state.status).toBe('downloaded');

    // 2. User switches engine → Kokoro bridge unmounts. Phase drops to idle.
    engine._setBridge(null, 'af_heart');
    expect(engine.getPhase()).toBe('idle');

    // Must remain 'downloaded' — the genuine-completion signal persists across the
    // unmount; it is NOT tied to the transient runtime phase.
    [state] = await engine.checkAssetStatus();
    expect(state.status).toBe('downloaded');
    expect(state.progress).toBe(1);
  });

  it('stays downloaded across a voice switch that resets progress to 0', async () => {
    const engine = new KokoroEngine();
    engine.hydrateDownloaded(true);
    await engine.checkAssetStatus();

    // Voice change path resets in-memory progress to show a loader.
    engine._setDownloadProgress(0);

    const [state] = await engine.checkAssetStatus();
    expect(state.status).toBe('downloaded'); // genuine-completion flag still set
  });

  it('does not regress to not-downloaded if the fetcher throws during a status probe', async () => {
    const engine = new KokoroEngine();
    fetchResources.mockResolvedValueOnce(undefined);
    await engine.downloadAssets(); // genuine completion this session
    listDownloadedFiles.mockRejectedValue(new Error('fetcher unavailable'));

    const [state] = await engine.checkAssetStatus();
    // No disk dependency: the genuine-completion flag still proves it's downloaded.
    expect(state.status).toBe('downloaded');
  });

  it('downloadAssets records genuine completion once the fetch resolves', async () => {
    listDownloadedFiles.mockResolvedValue(allOnDisk()); // leftover partials present
    const engine = new KokoroEngine();
    // Presence alone is not completeness — a fresh intent still fetches.
    expect(engine.isFullyDownloaded()).toBe(false);

    fetchResources.mockResolvedValueOnce(undefined);
    await engine.downloadAssets();

    expect(fetchResources).toHaveBeenCalled(); // did NOT short-circuit off disk presence
    expect(engine.isFullyDownloaded()).toBe(true);
    expect(engine.getOverallDownloadProgress()).toBe(1);
    const [state] = await engine.checkAssetStatus();
    expect(state.status).toBe('downloaded');
  });

  it('speak() asks the bridge to re-mount when the model was freed, then streams', async () => {
    const engine = new KokoroEngine();
    engine._setMountRequester(() => engine._setBridge(noopHandle, 'af_heart'));

    await engine.speak('hello');

    expect(noopHandle.speak).toHaveBeenCalledWith('hello', 1);
    expect(engine.getPhase()).toBe('ready');
  });

  it('speak() resolves when the bridge attaches asynchronously after the request', async () => {
    const engine = new KokoroEngine();
    engine._setMountRequester(() => {
      setTimeout(() => engine._setBridge(noopHandle, 'af_heart'), 50);
    });

    await engine.speak('async hello');
    expect(noopHandle.speak).toHaveBeenCalledWith('async hello', 1);
  });

  it('speak() rejects when no bridge can mount (unsupported device)', async () => {
    const engine = new KokoroEngine();
    await expect(engine.speak('nope')).rejects.toThrow(/bridge not mounted/i);
  });

  it('initialize() remounts the bridge after a residency eviction (manual replay fix)', async () => {
    const engine = new KokoroEngine();
    engine._setMountRequester(() => engine._setBridge(noopHandle, 'af_heart'));
    expect(engine.getPhase()).toBe('idle');

    await engine.initialize();

    expect(engine.getPhase()).toBe('ready');
  });

  it('initialize() is a no-op when the bridge is already attached (ready)', async () => {
    const engine = new KokoroEngine();
    const requester = jest.fn(() => engine._setBridge(noopHandle, 'af_heart'));
    engine._setMountRequester(requester);
    await engine.initialize(); // first mount
    requester.mockClear();

    await engine.initialize(); // already ready → must not re-request a mount
    expect(requester).not.toHaveBeenCalled();
    expect(engine.getPhase()).toBe('ready');
  });

  it('initialize() rejects when no bridge can mount (unsupported device)', async () => {
    const engine = new KokoroEngine();
    await expect(engine.initialize()).rejects.toThrow(/bridge not mounted/i);
  });

  it('release() asks the bridge to unmount so the executorch model is actually freed', async () => {
    const engine = new KokoroEngine();
    const unmount = jest.fn();
    engine._setUnmountRequester(unmount);
    engine._setBridge(noopHandle, 'af_heart');
    expect(engine.getPhase()).toBe('ready');
    await engine.release();
    expect(unmount).toHaveBeenCalled();
    expect(engine.getPhase()).toBe('idle');
  });

  it('deleteAssets clears completion and removes resources from disk', async () => {
    const engine = new KokoroEngine();
    engine.hydrateDownloaded(true);
    await engine.checkAssetStatus();
    expect(engine.isFullyDownloaded()).toBe(true);

    await engine.deleteAssets();
    expect(deleteResources).toHaveBeenCalled();

    // Genuine-completion cleared → not-downloaded without a manual re-check.
    expect(engine.isFullyDownloaded()).toBe(false);
    const [state] = await engine.checkAssetStatus();
    expect(state.status).toBe('not-downloaded');
  });

  it('REGRESSION: deleteAssets removes the FULL active-voice set, not just the core .pte', async () => {
    // The bug: deleteAssets deleted only the two core .pte files, leaving the
    // voice embedding/tagger/lexicon on disk, so the model kept reading downloaded.
    // Delete must target the same set download uses.
    const engine = new KokoroEngine();
    engine.hydrateDownloaded(true);
    await engine.checkAssetStatus();

    await engine.deleteAssets();

    const deleted: string[] = deleteResources.mock.calls[0] ?? [];
    for (const f of KOKORO_FILES) {
      expect(deleted.some((url) => url.split(/[?#]/)[0].split('/').pop() === f)).toBe(true);
    }
  });

  it('REGRESSION: delete reads not-downloaded even if the executorch cache lags and leaves files behind', async () => {
    const engine = new KokoroEngine();
    engine.hydrateDownloaded(true);
    await engine.checkAssetStatus();
    expect(engine.isFullyDownloaded()).toBe(true);

    // deleteResources is a no-op that leaves files behind (the cache can lag) — the
    // completion flag being cleared must still make the model read as not-downloaded.
    deleteResources.mockResolvedValue(undefined);
    listDownloadedFiles.mockResolvedValue(allOnDisk()); // files linger
    await engine.deleteAssets();

    expect(engine.isFullyDownloaded()).toBe(false);
    const [state] = await engine.checkAssetStatus();
    expect(state.status).not.toBe('downloaded');
  });

  it('delete resets progress so stale in-session progress cannot re-report downloaded', async () => {
    // After a delete, deleteAssets resets _downloadProgress to 0 and clears the
    // completion flag, so a leftover progress value can't keep the Voice panel
    // showing "downloaded".
    const engine = new KokoroEngine();
    engine._setDownloadProgress(1);
    engine.hydrateDownloaded(true);
    expect(engine.isFullyDownloaded()).toBe(true);

    await engine.deleteAssets();

    expect(engine.getOverallDownloadProgress()).toBe(0);
    expect(engine.isFullyDownloaded()).toBe(false);
  });
});
