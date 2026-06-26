import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { whisperService, WHISPER_MODELS } from '../services';
import { modelResidencyManager } from '../services/modelResidency';

interface WhisperState {
  // Active (selected) model ID
  downloadedModelId: string | null;
  // All models present on disk (multiple can be downloaded; one is active).
  presentModelIds: string[];
  isDownloading: boolean;
  /** Which model id is currently downloading (null when idle). Per-model so the
   *  UI spins only that row, not every not-yet-downloaded model. */
  downloadingId: string | null;
  downloadProgress: number;
  isModelLoading: boolean;
  isModelLoaded: boolean;
  error: string | null;

  // Actions
  downloadModel: (modelId: string) => Promise<void>;
  downloadFromUrl: (url: string, modelId: string) => Promise<void>;
  /** Activate an already-downloaded model without re-downloading. */
  selectModel: (modelId: string) => Promise<void>;
  loadModel: () => Promise<void>;
  unloadModel: () => Promise<void>;
  deleteModel: () => Promise<void>;
  /** Delete a specific on-disk model (active or not). */
  deleteModelById: (modelId: string) => Promise<void>;
  /** Re-probe which models are present on disk. */
  refreshPresentModels: () => Promise<void>;
  clearError: () => void;
}

export const useWhisperStore = create<WhisperState>()(
  persist(
    (set, get) => ({
      downloadedModelId: null,
      presentModelIds: [],
      isDownloading: false,
      downloadingId: null,
      downloadProgress: 0,
      isModelLoading: false,
      isModelLoaded: false,
      error: null,

      downloadModel: async (modelId: string) => {
        set({ isDownloading: true, downloadingId: modelId, downloadProgress: 0, error: null });

        try {
          await whisperService.downloadModel(modelId, (progress) => {
            set({ downloadProgress: progress });
          });

          set((s) => ({
            downloadedModelId: modelId,
            presentModelIds: s.presentModelIds.includes(modelId) ? s.presentModelIds : [...s.presentModelIds, modelId],
            isDownloading: false,
            downloadProgress: 1,
          }));

          // Auto-load after download
          await get().loadModel();
        } catch (error) {
          set({
            isDownloading: false,
            downloadProgress: 0,
            error: error instanceof Error ? error.message : 'Download failed',
          });
        } finally {
          // Always clear the per-model spinner, even if auto-load hangs/fails —
          // the file is already on disk by this point.
          set({ downloadingId: null });
        }
      },

      downloadFromUrl: async (url: string, modelId: string) => {
        set({ isDownloading: true, downloadingId: modelId, downloadProgress: 0, error: null });
        try {
          await whisperService.downloadFromUrl(url, modelId, (progress) => {
            set({ downloadProgress: progress });
          });
          set((s) => ({
            downloadedModelId: modelId,
            presentModelIds: s.presentModelIds.includes(modelId) ? s.presentModelIds : [...s.presentModelIds, modelId],
            isDownloading: false,
            downloadProgress: 1,
          }));
          await get().loadModel();
        } catch (error) {
          set({
            isDownloading: false,
            downloadProgress: 0,
            error: error instanceof Error ? error.message : 'Download failed',
          });
        } finally {
          set({ downloadingId: null });
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

      selectModel: async (modelId: string) => {
        if (get().downloadedModelId === modelId && get().isModelLoaded) return;
        set({ downloadedModelId: modelId, error: null });
        await get().loadModel();
      },

      deleteModelById: async (modelId: string) => {
        try {
          if (get().downloadedModelId === modelId) await whisperService.unloadModel();
          await whisperService.deleteModel(modelId);
          set((s) => ({
            presentModelIds: s.presentModelIds.filter((id) => id !== modelId),
            ...(s.downloadedModelId === modelId ? { downloadedModelId: null, isModelLoaded: false } : {}),
          }));
        } catch (error) {
          set({ error: error instanceof Error ? error.message : 'Failed to delete model' });
        }
      },

      refreshPresentModels: async () => {
        const present: string[] = [];
        for (const m of WHISPER_MODELS) {
          if (await whisperService.isModelDownloaded(m.id)) present.push(m.id);
        }
        // Reconcile the active pointer against disk too. Deleting from the
        // Download Manager goes through whisperService directly (bypassing this
        // store), so downloadedModelId can point at a model whose file is gone —
        // which left the Home banner showing a deleted model. Check the active
        // model's own file (works for custom HF ids, not just the catalogue).
        const activeId = get().downloadedModelId;
        const activeOnDisk = activeId ? await whisperService.isModelDownloaded(activeId) : true;
        set({
          presentModelIds: present,
          ...(activeId && !activeOnDisk ? { downloadedModelId: null, isModelLoaded: false } : {}),
        });
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
