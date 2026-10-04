import type { DownloadedModel, ONNXImageModel } from '../../types';
import type { ActiveModelInfo } from './modelStateTypes';

interface SnapshotInput {
  textModel: DownloadedModel | null;
  imageModel: ONNXImageModel | null;
  /**
   * Engine-aware: a text model lives in llmService (GGUF) or liteRTService (LiteRT). Checking only
   * llmService reported a loaded LiteRT model as not-loaded, which made the preloader and the UI
   * treat it as absent, so the caller resolves this across both engines.
   */
  textIsLoaded: boolean;
  imageIsLoaded: boolean;
  loading: { text: boolean; image: boolean };
}

/**
 * Shape the active-model snapshot every surface renders from. PURE.
 *
 * Separate from the service so the shape is one thing, testable on its own, and so the service keeps
 * the IO (engines, store, residency) and this keeps the projection.
 */
export function activeModelSnapshot(input: SnapshotInput): ActiveModelInfo {
  return {
    text: {
      model: input.textModel,
      isLoaded: input.textIsLoaded,
      isLoading: input.loading.text,
    },
    image: {
      model: input.imageModel,
      isLoaded: input.imageIsLoaded,
      isLoading: input.loading.image,
    },
  };
}
