/**
 * Whisper Store Unit Tests
 *
 * Tests for speech-to-text model download, load, unload, and delete workflows.
 * Priority: P1 - Core functionality for voice features.
 */

// Mock the services barrel export used by the whisper store.
// The mock object is created inside the factory to avoid jest.mock hoisting issues.
jest.mock('../../../src/services', () => ({
  whisperService: {
    downloadModel: jest.fn(),
    getModelPath: jest.fn((id: string) => `/models/ggml-${id}.bin`),
    loadModel: jest.fn(),
    unloadModel: jest.fn(),
    deleteModel: jest.fn(),
    isModelDownloaded: jest.fn(),
  },
  WHISPER_MODELS: [{ id: 'tiny', size: 75 }, { id: 'base', size: 142 }],
}));

jest.mock('../../../src/services/modelResidency', () => ({
  modelResidencyManager: {
    register: jest.fn(),
    release: jest.fn(),
    makeRoomFor: jest.fn(() => Promise.resolve({ evicted: [], fits: true })),
    runExclusive: jest.fn((_label: string, fn: () => Promise<unknown>) => fn()),
  },
}));

import { useWhisperStore } from '../../../src/stores/whisperStore';
import { whisperService } from '../../../src/services';
import { modelResidencyManager } from '../../../src/services/modelResidency';
import { resetWhisperStore } from '../../utils/testHelpers';

// Cast to jest mocks for type-safe access
const mockWhisperService = whisperService as jest.Mocked<typeof whisperService>;
const mockResidency = modelResidencyManager as jest.Mocked<typeof modelResidencyManager>;

const getState = () => useWhisperStore.getState();

describe('whisperStore', () => {
  beforeEach(() => {
    resetWhisperStore();
    jest.clearAllMocks();
  });

  // ============================================================================
  // Initial State
  // ============================================================================
  describe('initial state', () => {
    it('has no downloaded model', () => {
      expect(getState().downloadedModelId).toBeNull();
    });

    it('is not downloading', () => {
      expect(getState().downloadProgressById).toEqual({});
    });

    it('has no per-model download progress', () => {
      expect(getState().downloadProgressById['ggml-tiny']).toBeUndefined();
    });

    it('is not loading a model', () => {
      expect(getState().isModelLoading).toBe(false);
    });

    it('has no model loaded', () => {
      expect(getState().isModelLoaded).toBe(false);
    });

    it('has no error', () => {
      expect(getState().error).toBeNull();
    });
  });

  // ============================================================================
  // downloadModel
  // ============================================================================
  describe('downloadModel', () => {
    it('records the model in downloadProgressById and clears error at start', async () => {
      // Set a pre-existing error
      useWhisperStore.setState({ error: 'old error' });

      let resolveDownload!: () => void;
      mockWhisperService.downloadModel.mockImplementation(
        () =>
          new Promise<string>((resolve) => {
            resolveDownload = () => resolve('/path/to/model');
          }),
      );
      mockWhisperService.getModelPath.mockReturnValue('/path/to/model');
      mockWhisperService.loadModel.mockResolvedValue(undefined);

      const downloadPromise = getState().downloadModel('ggml-tiny');

      // Allow microtask for the set() inside downloadModel to run
      await Promise.resolve();

      // While downloading, this model has a progress entry (starting at 0)
      expect(getState().downloadProgressById['ggml-tiny']).toBe(0);
      expect(getState().error).toBeNull();

      resolveDownload();
      await downloadPromise;
    });

    it('calls whisperService.downloadModel with modelId and progress callback', async () => {
      mockWhisperService.downloadModel.mockImplementation(
        async (_id: string, onProgress?: (p: number) => void) => {
          onProgress?.(0.5);
          onProgress?.(1.0);
          return '/path/to/model';
        },
      );
      mockWhisperService.getModelPath.mockReturnValue('/path/to/model');
      mockWhisperService.loadModel.mockResolvedValue(undefined);

      await getState().downloadModel('ggml-tiny');

      expect(mockWhisperService.downloadModel).toHaveBeenCalledWith(
        'ggml-tiny',
        expect.any(Function),
      );
    });

    it('updates downloadProgress via the progress callback', async () => {
      const progressValues: number[] = [];

      mockWhisperService.downloadModel.mockImplementation(
        async (_id: string, onProgress?: (p: number) => void) => {
          onProgress?.(0.25);
          progressValues.push(getState().downloadProgressById['ggml-tiny']);
          onProgress?.(0.75);
          progressValues.push(getState().downloadProgressById['ggml-tiny']);
          return '/path/to/model';
        },
      );
      mockWhisperService.getModelPath.mockReturnValue('/path/to/model');
      mockWhisperService.loadModel.mockResolvedValue(undefined);

      await getState().downloadModel('ggml-tiny');

      expect(progressValues).toEqual([0.25, 0.75]);
    });

    it('sets downloadedModelId and clears the progress entry on success', async () => {
      mockWhisperService.downloadModel.mockResolvedValue('/path/to/model');
      mockWhisperService.getModelPath.mockReturnValue('/path/to/model');
      mockWhisperService.loadModel.mockResolvedValue(undefined);

      await getState().downloadModel('ggml-base');

      expect(getState().downloadedModelId).toBe('ggml-base');
      // Entry removed once the download settles — the model now shows as present.
      expect(getState().downloadProgressById['ggml-base']).toBeUndefined();
    });

    it('auto-loads the model after successful download', async () => {
      mockWhisperService.downloadModel.mockResolvedValue('/path/to/model');
      mockWhisperService.getModelPath.mockReturnValue('/models/ggml-tiny');
      mockWhisperService.loadModel.mockResolvedValue(undefined);

      await getState().downloadModel('ggml-tiny');

      expect(mockWhisperService.getModelPath).toHaveBeenCalledWith('ggml-tiny');
      expect(mockWhisperService.loadModel).toHaveBeenCalledWith(
        '/models/ggml-tiny',
      );
      expect(getState().isModelLoaded).toBe(true);
    });

    it('sets error and clears the progress entry on download failure', async () => {
      mockWhisperService.downloadModel.mockRejectedValue(
        new Error('Network error'),
      );

      await getState().downloadModel('ggml-tiny');

      expect(getState().downloadProgressById['ggml-tiny']).toBeUndefined();
      expect(getState().error).toBe('Network error');
      expect(getState().downloadedModelId).toBeNull();
    });

    it('sets generic error message for non-Error throws', async () => {
      mockWhisperService.downloadModel.mockRejectedValue('something broke');

      await getState().downloadModel('ggml-tiny');

      expect(getState().error).toBe('Download failed');
    });

    it('clears progress without surfacing an error when the download is cancelled', async () => {
      // A user cancel (from the Download Manager) rejects with a marked error.
      // It must clear the in-flight entry but not show a failure on the model row.
      const cancelled = Object.assign(new Error('Download cancelled'), { cancelled: true });
      mockWhisperService.downloadModel.mockRejectedValue(cancelled);

      await getState().downloadModel('ggml-tiny');

      expect(getState().error).toBeNull();
      expect(getState().downloadProgressById['ggml-tiny']).toBeUndefined();
    });

    it('tracks concurrent downloads independently with no cross-talk', async () => {
      // Reproduces issue #3: two models downloading at once. The old single
      // downloadingId/downloadProgress made one bar jump between them; per-model
      // progress keeps each model's value separate.
      const resolvers: Record<string, () => void> = {};
      const progressCbs: Record<string, (p: number) => void> = {};
      mockWhisperService.downloadModel.mockImplementation(
        (id: string, onProgress?: (p: number) => void) =>
          new Promise<string>((resolve) => {
            if (onProgress) progressCbs[id] = onProgress;
            resolvers[id] = () => resolve(`/models/${id}`);
          }),
      );
      mockWhisperService.getModelPath.mockImplementation((id: string) => `/models/${id}`);
      mockWhisperService.loadModel.mockResolvedValue(undefined);

      const p1 = getState().downloadModel('ggml-tiny');
      const p2 = getState().downloadModel('ggml-base');
      await Promise.resolve();

      // Each download drives only its own entry.
      progressCbs['ggml-tiny'](0.3);
      progressCbs['ggml-base'](0.7);
      expect(getState().downloadProgressById['ggml-tiny']).toBe(0.3);
      expect(getState().downloadProgressById['ggml-base']).toBe(0.7);

      // Finishing one leaves the other's progress intact.
      resolvers['ggml-tiny']();
      await p1;
      expect(getState().downloadProgressById['ggml-tiny']).toBeUndefined();
      expect(getState().downloadProgressById['ggml-base']).toBe(0.7);

      resolvers['ggml-base']();
      await p2;
      expect(getState().downloadProgressById).toEqual({});
    });
  });

  // ============================================================================
  // loadModel
  // ============================================================================
  describe('loadModel', () => {
    it('loads model successfully when a model is downloaded', async () => {
      useWhisperStore.setState({ downloadedModelId: 'ggml-tiny' });
      mockWhisperService.getModelPath.mockReturnValue('/models/ggml-tiny');
      mockWhisperService.loadModel.mockResolvedValue(undefined);

      await getState().loadModel();

      expect(mockWhisperService.getModelPath).toHaveBeenCalledWith('ggml-tiny');
      expect(mockWhisperService.loadModel).toHaveBeenCalledWith(
        '/models/ggml-tiny',
      );
      expect(getState().isModelLoaded).toBe(true);
      expect(getState().isModelLoading).toBe(false);
      expect(getState().error).toBeNull();
    });

    it('sets isModelLoading to true while loading', async () => {
      useWhisperStore.setState({ downloadedModelId: 'ggml-tiny' });

      let resolveLoad!: () => void;
      mockWhisperService.getModelPath.mockReturnValue('/models/ggml-tiny');
      mockWhisperService.loadModel.mockImplementation(
        () =>
          new Promise<void>((resolve) => {
            resolveLoad = resolve;
          }),
      );

      const loadPromise = getState().loadModel();

      // Allow microtask for the set() to run
      await Promise.resolve();

      expect(getState().isModelLoading).toBe(true);
      expect(getState().error).toBeNull();

      resolveLoad();
      await loadPromise;

      expect(getState().isModelLoading).toBe(false);
    });

    it('sets error when no model is downloaded', async () => {
      await getState().loadModel();

      expect(getState().error).toBe('No model downloaded');
      expect(mockWhisperService.loadModel).not.toHaveBeenCalled();
    });

    it('returns early if already loading', async () => {
      useWhisperStore.setState({
        downloadedModelId: 'ggml-tiny',
        isModelLoading: true,
      });

      await getState().loadModel();

      expect(mockWhisperService.getModelPath).not.toHaveBeenCalled();
      expect(mockWhisperService.loadModel).not.toHaveBeenCalled();
    });

    it('sets error on load failure', async () => {
      useWhisperStore.setState({ downloadedModelId: 'ggml-tiny' });
      mockWhisperService.getModelPath.mockReturnValue('/models/ggml-tiny');
      mockWhisperService.loadModel.mockRejectedValue(
        new Error('Model corrupted'),
      );

      await getState().loadModel();

      expect(getState().isModelLoaded).toBe(false);
      expect(getState().isModelLoading).toBe(false);
      expect(getState().error).toBe('Model corrupted');
    });

    it('sets generic error message for non-Error throws', async () => {
      useWhisperStore.setState({ downloadedModelId: 'ggml-tiny' });
      mockWhisperService.getModelPath.mockReturnValue('/models/ggml-tiny');
      mockWhisperService.loadModel.mockRejectedValue('unknown issue');

      await getState().loadModel();

      expect(getState().error).toBe('Failed to load model');
    });

    it('clears previous error when loading starts', async () => {
      useWhisperStore.setState({
        downloadedModelId: 'ggml-tiny',
        error: 'previous error',
      });
      mockWhisperService.getModelPath.mockReturnValue('/models/ggml-tiny');
      mockWhisperService.loadModel.mockResolvedValue(undefined);

      await getState().loadModel();

      expect(getState().error).toBeNull();
    });

    // ------------------------------------------------------------------
    // Single-model rule (regression: STT co-resident with the text model)
    // ------------------------------------------------------------------
    // These assert the OUTCOME the residency verdict dictates, not merely that
    // makeRoomFor was called. The shipped bug: loadModel called makeRoomFor but
    // ignored `fits`, so when a heavier generation model owned memory (fits=false,
    // evict=[] because residency won't kick out a big model for a 142MB sidecar),
    // whisper loaded ANYWAY → whisper + text co-resident → OOM / forced resend.
    // The old suite hid this because its makeRoomFor mock always returned fits:true.
    describe('respects the residency fit verdict (single-model rule)', () => {
      it('does NOT load whisper when makeRoomFor reports it does not fit', async () => {
        useWhisperStore.setState({ downloadedModelId: 'ggml-tiny' });
        mockWhisperService.getModelPath.mockReturnValue('/models/ggml-tiny');
        mockWhisperService.loadModel.mockResolvedValue(undefined);
        // A heavier model is resident: residency refuses without evicting it.
        mockResidency.makeRoomFor.mockResolvedValueOnce({ evicted: [], fits: false });

        const result = await getState().loadModel();

        // The seam under test: the native load must be skipped when it won't fit.
        // Deleting the `if (!fits) return` guard in the store fails THIS line.
        expect(mockWhisperService.loadModel).not.toHaveBeenCalled();
        expect(mockResidency.register).not.toHaveBeenCalled();
        expect(getState().isModelLoaded).toBe(false);
        // Not an error state — STT just stays out and loads on the next record.
        expect(getState().error).toBeNull();
        expect(getState().isModelLoading).toBe(false);
        // Reports 'blocked' (not 'error') so a caller can free the resident model and
        // retry — vs 'error', where freeing wouldn't help.
        expect(result).toBe('blocked');
      });

      it('loads and registers whisper when makeRoomFor reports it fits', async () => {
        useWhisperStore.setState({ downloadedModelId: 'ggml-tiny' });
        mockWhisperService.getModelPath.mockReturnValue('/models/ggml-tiny');
        mockWhisperService.loadModel.mockResolvedValue(undefined);
        mockResidency.makeRoomFor.mockResolvedValueOnce({ evicted: [], fits: true });

        const result = await getState().loadModel();

        expect(mockWhisperService.loadModel).toHaveBeenCalledWith('/models/ggml-tiny');
        expect(mockResidency.register).toHaveBeenCalled();
        expect(getState().isModelLoaded).toBe(true);
        expect(result).toBe('loaded');
      });

      it("reports 'error' (not 'blocked') on a hard load failure — freeing models won't help", async () => {
        useWhisperStore.setState({ downloadedModelId: 'ggml-tiny' });
        mockWhisperService.getModelPath.mockReturnValue('/models/ggml-tiny');
        mockResidency.makeRoomFor.mockResolvedValueOnce({ evicted: [], fits: true });
        mockWhisperService.loadModel.mockRejectedValueOnce(new Error('model file corrupted'));

        const result = await getState().loadModel();

        // Distinguishing error from blocked is what stops the caller evicting the
        // user's generation model for a whisper that can't load anyway.
        expect(result).toBe('error');
        expect(getState().isModelLoaded).toBe(false);
      });
    });
  });

  // ============================================================================
  // unloadModel
  // ============================================================================
  describe('unloadModel', () => {
    it('unloads the model and sets isModelLoaded to false', async () => {
      useWhisperStore.setState({ isModelLoaded: true });
      mockWhisperService.unloadModel.mockResolvedValue(undefined);

      await getState().unloadModel();

      expect(mockWhisperService.unloadModel).toHaveBeenCalled();
      expect(getState().isModelLoaded).toBe(false);
    });

    it('sets error on unload failure', async () => {
      useWhisperStore.setState({ isModelLoaded: true });
      mockWhisperService.unloadModel.mockRejectedValue(
        new Error('Unload failed'),
      );

      await getState().unloadModel();

      expect(getState().error).toBe('Unload failed');
    });

    it('sets generic error message for non-Error throws', async () => {
      mockWhisperService.unloadModel.mockRejectedValue(42);

      await getState().unloadModel();

      expect(getState().error).toBe('Failed to unload model');
    });
  });

  // ============================================================================
  // deleteModel
  // ============================================================================
  describe('deleteModel', () => {
    it('unloads and deletes the model, then resets state', async () => {
      useWhisperStore.setState({
        downloadedModelId: 'ggml-tiny',
        isModelLoaded: true,
      });
      mockWhisperService.unloadModel.mockResolvedValue(undefined);
      mockWhisperService.deleteModel.mockResolvedValue(undefined);

      await getState().deleteModel();

      expect(mockWhisperService.unloadModel).toHaveBeenCalled();
      expect(mockWhisperService.deleteModel).toHaveBeenCalledWith('ggml-tiny');
      expect(getState().downloadedModelId).toBeNull();
      expect(getState().isModelLoaded).toBe(false);
    });

    it('calls unloadModel before deleteModel', async () => {
      useWhisperStore.setState({ downloadedModelId: 'ggml-tiny' });

      const callOrder: string[] = [];
      mockWhisperService.unloadModel.mockImplementation(async () => {
        callOrder.push('unload');
      });
      mockWhisperService.deleteModel.mockImplementation(async () => {
        callOrder.push('delete');
      });

      await getState().deleteModel();

      expect(callOrder).toEqual(['unload', 'delete']);
    });

    it('returns early when no model is downloaded', async () => {
      await getState().deleteModel();

      expect(mockWhisperService.unloadModel).not.toHaveBeenCalled();
      expect(mockWhisperService.deleteModel).not.toHaveBeenCalled();
    });

    it('sets error on delete failure', async () => {
      useWhisperStore.setState({ downloadedModelId: 'ggml-tiny' });
      mockWhisperService.unloadModel.mockResolvedValue(undefined);
      mockWhisperService.deleteModel.mockRejectedValue(
        new Error('Permission denied'),
      );

      await getState().deleteModel();

      expect(getState().error).toBe('Permission denied');
    });

    it('sets generic error message for non-Error throws', async () => {
      useWhisperStore.setState({ downloadedModelId: 'ggml-tiny' });
      mockWhisperService.unloadModel.mockRejectedValue('disk error');

      await getState().deleteModel();

      expect(getState().error).toBe('Failed to delete model');
    });
  });

  // ============================================================================
  // clearError
  // ============================================================================
  describe('clearError', () => {
    it('clears the error', () => {
      useWhisperStore.setState({ error: 'some error' });

      getState().clearError();

      expect(getState().error).toBeNull();
    });

    it('is a no-op when error is already null', () => {
      getState().clearError();

      expect(getState().error).toBeNull();
    });
  });

  // ============================================================================
  // Multi-model (select / per-model delete / disk probe)
  // ============================================================================
  describe('multi-model', () => {
    beforeEach(() => {
      mockWhisperService.unloadModel.mockResolvedValue(undefined);
      mockWhisperService.deleteModel.mockResolvedValue(undefined);
      mockWhisperService.loadModel.mockResolvedValue(undefined);
    });

    it('refreshPresentModels populates presentModelIds from disk', async () => {
      mockWhisperService.isModelDownloaded.mockImplementation(async (id: string) => id === 'tiny');
      await getState().refreshPresentModels();
      expect(getState().presentModelIds).toEqual(['tiny']);
    });

    it('refreshPresentModels clears the active model when its file is gone (e.g. deleted via Download Manager)', async () => {
      useWhisperStore.setState({ downloadedModelId: 'base', isModelLoaded: true });
      mockWhisperService.isModelDownloaded.mockResolvedValue(false); // nothing on disk anymore
      await getState().refreshPresentModels();
      expect(getState().downloadedModelId).toBeNull();
      expect(getState().isModelLoaded).toBe(false);
    });

    it('refreshPresentModels keeps the active model when its file is still present', async () => {
      useWhisperStore.setState({ downloadedModelId: 'base', isModelLoaded: true });
      mockWhisperService.isModelDownloaded.mockImplementation(async (id: string) => id === 'base');
      await getState().refreshPresentModels();
      expect(getState().downloadedModelId).toBe('base');
      expect(getState().isModelLoaded).toBe(true);
    });

    it('selectModel activates an on-disk model without downloading', async () => {
      mockWhisperService.loadModel.mockResolvedValue(undefined);
      await getState().selectModel('base');
      expect(getState().downloadedModelId).toBe('base');
      expect(mockWhisperService.loadModel).toHaveBeenCalled();
      expect(mockWhisperService.downloadModel).not.toHaveBeenCalled();
    });

    it('deleteModelById removes the file and clears active when it was active', async () => {
      useWhisperStore.setState({ presentModelIds: ['tiny', 'base'], downloadedModelId: 'base', isModelLoaded: true });
      await getState().deleteModelById('base');
      expect(mockWhisperService.deleteModel).toHaveBeenCalledWith('base');
      expect(getState().presentModelIds).toEqual(['tiny']);
      expect(getState().downloadedModelId).toBeNull();
      expect(getState().isModelLoaded).toBe(false);
    });

    it('deleteModelById keeps the active model when deleting a different one', async () => {
      useWhisperStore.setState({ presentModelIds: ['tiny', 'base'], downloadedModelId: 'base' });
      await getState().deleteModelById('tiny');
      expect(getState().presentModelIds).toEqual(['base']);
      expect(getState().downloadedModelId).toBe('base');
    });
  });
});
