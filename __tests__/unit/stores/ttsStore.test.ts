/**
 * TTS Store Unit Tests
 *
 * Tests for the engine-agnostic TTS store.
 * The store delegates to the active TTSEngine via the registry.
 */

// Mock the engine module — we control the registry and engine instances
const mockEngine = {
  id: 'mock-tts',
  displayName: 'Mock TTS',
  capabilities: {
    streaming: false,
    voiceCloning: false,
    pauseResume: true,
    generateAndSave: true,
    peakRamMB: 100,
  },
  getPhase: jest.fn(() => 'ready' as const),
  on: jest.fn(() => jest.fn()), // returns unsub
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
  generateAndSave: jest.fn().mockResolvedValue({
    filePath: '/cache/c1/m1.pcm',
    durationSeconds: 2.5,
    waveformData: new Array(200).fill(0.1),
  }),
  stop: jest.fn(),
  pause: jest.fn(),
  resume: jest.fn(),
  setSpeed: jest.fn(),
};

jest.mock('../../../pro/audio/engine', () => ({
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

import { useTTSStore } from '../../../pro/audio/ttsStore';

const getState = () => useTTSStore.getState();

const resetState = () => {
  useTTSStore.setState({
    phase: 'ready',
    currentMessageId: null,
    currentAmplitude: 0,
    playbackElapsed: 0,
    playbackStatus: 'idle',
    playSessionId: 0,
    error: null,
    isReady: true,
    isDownloading: false,
    isLoading: false,
    isSpeaking: false,
    isPaused: false,
    isGeneratingAudio: false,
    assets: [],
    overallDownloadProgress: 1,
    voices: [{ id: 'default', label: 'Default', metadata: {} }],
    activeVoiceId: 'default',
    audioCacheSizeMB: 0,
    settings: {
      interfaceMode: 'chat',
      enabled: true,
      autoPlay: false,
      speed: 1.0,
      engineId: 'mock-tts',
      voiceByEngine: {},
    },
  });
};

describe('ttsStore', () => {
  beforeEach(() => {
    resetState();
    jest.clearAllMocks();
  });

  // ── Speak ──────────────────────────────────────────────────────────────

  describe('speak', () => {
    it('delegates to engine.speak with correct options', async () => {
      await getState().speak('hello', 'msg1');

      expect(mockEngine.speak).toHaveBeenCalledWith('hello', expect.objectContaining({
        speed: 1.0,
        messageId: 'msg1',
      }));
    });

    it('toggles off when same message is already speaking', async () => {
      useTTSStore.setState({ playbackStatus: 'playing', currentMessageId: 'msg1' });

      await getState().speak('hello', 'msg1');

      expect(mockEngine.stop).toHaveBeenCalled();
      expect(mockEngine.speak).not.toHaveBeenCalled();
    });

    it('does nothing when TTS is disabled', async () => {
      useTTSStore.setState({ settings: { ...getState().settings, enabled: false } });

      await getState().speak('hello', 'msg1');

      expect(mockEngine.speak).not.toHaveBeenCalled();
    });

    it('clears currentMessageId after completion', async () => {
      await getState().speak('hello', 'msg1');

      expect(getState().currentMessageId).toBeNull();
    });
  });

  // ── Stop / Pause / Resume ─────────────────────────────────────────────

  describe('stop', () => {
    it('delegates to engine.stop and clears state', () => {
      useTTSStore.setState({ currentMessageId: 'msg1' });
      getState().stop();

      expect(mockEngine.stop).toHaveBeenCalled();
      expect(getState().currentMessageId).toBeNull();
    });
  });

  describe('pause/resume', () => {
    it('delegates to engine', () => {
      getState().pause();
      expect(mockEngine.pause).toHaveBeenCalled();

      getState().resume();
      expect(mockEngine.resume).toHaveBeenCalled();
    });
  });

  // ── Generate and Save ─────────────────────────────────────────────────

  describe('generateAndSave', () => {
    it('delegates to engine and returns result', async () => {
      const result = await getState().generateAndSave('hello', 'conv1', 'msg1');

      expect(mockEngine.generateAndSave).toHaveBeenCalledWith('hello', 'conv1', 'msg1', expect.any(Object));
      expect(result.path).toBe('/cache/c1/m1.pcm');
      expect(result.waveformData).toHaveLength(200);
      expect(result.durationSeconds).toBe(2.5);
    });
  });

  // ── Settings ──────────────────────────────────────────────────────────

  describe('updateSettings', () => {
    it('merges partial settings', () => {
      getState().updateSettings({ speed: 1.5, autoPlay: true });
      const { settings } = getState();
      expect(settings.speed).toBe(1.5);
      expect(settings.autoPlay).toBe(true);
      expect(settings.enabled).toBe(true);
    });

    it('can switch interfaceMode', () => {
      getState().updateSettings({ interfaceMode: 'audio' });
      expect(getState().settings.interfaceMode).toBe('audio');
    });
  });

  describe('clearError', () => {
    it('clears the error field', () => {
      useTTSStore.setState({ error: 'something went wrong' });
      getState().clearError();
      expect(getState().error).toBeNull();
    });
  });
});
