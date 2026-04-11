/**
 * TTS Integration Tests
 *
 * Tests the wiring between ttsStore and ttsService:
 * - Chat Mode full flow: download → load → speak → stop
 * - Audio Mode full flow: download → load → generateAndSave → playMessage → stop
 * - Auto-play triggering in Chat Mode
 * - Mode switching
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

const mockTTS = ttsService as jest.Mocked<typeof ttsService>;
const getState = () => useTTSStore.getState();

const resetStore = () => {
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
    settings: { interfaceMode: 'chat', enabled: true, autoPlay: false, speed: 1.0, voiceId: '0', kokoroVoiceId: 'af_heart' },
    error: null,
  });
};

describe('TTS integration', () => {
  beforeEach(() => {
    resetStore();
    jest.clearAllMocks();
    mockTTS.getAudioCacheSizeMB.mockResolvedValue(0);
  });

  // ─── Chat Mode ────────────────────────────────────────────────────────────

  describe('Chat Mode: download → load → speak → stop', () => {
    it('completes the full Chat Mode flow', async () => {
      // 1. Download
      mockTTS.downloadBackbone.mockResolvedValue('/bb.gguf');
      mockTTS.downloadVocoder.mockResolvedValue('/voc.gguf');
      await getState().downloadModels();

      expect(getState().isBackboneDownloaded).toBe(true);
      expect(getState().isVocoderDownloaded).toBe(true);

      // 2. Load
      mockTTS.loadModels.mockResolvedValue(undefined);
      await getState().loadModels();
      expect(getState().isModelLoaded).toBe(true);

      // 3. Speak
      mockTTS.speak.mockResolvedValue(undefined);
      mockTTS.stop.mockReturnValue(undefined);

      const speakPromise = getState().speak('hello', 'msg1');
      expect(getState().isSpeaking).toBe(true);
      expect(getState().currentMessageId).toBe('msg1');

      await speakPromise;
      expect(getState().isSpeaking).toBe(false);
      expect(getState().currentMessageId).toBeNull();

      // 4. Stop mid-speech
      mockTTS.speak.mockImplementation(
        () => new Promise((resolve) => setTimeout(resolve, 1000)),
      );
      getState().speak('second', 'msg2');
      getState().stop();
      expect(getState().isSpeaking).toBe(false);
    });
  });

  // ─── Audio Mode ───────────────────────────────────────────────────────────

  describe('Audio Mode: download → load → generateAndSave → playMessage → stop', () => {
    beforeEach(() => {
      useTTSStore.setState({
        settings: { interfaceMode: 'audio', enabled: true, autoPlay: false, speed: 1.0, voiceId: '0', kokoroVoiceId: 'af_heart' },
      });
    });

    it('completes the full Audio Mode flow', async () => {
      // 1. Download
      mockTTS.downloadBackbone.mockResolvedValue('/bb.gguf');
      mockTTS.downloadVocoder.mockResolvedValue('/voc.gguf');
      await getState().downloadModels();

      // 2. Load
      mockTTS.loadModels.mockResolvedValue(undefined);
      await getState().loadModels();
      expect(getState().isModelLoaded).toBe(true);

      // 3. GenerateAndSave
      const mockAudio = {
        samples: new Float32Array(100),
        durationSeconds: 1.5,
        sampleRate: 24000,
        waveformData: new Array(200).fill(0.2),
      };
      mockTTS.generateAndSave.mockResolvedValue({ path: '/cache/c1/m1.pcm', audio: mockAudio } as any);
      mockTTS.getAudioCacheSizeMB.mockResolvedValue(1.5);

      const result = await getState().generateAndSave('hello audio', 'conv1', 'msg1');

      expect(result.path).toBe('/cache/c1/m1.pcm');
      expect(result.waveformData).toHaveLength(200);
      expect(result.durationSeconds).toBe(1.5);
      expect(getState().audioCacheSizeMB).toBeCloseTo(1.5);

      // 4. PlayMessage
      mockTTS.playFromFile.mockResolvedValue(undefined);
      mockTTS.stop.mockReturnValue(undefined);

      const playPromise = getState().playMessage('msg1', '/cache/c1/m1.pcm');
      expect(getState().isSpeaking).toBe(true);
      expect(getState().currentMessageId).toBe('msg1');

      await playPromise;
      expect(getState().isSpeaking).toBe(false);

      // 5. StopPlayback
      getState().stopPlayback();
      expect(mockTTS.stop).toHaveBeenCalled();
    });
  });

  // ─── Mode switching ───────────────────────────────────────────────────────

  describe('mode switching', () => {
    it('switching interfaceMode to audio takes effect immediately', () => {
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

  // ─── Auto-play ────────────────────────────────────────────────────────────

  describe('auto-play', () => {
    it('speak is called when autoPlay is true and model is loaded', async () => {
      useTTSStore.setState({
        isModelLoaded: true,
        settings: { interfaceMode: 'chat', enabled: true, autoPlay: true, speed: 1.0, voiceId: '0', kokoroVoiceId: 'af_heart' },
      });
      mockTTS.speak.mockResolvedValue(undefined);
      mockTTS.stop.mockReturnValue(undefined);

      // Simulate chat completion triggering speak
      await getState().speak('AI response text', 'last-msg-id');

      expect(mockTTS.speak).toHaveBeenCalledWith(
        'AI response text',
        expect.objectContaining({ voiceId: '0', speed: 1.0 }),
        expect.any(Function),
      );
    });
  });
});
