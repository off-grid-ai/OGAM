/**
 * Real-store tests for the MCP zustand store. We drive the ACTUAL store (no mock of
 * the store itself); AsyncStorage is stubbed globally in jest.setup.ts (the only
 * boundary). Every case asserts the observable state after an action, and both sides
 * of each branch (freshly-discovered vs known tool, owner match vs mismatch, toggle
 * on/off) are exercised so deleting the implementation fails the test.
 */
import { useMcpStore } from '@offgrid/pro/mcp/mcpStore';
import type { McpServerConfig, McpTool } from '@offgrid/pro/mcp/types';

const server = (id: string, name = id): McpServerConfig => ({
  id,
  name,
  url: `https://${id}.example.com/mcp`,
});

const tool = (name: string): McpTool => ({
  name,
  description: `desc ${name}`,
  inputSchema: { type: 'object' },
});

// Reset to the store's initial shape before each test so cases are isolated.
const resetStore = () =>
  useMcpStore.setState({
    servers: [],
    connectionStates: {},
    serverTools: {},
    enabledTools: [],
    knownToolNames: [],
    toolOwners: {},
  });

beforeEach(resetStore);

const get = () => useMcpStore.getState();

describe('mcpStore server CRUD', () => {
  it('addServer appends configs preserving order', () => {
    get().addServer(server('a'));
    get().addServer(server('b'));
    expect(get().servers.map(s => s.id)).toEqual(['a', 'b']);
  });

  it('updateServer patches only the matching server (id preserved, others untouched)', () => {
    get().addServer(server('a', 'A'));
    get().addServer(server('b', 'B'));
    get().updateServer('a', { name: 'A-renamed', authMode: 'oauth' });

    const a = get().servers.find(s => s.id === 'a')!;
    const b = get().servers.find(s => s.id === 'b')!;
    expect(a.name).toBe('A-renamed');
    expect(a.authMode).toBe('oauth');
    expect(a.id).toBe('a');
    // non-matching server is the untouched branch
    expect(b.name).toBe('B');
    expect(b.authMode).toBeUndefined();
  });

  it('updateServer on an unknown id is a no-op', () => {
    get().addServer(server('a'));
    get().updateServer('missing', { name: 'X' });
    expect(get().servers).toHaveLength(1);
    expect(get().servers[0].name).toBe('a');
  });
});

describe('mcpStore setConnectionState', () => {
  it('sets and overwrites per-server connection state without touching others', () => {
    get().setConnectionState('a', 'connecting');
    get().setConnectionState('b', 'connected');
    get().setConnectionState('a', 'error');
    expect(get().connectionStates).toEqual({ a: 'error', b: 'connected' });
  });
});

describe('mcpStore setServerTools auto-enable semantics', () => {
  it('auto-enables freshly-discovered tools and records owners + known names', () => {
    get().setServerTools('srv1', [tool('t1'), tool('t2')]);
    const s = get();
    expect(s.serverTools.srv1.map(t => t.name)).toEqual(['t1', 't2']);
    expect(s.toolOwners).toEqual({ t1: 'srv1', t2: 'srv1' });
    expect(s.enabledTools.sort()).toEqual(['t1', 't2']);
    expect(s.knownToolNames.sort()).toEqual(['t1', 't2']);
  });

  it('does NOT re-auto-enable a known tool the user disabled (sticks across reconnect)', () => {
    // First discovery enables t1.
    get().setServerTools('srv1', [tool('t1')]);
    // User disables t1.
    get().toggleTool('t1');
    expect(get().enabledTools).not.toContain('t1');
    expect(get().knownToolNames).toContain('t1');

    // Reconnect re-publishes the same tool: because it's already known, the
    // freshlyDiscovered list is empty and enabledTools is returned unchanged.
    get().setServerTools('srv1', [tool('t1')]);
    expect(get().enabledTools).not.toContain('t1');
  });

  it('enables only the NEW tool on a reconnect that adds one, leaving known ones as-is', () => {
    get().setServerTools('srv1', [tool('t1')]);
    get().toggleTool('t1'); // disable known t1
    get().setServerTools('srv1', [tool('t1'), tool('t2')]); // t2 is new

    const s = get();
    expect(s.enabledTools).toContain('t2'); // new -> auto-enabled
    expect(s.enabledTools).not.toContain('t1'); // known-disabled stays off
    expect(s.knownToolNames.sort()).toEqual(['t1', 't2']);
  });

  it('empty tool list from a server clears its tools but keeps enabled/known unchanged', () => {
    get().setServerTools('srv1', [tool('t1')]);
    get().setServerTools('srv1', []); // freshlyDiscovered empty -> the else branch
    const s = get();
    expect(s.serverTools.srv1).toEqual([]);
    expect(s.enabledTools).toEqual(['t1']);
    expect(s.knownToolNames).toEqual(['t1']);
  });

  it('re-owns a tool when a second server publishes the same name', () => {
    get().setServerTools('srv1', [tool('shared')]);
    get().setServerTools('srv2', [tool('shared')]);
    // last writer wins on owner; not double-enabled (already known)
    expect(get().toolOwners.shared).toBe('srv2');
    expect(get().enabledTools).toEqual(['shared']);
  });
});

describe('mcpStore toggleTool (both branches)', () => {
  it('enables a disabled tool and disables an enabled tool', () => {
    // not present -> add branch
    get().toggleTool('x');
    expect(get().enabledTools).toEqual(['x']);
    // present -> filter branch
    get().toggleTool('x');
    expect(get().enabledTools).toEqual([]);
  });
});

describe('mcpStore setEnabledTools', () => {
  it('replaces the enabled list wholesale', () => {
    get().setEnabledTools(['a', 'b']);
    expect(get().enabledTools).toEqual(['a', 'b']);
    get().setEnabledTools([]);
    expect(get().enabledTools).toEqual([]);
  });
});

describe('mcpStore clearServerData', () => {
  it('drops only that server connection state + tools, leaving owners/enabled intact', () => {
    get().setServerTools('srv1', [tool('t1')]);
    get().setConnectionState('srv1', 'connected');
    get().setConnectionState('srv2', 'connected');

    get().clearServerData('srv1');
    const s = get();
    expect(s.serverTools.srv1).toBeUndefined();
    expect(s.connectionStates.srv1).toBeUndefined();
    expect(s.connectionStates.srv2).toBe('connected'); // other server kept
    // clearServerData does NOT forget owners/enabled (tools rebuilt on reconnect)
    expect(s.toolOwners.t1).toBe('srv1');
    expect(s.enabledTools).toContain('t1');
  });
});

describe('mcpStore removeServer', () => {
  it('purges the server and all of its tool state (owners, enabled, known)', () => {
    get().addServer(server('srv1'));
    get().setServerTools('srv1', [tool('t1'), tool('t2')]);
    get().setConnectionState('srv1', 'connected');

    get().removeServer('srv1');
    const s = get();
    expect(s.servers).toHaveLength(0);
    expect(s.connectionStates.srv1).toBeUndefined();
    expect(s.serverTools.srv1).toBeUndefined();
    expect(s.toolOwners).toEqual({});
    expect(s.enabledTools).toEqual([]);
    expect(s.knownToolNames).toEqual([]);
  });

  it('only removes the target server tools, keeping another server owned tools (owner-mismatch branch)', () => {
    get().addServer(server('srv1'));
    get().addServer(server('srv2'));
    get().setServerTools('srv1', [tool('a1')]);
    get().setServerTools('srv2', [tool('b1')]);

    get().removeServer('srv1');
    const s = get();
    expect(s.servers.map(x => x.id)).toEqual(['srv2']);
    // srv2's tool survives (ownerId !== id branch kept it)
    expect(s.toolOwners).toEqual({ b1: 'srv2' });
    expect(s.enabledTools).toEqual(['b1']);
    expect(s.knownToolNames).toEqual(['b1']);
  });

  it('re-adding a removed server re-auto-enables its tools afresh (known names were forgotten)', () => {
    get().addServer(server('srv1'));
    get().setServerTools('srv1', [tool('t1')]);
    get().toggleTool('t1'); // user disabled it
    get().removeServer('srv1'); // forgets t1 as known

    get().addServer(server('srv1'));
    get().setServerTools('srv1', [tool('t1')]); // treated as fresh again
    expect(get().enabledTools).toContain('t1');
  });
});

describe('mcpStore integration: discover -> disable -> reconnect -> remove', () => {
  it('preserves a user disable across reconnect, then a full purge on remove', () => {
    get().addServer(server('notion'));
    get().setServerTools('notion', [tool('notion_search'), tool('notion_create')]);
    // user turns off create, keeps search
    get().toggleTool('notion_create');
    expect(get().enabledTools).toEqual(['notion_search']);

    // reconnect: same tools re-published, disable must stick
    get().setServerTools('notion', [tool('notion_search'), tool('notion_create')]);
    expect(get().enabledTools).toEqual(['notion_search']);

    // remove wipes everything owned by notion
    get().removeServer('notion');
    const s = get();
    expect(s.enabledTools).toEqual([]);
    expect(s.knownToolNames).toEqual([]);
    expect(s.toolOwners).toEqual({});
  });
});
