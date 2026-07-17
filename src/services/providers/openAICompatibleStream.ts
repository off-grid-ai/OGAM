/**
 * OpenAI-Compatible Provider — streaming utilities
 * ThinkTagParser, processDelta, generateOllamaChatImpl
 */
import { createNDJSONStreamingRequest } from '../httpClient';
import logger from '../../utils/logger';
import { REASONING_DELIMITERS, partialTagSuffix, maxPartialTagSuffix } from '../../utils/messageContent';
import type { StreamCallbacks } from './types';
import type {
  OpenAIChatMessage,
  OpenAIToolCall,
  OpenAIStreamState,
  OllamaChatRequest,
} from './openAICompatibleTypes';

/**
 * Streaming parser for <think>...</think> tags embedded in delta.content.
 * Routes thinking content to onReasoning and regular content to onToken.
 * Handles tags split across multiple streaming chunks.
 */
export class ThinkTagParser {
  private inThinkBlock = false;
  private buffer = '';
  // The close tag for the reasoning format currently open — set when an opener is matched,
  // so a block opened as Gemma closes on `<channel|>` and one opened as <think> on </think>.
  private activeClose = '';
  // A single `\n` immediately after an opener is a SYNTACTIC separator (`<|channel>thought\n…`,
  // `<think>\n…`), not reasoning — consume it once on block entry so reasoning has no leading
  // newline. Mirrors the complete parser's `\n?` after the Gemma opener; without it the bare
  // `<|channel>thought` opener would emit the separating newline as reasoning content.
  private stripLeadingNewlineOnEntry = false;

  process(content: string, onToken: (t: string) => void, onReasoning: (t: string) => void): void {
    this.buffer += content;
    this.flush(onToken, onReasoning);
  }

  /**
   * Handle one iteration of the while loop when we are outside a reasoning block.
   * Scans for the EARLIEST opener across every reasoning format (the shared grammar), so
   * remote-streamed Gemma/Qwen channel reasoning is recognised, not just <think> (DR1).
   * Returns true if the while loop should break (buffer needs more data).
   */
  private handleOutsideThink(onToken: (t: string) => void): boolean {
    let bestIdx = -1;
    let bestOpen = '';
    let bestClose = '';
    for (const d of REASONING_DELIMITERS) {
      const idx = this.buffer.indexOf(d.open);
      if (idx !== -1 && (bestIdx === -1 || idx < bestIdx)) {
        bestIdx = idx;
        bestOpen = d.open;
        bestClose = d.close;
      }
    }
    if (bestIdx === -1) {
      // No complete opener. Hold back only a suffix that could still become one of the openers.
      const partial = maxPartialTagSuffix(this.buffer, REASONING_DELIMITERS.map((d) => d.open));
      if (partial > 0) {
        onToken(this.buffer.slice(0, this.buffer.length - partial));
        this.buffer = this.buffer.slice(this.buffer.length - partial);
        return true;
      }
      onToken(this.buffer);
      this.buffer = '';
      return true;
    }
    if (bestIdx > 0) onToken(this.buffer.slice(0, bestIdx));
    this.buffer = this.buffer.slice(bestIdx + bestOpen.length);
    this.inThinkBlock = true;
    this.activeClose = bestClose;
    this.stripLeadingNewlineOnEntry = true;
    return false;
  }

  /**
   * Handle one iteration of the while loop when we are inside a reasoning block, matching the
   * close tag for the format that opened it (this.activeClose).
   * Returns true if the while loop should break (buffer needs more data).
   */
  private handleInsideThink(onReasoning: (t: string) => void): boolean {
    // Consume the one optional `\n` separator that follows the opener before any reasoning is
    // emitted. Char-by-char safe: if the buffer is still empty, wait for the next char; if it
    // starts with a non-newline, there was no separator — clear the flag and fall through.
    if (this.stripLeadingNewlineOnEntry) {
      if (this.buffer.length === 0) return true;
      if (this.buffer[0] === '\n') this.buffer = this.buffer.slice(1);
      this.stripLeadingNewlineOnEntry = false;
    }
    const closeTag = this.activeClose;
    const idx = this.buffer.indexOf(closeTag);
    if (idx === -1) {
      const partial = partialTagSuffix(this.buffer, closeTag);
      if (partial > 0) {
        onReasoning(this.buffer.slice(0, this.buffer.length - partial));
        this.buffer = this.buffer.slice(this.buffer.length - partial);
        return true;
      }
      onReasoning(this.buffer);
      this.buffer = '';
      return true;
    }
    if (idx > 0) onReasoning(this.buffer.slice(0, idx));
    this.buffer = this.buffer.slice(idx + closeTag.length);
    this.inThinkBlock = false;
    this.activeClose = '';
    return false;
  }

  private flush(onToken: (t: string) => void, onReasoning: (t: string) => void): void {
    while (this.buffer.length > 0) {
      const shouldBreak = this.inThinkBlock
        ? this.handleInsideThink(onReasoning)
        : this.handleOutsideThink(onToken);
      if (shouldBreak) break;
    }
  }
}

/** Context passed to processDelta */
interface DeltaCtx {
  thinkingEnabled: boolean;
  callbacks: StreamCallbacks;
  thinkTagParser: ThinkTagParser;
}

type DeltaShape = {
  content?: string;
  reasoning_content?: string;
  reasoning?: string;
  thinking?: string;
  tool_calls?: Array<{
    index?: number; id?: string; type?: string;
    function?: { name?: string; arguments?: string };
  }>;
};

function processToolCallChunk(
  tc: NonNullable<DeltaShape['tool_calls']>[0],
  state: OpenAIStreamState,
): void {
  const index =
    Number.isInteger(tc.index) && tc.index! >= 0 ? tc.index : undefined;
  let target = index === undefined ? undefined : state.toolCalls[index];

  if (!target && tc.id) {
    target = {
      id: tc.id,
      type: 'function',
      function: { name: '', arguments: '' },
    };
    if (index === undefined) state.toolCalls.push(target);
    else state.toolCalls[index] = target;
  }

  // Some providers omit `index` on continuation chunks. Preserve their legacy
  // sequential behavior while preferring the OpenAI index whenever it exists.
  if (!target && state.currentToolCall?.function) {
    target = state.currentToolCall as OpenAIToolCall;
  }
  if (!target) return;

  state.currentToolCall = target;
  if (tc.id) target.id = tc.id;
  if (tc.function?.name) target.function.name = tc.function.name;
  if (tc.function?.arguments) {
    target.function.arguments += tc.function.arguments;
  }
}

/**
 * Process a streaming delta — extracted to reduce complexity of the SSE event handler.
 * Mutates state.fullContent, state.fullReasoningContent, state.toolCalls, state.currentToolCall.
 */
export function processDelta(
  delta: DeltaShape,
  state: OpenAIStreamState,
  ctx: DeltaCtx,
): void {
  logger.log(`[WIRE-REMOTE] ${JSON.stringify(delta)}`); // [WIRE] raw OpenAI-compatible/Ollama delta from-device
  if (delta.content) {
    ctx.thinkTagParser.process(
      delta.content,
      (text) => { state.fullContent += text; ctx.callbacks.onToken(text); },
      (reasoning) => {
        if (ctx.thinkingEnabled) {
          state.fullReasoningContent += reasoning;
          ctx.callbacks.onReasoning?.(reasoning);
        }
      },
    );
  }

  // Reasoning content — check all known field names across providers:
  // - delta.reasoning_content (LM Studio)
  // - delta.reasoning         (Ollama /v1/chat/completions)
  // - delta.thinking          (kept as fallback)
  const reasoningDelta = delta.reasoning_content || delta.reasoning || delta.thinking;
  // A DEDICATED reasoning field means the remote model chose to emit reasoning — surface
  // it regardless of the local thinkingEnabled toggle. Remote has no thinking toggle, so
  // gating on it dropped reasoning LM Studio actually sent (B16); providers that CAN be
  // told not to think (Ollama's `think` param) simply won't send this field when off.
  if (reasoningDelta) {
    state.fullReasoningContent += reasoningDelta;
    ctx.callbacks.onReasoning?.(reasoningDelta);
  }

  if (delta.tool_calls) {
    for (const tc of delta.tool_calls) {
      processToolCallChunk(tc, state);
    }
  }
}

/** Build the completion result from accumulated Ollama tool calls */
function buildOllamaCompletion(
  fullContent: string,
  fullReasoningContent: string,
  accumulatedToolCalls: OpenAIToolCall[],
): { content: string; reasoningContent?: string; meta: { gpu: boolean; gpuBackend: string }; toolCalls?: Array<{ id: string; name: string; arguments: string }> } {
  return {
    content: fullContent,
    reasoningContent: fullReasoningContent || undefined,
    meta: { gpu: false, gpuBackend: 'Remote' },
    toolCalls: accumulatedToolCalls.length > 0 ? accumulatedToolCalls.map(tc => ({
      id: tc.id, name: tc.function.name,
      arguments: typeof tc.function.arguments === 'string' ? tc.function.arguments : JSON.stringify(tc.function.arguments),
    })) : undefined,
  };
}

/** NDJSON line handler state for Ollama streaming */
interface OllamaStreamState {
  fullContent: string;
  fullReasoningContent: string;
  completeCalled: boolean;
  streamErrorOccurred: boolean;
  accumulatedToolCalls: OpenAIToolCall[];
}

/** Process a single NDJSON line from Ollama's /api/chat streaming response */
function handleOllamaChatLine(
  line: Record<string, unknown>,
  streamState: OllamaStreamState,
  req: { callbacks: StreamCallbacks; signal: AbortSignal; abort: () => void },
): void {
  if (req.signal.aborted) return;
  logger.log(`[WIRE-OLLAMA] ${JSON.stringify(line)}`); // [WIRE] raw Ollama /api/chat NDJSON line from-device

  if (line.error) {
    streamState.streamErrorOccurred = true;
    req.callbacks.onError(new Error(typeof line.error === 'string' ? line.error : JSON.stringify(line.error)));
    req.abort();
    return;
  }

  const msg = line.message as {
    role?: string; content?: string; thinking?: string; tool_calls?: OpenAIToolCall[]
  } | undefined;
  if (msg) {
    if (msg.thinking) { streamState.fullReasoningContent += msg.thinking; req.callbacks.onReasoning?.(msg.thinking); }
    if (msg.content) { streamState.fullContent += msg.content; req.callbacks.onToken(msg.content); }
    // Collect tool_calls from every message (they arrive in done:false chunks)
    if (msg.tool_calls) {
      for (const tc of msg.tool_calls) {
        if (tc.function?.name) {
          logger.log(`[OllamaChat] tool_call: ${tc.function.name}(${typeof tc.function.arguments === 'string' ? tc.function.arguments.substring(0, 100) : JSON.stringify(tc.function.arguments).substring(0, 100)})`);
          streamState.accumulatedToolCalls.push(tc);
        }
      }
    }
  }

  if (line.done) {
    logger.log(`[OllamaChat] stream done — content=${streamState.fullContent.length}, reasoning=${streamState.fullReasoningContent.length}, toolCalls=${streamState.accumulatedToolCalls.length}`);
    streamState.completeCalled = true;
    req.callbacks.onComplete(buildOllamaCompletion(streamState.fullContent, streamState.fullReasoningContent, streamState.accumulatedToolCalls));
  }
}

/**
 * Generate using Ollama's native /api/chat endpoint (NDJSON streaming).
 * Supports think: true/false for reasoning control.
 */
export async function generateOllamaChatImpl(
  openaiMessages: OpenAIChatMessage[],
  req: OllamaChatRequest,
): Promise<void> {
  const { options, callbacks, signal, endpoint, modelId, abort } = req;
  const thinkingEnabled = options.enableThinking !== false;

  // Convert to Ollama message format
  // Convert tool_calls arguments from JSON strings to objects for Ollama's native format
  const convertToolCalls = (tcs: OpenAIToolCall[] | undefined) => {
    if (!tcs) return undefined;
    return tcs.map(tc => ({
      ...tc,
      function: {
        ...tc.function,
        arguments: typeof tc.function.arguments === 'string'
          ? (() => { try { return JSON.parse(tc.function.arguments); } catch { return tc.function.arguments; } })()
          : tc.function.arguments,
      },
    }));
  };

  // Images go in a top-level `images` array as raw base64 (strip data:...;base64, prefix)
  const ollamaMessages = openaiMessages.map(m => {
    const toolCalls = convertToolCalls(m.tool_calls);
    if (typeof m.content === 'string') {
      return {
        role: m.role, content: m.content,
        ...(toolCalls && { tool_calls: toolCalls }),
        ...(m.tool_call_id && { tool_call_id: m.tool_call_id }),
      };
    }
    const parts = m.content as Array<{ type: string; text?: string; image_url?: { url: string } }>;
    const text = parts.find(p => p.type === 'text')?.text ?? '';
    const images = parts
      .filter(p => p.type === 'image_url')
      .map(p => {
        const url = p.image_url?.url ?? '';
        // Strip data:image/...;base64, prefix — Ollama expects raw base64
        const b64Match = /^data:[^;]+;base64,(.+)$/.exec(url);
        return b64Match ? b64Match[1] : url;
      });
    return {
      role: m.role, content: text,
      ...(images.length > 0 && { images }),
      ...(toolCalls && { tool_calls: toolCalls }),
      ...(m.tool_call_id && { tool_call_id: m.tool_call_id }),
    };
  });

  const requestBody: Record<string, unknown> = {
    model: modelId, messages: ollamaMessages, stream: true, think: thinkingEnabled,
    ...(options.tools && options.tools.length > 0 && { tools: options.tools }),
    options: {
      ...(options.temperature !== undefined && { temperature: options.temperature }),
      // num_predict intentionally omitted — Ollama defaults to -1 (until natural stop).
      // A client-side cap truncates reasoning models mid-<think>.
      ...(options.topP !== undefined && { top_p: options.topP }),
    },
  };

  let baseUrl = endpoint;
  while (baseUrl.endsWith('/')) baseUrl = baseUrl.slice(0, -1);
  const url = `${baseUrl}/api/chat`;

  const streamState: OllamaStreamState = {
    fullContent: '',
    fullReasoningContent: '',
    completeCalled: false,
    streamErrorOccurred: false,
    accumulatedToolCalls: [],
  };

  try {
    await createNDJSONStreamingRequest(url, { body: requestBody, headers: {}, timeout: 300000, signal }, (line) => {
      handleOllamaChatLine(line, streamState, { callbacks, signal, abort });
    });

    if (!streamState.completeCalled && !streamState.streamErrorOccurred) {
      callbacks.onComplete(buildOllamaCompletion(streamState.fullContent, streamState.fullReasoningContent, streamState.accumulatedToolCalls));
    }
  } catch (error) {
    if (signal.aborted) { callbacks.onComplete({ content: '', meta: { gpu: false } }); return; }
    callbacks.onError(error instanceof Error ? error : new Error(String(error)));
  }
}
