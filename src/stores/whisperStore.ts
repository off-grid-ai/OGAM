import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { whisperService, WHISPER_MODELS } from '../services';
import { modelResidencyManager } from '../services/modelResidency';

interface WhisperState {
  // Downloaded model ID
  downloadedModelId: string | null;
  isDownloading: boolean;
  downloadProgress: number;
  isModelLoading: boolean;
  isModelLoaded: boolean;
  error: string | null;

  // Actions
  downloadModel: (modelId: string) => Promise<void>;
  downloadFromUrl: (url: string, modelId: string) => Promise<void>;
  loadModel: () => Promise<void>;
  unloadModel: () => Promise<void>;
  deleteModel: () => Promise<void>;
  clearError: () => void;
}

export const useWhisperStore = create<WhisperState>()(
  persist(
    (set, get) => ({
      downloadedModelId: null,
      isDownloading: false,
      downloadProgress: 0,
      isModelLoading: false,
      isModelLoaded: false,
      error: null,

      downloadModel: async (modelId: string) => {
        set({ isDownloading: true, downloadProgress: 0, error: null });

        try {
          await whisperService.downloadModel(modelId, (progress) => {
            set({ downloadProgress: progress });
          });

          set({
            downloadedModelId: modelId,
            isDownloading: false,
            downloadProgress: 1,
          });

          // Auto-load after download
          await get().loadModel();
        } catch (error) {
          set({
            isDownloading: false,
            downloadProgress: 0,
            error: error instanceof Error ? error.message : 'Download failed',
          });
        }
      },

      downloadFromUrl: async (url: string, modelId: string) => {
        set({ isDownloading: true, downloadProgress: 0, error: null });
        try {
          await whisperService.downloadFromUrl(url, modelId, (progress) => {
            set({ downloadProgress: progress });
          });
          set({ downloadedModelId: modelId, isDownloading: false, downloadProgress: 1 });
          await get().loadModel();
        } catch (error) {
          set({
            isDownloading: false,
            downloadProgress: 0,
            error: error instanceof Error ? error.message : 'Download failed',
          });
        }
      },

      loadModel: async () => {
        const { downloadedModelId, isModelLoading } = get();
        if (!downloadedModelId) {
          set({ error: 'No model downloaded' });
          return;
        }

        // Prevent multiple simultaneous load attempts
        if (isModelLoading) {
          return;
        }

        set({ isModelLoading: true, error: null });

        try {
          const modelPath = whisperService.getModelPath(downloadedModelId);
          const sizeMB = WHISPER_MODELS.find(m => m.id === downloadedModelId)?.size ?? 200;
          // Load through the residency manager's global lock so STT never loads
          // alongside another model. Make room for it first (evict to budget),
          // then register so future loads can evict it.
          await modelResidencyManager.runExclusive('load:whisper', async () => {
            await modelResidencyManager.makeRoomFor({ key: 'whisper', type: 'whisper', sizeMB });
            await whisperService.loadModel(modelPath);
            modelResidencyManager.register(
              { key: 'whisper', type: 'whisper', sizeMB },
              () => get().unloadModel(),
            );
          });
          set({ isModelLoaded: true, isModelLoading: false, error: null });
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : 'Failed to load model';
          // If the model file is missing or corrupted, clear the downloaded state
          // so the user is prompted to re-download instead of repeatedly crashing
          const isFileError = errorMsg.includes('not found') || errorMsg.includes('corrupted') || errorMsg.includes('too small');
          set({
            isModelLoaded: false,
            isModelLoading: false,
            downloadedModelId: isFileError ? null : downloadedModelId,
            downloadProgress: isFileError ? 0 : get().downloadProgress,
            error: errorMsg,
          });
        }
      },

      unloadModel: async () => {
        try {
          await whisperService.unloadModel();
          set({ isModelLoaded: false });
        } catch (error) {
          set({
            error: error instanceof Error ? error.message : 'Failed to unload model',
          });
        }
      },

      deleteModel: async () => {
        const { downloadedModelId } = get();
        if (!downloadedModelId) return;

        try {
          // Unload first
          await whisperService.unloadModel();
          // Then delete
          await whisperService.deleteModel(downloadedModelId);
          set({
            downloadedModelId: null,
            isModelLoaded: false,
            downloadProgress: 0,
          });
        } catch (error) {
          set({
            error: error instanceof Error ? error.message : 'Failed to delete model',
          });
        }
      },

      clearError: () => {
        set({ error: null });
      },
    }),
    {
      name: 'local-llm-whisper-storage',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({
        downloadedModelId: state.downloadedModelId,
      }),
    }
  )
);
