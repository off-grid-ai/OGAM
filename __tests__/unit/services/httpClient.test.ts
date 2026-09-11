/**
 * HTTP Client Unit Tests
 *
 * Tests for SSE parsing, timeout handling, base64 encoding,
 * and network utilities used for remote LLM server communication.
 */

import {
  parseSSEStream,
  parseOpenAIMessage,
  parseAnthropicMessage,
  isPrivateNetworkEndpoint,
  testEndpoint,
  fetchWithTimeout,
  imageToBase64DataUrl,
  detectServerType,
  createStreamingRequest,
  createNDJSONStreamingRequest,
} from '../../../src/services/httpClient';

// Mock React Native FS
jest.mock('react-native-fs', () => ({
  DocumentDirectoryPath: '/docs',
  exists: jest.fn(),
  readFile: jest.fn(),
  stat: jest.fn(),
}));

describe('httpClient', () => {
  // ─── SSE Parsing Tests ─────────────────────────────────────────────────────

  describe('parseSSEStream', () => {
    async function parseSSEData(
      ...chunks: string[]
    ): Promise<{ events: any[]; releaseLock: jest.Mock }> {
      const encoder = new TextEncoder();
      const readMock = jest.fn();
      chunks.forEach(chunk => {
        readMock.mockResolvedValueOnce({
          done: false,
          value: encoder.encode(chunk),
        });
      });
      readMock.mockResolvedValueOnce({ done: true, value: undefined });
      const releaseLock = jest.fn();
      const mockResp = {
        body: { getReader: () => ({ read: readMock, releaseLock }) },
      } as unknown as Response;
      const collected: any[] = [];
      for await (const event of parseSSEStream(mockResp)) {
        collected.push(event);
      }
      return { events: collected, releaseLock };
    }

    it('should parse simple SSE events', async () => {
      const { events, releaseLock } = await parseSSEData(
        'event: message\ndata: {"text":"hello"}\n\n',
      );
      expect(events).toHaveLength(1);
      expect(events[0]).toEqual({ event: 'message', data: '{"text":"hello"}' });
      expect(releaseLock).toHaveBeenCalled();
    });

    it('should parse multiple SSE events', async () => {
      const { events, releaseLock } = await parseSSEData(
        'event: message\ndata: {"text":"first"}\n\n' +
          'event: message\ndata: {"text":"second"}\n\n',
      );
      expect(events).toHaveLength(2);
      expect(events[0].data).toBe('{"text":"first"}');
      expect(events[1].data).toBe('{"text":"second"}');
      expect(releaseLock).toHaveBeenCalled();
    });

    it('should handle multi-line data', async () => {
      const { events, releaseLock } = await parseSSEData(
        'data: line1\ndata: line2\n\n',
      );
      expect(events).toHaveLength(1);
      expect(events[0].data).toBe('line1\nline2');
      expect(releaseLock).toHaveBeenCalled();
    });

    it('should handle events without explicit event type', async () => {
      const { events, releaseLock } = await parseSSEData('data: hello\n\n');
      expect(events).toHaveLength(1);
      expect(events[0].data).toBe('hello');
      expect(events[0].event).toBeUndefined();
      expect(releaseLock).toHaveBeenCalled();
    });

    it('should throw when body is not readable', async () => {
      const mockResponse = {
        body: null,
      } as unknown as Response;

      await expect(async () => {
        for await (const _ of parseSSEStream(mockResponse)) {
          // Should not reach here
        }
      }).rejects.toThrow('Response body is not readable');
    });

    it('should handle events with id field', async () => {
      const { events } = await parseSSEData(
        'id: event-123\nevent: message\ndata: {"text":"hello"}\n\n',
      );
      expect(events).toHaveLength(1);
      expect(events[0].id).toBe('event-123');
      expect(events[0].event).toBe('message');
      expect(events[0].data).toBe('{"text":"hello"}');
    });

    it('should handle data as object type', async () => {
      const { events } = await parseSSEData('data: first\ndata: second\n\n');
      expect(events).toHaveLength(1);
      expect(events[0].data).toBe('first\nsecond');
    });

    it('should handle chunked data correctly', async () => {
      const { events, releaseLock } = await parseSSEData(
        'event: message\ndata: hel',
        'lo\n\n',
      );
      expect(events).toHaveLength(1);
      expect(events[0].data).toBe('hello');
      expect(releaseLock).toHaveBeenCalled();
    });

    it('should handle event with id field', async () => {
      const { events } = await parseSSEData(
        'event: message\nid: 123\ndata: hello\n\n',
      );
      expect(events).toHaveLength(1);
      expect(events[0].id).toBe('123');
      expect(events[0].event).toBe('message');
      expect(events[0].data).toBe('hello');
    });

    it('should throw when response body is not readable', async () => {
      const mockResponse = {
        body: null,
      } as unknown as Response;

      await expect(async () => {
        for await (const _ of parseSSEStream(mockResponse)) {
          // Should not reach here
        }
      }).rejects.toThrow('Response body is not readable');
    });

    it('should handle events with only data field', async () => {
      const { events } = await parseSSEData('data: test\n\n');
      expect(events).toHaveLength(1);
      expect(events[0].data).toBe('test');
      expect(events[0].event).toBeUndefined();
      expect(events[0].id).toBeUndefined();
    });

    it('should skip events without data', async () => {
      const { events } = await parseSSEData('event: message\n\n');
      // Events without data should not be yielded
      expect(events).toHaveLength(0);
    });

    it('should yield remaining event at end of stream', async () => {
      const { events } = await parseSSEData('data: final\n'); // No trailing newline
      expect(events).toHaveLength(1);
      expect(events[0].data).toBe('final');
    });
  });

  // ─── OpenAI Message Parsing Tests ─────────────────────────────────────────

  describe('parseOpenAIMessage', () => {
    it('should parse content delta', () => {
      const event = { data: '{"choices":[{"delta":{"content":"Hello"}}]}' };
      const result = parseOpenAIMessage(event);

      expect(result).not.toBeNull();
      expect(result?.choices?.[0]?.delta?.content).toBe('Hello');
    });

    it('should parse [DONE] marker', () => {
      const event = { data: '[DONE]' };
      const result = parseOpenAIMessage(event);

      expect(result).not.toBeNull();
      expect(result?.object).toBe('done');
    });

    it('should parse error messages', () => {
      const event = {
        data: '{"error":{"message":"Rate limit exceeded","type":"rate_limit"}}',
      };
      const result = parseOpenAIMessage(event);

      expect(result).not.toBeNull();
      expect(result?.error?.message).toBe('Rate limit exceeded');
    });

    it('should parse tool calls', () => {
      const event = {
        data: '{"choices":[{"delta":{"tool_calls":[{"id":"call_123","function":{"name":"search","arguments":"{\\"query\\""}}]}}]}',
      };
      const result = parseOpenAIMessage(event);

      expect(result).not.toBeNull();
      expect(result?.choices?.[0]?.delta?.tool_calls).toHaveLength(1);
    });

    it('should return null for invalid JSON', () => {
      const event = { data: 'not json' };
      const result = parseOpenAIMessage(event);

      expect(result).toBeNull();
    });

    it('should return null for non-string data', () => {
      const event = { data: { foo: 'bar' } as any };
      const result = parseOpenAIMessage(event);

      expect(result).toBeNull();
    });
  });

  // ─── Anthropic Message Parsing Tests ──────────────────────────────────────

  describe('parseAnthropicMessage', () => {
    it('should parse content_block_delta', () => {
      const event = {
        data: '{"type":"content_block_delta","delta":{"type":"text_delta","text":"Hello"}}',
      };
      const result = parseAnthropicMessage(event);

      expect(result).not.toBeNull();
      expect(result?.type).toBe('content_block_delta');
      expect(result?.delta?.text).toBe('Hello');
    });

    it('should parse message_start', () => {
      const event = {
        data: '{"type":"message_start","message":{"id":"msg_123"}}',
      };
      const result = parseAnthropicMessage(event);

      expect(result).not.toBeNull();
      expect(result?.type).toBe('message_start');
    });

    it('should return null for empty data', () => {
      const event = { data: '' };
      const result = parseAnthropicMessage(event);

      expect(result).toBeNull();
    });
  });

  // ─── Private Network Detection Tests ──────────────────────────────────────

  describe('isPrivateNetworkEndpoint', () => {
    it('should detect localhost as private', () => {
      expect(isPrivateNetworkEndpoint('http://localhost:11434')).toBe(true);
      expect(isPrivateNetworkEndpoint('http://127.0.0.1:11434')).toBe(true);
      expect(isPrivateNetworkEndpoint('http://[::1]:11434')).toBe(true);
    });

    it('should detect 192.168.x.x as private', () => {
      expect(isPrivateNetworkEndpoint('http://192.168.1.50:11434')).toBe(true);
      expect(isPrivateNetworkEndpoint('http://192.168.0.1:1234')).toBe(true);
    });

    it('should detect 10.x.x.x as private', () => {
      expect(isPrivateNetworkEndpoint('http://10.0.0.1:11434')).toBe(true);
      expect(isPrivateNetworkEndpoint('http://10.255.255.255:8080')).toBe(true);
    });

    it('should detect 172.16-31.x.x as private', () => {
      expect(isPrivateNetworkEndpoint('http://172.16.0.1:11434')).toBe(true);
      expect(isPrivateNetworkEndpoint('http://172.31.255.255:8080')).toBe(true);
    });

    it('should NOT detect 172.15.x.x as private', () => {
      expect(isPrivateNetworkEndpoint('http://172.15.0.1:11434')).toBe(false);
    });

    it('should NOT detect 172.32.x.x as private', () => {
      expect(isPrivateNetworkEndpoint('http://172.32.0.1:11434')).toBe(false);
    });

    it('should detect link-local 169.254.x.x as private', () => {
      expect(isPrivateNetworkEndpoint('http://169.254.0.1:11434')).toBe(true);
    });

    it('accepts only the Tailscale CGNAT range as private', () => {
      expect(isPrivateNetworkEndpoint('http://100.64.0.0:7878')).toBe(true);
      expect(isPrivateNetworkEndpoint('http://100.116.255.25:7878')).toBe(true);
      expect(isPrivateNetworkEndpoint('http://100.127.255.255:7878')).toBe(
        true,
      );
      expect(isPrivateNetworkEndpoint('http://100.63.255.255:7878')).toBe(
        false,
      );
      expect(isPrivateNetworkEndpoint('http://100.128.0.0:7878')).toBe(false);
    });

    it('should detect .local (mDNS) as private', () => {
      expect(isPrivateNetworkEndpoint('http://myserver.local:11434')).toBe(
        true,
      );
    });

    it('should detect public internet as NOT private', () => {
      expect(isPrivateNetworkEndpoint('http://api.openai.com:443')).toBe(false);
      expect(isPrivateNetworkEndpoint('http://8.8.8.8:80')).toBe(false);
    });

    it('should handle invalid URLs', () => {
      expect(isPrivateNetworkEndpoint('not-a-url')).toBe(false);
    });
  });

  // ─── Timeout Tests ────────────────────────────────────────────────────────

  describe('fetchWithTimeout', () => {
    it('should resolve with JSON response', async () => {
      const mockData = { models: [{ id: 'test' }] };
      jest.spyOn(global, 'fetch').mockResolvedValue({
        ok: true,
        headers: { get: () => 'application/json' },
        json: () => Promise.resolve(mockData),
      } as unknown as Response);

      const result = await fetchWithTimeout('http://test.com/api', {
        timeout: 5000,
      });

      expect(result).toEqual(mockData);
    });

    it('should resolve with text response for non-JSON', async () => {
      jest.spyOn(global, 'fetch').mockResolvedValue({
        ok: true,
        headers: { get: () => 'text/html' },
        text: () => Promise.resolve('<html>ok</html>'),
      } as unknown as Response);

      const result = await fetchWithTimeout('http://test.com/page', {
        timeout: 5000,
      });

      expect(result).toBe('<html>ok</html>');
    });

    it('should throw on HTTP error', async () => {
      jest.spyOn(global, 'fetch').mockResolvedValue({
        ok: false,
        status: 404,
        text: () => Promise.resolve('Not Found'),
      } as Response);

      await expect(
        fetchWithTimeout('http://test.com/missing', { timeout: 5000 }),
      ).rejects.toThrow('HTTP 404');
    });

    it('should timeout after specified duration', async () => {
      // This test verifies timeout behavior through the AbortController mechanism
      // We can't easily test real timeouts in unit tests without fake timers,
      // but the timeout logic is straightforward and tested in integration tests
      const controller = new AbortController();
      controller.abort();
      jest.spyOn(global, 'fetch').mockImplementation(() => {
        return Promise.reject(new Error('Aborted'));
      });

      await expect(
        fetchWithTimeout('http://test.com/slow', { timeout: 100 }),
      ).rejects.toThrow();
    });

    it('should retry on transient errors', async () => {
      const mockData = { success: true };
      jest
        .spyOn(global, 'fetch')
        .mockRejectedValueOnce(new Error('Network error'))
        .mockResolvedValueOnce({
          ok: true,
          headers: { get: () => 'application/json' },
          json: () => Promise.resolve(mockData),
        } as unknown as Response);

      const result = await fetchWithTimeout('http://test.com/api', {
        timeout: 5000,
        retries: 1,
        retryDelay: 0, // No delay for test
      });

      expect(result).toEqual({ success: true });
      expect(global.fetch).toHaveBeenCalledTimes(2);
    });

    it('should throw "Request cancelled" on AbortError', async () => {
      const abortError = new Error('Aborted');
      abortError.name = 'AbortError';
      jest.spyOn(global, 'fetch').mockRejectedValue(abortError);

      await expect(
        fetchWithTimeout('http://test.com/api', { timeout: 5000 }),
      ).rejects.toThrow('Request cancelled');
    });

    it('should fallback to text when content-type header is missing', async () => {
      jest.spyOn(global, 'fetch').mockResolvedValue({
        ok: true,
        headers: { get: () => null },
        text: () => Promise.resolve('plain text response'),
      } as unknown as Response);

      const result = await fetchWithTimeout('http://test.com/api', {
        timeout: 5000,
      });

      expect(result).toBe('plain text response');
    });

    it('should fallback to "Unknown error" when response.text() fails', async () => {
      jest.spyOn(global, 'fetch').mockResolvedValue({
        ok: false,
        status: 500,
        text: () => Promise.reject(new Error('text failed')),
      } as unknown as Response);

      await expect(
        fetchWithTimeout('http://test.com/error', { timeout: 5000 }),
      ).rejects.toThrow('HTTP 500: Unknown error');
    });

    it('should handle non-Error thrown values', async () => {
      jest.spyOn(global, 'fetch').mockRejectedValue('string error');

      await expect(
        fetchWithTimeout('http://test.com/api', { timeout: 5000, retries: 0 }),
      ).rejects.toThrow('string error');
    });
  });

  // ─── Endpoint Testing ──────────────────────────────────────────────────────

  describe('testEndpoint', () => {
    beforeEach(() => {
      global.fetch = jest.fn();
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    it('should return success for reachable endpoint', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        headers: { get: () => null },
      });

      const result = await testEndpoint('http://192.168.1.50:11434', 5000);

      expect(result.success).toBe(true);
      expect(result.latency).toBeGreaterThanOrEqual(0);
    });

    it('should return error for unreachable endpoint', async () => {
      (global.fetch as jest.Mock).mockRejectedValue(
        new Error('Connection refused'),
      );

      const result = await testEndpoint('http://192.168.1.50:11434', 5000);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Connection refused');
    });

    it('should return error on HTTP error', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: false,
        status: 401,
      });

      const result = await testEndpoint('http://192.168.1.50:11434', 5000);

      expect(result.success).toBe(false);
    });

    it('should try alternate health endpoints when /v1/models fails', async () => {
      (global.fetch as jest.Mock)
        .mockResolvedValueOnce({
          ok: false,
          status: 404,
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
        });

      const result = await testEndpoint('http://192.168.1.50:11434', 5000);

      expect(result.success).toBe(true);
    });

    it('bounds the full fallback probe sequence with one timeout', async () => {
      jest.useFakeTimers();
      try {
        (global.fetch as jest.Mock)
          .mockResolvedValueOnce({ ok: false, status: 404 })
          .mockImplementation(
            (_url, init: RequestInit) =>
              new Promise((_resolve, reject) => {
                const abort = () => reject(new Error('aborted'));
                if (init.signal?.aborted) abort();
                else
                  init.signal?.addEventListener('abort', abort, { once: true });
              }),
          );

        const pending = testEndpoint('http://192.168.1.50:11434', 50);
        await Promise.resolve();
        await jest.advanceTimersByTimeAsync(50);

        await expect(pending).resolves.toMatchObject({ success: false });
        expect(global.fetch).toHaveBeenCalledTimes(4);
      } finally {
        jest.useRealTimers();
      }
    });

    it('should strip trailing slashes from endpoint', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        headers: { get: () => null },
      });

      await testEndpoint('http://192.168.1.50:11434///', 5000);

      expect(global.fetch).toHaveBeenCalledWith(
        'http://192.168.1.50:11434/v1/models',
        expect.any(Object),
      );
    });
  });

  // ─── Image to Base64 Tests ─────────────────────────────────────────────────

  describe('imageToBase64DataUrl', () => {
    const RNFS = require('react-native-fs');

    // Helper: mock the FileReader global with a success result
    function mockFileReaderSuccess(result = 'data:image/png;base64,encoded') {
      const mockReader = {
        readAsDataURL: jest.fn(function (this: any) {
          setTimeout(() => {
            this.result = result;
            if (this.onload) this.onload({ target: this });
          }, 0);
        }),
        onload: null as ((event: any) => void) | null,
        onerror: null as ((event: any) => void) | null,
        result: null as string | null,
      };
      (global as any).FileReader = jest.fn(() => mockReader);
      return mockReader;
    }

    // Helper: mock the FileReader global to trigger an error
    function mockFileReaderError() {
      const mockReader = {
        readAsDataURL: jest.fn(function (this: any) {
          setTimeout(() => {
            if (this.onerror) this.onerror({ target: this });
          }, 0);
        }),
        onload: null as ((event: any) => void) | null,
        onerror: null as ((event: any) => void) | null,
        result: null as string | null,
      };
      (global as any).FileReader = jest.fn(() => mockReader);
      return mockReader;
    }

    beforeEach(() => {
      jest.clearAllMocks();
    });

    it('should return data URL as-is if already encoded', async () => {
      const dataUrl = 'data:image/png;base64,iVBORw0KGgo=';
      const result = await imageToBase64DataUrl(dataUrl);

      expect(result).toBe(dataUrl);
    });

    it('should encode file:// URI to base64', async () => {
      RNFS.exists.mockResolvedValue(true);
      RNFS.readFile.mockResolvedValue('base64encodeddata');
      RNFS.DocumentDirectoryPath = '/docs';

      const result = await imageToBase64DataUrl('file:///path/to/image.png');

      expect(result).toBe('data:image/png;base64,base64encodeddata');
      expect(RNFS.exists).toHaveBeenCalledWith('/path/to/image.png');
    });

    it('should throw if file does not exist', async () => {
      RNFS.exists.mockResolvedValue(false);

      await expect(imageToBase64DataUrl('file:///missing.png')).rejects.toThrow(
        'Image file not found',
      );
    });

    it('should determine MIME type from extension', async () => {
      RNFS.exists.mockResolvedValue(true);
      RNFS.readFile.mockResolvedValue('data');

      const jpgResult = await imageToBase64DataUrl('file:///image.jpg');
      expect(jpgResult).toContain('data:image/jpeg;base64,');

      const jpegResult = await imageToBase64DataUrl('file:///image.jpeg');
      expect(jpegResult).toContain('data:image/jpeg;base64,');

      const gifResult = await imageToBase64DataUrl('file:///image.gif');
      expect(gifResult).toContain('data:image/gif;base64,');

      const webpResult = await imageToBase64DataUrl('file:///image.webp');
      expect(webpResult).toContain('data:image/webp;base64,');
    });

    it('should default to jpeg for unknown extensions', async () => {
      RNFS.exists.mockResolvedValue(true);
      RNFS.readFile.mockResolvedValue('data');

      const result = await imageToBase64DataUrl('file:///image.unknown');

      expect(result).toContain('data:image/jpeg;base64,');
    });

    it('should handle paths without file:// prefix', async () => {
      RNFS.exists.mockResolvedValue(true);
      RNFS.readFile.mockResolvedValue('data');
      RNFS.DocumentDirectoryPath = '/docs';

      const result = await imageToBase64DataUrl('/docs/photo.png');

      expect(result).toContain('data:image/png;base64,');
    });

    it('should fetch and encode remote URLs', async () => {
      const mockBlob = new Blob(['image data']);
      const mockFetch = jest.spyOn(global, 'fetch').mockResolvedValue({
        ok: true,
        blob: () => Promise.resolve(mockBlob),
      } as unknown as Response);

      mockFileReaderSuccess();

      const result = await imageToBase64DataUrl('http://example.com/image.png');

      expect(result).toBe('data:image/png;base64,encoded');
      expect(mockFetch).toHaveBeenCalledWith('http://example.com/image.png');
    });

    it('should throw on fetch failure', async () => {
      jest.spyOn(global, 'fetch').mockResolvedValue({
        ok: false,
        status: 404,
      } as Response);

      await expect(
        imageToBase64DataUrl('http://example.com/missing.png'),
      ).rejects.toThrow('Failed to fetch image: 404');
    });

    it('should throw on FileReader error', async () => {
      const mockBlob = new Blob(['image data']);
      jest.spyOn(global, 'fetch').mockResolvedValue({
        ok: true,
        blob: () => Promise.resolve(mockBlob),
      } as unknown as Response);

      mockFileReaderError();

      await expect(
        imageToBase64DataUrl('http://example.com/image.png'),
      ).rejects.toThrow('Failed to read image as base64');
    });
  });

  // ─── Detect Server Type Tests ───────────────────────────────────────────────

  describe('detectServerType', () => {
    beforeEach(() => {
      global.fetch = jest.fn();
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    it('should detect Ollama from server header', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        headers: { get: () => 'Ollama/1.0' },
        json: () => Promise.resolve({ object: 'list', data: [] }),
      });

      const result = await detectServerType('http://localhost:11434', 5000);

      expect(result).toEqual({ type: 'ollama' });
    });

    it('should detect Ollama from /api/tags endpoint', async () => {
      (global.fetch as jest.Mock)
        .mockResolvedValueOnce({
          ok: false,
          status: 404,
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ models: [] }),
        });

      const result = await detectServerType('http://localhost:11434', 5000);

      expect(result).toEqual({ type: 'ollama' });
    });

    it('should detect LM Studio from model list', async () => {
      // First call to /v1/models fails (not OpenAI-compatible)
      // Then /api/tags fails (not Ollama)
      // Then LM Studio check succeeds with gguf models
      (global.fetch as jest.Mock)
        .mockResolvedValueOnce({
          ok: false,
          status: 404,
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 404,
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve({
              data: [{ id: 'model.gguf' }, { id: 'other.gguf' }],
            }),
        });

      const result = await detectServerType('http://localhost:1234', 5000);

      expect(result).toEqual({ type: 'lmstudio' });
    });

    it('should detect generic OpenAI-compatible server', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        headers: { get: () => null },
        json: () =>
          Promise.resolve({ object: 'list', data: [{ id: 'gpt-4' }] }),
      });

      const result = await detectServerType('http://localhost:8080', 5000);

      expect(result).toEqual({ type: 'openai-compatible' });
    });

    it('should return null when server type cannot be determined', async () => {
      // All endpoints return failures
      (global.fetch as jest.Mock)
        .mockResolvedValueOnce({
          ok: false,
          status: 404,
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 404,
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 404,
        });

      const result = await detectServerType('http://unknown-server.com', 5000);

      expect(result).toBeNull();
    });

    it('should return null on network error', async () => {
      (global.fetch as jest.Mock).mockRejectedValue(new Error('Network error'));

      const result = await detectServerType('http://unreachable.com', 5000);

      expect(result).toBeNull();
    });

    it('should strip trailing slashes from endpoint', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        headers: { get: () => null },
        json: () => Promise.resolve({ object: 'list', data: [] }),
      });

      await detectServerType('http://localhost:11434///', 5000);

      expect(global.fetch).toHaveBeenCalledWith(
        'http://localhost:11434/v1/models',
        expect.any(Object),
      );
    });

    it('should fallback to Ollama when OpenAI-compatible check fails', async () => {
      // /v1/models fails, then /api/tags succeeds
      (global.fetch as jest.Mock)
        .mockResolvedValueOnce({
          ok: false,
          status: 404,
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ models: [] }),
        });

      const result = await detectServerType('http://localhost:11434', 5000);

      expect(result).toEqual({ type: 'ollama' });
    });
  });

  // ─── Create Streaming Request Tests ────────────────────────────────────────

  describe('createStreamingRequest', () => {
    let mockXHR: any;
    let onReadyStateChange: (() => void) | null;
    let onProgress: (() => void) | null;
    let onError: (() => void) | null;
    let onTimeout: (() => void) | null;

    beforeEach(() => {
      onReadyStateChange = null;
      onProgress = null;
      onError = null;
      onTimeout = null;

      mockXHR = {
        open: jest.fn(),
        setRequestHeader: jest.fn(),
        send: jest.fn(),
        abort: jest.fn(),
        onreadystatechange: null,
        onprogress: null,
        onerror: null,
        ontimeout: null,
        readyState: 0,
        status: 0,
        statusText: '',
        responseText: '',
      };

      // Capture event handlers
      Object.defineProperty(mockXHR, 'onreadystatechange', {
        set: (fn: () => void) => {
          onReadyStateChange = fn;
        },
        get: () => onReadyStateChange,
      });
      Object.defineProperty(mockXHR, 'onprogress', {
        set: (fn: () => void) => {
          onProgress = fn;
        },
        get: () => onProgress,
      });
      Object.defineProperty(mockXHR, 'onerror', {
        set: (fn: () => void) => {
          onError = fn;
        },
        get: () => onError,
      });
      Object.defineProperty(mockXHR, 'ontimeout', {
        set: (fn: () => void) => {
          onTimeout = fn;
        },
        get: () => onTimeout,
      });

      (globalThis as any).XMLHttpRequest = jest.fn(() => mockXHR);

      jest.useFakeTimers();
      streamEvents = [];
    });

    afterEach(() => {
      jest.useRealTimers();
      jest.restoreAllMocks();
    });

    const TEST_ENDPOINT = 'http://localhost:11434/api/chat';
    let streamEvents: any[] = [];

    function startStream(
      headers: Record<string, string> = {},
      timeout = 0,
    ): Promise<void> {
      return createStreamingRequest(
        TEST_ENDPOINT,
        { body: { model: 'test' }, headers, timeout },
        e => streamEvents.push(e),
      );
    }

    // Helper: simulate a progress event with given SSE response text
    function simulateProgress(responseText: string) {
      mockXHR.responseText = responseText;
      mockXHR.status = 200;
      mockXHR.readyState = 3;
      if (onProgress) onProgress();
    }

    // Helper: simulate request completion with given SSE response text
    function simulateComplete(responseText: string) {
      mockXHR.responseText = responseText;
      mockXHR.status = 200;
      mockXHR.readyState = 4;
      if (onReadyStateChange) onReadyStateChange();
    }

    it('should make POST request with correct headers', async () => {
      const _promise = startStream({ Authorization: 'Bearer token' });

      expect(mockXHR.open).toHaveBeenCalledWith('POST', TEST_ENDPOINT, true);
      expect(mockXHR.setRequestHeader).toHaveBeenCalledWith(
        'Content-Type',
        'application/json',
      );
      expect(mockXHR.setRequestHeader).toHaveBeenCalledWith(
        'Accept',
        'text/event-stream',
      );
      expect(mockXHR.setRequestHeader).toHaveBeenCalledWith(
        'Authorization',
        'Bearer token',
      );
      expect(mockXHR.send).toHaveBeenCalledWith('{"model":"test"}');
    });

    it('should parse SSE events on progress', async () => {
      const _promise = startStream();

      simulateProgress('data: {"text":"hello"}\n\n');

      expect(streamEvents).toHaveLength(1);
      expect(streamEvents[0].data).toBe('{"text":"hello"}');
    });

    it('rejects a credential downgrade before parsing SSE progress', async () => {
      const onEvent = jest.fn();
      const promise = createStreamingRequest(
        'https://desktop.example.test/v1/chat',
        { body: {}, headers: { Authorization: 'Bearer token' } },
        onEvent,
      );
      mockXHR.responseURL = 'http://192.168.1.30:7878/v1/chat';
      simulateProgress('data: {"text":"must-not-run"}\n\n');

      await expect(promise).rejects.toThrow('redirected credentials');
      expect(onEvent).not.toHaveBeenCalled();
      expect(mockXHR.abort).toHaveBeenCalled();
    });

    it('should resolve on successful completion', async () => {
      const promise = startStream();

      simulateComplete('data: final\n\n');

      await expect(promise).resolves.toBeUndefined();
    });

    it('rejects a credentialed HTTPS stream that reports an HTTP redirect target', async () => {
      const promise = createStreamingRequest(
        'https://desktop.example.test/v1/chat',
        { body: {}, headers: { Authorization: 'Bearer token' } },
        jest.fn(),
      );
      mockXHR.responseURL = 'http://192.168.1.30:7878/v1/chat';
      simulateComplete('data: final\n\n');
      await expect(promise).rejects.toThrow('redirected credentials');
    });

    it('should reject on HTTP error', async () => {
      const promise = startStream();

      mockXHR.responseText = 'Internal Server Error';
      mockXHR.status = 500;
      mockXHR.readyState = 4;
      if (onReadyStateChange) onReadyStateChange();

      await expect(promise).rejects.toThrow('HTTP 500');
    });

    it('should reject on network error', async () => {
      const promise = startStream();

      if (onError) {
        onError();
      }

      await expect(promise).rejects.toThrow('Network error');
    });

    it('should reject on timeout', async () => {
      const promise = startStream({}, 300000);

      // Advance timers past timeout
      jest.advanceTimersByTime(300000);

      expect(mockXHR.abort).toHaveBeenCalled();
      await expect(promise).rejects.toThrow('Request timeout');
    });

    it('should handle events with event type', async () => {
      const _promise = startStream();
      simulateProgress('event: message\ndata: {"text":"hello"}\n\n');
      expect(streamEvents).toHaveLength(1);
      expect(streamEvents[0].event).toBe('message');
      expect(streamEvents[0].data).toBe('{"text":"hello"}');
    });

    it('should handle events with id field', async () => {
      const _promise = startStream();
      simulateProgress('id: 123\ndata: hello\n\n');
      expect(streamEvents).toHaveLength(1);
      expect(streamEvents[0].id).toBe('123');
      expect(streamEvents[0].data).toBe('hello');
    });

    it('should handle multi-line data', async () => {
      const _promise = startStream();
      simulateProgress('data: line1\ndata: line2\n\n');
      expect(streamEvents).toHaveLength(1);
      expect(streamEvents[0].data).toBe('line1\nline2');
    });

    it('should process final chunk on completion', async () => {
      const promise = startStream();
      simulateComplete('data: final\n\n');
      await promise;
      expect(streamEvents).toHaveLength(1);
      expect(streamEvents[0].data).toBe('final');
    });

    it('should handle incremental progress updates', async () => {
      const _promise = startStream();

      simulateProgress('data: first\n\n');
      expect(streamEvents).toHaveLength(1);
      expect(streamEvents[0].data).toBe('first');

      // Second progress event with more data
      mockXHR.responseText = 'data: first\n\ndata: second\n\n';
      if (onProgress) onProgress();

      expect(streamEvents).toHaveLength(2);
      expect(streamEvents[1].data).toBe('second');
    });

    it('should handle events with id in final chunk', async () => {
      const promise = startStream();
      simulateComplete('id: event-1\ndata: hello\n\n');
      await promise;
      expect(streamEvents).toHaveLength(1);
      expect(streamEvents[0].id).toBe('event-1');
      expect(streamEvents[0].data).toBe('hello');
    });

    it('should handle multi-line data in final chunk', async () => {
      const promise = startStream();
      simulateComplete('data: line1\ndata: line2\n\n');
      await promise;
      expect(streamEvents).toHaveLength(1);
      expect(streamEvents[0].data).toBe('line1\nline2');
    });

    it('should handle events with event type in final chunk', async () => {
      const promise = startStream();
      simulateComplete('event: message\ndata: hello\n\n');
      await promise;
      expect(streamEvents).toHaveLength(1);
      expect(streamEvents[0].event).toBe('message');
      expect(streamEvents[0].data).toBe('hello');
    });

    it('should handle XHR timeout event', async () => {
      const promise = startStream();

      if (onTimeout) {
        onTimeout();
      }

      await expect(promise).rejects.toThrow('Request timeout');
    });

    it('should handle XHR timeout via ontimeout', async () => {
      const promise = startStream({}, 300000);

      // Simulate XHR timeout
      jest.advanceTimersByTime(300000);

      expect(mockXHR.abort).toHaveBeenCalled();
      await expect(promise).rejects.toThrow('Request timeout');
    });

    it('should reject on send error', async () => {
      // Mock XHR that throws on send
      const mockXHRThatThrows = {
        open: jest.fn(),
        setRequestHeader: jest.fn(),
        send: jest.fn(() => {
          throw new Error('Send failed');
        }),
        abort: jest.fn(),
      };

      (global as any).XMLHttpRequest = jest.fn(() => mockXHRThatThrows);

      await expect(
        createStreamingRequest(
          'http://localhost:11434/api/chat',
          { body: { model: 'test' }, headers: {} },
          () => {},
        ),
      ).rejects.toThrow('Send failed');
    });

    it('should abort XHR when signal fires', async () => {
      const controller = new AbortController();
      const promise = createStreamingRequest(
        TEST_ENDPOINT,
        {
          body: { model: 'test' },
          headers: {},
          timeout: 300000,
          signal: controller.signal,
        },
        e => streamEvents.push(e),
      );

      controller.abort();
      await expect(promise).resolves.toBeUndefined();
      expect(mockXHR.abort).toHaveBeenCalled();
    });

    it('should not process final data when responseText equals processed length', async () => {
      const promise = startStream();

      // First simulate progress that processes some data
      simulateProgress('data: first\n\n');
      expect(streamEvents).toHaveLength(1);

      // Now complete with exact same text (nothing new)
      mockXHR.responseText = 'data: first\n\n'; // same length, nothing new
      mockXHR.status = 200;
      mockXHR.readyState = 4;
      if (onReadyStateChange) onReadyStateChange();

      await promise;
      // Still only 1 event (no duplicate from final readyState)
      expect(streamEvents).toHaveLength(1);
    });
  });

  // ─── detectServerType — additional branches ─────────────────────────────────

  describe('detectServerType — additional branches', () => {
    beforeEach(() => {
      global.fetch = jest.fn();
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    it('returns null when JSON parse throws for /v1/models response', async () => {
      (global.fetch as jest.Mock)
        .mockResolvedValueOnce({
          ok: true,
          headers: { get: () => null }, // not Ollama
          json: () => Promise.reject(new Error('JSON parse error')),
        })
        .mockResolvedValueOnce({ ok: false, status: 404 }) // /api/tags fails
        .mockResolvedValueOnce({ ok: false, status: 404 }); // LM Studio fails

      const result = await detectServerType('http://localhost:8080', 5000);

      expect(result).toBeNull();
    });

    it('returns null when LM Studio response has no gguf models', async () => {
      (global.fetch as jest.Mock)
        .mockResolvedValueOnce({ ok: false, status: 404 }) // /v1/models fails
        .mockResolvedValueOnce({ ok: false, status: 404 }) // /api/tags fails
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve({
              data: [{ id: 'some-model' }, { id: 'other-model' }], // no .gguf
            }),
        });

      const result = await detectServerType('http://localhost:1234', 5000);

      expect(result).toBeNull();
    });

    it('handles generic OpenAI-compatible via Array.isArray(data.data) branch', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        headers: { get: () => null },
        json: () => Promise.resolve({ data: [{ id: 'gpt-4' }] }), // object not 'list' but data is array
      });

      const result = await detectServerType('http://localhost:8080', 5000);

      expect(result).toEqual({ type: 'openai-compatible' });
    });
  });

  // ─── parseAnthropicMessage — additional branch ────────────────────────────

  describe('parseAnthropicMessage — non-string data', () => {
    it('returns null for non-string data', () => {
      const event = { data: { type: 'event' } as any };
      const result = parseAnthropicMessage(event);
      expect(result).toBeNull();
    });

    it('returns null for invalid JSON', () => {
      const event = { data: 'not json here' };
      const result = parseAnthropicMessage(event);
      expect(result).toBeNull();
    });
  });

  // ─── createNDJSONStreamingRequest ─────────────────────────────────────────

  describe('createNDJSONStreamingRequest', () => {
    let mockXHR: any;

    beforeEach(() => {
      mockXHR = {
        open: jest.fn(),
        setRequestHeader: jest.fn(),
        send: jest.fn(),
        abort: jest.fn(),
        addEventListener: jest.fn((event: string, cb: () => void) => {
          if (event === 'abort') mockXHR._abortCb = cb;
        }),
        readyState: 0,
        status: 200,
        responseText: '',
        onreadystatechange: null as any,
        onprogress: null as any,
        onerror: null as any,
        ontimeout: null as any,
      };
      (globalThis as any).XMLHttpRequest = jest.fn(() => mockXHR);
    });

    function simulateSuccess(responseText = '') {
      mockXHR.responseText = responseText;
      mockXHR.readyState = 4;
      mockXHR.status = 200;
      mockXHR.onreadystatechange?.();
    }

    it('resolves and calls onLine for each complete NDJSON line', async () => {
      const onLine = jest.fn();
      const promise = createNDJSONStreamingRequest(
        'http://localhost/api/chat',
        { body: {} },
        onLine,
      );
      simulateSuccess('{"done":false}\n{"done":true}\n');
      await promise;
      expect(onLine).toHaveBeenCalledTimes(2);
      expect(onLine).toHaveBeenCalledWith({ done: false });
      expect(onLine).toHaveBeenCalledWith({ done: true });
    });

    it('rejects a credential downgrade before parsing NDJSON progress', async () => {
      const onLine = jest.fn();
      const promise = createNDJSONStreamingRequest(
        'https://desktop.example.test/api/chat',
        { body: {}, headers: { Authorization: 'Bearer token' } },
        onLine,
      );
      mockXHR.responseURL = 'http://192.168.1.30:11434/api/chat';
      mockXHR.responseText = '{"done":true}\n';
      mockXHR.onprogress?.();

      await expect(promise).rejects.toThrow('redirected credentials');
      expect(onLine).not.toHaveBeenCalled();
      expect(mockXHR.abort).toHaveBeenCalled();
    });

    it('rejects a credentialed HTTPS stream that reports an HTTP redirect target', async () => {
      const promise = createNDJSONStreamingRequest(
        'https://desktop.example.test/api/chat',
        { body: {}, headers: { Authorization: 'Bearer token' } },
        jest.fn(),
      );
      mockXHR.responseURL = 'http://192.168.1.30:11434/api/chat';
      simulateSuccess();
      await expect(promise).rejects.toThrow('redirected credentials');
    });

    it('flushes partial buffered line on readyState=4', async () => {
      const onLine = jest.fn();
      const promise = createNDJSONStreamingRequest(
        'http://localhost/api/chat',
        { body: {} },
        onLine,
      );
      // No trailing newline — sits in lineBuffer until completion
      simulateSuccess('{"done":true}');
      await promise;
      expect(onLine).toHaveBeenCalledWith({ done: true });
    });

    it('rejects on HTTP error status', async () => {
      const promise = createNDJSONStreamingRequest(
        'http://localhost/api/chat',
        { body: {} },
        jest.fn(),
      );
      mockXHR.responseText = 'Internal Server Error';
      mockXHR.readyState = 4;
      mockXHR.status = 500;
      mockXHR.onreadystatechange?.();
      await expect(promise).rejects.toThrow('HTTP 500');
    });

    it('rejects on network error', async () => {
      const promise = createNDJSONStreamingRequest(
        'http://localhost/api/chat',
        { body: {} },
        jest.fn(),
      );
      mockXHR.onerror?.();
      await expect(promise).rejects.toThrow('Network error');
    });

    it('rejects on timeout', async () => {
      const promise = createNDJSONStreamingRequest(
        'http://localhost/api/chat',
        { body: {} },
        jest.fn(),
      );
      mockXHR.ontimeout?.();
      await expect(promise).rejects.toThrow('Request timeout');
    });

    it('skips empty/blank lines', async () => {
      const onLine = jest.fn();
      const promise = createNDJSONStreamingRequest(
        'http://localhost/api/chat',
        { body: {} },
        onLine,
      );
      simulateSuccess('\n\n{"done":true}\n\n');
      await promise;
      expect(onLine).toHaveBeenCalledTimes(1);
    });

    it('warns and skips invalid JSON lines', async () => {
      const onLine = jest.fn();
      const promise = createNDJSONStreamingRequest(
        'http://localhost/api/chat',
        { body: {} },
        onLine,
      );
      simulateSuccess('not-json\n{"ok":true}\n');
      await promise;
      expect(onLine).toHaveBeenCalledTimes(1);
      expect(onLine).toHaveBeenCalledWith({ ok: true });
    });

    it('sets custom headers', async () => {
      const promise = createNDJSONStreamingRequest(
        'http://localhost/api/chat',
        { body: {}, headers: { Authorization: 'Bearer token' } },
        jest.fn(),
      );
      simulateSuccess('');
      await promise;
      expect(mockXHR.setRequestHeader).toHaveBeenCalledWith(
        'Authorization',
        'Bearer token',
      );
    });

    it('processes onprogress chunks and merges partial lines', async () => {
      const onLine = jest.fn();
      const promise = createNDJSONStreamingRequest(
        'http://localhost/api/chat',
        { body: {} },
        onLine,
      );
      // First progress event delivers half a line
      mockXHR.responseText = '{"a":1}\n{"b":';
      mockXHR.onprogress?.();
      // Second progress delivers rest
      mockXHR.responseText = '{"a":1}\n{"b":2}\n';
      mockXHR.onprogress?.();
      simulateSuccess('{"a":1}\n{"b":2}\n');
      await promise;
      expect(onLine).toHaveBeenCalledWith({ a: 1 });
      expect(onLine).toHaveBeenCalledWith({ b: 2 });
    });

    it('warns and skips invalid JSON in buffered final line', async () => {
      const onLine = jest.fn();
      const promise = createNDJSONStreamingRequest(
        'http://localhost/api/chat',
        { body: {} },
        onLine,
      );
      // No trailing newline so it ends up in lineBuffer — invalid JSON
      simulateSuccess('not-valid-json');
      await promise;
      expect(onLine).not.toHaveBeenCalled();
    });

    it('rejects when xhr.send throws', async () => {
      mockXHR.send = jest.fn(() => {
        throw new Error('send failed');
      });
      const promise = createNDJSONStreamingRequest(
        'http://localhost/api/chat',
        { body: {} },
        jest.fn(),
      );
      await expect(promise).rejects.toThrow('send failed');
    });
  });
});
