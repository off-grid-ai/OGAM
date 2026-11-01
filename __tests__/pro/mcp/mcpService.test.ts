/**
 * Real-behavior tests for pro/mcp/mcpService.ts — the MCP orchestration layer.
 *
 * Everything that is ours runs for real: the module under test, the real McpClient, the real OAuth
 * client (discovery through the real MCP SDK, registration, PKCE, token exchange, refresh, token
 * store), the real Zustand `useMcpStore` and `useRemoteServerStore`, and the real
 * `schemaTrim.truncateDescription`.
 *
 * Faked: only the network and the native OAuth adapters.
 *   - XMLHttpRequest: MCP servers by URL (serveMcp below). A server answers initialize, tools/list
 *     and tools/call, records the headers and params it received, and a protected one answers 401
 *     to any request without a live Bearer token.
 *   - fetch: the OAuth side (serveMcp below): protected-resource and authorization-server metadata,
 *     dynamic client registration, and a token endpoint that issues and refreshes tokens.
 *   - The OAuth native adapters (system browser, Keychain, crypto) through configureOAuthAdapters,
 *     the seam the app wires its native modules into at boot.
 * The app loads the MCP SDK's discovery code from its ESM build with a dynamic import(), which
 * jest's CommonJS VM cannot run, so the same SDK's CommonJS build is served in its place.
 */

jest.mock(
  '@modelcontextprotocol/sdk/dist/esm/client/auth.js',
  () => require('../../../node_modules/@modelcontextprotocol/sdk/dist/cjs/client/auth.js'),
  { virtual: true },
);

import {
  connectServer,
  reconnectSavedServers,
  disconnectServer,
  signOutServer,
  getMcpToolsPrompt,
  parseMcpToolCallsFromText,
  executeMcpTool,
  getServerToolCount,
  TOKENS_PER_TOOL,
} from '@offgrid/pro/mcp/mcpService';
import { useMcpStore } from '@offgrid/pro/mcp/mcpStore';
import { useRemoteServerStore } from '@offgrid/core/stores';
import { NeedsAuthorizationError } from '@offgrid/pro/mcp/oauth';
import { configureOAuthAdapters } from '@offgrid/pro/mcp/oauth/adapters';
import type { McpServerConfig, McpTool } from '@offgrid/pro/mcp/types';

const tool = (
  name: string,
  description = 'a tool',
  extra: Partial<McpTool> = {},
): McpTool => ({
  name,
  description,
  inputSchema: { type: 'object' },
  ...extra,
});

// ---------------------------------------------------------------------------
// The network: MCP servers over XMLHttpRequest, their authorization server over fetch.
// ---------------------------------------------------------------------------

const AUTH_ISSUER = 'https://auth.example.test';
const TOKEN_ENDPOINT = `${AUTH_ISSUER}/token`;
const REGISTRATION_ENDPOINT = `${AUTH_ISSUER}/register`;

interface ServerSpec {
  tools?: McpTool[];
  /** The handshake answers with this JSON-RPC error. */
  initializeError?: string;
  /** tools/call answers with this text as a tool-level error (isError). */
  toolError?: string;
  /** Text tools/call answers with (default: "<tool> ran"). */
  toolResult?: string;
  /** Requires a live Bearer token from the authorization server. */
  oauth?: boolean;
  /** Requires this exact header. */
  header?: { name: string; value: string };
}

interface McpRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  params: Record<string, unknown>;
}

interface Network {
  /** Every JSON-RPC request that reached an MCP server, in order. */
  requests: McpRequest[];
  /** Every request to the authorization server, in order. */
  oauth: Array<{ method: string; url: string; body: string }>;
  /** Requests the client cancelled before an answer. */
  aborted: string[];
  /** Hold the next tools/list to `url` until release(). */
  holdToolsList(url: string): () => void;
  /** The authorization server forgets every access token it issued (refresh tokens stay valid). */
  revokeAccessTokens(): void;
  /** The browser the sign-in opened, one URL per sign-in. */
  signIns: string[];
  restore(): void;
}

function serveMcp(servers: Record<string, ServerSpec>): Network {
  const requests: McpRequest[] = [];
  const oauthRequests: Network['oauth'] = [];
  const aborted: string[] = [];
  const holds = new Map<string, Promise<void>>();
  const liveAccess = new Set<string>();
  const liveRefresh = new Set<string>();
  let issued = 0;

  class McpXHR {
    status = 0;
    responseText = '';
    timeout = 0;
    onload: null | (() => void) = null;
    onerror: null | (() => void) = null;
    ontimeout: null | (() => void) = null;
    onabort: null | (() => void) = null;
    private url = '';
    private sent: Record<string, string> = {};
    private answered: Record<string, string> = {};
    private done = false;
    open(_m: string, url: string) { this.url = url; }
    setRequestHeader(name: string, value: string) { this.sent[name.toLowerCase()] = value; }
    getResponseHeader(name: string) { return this.answered[name.toLowerCase()] ?? null; }
    abort() {
      if (this.done) return;
      this.done = true;
      aborted.push(this.url);
      this.onabort?.();
    }
    send(payload: string) {
      const req = JSON.parse(payload) as { id: number; method: string; params: Record<string, unknown> };
      const server = servers[this.url];
      requests.push({ url: this.url, method: req.method, headers: { ...this.sent }, params: req.params });
      const hold = req.method === 'tools/list' ? holds.get(this.url) : undefined;
      if (hold) holds.delete(this.url);
      const reply = () => setTimeout(() => {
        if (this.done) return;
        this.done = true;
        if (!server) { this.onerror?.(); return; }
        const bearer = (this.sent.authorization ?? '').replace(/^Bearer\s+/i, '');
        if (server.oauth && !liveAccess.has(bearer)) {
          this.status = 401;
          this.answered = { 'www-authenticate': 'Bearer' };
          this.onload?.();
          return;
        }
        if (server.header && this.sent[server.header.name.toLowerCase()] !== server.header.value) {
          this.status = 401;
          this.onload?.();
          return;
        }
        this.status = 200;
        this.answered = { 'content-type': 'application/json' };
        let body: Record<string, unknown> = { jsonrpc: '2.0', id: req.id };
        if (req.method === 'initialize') {
          body = server.initializeError
            ? { ...body, error: { code: -32603, message: server.initializeError } }
            : { ...body, result: { protocolVersion: '2024-11-05', capabilities: { tools: {} } } };
        } else if (req.method === 'tools/list') {
          body = { ...body, result: { tools: server.tools ?? [] } };
        } else if (req.method === 'tools/call') {
          const name = String(req.params.name);
          body = server.toolError
            ? { ...body, result: { isError: true, content: [{ type: 'text', text: server.toolError }] } }
            : { ...body, result: { content: [{ type: 'text', text: server.toolResult ?? `${name} ran` }] } };
        }
        this.responseText = JSON.stringify(body);
        this.onload?.();
      }, 0);
      if (hold) hold.then(reply); else reply();
    }
  }

  const issue = () => {
    issued += 1;
    const access = `access-${issued}`;
    const refresh = `refresh-${issued}`;
    liveAccess.add(access);
    liveRefresh.add(refresh);
    return { access_token: access, refresh_token: refresh, token_type: 'Bearer', expires_in: 3600 };
  };
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const metadata = {
    issuer: AUTH_ISSUER,
    authorization_endpoint: `${AUTH_ISSUER}/authorize`,
    token_endpoint: TOKEN_ENDPOINT,
    registration_endpoint: REGISTRATION_ENDPOINT,
    token_endpoint_auth_methods_supported: ['none'],
    response_types_supported: ['code'],
  };

  const originalXHR = (global as unknown as { XMLHttpRequest: unknown }).XMLHttpRequest;
  (global as unknown as { XMLHttpRequest: unknown }).XMLHttpRequest = McpXHR;
  const fetchSpy = jest.spyOn(global, 'fetch').mockImplementation(async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const method = init?.method ?? 'GET';
    const body = typeof init?.body === 'string' ? init.body : '';
    if (url.includes('/.well-known/oauth-protected-resource')) {
      const resource = Object.keys(servers).find(u => url.startsWith(new URL(u).origin));
      return json({ resource, authorization_servers: [AUTH_ISSUER] });
    }
    if (!url.startsWith(AUTH_ISSUER)) return new Response('', { status: 404 });
    oauthRequests.push({ method, url, body });
    if (url.startsWith(`${AUTH_ISSUER}/.well-known/`)) return json(metadata);
    if (method === 'POST' && url === REGISTRATION_ENDPOINT) return json({ client_id: 'registered-client' }, 201);
    if (method === 'POST' && url === TOKEN_ENDPOINT) {
      const form = new URLSearchParams(body);
      if (form.get('grant_type') === 'authorization_code') return json(issue());
      if (form.get('grant_type') === 'refresh_token' && liveRefresh.has(form.get('refresh_token') ?? '')) {
        return json(issue());
      }
      return json({ error: 'invalid_grant' }, 400);
    }
    return new Response('', { status: 404 });
  });

  const signIns: string[] = [];
  return {
    requests,
    oauth: oauthRequests,
    aborted,
    signIns,
    holdToolsList(url) {
      let release = () => {};
      holds.set(url, new Promise<void>(resolve => { release = resolve; }));
      return () => release();
    },
    revokeAccessTokens() { liveAccess.clear(); },
    restore() {
      (global as unknown as { XMLHttpRequest: unknown }).XMLHttpRequest = originalXHR;
      fetchSpy.mockRestore();
    },
  };
}

// ---------------------------------------------------------------------------
// The native OAuth adapters: the system browser, the Keychain, crypto.
// ---------------------------------------------------------------------------

/** The Keychain: what the app writes is what it reads back; it can be made to fail. */
const keychain = {
  items: new Map<string, string>(),
  failReads: null as Error | null,
  failDeletes: null as Error | null,
  async getItem(key: string) {
    if (this.failReads) throw this.failReads;
    return this.items.get(key) ?? null;
  },
  async setItem(key: string, value: string) { this.items.set(key, value); },
  async removeItem(key: string) {
    if (this.failDeletes) throw this.failDeletes;
    this.items.delete(key);
  },
};

let network: Network;

/** The person signs in: the browser returns to the app with a code and the state it was sent. */
function installAdapters() {
  configureOAuthAdapters({
    browser: {
      authorize: async (authUrl: string) => {
        network.signIns.push(authUrl);
        const state = new URL(authUrl).searchParams.get('state');
        return `offgrid://oauth/callback?code=the-code&state=${state}`;
      },
    },
    storage: {
      getItem: key => keychain.getItem(key),
      setItem: (key, value) => keychain.setItem(key, value),
      removeItem: key => keychain.removeItem(key),
    },
    crypto: {
      randomBytes: async n => Uint8Array.from({ length: n }, (_, i) => (i * 13) % 256),
      sha256: async () => Uint8Array.from({ length: 32 }, (_, i) => i),
    },
    redirectUri: 'offgrid://oauth/callback',
    clientName: 'Off Grid AI',
  });
}

const tokenKey = (serverId: string) => `mcp_oauth_tokens_${serverId}`;

// Reset the REAL stores to a clean slate between tests.
function resetStores() {
  for (const server of useMcpStore.getState().servers) {
    disconnectServer(server.id);
  }
  useMcpStore.setState({
    servers: [],
    connectionStates: {},
    serverTools: {},
    enabledTools: [],
    knownToolNames: [],
    toolOwners: {},
  });
  useRemoteServerStore.setState({ activeRemoteTextModelId: null } as any);
}

const addServer = (server: McpServerConfig) => useMcpStore.getState().addServer(server);

beforeEach(() => {
  keychain.items.clear();
  keychain.failReads = null;
  keychain.failDeletes = null;
  resetStores();
  installAdapters();
});

afterEach(() => {
  resetStores();
  network?.restore();
  jest.restoreAllMocks();
});
describe('parseMcpToolCallsFromText', () => {
  it('extracts a single well-formed call and strips its tag from the text', () => {
    const text =
      'before <mcp_tool_call>{"name":"search","arguments":{"q":"x"}}</mcp_tool_call> after';
    const { calls, cleanedText } = parseMcpToolCallsFromText(text);
    expect(calls).toHaveLength(1);
    expect(calls[0].name).toBe('search');
    expect(calls[0].arguments).toEqual({ q: 'x' });
    expect(cleanedText).toBe('before  after');
  });

  it('extracts multiple calls in order and removes all tags', () => {
    const text =
      '<mcp_tool_call>{"name":"a"}</mcp_tool_call>mid<mcp_tool_call>{"name":"b","arguments":{"k":1}}</mcp_tool_call>';
    const { calls, cleanedText } = parseMcpToolCallsFromText(text);
    expect(calls.map(c => c.name)).toEqual(['a', 'b']);
    expect(calls[0].arguments).toEqual({}); // defaulted when arguments absent
    expect(calls[1].arguments).toEqual({ k: 1 });
    expect(cleanedText).toBe('mid');
  });

  it('skips a malformed JSON block (catch branch) but still returns others', () => {
    const text =
      '<mcp_tool_call>{not json}</mcp_tool_call><mcp_tool_call>{"name":"good"}</mcp_tool_call>';
    const { calls, cleanedText } = parseMcpToolCallsFromText(text);
    expect(calls.map(c => c.name)).toEqual(['good']);
    expect(cleanedText).toBe('');
  });

  it('skips a valid-JSON block with no name (falsy parsed.name branch)', () => {
    const text = '<mcp_tool_call>{"arguments":{"a":1}}</mcp_tool_call>tail';
    const { calls, cleanedText } = parseMcpToolCallsFromText(text);
    expect(calls).toHaveLength(0);
    // The tag range is still removed even though no call was produced.
    expect(cleanedText).toBe('tail');
  });

  it('returns no calls and the original (trimmed) text when there is no tag', () => {
    const { calls, cleanedText } = parseMcpToolCallsFromText('  plain text  ');
    expect(calls).toHaveLength(0);
    expect(cleanedText).toBe('plain text');
  });

  it('assigns unique ids across the returned calls', () => {
    const text =
      '<mcp_tool_call>{"name":"a"}</mcp_tool_call><mcp_tool_call>{"name":"b"}</mcp_tool_call>';
    const { calls } = parseMcpToolCallsFromText(text);
    expect(calls[0].id).not.toBe(calls[1].id);
  });
});

describe('getMcpToolsPrompt', () => {
  it('returns empty string when no tools are enabled (early return)', () => {
    expect(getMcpToolsPrompt([])).toBe('');
  });

  it('returns empty string when enabled tools have no owner/serverTools entry', () => {
    // enabled names exist but toolOwners is empty -> described.length === 0
    expect(getMcpToolsPrompt(['ghost_tool'])).toBe('');
  });

  it('injects owned tools into the prompt with the tool-call tag', () => {
    useMcpStore.setState({
      toolOwners: { search: 'srv1' },
      serverTools: { srv1: [tool('search', 'find things')] },
    });
    useRemoteServerStore.setState({
      activeRemoteTextModelId: 'remote-x',
    } as any);
    const prompt = getMcpToolsPrompt(['search']);
    expect(prompt).toContain('mcp_tool_call');
    expect(prompt).toContain('- search: find things');
  });

  it('truncates descriptions for on-device models (no active remote text model)', () => {
    const long = `First sentence here. ${'x'.repeat(400)}`;
    useMcpStore.setState({
      toolOwners: { search: 'srv1' },
      serverTools: { srv1: [tool('search', long)] },
    });
    useRemoteServerStore.setState({ activeRemoteTextModelId: null } as any);
    const prompt = getMcpToolsPrompt(['search']);
    expect(prompt).toContain('- search: First sentence here.');
    expect(prompt).not.toContain('x'.repeat(400));
  });

  it('keeps the full description for remote models (trim=false branch)', () => {
    const long = `First sentence here. ${'y'.repeat(400)}`;
    useMcpStore.setState({
      toolOwners: { search: 'srv1' },
      serverTools: { srv1: [tool('search', long)] },
    });
    useRemoteServerStore.setState({
      activeRemoteTextModelId: 'remote-x',
    } as any);
    const prompt = getMcpToolsPrompt(['search']);
    expect(prompt).toContain('y'.repeat(400));
  });

  it('drops enabled names that no server owns while keeping owned ones', () => {
    useMcpStore.setState({
      toolOwners: { owned: 'srv1' },
      serverTools: { srv1: [tool('owned')] },
    });
    useRemoteServerStore.setState({
      activeRemoteTextModelId: 'remote-x',
    } as any);
    const prompt = getMcpToolsPrompt(['owned', 'orphan']);
    expect(prompt).toContain('- owned:');
    expect(prompt).not.toContain('orphan');
  });
});

describe('getServerToolCount', () => {
  it('returns the count of a server whose tools are loaded', () => {
    useMcpStore.setState({ serverTools: { srv1: [tool('a'), tool('b')] } });
    expect(getServerToolCount('srv1')).toBe(2);
  });

  it('returns 0 for a server with no tools loaded (?? fallback)', () => {
    expect(getServerToolCount('unknown')).toBe(0);
  });
});

describe('connectServer', () => {
  it('throws when the server id is unknown (real store lookup)', async () => {
    await expect(connectServer('nope')).rejects.toThrow(
      'Server nope not found',
    );
  });

  it('connects a no-auth server: real store gets connected state + tools + owners', async () => {
    const tools = [tool('search')];
    network = serveMcp({ 'https://s1/mcp': { tools } });
    addServer({ id: 'srv1', name: 'S1', url: 'https://s1/mcp' });

    await connectServer('srv1');

    const st = useMcpStore.getState();
    expect(st.connectionStates.srv1).toBe('connected');
    expect(st.serverTools.srv1).toEqual(tools);
    expect(st.toolOwners.search).toBe('srv1');
    // No-auth server: nothing that looks like credentials reached it.
    expect(network.requests.every(r => !('authorization' in r.headers))).toBe(true);
  });

  it('sends the static header to header-auth servers', async () => {
    network = serveMcp({ 'https://h/mcp': { header: { name: 'X-Api-Key', value: 'secret' } } });
    addServer({
      id: 'srvh',
      name: 'H',
      url: 'https://h/mcp',
      authMode: 'header',
      authHeaderName: 'X-Api-Key',
      authHeaderValue: 'secret',
    });
    await connectServer('srvh');
    expect(network.requests[0].headers['x-api-key']).toBe('secret');
    expect(useMcpStore.getState().connectionStates.srvh).toBe('connected');
  });

  it('marks the server "error" and rethrows when the handshake fails', async () => {
    network = serveMcp({ 'https://bad/mcp': { initializeError: 'handshake boom', tools: [tool('badtool')] } });
    addServer({ id: 'bad', name: 'B', url: 'https://bad/mcp' });

    await expect(connectServer('bad')).rejects.toThrow('handshake boom');
    expect(useMcpStore.getState().connectionStates.bad).toBe('error');
    // Failed connect must NOT register a live client or tools, so its tool can't be executed.
    expect(useMcpStore.getState().serverTools.bad).toBeUndefined();
    await expect(executeMcpTool('badtool', {})).rejects.toThrow();
    expect(network.requests.some(r => r.method === 'tools/call')).toBe(false);
  });

  it('discards a stale connection after the route is replaced', async () => {
    network = serveMcp({ 'http://old/mcp': { tools: [tool('computer_use')] } });
    addServer({ id: 'moving', name: 'Mac', url: 'http://old/mcp' });
    const finishList = network.holdToolsList('http://old/mcp');

    const pending = connectServer('moving');
    await new Promise(resolve => setTimeout(resolve, 10));
    disconnectServer('moving');
    finishList();
    await pending;

    // None of the superseded connection's data landed, and its client was not kept live.
    expect(useMcpStore.getState().connectionStates.moving).toBeUndefined();
    expect(useMcpStore.getState().serverTools.moving).toBeUndefined();
    await expect(executeMcpTool('computer_use', {})).rejects.toThrow();
    expect(network.requests.some(r => r.method === 'tools/call')).toBe(false);
  });

  describe('oauth flow', () => {
    const OAUTH_URL = 'https://o.example.test/mcp';
    let n = 0;
    /** A fresh server id per test: the token store caches tokens per server for the app's life. */
    const oauthServer = (extra: Partial<McpServerConfig> = {}): McpServerConfig => ({
      id: `o-${++n}`,
      name: 'O',
      url: OAUTH_URL,
      authMode: 'oauth',
      ...extra,
    });

    beforeEach(() => {
      network = serveMcp({ [OAUTH_URL]: { oauth: true, tools: [tool('o_search')] } });
    });

    /** Sign in once, then drop the live client, as a server the user connected in an earlier session. */
    async function signedInEarlier(server: McpServerConfig) {
      addServer(server);
      await connectServer(server.id, true);
      disconnectServer(server.id);
      return useMcpStore.getState().servers.find(s => s.id === server.id)!;
    }

    it('runs interactive authorize when there is no cached metadata, stores it, and connects', async () => {
      const srv = oauthServer();
      addServer(srv);

      await connectServer(srv.id, true);

      const st = useMcpStore.getState();
      // The person signed in once in the system browser.
      expect(network.signIns).toHaveLength(1);
      // Metadata discovered from the server got persisted onto the server config by the real store.
      expect(st.servers.find(s => s.id === srv.id)?.oauth).toMatchObject({
        auth: { tokenEndpoint: TOKEN_ENDPOINT },
        client: { clientId: 'registered-client' },
      });
      expect(st.connectionStates[srv.id]).toBe('connected');
      // The MCP server received the Bearer token the authorization server issued.
      expect(network.requests.at(-1)?.headers.authorization).toBe('Bearer access-1');
    });

    it('does NOT pop a browser on a silent connect with no cached metadata (throws NeedsAuthorization -> error)', async () => {
      const srv = oauthServer();
      addServer(srv);

      await expect(connectServer(srv.id, false)).rejects.toBeInstanceOf(
        NeedsAuthorizationError,
      );
      expect(network.signIns).toHaveLength(0);
      expect(useMcpStore.getState().connectionStates[srv.id]).toBe('error');
    });

    it('re-consents interactively when the saved tokens are gone (ensureAccessToken -> NeedsAuthorization)', async () => {
      const srv = await signedInEarlier(oauthServer());
      const firstMetadata = srv.oauth;
      // The Keychain lost the tokens (the person reset the device's secure storage).
      keychain.items.delete(tokenKey(srv.id));
      await signOutCacheOnly(srv.id);

      await connectServer(srv.id, true);

      expect(network.signIns).toHaveLength(2);
      expect(useMcpStore.getState().connectionStates[srv.id]).toBe('connected');
      expect(useMcpStore.getState().servers.find(s => s.id === srv.id)?.oauth).toEqual(firstMetadata);
    });

    it('does NOT re-consent on a silent connect when the saved tokens are gone (rethrows)', async () => {
      const srv = await signedInEarlier(oauthServer());
      await signOutCacheOnly(srv.id);

      await expect(connectServer(srv.id, false)).rejects.toBeInstanceOf(
        NeedsAuthorizationError,
      );
      expect(network.signIns).toHaveLength(1); // only the earlier sign-in
      expect(useMcpStore.getState().connectionStates[srv.id]).toBe('error');
    });

    it('rethrows a non-auth error from ensureAccessToken without re-consenting (else branch)', async () => {
      // A server saved with its sign-in metadata from an earlier launch: this launch has not read
      // its tokens yet, and the Keychain read fails.
      const earlier = await signedInEarlier(oauthServer());
      const srv = oauthServer({ oauth: earlier.oauth });
      addServer(srv);
      keychain.failReads = new Error('keychain locked');

      await expect(connectServer(srv.id, true)).rejects.toThrow('keychain locked');
      expect(network.signIns).toHaveLength(1);
      expect(useMcpStore.getState().connectionStates[srv.id]).toBe('error');
    });

    it('passes a manual client (oauthClientId) into the authorize flow', async () => {
      const srv = oauthServer({ oauthClientId: 'client-abc', oauthClientSecret: 'shh' });
      addServer(srv);

      await connectServer(srv.id, true);

      // No dynamic registration; the sign-in and the code exchange used the manual client.
      expect(network.oauth.some(r => r.url === REGISTRATION_ENDPOINT)).toBe(false);
      expect(new URL(network.signIns[0]).searchParams.get('client_id')).toBe('client-abc');
      const exchange = network.oauth.find(r => r.url === TOKEN_ENDPOINT)!;
      expect(exchange.body).toContain('client_id=client-abc');
      expect(exchange.body).toContain('client_secret=shh');
    });

    it('refreshes the token and retries when the server answers 401 (onUnauthorized -> forceRefresh)', async () => {
      const srv = oauthServer();
      addServer(srv);
      await connectServer(srv.id, true);
      // The authorization server expires every access token it issued.
      network.revokeAccessTokens();

      const res = await executeMcpTool('o_search', {});

      expect(res.content).toBe('o_search ran');
      const refresh = network.oauth.find(r => r.url === TOKEN_ENDPOINT && r.body.includes('grant_type=refresh_token'));
      expect(refresh?.body).toContain('refresh_token=refresh-1');
      expect(network.requests.at(-1)?.headers.authorization).toBe('Bearer access-2');
    });
  });
});

/**
 * Forget a server's tokens the way a sign-out does, but keep its cached OAuth metadata: the state of
 * a server whose tokens are gone while the app still remembers how to sign in to it.
 */
async function signOutCacheOnly(serverId: string) {
  const { revokeLocalTokens } = require('@offgrid/pro/mcp/oauth');
  await revokeLocalTokens(serverId);
}

describe('reconnectSavedServers', () => {
  it('no-ops when there are no saved servers', async () => {
    network = serveMcp({});
    await reconnectSavedServers();
    expect(network.requests).toHaveLength(0);
  });

  it('reconnects every saved server silently and never throws even if one fails', async () => {
    network = serveMcp({
      'https://ok/mcp': { tools: [tool('ok_tool')] },
      'https://fail/mcp': { initializeError: 'down' },
    });
    addServer({ id: 'ok', name: 'ok', url: 'https://ok/mcp' });
    addServer({ id: 'fail', name: 'fail', url: 'https://fail/mcp' });

    await expect(reconnectSavedServers()).resolves.toBeUndefined();
    const st = useMcpStore.getState();
    // Both servers reached a terminal state; the failure did not abort the other.
    expect(st.connectionStates.ok).toBe('connected');
    expect(st.connectionStates.fail).toBe('error');
  });
});

describe('executeMcpTool', () => {
  it('throws when no server owns the tool', async () => {
    await expect(executeMcpTool('unknown', {})).rejects.toThrow(
      'No server owns tool "unknown"',
    );
  });

  it('throws when the owning server has no live client', async () => {
    // Tool owners are saved across launches; live clients are not. After a relaunch the owner is
    // known before the server reconnects.
    useMcpStore.setState({ toolOwners: { orphan: 'srvX' } });
    await expect(executeMcpTool('orphan', {})).rejects.toThrow(
      'Server "srvX" is not connected',
    );
  });

  it('routes to the live client and returns its content + a duration', async () => {
    network = serveMcp({ 'https://l/mcp': { tools: [tool('search')], toolResult: 'tool output' } });
    addServer({ id: 'srvL', name: 'L', url: 'https://l/mcp' });
    await connectServer('srvL');

    const res = await executeMcpTool(
      'search',
      { q: 'hi' },
      {
        launchId: 'launch-private-chat',
        conversationId: 'private-chat',
        deviceId: 'phone-1',
      },
    );
    // An arbitrary MCP server must not receive private chat or device identity.
    const call = network.requests.find(r => r.method === 'tools/call')!;
    expect(call.params).toEqual({ name: 'search', arguments: { q: 'hi' } });
    expect(res.content).toBe('tool output');
    expect(typeof res.durationMs).toBe('number');
    expect(res.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('binds a paired Desktop action to the originating Mobile chat', async () => {
    network = serveMcp({ 'http://office-mac/mcp': { tools: [tool('web_use')], toolResult: 'task started' } });
    addServer({
      id: 'desktop-tools',
      name: 'Office Mac',
      url: 'http://office-mac/mcp',
      grantedByDeviceId: 'desktop-1',
    });
    await connectServer('desktop-tools');

    await executeMcpTool(
      'web_use',
      { task: 'Find a flight' },
      {
        launchId: 'launch-chat-mobile-1',
        conversationId: 'chat-mobile-1',
        deviceId: 'phone-1',
        deviceName: 'Ali phone',
      },
    );

    const call = network.requests.find(r => r.method === 'tools/call')!;
    expect(call.params).toEqual({
      name: 'web_use',
      arguments: { task: 'Find a flight' },
      _meta: {
        'ai.offgrid/taskOrigin': {
          launchId: 'launch-chat-mobile-1',
          conversationId: 'chat-mobile-1',
          deviceId: 'phone-1',
          deviceName: 'Ali phone',
        },
      },
    });
  });

  it('propagates an error the tool reports', async () => {
    network = serveMcp({ 'https://e/mcp': { tools: [tool('boom')], toolError: 'tool blew up' } });
    addServer({ id: 'srvE', name: 'E', url: 'https://e/mcp' });
    await connectServer('srvE');
    await expect(executeMcpTool('boom', {})).rejects.toThrow('tool blew up');
  });
});

describe('disconnectServer', () => {
  it('drops the live client and clears connection + tool data in the real store', async () => {
    network = serveMcp({ 'https://d/mcp': { tools: [tool('t')] } });
    addServer({ id: 'srvD', name: 'D', url: 'https://d/mcp' });
    await connectServer('srvD');
    expect(useMcpStore.getState().connectionStates.srvD).toBe('connected');

    disconnectServer('srvD');

    const st = useMcpStore.getState();
    // disconnectServer sets 'disconnected' then clearServerData removes the key entirely,
    // so the tool list AND the connection-state entry are both gone.
    expect(st.connectionStates.srvD).toBeUndefined();
    expect(st.serverTools.srvD).toBeUndefined();
    // The live client is gone: its tool can no longer be executed.
    await expect(executeMcpTool('t', {})).rejects.toThrow();
    expect(network.requests.some(r => r.method === 'tools/call')).toBe(false);
  });
});

describe('signOutServer', () => {
  const OAUTH_URL = 'https://s.example.test/mcp';

  it('revokes tokens, drops the client, and clears cached oauth metadata', async () => {
    network = serveMcp({ [OAUTH_URL]: { oauth: true, tools: [tool('t')] } });
    addServer({ id: 'srvS', name: 'S', url: OAUTH_URL, authMode: 'oauth' });
    await connectServer('srvS', true);
    expect(keychain.items.has(tokenKey('srvS'))).toBe(true);

    await signOutServer('srvS');

    expect(keychain.items.has(tokenKey('srvS'))).toBe(false);
    expect(useMcpStore.getState().servers[0].oauth).toBeUndefined();
    await expect(executeMcpTool('t', {})).rejects.toThrow('is not connected');
  });

  it('still clears metadata + client when token revoke rejects (swallowed catch)', async () => {
    network = serveMcp({ [OAUTH_URL]: { oauth: true, tools: [tool('t2')] } });
    addServer({ id: 'srvS2', name: 'S', url: OAUTH_URL, authMode: 'oauth' });
    await connectServer('srvS2', true);
    keychain.failDeletes = new Error('revoke failed');

    // The rejected revoke is caught internally -> signOut resolves and still clears state.
    await expect(signOutServer('srvS2')).resolves.toBeUndefined();
    expect(useMcpStore.getState().servers[0].oauth).toBeUndefined();
    await expect(executeMcpTool('t2', {})).rejects.toThrow('is not connected');
  });
});

describe('integration: connect -> prompt -> execute (real store + real trim)', () => {
  it('a connected server flows tools into the prompt and executes through the live client', async () => {
    network = serveMcp({
      'https://f/mcp': { tools: [tool('notion_search', 'Search the workspace.')], toolResult: 'search result' },
    });
    addServer({ id: 'flow', name: 'F', url: 'https://f/mcp' });

    await connectServer('flow');

    // setServerTools auto-enabled the freshly-discovered tool in the REAL store.
    const enabled = useMcpStore.getState().enabledTools;
    expect(enabled).toContain('notion_search');

    // The prompt reflects the discovered tool.
    const prompt = getMcpToolsPrompt(enabled);
    expect(prompt).toContain('- notion_search: Search the workspace.');

    // Execute through the live client registered by connectServer.
    const res = await executeMcpTool('notion_search', { q: 'hi' });
    expect(res.content).toBe('search result');
  });
});

describe('constants', () => {
  it('exposes the per-tool token estimate', () => {
    expect(TOKENS_PER_TOOL).toBe(50);
  });
});
