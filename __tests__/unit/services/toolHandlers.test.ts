/**
 * Tool Handlers Unit Tests
 *
 * Tests for the read_url and search_knowledge_base tool handlers.
 */

import { executeToolCall } from '../../../src/services/tools/handlers';

// Mock fetch globally
const mockFetch = jest.fn();
(globalThis as any).fetch = mockFetch;

describe('read_url handler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('fetches URL and strips HTML tags', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      text: async () => '<html><body><h1>Hello</h1><p>World</p></body></html>',
    });

    const result = await executeToolCall({
      id: 'call_1',
      name: 'read_url',
      arguments: { url: 'https://example.com' },
    });

    expect(result.error).toBeUndefined();
    expect(result.content).toContain('Hello');
    expect(result.content).toContain('World');
    expect(result.content).not.toContain('<');
  });

  it('rejects invalid URL without http/https', async () => {
    const result = await executeToolCall({
      id: 'call_2',
      name: 'read_url',
      arguments: { url: 'ftp://example.com' },
    });

    expect(result.error).toContain('Invalid URL');
  });

  it('returns error for missing url parameter', async () => {
    const result = await executeToolCall({
      id: 'call_3',
      name: 'read_url',
      arguments: {},
    });

    expect(result.error).toContain('Missing required parameter: url');
  });

  it('truncates content exceeding 4000 characters', async () => {
    const longContent = 'A'.repeat(5000);
    mockFetch.mockResolvedValue({
      ok: true,
      text: async () => longContent,
    });

    const result = await executeToolCall({
      id: 'call_4',
      name: 'read_url',
      arguments: { url: 'https://example.com/long' },
    });

    expect(result.error).toBeUndefined();
    expect(result.content).toContain('[Content truncated]');
    expect(result.content.length).toBeLessThan(5000);
  });

  it('handles HTTP error responses', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 404,
      statusText: 'Not Found',
    });

    const result = await executeToolCall({
      id: 'call_5',
      name: 'read_url',
      arguments: { url: 'https://example.com/missing' },
    });

    expect(result.error).toContain('404');
  });

  it('handles fetch timeout/abort', async () => {
    mockFetch.mockRejectedValue(new Error('The operation was aborted'));

    const result = await executeToolCall({
      id: 'call_6',
      name: 'read_url',
      arguments: { url: 'https://example.com/slow' },
    });

    expect(result.error).toContain('aborted');
  });

  it('returns message for empty page content', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      text: async () => '<html><body>   </body></html>',
    });

    const result = await executeToolCall({
      id: 'call_7',
      name: 'read_url',
      arguments: { url: 'https://example.com/empty' },
    });

    expect(result.error).toBeUndefined();
    expect(result.content).toContain('no readable content');
  });

  it('strips surrounding quotes and angle brackets from URL', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      text: async () => '<p>Content</p>',
    });

    const result = await executeToolCall({
      id: 'call_9',
      name: 'read_url',
      arguments: { url: '"https://example.com"' },
    });

    expect(result.error).toBeUndefined();
    expect(mockFetch).toHaveBeenCalledWith(
      'https://example.com',
      expect.any(Object),
    );
  });

  it.each([
    'http://localhost/admin',
    'http://127.0.0.1:8080/secret',
    'http://10.0.0.1/internal',
    'http://192.168.1.1/router',
    'http://169.254.169.254/latest/meta-data',
  ])('blocks private/loopback URL: %s', async (privateUrl) => {
    const result = await executeToolCall({
      id: 'call_ssrf', name: 'read_url', arguments: { url: privateUrl },
    });
    expect(result.error).toContain('Blocked');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('includes durationMs in result', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      text: async () => '<p>Test</p>',
    });

    const result = await executeToolCall({
      id: 'call_8',
      name: 'read_url',
      arguments: { url: 'https://example.com' },
    });

    expect(result.durationMs).toBeDefined();
    expect(typeof result.durationMs).toBe('number');
  });
});

describe('web_search handler', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns error for missing query parameter', async () => {
    const result = await executeToolCall({ id: 'ws_1', name: 'web_search', arguments: {} });
    expect(result.error).toContain('Missing required parameter: query');
  });

  it('returns no-results message when search returns empty HTML', async () => {
    mockFetch.mockResolvedValue({ text: async () => '<html><body>Nothing here</body></html>' });
    const result = await executeToolCall({ id: 'ws_2', name: 'web_search', arguments: { query: 'xyzzy' } });
    expect(result.error).toBeUndefined();
    expect(result.content).toContain('No results found');
  });

  it('returns formatted results when search finds matches', async () => {
    const html = [
      '<div class="result-wrapper">',
      '<a href="https://example.com/page">Click me</a>',
      '<a class="title-link" href="https://example.com/page"><span class="title">Example Title</span></a>',
      '<p class="snippet">This is a snippet about the result</p>',
      '</div>',
    ].join('');
    mockFetch.mockResolvedValue({ text: async () => html });
    const result = await executeToolCall({ id: 'ws_3', name: 'web_search', arguments: { query: 'example' } });
    expect(result.error).toBeUndefined();
    expect(result.content).toBeDefined();
  });
});
