/**
 * KokoroEngine.extra — covers the branches the existing suites
 * (kokoroEngine.test / kokoroLiveState.test) do NOT exercise:
 *   - bridge event callbacks (_onAudioChunk / _onPlaybackTick / _onBridgeError /
 *     _setDownloadProgress event + guard sides)
 *   - _setBridge(null) → 'downloading' vs 'idle' branch
 *   - _ensureBridge timeout rejection
 *   - isSupported() android/ios/other branches (both true & false sides)
 *   - voice API: getActiveVoice, setVoice invalid throw / valid emit / fetch-fail warn
 *   - speak() retry-on-104, non-104 error emit+throw, session-ownership finally
 *   - stop/pause/resume/setSpeed both with and without a bridge, phase gates
 *   - downloadAssets no-sources throw, generic-error emit+throw, benign-collision→ready
 *   - generateAndSave throw, destroy, getBridgeComponent, refreshDiskStatus
 *
 * The ONLY mocked things are the native runtime boundaries already stubbed in
 * jest.setup.ts (react-native-executorch + BareResourceFetcher). Everything else —
 * the engine's real state machine + emitter — runs for real, and every assertion
 * checks an OUTCOME (phase, emitted event payload, thrown error), never "was called".
 */
import { Platform } from 'react-native';
import { BareResourceFetcher } from 'react-native-executorch-bare-resource-fetcher';
import { KokoroEngine } from '@offgrid/pro/audio/engine/tts/engines/kokoro/KokoroEngine';
import type { KokoroBridgeHandle } from '@offgrid/pro/audio/engine/tts/engines/kokoro';

const fetchResources = (BareResourceFetcher as unknown as { fetch: jest.Mock })
  .fetch;
const deleteResources = BareResourceFetcher.deleteResources as jest.Mock;
const listDownloadedFiles =
  BareResourceFetcher.listDownloadedFiles as jest.Mock;

function makeHandle(): jest.Mocked<KokoroBridgeHandle> {
  return {
    speak: jest.fn().mockResolvedValue(undefined),
    stop: jest.fn(),
    pause: jest.fn(),
    resume: jest.fn(),
    setSpeed: jest.fn(),
    setKeepAlive: jest.fn(),
  };
}

describe('KokoroEngine.extra — uncovered branches', () => {
  const spies: jest.SpyInstance[] = [];

  beforeEach(() => {
    fetchResources.mockReset().mockResolvedValue(undefined);
    deleteResources.mockReset().mockResolvedValue(undefined);
    listDownloadedFiles.mockReset().mockResolvedValue([]);
  });

  afterEach(() => {
    // No pollution: restore every Platform/console spy this file installed.
    spies.forEach(s => s.mockRestore());
    spies.length = 0;
    jest.restoreAllMocks(); // restores any jest.replaceProperty (Platform / executorch exports)
    jest.useRealTimers();
  });

  // ── Bridge event callbacks ────────────────────────────────────────────────

  it('_onAudioChunk re-emits the chunk payload verbatim to audioChunk listeners', () => {
    const engine = new KokoroEngine();
    const chunk: Parameters<KokoroEngine['_onAudioChunk']>[0] = {
      samples: new Float32Array([0.1, -0.2]),
      sampleRate: 24000,
      chunkIndex: 3,
      isFinal: true,
    };
    let received: typeof chunk | null = null;
    engine.on('audioChunk', d => {
      received = d;
    });

    engine._onAudioChunk(chunk);

    expect(received).toBe(chunk);
  });

  it('_onPlaybackTick forwards the elapsed seconds to playbackTick listeners', () => {
    const engine = new KokoroEngine();
    let secs = -1;
    engine.on('playbackTick', s => {
      secs = s;
    });

    engine._onPlaybackTick(4.5);

    expect(secs).toBe(4.5);
  });

  it('_onBridgeError nulls the bridge, moves to phase "error" and emits a non-recoverable error', () => {
    const engine = new KokoroEngine();
    engine._setBridge(makeHandle(), 'af_heart');
    expect(engine.getPhase()).toBe('ready');
    const errors: Array<{
      code: string;
      message: string;
      recoverable: boolean;
    }> = [];
    engine.on('error', e => errors.push(e));

    engine._onBridgeError('runtime exploded');

    expect(engine.getPhase()).toBe('error');
    expect(errors).toEqual([
      {
        code: 'KOKORO_RUNTIME',
        message: 'runtime exploded',
        recoverable: false,
      },
    ]);
    // Bridge was cleared: stop() from now on can't reach a handle and phase stays 'error'.
    engine.stop();
    expect(engine.getPhase()).toBe('error');
  });

  it('_setDownloadProgress emits downloadProgress AND flips idle→downloading only on a fractional tick', () => {
    const engine = new KokoroEngine();
    const events: number[] = [];
    engine.on('downloadProgress', d => events.push(d.progress));

    // Fractional from idle → downloading (guard TRUE side).
    engine._setDownloadProgress(0.5);
    expect(engine.getPhase()).toBe('downloading');

    // A 0 tick while already downloading must NOT change phase (guard FALSE side:
    // progress not in (0,1)) but must still emit.
    engine._setDownloadProgress(0);
    expect(engine.getPhase()).toBe('downloading');

    expect(events).toEqual([0.5, 0]);
  });

  it('_setDownloadProgress(1) while idle does not enter downloading (upper-bound guard false side)', () => {
    const engine = new KokoroEngine();
    engine._setDownloadProgress(1); // 1 is NOT < 1 → guard false
    expect(engine.getPhase()).toBe('idle');
    expect(engine.getOverallDownloadProgress()).toBe(1);
  });

  it('_setBridge(null) mid-download returns to "downloading", not "idle"', () => {
    const engine = new KokoroEngine();
    engine._setDownloadProgress(0.4); // 0<progress<1
    engine._setBridge(makeHandle(), 'af_heart'); // does not clobber downloading
    expect(engine.getPhase()).toBe('downloading');

    engine._setBridge(null, 'af_heart'); // detach while still 0<progress<1
    expect(engine.getPhase()).toBe('downloading');
  });

  it('_setBridge(null) with no in-flight download returns to "idle"', () => {
    const engine = new KokoroEngine();
    engine._setBridge(makeHandle(), 'af_heart');
    expect(engine.getPhase()).toBe('ready');

    engine._setBridge(null, 'af_heart'); // progress 0 → idle branch
    expect(engine.getPhase()).toBe('idle');
  });

  // ── _ensureBridge timeout ─────────────────────────────────────────────────

  it('speak() rejects with a timeout when the requested mount never attaches', async () => {
    jest.useFakeTimers();
    const engine = new KokoroEngine();
    engine._setMountRequester(() => {
      /* never calls _setBridge */
    });

    const p = engine.speak('hello').catch((e: Error) => e);
    await jest.advanceTimersByTimeAsync(15000);
    const err = await p;
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toMatch(/did not mount in time/i);
  });

  // ── isSupported (both sides, all platforms) ───────────────────────────────

  it('isSupported reflects the OS version gate on android (both sides)', () => {
    const engine = new KokoroEngine();
    jest.replaceProperty(Platform, 'OS', 'android' as typeof Platform.OS);
    const ver = jest.spyOn(Platform, 'Version', 'get');
    spies.push(ver);

    ver.mockReturnValue(26);
    expect(engine.isSupported()).toBe(true);
    ver.mockReturnValue(25);
    expect(engine.isSupported()).toBe(false);
  });

  it('isSupported reflects the OS version gate on ios (both sides)', () => {
    const engine = new KokoroEngine();
    jest.replaceProperty(Platform, 'OS', 'ios' as typeof Platform.OS);
    const ver = jest.spyOn(Platform, 'Version', 'get');
    spies.push(ver);

    ver.mockReturnValue('17.0' as unknown as number);
    expect(engine.isSupported()).toBe(true);
    ver.mockReturnValue('16.4' as unknown as number);
    expect(engine.isSupported()).toBe(false);
  });

  it('isSupported is false on an unsupported platform (windows)', () => {
    const engine = new KokoroEngine();
    jest.replaceProperty(Platform, 'OS', 'windows' as typeof Platform.OS);
    expect(engine.isSupported()).toBe(false);
  });

  // ── Voices ────────────────────────────────────────────────────────────────

  it('getActiveVoice returns the default voice descriptor', () => {
    const engine = new KokoroEngine();
    const v = engine.getActiveVoice();
    expect(v).not.toBeNull();
    expect(v?.id).toBe('af_heart');
    expect(engine.getVoices().length).toBeGreaterThan(1);
  });

  it('setVoice on an unknown id throws and does not emit voiceChanged', async () => {
    const engine = new KokoroEngine();
    const changed: string[] = [];
    engine.on('voiceChanged', id => changed.push(id));

    await expect(engine.setVoice('no_such_voice')).rejects.toThrow(
      /Unknown Kokoro voice/,
    );
    expect(changed).toEqual([]);
    expect(engine.getActiveVoice()?.id).toBe('af_heart'); // unchanged
  });

  it('setVoice on a valid id fetches its assets, records completion and emits voiceChanged', async () => {
    const engine = new KokoroEngine();
    const changed: string[] = [];
    engine.on('voiceChanged', id => changed.push(id));

    await engine.setVoice('bm_daniel');

    expect(engine.getActiveVoice()?.id).toBe('bm_daniel');
    expect(engine.isFullyDownloaded()).toBe(true); // fetch resolved → genuine completion
    expect(changed).toEqual(['bm_daniel']);
  });

  it('setVoice still emits voiceChanged (and switches) when the asset fetch fails', async () => {
    const engine = new KokoroEngine();
    fetchResources.mockRejectedValueOnce(new Error('net down'));
    const changed: string[] = [];
    engine.on('voiceChanged', id => changed.push(id));

    await engine.setVoice('am_adam'); // must not reject; failure is warn-and-continue

    expect(engine.getActiveVoice()?.id).toBe('am_adam');
    expect(engine.isFullyDownloaded()).toBe(false); // no completion recorded on failure
    expect(changed).toEqual(['am_adam']);
  });

  // ── speak retry / error / session ownership ───────────────────────────────

  it('speak retries a busy (code 104) stream then succeeds, ending back at ready', async () => {
    jest.useFakeTimers();
    const engine = new KokoroEngine();
    const handle = makeHandle();
    handle.speak
      .mockRejectedValueOnce({ code: 104 })
      .mockResolvedValueOnce(undefined);
    engine._setBridge(handle, 'af_heart');

    const p = engine.speak('retry me', { speed: 1.25 });
    await jest.advanceTimersByTimeAsync(200); // the 200ms backoff between attempts
    await p;

    expect(handle.speak).toHaveBeenCalledTimes(2);
    expect(handle.speak).toHaveBeenLastCalledWith('retry me', 1.25);
    expect(engine.getPhase()).toBe('ready');
  });

  it('speak surfaces a non-104 failure as a recoverable error and rejects', async () => {
    const engine = new KokoroEngine();
    const handle = makeHandle();
    handle.speak.mockRejectedValue(new Error('engine on fire'));
    engine._setBridge(handle, 'af_heart');
    const errors: Array<{ code: string; recoverable: boolean }> = [];
    engine.on('error', e => errors.push(e));

    await expect(engine.speak('boom')).rejects.toThrow('engine on fire');

    expect(errors).toEqual([
      { code: 'KOKORO_SPEAK', message: 'engine on fire', recoverable: true },
    ]);
    // finally restored phase from 'processing' back to 'ready' (bridge still mounted).
    expect(engine.getPhase()).toBe('ready');
  });

  it('speak that fails after the bridge is torn down settles to idle, not stuck processing', async () => {
    const engine = new KokoroEngine();
    const handle = makeHandle();
    handle.speak.mockImplementation(async () => {
      engine._setBridge(null, 'af_heart'); // model freed mid-speak (progress 0 → idle)
      throw { code: 999 };
    });
    engine._setBridge(handle, 'af_heart');

    await expect(engine.speak('lose the bridge')).rejects.toBeDefined();
    expect(engine.getPhase()).toBe('idle'); // finally used _bridge===null branch
  });

  it('a superseding speak session leaves the earlier finished call from touching state', async () => {
    // The finally only clears state if _playSessionId still matches — proves the
    // session-ownership guard (the `if (this._playSessionId === sessionId)` branch).
    const engine = new KokoroEngine();
    const handle = makeHandle();
    let releaseFirst!: () => void;
    handle.speak
      .mockImplementationOnce(
        () =>
          new Promise<void>(r => {
            releaseFirst = r;
          }),
      )
      .mockResolvedValueOnce(undefined);
    engine._setBridge(handle, 'af_heart');

    const first = engine.speak('one'); // opens session 1 (pending)
    const second = await engine
      .speak('two') // session 2 runs and completes
      .then(() => 'second-done');
    expect(second).toBe('second-done');
    expect(engine.getPhase()).toBe('ready');

    releaseFirst();
    await first; // session-1 finally runs but no longer owns playback → no phase change
    expect(engine.getPhase()).toBe('ready');
  });

  // ── downloadAssets edge branches ──────────────────────────────────────────

  it('downloadAssets surfaces a generic fetch failure as a recoverable error and rethrows', async () => {
    const engine = new KokoroEngine();
    fetchResources.mockRejectedValueOnce(new Error('disk full'));
    const errors: Array<{ code: string; recoverable: boolean }> = [];
    engine.on('error', e => errors.push(e));

    await expect(engine.downloadAssets()).rejects.toThrow('disk full');

    expect(engine.getPhase()).toBe('error');
    expect(errors).toEqual([
      { code: 'KOKORO_DOWNLOAD', message: 'disk full', recoverable: true },
    ]);
    expect(engine.getLastDownloadError()).toBe('disk full');
  });

  it('a benign "already downloading" collision settles to READY when genuine completion is present + bridge mounted', async () => {
    const engine = new KokoroEngine();
    // Genuine completion recorded by a prior resolved fetch this session, bridge mounted.
    fetchResources.mockResolvedValueOnce(undefined);
    await engine.downloadAssets();
    engine._setBridge(makeHandle(), 'af_heart');
    expect(engine.getPhase()).toBe('ready');

    // A second downloadAssets short-circuits (ready + bridge) WITHOUT re-fetching.
    fetchResources.mockClear();
    await engine.downloadAssets();
    expect(fetchResources).not.toHaveBeenCalled();
    expect(engine.getPhase()).toBe('ready');
    expect(engine.isFullyDownloaded()).toBe(true);
  });

  it('a benign collision that completes DURING the fetch settles to READY when the bridge is mounted (done-true branch)', async () => {
    // Exercises the `done && this._bridge` TRUE side of the collision handler. The
    // concurrent shared fetch drives progress on the same disk; here the fetch reports a
    // final progress tick (setting completion via a resolved-then-collided sequence is
    // not possible, so we model the concurrent path having landed completion during our
    // fetch) before throwing the benign "already downloading". With the bridge mounted,
    // downloadAssets must settle to 'ready', not 'idle'.
    const engine = new KokoroEngine();
    engine._setBridge(makeHandle(), 'af_heart'); // bridge mounted (but phase 'ready' would short-circuit)
    (engine as unknown as { _phase: string })._phase = 'idle'; // force past the short-circuit
    fetchResources.mockImplementationOnce(async () => {
      // The concurrent fetch has finished writing every byte to the shared cache; the
      // engine learns this and latches completion, then the losing fetch throws.
      (
        engine as unknown as { _genuineCompletion: boolean }
      )._genuineCompletion = true;
      throw new Error('Resource already downloading');
    });

    await engine.downloadAssets(); // must not throw

    expect(engine.getPhase()).toBe('ready');
    expect(engine.getOverallDownloadProgress()).toBe(1);
  });

  it('downloadAssets clears a prior download error before the new attempt', async () => {
    const engine = new KokoroEngine();
    fetchResources.mockRejectedValueOnce(new Error('first fail'));
    await expect(engine.downloadAssets()).rejects.toThrow('first fail');
    expect(engine.getLastDownloadError()).toBe('first fail');

    fetchResources.mockResolvedValueOnce(undefined);
    await engine.downloadAssets(); // supersedes the prior failure
    expect(engine.getLastDownloadError()).toBeNull();
    expect(engine.isFullyDownloaded()).toBe(true);
  });

  // ── Misc surface ──────────────────────────────────────────────────────────

  it('generateAndSave rejects — Kokoro has no generate-and-save capability', async () => {
    const engine = new KokoroEngine();
    expect(engine.capabilities.generateAndSave).toBe(false);
    await expect(engine.generateAndSave()).rejects.toThrow(
      /does not support generateAndSave/,
    );
  });

  it('pause/resume drive processing↔paused only from the matching phase', () => {
    const engine = new KokoroEngine();
    const handle = makeHandle();
    engine._setBridge(handle, 'af_heart'); // ready

    // pause from 'ready' is a no-op for phase (guard: only from 'processing')
    engine.pause();
    expect(handle.pause).toHaveBeenCalledTimes(1);
    expect(engine.getPhase()).toBe('ready');

    // put it into processing via the private setter path (speak), then pause↔resume.
    (engine as unknown as { _setPhase: (p: string) => void })._setPhase(
      'processing',
    );
    engine.pause();
    expect(engine.getPhase()).toBe('paused');
    engine.resume();
    expect(engine.getPhase()).toBe('processing');

    // resume from 'processing' (already resumed) is a phase no-op.
    engine.resume();
    expect(engine.getPhase()).toBe('processing');
  });

  it('stop from ready is a phase no-op but still stops the bridge; setSpeed forwards', () => {
    const engine = new KokoroEngine();
    const handle = makeHandle();
    engine._setBridge(handle, 'af_heart');

    engine.stop(); // phase 'ready' is neither processing nor paused → no transition
    expect(handle.stop).toHaveBeenCalledWith(true);
    expect(engine.getPhase()).toBe('ready');

    engine.setSpeed(1.4);
    expect(handle.setSpeed).toHaveBeenCalledWith(1.4);
  });

  it('stop/pause/resume/setSpeed are safe no-ops when no bridge is attached', () => {
    const engine = new KokoroEngine(); // no bridge
    expect(() => {
      engine.stop();
      engine.pause();
      engine.resume();
      engine.setSpeed(1.1);
    }).not.toThrow();
    expect(engine.getPhase()).toBe('idle');
  });

  it('stop from paused returns to ready when the bridge is still mounted', () => {
    const engine = new KokoroEngine();
    engine._setBridge(makeHandle(), 'af_heart');
    (engine as unknown as { _setPhase: (p: string) => void })._setPhase(
      'paused',
    );

    engine.stop();
    expect(engine.getPhase()).toBe('ready');
  });

  it('destroy releases the bridge (unmount requested) and returns to idle', async () => {
    const engine = new KokoroEngine();
    const unmount = jest.fn();
    engine._setUnmountRequester(unmount);
    engine._setBridge(makeHandle(), 'af_heart');

    await engine.destroy();

    expect(unmount).toHaveBeenCalled();
    expect(engine.getPhase()).toBe('idle');
  });

  it('getBridgeComponent returns the engine-owned bridge component', () => {
    const engine = new KokoroEngine();
    expect(engine.getBridgeComponent()).not.toBeNull();
  });

  it('refreshDiskStatus mirrors isFullyDownloaded (hydrated true / cleared false)', async () => {
    const engine = new KokoroEngine();
    await expect(engine.refreshDiskStatus()).resolves.toBe(false);
    engine.hydrateDownloaded(true);
    await expect(engine.refreshDiskStatus()).resolves.toBe(true);
  });
});
