/**
 * Local Provider
 *
 * Wraps the local llama.rn-based LLM service to implement the LLMProvider interface.
 * This allows the generation service to use local and remote providers uniformly.
 */

import { Message, GenerationMeta } from '../../types';
import { llmService } from '../llm';
import type {
  LLMProvider,
  ProviderType,
  ProviderCapabilities,
  GenerationOptions,
  StreamCallbacks,
} from './types';
import logger from '../../utils/logger';

/** Local provider capabilities - dynamically determined from llmService */
function getLocalCapabilities(): ProviderCapabilities {
  return {
    supportsVision: llmService.supportsVision(),
    supportsToolCalling: llmService.supportsToolCalling(),
    supportsThinking: llmService.supportsThinking(),
    maxContextLength: undefined, // Will be set when model is loaded
    providerName: 'Local (llama.cpp)',
  };
}

/**
 * Local Provider Implementation
 *
 * Delegates to the existing llmService for local inference.
 */
class LocalProvider implements LLMProvider {
  readonly id = 'local';
  readonly type: ProviderType = 'local';

  private loadedModelId: string | null = null;

  get capabilities(): ProviderCapabilities {
    return getLocalCapabilities();
  }

  async loadModel(modelId: string): Promise<void> {
    logger.log('[LocalProvider] Loading model:', modelId);

    // The modelId for local provider is the file path
    // This is handled by activeModelService which calls llmService.loadModel
    // Here we just track the loaded model ID
    this.loadedModelId = modelId;
  }

  async unloadModel(): Promise<void> {
    logger.log('[LocalProvider] Unloading model');
    await llmService.unloadModel();
    this.loadedModelId = null;
  }

  isModelLoaded(): boolean {
    return llmService.isModelLoaded();
  }

  getLoadedModelId(): string | null {
    return this.loadedModelId;
  }

  async generate(
    messages: Message[],
    options: GenerationOptions,
    callbacks: StreamCallbacks
  ): Promise<void> {
    if (!llmService.isModelLoaded()) {
      callbacks.onError(new Error('No model loaded'));
      return;
    }

    // Build generation meta for callbacks
    const buildGenerationMeta = (): GenerationMeta => {
      const { gpu, gpuBackend, gpuLayers } = llmService.getGpuInfo();
      const perf = llmService.getPerformanceStats();
      return {
        gpu,
        gpuBackend,
        gpuLayers,
        modelName: this.loadedModelId || undefined,
        tokensPerSecond: perf.lastTokensPerSecond,
        decodeTokensPerSecond: perf.lastDecodeTokensPerSecond,
        timeToFirstToken: perf.lastTimeToFirstToken,
        tokenCount: perf.lastTokenCount,
      };
    };

    try {
      // Use the tool-enabled generation path if tools are provided
      const ctx = { callbacks, buildMeta: buildGenerationMeta };
      if (options.tools && options.tools.length > 0) {
        await this.generateWithTools(messages, options, ctx);
      } else {
        await this.generateSimple(messages, options, ctx);
      }
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      callbacks.onError(err);
    }
  }

  private async generateSimple(
    messages: Message[],
    _options: GenerationOptions,
    ctx: { callbacks: StreamCallbacks; buildMeta: () => GenerationMeta }
  ): Promise<void> {
    const { callbacks, buildMeta } = ctx;
    let fullContent = '';
    let fullReasoningContent = '';

    await llmService.generateResponse(messages, {
      onStream: (data) => {
        if (data.content) {
          fullContent += data.content;
          callbacks.onToken(data.content);
        }
        if (data.reasoningContent && callbacks.onReasoning) {
          fullReasoningContent += data.reasoningContent;
          callbacks.onReasoning(data.reasoningContent);
        }
      },
      onComplete: (result) => {
        fullContent = result.content || fullContent;
        fullReasoningContent = result.reasoningContent || fullReasoningContent;

        callbacks.onComplete({
          content: fullContent,
          reasoningContent: fullReasoningContent || undefined,
          meta: buildMeta(),
        });
      },
    });
  }

  private async generateWithTools(
    messages: Message[],
    options: GenerationOptions,
    ctx: { callbacks: StreamCallbacks; buildMeta: () => GenerationMeta }
  ): Promise<void> {
    const { callbacks, buildMeta } = ctx;
    let fullContent = '';
    let fullReasoningContent = '';

    const result = await llmService.generateResponseWithTools(messages, {
      tools: options.tools || [],
      onStream: (data) => {
        if (data.content) {
          fullContent += data.content;
          callbacks.onToken(data.content);
        }
        if (data.reasoningContent && callbacks.onReasoning) {
          fullReasoningContent += data.reasoningContent;
          callbacks.onReasoning(data.reasoningContent);
        }
      },
      onComplete: () => {
        // Completion is handled in the return below
      },
    });

    fullContent = result.fullResponse;

    callbacks.onComplete({
      content: fullContent,
      reasoningContent: fullReasoningContent || undefined,
      meta: buildMeta(),
      toolCalls: result.toolCalls.map(tc => ({
        id: tc.id,
        name: tc.name,
        // Arguments from llmService are Record<string, any>, convert to JSON string
        arguments: typeof tc.arguments === 'string'
          ? tc.arguments
          : JSON.stringify(tc.arguments),
      })),
    });
  }

  async stopGeneration(): Promise<void> {
    await llmService.stopGeneration();
  }

  async getTokenCount(text: string): Promise<number> {
    if (!llmService.isModelLoaded()) {
      // Approximate token count when no model loaded
      return Math.ceil(text.length / 4);
    }
    return llmService.getTokenCount(text);
  }

  async isReady(): Promise<boolean> {
    return llmService.isModelLoaded();
  }

  async dispose(): Promise<void> {
    await llmService.unloadModel();
    this.loadedModelId = null;
  }
}

/** Singleton instance */
export const localProvider = new LocalProvider();