/**
 * SSE parsing utilities for httpClient
 */

import logger from '../utils/logger';
import type { SSEEvent, OpenAIStreamMessage, AnthropicStreamMessage } from './httpClient';

/**
 * Process parsed event and yield it
 */
export function yieldSSEvent(currentEvent: Partial<SSEEvent>): SSEEvent {
  return {
    event: currentEvent.event,
    data: currentEvent.data as string,
    id: currentEvent.id,
  };
}

/**
 * Parse a single SSE line into the current event
 * Returns true if an event should be yielded (empty line received)
 */
export function parseSSELine(
  trimmed: string,
  currentEvent: Partial<SSEEvent>
): boolean {
  if (!trimmed) {
    // Empty line signals end of event - caller should yield
    return currentEvent.data !== undefined;
  }

  // Parse SSE field
  if (trimmed.startsWith('event:')) {
    currentEvent.event = trimmed.slice(6).trim();
  } else if (trimmed.startsWith('data:')) {
    const dataStr = trimmed.slice(5).trim();
    // Handle multiple data lines for same event
    if (typeof currentEvent.data === 'string') {
      currentEvent.data += `\n${dataStr}`;
    } else {
      currentEvent.data = dataStr;
    }
  } else if (trimmed.startsWith('id:')) {
    currentEvent.id = trimmed.slice(3).trim();
  }
  // Ignore other fields (retry, etc.)
  return false;
}

/**
 * Create a stateful SSE line processor that buffers partial lines across chunks.
 * Used by XHR onprogress and onreadystatechange handlers.
 */
export function createSSELineProcessor(onEvent: (event: SSEEvent) => void) {
  let lineBuffer = '';
  let currentEvent: Partial<SSEEvent> = {};

  return {
    /** Process a new chunk of SSE data (may contain partial lines). */
    process(newData: string): void {
      const combined = lineBuffer + newData;
      const lines = combined.split('\n');
      // Last element may be an incomplete line — hold it for the next chunk
      lineBuffer = lines.pop() || '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (parseSSELine(trimmed, currentEvent)) {
          onEvent(yieldSSEvent(currentEvent));
          currentEvent = {};
        }
      }
    },
    /** Flush any remaining buffered data (call on stream end). */
    flush(): void {
      if (lineBuffer.trim()) {
        parseSSELine(lineBuffer.trim(), currentEvent);
        lineBuffer = '';
      }
      if (currentEvent.data !== undefined) {
        onEvent(yieldSSEvent(currentEvent));
        currentEvent = {};
      }
    },
  };
}

/**
 * Parse SSE events from a stream
 */
export async function* parseSSEStream(
  response: Response
): AsyncGenerator<SSEEvent, void, unknown> {
  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error('Response body is not readable');
  }

  const decoder = new TextDecoder();
  let buffer = '';
  let currentEvent: Partial<SSEEvent> = {};

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || ''; // Keep incomplete line in buffer

      for (const line of lines) {
        const trimmed = line.trim();
        if (parseSSELine(trimmed, currentEvent)) {
          yield yieldSSEvent(currentEvent);
          currentEvent = {};
        }
      }
    }

    // Yield any remaining event
    if (currentEvent.data !== undefined) {
      yield {
        event: currentEvent.event,
        data: currentEvent.data,
        id: currentEvent.id,
      } as SSEEvent;
    }
  } finally {
    reader.releaseLock();
  }
}

/**
 * Parse OpenAI streaming message from SSE event
 */
export function parseOpenAIMessage(event: SSEEvent): OpenAIStreamMessage | null {
  if (typeof event.data !== 'string') return null;

  const data = event.data.trim();
  if (data === '[DONE]') {
    return { object: 'done' };
  }

  try {
    return JSON.parse(data) as OpenAIStreamMessage;
  } catch {
    logger.warn('[HTTP] Failed to parse OpenAI message:', data);
    return null;
  }
}

/**
 * Parse Anthropic streaming message from SSE event
 */
export function parseAnthropicMessage(event: SSEEvent): AnthropicStreamMessage | null {
  if (typeof event.data !== 'string') return null;

  const data = event.data.trim();
  if (!data) return null;

  try {
    return JSON.parse(data) as AnthropicStreamMessage;
  } catch {
    logger.warn('[HTTP] Failed to parse Anthropic message:', data);
    return null;
  }
}
