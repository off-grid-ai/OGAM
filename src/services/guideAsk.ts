/**
 * The Ask box on "What it does for you": the guide sends its grounding and the conversation, the
 * chat model on this phone answers. The guide is its own conversation to the model, so it never
 * inherits a chat's context and a chat never inherits the guide's.
 */
import { llmService } from './llm';
import { activeModelService } from './activeModelService';
import { useAppStore } from '../stores';
import type { Message } from '../types';

export type GuideTurn = { role: 'user' | 'assistant'; content: string };

/** The answer, or why there is none: no chat model on this phone, a reply already running, or the ask failed. */
export type GuideAnswer = { answer: string } | { error: 'no-model' | 'busy' | 'failed' };

const GUIDE_CONVERSATION = 'off-grid-guide';

export async function askGuide(system: string, turns: GuideTurn[]): Promise<GuideAnswer> {
  const modelId = useAppStore.getState().activeModelId;
  if (!llmService.isModelLoaded() && !modelId) return { error: 'no-model' };
  if (llmService.isCurrentlyGenerating()) return { error: 'busy' };
  try {
    // The chosen model may be picked but not loaded yet (a relaunch loads nothing until it is needed).
    if (!llmService.isModelLoaded() && modelId) await activeModelService.loadTextModel(modelId);
    await llmService.prepareConversationBoundary(GUIDE_CONVERSATION);
    const now = Date.now();
    const messages: Message[] = [
      { id: 'guide-system', role: 'system', content: system, timestamp: now },
      ...turns.map((t, i) => ({ id: `guide-${i}`, role: t.role, content: t.content, timestamp: now })),
    ];
    const text = await llmService.generateResponse(messages, { disableThinking: true, maxTokens: 400 });
    return text.trim() ? { answer: text.trim() } : { error: 'failed' };
  } catch {
    return { error: 'failed' };
  }
}
