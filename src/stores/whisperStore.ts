import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { whisperService, WHISPER_MODELS } from '../services/whisperService';
import { modelResidencyManager } from '../services/modelResidency';
import { logMemory } from '../utils/memorySnapshot';
import logger from '../utils/logger';

/**
 * Outcome of a whisper load, so callers can tell WHY it didn't load:
 *  - 'loaded'  — resident and ready.
 *  - 'blocked' — skipped by the single-model rule (a heavier generation model owns
 *                RAM; the sidecar can't co-reside). Retryable by freeing that model.
 *  - 'error'   — a real load failure (missing/corrupt file, native error), nothing
 *                downloaded, OR a concurrent load is already in flight (its outcome is
 *                unknown here). Freeing other models will NOT help — do not evict. The
 *                conservative choice: a caller treats 'error' as "don't touch other
 *                models", which is safe for the in-flight case too (the running load
 *                resolves on its own).
 */
export type WhisperLoadResult = 'loaded' | 'blocked' | 'error';

interface WhisperState {
  // Active (selected) model ID
  downloadedModelId: string | null;
  // All models present on disk (multiple can be downloaded; one is active).
  presentModelIds: string[];
  /**
   * Per-model download progress (0..1). A model id is a key here only while it is
   * downloading; the key is removed on completion or failure. Tracking progress
   * per id (instead of a single downloadingId + downloadProgress) lets several
   * models download at once, each driving its own bar. The single-slot version
   * shared one progress value, so concurrent downloads made the bar jump between
   * them. Read with downloadProgressById[id] and "downloading" = id in the map.
   */
  downloadProgressById: Record<string, number>;
  isModelLoading: boolean;
  isModelLoaded: boolean;
  error: string | null;

  // Actions
  downloadModel: (modelId: string) => Promise<void>;
  /** Activate an already-downloaded model without re-downloading. */
  selectModel: (modelId: string) => Promise<void>;
  loadModel: (options?: { useGpu?: boolean; useCoreML?: boolean }) => Promise<WhisperLoadResult>;
  unloadModel: () => Promise<void>;
  deleteModel: () => Promise<void>;
  /** Delete a specific on-disk model (active or not). */
  deleteModelById: (modelId: string) => Promise<void>;
  /** Re-probe which models are present on disk. */
  refreshPresentModels: () => Promise<void>;
  clearError: () => void;
}

type SetState = (partial: Partial<WhisperState> | ((s: WhisperState) => Partial<WhisperState>)) => void;

/** Set one model's in-flight progress without disturbing other concurrent downloads. */
function setProgress(set: SetState, modelId: string, progress: number): void {
  set((s) => ({ downloadProgressById: { ...s.downloadProgressById, [modelId]: progress } }));
}

/** Remove one model's progress entry (download finished or failed). */
function clearProgress(set: SetState, modelId: string): void {
  set((s) => {
    if (!(modelId in s.downloadProgressById)) return {};
    const next = { ...s.downloadProgressById };
    delete next[modelId];
    return { downloadProgressById: next };
  });
}

export const useWhisperStore = create<WhisperState>()(
  persist(
    (set, get) => ({
      downloadedModelId: null,
      presentModelIds: [],
      downloadProgressById: {},
      isModelLoading: false,
      isModelLoaded: false,
      error: null,

      downloadModel: async (modelId: string) => {
        setProgress(set, modelId, 0);
        set({ error: null });

        try {
          await whisperService.downloadModel(modelId, (progress) => {
            setProgress(set, modelId, progress);
          });

          set((s) => ({
            downloadedModelId: modelId,
            presentModelIds: s.presentModelIds.includes(modelId) ? s.presentModelIds : [...s.presentModelIds, modelId],
          }));

          // Do NOT load resident on download (DEV-B1 #1). A download only puts the file on
          // disk; loading is a separate concern owned by the transcribe path. Whisper is loaded
          // on demand by startRecording (ensureWhisperForTranscription) and warmed fits-gated at
          // launch by modelPreloader.preloadStt — matching the deferred-loading model every other
          // model follows. Auto-loading here left a phantom ~1.5GB STT resident the user never
          // used, which makeRoomFor then counted against a heavier text load → thrash/OOM.
        } catch (error) {
          // A user-initiated cancel rejects with a marked error — don't show it as
          // a failure on the model row, just let the finally clear its progress.
          if (!(error as { cancelled?: boolean })?.cancelled) {
            set({ error: error instanceof Error ? error.message : 'Download failed' });
          }
        } finally {
          // Clear this model's progress entry, even if auto-load hangs/fails —
          // the file is already on disk by this point. Other in-flight downloads
          // keep their own entries.
          clearProgress(set, modelId);
        }
      },

      downloadFromUrl: async (url: string, modelId: string) => {
        setProgress(set, modelId, 0);
        set({ error: null });
        try {
          await whisperService.downloadFromUrl(url, modelId, (progress) => {
            setProgress(set, modelId, progress);
          });
          set((s) => ({
            downloadedModelId: modelId,
            presentModelIds: s.presentModelIds.includes(modelId) ? s.presentModelIds : [...s.presentModelIds, modelId],
          }));
          await get().loadModel();
        } catch (error) {
          if (!(error as { cancelled?: boolean })?.cancelled) {
            set({ error: error instanceof Error ? error.message : 'Download failed' });
          }
        } finally {
          clearProgress(set, modelId);
        }
      },

      loadModel: async (options?: { useGpu?: boolean; useCoreML?: boolean }): Promise<WhisperLoadResult> => {
        const { downloadedModelId, isModelLoading } = get();
        if (!downloadedModelId) {
          set({ error: 'No model downloaded' });
          return 'error';
        }

        // Prevent multiple simultaneous load attempts
        if (isModelLoading) {
          return get().isModelLoaded ? 'loaded' : 'error';
        }

        set({ isModelLoading: true, error: null });

        try {
          const modelPath = whisperService.getModelPath(downloadedModelId);
          const sizeMB = WHISPER_MODELS.find(m => m.id === downloadedModelId)?.size ?? 200;
          // Load through the residency manager's global lock so STT never loads
          // alongside another model. Make room for it first (evict to budget),
          // then register so future loads can evict it.
          //
          // CRITICAL: honor the `fits` verdict. STT is a SIDECAR — if a heavier
          // generation model owns memory, makeRoomFor returns fits=false WITHOUT
          // evicting it (the sidecar rule won't kick out an 8.5GB model for a 142MB
          // sidecar). We MUST NOT load anyway: doing so put whisper + the text model
          // co-resident and OOM'd the app. STT stays out. When a voice turn needs to
          // transcribe RIGHT NOW, the caller frees the generation model first (see
          // ensureWhisperForTranscription in ChatInput/Voice) — we do not override
          // the sidecar rule here.
          const loaded = await modelResidencyManager.runExclusive('load:whisper', async () => {
            const { fits } = await modelResidencyManager.makeRoomFor({ key: 'whisper', type: 'whisper', sizeMB });
            if (!fits) {
              logger.log('[Whisper] Skipping load — no room alongside the active model (single-model rule)');
              return false;
            }
            // Footprint before/after load. On a 4 GB iOS device a large model
            // (medium/large ~1.5 GB) can push the app past the jetsam limit and the OS
            // kills it mid-load. The before/after pair localizes a kill to model load
            // vs transcription. Fire-and-forget: no await points on the load path.
            logMemory(`whisper:beforeLoad model=${downloadedModelId} ~${sizeMB}MB`).catch(() => {});
            await whisperService.loadModel(modelPath, options);
            logMemory('whisper:afterLoad').catch(() => {});
            modelResidencyManager.register(
              { key: 'whisper', type: 'whisper', sizeMB },
              () => get().unloadModel(),
            );
            return true;
          });
          set({ isModelLoaded: loaded, isModelLoading: false, error: null });
          // loaded=false means the single-model rule blocked it (not a failure) —
          // report 'blocked' so a caller can free the resident model and retry.
          return loaded ? 'loaded' : 'blocked';
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : 'Failed to load model';
          // If the model file is missing or corrupted, clear the downloaded state
          // so the user is prompted to re-download instead of repeatedly crashing
          const isFileError = errorMsg.includes('not found') || errorMsg.includes('corrupted') || errorMsg.includes('too small');
          set({
            isModelLoaded: false,
            isModelLoading: false,
            downloadedModelId: isFileError ? null : downloadedModelId,
            error: errorMsg,
          });
          return 'error';
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
          // Fall back to another downloaded model on disk if there is one, and
          // drop the just-deleted model from presentModelIds (recompute from disk
          // so the models list doesn't keep showing a model whose file is gone).
          const onDisk = await whisperService.listDownloadedModels();
          const remaining = onDisk.map((m) => m.modelId).filter((id) => id !== downloadedModelId);
          const fallback = remaining[0] ?? null;
          logger.log(`[WhisperStore] deleted active ${downloadedModelId}; present [${remaining.join(', ') || 'none'}]; active -> ${fallback ?? 'none'}`);
          set({
            presentModelIds: remaining,
            downloadedModelId: fallback,
            isModelLoaded: false,
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
          const wasActive = get().downloadedModelId === modelId;
          if (wasActive) await whisperService.unloadModel();
          await whisperService.deleteModel(modelId);
          // Fall back to another model still on disk (e.g. delete small -> use
          // base) instead of leaving no active model. Scans the real dir so it
          // catches any downloaded model, not just the catalogue.
          const onDisk = await whisperService.listDownloadedModels();
          const remaining = onDisk.map((m) => m.modelId).filter((id) => id !== modelId);
          const fallback = wasActive ? (remaining[0] ?? null) : get().downloadedModelId;
          logger.log(`[WhisperStore] deleted ${modelId} (wasActive=${wasActive}); on-disk now [${remaining.join(', ') || 'none'}]; active -> ${fallback ?? 'none'}`);
          set({
            presentModelIds: remaining,
            ...(wasActive ? { downloadedModelId: fallback, isModelLoaded: false } : {}),
          });
        } catch (error) {
          logger.warn(`[WhisperStore] deleteModelById(${modelId}) failed: ${String(error)}`);
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
        // No active model was ever selected: just refresh the present list. Do NOT
        // auto-adopt one — selection/loading is an explicit action, and pre-setting
        // the pointer here would make an explicit select a no-op so the sidecar
        // never loads/registers (co-residence).
        if (!activeId) {
          set({ presentModelIds: present });
          return;
        }
        // Active model is set and on disk: only refresh the present list.
        const activeOnDisk = await whisperService.isModelDownloaded(activeId);
        if (activeOnDisk) {
          set({ presentModelIds: present });
          return;
        }
        // The active model's file is gone (e.g. deleted from the Download Manager,
        // which bypasses this store). Adopt another model that IS on disk so
        // transcription keeps working instead of pointing at a deleted file.
        const fallback = present[0] ?? null;
        logger.log(`[WhisperStore] active whisper model ${activeId} file gone; present [${present.join(', ') || 'none'}]; active -> ${fallback ?? 'none'}`);
        set({ presentModelIds: present, downloadedModelId: fallback, isModelLoaded: false });
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
