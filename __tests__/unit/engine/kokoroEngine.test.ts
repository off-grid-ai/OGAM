/** Kokoro public engine contract. Only the device resource cache and native bridge are faked. */
import { KokoroEngine, type KokoroBridgeHandle } from '../../../pro/audio/engine/tts/engines/kokoro/KokoroEngine';

import { installKokoroResourceBoundary } from '../../harness/kokoroResourceBoundary';

let cache: ReturnType<typeof installKokoroResourceBoundary>;
const KOKORO_FILES = ['duration_predictor.pte', 'synthesizer.pte', 'af_heart.bin', 'tagger.pt', 'lexicon.json', 'phonemizer.pte'];
const allOnDisk = () => KOKORO_FILES.map(f => `/docs/react-native-executorch/${f}`);
const spoken: Array<{ text: string; speed: number }> = [];
const noopHandle: KokoroBridgeHandle = {
  speak: async (text, speed) => { spoken.push({ text, speed }); },
  stop: () => {}, pause: () => {}, resume: () => {}, setSpeed: () => {}, setKeepAlive: () => {},
};

describe('KokoroEngine install status', () => {
  beforeEach(() => {
    cache = installKokoroResourceBoundary();
    spoken.length = 0;
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
    cache.failFetch(new Error('Resource is already downloading'));

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
    cache.failFetch(new Error('already downloading'));

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

    cache.failFetch(new Error('A ready runtime must not start a transfer'));
    await engine.downloadAssets();

    expect(cache.files.size).toBe(0); // A ready runtime does not start a transfer.
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

  it('REGRESSION: an incomplete final asset set reads NOT downloaded', async () => {
    // Only five of six required files reached the completed directory.
    allOnDisk().slice(0, -1).forEach(path => cache.files.add(path));
    const engine = new KokoroEngine(); // …but no fetch finished this session
    const [state] = await engine.checkAssetStatus();
    expect(state.status).toBe('not-downloaded');
    expect(engine.isFullyDownloaded()).toBe(false);
  });

  it('reports downloaded once the persisted flag is hydrated (cold start / no bridge)', async () => {
    const engine = new KokoroEngine();
    cache.seedVoice();
    engine.hydrateDownloaded(true); // the store seeds the cross-restart flag

    const [state] = await engine.checkAssetStatus();
    expect(state.status).toBe('downloaded');
    expect(state.progress).toBe(1);
    expect(engine.getPhase()).toBe('idle');
    expect(engine.isFullyDownloaded()).toBe(true);
    expect(engine.getOverallDownloadProgress()).toBe(0); // raw live progress, NOT forced to 1
  });

  it('REGRESSION: a live download reports downloading even when ALL files are already on disk', async () => {
    // Even if a previous copy is present, a live transfer must take priority.
    allOnDisk().forEach(path => cache.files.add(path)); // every basename present
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
    allOnDisk().forEach(path => cache.files.add(path));
    const engine = new KokoroEngine();
    engine._setDownloadProgress(0.61); // Voice panel shows 61%
    expect(engine.getOverallDownloadProgress()).toBeCloseTo(0.61);
    expect(engine.isFullyDownloaded()).toBe(false);
  });

  it('REGRESSION: stays downloaded after the bridge unmounts (engine switch)', async () => {
    const engine = new KokoroEngine();

    // 1. Model genuinely finishes downloading (fetch resolves → genuine completion),
    //    then the bridge mounts and the engine becomes ready.
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
    cache.seedVoice();
    engine.hydrateDownloaded(true);
    await engine.checkAssetStatus();

    // Voice change path resets in-memory progress to show a loader.
    engine._setDownloadProgress(0);

    const [state] = await engine.checkAssetStatus();
    expect(state.status).toBe('downloaded'); // genuine-completion flag still set
  });

  it('does not regress to not-downloaded if the fetcher throws during a status probe', async () => {
    const engine = new KokoroEngine();
    await engine.downloadAssets(); // genuine completion this session
    cache.failReads(new Error('fetcher unavailable'));

    const [state] = await engine.checkAssetStatus();
    // A read error does not prove a completed file was removed.
    expect(state.status).toBe('downloaded');
  });

  it('downloadAssets records genuine completion once the fetch resolves', async () => {
    allOnDisk().forEach(path => cache.files.add(path)); // leftover partials present
    const engine = new KokoroEngine();
    // Presence alone is not completeness — a fresh intent still fetches.
    expect(engine.isFullyDownloaded()).toBe(false);

    await engine.downloadAssets();

    expect([...cache.files].some(path => path.includes('example.test_'))).toBe(true); // The transfer wrote final files.
    expect(engine.isFullyDownloaded()).toBe(true);
    expect(engine.getOverallDownloadProgress()).toBe(1);
    const [state] = await engine.checkAssetStatus();
    expect(state.status).toBe('downloaded');
  });

  it('speak() asks the bridge to re-mount when the model was freed, then streams', async () => {
    const engine = new KokoroEngine();
    engine._setMountRequester(() => engine._setBridge(noopHandle, 'af_heart'));

    await engine.speak('hello');

    expect(spoken).toEqual([{ text: 'hello', speed: 1 }]);
    expect(engine.getPhase()).toBe('ready');
  });

  it('speak() resolves when the bridge attaches asynchronously after the request', async () => {
    const engine = new KokoroEngine();
    engine._setMountRequester(() => {
      setTimeout(() => engine._setBridge(noopHandle, 'af_heart'), 50);
    });

    await engine.speak('async hello');
    expect(spoken).toEqual([{ text: 'async hello', speed: 1 }]);
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
    const requester = () => engine._setBridge(noopHandle, 'af_heart');
    engine._setMountRequester(requester);
    await engine.initialize(); // first mount
    engine._setMountRequester(() => { throw new Error('Runtime is already mounted'); });

    await engine.initialize(); // already ready → must not re-request a mount
    expect(engine.getPhase()).toBe('ready');
  });

  it('initialize() rejects when no bridge can mount (unsupported device)', async () => {
    const engine = new KokoroEngine();
    await expect(engine.initialize()).rejects.toThrow(/bridge not mounted/i);
  });

  it('release() asks the bridge to unmount so the executorch model is actually freed', async () => {
    const engine = new KokoroEngine();
    let mounted = true;
    const unmount = () => { mounted = false; };
    engine._setUnmountRequester(unmount);
    engine._setBridge(noopHandle, 'af_heart');
    expect(engine.getPhase()).toBe('ready');
    await engine.release();
    expect(mounted).toBe(false);
    expect(engine.getPhase()).toBe('idle');
  });

  it('deleteAssets clears completion and removes resources from disk', async () => {
    const engine = new KokoroEngine();
    cache.seedVoice();
    engine.hydrateDownloaded(true);
    await engine.checkAssetStatus();
    expect(engine.isFullyDownloaded()).toBe(true);

    await engine.deleteAssets();
    expect(cache.files.size).toBe(0);

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
    cache.seedVoice();
    engine.hydrateDownloaded(true);
    await engine.checkAssetStatus();

    await engine.deleteAssets();

    for (const f of KOKORO_FILES) {
      expect([...cache.files].some(path => path.endsWith(f))).toBe(false);
    }
  });

  it('REGRESSION: delete reads not-downloaded even if the executorch cache lags and leaves files behind', async () => {
    const engine = new KokoroEngine();
    cache.seedVoice();
    engine.hydrateDownloaded(true);
    await engine.checkAssetStatus();
    expect(engine.isFullyDownloaded()).toBe(true);

    // Interrupted transfer files remain in the temporary cache after deleting final files.
    allOnDisk().forEach(path => cache.files.add(path.replace('/docs/react-native-executorch', '/caches')));
    await engine.deleteAssets();

    expect([...cache.files].filter(path => path.startsWith('/caches/'))).toHaveLength(KOKORO_FILES.length);
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
    cache.seedVoice();
    engine.hydrateDownloaded(true);
    expect(engine.isFullyDownloaded()).toBe(true);

    await engine.deleteAssets();

    expect(engine.getOverallDownloadProgress()).toBe(0);
    expect(engine.isFullyDownloaded()).toBe(false);
  });
});
