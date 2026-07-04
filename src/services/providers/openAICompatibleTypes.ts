/**
 * Shared types for the OpenAI-Compatible Provider
 */
import type { GenerationOptions, StreamCallbacks } from './types';

/**
 * Whether a request body should carry a `tools` payload: only when the model advertised
 * tool-calling AND the caller actually passed tools. Defined once and used by BOTH the
 * OpenAI (/v1/chat/completions) and Ollama (/api/chat) request builders so the gate can't
 * drift between the two paths.
 */
export function shouldIncludeTools(
  supportsToolCalling: boolean,
  tools: GenerationOptions['tools'],
): boolean {
  return !!supportsToolCalling && !!tools && tools.length > 0;
}

/** OpenAI chat message */
export interface OpenAIChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | OpenAIContentPart[];
  name?: string;
  tool_calls?: OpenAIToolCall[];
  tool_call_id?: string;
}

/** OpenAI content part */
export interface OpenAIContentPart {
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
  modelId: string;
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
  /** Discovered tool-calling capability. When false, tools are omitted from the
   *  request body (a non-tool-calling model 400s or ignores a tools payload). */
  supportsToolCalling: boolean;
}
