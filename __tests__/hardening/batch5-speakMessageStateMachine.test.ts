/**
 * BATCH 5 (TTS & Audio) — hardening — speakMessage state machine (the chat "speak"
 * entry point in pro/audio/ttsPlayback via the TTS store).
 *
 * The existing ttsStore.test.ts drives the store's `speak` action for the happy path,
 * toggle-off, and disabled bail. UNTESTED, and exercised here against the REAL
 * speakMessage (only the engine registry boundary is mocked):
 *
 *  - the "ignore taps while preparing" guard — a stop() mid-load crashes the freshly
 *    loaded executorch stream, so a second tap during the preparing window is dropped
 *    (the stop-only-while-preparing seam, at the speak layer).
 *  - "stop the other message before starting a new one" — the engine runs one stream
 *    at a time; a new speak while a DIFFERENT message plays must stop the old first
 *    (Provit case 17: a new message supersedes the current stream, no dual playback).
 *  - engine-not-ready graceful bail → dispatches `ended` (no throw, no stuck spinner):
 *    this is the deleted/unavailable-engine case (Provit case 33: tapping speak with
 *    the TTS engine removed must not crash — it settles back to idle).
 *  - a synthesis failure dispatches `failed` (error surfaced, status back to idle).
 *
 * Deleting speakMessage's guards would fail these — the real store action + real
 * playback machine run; only the native engine is a stub returning plain data.
 */
const mockEngine = {
  id: 'mock-tts',
  displayName: 'Mock TTS',
  capabilities: { streaming: true, voiceCloning: false, pauseResume: true, generateAndSave: false, peakRamMB: 100 },
  getPhase: jest.fn(() => 'ready' as string),
  on: jest.fn(() => jest.fn()),
  off: jest.fn(),
  once: jest.fn(() => jest.fn()),
  isSupported: jest.fn(() => true),
  initialize: jest.fn().mockResolvedValue(undefined),
  release: jest.fn().mockResolvedValue(undefined),
  destroy: jest.fn().mockResolvedValue(undefined),
  getRequiredAssets: jest.fn(() => []),
  checkAssetStatus: jest.fn().mockResolvedValue([]),
  downloadAssets: jest.fn().mockResolvedValue(undefined),
  deleteAssets: jest.fn().mockResolvedValue(undefined),
  getOverallDownloadProgress: jest.fn(() => 1),
  isFullyDownloaded: jest.fn(() => true),
  getBridgeComponent: jest.fn(() => null),
  getVoices: jest.fn(() => [{ id: 'default', label: 'Default', metadata: {} }]),
  getActiveVoice: jest.fn(() => ({ id: 'default', label: 'Default', metadata: {} })),
  setVoice: jest.fn().mockResolvedValue(undefined),
  speak: jest.fn().mockResolvedValue(undefined),
  generateAndSave: jest.fn(),
  stop: jest.fn(),
  pause: jest.fn(),
  resume: jest.fn(),
  setSpeed: jest.fn(),
};

jest.mock('../../pro/audio/engine', () => ({
  ttsRegistry: {
    register: jest.fn(),
    has: jest.fn(() => true),
    getEngine: jest.fn(() => mockEngine),
    setActiveEngine: jest.fn().mockResolvedValue(mockEngine),
    getActiveEngine: jest.fn(() => mockEngine),
    getActiveEngineId: jest.fn(() => 'mock-tts'),
    getRegisteredIds: jest.fn(() => ['mock-tts']),
  },
  OuteTTSEngine: class {},
}));

jest.mock('@offgrid/core/utils/logger', () => ({
  __esModule: true,
  default: { log: jest.fn(), error: jest.fn(), warn: jest.fn() },
}));

import { useTTSStore } from '../../pro/audio/ttsStore';

const getState = () => useTTSStore.getState();

function resetState() {
  useTTSStore.setState({
    phase: 'ready', currentMessageId: null, currentAmplitude: 0, playbackElapsed: 0,
    playbackDuration: 0, playbackStatus: 'idle', playSessionId: 0, error: null,
    isReady: true, isDownloading: false, isLoading: false, isSpeaking: false, isPaused: false,
    isGeneratingAudio: false, assets: [], overallDownloadProgress: 1,
    voices: [{ id: 'default', label: 'Default', metadata: {} }], activeVoiceId: 'default',
    audioCacheSizeMB: 0,
    settings: { interfaceMode: 'chat', enabled: true, speed: 1.0, engineId: 'mock-tts', voiceByEngine: {} },
  });
}

beforeEach(() => {
  resetState();
  jest.clearAllMocks();
  mockEngine.getPhase.mockReturnValue('ready');
  mockEngine.isFullyDownloaded.mockReturnValue(true);
  mockEngine.speak.mockResolvedValue(undefined);
});

describe('speakMessage — preparing-tap guard (stop-only-while-preparing seam)', () => {
  it('drops a tap that arrives while status is preparing (no engine.speak, no state change)', async () => {
    // A tap during the slow load window would, if honoured, race a stop() mid-load and
    // crash the freshly-loaded executorch stream. It must be ignored.
    useTTSStore.setState({ playbackStatus: 'preparing', currentMessageId: 'm-loading' });

    await getState().speak('hello', 'm-different');

    expect(mockEngine.speak).not.toHaveBeenCalled();
    expect(mockEngine.stop).not.toHaveBeenCalled();
    expect(getState().playbackStatus).toBe('preparing'); // untouched
    expect(getState().currentMessageId).toBe('m-loading');
  });
});

describe('speakMessage — supersede: stop the other message before starting', () => {
  it('stops a DIFFERENT playing message before speaking the new one (no dual playback)', async () => {
    useTTSStore.setState({ playbackStatus: 'playing', currentMessageId: 'm-old' });

    await getState().speak('new text', 'm-new');

    expect(mockEngine.stop).toHaveBeenCalled();       // old stream stopped first
    expect(mockEngine.speak).toHaveBeenCalledWith('new text', expect.objectContaining({ messageId: 'm-new' }));
  });
});

describe('speakMessage — engine not ready (deleted / unavailable engine)', () => {
  it('bails to idle without throwing when the engine is not ready and not downloaded (deleted-engine case)', async () => {
    // Provit case 33: the TTS engine was removed. Tapping speak must NOT crash; the
    // machine dispatches `ended` and settles back to idle.
    mockEngine.getPhase.mockReturnValue('idle');
    mockEngine.isFullyDownloaded.mockReturnValue(false);

    await expect(getState().speak('hello', 'm1')).resolves.toBeUndefined();

    expect(mockEngine.speak).not.toHaveBeenCalled();
    expect(getState().playbackStatus).toBe('idle');
    expect(getState().currentMessageId).toBeNull();
  });

  it('bails to idle when the engine stays not-ready even after an initialize attempt', async () => {
    // idle + downloaded → speak initializes through the residency lock; if the engine
    // still is not ready afterward, it must settle to idle (not stick on preparing).
    mockEngine.getPhase.mockReturnValue('idle');
    mockEngine.isFullyDownloaded.mockReturnValue(true);
    mockEngine.initialize.mockResolvedValueOnce(undefined); // init runs but phase stays 'idle'

    await expect(getState().speak('hello', 'm1')).resolves.toBeUndefined();

    expect(mockEngine.speak).not.toHaveBeenCalled();
    expect(getState().playbackStatus).toBe('idle');
  });
});

describe('speakMessage — synthesis failure', () => {
  it('surfaces the error and returns to idle when engine.speak rejects', async () => {
    mockEngine.speak.mockRejectedValueOnce(new Error('synthesis blew up'));

    await expect(getState().speak('hello', 'm1')).resolves.toBeUndefined(); // never rethrows to the UI

    expect(getState().error).toMatch(/synthesis blew up/i);
    expect(getState().playbackStatus).toBe('idle'); // ended dispatched in finally
    expect(getState().currentMessageId).toBeNull();
  });
});
