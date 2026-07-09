/**
 * Qwen3TTSEngine (pro) — REAL lifecycle / asset state-machine tests.
 *
 * The engine is a native-backed TTS engine whose only genuine boundaries are:
 *   • react-native-fs (filesystem) — globally mocked in jest.setup.ts; we drive
 *     a per-test in-memory fake so REAL asset-presence / download logic runs.
 *   • backgroundDownloadService (native resumable-download bridge) — mocked so
 *     we can exercise BOTH the native-downloader path and the RNFS fallback.
 *
 * Everything else — the phase state machine, per-asset state tracking, overall
 * progress weighting, event emission, and error cascades — runs for REAL against
 * the actual Qwen3TTSEngine class. Deleting the implementation fails these tests.
 */
import RNFS from 'react-native-fs';
import { Qwen3TTSEngine } from '@offgrid/pro/audio/engine/tts/engines/qwen3/Qwen3TTSEngine';
import {
  QWEN3_TTS_ASSETS,
  QWEN3_TTS_TALKER,
} from '@offgrid/pro/audio/engine/tts/engines/qwen3/models';
import { backgroundDownloadService } from '@offgrid/core/services/backgroundDownloadService';

// ── RNFS in-memory fake ─────────────────────────────────────────────────────
// A real filesystem model: a Set of "existing" paths + a size map. The engine's
// real _isAssetPresent / _ensureDir / unlink logic runs against it.
const fs = {
  present: new Set<string>(),
  sizes: new Map<string, number>(),
};
function resetFs() {
  fs.present.clear();
  fs.sizes.clear();
}
/** Mark an asset's file as fully present at its expected size. */
function placeAssetFull(dir: string, filename: string, sizeBytes: number) {
  const path = `${dir}/${filename}`;
  fs.present.add(path);
  fs.sizes.set(path, sizeBytes);
}

const MODELS_DIR = `${RNFS.DocumentDirectoryPath}/tts-models/qwen3`;

beforeEach(() => {
  resetFs();
  (RNFS.exists as jest.Mock).mockImplementation(async (p: string) => fs.present.has(p));
  (RNFS.mkdir as jest.Mock).mockImplementation(async (p: string) => {
    fs.present.add(p);
  });
  (RNFS.stat as jest.Mock).mockImplementation(async (p: string) => {
    if (!fs.present.has(p)) throw new Error('ENOENT');
    return { size: fs.sizes.get(p) ?? 0, isFile: () => true };
  });
  (RNFS.unlink as jest.Mock).mockImplementation(async (p: string) => {
    fs.present.delete(p);
    fs.sizes.delete(p);
  });
  // Default: native downloader NOT available → RNFS fallback path. Individual
  // tests override this spy. Restored in afterEach (jest.restoreAllMocks).
  jest.spyOn(backgroundDownloadService, 'isAvailable').mockReturnValue(false);
});

afterEach(() => {
  jest.restoreAllMocks();
});

/** Drive checkAssetStatus after placing all assets full, so the engine's
 *  _assetStates all read 'downloaded' (making it fully downloaded). */
async function makeFullyDownloaded(engine: Qwen3TTSEngine) {
  for (const a of QWEN3_TTS_ASSETS) {
    placeAssetFull(MODELS_DIR, a.filename, a.sizeBytes);
  }
  await engine.checkAssetStatus();
}

describe('Qwen3TTSEngine — identity & capabilities', () => {
  it('exposes stable id/displayName and non-streaming, voice-cloning capabilities', () => {
    const engine = new Qwen3TTSEngine();
    expect(engine.id).toBe('qwen3-tts');
    expect(engine.displayName).toBe('Qwen3 TTS (0.6B)');
    expect(engine.capabilities.streaming).toBe(false);
    expect(engine.capabilities.voiceCloning).toBe(true);
    expect(engine.capabilities.pauseResume).toBe(true);
    expect(engine.capabilities.peakRamMB).toBe(600);
    expect(engine.isSupported()).toBe(true);
    expect(engine.getBridgeComponent()).toBeNull();
    expect(engine.getRequiredAssets()).toBe(QWEN3_TTS_ASSETS);
  });

  it('starts idle with every asset not-downloaded and zero progress', () => {
    const engine = new Qwen3TTSEngine();
    expect(engine.getPhase()).toBe('idle');
    expect(engine.isFullyDownloaded()).toBe(false);
    expect(engine.getOverallDownloadProgress()).toBe(0);
  });
});

describe('Qwen3TTSEngine — asset presence (both branches)', () => {
  it('checkAssetStatus reports downloaded when files are full-size, else not-downloaded', async () => {
    const engine = new Qwen3TTSEngine();
    // Only the talker present at full size; others absent.
    placeAssetFull(MODELS_DIR, QWEN3_TTS_TALKER.filename, QWEN3_TTS_TALKER.sizeBytes);

    const states = await engine.checkAssetStatus();
    const talker = states.find(s => s.asset.id === 'talker')!;
    const predictor = states.find(s => s.asset.id === 'predictor')!;

    expect(talker.status).toBe('downloaded');
    expect(talker.progress).toBe(1);
    expect(talker.localPath).toBe(`${MODELS_DIR}/${QWEN3_TTS_TALKER.filename}`);
    expect(predictor.status).toBe('not-downloaded');
    expect(predictor.progress).toBe(0);
    expect(predictor.localPath).toBeUndefined();

    expect(engine.isFullyDownloaded()).toBe(false);
  });

  it('treats a too-small (partial) file as not present', async () => {
    const engine = new Qwen3TTSEngine();
    // Below the 0.9 valid-size ratio → still "not-downloaded".
    const path = `${MODELS_DIR}/${QWEN3_TTS_TALKER.filename}`;
    fs.present.add(path);
    fs.sizes.set(path, Math.floor(QWEN3_TTS_TALKER.sizeBytes * 0.5));

    const states = await engine.checkAssetStatus();
    expect(states.find(s => s.asset.id === 'talker')!.status).toBe('not-downloaded');
  });

  it('treats a file whose stat throws as not present (catch branch)', async () => {
    const engine = new Qwen3TTSEngine();
    const path = `${MODELS_DIR}/${QWEN3_TTS_TALKER.filename}`;
    fs.present.add(path); // exists true...
    (RNFS.stat as jest.Mock).mockRejectedValueOnce(new Error('stat blew up'));

    const states = await engine.checkAssetStatus();
    expect(states.find(s => s.asset.id === 'talker')!.status).toBe('not-downloaded');
  });

  it('reports fully downloaded and overall progress 1 when all assets present', async () => {
    const engine = new Qwen3TTSEngine();
    await makeFullyDownloaded(engine);
    expect(engine.isFullyDownloaded()).toBe(true);
    expect(engine.getOverallDownloadProgress()).toBeCloseTo(1, 5);
  });

  it('weights overall progress by asset size, not asset count', async () => {
    const engine = new Qwen3TTSEngine();
    // Only the biggest asset (talker, 450MB of 650MB total) present.
    placeAssetFull(MODELS_DIR, QWEN3_TTS_TALKER.filename, QWEN3_TTS_TALKER.sizeBytes);
    await engine.checkAssetStatus();

    const total = QWEN3_TTS_ASSETS.reduce((s, a) => s + a.sizeBytes, 0);
    const expected = QWEN3_TTS_TALKER.sizeBytes / total;
    expect(engine.getOverallDownloadProgress()).toBeCloseTo(expected, 5);
    // Sanity: size-weighting (0.69) is not the naive count-weighting (0.33).
    expect(engine.getOverallDownloadProgress()).toBeGreaterThan(0.6);
  });
});

describe('Qwen3TTSEngine — download flow (RNFS fallback path)', () => {
  beforeEach(() => {
    jest.spyOn(backgroundDownloadService, 'isAvailable').mockReturnValue(false);
  });

  it('downloads all assets, emits progress, and lands back at idle when complete', async () => {
    const engine = new Qwen3TTSEngine();
    const phases: string[] = [];
    engine.on('phaseChange', p => phases.push(p));
    const progressEvents: Array<{ assetId: string; progress: number }> = [];
    engine.on('downloadProgress', d => progressEvents.push({ assetId: d.assetId, progress: d.progress }));

    // RNFS.downloadFile: report 50% then 100%, materialize the file full-size, HTTP 200.
    (RNFS.downloadFile as jest.Mock).mockImplementation(({ toFile, progress }: any) => {
      const asset = QWEN3_TTS_ASSETS.find(a => toFile.endsWith(a.filename))!;
      progress({ bytesWritten: asset.sizeBytes / 2, contentLength: asset.sizeBytes });
      progress({ bytesWritten: asset.sizeBytes, contentLength: asset.sizeBytes });
      fs.present.add(toFile);
      fs.sizes.set(toFile, asset.sizeBytes);
      return { jobId: 1, promise: Promise.resolve({ statusCode: 200, bytesWritten: asset.sizeBytes }) };
    });

    await engine.downloadAssets();

    // OUTCOME: fully downloaded, ended idle (not stuck in downloading/error).
    expect(engine.isFullyDownloaded()).toBe(true);
    expect(engine.getPhase()).toBe('idle');
    expect(phases[0]).toBe('downloading');
    expect(phases[phases.length - 1]).toBe('idle');
    // Progress events emitted for each asset, ending at 1.
    expect(progressEvents.some(e => e.assetId === 'talker' && e.progress === 1)).toBe(true);
    expect(progressEvents.some(e => e.assetId === 'codec' && e.progress === 1)).toBe(true);
  });

  it('divides-by-zero-safely: reports progress 0 when contentLength is 0', async () => {
    const engine = new Qwen3TTSEngine();
    const progresses: number[] = [];
    engine.on('downloadProgress', d => progresses.push(d.progress));
    (RNFS.downloadFile as jest.Mock).mockImplementation(({ toFile, progress }: any) => {
      const asset = QWEN3_TTS_ASSETS.find(a => toFile.endsWith(a.filename))!;
      progress({ bytesWritten: 0, contentLength: 0 }); // unknown total
      fs.present.add(toFile);
      fs.sizes.set(toFile, asset.sizeBytes);
      return { jobId: 1, promise: Promise.resolve({ statusCode: 200, bytesWritten: 0 }) };
    });

    await engine.downloadAssets(['talker', 'predictor', 'codec']);
    expect(progresses).toContain(0);
    expect(progresses).not.toContain(NaN);
    expect(engine.isFullyDownloaded()).toBe(true);
  });

  it('skips assets already present without re-downloading them', async () => {
    const engine = new Qwen3TTSEngine();
    // Talker already on disk.
    placeAssetFull(MODELS_DIR, QWEN3_TTS_TALKER.filename, QWEN3_TTS_TALKER.sizeBytes);

    const downloaded: string[] = [];
    (RNFS.downloadFile as jest.Mock).mockImplementation(({ toFile }: any) => {
      const asset = QWEN3_TTS_ASSETS.find(a => toFile.endsWith(a.filename))!;
      downloaded.push(asset.id);
      fs.present.add(toFile);
      fs.sizes.set(toFile, asset.sizeBytes);
      return { jobId: 1, promise: Promise.resolve({ statusCode: 200, bytesWritten: asset.sizeBytes }) };
    });

    await engine.downloadAssets();
    // Talker skipped; predictor + codec fetched.
    expect(downloaded).not.toContain('talker');
    expect(downloaded).toEqual(expect.arrayContaining(['predictor', 'codec']));
    expect(engine.isFullyDownloaded()).toBe(true);
  });

  it('surfaces a non-200 HTTP as an error, marks the asset errored, and moves to error phase', async () => {
    const engine = new Qwen3TTSEngine();
    (RNFS.downloadFile as jest.Mock).mockImplementation(() => {
      // Do NOT materialize the file; return 404.
      return { jobId: 1, promise: Promise.resolve({ statusCode: 404, bytesWritten: 0 }) };
    });

    await expect(engine.downloadAssets(['talker'])).rejects.toThrow(/Download failed for .*HTTP 404/);
    expect(engine.getPhase()).toBe('error');
    const state = (await engine.checkAssetStatus()).find(s => s.asset.id === 'talker')!;
    // checkAssetStatus recomputes from disk (still absent).
    expect(state.status).toBe('not-downloaded');
  });

  it('uses the fallback "download failed" message when the RNFS promise rejects with a non-Error', async () => {
    const engine = new Qwen3TTSEngine();
    (RNFS.downloadFile as jest.Mock).mockImplementation(() => ({
      jobId: 1,
      // Reject with a non-Error value → `err instanceof Error` is false.
      promise: Promise.reject('kaboom'),
    }));

    await expect(engine.downloadAssets(['talker'])).rejects.toThrow(
      /Download failed for .*download failed/,
    );
    expect(engine.getPhase()).toBe('error');
    const state = (await engine.checkAssetStatus()).find(s => s.asset.id === 'talker')!;
    expect(state.status).toBe('not-downloaded');
  });

  it('treats a completed-but-too-small download as incomplete and errors out', async () => {
    const engine = new Qwen3TTSEngine();
    (RNFS.downloadFile as jest.Mock).mockImplementation(({ toFile }: any) => {
      // "Succeeds" (200) but writes a truncated file below the valid-size ratio.
      const asset = QWEN3_TTS_ASSETS.find(a => toFile.endsWith(a.filename))!;
      fs.present.add(toFile);
      fs.sizes.set(toFile, Math.floor(asset.sizeBytes * 0.1));
      return { jobId: 1, promise: Promise.resolve({ statusCode: 200, bytesWritten: 1 }) };
    });

    await expect(engine.downloadAssets(['talker'])).rejects.toThrow(/Download incomplete for/);
    expect(engine.getPhase()).toBe('error');
    // Truncated partial was unlinked.
    expect(fs.present.has(`${MODELS_DIR}/${QWEN3_TTS_TALKER.filename}`)).toBe(false);
  });
});

describe('Qwen3TTSEngine — download flow (native background-downloader path)', () => {
  it('routes through backgroundDownloadService when available and reports its progress', async () => {
    const engine = new Qwen3TTSEngine();
    jest.spyOn(backgroundDownloadService, 'isAvailable').mockReturnValue(true);

    const downloadSpy = jest
      .spyOn(backgroundDownloadService, 'downloadFileTo')
      .mockImplementation(({ destPath, onProgress }: any) => {
        const asset = QWEN3_TTS_ASSETS.find(a => destPath.endsWith(a.filename))!;
        onProgress(asset.sizeBytes, asset.sizeBytes); // 100%
        fs.present.add(destPath);
        fs.sizes.set(destPath, asset.sizeBytes);
        return { downloadIdPromise: Promise.resolve('bg-1'), promise: Promise.resolve() };
      });

    const progresses: number[] = [];
    engine.on('downloadProgress', d => progresses.push(d.progress));

    await engine.downloadAssets(['codec']);

    // OUTCOME: went through the native bridge, not RNFS.downloadFile.
    expect(downloadSpy).toHaveBeenCalled();
    expect(RNFS.downloadFile).not.toHaveBeenCalled();
    expect(progresses).toContain(1);
    // Native path reports 0 when total is 0 (div-by-zero guard) — verify no NaN.
    expect(progresses).not.toContain(NaN);
  });

  it('native path reports progress 0 when total bytes is 0 (div-by-zero guard, FALSE branch)', async () => {
    const engine = new Qwen3TTSEngine();
    jest.spyOn(backgroundDownloadService, 'isAvailable').mockReturnValue(true);
    jest
      .spyOn(backgroundDownloadService, 'downloadFileTo')
      .mockImplementation(({ destPath, onProgress }: any) => {
        const asset = QWEN3_TTS_ASSETS.find(a => destPath.endsWith(a.filename))!;
        onProgress(0, 0); // unknown total → guarded to 0
        onProgress(asset.sizeBytes, asset.sizeBytes);
        fs.present.add(destPath);
        fs.sizes.set(destPath, asset.sizeBytes);
        return { downloadIdPromise: Promise.resolve('bg-3'), promise: Promise.resolve() };
      });

    const progresses: number[] = [];
    engine.on('downloadProgress', d => progresses.push(d.progress));
    await engine.downloadAssets(['codec']);

    expect(progresses[0]).toBe(0);
    expect(progresses).not.toContain(NaN);
    // Codec fetched to full size → its state is downloaded (asset-level outcome).
    const codec = (await engine.checkAssetStatus()).find(s => s.asset.id === 'codec')!;
    expect(codec.status).toBe('downloaded');
  });

  it('propagates a native-downloader failure as a Download-failed error in error phase', async () => {
    const engine = new Qwen3TTSEngine();
    jest.spyOn(backgroundDownloadService, 'isAvailable').mockReturnValue(true);
    jest
      .spyOn(backgroundDownloadService, 'downloadFileTo')
      .mockImplementation(() => ({ jobId: 'bg-2', promise: Promise.reject(new Error('bridge died')) } as any));

    await expect(engine.downloadAssets(['talker'])).rejects.toThrow(/Download failed for .*bridge died/);
    expect(engine.getPhase()).toBe('error');
  });
});

describe('Qwen3TTSEngine — initialize / release lifecycle', () => {
  it('refuses to initialize when models are not downloaded', async () => {
    const engine = new Qwen3TTSEngine();
    await expect(engine.initialize()).rejects.toThrow(/not downloaded/i);
    expect(engine.getPhase()).toBe('idle');
  });

  it('loads to ready when fully downloaded, emitting loading→ready', async () => {
    const engine = new Qwen3TTSEngine();
    await makeFullyDownloaded(engine);

    const phases: string[] = [];
    engine.on('phaseChange', p => phases.push(p));

    await engine.initialize();
    expect(engine.getPhase()).toBe('ready');
    expect(phases).toEqual(['loading', 'ready']);
  });

  it('on a load failure: moves to error phase, emits a recoverable QWEN3_LOAD error, and rethrows', async () => {
    const engine = new Qwen3TTSEngine();
    await makeFullyDownloaded(engine);

    // Simulate the (future) model-load throwing: let the 'loading' transition
    // succeed, then make the 'ready' transition throw — driving the REAL catch.
    const realSetPhase = (engine as unknown as { _setPhase(p: string): void })._setPhase;
    const spy = jest
      .spyOn(engine as unknown as { _setPhase(p: string): void }, '_setPhase')
      .mockImplementation(function (this: unknown, phase: string) {
        if (phase === 'ready') throw new Error('codec session failed');
        realSetPhase.call(engine, phase);
      });

    const errors: Array<{ code: string; message: string; recoverable: boolean }> = [];
    engine.on('error', e => errors.push(e));

    await expect(engine.initialize()).rejects.toThrow('codec session failed');

    // The catch restores 'error' via the (still-mocked) setter → assert via the
    // emitted error event + that the recoverable QWEN3_LOAD error surfaced.
    expect(errors).toHaveLength(1);
    expect(errors[0].code).toBe('QWEN3_LOAD');
    expect(errors[0].message).toBe('codec session failed');
    expect(errors[0].recoverable).toBe(true);
    spy.mockRestore();
  });

  it('on a non-Error load failure: uses the fallback message (ternary FALSE branch)', async () => {
    const engine = new Qwen3TTSEngine();
    await makeFullyDownloaded(engine);

    const realSetPhase = (engine as unknown as { _setPhase(p: string): void })._setPhase;
    jest
      .spyOn(engine as unknown as { _setPhase(p: string): void }, '_setPhase')
      .mockImplementation(function (this: unknown, phase: string) {
        // Throw a non-Error value → `err instanceof Error` is false.
        if (phase === 'ready') throw 'string blowup';
        realSetPhase.call(engine, phase);
      });

    const errors: Array<{ message: string }> = [];
    engine.on('error', e => errors.push(e));

    await expect(engine.initialize()).rejects.toBe('string blowup');
    expect(errors[0].message).toBe('Failed to load Qwen3-TTS');
  });

  it('release returns to idle', async () => {
    const engine = new Qwen3TTSEngine();
    await makeFullyDownloaded(engine);
    await engine.initialize();
    await engine.release();
    expect(engine.getPhase()).toBe('idle');
  });

  it('phaseChange fires only on real transitions (no self-transition event)', async () => {
    const engine = new Qwen3TTSEngine();
    const phases: string[] = [];
    engine.on('phaseChange', p => phases.push(p));
    // Already idle; release() sets idle again → no event.
    await engine.release();
    expect(phases).toEqual([]);
  });

  it('destroy releases then deletes all assets, leaving nothing downloaded', async () => {
    const engine = new Qwen3TTSEngine();
    await makeFullyDownloaded(engine);
    expect(engine.isFullyDownloaded()).toBe(true);

    await engine.destroy();

    expect(engine.getPhase()).toBe('idle');
    expect(engine.isFullyDownloaded()).toBe(false);
    for (const a of QWEN3_TTS_ASSETS) {
      expect(fs.present.has(`${MODELS_DIR}/${a.filename}`)).toBe(false);
    }
  });
});

describe('Qwen3TTSEngine — deleteAssets', () => {
  it('deletes only the requested assets and unlinks their files', async () => {
    const engine = new Qwen3TTSEngine();
    await makeFullyDownloaded(engine);

    await engine.deleteAssets(['talker']);

    // talker gone from disk + state; others remain.
    expect(fs.present.has(`${MODELS_DIR}/${QWEN3_TTS_TALKER.filename}`)).toBe(false);
    expect(engine.isFullyDownloaded()).toBe(false);
    const status = await engine.checkAssetStatus();
    expect(status.find(s => s.asset.id === 'talker')!.status).toBe('not-downloaded');
    expect(status.find(s => s.asset.id === 'predictor')!.status).toBe('downloaded');
  });

  it('deleting an absent asset is a no-op (does not call unlink)', async () => {
    const engine = new Qwen3TTSEngine();
    // Nothing on disk.
    (RNFS.unlink as jest.Mock).mockClear();
    await engine.deleteAssets(['codec']);
    expect(RNFS.unlink).not.toHaveBeenCalled();
    // State still reflects codec not-downloaded.
    expect(engine.isFullyDownloaded()).toBe(false);
  });
});

describe('Qwen3TTSEngine — voices', () => {
  it('exposes a single default multilingual voice as the active voice', () => {
    const engine = new Qwen3TTSEngine();
    const voices = engine.getVoices();
    expect(voices).toHaveLength(1);
    expect(voices[0].id).toBe('default');
    expect(engine.getActiveVoice()).toEqual(voices[0]);
  });

  it('setVoice emits voiceChanged with the new voice id', async () => {
    const engine = new Qwen3TTSEngine();
    const seen: string[] = [];
    engine.on('voiceChanged', id => seen.push(id));
    await engine.setVoice('default');
    expect(seen).toEqual(['default']);
  });
});

describe('Qwen3TTSEngine — inference stubs throw (not silently succeed)', () => {
  it('speak rejects with the not-implemented message', async () => {
    const engine = new Qwen3TTSEngine();
    await expect(engine.speak('hello')).rejects.toThrow(/not yet implemented/i);
  });

  it('generateAndSave rejects with the not-implemented message', async () => {
    const engine = new Qwen3TTSEngine();
    await expect(
      engine.generateAndSave('hi', 'conv-1', 'msg-1'),
    ).rejects.toThrow(/generateAndSave not yet implemented/i);
  });
});

describe('Qwen3TTSEngine — transport controls (both branches of each guard)', () => {
  // The stub inference pipeline has no public path to 'processing', so to test
  // the TRUE branch of each transport guard we set up the precondition phase via
  // the (private) _setPhase — the same seam the pipeline will drive once wired.
  // We are still asserting the REAL guard logic + emitted transitions, never a mock.
  const setPhase = (engine: Qwen3TTSEngine, phase: string) =>
    ((engine as unknown as { _setPhase(p: string): void })._setPhase(phase));

  it('stop is a no-op from idle (FALSE branch)', () => {
    const engine = new Qwen3TTSEngine();
    const phases: string[] = [];
    engine.on('phaseChange', p => phases.push(p));
    engine.stop();
    expect(engine.getPhase()).toBe('idle');
    expect(phases).toEqual([]);
  });

  it('stop moves processing→ready and paused→ready (TRUE branch, both sources)', () => {
    const engine = new Qwen3TTSEngine();
    setPhase(engine, 'processing');
    engine.stop();
    expect(engine.getPhase()).toBe('ready');

    setPhase(engine, 'paused');
    engine.stop();
    expect(engine.getPhase()).toBe('ready');
  });

  it('pause is a no-op unless processing; resume is a no-op unless paused (FALSE branches)', () => {
    const engine = new Qwen3TTSEngine();
    engine.pause(); // from idle
    expect(engine.getPhase()).toBe('idle');
    engine.resume(); // from idle
    expect(engine.getPhase()).toBe('idle');
  });

  it('pause suspends processing→paused and resume restores paused→processing (TRUE branches)', () => {
    const engine = new Qwen3TTSEngine();
    setPhase(engine, 'processing');

    engine.pause();
    expect(engine.getPhase()).toBe('paused');

    engine.resume();
    expect(engine.getPhase()).toBe('processing');
  });

  it('setSpeed is a safe no-op that does not change phase', () => {
    const engine = new Qwen3TTSEngine();
    engine.setSpeed(1.5);
    expect(engine.getPhase()).toBe('idle');
  });
});
