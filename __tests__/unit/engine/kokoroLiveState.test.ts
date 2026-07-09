/**
 * KokoroEngine live-state completeness — the SINGLE source of truth is the live
 * download lifecycle, never a disk presence scan.
 *
 * Root cause this guards against (device-confirmed): executorch's BareResourceFetcher
 * creates each destination file BEFORE its bytes finish (and a prior interrupted
 * attempt leaves the whole set behind), so mid-download the full asset set is present
 * on disk. The old code derived completeness from that presence, so the Download
 * Manager showed Kokoro "downloaded" (82MB) the instant a download started while the
 * Voice Models tab correctly showed live progress (e.g. 61%).
 *
 * The invariant: whenever the live signal says a download is in flight
 * (0<progress<1 or phase 'downloading'), isFullyDownloaded() is FALSE and
 * getOverallDownloadProgress() returns the RAW fraction (not 1). A model reads
 * completed only when the live download genuinely finished (fetch resolved) or the
 * persisted completion flag was hydrated in.
 *
 * These fail against the old disk-scan logic and pass after the live-source fix.
 */
import { BareResourceFetcher } from 'react-native-executorch-bare-resource-fetcher';
import { KokoroEngine } from '../../../pro/audio/engine/tts/engines/kokoro/KokoroEngine';

const listDownloadedFiles = BareResourceFetcher.listDownloadedFiles as jest.Mock;
const deleteResources = BareResourceFetcher.deleteResources as jest.Mock;
const fetchResources = (BareResourceFetcher as any).fetch as jest.Mock;

const KOKORO_FILES = [
  'duration_predictor.pte',
  'synthesizer.pte',
  'af_heart.bin',
  'tagger.pt',
  'lexicon.json',
];
// Every required basename present on disk — the false-positive condition.
const allOnDisk = () => KOKORO_FILES.map((f) => `/data/react-native-executorch/${f}`);

describe('KokoroEngine — live download lifecycle is the source of truth', () => {
  beforeEach(() => {
    listDownloadedFiles.mockReset().mockResolvedValue([]);
    deleteResources.mockReset().mockResolvedValue(undefined);
    fetchResources?.mockReset().mockResolvedValue(undefined);
  });

  it('an in-flight download with all files "present" on disk is NOT downloaded, and progress is the raw fraction', async () => {
    // The exact device bug: BareResourceFetcher reports every file present mid-fetch.
    listDownloadedFiles.mockResolvedValue(allOnDisk());
    const engine = new KokoroEngine();

    // Live download in progress (phase 'downloading', 0<progress<1).
    engine._setDownloadProgress(0.42);
    expect(engine.getPhase()).toBe('downloading');

    // FAILS on the old disk-scan logic (files present ⇒ downloaded / progress 1).
    expect(engine.isFullyDownloaded()).toBe(false);
    expect(engine.getOverallDownloadProgress()).toBeCloseTo(0.42); // raw, never 1

    // And the provider-facing status probe agrees.
    const [state] = await engine.checkAssetStatus();
    expect(state.status).toBe('downloading');
    expect(state.progress).toBeCloseTo(0.42);
  });

  it('a genuinely completed download (fetch resolved) reads completed', async () => {
    const engine = new KokoroEngine();
    fetchResources.mockResolvedValueOnce(undefined); // fetch finishes = all bytes landed

    await engine.downloadAssets();

    expect(engine.isFullyDownloaded()).toBe(true);
    expect(engine.getOverallDownloadProgress()).toBe(1);
    const [state] = await engine.checkAssetStatus();
    expect(state.status).toBe('downloaded');
    expect(state.progress).toBe(1);
  });

  it('a persisted completion hydrated on boot reads completed without any disk scan', async () => {
    listDownloadedFiles.mockRejectedValue(new Error('FS not ready')); // no disk dependency
    const engine = new KokoroEngine();

    engine.hydrateDownloaded(true);

    expect(engine.isFullyDownloaded()).toBe(true);
    const [state] = await engine.checkAssetStatus();
    expect(state.status).toBe('downloaded');
  });

  it('a fresh downloadAssets() resets a stale hydrated completion and reads downloading mid-fetch', async () => {
    // Device bug: a prior download's completion flag is hydrated true on boot, but the
    // files were deleted while the flag stayed latched. A re-download must NOT
    // short-circuit off that stale flag — during the fresh fetch the DM must show
    // 'downloading', not 'completed'.
    const engine = new KokoroEngine();
    engine.hydrateDownloaded(true); // stale/latched prior completion
    expect(engine.isFullyDownloaded()).toBe(true);

    // fetch stays pending so we can sample the mid-fetch state.
    let resolveFetch!: () => void;
    fetchResources.mockImplementationOnce(
      () => new Promise<void>((r) => { resolveFetch = r; }),
    );

    const p = engine.downloadAssets();

    // MID-FETCH: the stale flag was reset, phase is 'downloading' → NOT complete.
    // FAILS on the old early-return (stale _genuineCompletion faked progress=1 + done).
    expect(engine.getPhase()).toBe('downloading');
    expect(engine.isFullyDownloaded()).toBe(false);
    expect(engine.getOverallDownloadProgress()).toBeLessThan(1);
    const [midState] = await engine.checkAssetStatus();
    expect(midState.status).toBe('downloading');

    // Only after the fetch genuinely resolves does it read completed.
    resolveFetch();
    await p;
    expect(engine.isFullyDownloaded()).toBe(true);
    expect(engine.getOverallDownloadProgress()).toBe(1);
  });

  it('an executorch bridge attaching MID-DOWNLOAD must not flip phase to ready or read as downloaded', async () => {
    // Device-confirmed mechanism: the bridge (react-native-executorch handle) registers
    // itself while a fetch is still running. _setBridge() used to force phase 'ready'
    // for any phase except processing/paused — so it clobbered 'downloading' → 'ready',
    // and isFullyDownloaded() (which read phase === 'ready') then reported the model
    // "downloaded" in the Download Manager while the download was still in flight.
    const engine = new KokoroEngine();
    engine._setDownloadProgress(0.3); // live fetch in progress
    expect(engine.getPhase()).toBe('downloading');

    // Bridge attaches mid-download.
    engine._setBridge({} as any, 'af_heart' as any);

    // Phase must stay 'downloading' (not clobbered), and completeness stays false.
    // FAILS before the fix (phase → 'ready', isFullyDownloaded → true).
    expect(engine.getPhase()).toBe('downloading');
    expect(engine.isFullyDownloaded()).toBe(false);
    const [state] = await engine.checkAssetStatus();
    expect(state.status).toBe('downloading');
  });

  it('a mounted runtime bridge is NOT proof of a completed download (runtime-ready != assets-downloaded)', async () => {
    // The conflation the fix removes: _phase === 'ready' means the executorch runtime
    // mounted, NOT that the asset fetch finished. Without a genuine completion (no
    // resolved fetch, no hydrated flag), a ready bridge must read as NOT downloaded.
    const engine = new KokoroEngine();
    engine._setBridge({} as any, 'af_heart' as any); // bridge mounts from idle → phase 'ready'
    expect(engine.getPhase()).toBe('ready');

    // FAILS before the fix (isFullyDownloaded returned true off _phase === 'ready').
    expect(engine.isFullyDownloaded()).toBe(false);
    const [state] = await engine.checkAssetStatus();
    expect(state.status).toBe('not-downloaded');
  });

  it('cold start: a hydrated (downloaded) engine whose bridge then mounts goes ready and STAYS downloaded', async () => {
    // Guards that the _setBridge fix (excluding 'downloading' from the →ready clobber)
    // is behavior-neutral for the normal path: on a cold start the model is already on
    // disk (genuineCompletion hydrated true), the bridge mounts from 'idle', so phase
    // must still advance to 'ready' AND completeness must remain true.
    const engine = new KokoroEngine();
    engine.hydrateDownloaded(true);
    expect(engine.getPhase()).toBe('idle');

    engine._setBridge({} as any, 'af_heart' as any); // bridge attaches from idle

    expect(engine.getPhase()).toBe('ready');       // idle→ready still allowed
    expect(engine.isFullyDownloaded()).toBe(true); // genuine completion persists
    const [state] = await engine.checkAssetStatus();
    expect(state.status).toBe('downloaded');
  });

  it('delete flips it back to not-downloaded even if leftover files linger on disk', async () => {
    const engine = new KokoroEngine();
    engine.hydrateDownloaded(true);
    expect(engine.isFullyDownloaded()).toBe(true);

    deleteResources.mockResolvedValue(undefined);
    listDownloadedFiles.mockResolvedValue(allOnDisk()); // cache lag: files still present
    await engine.deleteAssets();

    expect(engine.isFullyDownloaded()).toBe(false);
    expect(engine.getOverallDownloadProgress()).toBe(0);
    const [state] = await engine.checkAssetStatus();
    expect(state.status).toBe('not-downloaded');
  });
});
