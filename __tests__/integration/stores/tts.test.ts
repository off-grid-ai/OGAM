/**
 * TTS Integration Tests
 *
 * Tests the wiring between ttsStore and the engine registry.
 * Verifies full flows delegate correctly through the engine interface.
 */

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
  on: jest.fn(() => jest.fn()),
  off: jest.fn(),
  once: jest.fn(() => jest.fn()),
  isSupported: jest.fn(() => true),
  initialize: jest.fn().mockResolvedValue(undefined),
  release: jest.fn().mockResolvedValue(undefined),
  destroy: jest.fn().mockResolvedValue(undefined),
  getRequiredAssets: jest.fn(() => [
    { id: 'backbone', label: 'Voice Model', url: 'https://example.com/bb.gguf', sizeBytes: 454 * 1024 * 1024, filename: 'bb.gguf' },
    { id: 'vocoder', label: 'Decoder', url: 'https://example.com/voc.gguf', sizeBytes: 73 * 1024 * 1024, filename: 'voc.gguf' },
  ]),
  checkAssetStatus: jest.fn().mockResolvedValue([
    { asset: { id: 'backbone', label: 'Voice Model', url: '', sizeBytes: 454 * 1024 * 1024, filename: 'bb.gguf' }, status: 'downloaded', progress: 1 },
    { asset: { id: 'vocoder', label: 'Decoder', url: '', sizeBytes: 73 * 1024 * 1024, filename: 'voc.gguf' }, status: 'downloaded', progress: 1 },
  ]),
  downloadAssets: jest.fn().mockResolvedValue(undefined),
  deleteAssets: jest.fn().mockResolvedValue(undefined),
  getOverallDownloadProgress: jest.fn(() => 1),
  isFullyDownloaded: jest.fn(() => true),
  getBridgeComponent: jest.fn(() => null),
  getVoices: jest.fn(() => [{ id: '0', label: 'Default', metadata: {} }]),
  getActiveVoice: jest.fn(() => ({ id: '0', label: 'Default', metadata: {} })),
  setVoice: jest.fn().mockResolvedValue(undefined),
  speak: jest.fn().mockResolvedValue(undefined),
  generateAndSave: jest.fn().mockResolvedValue({
    filePath: '/cache/c1/m1.pcm',
    durationSeconds: 1.5,
    waveformData: new Array(200).fill(0.2),
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

const resetStore = () => {
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
    voices: [{ id: '0', label: 'Default', metadata: {} }],
    activeVoiceId: '0',
    audioCacheSizeMB: 0,
    settings: {
      interfaceMode: 'chat',
      enabled: true,
      speed: 1.0,
      engineId: 'mock-tts',
      voiceByEngine: {},
    },
  });
};

describe('TTS integration', () => {
  beforeEach(() => {
    resetStore();
    jest.clearAllMocks();
  });

  // ── Chat Mode full flow ───────────────────────────────────────────────

  describe('Chat Mode: speak → stop', () => {
    it('completes the full Chat Mode flow', async () => {
      // Speak
      const speakPromise = getState().speak('hello', 'msg1');
      expect(getState().currentMessageId).toBe('msg1');

      await speakPromise;
      expect(mockEngine.speak).toHaveBeenCalledWith('hello', expect.objectContaining({
        speed: 1.0,
        messageId: 'msg1',
      }));
      expect(getState().currentMessageId).toBeNull();

      // Stop mid-speech
      mockEngine.speak.mockImplementation(
        () => new Promise((resolve) => setTimeout(resolve, 1000)),
      );
      getState().speak('second', 'msg2');
      getState().stop();
      expect(mockEngine.stop).toHaveBeenCalled();
    });
  });

  // ── Audio Mode full flow ──────────────────────────────────────────────

  describe('Audio Mode: generateAndSave → stop', () => {
    beforeEach(() => {
      useTTSStore.setState({
        settings: { ...getState().settings, interfaceMode: 'audio' },
      });
    });

    it('completes the full Audio Mode flow', async () => {
      const result = await getState().generateAndSave('hello audio', 'conv1', 'msg1');

      expect(result.path).toBe('/cache/c1/m1.pcm');
      expect(result.waveformData).toHaveLength(200);
      expect(result.durationSeconds).toBe(1.5);

      getState().stop();
      expect(mockEngine.stop).toHaveBeenCalled();
    });
  });

  // ── Mode switching ────────────────────────────────────────────────────

  describe('mode switching', () => {
    it('switching interfaceMode to audio takes effect', () => {
      expect(getState().settings.interfaceMode).toBe('chat');
      getState().updateSettings({ interfaceMode: 'audio' });
      expect(getState().settings.interfaceMode).toBe('audio');
    });

    it('switching back to chat mode works', () => {
      getState().updateSettings({ interfaceMode: 'audio' });
      getState().updateSettings({ interfaceMode: 'chat' });
      expect(getState().settings.interfaceMode).toBe('chat');
    });
  });

  // ── Engine-agnostic speak ─────────────────────────────────────────────

  describe('auto-play', () => {
    it('speak delegates to the engine when ready', async () => {
      await getState().speak('AI response', 'last-msg');

      expect(mockEngine.speak).toHaveBeenCalledWith('AI response', expect.objectContaining({
        messageId: 'last-msg',
      }));
    });
  });
});
