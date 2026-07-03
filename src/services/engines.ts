import { useAppStore } from '../stores';
import { llmService } from './llm';
import { liteRTService } from './litert';

/**
 * The common contract every local text engine (llama.cpp / LiteRT) satisfies.
 * Callers depend on THIS, never on a concrete engine — that is what stops the
 * ChatScreen hooks from branching on `engine === 'litert'`. Each engine exposes
 * the same shared operations (load-state query + unload); engine-specific
 * capability dispatch (vision/tools/thinking) is folded into activeModelService,
 * which is the single owner of the state machine + residency bookkeeping.
 */
export interface TextEngineService {
  isModelLoaded(): boolean;
  unloadModel(): Promise<void>;
  stopGeneration(): Promise<void>;
}

// Both concrete engines already satisfy the contract structurally; assert it so a
// drift on either side (a removed/renamed method) becomes a compile error here.
export const llmEngine: TextEngineService = llmService;
export const liteRTEngine: TextEngineService = liteRTService;

/**
 * Returns the engine service for the currently active text model through the
 * common {@link TextEngineService} interface, or null if no model is selected.
 * Callers get the shared operations (isModelLoaded / unloadModel) without
 * knowing which concrete engine is active. The engine→service mapping lives
 * ONCE here — the single source of truth for "which engine backs this model".
 */
export function getActiveEngineService(): TextEngineService | null {
  const { downloadedModels, activeModelId } = useAppStore.getState();
  const model = downloadedModels.find(m => m.id === activeModelId);
  if (!model) return null;
  return model.engine === 'litert' ? liteRTEngine : llmEngine;
}

/**
 * The engine service for a specific text model id, via the common interface.
 * Used by activeModelService's engine-agnostic unload dispatch so the
 * engine→service decision is made in exactly one place.
 */
export function engineServiceForModelId(modelId: string | null): TextEngineService | null {
  if (!modelId) return null;
  const model = useAppStore.getState().downloadedModels.find(m => m.id === modelId);
  if (!model) return null;
  return model.engine === 'litert' ? liteRTEngine : llmEngine;
}
