/**
 * ttsPlayback — EXTRA coverage for the file-playback path + the pause/resume/stop
 * routing that the existing hardening suite (speakMessage only) leaves uncovered.
 *
 * What runs FOR REAL: the whole ttsPlayback module (runPlayback ticker, playSavedFile,
 * playMessage file-branch + toggle-off, seekMessage, pause/resume/stop routing,
 * setPlaybackSpeed), the REAL ttsStore action wiring, and the REAL playbackMachine
 * (the single writer of playbackStatus). Deleting any of these behaviors fails a test.
 *
 * BOUNDARIES stubbed (dumb, record-only, plain data): the generic audioFilePlayer
 * (wraps the native AudioContext), the TTS engine registry (wraps react-native-executorch),
 * and streamingSpeech (drives the native engine + timers). We drive the machine and
 * assert the OBSERVABLE store state + which backend path was routed to.
 *
 * Targets uncovered lines in pro/audio/ttsPlayback.ts:
 *   48-69 (runPlayback session/ticker/finally), 91 (file-player pause branch),
 *   107-110 (stopStreamingPlayback), 116 (file-player resume branch),
 *   137-143 (playSavedFile), 161-163 (playMessage toggle-off), 167 (file branch),
 *   181-182 (seekMessage).
 */

// Mutable control surface shared with the mock factories. Declared as a `mock`-prefixed
// object literal so babel-plugin-jest-hoist allows the hoisted factories to reference it,
// and its VALUE is stable (the factories read fields lazily at call time, never capture
// a value that hoisting could leave uninitialized). This is the boundary we drive.
const mockCtl = {
  // audioFilePlayer state the runPlayback ticker reads through the REAL machine.
  fpActive: false,
  fpPosition: 0,
  fpDuration: 0,
  // which concrete engine getActiveEngine() returns (null exercises the ?. guards).
  engineNull: false,
};

// --- audioFilePlayer: dumb boundary (wraps the native AudioContext). Built INSIDE the
// factory so it exists the moment the mocked module is required. ---
jest.mock('../../../pro/audio/audioFilePlayer', () => ({
  __esModule: true,
  audioFilePlayer: {
    play: jest.fn(async (_uri: string, _opts: { startOffset: number; speed: number }) => { mockCtl.fpActive = true; }),
    stop: jest.fn(() => { mockCtl.fpActive = false; mockCtl.fpPosition = 0; }),
    pause: jest.fn(),
    resume: jest.fn(),
    setSpeed: jest.fn(),
    isActive: jest.fn(() => mockCtl.fpActive),
    getPosition: jest.fn(() => mockCtl.fpPosition),
    getDuration: jest.fn(() => mockCtl.fpDuration),
  },
}));

// --- engine registry: dumb boundary (wraps react-native-executorch). ---
jest.mock('../../../pro/audio/engine', () => {
  const engine = {
    getPhase: jest.fn(() => 'ready' as string),
    stop: jest.fn(),
    pause: jest.fn(),
    resume: jest.fn(),
    setSpeed: jest.fn(),
    speak: jest.fn().mockResolvedValue(undefined),
    isFullyDownloaded: jest.fn(() => true),
  };
  return {
    __esModule: true,
    __engine: engine,
    ttsRegistry: {
      getActiveEngine: jest.fn(() => (mockCtl.engineNull ? null : engine)),
      register: jest.fn(),
      has: jest.fn(() => true),
      getEngine: jest.fn(() => (mockCtl.engineNull ? null : engine)),
      getActiveEngineId: jest.fn(() => 'mock-tts'),
      setActiveEngine: jest.fn(),
    },
    OuteTTSEngine: class {},
  };
});

// --- streamingSpeech: dumb boundary (drives native engine + timers). We assert it is
// routed to; its own behavior is covered by streamingSpeech.test.ts. ---
jest.mock('../../../pro/audio/streamingSpeech', () => ({
  __esModule: true,
  resetStreamingSpeech: jest.fn(),
  stopStreamingSpeechForTurn: jest.fn(),
  isStreamingSpeechActive: jest.fn(() => false),
}));

jest.mock('@offgrid/core/utils/logger', () => ({
  __esModule: true,
  default: { log: jest.fn(), error: jest.fn(), warn: jest.fn() },
}));

import { useTTSStore } from '@offgrid/pro/audio/ttsStore';
import {
  stopStreamingPlayback,
  setPlaybackSpeed,
} from '@offgrid/pro/audio/ttsPlayback';

// Retrieve the mocked boundaries (built inside the factories) via the mock registry.
const mockAudioFilePlayer = jest.requireMock('@offgrid/pro/audio/audioFilePlayer').audioFilePlayer as {
  play: jest.Mock; stop: jest.Mock; pause: jest.Mock; resume: jest.Mock; setSpeed: jest.Mock;
  isActive: jest.Mock; getPosition: jest.Mock; getDuration: jest.Mock;
};
const mockFpPlay = mockAudioFilePlayer.play;
const mockEngine = jest.requireMock('@offgrid/pro/audio/engine').__engine as {
  getPhase: jest.Mock; stop: jest.Mock; pause: jest.Mock; resume: jest.Mock;
  setSpeed: jest.Mock; speak: jest.Mock; isFullyDownloaded: jest.Mock;
};
const mockStreaming = jest.requireMock('@offgrid/pro/audio/streamingSpeech') as {
  resetStreamingSpeech: jest.Mock; stopStreamingSpeechForTurn: jest.Mock;
};
const mockResetStreamingSpeech = mockStreaming.resetStreamingSpeech;
const mockStopStreamingSpeechForTurn = mockStreaming.stopStreamingSpeechForTurn;

const getState = () => useTTSStore.getState();

function resetState() {
  useTTSStore.setState({
    phase: 'ready', currentMessageId: null, currentAmplitude: 0, playbackElapsed: 0,
    playbackDuration: 0, playbackStatus: 'idle', playSessionId: 0, error: null,
    currentAudioPath: null,
    isReady: true, isDownloading: false, isLoading: false, isSpeaking: false, isPaused: false,
    isGeneratingAudio: false, assets: [], overallDownloadProgress: 1,
    voices: [{ id: 'default', label: 'Default', metadata: {} }], activeVoiceId: 'default',
    audioCacheSizeMB: 0,
    settings: { interfaceMode: 'chat', enabled: true, speed: 1.5, engineId: 'mock-tts', voiceByEngine: {} },
  });
}

beforeEach(() => {
  resetState();
  jest.clearAllMocks();
  mockCtl.fpActive = false;
  mockCtl.fpPosition = 0;
  mockCtl.fpDuration = 0;
  mockCtl.engineNull = false;
  mockEngine.getPhase.mockReturnValue('ready');
});

afterEach(() => {
  jest.useRealTimers();
  resetState();
});

describe('runPlayback (via playSavedFile) — session, ticker, promotion, finally', () => {
  it('runs the ticker: mirrors REAL position/duration and promotes preparing → playing once audio flows, then ends to idle', async () => {
    jest.useFakeTimers();
    mockCtl.fpDuration = 42;
    // play resolves only after we let the ticker run; capture when it flows.
    let resolvePlay: () => void = () => {};
    mockFpPlay.mockImplementationOnce(async (_uri, opts) => {
      mockCtl.fpActive = true;
      // audio warms up: position still at the start offset → stays 'preparing'.
      mockCtl.fpPosition = opts.startOffset;
      await new Promise<void>((res) => { resolvePlay = res; });
    });

    const p = getState().play('m-file', { text: '', audioPath: '/rec/a.m4a', startOffset: 0 });

    // start minted a session → preparing, and the file path is remembered.
    expect(getState().playbackStatus).toBe('preparing');
    expect(getState().currentAudioPath).toBe('/rec/a.m4a');

    // First tick with no advance past the offset → still preparing, but position/duration mirrored.
    jest.advanceTimersByTime(100);
    expect(getState().playbackDuration).toBe(42);
    expect(getState().playbackStatus).toBe('preparing');

    // Audio now flows past the offset → next tick promotes to playing.
    mockCtl.fpPosition = 0.5;
    jest.advanceTimersByTime(100);
    expect(getState().playbackStatus).toBe('playing');
    expect(getState().playbackElapsed).toBeCloseTo(0.5);

    // Let play() resolve → finally clears the interval and dispatches ended → idle.
    resolvePlay();
    await p;
    expect(getState().playbackStatus).toBe('idle');
    expect(getState().currentMessageId).toBeNull();
    // start was called with the store's real speed, not a default.
    expect(mockFpPlay).toHaveBeenCalledWith('/rec/a.m4a', { startOffset: 0, speed: 1.5 });
  });

  it('dispatches failed (surfaces the error, back to idle) when the file player throws', async () => {
    mockFpPlay.mockRejectedValueOnce(new Error('decode exploded'));

    await getState().play('m-file', { text: '', audioPath: '/rec/bad.m4a' });

    expect(getState().playbackStatus).toBe('idle');
    expect(getState().error).toMatch(/decode exploded/i);
    expect(getState().currentMessageId).toBeNull();
  });

  it('playSavedFile honors a non-zero startOffset (seek offset flows to the player)', async () => {
    await getState().play('m-file', { text: '', audioPath: '/rec/a.m4a', startOffset: 7 });
    expect(mockFpPlay).toHaveBeenCalledWith('/rec/a.m4a', { startOffset: 7, speed: 1.5 });
  });
});

describe('playMessage — path selection + toggle-off', () => {
  it('toggles OFF (calls stop, no new playback) when the same message is already active', async () => {
    useTTSStore.setState({ currentMessageId: 'm-same', playbackStatus: 'playing' });

    await getState().play('m-same', { text: 'hi', audioPath: '/rec/a.m4a' });

    // toggle-off routes through stop() → idle, and never starts the file player.
    expect(mockFpPlay).not.toHaveBeenCalled();
    expect(getState().playbackStatus).toBe('idle');
    expect(getState().currentMessageId).toBeNull();
  });

  it('routes a message WITH an audioPath to the file player (not the engine)', async () => {
    await getState().play('m-file', { text: 'ignored when file present', audioPath: '/rec/a.m4a' });
    expect(mockFpPlay).toHaveBeenCalledWith('/rec/a.m4a', expect.objectContaining({ startOffset: 0 }));
    expect(mockEngine.speak).not.toHaveBeenCalled();
  });

  it('routes a message WITHOUT an audioPath to the engine speak path (not the file player)', async () => {
    await getState().play('m-synth', { text: 'synthesize me' });
    expect(mockFpPlay).not.toHaveBeenCalled();
    expect(mockEngine.speak).toHaveBeenCalledWith('synthesize me', expect.objectContaining({ messageId: 'm-synth' }));
  });
});

describe('seekMessage', () => {
  it('is a no-op when there is no audioPath (streaming clips are not seekable)', async () => {
    await getState().seek('m-x', 0.5, {});
    expect(mockFpPlay).not.toHaveBeenCalled();
    expect(getState().playbackStatus).toBe('idle');
  });

  it('stops current playback then restarts the file at fraction × duration', async () => {
    useTTSStore.setState({ currentMessageId: 'm-file', playbackStatus: 'playing' });

    await getState().seek('m-file', 0.25, { audioPath: '/rec/a.m4a', durationSec: 40 });

    // stop() dispatched first (idle reset), then file player restarted at 0.25 * 40 = 10s.
    expect(mockFpPlay).toHaveBeenCalledWith('/rec/a.m4a', { startOffset: 10, speed: 1.5 });
  });
});

describe('pause / resume routing (file player vs engine — no branch on engine type)', () => {
  it('pause routes to the FILE player when it owns the active session', () => {
    mockCtl.fpActive = true;
    useTTSStore.setState({ playbackStatus: 'playing', currentMessageId: 'm' });

    getState().pause();

    expect(mockAudioFilePlayer.pause).toHaveBeenCalled();
    expect(mockEngine.pause).not.toHaveBeenCalled();
    expect(getState().playbackStatus).toBe('paused');
  });

  it('pause routes to the ENGINE when the file player is not active', () => {
    mockCtl.fpActive = false;
    useTTSStore.setState({ playbackStatus: 'playing', currentMessageId: 'm' });

    getState().pause();

    expect(mockEngine.pause).toHaveBeenCalled();
    expect(mockAudioFilePlayer.pause).not.toHaveBeenCalled();
    expect(getState().playbackStatus).toBe('paused');
  });

  it('resume routes to the FILE player when it owns the active session', () => {
    mockCtl.fpActive = true;
    useTTSStore.setState({ playbackStatus: 'paused', currentMessageId: 'm' });

    getState().resume();

    expect(mockAudioFilePlayer.resume).toHaveBeenCalled();
    expect(mockEngine.resume).not.toHaveBeenCalled();
    expect(getState().playbackStatus).toBe('playing');
  });

  it('resume routes to the ENGINE when the file player is not active', () => {
    mockCtl.fpActive = false;
    useTTSStore.setState({ playbackStatus: 'paused', currentMessageId: 'm' });

    getState().resume();

    expect(mockEngine.resume).toHaveBeenCalled();
    expect(mockAudioFilePlayer.resume).not.toHaveBeenCalled();
    expect(getState().playbackStatus).toBe('playing');
  });
});

describe('stopPlayback — halts all three paths', () => {
  it('aborts the streaming coordinator, stops the engine and file player, and goes idle', () => {
    mockCtl.fpActive = true;
    useTTSStore.setState({ playbackStatus: 'playing', currentMessageId: 'm' });

    getState().stop();

    expect(mockResetStreamingSpeech).toHaveBeenCalled();
    expect(mockEngine.stop).toHaveBeenCalled();
    expect(mockAudioFilePlayer.stop).toHaveBeenCalled();
    expect(getState().playbackStatus).toBe('idle');
    expect(getState().currentMessageId).toBeNull();
  });
});

describe('stopStreamingPlayback — clean stop of an active streaming auto-speak', () => {
  it('suppresses the turn drain, stops (not releases) the engine, and goes idle', () => {
    useTTSStore.setState({ playbackStatus: 'playing', currentMessageId: 'm' });

    stopStreamingPlayback({ set: useTTSStore.setState, get: useTTSStore.getState });

    expect(mockStopStreamingSpeechForTurn).toHaveBeenCalled();
    expect(mockEngine.stop).toHaveBeenCalled();
    // does NOT reset the whole streaming coordinator (that would release the engine).
    expect(mockResetStreamingSpeech).not.toHaveBeenCalled();
    expect(getState().playbackStatus).toBe('idle');
  });

  it('is safe when there is no active engine (optional-chaining guard)', () => {
    mockCtl.engineNull = true;
    useTTSStore.setState({ playbackStatus: 'playing', currentMessageId: 'm' });

    expect(() => stopStreamingPlayback({ set: useTTSStore.setState, get: useTTSStore.getState })).not.toThrow();
    expect(mockStopStreamingSpeechForTurn).toHaveBeenCalled();
    expect(getState().playbackStatus).toBe('idle');
  });
});

describe('setPlaybackSpeed — applied to BOTH paths', () => {
  it('sets speed on the file player and the active engine (live, regardless of which is playing)', () => {
    setPlaybackSpeed(2);
    expect(mockAudioFilePlayer.setSpeed).toHaveBeenCalledWith(2);
    expect(mockEngine.setSpeed).toHaveBeenCalledWith(2);
  });

  it('is safe when there is no active engine (still sets the file player)', () => {
    mockCtl.engineNull = true;
    expect(() => setPlaybackSpeed(2)).not.toThrow();
    expect(mockAudioFilePlayer.setSpeed).toHaveBeenCalledWith(2);
  });
});
