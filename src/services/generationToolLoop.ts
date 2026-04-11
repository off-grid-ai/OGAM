/** Tool-calling generation loop. Extracted to keep generationService.ts under the max-lines limit. */
import { llmService } from './llm';
import type { StreamToken } from './llm';
import { useChatStore, useRemoteServerStore, useAppStore } from '../stores';
import { Message } from '../types';
import { getToolsAsOpenAISchema, executeToolCall } from './tools';
import type { ToolCall, ToolResult } from './tools/types';
import { providerRegistry } from './providers';
import type { GenerationOptions, CompletionResult } from './providers/types';
import logger from '../utils/logger';
const MAX_TOOL_ITERATIONS = 3;
const MAX_TOTAL_TOOL_CALLS = 5;
type StreamChunk = string | StreamToken;
function parseXmlStyleToolCall(body: string, idSuffix: number): ToolCall | null {
  const funcMatch = body.match(/<function=(\w+)>/);
  if (!funcMatch) return null;
  const name = funcMatch[1];
  const args: Record<string, any> = {};
  const paramPattern = /<parameter=(\w+)>([\s\S]*?)(?=<parameter=|<\/|$)/g;
  let pm;
  while ((pm = paramPattern.exec(body)) !== null) { args[pm[1]] = pm[2].trim(); }
  return { id: `text-tc-${Date.now()}-${idSuffix}`, name, arguments: args };
}

function parseToolCallBody(body: string, idSuffix: number): ToolCall | null {
  try {
    const parsed = JSON.parse(body);
    if (parsed.name) return { id: `text-tc-${Date.now()}-${idSuffix}`, name: parsed.name, arguments: parsed.arguments || parsed.parameters || {} };
  } catch { /* Not JSON — fall through to XML */ }
  return parseXmlStyleToolCall(body, idSuffix);
}
/** Parse <invoke name="fn"><parameter name="k">v</parameter></invoke> blocks (minimax, Anthropic-style). */
function parseInvokeBlocks(text: string, toolCalls: ToolCall[], matchedRanges: [number, number][]): void {
  const invokePattern = /<invoke\s+name="([^"]+)">([\s\S]*?)<\/invoke>/g;
  let match;
  while ((match = invokePattern.exec(text)) !== null) {
    const name = match[1];
    const args: Record<string, any> = {};
    const paramPattern = /<parameter\s+name="([^"]+)">([\s\S]*?)<\/parameter>/g;
    let pm;
    while ((pm = paramPattern.exec(match[2])) !== null) { args[pm[1]] = pm[2].trim(); }
    toolCalls.push({ id: `text-tc-${Date.now()}-${toolCalls.length}`, name, arguments: args });
    matchedRanges.push([match.index, match.index + match[0].length]);
  }
}

/** Parse tool calls from text output (fallback for small models). Supports JSON, XML, and invoke formats. */
export function parseToolCallsFromText(text: string): { cleanText: string; toolCalls: ToolCall[] } {
  const toolCalls: ToolCall[] = [];
  const matchedRanges: [number, number][] = [];

  // 1. Standard <tool_call>...</tool_call> blocks (JSON or XML body)
  const closedPattern = /<tool_call>([\s\S]*?)<\/tool_call>/g;
  let match;
  while ((match = closedPattern.exec(text)) !== null) {
    matchedRanges.push([match.index, match.index + match[0].length]);
    const call = parseToolCallBody(match[1].trim(), toolCalls.length);
    if (call) { toolCalls.push(call); }
    else { logger.log(`[ToolLoop] Failed to parse tool_call tag: ${match[1].trim().substring(0, 100)}`); }
  }
  // Unclosed <tool_call> at end of text (model hit EOS without closing tag)
  const unclosedMatch = /<tool_call>([\s\S]+)$/.exec(text);
  if (unclosedMatch) {
    const unclosedStart = text.lastIndexOf(unclosedMatch[0]);
    const alreadyMatched = matchedRanges.some(([s, e]) => unclosedStart >= s && unclosedStart < e);
    if (!alreadyMatched) {
      const call = parseToolCallBody(unclosedMatch[1].trim(), toolCalls.length);
      if (call) toolCalls.push(call);
      matchedRanges.push([unclosedStart, text.length]);
    }
  }

  // 2. <invoke name="...">...</invoke> blocks (minimax, Anthropic-style)
  parseInvokeBlocks(text, toolCalls, matchedRanges);

  // 3. Namespaced wrapper blocks: namespace:tool_call ... </namespace:tool_call>
  const nsPattern = /[\w]+:tool_call[\s\S]*?<\/[\w]+:tool_call>/g;
  while ((match = nsPattern.exec(text)) !== null) {
    const alreadyMatched = matchedRanges.some(([s, e]) => match!.index >= s && match!.index < e);
    if (!alreadyMatched) {
      // Parse invoke blocks within this namespace wrapper
      parseInvokeBlocks(match[0], toolCalls, []);
      matchedRanges.push([match.index, match.index + match[0].length]);
    }
  }

  // Remove all matched ranges from text (reverse order to preserve indices)
  matchedRanges.sort((a, b) => b[0] - a[0]);
  let cleanText = text;
  for (const [start, end] of matchedRanges) { cleanText = cleanText.slice(0, start) + cleanText.slice(end); }
  return { cleanText: cleanText.trim(), toolCalls };
}
export interface ToolLoopCallbacks {
  onToolCallStart?: (name: string, args: Record<string, any>) => void;
  onToolCallComplete?: (name: string, result: ToolResult) => void;
  onFirstToken?: () => void;
}
export interface ToolLoopContext {
  conversationId: string;
  messages: Message[];
  enabledToolIds: string[];
  projectId?: string;
  callbacks?: ToolLoopCallbacks;
  isAborted: () => boolean;
  onThinkingDone: () => void;
  onStream?: (data: StreamChunk) => void;
  onStreamReset?: () => void;
  onFinalResponse: (content: string) => void;
  forceRemote?: boolean;
}
function normalizeStreamChunk(data: StreamChunk): StreamToken {
  return typeof data === 'string' ? { content: data } : data;
}
function getLastUserQuery(messages: Message[]): string {
  for (let i = messages.length - 1; i >= 0; i--)
    if (messages[i].role === 'user' && messages[i].content.trim()) return messages[i].content.trim();
  return '';
}
async function executeToolCalls(ctx: ToolLoopContext, toolCalls: import('./tools/types').ToolCall[], loopMessages: Message[]): Promise<void> {
  const chatStore = useChatStore.getState();
  for (const tc of toolCalls) {
    if (ctx.isAborted()) break;
    // Small models often call web_search with empty args — use user's message as fallback
    if (tc.name === 'web_search' && (!tc.arguments.query || typeof tc.arguments.query !== 'string' || !tc.arguments.query.trim())) {
      const fallbackQuery = getLastUserQuery(loopMessages);
      if (fallbackQuery) {
        logger.log(`[ToolLoop] web_search called with empty query, using user message: "${fallbackQuery.substring(0, 80)}"`);
        tc.arguments = { ...tc.arguments, query: fallbackQuery };
      }
    }
    logger.log(`[ToolLoop][DEBUG] Executing tool: ${tc.name}, args: ${JSON.stringify(tc.arguments).substring(0, 200)}`);
    if (ctx.projectId) tc.context = { projectId: ctx.projectId };
    ctx.callbacks?.onToolCallStart?.(tc.name, tc.arguments);
    const result = await executeToolCall(tc);
    logger.log(`[ToolLoop][DEBUG] Tool ${tc.name} result: error=${result.error || 'none'}, content length=${result.content?.length || 0}, duration=${result.durationMs}ms`);
    ctx.callbacks?.onToolCallComplete?.(tc.name, result);
    const toolResultMsg: Message = {
      id: `tool-result-${Date.now()}-${tc.id || tc.name}`, role: 'tool',
      content: result.error ? `Error: ${result.error}` : result.content, timestamp: Date.now(),
      toolCallId: tc.id, toolName: tc.name, generationTimeMs: result.durationMs,
    };
    loopMessages.push(toolResultMsg);
    chatStore.addMessage(ctx.conversationId, toolResultMsg);
  }
}
const MAX_LLM_RETRIES = 4;
const RETRY_BACKOFF_MS = 1000;
const CONTEXT_RELEASE_PAUSE_MS = 500;
function isNonRetryableError(msg: string): boolean {
  return msg.includes('No model loaded') || msg.includes('aborted') || msg.includes('Remote provider');
}
/** Call remote LLM provider with tools */
async function callRemoteLLMWithTools(
  messages: Message[], tools: any[],
  opts?: { onStream?: (data: StreamToken) => void; disableThinking?: boolean },
): Promise<{ fullResponse: string; toolCalls: ToolCall[] }> {
  const activeServerId = useRemoteServerStore.getState().activeServerId;
  if (!activeServerId) throw new Error('No remote provider active');
  const provider = providerRegistry.getProvider(activeServerId);
  if (!provider) throw new Error('Remote provider not found');
  const settings = useAppStore.getState().settings;
  const thinkingEnabled = !opts?.disableThinking && settings.thinkingEnabled && provider.capabilities.supportsThinking;
  const options: GenerationOptions = {
    temperature: settings.temperature, maxTokens: settings.maxTokens, topP: settings.topP,
    tools, enableThinking: thinkingEnabled,
  };
  logger.log(`[ToolLoop] callRemoteLLM — server=${activeServerId}, tools=${tools.length}, thinking=${thinkingEnabled}`);
  let _fullContent = '';
  let toolCalls: ToolCall[] = [];
  const onStream = opts?.onStream;
  return new Promise((resolve, reject) => {
    provider.generate(messages, options, {
      onToken: (token: string) => {
        _fullContent += token;
        onStream?.({ content: token });
      },
      onReasoning: (content: string) => {
        onStream?.({ reasoningContent: content });
      },
      onComplete: (result: CompletionResult) => {
        logger.log(`[ToolLoop] onComplete — content=${result.content?.length || 0}, toolCalls=${result.toolCalls?.length || 0}`);
        if (result.toolCalls && result.toolCalls.length > 0) {
          toolCalls = result.toolCalls.map(tc => ({
            id: tc.id || `call-${Date.now()}`,
            name: tc.name,
            arguments: typeof tc.arguments === 'string'
              ? JSON.parse(tc.arguments) as Record<string, any>
              : tc.arguments,
          }));
        }
        resolve({ fullResponse: result.content, toolCalls });
      },
      onError: (error: Error) => {
        logger.error(`[ToolLoop] onError — ${error.message}`);
        reject(error);
      },
    });
  });
}

async function callLocalWithRetry(
  messages: Message[],
  tools: any[],
  onStream?: (data: StreamToken) => void,
): Promise<{ fullResponse: string; toolCalls: ToolCall[] }> {
  let lastError: any;
  for (let attempt = 0; attempt < MAX_LLM_RETRIES; attempt++) {
    try {
      return await llmService.generateResponseWithTools(messages, { tools, onStream });
    } catch (e: any) {
      lastError = e;
      const msg = e?.message || String(e) || '';
      if (isNonRetryableError(msg) || attempt >= MAX_LLM_RETRIES - 1) break;
      logger.log(`[ToolLoop] Error: "${msg.substring(0, 120) || '(no message)'}", stopping context and retrying (attempt ${attempt + 1}/${MAX_LLM_RETRIES})`);
      await llmService.stopGeneration().catch(() => { });
      await new Promise<void>(resolve => setTimeout(resolve, (attempt + 1) * RETRY_BACKOFF_MS));
    }
  }
  throw new Error(lastError?.message || String(lastError) || 'Unknown LLM error after tool execution');
}

interface CallLLMOptions { onStream?: (data: StreamToken) => void; forceRemote?: boolean; disableThinking?: boolean; }

/** Call LLM with retry+backoff for transient native context errors. */
async function callLLMWithRetry(
  messages: Message[],
  tools: any[],
  { onStream, forceRemote, disableThinking }: CallLLMOptions = {},
): Promise<{ fullResponse: string; toolCalls: ToolCall[] }> {
  const activeServerId = useRemoteServerStore.getState().activeServerId;
  const useRemote = forceRemote || (!!activeServerId && providerRegistry.hasProvider(activeServerId) && !llmService.isModelLoaded());
  logger.log(`[ToolLoop] callLLM — remote=${useRemote}, tools=${tools.length}`);
  if (useRemote) {
    try { return await callRemoteLLMWithTools(messages, tools, { onStream, disableThinking }); }
    catch (e: any) { throw new Error(e?.message || String(e) || 'Remote LLM error'); }
  }
  // disableThinking is not forwarded to local — local llama.rn controls thinking
  // internally and doesn't count thinking tokens against num_predict.
  return callLocalWithRetry(messages, tools, onStream);
}

/** Detect if text contains any tool call pattern (various model formats). */
function containsToolCallMarkup(text: string): boolean {
  return text.includes('<tool_call>') ||
    text.includes('<invoke') ||
    /\w+:tool_call/.test(text) ||
    text.includes('<function_call>');
}

/** If no structured tool calls, try parsing tool call markup from text. */
function resolveToolCalls(fullResponse: string, toolCalls: ToolCall[]) {
  if (toolCalls.length > 0 || !containsToolCallMarkup(fullResponse))
    return { effectiveToolCalls: toolCalls, displayResponse: fullResponse };
  const parsed = parseToolCallsFromText(fullResponse);
  if (parsed.toolCalls.length > 0) {
    logger.log(`[ToolLoop] Parsed ${parsed.toolCalls.length} tool call(s) from text output`);
    return { effectiveToolCalls: parsed.toolCalls, displayResponse: parsed.cleanText };
  }
  return { effectiveToolCalls: toolCalls, displayResponse: fullResponse };
}

interface ToolLoopState {
  firstTokenFired: boolean;
  thinkingDoneFired: boolean;
  streamedContent: string;
  reasoningContent: string;
}

function buildStreamHandler(ctx: ToolLoopContext, state: ToolLoopState): ((data: StreamChunk) => void) | undefined {
  if (!ctx.onStream) return undefined;
  return (data: StreamChunk) => {
    if (ctx.isAborted()) return;
    const chunk = normalizeStreamChunk(data);
    if (!state.firstTokenFired) {
      state.firstTokenFired = true;
      state.thinkingDoneFired = true;
      ctx.onThinkingDone();
      ctx.callbacks?.onFirstToken?.();
    }
    if (chunk.content) state.streamedContent += chunk.content;
    if (chunk.reasoningContent) state.reasoningContent += chunk.reasoningContent;
    ctx.onStream!(data);
  };
}

function emitFinalResponse(ctx: ToolLoopContext, state: ToolLoopState, displayResponse: string): void {
  if (state.streamedContent) {
    logger.log(`[ToolLoop][DEBUG] emitFinalResponse — already streamed (${state.streamedContent.length} chars), skipping`);
  } else {
    // Guard: only fire onThinkingDone/onFirstToken if not already fired (e.g. by reasoning-only first call)
    if (!state.thinkingDoneFired) {
      ctx.onThinkingDone();
      ctx.callbacks?.onFirstToken?.();
    }
    ctx.onFinalResponse(displayResponse || '_(No response)_');
  }
}

/** Force a final text-only generation (no tools) when iteration/call caps are hit. */
async function forceFinalTextResponse(ctx: ToolLoopContext, state: ToolLoopState, loopMessages: Message[]): Promise<void> {
  logger.log(`[ToolLoop] Hit cap — forcing final text response`);
  state.streamedContent = '';
  state.reasoningContent = '';
  state.firstTokenFired = false;
  const forcedOnStream = buildStreamHandler(ctx, state);
  // Disable thinking so the model spends all tokens on actual content
  const { fullResponse: forcedResponse } = await callLLMWithRetry(loopMessages, [], { onStream: forcedOnStream, forceRemote: ctx.forceRemote, disableThinking: true });
  logger.log(`[ToolLoop][DEBUG] Forced response — length=${forcedResponse.length}, streamedContent=${state.streamedContent.length}, reasoning=${state.reasoningContent.length}`);
  emitFinalResponse(ctx, state, forcedResponse);
}

/**
 * Run the tool-calling loop: call LLM → execute tools → re-inject results → repeat.
 * Returns when the model produces a final response with no tool calls.
 */
export async function runToolLoop(ctx: ToolLoopContext): Promise<void> {
  const chatStore = useChatStore.getState();
  const toolSchemas = getToolsAsOpenAISchema(ctx.enabledToolIds);
  const loopMessages = [...ctx.messages];
  let totalToolCalls = 0;
  const state: ToolLoopState = { firstTokenFired: false, thinkingDoneFired: false, streamedContent: '', reasoningContent: '' };

  logger.log(`[ToolLoop][DEBUG] === runToolLoop START === enabledToolIds=[${ctx.enabledToolIds.join(', ')}], toolSchemas=${toolSchemas.length}, messages=${ctx.messages.length}, forceRemote=${ctx.forceRemote}`);

  for (let iteration = 0; iteration < MAX_TOOL_ITERATIONS; iteration++) {
    if (ctx.isAborted()) {
      logger.log(`[ToolLoop][DEBUG] Aborted at iteration ${iteration}`);
      break;
    }

    // Hit iteration or total-call cap — force one final text-only generation (no tools)
    if (iteration === MAX_TOOL_ITERATIONS - 1 || totalToolCalls >= MAX_TOTAL_TOOL_CALLS) {
      await forceFinalTextResponse(ctx, state, loopMessages);
      return;
    }

    state.streamedContent = '';
    state.reasoningContent = '';
    logger.log(`[ToolLoop][DEBUG] === Iteration ${iteration} === messages=${loopMessages.length}, tools=${toolSchemas.length}, totalCalls=${totalToolCalls}`);

    const onStream = buildStreamHandler(ctx, state);
    const { fullResponse, toolCalls } = await callLLMWithRetry(loopMessages, toolSchemas, { onStream, forceRemote: ctx.forceRemote });

    logger.log(`[ToolLoop][DEBUG] LLM returned — response=${fullResponse.length}, toolCalls=${toolCalls.length}, streamed=${state.streamedContent.length}, reasoning=${state.reasoningContent.length}`);
    if (fullResponse.length === 0 && state.streamedContent.length === 0) {
      logger.log(`[ToolLoop][DEBUG] *** EMPTY RESPONSE *** reasoning=${state.reasoningContent.length}: "${state.reasoningContent.substring(0, 200)}"`);
    }
    const { effectiveToolCalls, displayResponse } = resolveToolCalls(fullResponse, toolCalls);
    const cappedToolCalls = effectiveToolCalls.slice(0, MAX_TOTAL_TOOL_CALLS - totalToolCalls);
    totalToolCalls += cappedToolCalls.length;

    logger.log(`[ToolLoop][DEBUG] After resolve — toolCalls=${cappedToolCalls.length}, displayResponse=${displayResponse.length}`);
    // No tool calls → model gave a final text response
    if (cappedToolCalls.length === 0) {
      // Empty response with tools — retry once without tools (some models choke on tool schemas)
      if (!state.streamedContent && !displayResponse) {
        logger.log(`[ToolLoop][DEBUG] *** EMPTY RESPONSE WITH TOOLS — retrying WITHOUT tools ***`);
        state.streamedContent = '';
        state.reasoningContent = '';
        state.firstTokenFired = false;
        const fallbackOnStream = buildStreamHandler(ctx, state);
        const { fullResponse: fallbackResp } = await callLLMWithRetry(
          loopMessages, [], { onStream: fallbackOnStream, forceRemote: ctx.forceRemote, disableThinking: true },
        );
        emitFinalResponse(ctx, state, fallbackResp);
        return;
      }
      emitFinalResponse(ctx, state, displayResponse);
      return;
    }

    // Execute the tool calls
    logger.log(`[ToolLoop][DEBUG] Executing ${cappedToolCalls.length} tool calls: ${cappedToolCalls.map(tc => tc.name).join(', ')}`);
    if (state.streamedContent) { ctx.onStreamReset?.(); chatStore.setStreamingMessage(''); }

    const assistantMsg: Message = {
      id: `tool-assist-${Date.now()}-${iteration}`, role: 'assistant',
      content: displayResponse || state.streamedContent || '', timestamp: Date.now(),
      toolCalls: cappedToolCalls.map(tc => ({ id: tc.id, name: tc.name, arguments: JSON.stringify(tc.arguments) })),
    };
    loopMessages.push(assistantMsg);
    chatStore.addMessage(ctx.conversationId, assistantMsg);

    await executeToolCalls(ctx, cappedToolCalls, loopMessages);

    chatStore.setIsThinking(true);
    await new Promise<void>(resolve => setTimeout(resolve, CONTEXT_RELEASE_PAUSE_MS));
  }
  logger.log(`[ToolLoop][DEBUG] === runToolLoop END ===`);
}
