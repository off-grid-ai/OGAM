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
 * Boundaries mocked: audioFilePlayer (native audio bridge) and logger. Everything
 * else — the playback machine, the stream clock, the smLog sink — runs for real.
 * Deleting the handler under test makes each assertion fail.
 */
jest.mock('@offgrid/core/utils/logger', () => ({
  __esModule: true,
  default: { log: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

jest.mock('@offgrid/pro/audio/audioFilePlayer', () => ({
  audioFilePlayer: { isActive: jest.fn(() => false) },
}));

import { subscribeToEngine } from '@offgrid/pro/audio/ttsEngineSubscription';
import { audioFilePlayer } from '@offgrid/pro/audio/audioFilePlayer';
import { getStreamBase, setStreamBase, resetStreamBase } from '@offgrid/pro/audio/streamPlaybackClock';
import logger from '@offgrid/core/utils/logger';

const mockFilePlayer = audioFilePlayer as unknown as { isActive: jest.Mock };
const mockLogger = logger as unknown as { error: jest.Mock };

type Cb = (...args: any[]) => void;
function makeEngine(overallProgress = 1) {
  const listeners: Record<string, Cb[]> = {};
  return {
    on: (evt: string, cb: Cb) => {
      (listeners[evt] ||= []).push(cb);
      return () => {
        listeners[evt] = (listeners[evt] || []).filter((l) => l !== cb);
      };
    },
    emit: (evt: string, ...args: any[]) => (listeners[evt] || []).forEach((cb) => cb(...args)),
    getOverallDownloadProgress: () => overallProgress,
  };
}

// Real store-shaped state driven by the REAL playback machine via set/get.
let state: Record<string, any>;
const deps = () => ({
  set: (p: any) => { state = { ...state, ...(typeof p === 'function' ? p(state) : p) }; },
  get: () => state,
  phaseToFlags: (phase: string) => ({ isPreparing: phase === 'preparing' }),
});

beforeEach(() => {
  mockFilePlayer.isActive.mockReturnValue(false);
  resetStreamBase();
  state = {
    currentMessageId: 'm1',
    playbackStatus: 'preparing',
    playbackElapsed: 0,
    playbackDuration: 0,
    currentAmplitude: 0,
    overallDownloadProgress: 0,
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
    engine.emit('downloadProgress');
    expect(state.overallDownloadProgress).toBe(0.42);
  });
});

describe('amplitudeChange → store projection', () => {
  it('projects the emitted amplitude value', () => {
    const engine = makeEngine();
    subscribeToEngine(engine as any, deps());
    engine.emit('amplitudeChange', 0.75);
    expect(state.currentAmplitude).toBe(0.75);
  });
});

describe('playbackTick → real machine position + flowing promotion', () => {
  it('adds the stream base to elapsed and promotes preparing → playing', () => {
    setStreamBase(3);
    expect(getStreamBase()).toBe(3);
    const engine = makeEngine();
    subscribeToEngine(engine as any, deps());
    engine.emit('playbackTick', 2); // base(3) + 2 = 5
    expect(state.playbackElapsed).toBe(5);
    expect(state.playbackStatus).toBe('playing'); // flowing promoted preparing → playing
  });

  it('with no stream base tracks raw elapsed and keeps playing once flowing', () => {
    const engine = makeEngine();
    subscribeToEngine(engine as any, deps());
    engine.emit('playbackTick', 4); // base 0 + 4
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
    engine.emit('playbackTick', 6); // 1 + 6
    expect(state.playbackElapsed).toBe(7);
    expect(state.playbackStatus).toBe('playing');
  });
});

describe('error event → store projection + logger', () => {
  it('sets the error message and logs it with code + message', () => {
    const engine = makeEngine();
    subscribeToEngine(engine as any, deps());
    engine.emit('error', { code: 'E_BRIDGE', message: 'bridge died' });
    expect(state.error).toBe('bridge died');
    expect(mockLogger.error).toHaveBeenCalledWith('[TTS Store] Engine error:', 'E_BRIDGE', 'bridge died');
  });
});

describe('voiceChanged → store projection', () => {
  it('projects the active voice id', () => {
    const engine = makeEngine();
    subscribeToEngine(engine as any, deps());
    engine.emit('voiceChanged', 'af_heart');
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
    engine.emit('phaseChange', 'error');
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
    engine.emit('phaseChange', 'ready'); // not error, and not a completion (was preparing)
    expect(state.error).toBeNull();
  });
});

describe('unsubscribe detaches every handler', () => {
  it('stops projecting after the returned disposer runs', () => {
    const engine = makeEngine(0.9);
    const unsub = subscribeToEngine(engine as any, deps());
    unsub();
    engine.emit('downloadProgress');
    engine.emit('amplitudeChange', 0.5);
    engine.emit('voiceChanged', 'bf_emma');
    engine.emit('error', { code: 'X', message: 'later' });
    engine.emit('playbackTick', 10);
    // Nothing changed from the initial state — all handlers were removed.
    expect(state.overallDownloadProgress).toBe(0);
    expect(state.currentAmplitude).toBe(0);
    expect(state.activeVoiceId).toBeNull();
    expect(state.error).toBeNull();
    expect(state.playbackElapsed).toBe(0);
    expect(mockLogger.error).not.toHaveBeenCalled();
  });
});
