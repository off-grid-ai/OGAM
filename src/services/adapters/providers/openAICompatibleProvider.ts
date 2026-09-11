/**
 * OpenAI-Compatible Transport
 *
 * Performs OpenAI-compatible/Ollama streaming I/O. Shared services own model state and routing.
 */

import { Message } from '../../../types';
import type {
  TextStreamTransport,
  ProviderType,
  GenerationOptions,
  StreamCallbacks,
} from './types';
import { createStreamingRequest, parseOpenAIMessage } from '../../httpClient';
import { ThinkTagParser, processDelta, generateOllamaChatImpl } from './openAICompatibleStream';
import { buildOpenAIMessagesImpl } from './openAIMessageBuilder';
import logger from '../../../utils/logger';
import type {
  OpenAIChatMessage,
  OpenAIConfig,
  OpenAIStreamState,
} from './openAICompatibleTypes';
import {
  openAICompatibleCompletionPayload,
  remoteApiBase,
  remoteAuthorizationHeaders,
  remoteTextTransport,
} from '@offgrid/models';

export type { OpenAIChatMessage, OpenAIConfig } from './openAICompatibleTypes';

/**
 * OpenAI-compatible streaming transport implementation.
 */
export class OpenAICompatibleTransport implements TextStreamTransport {
  readonly type: ProviderType = 'openai-compatible';

  private config: OpenAIConfig & { transport: NonNullable<OpenAIConfig['transport']> };
  private abortController: AbortController | null = null;

  constructor(
    public readonly id: string,
    config: OpenAIConfig
  ) {
    this.config = {
      ...config,
      transport: config.transport ?? remoteTextTransport(config.endpoint),
    };
  }

  updateConfig(config: Partial<OpenAIConfig>): void {
    this.config = {
      ...this.config,
      ...config,
      transport: config.transport ?? (
        config.endpoint ? remoteTextTransport(config.endpoint) : this.config.transport
      ),
    };
  }

  /**
   * Build the request body for the /v1/chat/completions endpoint.
   */
  private buildRequestBody(
    modelId: string,
    openaiMessages: OpenAIChatMessage[],
    options: GenerationOptions,
  ): Record<string, unknown> {
    return openAICompatibleCompletionPayload({
      model: modelId,
      messages: openaiMessages,
      temperature: options.temperature,
      // max_tokens intentionally omitted — the remote server owns output limits.
      // A client-side cap (default 1024) silently truncates reasoning models that
      // need a larger budget for <think> blocks (Qwen3, DeepSeek-R1, etc).
      topP: options.topP,
      tools: options.tools,
      toolChoice: 'auto',
      reasoningWire: options.reasoningWire,
      stream: true,
    });
  }

  // The transport contract keeps model, messages, wire options, and stream sink explicit.
  // eslint-disable-next-line max-params
  async generate(
    modelId: string,
    messages: Message[],
    options: GenerationOptions,
    callbacks: StreamCallbacks
  ): Promise<void> {
    if (!modelId) {
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

      logger.log(`[Provider] generate — model=${modelId}, transport=${this.config.transport}, thinking=${thinkingEnabled}, tools=${options.tools?.length || 0}, messages=${openaiMessages.length}`);

      // Route Ollama through its native /api/chat which supports think: true/false
      if (this.config.transport === 'ollama-chat') {
        return generateOllamaChatImpl(openaiMessages, {
          options, callbacks, signal,
          endpoint: this.config.endpoint,
          modelId,
          abort: () => this.abortController?.abort(),
        });
      }

      const requestBody = this.buildRequestBody(modelId, openaiMessages, options);
      logger.log(`[Provider][DEBUG] OpenAI request — hasTools=${!!requestBody.tools}, toolChoice=${typeof requestBody.tool_choice === 'string' ? requestBody.tool_choice : JSON.stringify(requestBody.tool_choice) || 'none'}`);
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
      };
      Object.assign(headers, remoteAuthorizationHeaders(this.config.endpoint, this.config.apiKey));

      const url = `${remoteApiBase(this.config.endpoint)}/chat/completions`;

      const state: OpenAIStreamState = {
        fullContent: '', fullReasoningContent: '',
        toolCalls: [], currentToolCall: null,
        completeCalled: false, streamErrorOccurred: false,
      };
      const thinkTagParser = new ThinkTagParser();

      await createStreamingRequest(url, { body: requestBody, headers, signal }, (event) => {
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
          if (
            !state.completeCalled &&
            (choice.finish_reason === 'stop' ||
              choice.finish_reason === 'tool_calls')
          ) {
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
    return buildOpenAIMessagesImpl(messages, options, {
      supportsVision: true,
      supportsToolCalling: true,
      supportsThinking: true,
    });
  }

  async stopGeneration(): Promise<void> {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
  }

  async isReady(): Promise<boolean> {
    return !!this.config.endpoint;
  }

  async dispose(): Promise<void> {
    await this.stopGeneration();
  }
}

/**
 * Factory to create an OpenAI-compatible provider
 */
export function createOpenAITransport(
  serverId: string,
  endpoint: string,
  opts?: { apiKey?: string }
): OpenAICompatibleTransport {
  return new OpenAICompatibleTransport(serverId, {
    endpoint,
    apiKey: opts?.apiKey,
    transport: remoteTextTransport(endpoint),
  });
}
