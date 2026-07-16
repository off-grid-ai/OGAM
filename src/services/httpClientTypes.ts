/**
 * Parsed SSE / stream-message shapes shared by httpClient and httpClientSSE. They live here so
 * httpClientSSE can import them WITHOUT importing httpClient — httpClient imports httpClientSSE
 * (createSSELineProcessor + re-exports its parsers), so httpClientSSE importing httpClient back
 * forms a cycle. httpClient re-exports these for existing importers.
 */

/** SSE event from streaming response */
export interface SSEEvent {
  /** Event type (e.g., "message", "content_block_delta") */
  event?: string;
  /** Event data (parsed JSON or raw string) */
  data: string | Record<string, unknown>;
  /** Raw event ID if present */
  id?: string;
}

/** Parsed SSE message from OpenAI-compatible API */
export interface OpenAIStreamMessage {
  id?: string;
  object?: string;
  choices?: Array<{
    index?: number;
    delta?: {
      content?: string;
      reasoning_content?: string;
      reasoning?: string;
      thinking?: string;
      tool_calls?: Array<{
        index?: number;
        id?: string;
        type?: string;
        function?: {
          name?: string;
          arguments?: string;
        };
      }>;
    };
    finish_reason?: string | null;
  }>;
  error?: {
    message?: string;
    type?: string;
    code?: string;
  };
}

/** Parsed SSE message from Anthropic API */
export interface AnthropicStreamMessage {
  type: string;
  index?: number;
  delta?: {
    type?: string;
    text?: string;
    thinking?: string;
  };
  content_block?: {
    type?: string;
    text?: string;
    name?: string;
    input?: Record<string, unknown>;
  };
  message?: {
    id?: string;
    model?: string;
    stop_reason?: string;
  };
  error?: {
    type?: string;
    message?: string;
  };
}
