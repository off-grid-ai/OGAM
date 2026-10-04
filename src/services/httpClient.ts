import { remoteErrorBodyMessage } from '@offgrid/models';
/**
 * HTTP Client for Remote LLM Servers
 *
 * Handles HTTP requests and Server-Sent Events (SSE) parsing for
 * communicating with OpenAI-compatible and Anthropic-compatible servers.
 */

import logger from '../utils/logger';
import { createSSELineProcessor } from './httpClientSSE';
import { isCredentialTransportDowngrade } from '@offgrid/models';

export {
  parseOpenAIMessage,
  parseAnthropicMessage,
  parseSSEStream,
} from './httpClientSSE';
export {
  imageToBase64DataUrl,
  isPrivateNetworkEndpoint,
} from './httpClientUtils';
// The stream-message types live in httpClientTypes so httpClientSSE can import them without
// importing this file (which imports SSE) — that would be a cycle. Imported for internal use here
// and re-exported for back-compat.
import type { SSEEvent } from './httpClientTypes';
export type { SSEEvent };

/** Options for fetch with timeout */
export interface FetchOptions extends RequestInit {
  /** Connection timeout in milliseconds */
  timeout?: number;
  /** Retry count for failed requests */
  retries?: number;
  /** Delay between retries in milliseconds */
  retryDelay?: number;
}

/** Optional config for streaming requests */
interface StreamRequestOptions {
  headers?: Record<string, string>;
  timeout?: number;
  signal?: AbortSignal;
}

/** Request config for streaming requests (body + options) */
export interface StreamRequestConfig extends StreamRequestOptions {
  body: unknown;
}

const INSECURE_CREDENTIAL_REDIRECT =
  'Remote server redirected credentials to an insecure endpoint';

function rejectCredentialDowngrade(input: {
  xhr: XMLHttpRequest;
  requestUrl: string;
  hasAuthorization: boolean;
  reject: (reason?: unknown) => void;
}): boolean {
  const { xhr, requestUrl, hasAuthorization, reject } = input;
  if (
    !isCredentialTransportDowngrade(
      requestUrl,
      xhr.responseURL,
      hasAuthorization,
    )
  ) {
    return false;
  }
  xhr.abort();
  reject(new Error(INSECURE_CREDENTIAL_REDIRECT));
  return true;
}

/** Default timeouts */
const DEFAULT_TIMEOUT = 30000; // 30 seconds
const DEFAULT_RETRIES = 0;
const DEFAULT_RETRY_DELAY = 1000; // 1 second

/**
 * Fetch with timeout and retry support
 */
export async function fetchWithTimeout<T = unknown>(
  url: string,
  options: FetchOptions = {},
): Promise<T> {
  const {
    timeout = DEFAULT_TIMEOUT,
    retries = DEFAULT_RETRIES,
    retryDelay = DEFAULT_RETRY_DELAY,
    ...fetchOptions
  } = options;

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      const response = await fetch(url, {
        ...fetchOptions,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text().catch(() => 'Unknown error');
        throw new Error(`HTTP ${response.status}: ${errorText}`);
      }

      // Try to parse as JSON, fall back to text
      const contentType = response.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        return response.json() as Promise<T>;
      }
      return response.text() as Promise<T>;
    } catch (error) {
      clearTimeout(timeoutId);
      lastError = error instanceof Error ? error : new Error(String(error));

      // Don't retry on abort (user cancelled)
      if ((error as Error).name === 'AbortError') {
        throw new Error('Request cancelled');
      }

      // Retry on network errors
      if (attempt < retries) {
        logger.log(
          `[HTTP] Retry ${attempt + 1}/${retries} after error: ${
            lastError.message
          }`,
        );
        await new Promise(resolve => setTimeout(resolve, retryDelay));
      }
    }
  }

  throw lastError || new Error('Request failed');
}

/**
 * Create a streaming request with SSE handling
 * Uses XMLHttpRequest for React Native compatibility with real-time streaming
 */
export async function createStreamingRequest(
  url: string,
  req: StreamRequestConfig,
  onEvent: (event: SSEEvent) => void,
): Promise<void> {
  const { body, headers = {}, timeout = 0, signal } = req;
  logger.log('[HttpClient] Creating streaming request to:', url);
  return new Promise((resolve, reject) => {
    // XMLHttpRequest is required for SSE streaming in React Native as fetch
    // does not support real-time streaming with progress events.
    // Requests are validated by isPrivateNetworkEndpoint before use.
    const xhr = new XMLHttpRequest(); // NOSONAR

    if (signal) {
      signal.addEventListener('abort', () => {
        xhr.abort();
        resolve();
      });
    }

    const timeoutId = timeout > 0 ? setTimeout(() => {
      xhr.abort();
      reject(new Error('Request timeout'));
    }, timeout) : undefined;

    xhr.open('POST', url, true);
    xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.setRequestHeader('Accept', 'text/event-stream');
    Object.entries(headers).forEach(([key, value]) => {
      xhr.setRequestHeader(key, value);
    });

    // Track processed length for incremental parsing
    let processedLength = 0;
    const sseProcessor = createSSELineProcessor(onEvent);

    xhr.onreadystatechange = () => {
      if (xhr.readyState === 4) {
        clearTimeout(timeoutId);
        // React Native strips Authorization on redirects in both native clients:
        // iOS rebuilds redirect headers in RCTHTTPRequestHandler; Android OkHttp
        // removes Authorization when the URL cannot reuse the connection. Reject
        // the downgraded response as well, so no result can arrive over cleartext.
        if (
          rejectCredentialDowngrade({
            xhr,
            requestUrl: url,
            hasAuthorization: 'Authorization' in headers,
            reject,
          })
        )
          return;
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            // Process any remaining data
            const responseText = xhr.responseText;
            if (responseText.length > processedLength) {
              const newData = responseText.slice(processedLength);
              processedLength = responseText.length;
              sseProcessor.process(newData);
            }
            sseProcessor.flush();
            resolve();
          } catch (err) {
            reject(err);
          }
        } else {
          // Log the full server error body — a bare "HTTP 400" is undiagnosable; the body
          // (e.g. llama.cpp's "failed to parse grammar") is what tells you what to fix.
          logger.error(
            `[HttpClient] HTTP ${xhr.status} error body: ${
              xhr.responseText || '(empty)'
            }`,
          );
          reject(
            new Error(
              remoteErrorBodyMessage(xhr.responseText ?? '', xhr.status),
            ),
          );
        }
      }
    };

    // Handle progress events for real-time streaming
    xhr.onprogress = () => {
      if (
        rejectCredentialDowngrade({
          xhr,
          requestUrl: url,
          hasAuthorization: 'Authorization' in headers,
          reject,
        })
      ) {
        clearTimeout(timeoutId);
        return;
      }
      const responseText = xhr.responseText;
      if (responseText.length > processedLength) {
        const newData = responseText.slice(processedLength);
        processedLength = responseText.length;
        sseProcessor.process(newData);
      }
    };

    xhr.onerror = () => {
      clearTimeout(timeoutId);
      reject(new Error('Network error'));
    };

    xhr.ontimeout = () => {
      clearTimeout(timeoutId);
      reject(new Error('Request timeout'));
    };

    try {
      const bodyStr = JSON.stringify(body);
      logger.log('[HttpClient] Sending request body, length:', bodyStr.length);
      xhr.send(bodyStr);
    } catch (err) {
      clearTimeout(timeoutId);
      logger.error('[HttpClient] Error sending request:', err);
      reject(err);
    }
  });
}

/**
 * Stream NDJSON responses (Ollama /api/chat format).
 * Each line is a complete JSON object — no SSE "data:" prefix.
 */
export async function createNDJSONStreamingRequest(
  url: string,
  req: StreamRequestConfig,
  onLine: (parsed: Record<string, unknown>) => void,
): Promise<void> {
  const { body, headers = {}, timeout = 0, signal } = req;
  logger.log('[HttpClient] Creating NDJSON streaming request to:', url);
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest(); // NOSONAR

    if (signal) {
      signal.addEventListener('abort', () => {
        xhr.abort();
        resolve();
      });
    }

    const timeoutId = timeout > 0 ? setTimeout(() => {
      xhr.abort();
      reject(new Error('Request timeout'));
    }, timeout) : undefined;

    xhr.open('POST', url, true);
    xhr.setRequestHeader('Content-Type', 'application/json');
    Object.entries(headers).forEach(([key, value]) =>
      xhr.setRequestHeader(key, value),
    );

    let processedLength = 0;
    const processor = createNDJSONProcessor(onLine);

    xhr.onprogress = () => {
      if (
        rejectCredentialDowngrade({
          xhr,
          requestUrl: url,
          hasAuthorization: 'Authorization' in headers,
          reject,
        })
      ) {
        clearTimeout(timeoutId);
        return;
      }
      const text = xhr.responseText;
      if (text.length > processedLength) {
        processor.process(text.slice(processedLength));
        processedLength = text.length;
      }
    };

    xhr.onreadystatechange = () =>
      completeNDJSONRequest({
        xhr,
        url,
        hasAuthorization: 'Authorization' in headers,
        processedLength,
        processor,
        timeoutId,
        resolve,
        reject,
      });

    xhr.onerror = () => {
      clearTimeout(timeoutId);
      reject(new Error('Network error'));
    };
    xhr.ontimeout = () => {
      clearTimeout(timeoutId);
      reject(new Error('Request timeout'));
    };

    try {
      const bodyStr = JSON.stringify(body);
      logger.log('[HttpClient] Sending request body, length:', bodyStr.length);
      xhr.send(bodyStr);
    } catch (err) {
      clearTimeout(timeoutId);
      reject(err);
    }
  });
}

interface NDJSONProcessor {
  process(text: string): void;
  flush(): void;
}

function parseNDJSONLine(
  line: string,
  onLine: (parsed: Record<string, unknown>) => void,
  final: boolean,
): void {
  const trimmed = line.trim();
  if (!trimmed) return;
  try {
    onLine(JSON.parse(trimmed) as Record<string, unknown>);
  } catch {
    logger.warn(
      final
        ? '[HttpClient] Failed to parse final NDJSON line:'
        : '[HttpClient] Failed to parse NDJSON line:',
      (final ? line : trimmed).substring(0, 100),
    );
  }
}

function createNDJSONProcessor(
  onLine: (parsed: Record<string, unknown>) => void,
): NDJSONProcessor {
  let lineBuffer = '';
  return {
    process(text) {
      const lines = `${lineBuffer}${text}`.split('\n');
      lineBuffer = lines.pop() || '';
      lines.forEach(line => parseNDJSONLine(line, onLine, false));
    },
    flush() {
      parseNDJSONLine(lineBuffer, onLine, true);
      lineBuffer = '';
    },
  };
}

function completeNDJSONRequest({
  xhr,
  url,
  hasAuthorization,
  processedLength,
  processor,
  timeoutId,
  resolve,
  reject,
}: {
  xhr: XMLHttpRequest;
  url: string;
  hasAuthorization: boolean;
  processedLength: number;
  processor: NDJSONProcessor;
  timeoutId: ReturnType<typeof setTimeout> | undefined;
  resolve: () => void;
  reject: (reason?: unknown) => void;
}): void {
  if (xhr.readyState !== 4) return;
  clearTimeout(timeoutId);
  if (
    rejectCredentialDowngrade({
      xhr,
      requestUrl: url,
      hasAuthorization,
      reject,
    })
  )
    return;
  if (xhr.status >= 200 && xhr.status < 300) {
    if (xhr.responseText.length > processedLength) {
      processor.process(xhr.responseText.slice(processedLength));
    }
    processor.flush();
    resolve();
    return;
  }
  logger.error(
    `[HttpClient] HTTP ${xhr.status} error body: ${
      xhr.responseText || '(empty)'
    }`,
  );
  reject(
    new Error(remoteErrorBodyMessage(xhr.responseText ?? '', xhr.status)),
  );
}
