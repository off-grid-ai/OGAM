/**
 * OpenAI-Compatible Provider
 *
 * Provider implementation for OpenAI-compatible servers (Ollama, LM Studio, etc.)
 * Handles model discovery, streaming generation, vision, and tool calling.
 */

import { Message } from '../../types';
import type {
  LLMProvider,
  ProviderType,
  ProviderCapabilities,
  GenerationOptions,
  StreamCallbacks,
} from './types';
import { createStreamingRequest, parseOpenAIMessage } from '../httpClient';
import { ThinkTagParser, processDelta, generateOllamaChatImpl } from './openAICompatibleStream';
import { buildOpenAIMessagesImpl } from './openAIMessageBuilder';
import logger from '../../utils/logger';
import type {
  OpenAIChatMessage,
  OpenAIConfig,
  OpenAIStreamState,
} from './openAICompatibleTypes';

export type { OpenAIChatMessage, OpenAIToolCall, OpenAIConfig } from './openAICompatibleTypes';

/** Returns true if the endpoint looks like an Ollama server (port 11434) */
function isOllamaEndpoint(endpoint: string): boolean {
  return endpoint.includes(':11434');
}

/**
 * OpenAI-Compatible Provider Implementation
 */
export class OpenAICompatibleProvider implements LLMProvider {
  readonly type: ProviderType = 'openai-compatible';

  private config: OpenAIConfig;
  private abortController: AbortController | null = null;
  private modelCapabilities: ProviderCapabilities;

  constructor(
    public readonly id: string,
    config: OpenAIConfig
  ) {
    this.config = config;
    this.modelCapabilities = {
      supportsVision: false,
      supportsToolCalling: true, // Assume true for OpenAI-compatible
      supportsThinking: false,
      acceptsThinkingKwarg: false, // set from discovery (/props or LM Studio probe)
    };
  }

  get capabilities(): ProviderCapabilities {
    return this.modelCapabilities;
  }

  updateConfig(config: Partial<OpenAIConfig>): void {
    this.config = { ...this.config, ...config };
  }

  async loadModel(modelId: string): Promise<void> {
    this.config.modelId = modelId;
    // Capabilities are set via updateCapabilities() after discovery results are applied
  }

  /**
   * Apply authoritative capabilities from server discovery results
   */
  updateCapabilities(capabilities: Partial<ProviderCapabilities>): void {
    this.modelCapabilities = { ...this.modelCapabilities, ...capabilities };
  }

  async unloadModel(): Promise<void> {
    this.config.modelId = '';
    this.abortController = null;
  }

  isModelLoaded(): boolean { return !!this.config.modelId; }

  getLoadedModelId(): string | null { return this.config.modelId || null; }

  /**
   * Build the request body for the /v1/chat/completions endpoint.
   */
  private buildRequestBody(
    openaiMessages: OpenAIChatMessage[],
    options: GenerationOptions,
    thinkingEnabled: boolean
  ): Record<string, unknown> {
    return {
      model: this.config.modelId,
      messages: openaiMessages,
      stream: true,
      ...(options.temperature !== undefined && { temperature: options.temperature }),
      // max_tokens intentionally omitted — the remote server owns output limits.
      // A client-side cap (default 1024) silently truncates reasoning models that
      // need a larger budget for <think> blocks (Qwen3, DeepSeek-R1, etc).
      ...(options.topP !== undefined && { top_p: options.topP }),
      ...(options.tools && options.tools.length > 0 && { tools: options.tools, tool_choice: 'auto' }),
      // Control Qwen3 thinking per-request via chat_template_kwargs, but only for
      // servers that advertised (at discovery) that they honor it. Gating on a
      // discovered capability — not the endpoint's port — keeps the "which server
      // accepts this?" decision in one place and free of implementation coupling.
      ...(this.modelCapabilities.acceptsThinkingKwarg && { chat_template_kwargs: { enable_thinking: thinkingEnabled } }),
    };
  }

  async generate(
    messages: Message[],
    options: GenerationOptions,
    callbacks: StreamCallbacks
  ): Promise<void> {
    if (!this.config.modelId) {
      callbacks.onError(new Error('No model selected'));
      return;
    }

    this.abortController = new AbortController();
    // Capture signal in closure so abort checks remain valid even after
    // this.abortController is nulled by stopGeneration().
    const { signal } = this.abortController;

    try {
      const openaiMessages = await this.buildOpenAIMessages(messages, options);
      const thinkingEnabled = options.enableThinking !== false;

      logger.log(`[Provider] generate — model=${this.config.modelId}, isOllama=${isOllamaEndpoint(this.config.endpoint)}, thinking=${thinkingEnabled}, tools=${options.tools?.length || 0}, messages=${openaiMessages.length}`);

      // Route Ollama through its native /api/chat which supports think: true/false
      if (isOllamaEndpoint(this.config.endpoint)) {
        return generateOllamaChatImpl(openaiMessages, {
          options, callbacks, signal,
          endpoint: this.config.endpoint,
          modelId: this.config.modelId,
          abort: () => this.abortController?.abort(),
        });
      }

      const requestBody = this.buildRequestBody(openaiMessages, options, thinkingEnabled);
      logger.log(`[Provider][DEBUG] OpenAI request — hasTools=${!!requestBody.tools}, toolChoice=${typeof requestBody.tool_choice === 'string' ? requestBody.tool_choice : JSON.stringify(requestBody.tool_choice) || 'none'}`);
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
      };
      if (this.config.apiKey) {
        headers.Authorization = `Bearer ${this.config.apiKey}`;
      }

      let baseUrl = this.config.endpoint;
      while (baseUrl.endsWith('/')) baseUrl = baseUrl.slice(0, -1);
      const url = `${baseUrl}/v1/chat/completions`;

      const state: OpenAIStreamState = {
        fullContent: '', fullReasoningContent: '',
        toolCalls: [], currentToolCall: null,
        completeCalled: false, streamErrorOccurred: false,
      };
      const thinkTagParser = new ThinkTagParser();

      await createStreamingRequest(url, { body: requestBody, headers, timeout: 300000, signal }, (event) => {
        if (signal.aborted) return;
        const message = parseOpenAIMessage(event);
        if (!message) return;

        if (message.error) {
          logger.error(`[Provider][DEBUG] Stream error: ${JSON.stringify(message.error)}`);
          state.streamErrorOccurred = true;
          callbacks.onError(new Error(message.error.message || 'API error'));
          this.abortController?.abort();
          return;
        }
        if (message.object === 'done') return;

        if (message.choices && message.choices.length > 0) {
          const choice = message.choices[0];
          if (choice.delta) {
            processDelta(choice.delta, state, { thinkingEnabled, callbacks, thinkTagParser });
          }
          if (choice.finish_reason) {
            logger.log(`[Provider][DEBUG] finish_reason=${choice.finish_reason}, fullContent=${state.fullContent.length}, reasoning=${state.fullReasoningContent.length}, toolCalls=${state.toolCalls.length}`);
          }
          if (choice.finish_reason === 'stop' || choice.finish_reason === 'tool_calls') {
            state.completeCalled = true;
            const completedCalls = state.toolCalls.filter(tc => tc.function?.name);
            logger.log(`[Provider][DEBUG] Completing — content=${state.fullContent.length} chars, reasoning=${state.fullReasoningContent.length} chars, completedCalls=${completedCalls.length}`);
            callbacks.onComplete({
              content: state.fullContent,
              reasoningContent: state.fullReasoningContent || undefined,
              meta: { gpu: false, gpuBackend: 'Remote' },
              toolCalls: completedCalls.length > 0 ? completedCalls.map(tc => ({
                id: tc.id, name: tc.function.name, arguments: tc.function.arguments,
              })) : undefined,
            });
          }
        }
      });

      // Fallback: if stream ended without a recognised finish_reason (e.g. 'length',
      // 'content_filter', null), ensure the generation is finalised.
      if (!state.completeCalled && !state.streamErrorOccurred) {
        logger.log(`[Provider][DEBUG] Fallback complete (no finish_reason) — content=${state.fullContent.length}, reasoning=${state.fullReasoningContent.length}, toolCalls=${state.toolCalls.length}`);
        const completedCalls = state.toolCalls.filter(tc => tc.function?.name);
        callbacks.onComplete({
          content: state.fullContent,
          reasoningContent: state.fullReasoningContent || undefined,
          meta: { gpu: false, gpuBackend: 'Remote' },
          toolCalls: completedCalls.length > 0 ? completedCalls.map(tc => ({
            id: tc.id, name: tc.function.name, arguments: tc.function.arguments,
          })) : undefined,
        });
      }
    } catch (error) {
      if (signal.aborted) {
        callbacks.onComplete({ content: '', meta: { gpu: false } });
        return;
      }
      callbacks.onError(error instanceof Error ? error : new Error(String(error)));
    } finally {
      this.abortController = null;
    }
  }

  private buildOpenAIMessages(
    messages: Message[],
    options: GenerationOptions
  ): Promise<OpenAIChatMessage[]> {
    return buildOpenAIMessagesImpl(messages, options, this.modelCapabilities);
  }

  async stopGeneration(): Promise<void> {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
  }

  async getTokenCount(text: string): Promise<number> {
    // Approximate token count for remote providers
    // Most models use ~4 characters per token
    return Math.ceil(text.length / 4);
  }

  async isReady(): Promise<boolean> {
    return !!this.config.modelId && !!this.config.endpoint;
  }

  async dispose(): Promise<void> {
    await this.stopGeneration();
    this.config.modelId = '';
  }
}

/**
 * Factory to create an OpenAI-compatible provider
 */
export function createOpenAIProvider(
  serverId: string,
  endpoint: string,
  opts?: { apiKey?: string; modelId?: string }
): OpenAICompatibleProvider {
  return new OpenAICompatibleProvider(serverId, {
    endpoint,
    apiKey: opts?.apiKey,
    modelId: opts?.modelId || '',
  });
}
