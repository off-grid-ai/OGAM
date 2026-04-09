import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ttsService } from '../services/ttsService';
import { kokoroRef } from '../components/KokoroTTSManager';
import { isExecutorchSupported } from '../constants/kokoroModels';
import type { KokoroVoiceId } from '../constants/kokoroModels';
import { DEFAULT_KOKORO_VOICE_ID } from '../constants/kokoroModels';
import logger from '../utils/logger';

export type InterfaceMode = 'chat' | 'audio';

export interface TTSSettings {
  /** 'chat' = text bubbles + play button per message; 'audio' = waveform bubbles */
  interfaceMode: InterfaceMode;
  enabled: boolean;
  /** Chat Mode only — auto-speak AI responses after streaming */
  autoPlay: boolean;
  speed: number;
  voiceId: string;
  /** Kokoro voice used for Chat Mode speak (fast path) */
  kokoroVoiceId: KokoroVoiceId;
}

export interface TTSState {
  // Download
  isBackboneDownloaded: boolean;
  isVocoderDownloaded: boolean;
  isDownloadingBackbone: boolean;
  isDownloadingVocoder: boolean;
  backboneDownloadProgress: number;
  vocoderDownloadProgress: number;

  // Model lifecycle
  isModelLoading: boolean;
  isModelLoaded: boolean;

  // Playback
  isSpeaking: boolean;
  isPaused: boolean;
  /** True while LLM inference is running to generate audio tokens (before audio plays). OuteTTS only — Kokoro streams so this is never set. */
  isGeneratingAudio: boolean;
  currentMessageId: string | null;

  // Kokoro (fast TTS, Android 13+ / iOS 17+)
  kokoroReady: boolean;
  kokoroDownloadProgress: number;
  /** True only while Kokoro is actively pushing audio chunks (first chunk received) */
  isAudioPlaying: boolean;
  /** RMS amplitude of the current audio chunk (0–1), updated per chunk for waveform sync */
  currentAmplitude: number;
  /** Elapsed playback seconds — accumulated per Kokoro chunk for progress display */
  playbackElapsed: number;

  // Cache
  audioCacheSizeMB: number;

  // Settings (persisted)
  settings: TTSSettings;

  error: string | null;

  // Actions
  checkDownloadStatus: () => Promise<void>;
  downloadModels: () => Promise<void>;
  deleteModels: () => Promise<void>;
  loadModels: () => Promise<void>;
  unloadModels: () => Promise<void>;

  // Chat Mode
  speak: (text: string, messageId: string) => Promise<void>;
  stop: () => void;
  pause: () => void;
  resume: () => void;

  // Audio Mode
  generateAndSave: (
    text: string,
    conversationId: string,
    messageId: string,
  ) => Promise<{ path: string; waveformData: number[]; durationSeconds: number }>;
  playMessage: (messageId: string, filePath: string, startOffset?: number) => Promise<void>;
  stopPlayback: () => void;

  // Cache management
  refreshCacheSize: () => Promise<void>;
  clearAudioCache: () => Promise<void>;

  setKokoroState: (ready: boolean, progress: number) => void;
  setAudioPlaying: (playing: boolean) => void;
  setCurrentAmplitude: (amplitude: number) => void;
  addPlaybackElapsed: (seconds: number) => void;
  updateSettings: (patch: Partial<TTSSettings>) => void;
  clearError: () => void;
}

export const useTTSStore = create<TTSState>()(
  persist(
    (set, get) => ({
      isBackboneDownloaded: false,
      isVocoderDownloaded: false,
      isDownloadingBackbone: false,
      isDownloadingVocoder: false,
      backboneDownloadProgress: 0,
      vocoderDownloadProgress: 0,
      isModelLoading: false,
      isModelLoaded: false,
      isSpeaking: false,
      isPaused: false,
      isGeneratingAudio: false,
      currentMessageId: null,
      kokoroReady: false,
      kokoroDownloadProgress: 0,
      isAudioPlaying: false,
      currentAmplitude: 0,
      playbackElapsed: 0,
      audioCacheSizeMB: 0,
      settings: {
        interfaceMode: 'chat',
        enabled: true,
        autoPlay: false,
        speed: 1.0,
        voiceId: '0',
        kokoroVoiceId: DEFAULT_KOKORO_VOICE_ID,
      },
      error: null,

      checkDownloadStatus: async () => {
        const [backbone, vocoder] = await Promise.all([
          ttsService.isBackboneDownloaded(),
          ttsService.isVocoderDownloaded(),
        ]);
        set({ isBackboneDownloaded: backbone, isVocoderDownloaded: vocoder });
      },

      downloadModels: async () => {
        set({ error: null });
        try {
          set({ isDownloadingBackbone: true, backboneDownloadProgress: 0 });
          await ttsService.downloadBackbone((p) => set({ backboneDownloadProgress: p }));
          set({ isDownloadingBackbone: false, isBackboneDownloaded: true });

          set({ isDownloadingVocoder: true, vocoderDownloadProgress: 0 });
          await ttsService.downloadVocoder((p) => set({ vocoderDownloadProgress: p }));
          set({ isDownloadingVocoder: false, isVocoderDownloaded: true });
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Download failed';
          logger.error('[TTS Store] Download error:', msg);
          set({ isDownloadingBackbone: false, isDownloadingVocoder: false, error: msg });
        }
      },

      deleteModels: async () => {
        await ttsService.deleteModels();
        set({
          isBackboneDownloaded: false,
          isVocoderDownloaded: false,
          isModelLoaded: false,
        });
      },

      loadModels: async () => {
        if (get().isModelLoaded || get().isModelLoading) {
          return;
        }
        set({ isModelLoading: true, error: null });
        try {
          await ttsService.loadModels();
          set({ isModelLoaded: true });
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Failed to load TTS models';
          logger.error('[TTS Store] Load error:', msg);
          set({ error: msg });
        } finally {
          set({ isModelLoading: false });
        }
      },

      unloadModels: async () => {
        await ttsService.unloadModels();
        set({ isModelLoaded: false, isSpeaking: false, currentMessageId: null });
      },

      // ── Chat Mode ───────────────────────────────────────────────────────────

      speak: async (text: string, messageId: string) => {
        const { settings } = get();
        if (!settings.enabled) return;

        // Tapping same message while speaking → stop
        if (get().currentMessageId === messageId && get().isSpeaking) {
          get().stop();
          return;
        }

        // ── Kokoro fast path (Android 13+ / iOS 17+, model ready) ────────────
        if (get().kokoroReady && isExecutorchSupported()) {
          ttsService.stop();
          kokoroRef.stop(true);
          // Set state immediately so UI shows loading for the new message right away
          // (before the 300ms native cleanup wait)
          set({ isSpeaking: true, isPaused: false, isAudioPlaying: false, isGeneratingAudio: false, currentMessageId: messageId, playbackElapsed: 0, error: null });
          await new Promise<void>((r) => setTimeout(r, 300));
          try {
            kokoroRef.setKeepAlive(false);
            await kokoroRef.speak(text, settings.speed);
          } catch (err) {
            const msg = err instanceof Error ? err.message : 'Speech failed';
            logger.error('[TTS Store] Kokoro speak error:', msg);
            set({ error: msg });
          } finally {
            set({ isSpeaking: false, isPaused: false, isAudioPlaying: false, currentAmplitude: 0, playbackElapsed: 0, currentMessageId: null });
          }
          return;
        }

        // ── OuteTTS fallback (slow, Android <13 / Kokoro not loaded yet) ─────
        if (!get().isModelLoaded) return;
        kokoroRef.stop(true); // ensure Kokoro is silent
        // Truncate to keep generation time reasonable (~300 chars ≈ 20-30s on device)
        const truncated = text.length > 300 ? `${text.slice(0, 297)}...` : text;
        set({ isSpeaking: true, isGeneratingAudio: true, currentMessageId: messageId, error: null });
        try {
          await ttsService.speak(
            truncated,
            { speed: settings.speed, voiceId: settings.voiceId },
            () => set({ isGeneratingAudio: false }),
          );
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Speech failed';
          logger.error('[TTS Store] OuteTTS speak error:', msg);
          set({ error: msg });
        } finally {
          set({ isSpeaking: false, isGeneratingAudio: false, currentMessageId: null });
        }
      },

      stop: () => {
        logger.log('[TTS Store] stop() called, isSpeaking:', get().isSpeaking);
        kokoroRef.stop(true);
        ttsService.stop();
        set({ isSpeaking: false, isPaused: false, isAudioPlaying: false, currentAmplitude: 0, playbackElapsed: 0, isGeneratingAudio: false, currentMessageId: null });
      },

      pause: () => {
        kokoroRef.pause();
        set({ isPaused: true, isAudioPlaying: false, currentAmplitude: 0 });
      },

      resume: () => {
        kokoroRef.resume();
        set({ isPaused: false, isAudioPlaying: true });
      },

      // ── Audio Mode ──────────────────────────────────────────────────────────

      generateAndSave: async (text, conversationId, messageId) => {
        const { settings } = get();
        const { path, audio } = await ttsService.generateAndSave(
          text,
          { conversationId, messageId },
          { voiceId: settings.voiceId },
        );
        await get().refreshCacheSize();
        return { path, waveformData: audio.waveformData, durationSeconds: audio.durationSeconds };
      },

      playMessage: async (messageId, filePath, startOffset = 0) => {
        const { settings } = get();
        if (get().currentMessageId === messageId && get().isSpeaking) {
          get().stopPlayback();
          return;
        }
        ttsService.stop();
        set({ isSpeaking: true, currentMessageId: messageId, error: null });
        try {
          await ttsService.playFromFile(filePath, settings.speed, startOffset);
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Playback failed';
          logger.error('[TTS Store] Playback error:', msg);
          set({ error: msg });
        } finally {
          set({ isSpeaking: false, currentMessageId: null });
        }
      },

      stopPlayback: () => {
        ttsService.stop();
        set({ isSpeaking: false, currentMessageId: null });
      },

      // ── Cache ───────────────────────────────────────────────────────────────

      refreshCacheSize: async () => {
        const mb = await ttsService.getAudioCacheSizeMB();
        set({ audioCacheSizeMB: mb });
      },

      clearAudioCache: async () => {
        await ttsService.clearAudioCache();
        set({ audioCacheSizeMB: 0 });
      },

      setKokoroState: (ready, progress) => {
        set({ kokoroReady: ready, kokoroDownloadProgress: progress });
      },

      setAudioPlaying: (playing) => set({ isAudioPlaying: playing }),
      setCurrentAmplitude: (amplitude) => set({ currentAmplitude: amplitude }),
      addPlaybackElapsed: (seconds) => set((s) => ({ playbackElapsed: s.playbackElapsed + seconds })),

      updateSettings: (patch) => {
        set((state) => ({ settings: { ...state.settings, ...patch } }));
      },

      clearError: () => set({ error: null }),
    }),
    {
      name: 'tts-store',
      storage: createJSONStorage(() => AsyncStorage),
      // Only persist settings — runtime state is transient
      partialize: (state) => ({ settings: state.settings }),
    },
  ),
);
