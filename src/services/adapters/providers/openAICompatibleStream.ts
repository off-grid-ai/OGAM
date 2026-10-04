/**
 * OpenAI-Compatible Provider — streaming utilities
 * ThinkTagParser, processDelta, generateOllamaChatImpl
 */
import { createNDJSONStreamingRequest } from '../../httpClient';
import logger from '../../../utils/logger';
import { REASONING_DELIMITERS } from '../../../utils/messageContent';
import {
  IncrementalReasoningParser,
  applyOpenAICompatibleDelta,
  ollamaChatRequest,
  projectOllamaStreamLine,
} from '@offgrid/models';
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
export class ThinkTagParser extends IncrementalReasoningParser {
  constructor() {
    super(REASONING_DELIMITERS);
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
  const projected = applyOpenAICompatibleDelta(delta, state, {
    thinkingEnabled: ctx.thinkingEnabled,
    parser: ctx.thinkTagParser,
  });
  if (projected.content) ctx.callbacks.onToken(projected.content);
  if (projected.reasoning) ctx.callbacks.onReasoning?.(projected.reasoning);
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

  const projected = projectOllamaStreamLine(line);
  if (projected.error) {
    streamState.streamErrorOccurred = true;
    req.callbacks.onError(new Error(projected.error));
    req.abort();
    return;
  }
  if (projected.reasoning) { streamState.fullReasoningContent += projected.reasoning; req.callbacks.onReasoning?.(projected.reasoning); }
  if (projected.content) { streamState.fullContent += projected.content; req.callbacks.onToken(projected.content); }
  // Collect tool_calls from every message (they arrive in done:false chunks)
  for (const tc of projected.toolCalls as OpenAIToolCall[]) {
    if (tc.function?.name) {
      logger.log(`[OllamaChat] tool_call: ${tc.function.name}(${typeof tc.function.arguments === 'string' ? tc.function.arguments.substring(0, 100) : JSON.stringify(tc.function.arguments).substring(0, 100)})`);
      streamState.accumulatedToolCalls.push(tc);
      }
  }

  if (projected.done) {
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

  const requestBody = ollamaChatRequest({
    model: modelId,
    messages: openaiMessages,
    reasoningWire: options.reasoningWire,
    tools: options.tools,
    temperature: options.temperature,
    topP: options.topP,
  });

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
    await createNDJSONStreamingRequest(url, { body: requestBody, headers: {}, signal }, (line) => {
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
