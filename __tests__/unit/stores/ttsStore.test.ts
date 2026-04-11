/**
 * TTS Store Unit Tests
 *
 * Tests for download state, model lifecycle, Chat Mode speak/stop,
 * Audio Mode generateAndSave/playMessage, and settings persistence.
 * Priority: P1 - Core TTS state management.
 */

jest.mock('../../../src/services/ttsService', () => ({
  ttsService: {
    isBackboneDownloaded: jest.fn(),
    isVocoderDownloaded: jest.fn(),
    downloadBackbone: jest.fn(),
    downloadVocoder: jest.fn(),
    deleteModels: jest.fn(),
    loadModels: jest.fn(),
    unloadModels: jest.fn(),
    speak: jest.fn(),
    stop: jest.fn(),
    generateAndSave: jest.fn(),
    playFromFile: jest.fn(),
    getAudioCacheSizeMB: jest.fn(),
    clearAudioCache: jest.fn(),
  },
}));

jest.mock('../../../src/utils/logger', () => ({
  __esModule: true,
  default: { log: jest.fn(), error: jest.fn(), warn: jest.fn() },
}));

import { useTTSStore } from '../../../src/stores/ttsStore';
import { ttsService } from '../../../src/services/ttsService';

const mockTTSService = ttsService as jest.Mocked<typeof ttsService>;
const getState = () => useTTSStore.getState();

const resetState = () => {
  useTTSStore.setState({
    isBackboneDownloaded: false,
    isVocoderDownloaded: false,
    isDownloadingBackbone: false,
    isDownloadingVocoder: false,
    backboneDownloadProgress: 0,
    vocoderDownloadProgress: 0,
    isModelLoading: false,
    isModelLoaded: false,
    isSpeaking: false,
    currentMessageId: null,
    audioCacheSizeMB: 0,
    settings: {
      interfaceMode: 'chat',
      enabled: true,
      autoPlay: false,
      speed: 1.0,
      voiceId: '0',
      kokoroVoiceId: 'af_heart',
    },
    error: null,
  });
};

describe('ttsStore', () => {
  beforeEach(() => {
    resetState();
    jest.clearAllMocks();
  });

  // ─── Download ─────────────────────────────────────────────────────────────

  describe('checkDownloadStatus', () => {
    it('reflects backbone and vocoder download state', async () => {
      mockTTSService.isBackboneDownloaded.mockResolvedValue(true);
      mockTTSService.isVocoderDownloaded.mockResolvedValue(false);

      await getState().checkDownloadStatus();

      expect(getState().isBackboneDownloaded).toBe(true);
      expect(getState().isVocoderDownloaded).toBe(false);
    });
  });

  describe('downloadModels', () => {
    it('sets progress states and marks both downloaded on success', async () => {
      mockTTSService.downloadBackbone.mockImplementation(async (onProgress) => {
        onProgress?.(0.5);
        onProgress?.(1.0);
        return '/path/backbone';
      });
      mockTTSService.downloadVocoder.mockImplementation(async (onProgress) => {
        onProgress?.(1.0);
        return '/path/vocoder';
      });

      await getState().downloadModels();

      const state = getState();
      expect(state.isBackboneDownloaded).toBe(true);
      expect(state.isVocoderDownloaded).toBe(true);
      expect(state.isDownloadingBackbone).toBe(false);
      expect(state.isDownloadingVocoder).toBe(false);
      expect(state.error).toBeNull();
    });

    it('sets error and resets downloading flags on failure', async () => {
      mockTTSService.downloadBackbone.mockRejectedValue(new Error('network error'));

      await getState().downloadModels();

      const state = getState();
      expect(state.error).toBe('network error');
      expect(state.isDownloadingBackbone).toBe(false);
      expect(state.isDownloadingVocoder).toBe(false);
    });
  });

  // ─── Model lifecycle ─────────────────────────────────────────────────────

  describe('loadModels', () => {
    it('sets isModelLoaded on success', async () => {
      mockTTSService.loadModels.mockResolvedValue(undefined);
      await getState().loadModels();
      expect(getState().isModelLoaded).toBe(true);
      expect(getState().isModelLoading).toBe(false);
    });

    it('sets error on failure', async () => {
      mockTTSService.loadModels.mockRejectedValue(new Error('OOM'));
      await getState().loadModels();
      expect(getState().error).toBe('OOM');
      expect(getState().isModelLoaded).toBe(false);
    });

    it('is a no-op if already loaded', async () => {
      useTTSStore.setState({ isModelLoaded: true });
      await getState().loadModels();
      expect(mockTTSService.loadModels).not.toHaveBeenCalled();
    });
  });

  // ─── Chat Mode ────────────────────────────────────────────────────────────

  describe('speak', () => {
    beforeEach(() => {
      useTTSStore.setState({ isModelLoaded: true });
    });

    it('sets isSpeaking true then false after completion', async () => {
      mockTTSService.speak.mockResolvedValue(undefined);
      mockTTSService.stop.mockReturnValue(undefined);

      const speaking: boolean[] = [];
      const unsubscribe = useTTSStore.subscribe((s) => speaking.push(s.isSpeaking));

      await getState().speak('hello', 'msg1');

      unsubscribe();
      expect(speaking).toContain(true);
      expect(getState().isSpeaking).toBe(false);
    });

    it('stops speaking the same message when called again', async () => {
      useTTSStore.setState({ isSpeaking: true, currentMessageId: 'msg1' });
      mockTTSService.stop.mockReturnValue(undefined);

      await getState().speak('hello', 'msg1');

      expect(mockTTSService.stop).toHaveBeenCalled();
      expect(mockTTSService.speak).not.toHaveBeenCalled();
    });

    it('does nothing if TTS disabled', async () => {
      useTTSStore.setState({ settings: { ...getState().settings, enabled: false } });
      await getState().speak('hello', 'msg1');
      expect(mockTTSService.speak).not.toHaveBeenCalled();
    });

    it('does nothing if model not loaded', async () => {
      useTTSStore.setState({ isModelLoaded: false });
      await getState().speak('hello', 'msg1');
      expect(mockTTSService.speak).not.toHaveBeenCalled();
    });
  });

  // ─── Audio Mode ───────────────────────────────────────────────────────────

  describe('generateAndSave', () => {
    it('returns path, waveformData, durationSeconds and refreshes cache', async () => {
      const mockAudio = {
        samples: new Float32Array(100),
        durationSeconds: 2.5,
        sampleRate: 24000,
        waveformData: new Array(200).fill(0.1),
      };
      mockTTSService.generateAndSave.mockResolvedValue({
        path: '/cache/conv1/msg1.pcm',
        audio: mockAudio,
      });
      mockTTSService.getAudioCacheSizeMB.mockResolvedValue(3.2);

      const result = await getState().generateAndSave('hello', 'conv1', 'msg1');

      expect(result.path).toBe('/cache/conv1/msg1.pcm');
      expect(result.waveformData).toHaveLength(200);
      expect(result.durationSeconds).toBe(2.5);
      expect(getState().audioCacheSizeMB).toBeCloseTo(3.2);
    });
  });

  describe('playMessage', () => {
    it('sets isSpeaking true during playback then false after', async () => {
      mockTTSService.stop.mockReturnValue(undefined);
      mockTTSService.playFromFile.mockResolvedValue(undefined);

      const speaking: boolean[] = [];
      const unsubscribe = useTTSStore.subscribe((s) => speaking.push(s.isSpeaking));

      await getState().playMessage('msg1', '/cache/conv1/msg1.pcm');

      unsubscribe();
      expect(speaking).toContain(true);
      expect(getState().isSpeaking).toBe(false);
    });

    it('stops if same message is already playing', async () => {
      useTTSStore.setState({ isSpeaking: true, currentMessageId: 'msg1' });
      mockTTSService.stop.mockReturnValue(undefined);

      await getState().playMessage('msg1', '/cache/conv1/msg1.pcm');

      expect(mockTTSService.stop).toHaveBeenCalled();
      expect(mockTTSService.playFromFile).not.toHaveBeenCalled();
    });
  });

  // ─── Settings ─────────────────────────────────────────────────────────────

  describe('updateSettings', () => {
    it('merges partial settings correctly', () => {
      getState().updateSettings({ speed: 1.5, autoPlay: true });
      const { settings } = getState();
      expect(settings.speed).toBe(1.5);
      expect(settings.autoPlay).toBe(true);
      // Other fields untouched
      expect(settings.enabled).toBe(true);
      expect(settings.voiceId).toBe('0');
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

  // ─── Cache ────────────────────────────────────────────────────────────────

  describe('clearAudioCache', () => {
    it('calls ttsService.clearAudioCache and resets size', async () => {
      useTTSStore.setState({ audioCacheSizeMB: 10 });
      mockTTSService.clearAudioCache.mockResolvedValue(undefined);

      await getState().clearAudioCache();

      expect(mockTTSService.clearAudioCache).toHaveBeenCalled();
      expect(getState().audioCacheSizeMB).toBe(0);
    });
  });
});
