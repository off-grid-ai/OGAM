/**
 * LLM Provider Types
 *
 * Core abstraction for all LLM providers (local and remote).
 * All providers implement this unified interface for seamless switching.
 */

import { Message, GenerationMeta } from '../../types';

/** Provider types */
export type ProviderType = 'local' | 'openai-compatible' | 'anthropic';

/** Capabilities a provider may support */
export interface ProviderCapabilities {
  /** Supports vision/image input */
  supportsVision: boolean;
  /** Supports function/tool calling */
  supportsToolCalling: boolean;
  /** Supports extended thinking/reasoning */
  supportsThinking: boolean;
  /**
   * Whether the server honors `chat_template_kwargs.enable_thinking` to toggle
   * reasoning per request. This is a TRANSPORT capability discovered from the
   * server (llama.cpp /props template exposes the switch; LM Studio confirmed it
   * via probe), not something to infer from the endpoint — so the request builder
   * gates on this flag instead of sniffing the port.
   */
  acceptsThinkingKwarg?: boolean;
  /** Maximum context window length (if known) */
  maxContextLength?: number;
  /** Provider name for display */
  providerName?: string;
}

/** Result of a generation completion */
export interface CompletionResult {
  /** Generated content */
  content: string;
  /** Reasoning/thinking content (if supported) */
  reasoningContent?: string;
  /** Generation metadata */
  meta?: GenerationMeta;
  /** Tool calls made (if any) */
  toolCalls?: ToolCallResult[];
}

/** Tool call result from generation */
interface ToolCallResult {
  /** Tool call ID */
  id?: string;
  /** Tool name */
  name: string;
  /** Tool arguments as JSON string */
  arguments: string;
}

/** Options for generation */
export interface GenerationOptions {
  /** Sampling temperature */
  temperature?: number;
  /** Maximum tokens to generate */
  maxTokens?: number;
  /** Top-p sampling */
  topP?: number;
  /** Top-k sampling */
  topK?: number;
  /** Repeat penalty */
  repeatPenalty?: number;
  /** Seed for reproducibility */
  seed?: number;
  /** System prompt override */
  systemPrompt?: string;
  /** Tools available for calling */
  tools?: ToolDefinition[];
  /** Stop sequences */
  stopSequences?: string[];
  /** Whether to enable thinking/reasoning mode (Ollama: sends "think" param; others: parsed from response) */
  enableThinking?: boolean;
}

/** Tool definition for function calling */
interface ToolDefinition {
  /** Tool type (always "function" for now) */
  type: 'function';
  /** Function definition */
  function: {
    /** Function name */
    name: string;
    /** Function description */
    description: string;
    /** Parameters schema (JSON Schema) */
    parameters: Record<string, unknown>;
  };
}

/** Callbacks for streaming generation */
export interface StreamCallbacks {
  /** Called for each token/chunk */
  onToken: (token: string) => void;
  /** Called for reasoning/thinking content */
  onReasoning?: (content: string) => void;
  /** Called when generation completes */
  onComplete: (result: CompletionResult) => void;
  /** Called on error */
  onError: (error: Error) => void;
}


/**
 * LLM Provider Interface
 *
 * All LLM providers (local and remote) implement this interface.
 * The registry uses this to route generation requests to the correct provider.
 */
export interface LLMProvider {
  /** Unique provider identifier */
  readonly id: string;
  /** Provider type */
  readonly type: ProviderType;
  /** Current capabilities */
  readonly capabilities: ProviderCapabilities;

  // Model Management

  /** Load a model for generation */
  loadModel(modelId: string): Promise<void>;

  /** Unload the current model */
  unloadModel(): Promise<void>;

  /** Check if a model is currently loaded */
  isModelLoaded(): boolean;

  /** Get the ID of the currently loaded model (if any) */
  getLoadedModelId(): string | null;

  // Generation

  /**
   * Generate a response for the given messages.
   * Streaming callbacks are used for real-time updates.
   */
  generate(
    messages: Message[],
    options: GenerationOptions,
    callbacks: StreamCallbacks
  ): Promise<void>;

  /**
   * Stop any ongoing generation.
   * Returns partial content if any was generated.
   */
  stopGeneration(): Promise<void>;

  // Utility

  /** Get token count for text (approximate for remote providers) */
  getTokenCount(text: string): Promise<number>;

  /** Check if the provider is ready for generation */
  isReady(): Promise<boolean>;

  /** Clean up resources */
  dispose?(): Promise<void>;
}

