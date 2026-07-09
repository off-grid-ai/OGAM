/**
 * Real-behavior tests for pro/mcp/mcpService.ts — the MCP orchestration layer.
 *
 * Boundary mocks ONLY:
 *   - '../../../pro/mcp/mcpClient' (McpClient) — the network transport (XHR to a real server).
 *   - '../../../pro/mcp/oauth' — the OAuth boundary (browser consent + secure token storage).
 *   - '@offgrid/core/utils/logger' — noise sink.
 * Everything else runs for REAL: the module under test, the real Zustand `useMcpStore`
 * (persisted through the jest-mocked AsyncStorage), the real `useRemoteServerStore`, and
 * the real `schemaTrim.truncateDescription`. Deleting the implementation must fail these.
 */

jest.mock('@offgrid/core/utils/logger', () => ({
  __esModule: true,
  default: { log: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

// --- McpClient boundary (network transport). A dumb fake that returns plain data. ---
// `mock`-prefixed so the hoisted jest.mock factory may reference them. The fake reads its
// per-test behavior from these module-level knobs (a URL-keyed behavior map + a default).
const mockClientCtor = jest.fn();
const mockClientBehaviorByUrl: Record<
  string,
  { initialize?: () => Promise<void>; listTools?: () => Promise<any[]>; callTool?: () => Promise<string> }
> = {};
jest.mock('../../../pro/mcp/mcpClient', () => {
  class FakeMcpClient {
    config: any;
    constructor(config: any) {
      this.config = config;
      mockClientCtor(config);
    }
    initialize() {
      const b = mockClientBehaviorByUrl[this.config.url];
      return b?.initialize ? b.initialize() : Promise.resolve();
    }
    listTools() {
      const b = mockClientBehaviorByUrl[this.config.url];
      return b?.listTools ? b.listTools() : Promise.resolve([]);
    }
    callTool() {
      const b = mockClientBehaviorByUrl[this.config.url];
      return b?.callTool ? b.callTool() : Promise.resolve('');
    }
  }
  return { McpClient: FakeMcpClient };
});

// --- OAuth boundary (browser + secure token storage). Dumb fakes returning plain data. ---
const mockAuthorizeServer = jest.fn();
const mockEnsureAccessToken = jest.fn();
const mockForceRefresh = jest.fn();
const mockRevokeLocalTokens = jest.fn();
jest.mock('../../../pro/mcp/oauth', () => ({
  authorizeServer: (...a: any[]) => mockAuthorizeServer(...a),
  ensureAccessToken: (...a: any[]) => mockEnsureAccessToken(...a),
  forceRefresh: (...a: any[]) => mockForceRefresh(...a),
  revokeLocalTokens: (...a: any[]) => mockRevokeLocalTokens(...a),
  NeedsAuthorizationError: class NeedsAuthorizationError extends Error {
    serverId: string;
    constructor(serverId: string) {
      super(`Server ${serverId} requires authorization`);
      this.serverId = serverId;
      this.name = 'NeedsAuthorizationError';
    }
  },
}));

import {
  connectServer,
  reconnectSavedServers,
  disconnectServer,
  signOutServer,
  getMcpToolsPrompt,
  parseMcpToolCallsFromText,
  executeMcpTool,
  getServerToolCount,
  _registerClientDirect,
  TOKENS_PER_TOOL,
} from '@offgrid/pro/mcp/mcpService';
import { useMcpStore } from '@offgrid/pro/mcp/mcpStore';
import { useRemoteServerStore } from '@offgrid/core/stores';
import type { McpServerConfig, McpTool } from '@offgrid/pro/mcp/types';
// The SAME NeedsAuthorizationError class the service imports (from the mocked oauth
// module) — required so the service's `err instanceof NeedsAuthorizationError` matches.
const { NeedsAuthorizationError } = require('../../../pro/mcp/oauth');

const tool = (name: string, description = 'a tool', extra: Partial<McpTool> = {}): McpTool => ({
  name,
  description,
  inputSchema: { type: 'object' },
  ...extra,
});

// Reset the REAL stores to a clean slate between tests.
function resetStores() {
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

beforeEach(() => {
  jest.clearAllMocks();
  for (const k of Object.keys(mockClientBehaviorByUrl)) delete mockClientBehaviorByUrl[k];
  resetStores();
});

describe('parseMcpToolCallsFromText', () => {
  it('extracts a single well-formed call and strips its tag from the text', () => {
    const text = 'before <mcp_tool_call>{"name":"search","arguments":{"q":"x"}}</mcp_tool_call> after';
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
    useRemoteServerStore.setState({ activeRemoteTextModelId: 'remote-x' } as any);
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
    useRemoteServerStore.setState({ activeRemoteTextModelId: 'remote-x' } as any);
    const prompt = getMcpToolsPrompt(['search']);
    expect(prompt).toContain('y'.repeat(400));
  });

  it('drops enabled names that no server owns while keeping owned ones', () => {
    useMcpStore.setState({
      toolOwners: { owned: 'srv1' },
      serverTools: { srv1: [tool('owned')] },
    });
    useRemoteServerStore.setState({ activeRemoteTextModelId: 'remote-x' } as any);
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
    await expect(connectServer('nope')).rejects.toThrow('Server nope not found');
  });

  it('connects a no-auth server: real store gets connected state + tools + owners', async () => {
    const srv: McpServerConfig = { id: 'srv1', name: 'S1', url: 'https://s1' };
    useMcpStore.setState({ servers: [srv] });
    // Arm the client at this URL to return one tool.
    const tools = [tool('search')];
    mockClientBehaviorByUrl['https://s1'] = { listTools: () => Promise.resolve(tools) };

    await connectServer('srv1');

    const st = useMcpStore.getState();
    expect(st.connectionStates.srv1).toBe('connected');
    expect(st.serverTools.srv1).toEqual(tools);
    expect(st.toolOwners.search).toBe('srv1');
    // No-auth server: config passed to client had no auth header / provider.
    expect(mockClientCtor).toHaveBeenCalledWith({ url: 'https://s1' });
  });

  it('builds a static-header config for header-auth servers', async () => {
    const srv: McpServerConfig = {
      id: 'srvh',
      name: 'H',
      url: 'https://h',
      authMode: 'header',
      authHeaderName: 'X-Api-Key',
      authHeaderValue: 'secret',
    };
    useMcpStore.setState({ servers: [srv] });
    await connectServer('srvh');
    expect(mockClientCtor).toHaveBeenCalledWith({
      url: 'https://h',
      authHeaderName: 'X-Api-Key',
      authHeaderValue: 'secret',
    });
    expect(useMcpStore.getState().connectionStates.srvh).toBe('connected');
  });

  it('marks the server "error" and rethrows when the handshake fails', async () => {
    const srv: McpServerConfig = { id: 'bad', name: 'B', url: 'https://bad' };
    useMcpStore.setState({ servers: [srv] });
    mockClientBehaviorByUrl['https://bad'] = {
      initialize: () => Promise.reject(new Error('handshake boom')),
    };

    await expect(connectServer('bad')).rejects.toThrow('handshake boom');
    expect(useMcpStore.getState().connectionStates.bad).toBe('error');
    // Failed connect must NOT register a live client, so its tool can't be executed.
    useMcpStore.setState({ toolOwners: { badtool: 'bad' } });
    await expect(executeMcpTool('badtool', {})).rejects.toThrow('is not connected');
  });

  describe('oauth flow', () => {
    const oauthMeta = { authorizationEndpoint: 'https://o/auth', tokenEndpoint: 'https://o/tok' } as any;

    it('runs interactive authorize when there is no cached metadata, stores it, and connects', async () => {
      const srv: McpServerConfig = { id: 'o1', name: 'O', url: 'https://o', authMode: 'oauth' };
      useMcpStore.setState({ servers: [srv] });
      mockAuthorizeServer.mockResolvedValue(oauthMeta);
      mockEnsureAccessToken.mockResolvedValue('tok-123');

      await connectServer('o1', true);

      const st = useMcpStore.getState();
      expect(mockAuthorizeServer).toHaveBeenCalledWith('o1', 'https://o', { manualClient: undefined });
      // Metadata got persisted onto the server config by the real store.
      expect(st.servers[0].oauth).toEqual(oauthMeta);
      expect(st.connectionStates.o1).toBe('connected');
      // The config exposed a getAuthHeader that resolves the bearer token.
      const cfg = mockClientCtor.mock.calls[0][0];
      await expect(cfg.getAuthHeader()).resolves.toEqual({
        name: 'Authorization',
        value: 'Bearer tok-123',
      });
    });

    it('does NOT pop a browser on a silent connect with no cached metadata (throws NeedsAuthorization -> error)', async () => {
      const srv: McpServerConfig = { id: 'o2', name: 'O', url: 'https://o', authMode: 'oauth' };
      useMcpStore.setState({ servers: [srv] });

      await expect(connectServer('o2', false)).rejects.toBeInstanceOf(NeedsAuthorizationError);
      expect(mockAuthorizeServer).not.toHaveBeenCalled();
      expect(useMcpStore.getState().connectionStates.o2).toBe('error');
    });

    it('re-consents interactively when a cached token is dead (ensureAccessToken -> NeedsAuthorization)', async () => {
      const srv: McpServerConfig = {
        id: 'o3',
        name: 'O',
        url: 'https://o',
        authMode: 'oauth',
        oauth: oauthMeta,
      };
      useMcpStore.setState({ servers: [srv] });
      // First mockEnsureAccessToken (the check) fails -> triggers re-authorize; later calls (header) succeed.
      mockEnsureAccessToken
        .mockRejectedValueOnce(new NeedsAuthorizationError('o3'))
        .mockResolvedValue('tok-new');
      mockAuthorizeServer.mockResolvedValue({ ...oauthMeta, reAuthed: true });

      await connectServer('o3', true);

      expect(mockAuthorizeServer).toHaveBeenCalledTimes(1);
      expect(useMcpStore.getState().connectionStates.o3).toBe('connected');
      expect(useMcpStore.getState().servers[0].oauth).toEqual({ ...oauthMeta, reAuthed: true });
    });

    it('does NOT re-consent on a silent connect when the cached token is dead (rethrows)', async () => {
      const srv: McpServerConfig = {
        id: 'o4',
        name: 'O',
        url: 'https://o',
        authMode: 'oauth',
        oauth: oauthMeta,
      };
      useMcpStore.setState({ servers: [srv] });
      mockEnsureAccessToken.mockRejectedValue(new NeedsAuthorizationError('o4'));

      await expect(connectServer('o4', false)).rejects.toBeInstanceOf(NeedsAuthorizationError);
      expect(mockAuthorizeServer).not.toHaveBeenCalled();
      expect(useMcpStore.getState().connectionStates.o4).toBe('error');
    });

    it('rethrows a non-auth error from ensureAccessToken without re-consenting (else branch)', async () => {
      const srv: McpServerConfig = {
        id: 'o5',
        name: 'O',
        url: 'https://o',
        authMode: 'oauth',
        oauth: oauthMeta,
      };
      useMcpStore.setState({ servers: [srv] });
      mockEnsureAccessToken.mockRejectedValue(new Error('network down'));

      await expect(connectServer('o5', true)).rejects.toThrow('network down');
      expect(mockAuthorizeServer).not.toHaveBeenCalled();
      expect(useMcpStore.getState().connectionStates.o5).toBe('error');
    });

    it('passes a manual client (oauthClientId) into the authorize flow', async () => {
      const srv: McpServerConfig = {
        id: 'o6',
        name: 'GH',
        url: 'https://gh',
        authMode: 'oauth',
        oauthClientId: 'client-abc',
        oauthClientSecret: 'shh',
      };
      useMcpStore.setState({ servers: [srv] });
      mockAuthorizeServer.mockResolvedValue(oauthMeta);
      mockEnsureAccessToken.mockResolvedValue('tok');

      await connectServer('o6', true);
      expect(mockAuthorizeServer).toHaveBeenCalledWith('o6', 'https://gh', {
        manualClient: { clientId: 'client-abc', clientSecret: 'shh' },
      });
    });

    it('wires onUnauthorized to forceRefresh for the server', async () => {
      const srv: McpServerConfig = {
        id: 'o7',
        name: 'O',
        url: 'https://o',
        authMode: 'oauth',
        oauth: oauthMeta,
      };
      useMcpStore.setState({ servers: [srv] });
      mockEnsureAccessToken.mockResolvedValue('tok');
      mockForceRefresh.mockResolvedValue(true);

      await connectServer('o7', true);
      const cfg = mockClientCtor.mock.calls[0][0];
      await cfg.onUnauthorized('bearer realm=x');
      expect(mockForceRefresh).toHaveBeenCalledWith('o7', oauthMeta);
    });
  });
});

describe('reconnectSavedServers', () => {
  it('no-ops when there are no saved servers', async () => {
    await reconnectSavedServers();
    expect(mockClientCtor).not.toHaveBeenCalled();
  });

  it('reconnects every saved server silently and never throws even if one fails', async () => {
    useMcpStore.setState({
      servers: [
        { id: 'ok', name: 'ok', url: 'https://ok' },
        { id: 'fail', name: 'fail', url: 'https://fail' },
      ],
    });
    // The 'fail' server's handshake rejects; 'ok' succeeds.
    mockClientBehaviorByUrl['https://fail'] = {
      initialize: () => Promise.reject(new Error('down')),
    };

    await expect(reconnectSavedServers()).resolves.toBeUndefined();
    const st = useMcpStore.getState();
    // Both servers reached a terminal state; the failure did not abort the other.
    expect(st.connectionStates.ok).toBe('connected');
    expect(st.connectionStates.fail).toBe('error');
  });
});

describe('executeMcpTool', () => {
  it('throws when no server owns the tool', async () => {
    await expect(executeMcpTool('unknown', {})).rejects.toThrow('No server owns tool "unknown"');
  });

  it('throws when the owning server has no live client', async () => {
    useMcpStore.setState({ toolOwners: { orphan: 'srvX' } });
    await expect(executeMcpTool('orphan', {})).rejects.toThrow(
      'Server "srvX" is not connected',
    );
  });

  it('routes to the live client and returns its content + a duration', async () => {
    // Register a live client directly (the demo-mode seam) so we exercise real routing.
    const fake = {
      initialize: jest.fn(),
      listTools: jest.fn(),
      callTool: jest.fn().mockResolvedValue('tool output'),
    };
    _registerClientDirect('srvL', fake as any);
    useMcpStore.setState({ toolOwners: { search: 'srvL' } });

    const res = await executeMcpTool('search', { q: 'hi' });
    expect(fake.callTool).toHaveBeenCalledWith('search', { q: 'hi' });
    expect(res.content).toBe('tool output');
    expect(typeof res.durationMs).toBe('number');
    expect(res.durationMs).toBeGreaterThanOrEqual(0);

    disconnectServer('srvL'); // clean up the live client
  });

  it('propagates an error thrown by the client callTool', async () => {
    const fake = {
      initialize: jest.fn(),
      listTools: jest.fn(),
      callTool: jest.fn().mockRejectedValue(new Error('tool blew up')),
    };
    _registerClientDirect('srvE', fake as any);
    useMcpStore.setState({ toolOwners: { boom: 'srvE' } });
    await expect(executeMcpTool('boom', {})).rejects.toThrow('tool blew up');
    disconnectServer('srvE');
  });
});

describe('disconnectServer', () => {
  it('drops the live client and clears connection + tool data in the real store', async () => {
    const fake = { initialize: jest.fn(), listTools: jest.fn(), callTool: jest.fn() };
    _registerClientDirect('srvD', fake as any);
    useMcpStore.setState({
      toolOwners: { t: 'srvD' },
      serverTools: { srvD: [tool('t')] },
      connectionStates: { srvD: 'connected' },
    });

    disconnectServer('srvD');

    const st = useMcpStore.getState();
    // disconnectServer sets 'disconnected' then clearServerData removes the key entirely,
    // so the tool list AND the connection-state entry are both gone.
    expect(st.connectionStates.srvD).toBeUndefined();
    expect(st.serverTools.srvD).toBeUndefined();
    // The live client is gone: executing its tool now fails with "not connected".
    await expect(executeMcpTool('t', {})).rejects.toThrow('is not connected');
  });
});

describe('signOutServer', () => {
  it('revokes tokens, drops the client, and clears cached oauth metadata', async () => {
    const fake = { initialize: jest.fn(), listTools: jest.fn(), callTool: jest.fn() };
    _registerClientDirect('srvS', fake as any);
    useMcpStore.setState({
      servers: [{ id: 'srvS', name: 'S', url: 'https://s', authMode: 'oauth', oauth: { a: 1 } as any }],
      toolOwners: { t: 'srvS' },
    });
    mockRevokeLocalTokens.mockResolvedValue(undefined);

    await signOutServer('srvS');

    expect(mockRevokeLocalTokens).toHaveBeenCalledWith('srvS');
    expect(useMcpStore.getState().servers[0].oauth).toBeUndefined();
    await expect(executeMcpTool('t', {})).rejects.toThrow('is not connected');
  });

  it('still clears metadata + client when token revoke rejects (swallowed catch)', async () => {
    const fake = { initialize: jest.fn(), listTools: jest.fn(), callTool: jest.fn() };
    _registerClientDirect('srvS2', fake as any);
    useMcpStore.setState({
      servers: [{ id: 'srvS2', name: 'S', url: 'https://s', authMode: 'oauth', oauth: { a: 1 } as any }],
    });
    mockRevokeLocalTokens.mockRejectedValue(new Error('revoke failed'));

    // The rejected revoke is caught internally -> signOut resolves and still clears state.
    await expect(signOutServer('srvS2')).resolves.toBeUndefined();
    expect(useMcpStore.getState().servers[0].oauth).toBeUndefined();
  });
});

describe('integration: connect -> prompt -> execute (real store + real trim)', () => {
  it('a connected server flows tools into the prompt and executes through the live client', async () => {
    const srv: McpServerConfig = { id: 'flow', name: 'F', url: 'https://f' };
    useMcpStore.setState({ servers: [srv] });
    const tools = [tool('notion_search', 'Search the workspace.')];
    mockClientBehaviorByUrl['https://f'] = {
      listTools: () => Promise.resolve(tools),
      callTool: () => Promise.resolve('search result'),
    };

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

    disconnectServer('flow');
  });
});

describe('constants', () => {
  it('exposes the per-tool token estimate', () => {
    expect(TOKENS_PER_TOOL).toBe(50);
  });
});
