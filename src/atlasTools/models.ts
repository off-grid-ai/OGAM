import { useAppStore } from '../stores/appStore';
import logger from '../utils/logger';

/**
 * Make sure a specific downloaded text model is the loaded one.
 * modelId empty/undefined = keep whatever is selected now.
 * Lazy requires keep the agent store free of heavy imports.
 */
export async function ensureTextModel(modelId?: string | null, onStatus?: (s: string) => void): Promise<void> {
  const st = useAppStore.getState();
  // The chosen model, else the one used last, else the first downloaded: a course or study screen should not
  // fail just because no model is selected right now.
  const lastUsed = st.downloadedModels.some((m) => m.id === st.lastTextModelId) ? st.lastTextModelId : null;
  const target = modelId || st.activeModelId || lastUsed || st.downloadedModels[0]?.id;
  if (!target) throw new Error('No model downloaded. Download a text model first (Models tab).');
  const { llmService } = require('../services/llm');
  if (st.loadedTextModelId === target && llmService.isModelLoaded()) return;
  const exists = st.downloadedModels.some((m) => m.id === target);
  if (!exists) throw new Error('That model is no longer downloaded.');
  const name = st.downloadedModels.find((m) => m.id === target)?.name || target;
  onStatus?.(`Loading ${name}...`);
  const { activeModelService } = require('../services/activeModelService');
  await activeModelService.loadTextModel(target);
}

/**
 * Load a text model now, whatever else is in memory: frees every loaded model (image, speech,
 * another text model) first, then loads the selected text model, or the first downloaded one
 * when none is selected. For screens that need the model and could not get it the normal way.
 */
export async function forceLoadTextModel(onStatus?: (s: string) => void): Promise<void> {
  const st = useAppStore.getState();
  const target = st.activeModelId && st.downloadedModels.some((m) => m.id === st.activeModelId)
    ? st.activeModelId : st.downloadedModels[0]?.id;
  if (!target) throw new Error('No text model is downloaded. Download one in the Models tab first.');
  const { activeModelService } = require('../services/activeModelService');
  onStatus?.('Freeing memory...');
  await activeModelService.unloadAllModels(true).catch((e: unknown) => logger.warn(`[Atlas] unload before force load: ${String(e)}`));
  const name = st.downloadedModels.find((m) => m.id === target)?.name || target;
  onStatus?.(`Loading ${name}...`);
  await activeModelService.loadTextModel(target);
}

/** Fire-and-forget switch used when an agent with a preferred model is chosen. */
export function switchToModelInBackground(modelId: string): void {
  const st = useAppStore.getState();
  if (!st.downloadedModels.some((m) => m.id === modelId)) return;
  if (st.loadedTextModelId === modelId || st.activeModelId === modelId) {
    if (st.loadedTextModelId === modelId) return;
  }
  ensureTextModel(modelId).catch((e) => logger.warn(`[Atlas] could not switch model: ${String(e?.message || e)}`));
}
