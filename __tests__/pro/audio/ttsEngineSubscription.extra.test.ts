/**
 * ttsEngineSubscription — EXTRA coverage for the event handlers the existing
 * suite (unit/audio/ttsEngineSubscription.test.ts) leaves untested:
 *   - downloadProgress → overallDownloadProgress projection (real engine getter)
 *   - amplitudeChange → currentAmplitude projection
 *   - playbackTick → position (with the REAL stream-clock base added) + flowing
 *     promotion (preparing → playing), driving the REAL playbackMachine
 *   - error event → error projection + logger.error
 *   - voiceChanged → activeVoiceId projection
 *   - phaseChange('error') top-level set PRESERVES the existing error string
 *   - the returned unsubscribe fn detaches EVERY handler (no more projection)
 *
 * Everything that is ours runs for real: the playback machine, the stream clock, the smLog
 * sink, the real audioFilePlayer (idle, so not active) and the real logger, whose error line
 * reaches the console (a jest.fn in jest.setup). The engine is the real OnDeviceEngineEmitter
 * event plumbing every engine extends; the test publishes the events a native engine raises.
 * Deleting the handler under test makes each assertion fail.
 */
import { subscribeToEngine } from '@offgrid/pro/audio/ttsEngineSubscription';
import { OnDeviceEngineEmitter } from '@offgrid/pro/audio/engine';
import { getStreamBase, setStreamBase, resetStreamBase } from '@offgrid/pro/audio/streamPlaybackClock';

const consoleError = console.error as jest.Mock;

/** An engine on the real emitter: the test raises the events the native side would. */
class EngineEvents extends OnDeviceEngineEmitter {
  constructor(private readonly overallProgress: number) {
    super();
  }
  publish(evt: string, ...args: any[]): void {
    this.emit(evt, ...args);
  }
  getOverallDownloadProgress(): number {
    return this.overallProgress;
  }
}

const makeEngine = (overallProgress = 1) => new EngineEvents(overallProgress);

// Real store-shaped state driven by the REAL playback machine via set/get.
let state: Record<string, any>;
const deps = () => ({
  set: (p: any) => { state = { ...state, ...(typeof p === 'function' ? p(state) : p) }; },
  get: () => state,
  phaseToFlags: (phase: string) => ({ isPreparing: phase === 'preparing' }),
});

beforeEach(() => {
  consoleError.mockClear();
  resetStreamBase();
  state = {
    currentMessageId: 'm1',
    playbackStatus: 'preparing',
    playbackElapsed: 0,
    playbackDuration: 0,
    currentAmplitude: 0,
    overallDownloadProgress: 0,
    voiceSwitchProgress: 0,
    isSwitchingVoice: false,
    activeVoiceId: null,
    playSessionId: 7,
    error: null,
  };
});

afterEach(() => {
  jest.clearAllMocks();
  resetStreamBase();
});

describe('downloadProgress → store projection', () => {
  it('projects the engine overall download progress on each event', () => {
    const engine = makeEngine(0.42);
    subscribeToEngine(engine as any, deps());
    engine.publish('downloadProgress');
    expect(state.overallDownloadProgress).toBe(0.42);
  });

  it('projects progress into the pending voice switch', () => {
    state.isSwitchingVoice = true;
    const engine = makeEngine(0.42);
    subscribeToEngine(engine as any, deps());
    engine.publish('downloadProgress');
    expect(state.voiceSwitchProgress).toBe(0.42);
  });

  it('measures one aggregate byte rate for every voice download view', () => {
    const now = jest.spyOn(Date, 'now')
      .mockReturnValueOnce(1_000)
      .mockReturnValueOnce(2_000);
    const engine = makeEngine(0.5);
    subscribeToEngine(engine as any, deps());

    engine.publish('downloadProgress', {
      assetId: 'voice', progress: 0.25, bytesWritten: 250, totalBytes: 1_000,
    });
    expect(state.downloadBytesPerSecond).toBeUndefined();

    engine.publish('downloadProgress', {
      assetId: 'voice', progress: 0.5, bytesWritten: 500, totalBytes: 1_000,
    });
    expect(state.downloadCurrentBytes).toBe(500);
    expect(state.downloadTotalBytes).toBe(1_000);
    expect(state.downloadBytesPerSecond).toBe(250);
    now.mockRestore();
  });
});

describe('amplitudeChange → store projection', () => {
  it('projects the emitted amplitude value', () => {
    const engine = makeEngine();
    subscribeToEngine(engine as any, deps());
    engine.publish('amplitudeChange', 0.75);
    expect(state.currentAmplitude).toBe(0.75);
  });
});

describe('playbackTick → real machine position + flowing promotion', () => {
  it('adds the stream base to elapsed and promotes preparing → playing', () => {
    setStreamBase(3);
    expect(getStreamBase()).toBe(3);
    const engine = makeEngine();
    subscribeToEngine(engine as any, deps());
    engine.publish('playbackTick', 2); // base(3) + 2 = 5
    expect(state.playbackElapsed).toBe(5);
    expect(state.playbackStatus).toBe('playing'); // flowing promoted preparing → playing
  });

  it('with no stream base tracks raw elapsed and keeps playing once flowing', () => {
    const engine = makeEngine();
    subscribeToEngine(engine as any, deps());
    engine.publish('playbackTick', 4); // base 0 + 4
    expect(state.playbackElapsed).toBe(4);
    expect(state.playbackStatus).toBe('playing');
  });

  it('tracks position without promoting when the engine is already playing', () => {
    // flowing only promotes preparing → playing; when already playing it is a no-op
    // for status but position still advances (the other side of the flowing branch).
    state.playbackStatus = 'playing';
    setStreamBase(1);
    const engine = makeEngine();
    subscribeToEngine(engine as any, deps());
    engine.publish('playbackTick', 6); // 1 + 6
    expect(state.playbackElapsed).toBe(7);
    expect(state.playbackStatus).toBe('playing');
  });
});

describe('error event → store projection + logger', () => {
  it('sets the error message and logs it with code + message', () => {
    const engine = makeEngine();
    subscribeToEngine(engine as any, deps());
    engine.publish('error', { code: 'E_BRIDGE', message: 'bridge died' });
    expect(state.error).toBe('bridge died');
    expect(consoleError).toHaveBeenCalledWith('[TTS Store] Engine error:', 'E_BRIDGE', 'bridge died');
  });
});

describe('voiceChanged → store projection', () => {
  it('projects the active voice id', () => {
    const engine = makeEngine();
    subscribeToEngine(engine as any, deps());
    engine.publish('voiceChanged', 'af_heart');
    expect(state.activeVoiceId).toBe('af_heart');
  });

  it('does not mark a voice active before its pending switch is ready', () => {
    state.isSwitchingVoice = true;
    state.activeVoiceId = 'af_heart';
    const engine = makeEngine();
    subscribeToEngine(engine as any, deps());
    engine.publish('voiceChanged', 'bf_emma');
    expect(state.activeVoiceId).toBe('af_heart');
  });
});

describe('phaseChange error branch preserves the existing error', () => {
  it('keeps the current error string when phase becomes error (does not null it)', () => {
    // File player NOT active + a live message: the top-level set fires with
    // error: get().error (not null) because phase === 'error'.
    state.error = 'previous failure';
    const engine = makeEngine();
    subscribeToEngine(engine as any, deps());
    engine.publish('phaseChange', 'error');
    // The top set preserved the prior error string...
    expect(state.phase).toBe('error');
    // ...but the machine then went idle via 'failed', writing error = get().error
    // (still the preserved string, since state.error was non-null).
    expect(state.error).toBe('previous failure');
    expect(state.playbackStatus).toBe('idle');
  });

  it('nulls the error for a non-error phase transition', () => {
    state.error = 'stale error';
    const engine = makeEngine();
    subscribeToEngine(engine as any, deps());
    engine.publish('phaseChange', 'ready'); // not error, and not a completion (was preparing)
    expect(state.error).toBeNull();
  });
});

describe('unsubscribe detaches every handler', () => {
  it('stops projecting after the returned disposer runs', () => {
    const engine = makeEngine(0.9);
    const unsub = subscribeToEngine(engine as any, deps());
    unsub();
    engine.publish('downloadProgress');
    engine.publish('amplitudeChange', 0.5);
    engine.publish('voiceChanged', 'bf_emma');
    engine.publish('error', { code: 'X', message: 'later' });
    engine.publish('playbackTick', 10);
    // Nothing changed from the initial state — all handlers were removed.
    expect(state.overallDownloadProgress).toBe(0);
    expect(state.currentAmplitude).toBe(0);
    expect(state.activeVoiceId).toBeNull();
    expect(state.error).toBeNull();
    expect(state.playbackElapsed).toBe(0);
    expect(consoleError).not.toHaveBeenCalled();
  });
});
