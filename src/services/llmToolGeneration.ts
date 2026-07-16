/**
 * Tool-aware LLM generation helper.
 * Extracted to keep llm.ts under the max-lines limit.
 */

import { useAppStore } from '../stores/appStore';
import type { Message } from '../types';
import type { ToolCall } from './tools/types';
import { recordGenerationStats, buildCompletionParams, buildThinkingCompletionParams, safeCompletion, isTruncatedResult, getStreamingDelta } from './llmHelpers';
import type { StreamToken } from './llmStreamTypes';
import logger from '../utils/logger';
import { TOOL_CALL_OPENERS, TOOL_CALL_CLOSERS, maxPartialTagSuffix } from '../utils/messageContent';

type ToolStreamCallback = (data: StreamToken) => void;
type ToolCompleteCallback = (fullResponse: string, reasoningContent: string) => void;

/**
 * Suppresses Gemma 4's native tool call tokens from the visible text stream.
 * Gemma 4 wraps tool calls in <|tool_call>...<tool_call|> (and the colon form
 * <tool_call:NAME…, closed by <tool_call|> or </tool_call>) — llama.rn parses the
 * structured call fine, but the raw tokens still flow through data.token. This filter
 * buffers the stream and drops everything inside those tags.
 *
 * The opener/closer set is the SHARED grammar (TOOL_CALL_OPENERS/CLOSERS in messageContent)
 * that the stored-content stripper also uses — so the live filter and the stripper cannot
 * disagree about which formats are tool markup (DR7). Exported for direct testing.
 */
export class ToolCallTokenFilter {
  private inBlock = false;
  private buffer = '';

  process(token: string): string {
    this.buffer += token;
    return this.flush();
  }

  private flush(): string {
    let output = '';

    while (this.buffer.length > 0) {
      if (this.inBlock) {
        // Inside a tool block: end it at the NEAREST closer of any form.
        const closeIdx = this.earliestIndex(TOOL_CALL_CLOSERS);
        if (closeIdx === -1) {
          const partial = maxPartialTagSuffix(this.buffer, TOOL_CALL_CLOSERS);
          this.buffer = partial > 0 ? this.buffer.slice(this.buffer.length - partial) : '';
          break;
        }
        this.buffer = this.buffer.slice(closeIdx + this.matchedLengthAt(TOOL_CALL_CLOSERS, closeIdx));
        this.inBlock = false;
      } else {
        // Outside: enter a block at the EARLIEST opener of any form.
        const openIdx = this.earliestIndex(TOOL_CALL_OPENERS);
        if (openIdx === -1) {
          const partial = maxPartialTagSuffix(this.buffer, TOOL_CALL_OPENERS);
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
        this.buffer = this.buffer.slice(openIdx + this.matchedLengthAt(TOOL_CALL_OPENERS, openIdx));
        this.inBlock = true;
      }
    }

    return output;
  }

  /** Earliest index at which ANY of the tags occurs in the buffer, or -1. */
  private earliestIndex(tags: string[]): number {
    let best = -1;
    for (const tag of tags) {
      const idx = this.buffer.indexOf(tag);
      if (idx !== -1 && (best === -1 || idx < best)) best = idx;
    }
    return best;
  }

  /** Length of whichever tag actually matches at idx (closers/openers can overlap in prefix). */
  private matchedLengthAt(tags: string[], idx: number): number {
    let len = 0;
    for (const tag of tags) {
      if (this.buffer.startsWith(tag, idx) && tag.length > len) len = tag.length;
    }
    return len;
  }
}

/**
 * Parse a tool call's `arguments` JSON string into an object, tolerating the smart/curly quotes some
 * local models emit as string delimiters. Plain JSON.parse rejects `{"expression":"7 * 7"}` (curly
 * double quotes) → args became `{}` → the tool got an EMPTY call → schema validation failed → the
 * model retried the same call in a loop until it happened to emit straight quotes (device 2026-07-15).
 * We try strict JSON first (unchanged for the common case), then retry once with curly double quotes
 * normalized to straight. Zero-IO; exercised through generateWithToolsImpl in tests.
 */
function parseToolArguments(raw: string): Record<string, unknown> {
  const tryParse = (s: string): Record<string, unknown> | undefined => {
    try {
      const v = JSON.parse(s || '{}');
      return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined;
    } catch {
      return undefined;
    }
  };
  // Normalize only the JSON string DELIMITERS (curly → straight double quotes); leave content alone.
  return tryParse(raw) ?? tryParse(raw.replace(/[“”]/g, '"')) ?? {};
}

function parseToolCall(tc: any): ToolCall {
  const fn = tc.function || {};
  let args = fn.arguments || {};
  if (typeof args === 'string') {
    args = parseToolArguments(args);
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
): Promise<{ fullResponse: string; toolCalls: ToolCall[]; interrupted?: boolean }> {
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
    let fullReasoning = '';
    let streamedContentSoFar = '';
    let streamedReasoningSoFar = '';
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
    logger.log('[LLM-Tools] === INPUT ===');
    logger.log(JSON.stringify(completionParams, null, 2));
    const completionResult: any = await safeCompletion(deps.context, () => deps.context.completion(completionParams as any, (data: any) => {
      if (!generating) return;
      if (data.tool_calls) {
        for (const tc of data.tool_calls) {
          collectedToolCalls.push(parseToolCall(tc));
        }
      }
      if (!data.token) return;
      if (!firstReceived) { firstReceived = true; firstTokenMs = Date.now() - startTime; }
      tokenCount++;
      // Consume the SAME structured fields the runtime returns as the plain path does: with
      // reasoning_format=auto llama separates the reasoning into reasoning_content and the clean answer
      // into content. Route each to its own channel so the thinking block renders and the raw
      // <|channel> markers (data.token) never leak into the answer. (The tool path previously appended
      // data.token verbatim, so gemma's reasoning + its <|channel> delimiters landed in the reply.)
      const contentPiece = getStreamingDelta(data.content ?? (!data.reasoning_content ? data.token : undefined), streamedContentSoFar);
      const reasoningPiece = getStreamingDelta(data.reasoning_content || undefined, streamedReasoningSoFar);
      if (data.content) streamedContentSoFar = data.content;
      else if (!data.reasoning_content && data.token) streamedContentSoFar += data.token;
      if (data.reasoning_content) streamedReasoningSoFar = data.reasoning_content;
      if (reasoningPiece) { fullReasoning += reasoningPiece; options.onStream?.({ reasoningContent: reasoningPiece }); }
      if (contentPiece) {
        const visible = toolCallFilter ? toolCallFilter.process(contentPiece) : contentPiece;
        fullResponse += visible;
        if (visible) options.onStream?.({ content: visible });
      }
    }), 'generateWithTools');
    logger.log('[LLM-Tools] === OUTPUT ===');
    logger.log(JSON.stringify(completionResult, null, 2));
    // [WIRE] full tool-generation input+output on ONE tagged line so the lossless wire file captures the
    // whole payload (the pretty-printed dumps above are separate untagged lines the tee can't match).
    logger.log(`[WIRE-LLAMA-TOOL] ${JSON.stringify({ input: completionParams, output: completionResult })}`);

    const cr = completionResult;
    logger.log(`[LLM-Tools] Completion done: streamed=${tokenCount} tokens, response="${fullResponse.substring(0, 100)}"`);
    logger.log(`[LLM-Tools] Result: predicted=${cr?.tokens_predicted}, evaluated=${cr?.tokens_evaluated}, context_full=${cr?.context_full}, stopped_eos=${cr?.stopped_eos}`);
    logger.log(`[LLM-Tools] Result text="${(cr?.text || '').substring(0, 200)}", content="${(cr?.content || '').substring(0, 200)}"`);

    // If streaming didn't capture tokens, fall back to the CLEAN parsed content — NEVER cr.text, which
    // carries the raw <|channel>thought…<channel|> reasoning markers. reasoning falls back likewise.
    if (!fullResponse) {
      fullResponse = cr?.content ?? cr?.text ?? '';
      tokenCount = cr?.tokens_predicted || tokenCount;
      logger.log(`[LLM-Tools] Using completionResult.content as response (${fullResponse.length} chars)`);
    }
    // The reasoning the user sees: prefer the runtime's parsed reasoning_content, else what streamed.
    const finalReasoning = (typeof cr?.reasoning_content === 'string' && cr.reasoning_content) || fullReasoning;

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

    deps.setPerformanceStats({
      ...recordGenerationStats(startTime, firstTokenMs, tokenCount),
      // Flag a reply cut off at the n_predict cap so the UI can show it (B15) — but NOT a user stop
      // (interrupted), which also has stopped_eos:false. Single verdict shared with the plain path.
      lastTruncated: isTruncatedResult(cr),
    });
    generating = false;
    deps.setIsGenerating(false);
    if (cr?.context_full) {
      logger.log('[LLM-Tools] Context full detected — signalling for compaction');
      throw new Error('Context is full');
    }
    options.onComplete?.(fullResponse, finalReasoning);
    // Surface a native interrupt (user stop landing mid-completion) to the caller — the tool
    // loop must treat it as a STOPPED turn, never as a normal empty result (which re-ran a
    // full no-tools generation after the stop: the zombie that held the engine and made every
    // next send fail 'LLM service busy', and whose empty output painted the wrong
    // "No response / incompatible backend" card).
    return { fullResponse, toolCalls: collectedToolCalls, interrupted: cr?.interrupted === true };
  } catch (error) {
    generating = false;
    deps.setIsGenerating(false);
    throw error;
  }
}
