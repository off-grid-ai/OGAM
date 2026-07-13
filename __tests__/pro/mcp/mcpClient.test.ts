import { McpClient } from '@offgrid/pro/mcp/mcpClient';
import type { McpClientConfig } from '@offgrid/pro/mcp/mcpClient';

/**
 * The only genuine boundary McpClient touches is the network transport
 * (XMLHttpRequest). We install a scripted fake XHR that records the outgoing
 * request and returns a queued, test-supplied response. Everything else — the
 * JSON-RPC framing, 401 retry, error propagation, SSE parsing, session-id
 * capture, content extraction — is the REAL McpClient logic under test.
 */

type XhrResult =
  | {
      kind: 'load';
      status: number;
      responseText?: string;
      headers?: Record<string, string>;
    }
  | { kind: 'error' }
  | { kind: 'timeout' };

interface RecordedRequest {
  method: string;
  url: string;
  requestHeaders: Record<string, string>;
  body: string;
}

let responseQueue: XhrResult[] = [];
let recorded: RecordedRequest[] = [];
let realXhr: unknown;

class FakeXhr {
  status = 0;
  responseText = '';
  timeout = 0;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  ontimeout: (() => void) | null = null;

  private _method = '';
  private _url = '';
  private _reqHeaders: Record<string, string> = {};
  private _respHeaders: Record<string, string> = {};

  open(method: string, url: string) {
    this._method = method;
    this._url = url;
  }

  setRequestHeader(name: string, value: string) {
    this._reqHeaders[name] = value;
  }

  getResponseHeader(name: string): string | null {
    // XHR header lookups are case-insensitive; the client uses lowercase names.
    const lower = name.toLowerCase();
    for (const [k, v] of Object.entries(this._respHeaders)) {
      if (k.toLowerCase() === lower) return v;
    }
    return null;
  }

  send(payload: string) {
    recorded.push({
      method: this._method,
      url: this._url,
      requestHeaders: { ...this._reqHeaders },
      body: payload,
    });
    const result = responseQueue.shift();
    if (!result) {
      throw new Error('FakeXhr: no scripted response for this request');
    }
    // Dispatch asynchronously, mirroring real XHR callback timing.
    setImmediate(() => {
      if (result.kind === 'error') {
        this.onerror?.();
        return;
      }
      if (result.kind === 'timeout') {
        this.ontimeout?.();
        return;
      }
      this.status = result.status;
      this.responseText = result.responseText ?? '';
      this._respHeaders = result.headers ?? {};
      this.onload?.();
    });
  }
}

function queueJson(status: number, body: unknown, headers: Record<string, string> = {}) {
  responseQueue.push({
    kind: 'load',
    status,
    responseText: JSON.stringify(body),
    headers: { 'content-type': 'application/json', ...headers },
  });
}

function makeClient(overrides: Partial<McpClientConfig> = {}): McpClient {
  return new McpClient({ url: 'https://mcp.example.com/rpc', ...overrides });
}

beforeAll(() => {
  realXhr = (global as any).XMLHttpRequest;
  (global as any).XMLHttpRequest = FakeXhr;
});

afterAll(() => {
  (global as any).XMLHttpRequest = realXhr;
});

beforeEach(() => {
  responseQueue = [];
  recorded = [];
});

afterEach(() => {
  // Every scripted response must have been consumed — catches accidental
  // extra/fewer requests (e.g. a retry that shouldn't happen).
  expect(responseQueue).toHaveLength(0);
});

describe('McpClient.initialize', () => {
  it('sends initialize then notifications/initialized as two POSTs', async () => {
    queueJson(200, { jsonrpc: '2.0', id: 1, result: {} });
    queueJson(200, { jsonrpc: '2.0', id: 2, result: {} });

    await makeClient().initialize();

    expect(recorded).toHaveLength(2);
    expect(recorded[0].method).toBe('POST');
    const first = JSON.parse(recorded[0].body);
    expect(first.method).toBe('initialize');
    expect(first.params.protocolVersion).toBe('2024-11-05');
    expect(first.params.clientInfo).toEqual({ name: 'offgrid', version: '1.0' });
    const second = JSON.parse(recorded[1].body);
    expect(second.method).toBe('notifications/initialized');
    // ids are monotonically increasing per client instance
    expect(second.id).toBe(first.id + 1);
  });

  it('swallows a failing notifications/initialized (fire-and-forget)', async () => {
    queueJson(200, { jsonrpc: '2.0', id: 1, result: {} });
    // The initialized notification 500s — initialize() must still resolve.
    queueJson(500, { error: 'boom' });

    await expect(makeClient().initialize()).resolves.toBeUndefined();
    expect(recorded).toHaveLength(2);
  });

  it('throws (and does NOT send the notification) when initialize itself fails', async () => {
    queueJson(500, { jsonrpc: '2.0', error: { message: 'nope' } });

    await expect(makeClient().initialize()).rejects.toThrow(/HTTP 500/);
    // The second rpc must never fire because the first rejected.
    expect(recorded).toHaveLength(1);
  });
});

describe('McpClient.listTools', () => {
  it('returns the tools array from a well-formed response', async () => {
    const tools = [
      { name: 'search', description: 'find', inputSchema: { type: 'object' } },
    ];
    queueJson(200, { jsonrpc: '2.0', id: 1, result: { tools } });

    const result = await makeClient().listTools();
    expect(result).toEqual(tools);
  });

  it('returns [] when result has no tools (?? fallback)', async () => {
    queueJson(200, { jsonrpc: '2.0', id: 1, result: {} });
    expect(await makeClient().listTools()).toEqual([]);
  });

  it('returns [] when the body has no result at all', async () => {
    queueJson(200, { jsonrpc: '2.0', id: 1 });
    expect(await makeClient().listTools()).toEqual([]);
  });
});

describe('McpClient.callTool', () => {
  it('returns joined text content from text blocks', async () => {
    queueJson(200, {
      jsonrpc: '2.0',
      id: 1,
      result: {
        content: [
          { type: 'text', text: 'hello' },
          { type: 'text', text: 'world' },
        ],
      },
    });

    const out = await makeClient().callTool('echo', { q: 1 });
    expect(out).toBe('hello\nworld');
    const sent = JSON.parse(recorded[0].body);
    expect(sent.method).toBe('tools/call');
    expect(sent.params).toEqual({ name: 'echo', arguments: { q: 1 } });
  });

  it('appends a note for non-text blocks alongside text', async () => {
    queueJson(200, {
      jsonrpc: '2.0',
      id: 1,
      result: {
        content: [
          { type: 'text', text: 'caption' },
          { type: 'image', data: 'xxx' },
          { type: 'resource', uri: 'r' },
        ],
      },
    });

    const out = await makeClient().callTool('t', {});
    expect(out).toBe('caption\n[2 non-text result(s) not shown: image, resource]');
  });

  it('returns only the note when there is no text block', async () => {
    queueJson(200, {
      jsonrpc: '2.0',
      id: 1,
      result: { content: [{ type: 'image', data: 'x' }] },
    });

    expect(await makeClient().callTool('t', {})).toBe(
      '[1 non-text result(s) not shown: image]',
    );
  });

  it('returns empty string for empty/absent content', async () => {
    queueJson(200, { jsonrpc: '2.0', id: 1, result: { content: [] } });
    expect(await makeClient().callTool('t', {})).toBe('');
  });

  it('stringifies non-array content', async () => {
    queueJson(200, { jsonrpc: '2.0', id: 1, result: { content: 'plain' } });
    expect(await makeClient().callTool('t', {})).toBe('plain');
  });

  it('throws on a 200 with no result (malformed)', async () => {
    queueJson(200, { jsonrpc: '2.0', id: 1 });
    await expect(makeClient().callTool('t', {})).rejects.toThrow(
      /malformed response \(no result\)/,
    );
  });

  it('throws when result.isError is set, carrying the text detail', async () => {
    queueJson(200, {
      jsonrpc: '2.0',
      id: 1,
      result: { isError: true, content: [{ type: 'text', text: 'rate limited' }] },
    });
    await expect(makeClient().callTool('t', {})).rejects.toThrow(
      /reported an error: rate limited/,
    );
  });

  it('throws with "no detail" when isError is set but no text present', async () => {
    queueJson(200, { jsonrpc: '2.0', id: 1, result: { isError: true, content: [] } });
    await expect(makeClient().callTool('t', {})).rejects.toThrow(
      /reported an error: no detail/,
    );
  });
});

describe('rpc error mapping', () => {
  it('throws on a JSON-RPC error inside a 200 body, with message + code', async () => {
    queueJson(200, {
      jsonrpc: '2.0',
      id: 1,
      error: { message: 'bad method', code: -32601 },
    });
    await expect(makeClient().listTools()).rejects.toThrow(
      'MCP tools/list: bad method (code -32601)',
    );
  });

  it('throws with fallback text when the error has no message/code', async () => {
    queueJson(200, { jsonrpc: '2.0', id: 1, error: {} });
    await expect(makeClient().listTools()).rejects.toThrow(
      'MCP tools/list: server error',
    );
  });

  it('throws HTTP <status> for a >=400 non-401 response', async () => {
    queueJson(503, { jsonrpc: '2.0' });
    await expect(makeClient().listTools()).rejects.toThrow('MCP tools/list: HTTP 503');
  });

  it('rejects with a network error when xhr.onerror fires', async () => {
    responseQueue.push({ kind: 'error' });
    await expect(makeClient().listTools()).rejects.toThrow(
      'MCP tools/list: network error',
    );
  });

  it('rejects with a timeout error when xhr.ontimeout fires', async () => {
    responseQueue.push({ kind: 'timeout' });
    await expect(makeClient().listTools()).rejects.toThrow(
      'MCP tools/list: request timed out',
    );
  });
});

describe('401 / auth retry', () => {
  it('retries once after onUnauthorized returns true, then succeeds', async () => {
    queueJson(401, {}, { 'www-authenticate': 'Bearer realm="x"' });
    queueJson(200, { jsonrpc: '2.0', id: 2, result: { tools: [] } });

    let seenWww: string | null = 'unset';
    const onUnauthorized = jest.fn(async (www: string | null) => {
      seenWww = www;
      return true;
    });

    const result = await makeClient({ onUnauthorized }).listTools();
    expect(result).toEqual([]);
    // Exactly two requests: original + one retry.
    expect(recorded).toHaveLength(2);
    expect(seenWww).toBe('Bearer realm="x"');
  });

  it('does NOT retry and throws 401 when onUnauthorized returns false', async () => {
    queueJson(401, {}, { 'www-authenticate': 'Bearer' });
    const onUnauthorized = jest.fn(async () => false);

    await expect(makeClient({ onUnauthorized }).listTools()).rejects.toThrow(
      'MCP tools/list: unauthorized (401)',
    );
    // The blocking branch: only the original request was sent, no retry.
    expect(recorded).toHaveLength(1);
  });

  it('throws 401 when a retry still returns 401', async () => {
    queueJson(401, {});
    queueJson(401, {});
    const onUnauthorized = jest.fn(async () => true);

    await expect(makeClient({ onUnauthorized }).listTools()).rejects.toThrow(
      'unauthorized (401)',
    );
    expect(recorded).toHaveLength(2);
  });

  it('throws 401 immediately when there is no onUnauthorized handler', async () => {
    queueJson(401, {});
    await expect(makeClient().listTools()).rejects.toThrow('unauthorized (401)');
    expect(recorded).toHaveLength(1);
  });
});

describe('auth headers', () => {
  it('sends the static header when name+value are configured', async () => {
    queueJson(200, { jsonrpc: '2.0', id: 1, result: { tools: [] } });
    await makeClient({
      authHeaderName: 'X-Api-Key',
      authHeaderValue: 'secret',
    }).listTools();
    expect(recorded[0].requestHeaders['X-Api-Key']).toBe('secret');
  });

  it('prefers the async getAuthHeader over the static header', async () => {
    queueJson(200, { jsonrpc: '2.0', id: 1, result: { tools: [] } });
    const getAuthHeader = jest.fn(async () => ({
      name: 'Authorization',
      value: 'Bearer live-token',
    }));
    await makeClient({
      authHeaderName: 'X-Api-Key',
      authHeaderValue: 'secret',
      getAuthHeader,
    }).listTools();

    expect(recorded[0].requestHeaders.Authorization).toBe('Bearer live-token');
    // static header must NOT be applied when the provider wins
    expect(recorded[0].requestHeaders['X-Api-Key']).toBeUndefined();
  });

  it('sends no auth header when getAuthHeader resolves null and no static header', async () => {
    queueJson(200, { jsonrpc: '2.0', id: 1, result: { tools: [] } });
    const getAuthHeader = jest.fn(async () => null);
    await makeClient({ getAuthHeader }).listTools();

    expect(recorded[0].requestHeaders.Authorization).toBeUndefined();
    expect(recorded[0].requestHeaders['X-Api-Key']).toBeUndefined();
  });

  it('re-resolves the auth header on retry (fresh token after refresh)', async () => {
    queueJson(401, {});
    queueJson(200, { jsonrpc: '2.0', id: 2, result: { tools: [] } });

    let call = 0;
    const getAuthHeader = jest.fn(async () => ({
      name: 'Authorization',
      value: `Bearer token-${++call}`,
    }));
    await makeClient({ getAuthHeader, onUnauthorized: async () => true }).listTools();

    expect(recorded[0].requestHeaders.Authorization).toBe('Bearer token-1');
    expect(recorded[1].requestHeaders.Authorization).toBe('Bearer token-2');
  });
});

describe('session id + transport headers', () => {
  it('captures mcp-session-id from a response and sends it on subsequent requests', async () => {
    queueJson(200, { jsonrpc: '2.0', id: 1, result: {} }, { 'mcp-session-id': 'sess-42' });
    queueJson(200, { jsonrpc: '2.0', id: 2, result: {} });

    const client = makeClient();
    await client.initialize();

    // First request had no session id; second (the initialized notification) carries it.
    expect(recorded[0].requestHeaders['mcp-session-id']).toBeUndefined();
    expect(recorded[1].requestHeaders['mcp-session-id']).toBe('sess-42');
  });

  it('always sends Content-Type and Accept headers', async () => {
    queueJson(200, { jsonrpc: '2.0', id: 1, result: { tools: [] } });
    await makeClient().listTools();
    expect(recorded[0].requestHeaders['Content-Type']).toBe('application/json');
    expect(recorded[0].requestHeaders.Accept).toContain('text/event-stream');
  });
});

describe('SSE (text/event-stream) parsing', () => {
  it('parses the first JSON data line out of an SSE body', async () => {
    const tools = [{ name: 't', description: 'd', inputSchema: { type: 'object' } }];
    const sse = `event: message\ndata: ${JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      result: { tools },
    })}\n\n`;
    responseQueue.push({
      kind: 'load',
      status: 200,
      responseText: sse,
      headers: { 'content-type': 'text/event-stream' },
    });

    expect(await makeClient().listTools()).toEqual(tools);
  });

  it('skips [DONE] and blank data lines, returning the real payload', async () => {
    const sse =
      `data: [DONE]\n\n` +
      `data: ${JSON.stringify({ jsonrpc: '2.0', id: 1, result: { tools: [] } })}\n\n`;
    responseQueue.push({
      kind: 'load',
      status: 200,
      responseText: sse,
      headers: { 'content-type': 'text/event-stream' },
    });

    expect(await makeClient().listTools()).toEqual([]);
  });

  it('yields [] (empty result body) when the SSE body has no parseable data', async () => {
    responseQueue.push({
      kind: 'load',
      status: 200,
      responseText: 'event: ping\n\n',
      headers: { 'content-type': 'text/event-stream' },
    });
    // body parses to null -> resp.body null -> result undefined -> [] fallback
    expect(await makeClient().listTools()).toEqual([]);
  });
});

describe('malformed JSON body', () => {
  it('treats unparseable JSON as a null body (listTools -> [])', async () => {
    responseQueue.push({
      kind: 'load',
      status: 200,
      responseText: 'not json at all',
      headers: { 'content-type': 'application/json' },
    });
    expect(await makeClient().listTools()).toEqual([]);
  });
});

describe('integration: full initialize -> listTools -> callTool session', () => {
  it('carries the session id across all three calls and returns tool output', async () => {
    // initialize
    queueJson(200, { jsonrpc: '2.0', id: 1, result: {} }, { 'mcp-session-id': 'S1' });
    // notifications/initialized
    queueJson(200, { jsonrpc: '2.0', id: 2, result: {} });
    // tools/list
    queueJson(200, {
      jsonrpc: '2.0',
      id: 3,
      result: { tools: [{ name: 'greet', description: 'x', inputSchema: { type: 'object' } }] },
    });
    // tools/call
    queueJson(200, {
      jsonrpc: '2.0',
      id: 4,
      result: { content: [{ type: 'text', text: 'hi there' }] },
    });

    const client = makeClient();
    await client.initialize();
    const tools = await client.listTools();
    const out = await client.callTool('greet', { who: 'world' });

    expect(tools.map(t => t.name)).toEqual(['greet']);
    expect(out).toBe('hi there');
    // ids increment monotonically across the whole session
    expect(recorded.map(r => JSON.parse(r.body).id)).toEqual([1, 2, 3, 4]);
    // session id captured on init is echoed on every later request
    expect(recorded[1].requestHeaders['mcp-session-id']).toBe('S1');
    expect(recorded[2].requestHeaders['mcp-session-id']).toBe('S1');
    expect(recorded[3].requestHeaders['mcp-session-id']).toBe('S1');
  });
});
