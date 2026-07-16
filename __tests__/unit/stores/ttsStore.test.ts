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
  hydrateDownloaded: jest.fn(),
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

import { useTTSStore, _setVoiceSwitchTimeoutForTest } from '../../../pro/audio/ttsStore';

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

  describe('setVoice (logged, timeout-guarded switch)', () => {
    it('clears isSwitchingVoice after a successful switch', async () => {
      mockEngine.setVoice.mockResolvedValueOnce(undefined);
      await getState().setVoice('default');
      expect(mockEngine.setVoice).toHaveBeenCalledWith('default');
      expect(getState().isSwitchingVoice).toBe(false);
    });

    it('does NOT hang when the engine voice fetch never settles — times out and recovers', async () => {
      _setVoiceSwitchTimeoutForTest(20);
      mockEngine.setVoice.mockReturnValueOnce(new Promise<void>(() => { /* never resolves (stuck native fetch) */ }));
      await getState().setVoice('default');
      // The spinner must clear and an error surfaces — never a permanent stuck state.
      expect(getState().isSwitchingVoice).toBe(false);
      expect(getState().error).toMatch(/timed out/i);
      _setVoiceSwitchTimeoutForTest(45000);
    });

    it('recovers (clears the flag, surfaces error) when the switch rejects', async () => {
      mockEngine.setVoice.mockRejectedValueOnce(new Error('fetch failed'));
      await getState().setVoice('default');
      expect(getState().isSwitchingVoice).toBe(false);
      expect(getState().error).toBe('fetch failed');
    });

    it('deleteModels clears a stuck isSwitchingVoice (delete mid-switch must not lock the picker)', async () => {
      useTTSStore.setState({ isSwitchingVoice: true });
      await getState().deleteModels();
      expect(getState().isSwitchingVoice).toBe(false);
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
      getState().updateSettings({ speed: 1.5 });
      const { settings } = getState();
      expect(settings.speed).toBe(1.5);
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

  // ── Routing & engine ────────────────────────────────────────────────────
  describe('play routing', () => {
    it('synthesizes via the engine when there is no audio file', async () => {
      await getState().play('msg-x', { text: 'hello world' });
      expect(mockEngine.speak).toHaveBeenCalledWith('hello world', expect.objectContaining({ messageId: 'msg-x' }));
    });
  });

  describe('seek', () => {
    it('is a no-op for non-file (streaming) clips', async () => {
      await getState().seek('msg-x', 0.5);
      expect(mockEngine.speak).not.toHaveBeenCalled();
    });
  });

  describe('setEngine fallback', () => {
    it('falls back to the default when the requested engine is not registered', async () => {
      const { ttsRegistry } = jest.requireMock('../../../pro/audio/engine');
      ttsRegistry.getRegisteredIds.mockReturnValue(['mock-tts']);
      ttsRegistry.setActiveEngine.mockResolvedValue(mockEngine);
      await getState().setEngine('outetts');
      expect(ttsRegistry.setActiveEngine).toHaveBeenCalledWith('kokoro');
      expect(getState().settings.engineId).toBe('kokoro');
    });
  });

  describe('updateSettings speed', () => {
    it('applies a live speed change to the active engine', () => {
      getState().updateSettings({ speed: 1.5 });
      expect(mockEngine.setSpeed).toHaveBeenCalledWith(1.5);
    });
  });

  // The persisted modelDownloaded flag is the durable cross-restart truth (set only
  // after a genuine fetch, cleared only by an explicit delete). The engine's in-memory
  // completeness signal is volatile and can desync to false on a mid-session re-init /
  // bridge unmount that never re-ran the hydrate path. checkDownloadStatus must
  // reconcile the engine TOWARD the persisted truth, or a present-on-disk model reports
  // not-downloaded and every play() bails (the on-device TTS dead-play bug).
  describe('checkDownloadStatus reconciles the engine to the persisted truth', () => {
    // A dynamic engine whose reported completeness follows its volatile flag, which
    // hydrateDownloaded flips — proving the fix drives real state, not a call count.
    function desyncedEngine(persistedFlagWins: { genuine: boolean }, opts: { progress?: number; phase?: string } = {}) {
      const asset = { id: 'kokoro-medium', label: 'Kokoro', url: '', sizeBytes: 1, filename: 'k' };
      return {
        ...mockEngine,
        id: 'mock-tts',
        getPhase: jest.fn(() => (opts.phase ?? 'idle') as any),
        getOverallDownloadProgress: jest.fn(() => opts.progress ?? 0),
        hydrateDownloaded: jest.fn((v: boolean) => { persistedFlagWins.genuine = v; }),
        isFullyDownloaded: jest.fn(() => persistedFlagWins.genuine),
        checkAssetStatus: jest.fn(async () => [{
          asset,
          status: persistedFlagWins.genuine ? 'downloaded' : 'not-downloaded',
          progress: persistedFlagWins.genuine ? 1 : (opts.progress ?? 0),
        }]),
      };
    }

    it('re-hydrates a desynced engine (persisted=true, engine volatile-false, idle) and then reports downloaded', async () => {
      const { ttsRegistry } = jest.requireMock('../../../pro/audio/engine');
      const state = { genuine: false }; // engine desynced to NOT-complete
      const engine = desyncedEngine(state);
      ttsRegistry.getActiveEngine.mockReturnValue(engine);
      useTTSStore.setState({ settings: { ...getState().settings, modelDownloaded: { 'mock-tts': true } } });

      await getState().checkDownloadStatus();

      // Reconciled to the durable truth: engine re-seeded, status now downloaded.
      expect(engine.hydrateDownloaded).toHaveBeenCalledWith(true);
      expect(getState().assets[0].status).toBe('downloaded');
    });

    it('does NOT fabricate downloaded when the persisted flag is false', async () => {
      const { ttsRegistry } = jest.requireMock('../../../pro/audio/engine');
      const engine = desyncedEngine({ genuine: false });
      ttsRegistry.getActiveEngine.mockReturnValue(engine);
      useTTSStore.setState({ settings: { ...getState().settings, modelDownloaded: { 'mock-tts': false } } });

      await getState().checkDownloadStatus();

      expect(engine.hydrateDownloaded).not.toHaveBeenCalledWith(true);
      expect(getState().assets[0].status).toBe('not-downloaded');
    });

    it('does NOT re-hydrate while a download is in flight (respects the live fetch)', async () => {
      const { ttsRegistry } = jest.requireMock('../../../pro/audio/engine');
      const engine = desyncedEngine({ genuine: false }, { progress: 0.4, phase: 'downloading' });
      ttsRegistry.getActiveEngine.mockReturnValue(engine);
      useTTSStore.setState({ settings: { ...getState().settings, modelDownloaded: { 'mock-tts': true } } });

      await getState().checkDownloadStatus();

      // A live download is authoritative not-complete — the stale persisted flag must
      // not force it back to downloaded mid-fetch.
      expect(engine.hydrateDownloaded).not.toHaveBeenCalledWith(true);
    });
  });
});
