/**
 * Asking the loaded model a question for knowledge work. Same conventions as the existing learning engine: it waits behind a chat
 * reply (runBackgroundJob), loads the selected text model if none is loaded, and fits the prompt to the model's memory.
 */
import { llmService } from '../services/llm';
import { activeModelService } from '../services/activeModelService';
import { runBackgroundJob, fitPrompt } from '../services/llmJobQueue';
import { useAppStore } from '../stores/appStore';
import { localUniqueId } from '../utils/uniqueId';

export type Ask = (system: string, user: string) => Promise<string>;

export const currentModelName = (): string => {
  const s = useAppStore.getState();
  return s.downloadedModels.find((m) => m.id === s.activeModelId)?.name ?? 'unknown';
};

export function modelAsker(shouldStop?: () => boolean): Ask {
  return (system, user) => runBackgroundJob(async () => {
    if (shouldStop?.()) throw new Error('stopped');
    if (!llmService.isModelLoaded()) {
      const id = useAppStore.getState().activeModelId;
      if (!id) throw new Error('No model selected. Load a text model first (Models tab).');
      await activeModelService.loadTextModel(id);
      if (!llmService.isModelLoaded()) throw new Error('The model could not be loaded.');
    }
    const ctx = llmService.getPerformanceSettings().contextLength || 2048;
    const maxChars = Math.max(2500, (ctx - 700) * 3);
    const u = fitPrompt(user, Math.max(800, maxChars - system.length));
    const msg = (role: 'system' | 'user', content: string) => ({ id: localUniqueId(role), role, content, timestamp: Date.now() });
    const out = await llmService.generateResponse([msg('system', system), msg('user', u)], { disableThinking: true });
    return out.replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/<\/?think>/gi, '').trim();
  }, { maxWaitMs: 30 * 60_000, shouldStop });
}
