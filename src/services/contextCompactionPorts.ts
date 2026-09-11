/** Mobile platform ports for the shared context-compaction application service. Port-only. */
import type {
  ChatCompactionContext,
  CompactableGenerationMessage,
  ContextCompactionService,
} from '@offgrid/models';
import { llmService } from './llm';
import { executeMobileText } from './mobileSidecarGeneration';
import { applicationFacade } from './applicationFacade';
import { APP_CONFIG } from '../constants';
import logger from '../utils/logger';

/**
 * Durable compaction state belongs to the conversation record Workspace Content owns, so the one
 * write path is its `update_conversation` command. A Zustand mirror cannot be a second owner: a
 * conversation Shared created (Sync, or another Shared surface) has no legacy row at all, and its
 * summary would then be dropped.
 *
 * The shared port is strictly `Promise<void>`: `ContextCompactionService` awaits it, so the
 * compacted prompt and the cleared state cannot advance before the durable write lands. Awaiting
 * the outcome here is what turns a rejected command into a reported failure instead of a silent
 * divergence from the projection.
 */
async function persistCompactionState(
  conversationId: string,
  summary: string | undefined,
  cutoffMessageId: string | undefined,
): Promise<void> {
  const patch = {
    // Shared defines null as clear and undefined as unchanged. The compaction service supplies both
    // values for a normal write and neither for a clear, so the two durable facts move together.
    compactionSummary: summary ?? null,
    compactionCutoffMessageId: cutoffMessageId ?? null,
  };
  const outcome = await applicationFacade().workspaceContent.execute({
    type: 'update_conversation',
    conversationId,
    patch,
  });
  if (!outcome.ok) {
    logger.warn(
      '[ContextCompaction] Persisting compaction state failed:',
      outcome.failure.message,
    );
    throw new Error(
      `Compaction state was not saved: ${outcome.failure.message}`,
    );
  }
}

/** Native context window, token count, generation, and persistence ports. Shared owns the plan. */
export function mobileContextCompactionPorts(): ConstructorParameters<
  typeof ContextCompactionService<CompactableGenerationMessage>
>[0] {
  return {
    clearContext: () => llmService.clearKVCache(true),
    contextLength: () =>
      llmService.getPerformanceSettings().contextLength || 2048,
    countTokens: text => llmService.getTokenCount(text),
    summarize: (messages, maxTokens) =>
      executeMobileText([...messages], { maxTokens }),
    persist: (conversationId, summary, cutoffMessageId) =>
      persistCompactionState(conversationId, summary, cutoffMessageId),
    systemMessage: content => ({ id: 'system', role: 'system', content }),
    summaryMessage: content => ({
      id: 'compaction-summary',
      role: 'assistant',
      content: `[Previous conversation summary]\n${content}`,
    }),
    report: (event, detail) => {
      if (event === 'summary-failed')
        logger.warn(
          '[ContextCompaction] Summarization failed, using trim-only:',
          detail,
        );
      else logger.log(`[ContextCompaction] ${event}`, detail ?? '');
    },
  };
}

/**
 * The conversation-scoped inputs a compaction run needs: the previous summary this conversation
 * already carries, read from the canonical Workspace Content projection, and the app's default
 * system prompt.
 */
export function mobileCompactionOptions(
  context: ChatCompactionContext,
): Parameters<
  ContextCompactionService<CompactableGenerationMessage>['compactChat']
>[1] {
  const conversation = applicationFacade()
    .workspaceContent.snapshot()
    .conversations.find(
      candidate => candidate.id === context.identity.conversationId,
    );
  return {
    ...(conversation?.compactionSummary
      ? { previousSummary: conversation.compactionSummary }
      : {}),
    ...(conversation?.compactionCutoffMessageId
      ? { previousCutoffMessageId: conversation.compactionCutoffMessageId }
      : {}),
    defaultSystemPrompt: APP_CONFIG.defaultSystemPrompt,
  };
}
