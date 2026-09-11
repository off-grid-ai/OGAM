/**
 * Shared types for the OpenAI-Compatible Provider
 */
import type { GenerationOptions, StreamCallbacks } from './types';
import type { RemoteTextTransport } from '@offgrid/models';

/** OpenAI chat message */
export interface OpenAIChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | OpenAIContentPart[];
  name?: string;
  tool_calls?: OpenAIToolCall[];
  tool_call_id?: string;
}

/** OpenAI content part */
interface OpenAIContentPart {
  type: 'text' | 'image_url';
  text?: string;
  image_url?: {
    url: string;
    detail?: 'auto' | 'low' | 'high';
  };
}

/** OpenAI tool call */
export interface OpenAIToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

/** OpenAI API configuration */
export interface OpenAIConfig {
  endpoint: string;
  apiKey?: string;
  transport?: RemoteTextTransport;
}

/** Mutable state for a single OpenAI streaming request */
export interface OpenAIStreamState {
  fullContent: string;
  fullReasoningContent: string;
  toolCalls: OpenAIToolCall[];
  currentToolCall: Partial<OpenAIToolCall> | null;
  completeCalled: boolean;
  streamErrorOccurred: boolean;
}

/** Request context for Ollama /api/chat streaming */
export interface OllamaChatRequest {
  options: GenerationOptions;
  callbacks: StreamCallbacks;
  signal: AbortSignal;
  endpoint: string;
  modelId: string;
  abort: () => void;
}
