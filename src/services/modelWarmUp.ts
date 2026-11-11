import { useAppStore } from '../stores/appStore';
import { llmService } from './llm';
import { useSpeedStats } from '../atlasTools/speed';
import logger from '../utils/logger';

/**
 * Optional warm-up after a model loads: one tiny silent reply, so a GPU backend does its one-time
 * setup (shader compilation) now rather than during the first question. Does nothing on the CPU
 * and never runs while a chat reply is being written. Off by default (Settings > Text generation).
 */
export async function warmUpTextModel(): Promise<boolean> {
  try {
    if (!useAppStore.getState().settings.warmUpAfterLoad) return false;
    if (!llmService.isModelLoaded() || llmService.isCurrentlyGenerating()) return false;
    if (!llmService.getGpuInfo().gpu) return false;
    const started = Date.now();
    // A one-token run says nothing about the model's speed: keep the stored speed as it was.
    const id = useAppStore.getState().activeModelId;
    const kept = id ? useSpeedStats.getState().byModel[id] : undefined;
    try {
      await llmService.generateWithMaxTokens([{ id: 'warm', role: 'user', content: 'Hi', timestamp: 0 }], 1);
    } finally {
      if (id) useSpeedStats.setState((st) => { const { [id]: _drop, ...rest } = st.byModel; return { byModel: kept ? { ...rest, [id]: kept } : rest }; });
    }
    logger.log(`[WARMUP] done in ${Date.now() - started} ms`);
    return true;
  } catch (e) {
    logger.warn('[WARMUP] skipped:', e);
    return false;
  }
}
