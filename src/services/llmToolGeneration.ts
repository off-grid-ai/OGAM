/**
 * Tool-aware LLM generation helper.
 * Extracted to keep llm.ts under the max-lines limit.
 */

import { useAppStore } from '../stores';
import type { Message } from '../types';
import type { ToolCall } from './tools/types';
import { recordGenerationStats, buildCompletionParams, buildThinkingCompletionParams, safeCompletion } from './llmHelpers';
import type { StreamToken } from './llm';
import { applyDevGrammarOverrides, noteDevGrammarError } from './devInference';
import logger from '../utils/logger';

type ToolStreamCallback = (data: StreamToken) => void;
type ToolCompleteCallback = (fullResponse: string) => void;

/**
 * Suppresses Gemma 4's native tool call tokens from the visible text stream.
 * Gemma 4 wraps tool calls in <|tool_call>...<tool_call|> — llama.rn parses
 * the structured call fine, but the raw tokens still flow through data.token.
 * This filter buffers the stream and drops everything inside those tags.
 */
class ToolCallTokenFilter {
  private inBlock = false;
  private buffer = '';

  process(token: string): string {
    this.buffer += token;
    return this.flush();
  }

  /** Clear buffered state (used when a generation is retried from scratch). */
  reset(): void {
    this.inBlock = false;
    this.buffer = '';
  }

  private flush(): string {
    const openTag = '<|tool_call>';
    const closeTag = '<tool_call|>';
    let output = '';

    while (this.buffer.length > 0) {
      if (this.inBlock) {
        const closeIdx = this.buffer.indexOf(closeTag);
        if (closeIdx === -1) {
          // Partial close tag may be at the end — hold it in the buffer
          const partial = this.partialSuffix(this.buffer, closeTag);
          this.buffer = partial > 0 ? this.buffer.slice(this.buffer.length - partial) : '';
          break;
        }
        // Drop everything up to and including the close tag
        this.buffer = this.buffer.slice(closeIdx + closeTag.length);
        this.inBlock = false;
      } else {
        const openIdx = this.buffer.indexOf(openTag);
        if (openIdx === -1) {
          const partial = this.partialSuffix(this.buffer, openTag);
          if (partial > 0) {
            output += this.buffer.slice(0, this.buffer.length - partial);
            this.buffer = this.buffer.slice(this.buffer.length - partial);
          } else {
            output += this.buffer;
            this.buffer = '';
          }
          break;
        }
        output += this.buffer.slice(0, openIdx);
        this.buffer = this.buffer.slice(openIdx + openTag.length);
        this.inBlock = true;
      }
    }

    return output;
  }

  private partialSuffix(text: string, tag: string): number {
    for (let len = Math.min(tag.length - 1, text.length); len > 0; len--) {
      if (text.endsWith(tag.slice(0, len))) return len;
    }
    return 0;
  }
}

function parseToolCall(tc: any): ToolCall {
  const fn = tc.function || {};
  let args = fn.arguments || {};
  if (typeof args === 'string') {
    try { args = JSON.parse(args || '{}'); } catch { args = {}; }
  }
  return { id: tc.id, name: fn.name || '', arguments: args };
}

export interface ToolGenerationDeps {
  context: any;
  isGenerating: boolean;
  isThinkingEnabled: boolean;
  isGemma4Model: boolean;
  disableCtxShift: boolean;
  manageContextWindow: (messages: Message[], extraReserve?: number) => Promise<Message[]>;
  convertToOAIMessages: (messages: Message[]) => any[];
  setPerformanceStats: (stats: any) => void;
  setIsGenerating: (v: boolean) => void;
}

export async function generateWithToolsImpl(
  deps: ToolGenerationDeps,
  messages: Message[],
  options: { tools: any[]; onStream?: ToolStreamCallback; onComplete?: ToolCompleteCallback },
): Promise<{ fullResponse: string; toolCalls: ToolCall[] }> {
  if (!deps.context) throw new Error('No model loaded');
  if (deps.isGenerating) throw new Error('Generation already in progress');
  deps.setIsGenerating(true);

  // Mutable flag for the streaming callback (deps.isGenerating is a stale copy)
  let generating = true;

  try {
    // Reserve context space for tool schemas (~100 tokens per tool)
    const toolTokenReserve = options.tools.length * 100;
    const managed = await deps.manageContextWindow(messages, toolTokenReserve);
    const oaiMessages = deps.convertToOAIMessages(managed);
    const { settings } = useAppStore.getState();
    const startTime = Date.now();
    let firstTokenMs = 0;
    let tokenCount = 0;
    let fullResponse = '';
    let firstReceived = false;
    const collectedToolCalls: ToolCall[] = [];
    // Gemma 4 emits <|tool_call>...<tool_call|> tokens in the stream; filter them out.
    const toolCallFilter = deps.isGemma4Model ? new ToolCallTokenFilter() : null;

    const completionParams = {
      messages: oaiMessages,
      ...buildCompletionParams(settings, { disableCtxShift: deps.disableCtxShift }),
      tools: options.tools,
      tool_choice: 'auto',
      ...buildThinkingCompletionParams(deps.isThinkingEnabled, deps.isGemma4Model),
    };
    // DEV-only: a pasted GBNF grammar / temp / prefill can override this turn
    // (and strips tools). No-op unless enabled from the __DEV__ grammar modal.
    const devGrammarApplied = applyDevGrammarOverrides(completionParams);
    if (devGrammarApplied) logger.log(`[DevGrammar] reached native completion (tools path); grammar in params=${!!(completionParams as any).grammar}`);
    logger.log('[LLM-Tools] === INPUT ===');
    logger.log(JSON.stringify(completionParams, null, 2));
    const onCompletionData = (data: any) => {
      if (!generating) return;
      if (data.tool_calls) {
        for (const tc of data.tool_calls) {
          collectedToolCalls.push(parseToolCall(tc));
        }
      }
      if (!data.token) return;
      if (!firstReceived) { firstReceived = true; firstTokenMs = Date.now() - startTime; }
      tokenCount++;
      const visibleToken = toolCallFilter ? toolCallFilter.process(data.token) : data.token;
      fullResponse += visibleToken;
      if (visibleToken) options.onStream?.({ content: visibleToken });
    };
    let completionResult: any;
    try {
      completionResult = await safeCompletion(deps.context, () => deps.context.completion(completionParams as any, onCompletionData), 'generateWithTools');
    } catch (e) {
      // A bad dev grammar must never brick chat: record it and retry ungrammared.
      if (!devGrammarApplied) throw e;
      noteDevGrammarError(completionParams, e);
      // Reset streaming state so the ungrammared retry doesn't append to / re-emit
      // the failed attempt's partial output or double-count its tool calls.
      fullResponse = '';
      collectedToolCalls.length = 0;
      toolCallFilter?.reset();
      completionResult = await safeCompletion(deps.context, () => deps.context.completion(completionParams as any, onCompletionData), 'generateWithTools-fallback');
    }
    logger.log('[LLM-Tools] === OUTPUT ===');
    logger.log(JSON.stringify(completionResult, null, 2));

    const cr = completionResult;
    logger.log(`[LLM-Tools] Completion done: streamed=${tokenCount} tokens, response="${fullResponse.substring(0, 100)}"`);
    logger.log(`[LLM-Tools] Result: predicted=${cr?.tokens_predicted}, evaluated=${cr?.tokens_evaluated}, context_full=${cr?.context_full}, stopped_eos=${cr?.stopped_eos}`);
    logger.log(`[LLM-Tools] Result text="${(cr?.text || '').substring(0, 200)}", content="${(cr?.content || '').substring(0, 200)}"`);

    // If streaming didn't capture tokens but completionResult has text, use it
    if (!fullResponse && cr?.text) {
      fullResponse = cr.text;
      tokenCount = cr.tokens_predicted || 0;
      logger.log(`[LLM-Tools] Using completionResult.text as response (${fullResponse.length} chars)`);
    }

    // Prefer completionResult tool_calls over streamed ones — streaming may
    // deliver partial tool calls (name only, no arguments) while the final
    // result contains the complete tool call data.
    const resultToolCalls = cr?.tool_calls;
    if (resultToolCalls?.length) {
      collectedToolCalls.length = 0;
      for (const tc of resultToolCalls) {
        collectedToolCalls.push(parseToolCall(tc));
      }
      logger.log(`[LLM-Tools] Using ${collectedToolCalls.length} tool call(s) from completionResult`);
    }

    deps.setPerformanceStats(recordGenerationStats(startTime, firstTokenMs, tokenCount));
    generating = false;
    deps.setIsGenerating(false);
    if (cr?.context_full) {
      logger.log('[LLM-Tools] Context full detected — signalling for compaction');
      throw new Error('Context is full');
    }
    options.onComplete?.(fullResponse);
    return { fullResponse, toolCalls: collectedToolCalls };
  } catch (error) {
    generating = false;
    deps.setIsGenerating(false);
    throw error;
  }
}
