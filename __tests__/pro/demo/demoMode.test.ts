/**
 * Real tests for pro/demo/demoMode.ts.
 *
 * Boundaries mocked: none beyond what jest.setup already stubs (AsyncStorage via the
 * store's persist middleware). The demo module, the REAL mcpStore, and the REAL
 * mcpService client registry all run for real. Only the clock is controlled
 * (DemoMcpClient sleeps 400ms) via jest fake timers.
 */

import {
  seedDemoServers,
  isDemoServer,
  DEMO_GITHUB_ID,
  DEMO_SLACK_ID,
} from '@offgrid/pro/demo/demoMode';
import { useMcpStore } from '@offgrid/pro/mcp/mcpStore';
import { executeMcpTool } from '@offgrid/pro/mcp/mcpService';

const GITHUB_TOOL_NAMES = ['list_issues', 'create_issue', 'search_code'];
const SLACK_TOOL_NAMES = ['send_message', 'list_channels'];
const ALL_DEMO_TOOLS = [...GITHUB_TOOL_NAMES, ...SLACK_TOOL_NAMES];

function resetStore(): void {
  useMcpStore.setState({
    servers: [],
    connectionStates: {},
    serverTools: {},
    enabledTools: [],
    knownToolNames: [],
    toolOwners: {},
  });
}

describe('isDemoServer', () => {
  it('returns true for the two demo server ids and false otherwise', () => {
    expect(isDemoServer(DEMO_GITHUB_ID)).toBe(true);
    expect(isDemoServer(DEMO_SLACK_ID)).toBe(true);
    expect(isDemoServer('some-real-server')).toBe(false);
    expect(isDemoServer('')).toBe(false);
  });
});

describe('seedDemoServers — store outcome', () => {
  beforeEach(() => resetStore());

  it('adds both demo servers with their configs', () => {
    seedDemoServers();
    const { servers } = useMcpStore.getState();
    const gh = servers.find(s => s.id === DEMO_GITHUB_ID);
    const slack = servers.find(s => s.id === DEMO_SLACK_ID);

    expect(gh).toEqual({
      id: DEMO_GITHUB_ID,
      name: 'GitHub (demo)',
      url: 'https://demo.mcp.local/github',
    });
    expect(slack).toEqual({
      id: DEMO_SLACK_ID,
      name: 'Slack (demo)',
      url: 'https://demo.mcp.local/slack',
    });
    expect(servers).toHaveLength(2);
  });

  it('marks both servers connected', () => {
    seedDemoServers();
    const { connectionStates } = useMcpStore.getState();
    expect(connectionStates[DEMO_GITHUB_ID]).toBe('connected');
    expect(connectionStates[DEMO_SLACK_ID]).toBe('connected');
  });

  it('seeds the correct tool lists per server and owner map', () => {
    seedDemoServers();
    const { serverTools, toolOwners } = useMcpStore.getState();

    expect(serverTools[DEMO_GITHUB_ID].map(t => t.name)).toEqual(GITHUB_TOOL_NAMES);
    expect(serverTools[DEMO_SLACK_ID].map(t => t.name)).toEqual(SLACK_TOOL_NAMES);

    GITHUB_TOOL_NAMES.forEach(n => expect(toolOwners[n]).toBe(DEMO_GITHUB_ID));
    SLACK_TOOL_NAMES.forEach(n => expect(toolOwners[n]).toBe(DEMO_SLACK_ID));
  });

  it('enables all demo tools by default', () => {
    seedDemoServers();
    const { enabledTools } = useMcpStore.getState();
    ALL_DEMO_TOOLS.forEach(n => expect(enabledTools).toContain(n));
  });

  it('merges demo tools with pre-existing enabled tools without dropping or duplicating', () => {
    // Pre-existing enabled tool from a "real" server, plus a name that collides with a demo tool.
    useMcpStore.setState({ enabledTools: ['pre_existing_tool', 'list_issues'] });

    seedDemoServers();
    const { enabledTools } = useMcpStore.getState();

    // Pre-existing kept.
    expect(enabledTools).toContain('pre_existing_tool');
    // All demo tools present.
    ALL_DEMO_TOOLS.forEach(n => expect(enabledTools).toContain(n));
    // No duplicate of the colliding name (Set-dedupe branch exercised).
    expect(enabledTools.filter(n => n === 'list_issues')).toHaveLength(1);
  });
});

describe('seedDemoServers — idempotency (remove-first branch)', () => {
  beforeEach(() => resetStore());

  it('leaves exactly two demo servers after being called twice', () => {
    seedDemoServers();
    seedDemoServers();
    const demoServers = useMcpStore.getState().servers.filter(s => isDemoServer(s.id));
    expect(demoServers).toHaveLength(2);
    // And the whole store only has those two (no orphaned duplicates).
    expect(useMcpStore.getState().servers).toHaveLength(2);
  });

  it('the first call takes the no-remove branch (servers absent) and still seeds correctly', () => {
    // On a fresh store there is nothing to remove — exercises the false side of the
    // `if (find(...)) removeServer` guards. Servers must still be present after.
    expect(useMcpStore.getState().servers.find(s => s.id === DEMO_GITHUB_ID)).toBeUndefined();
    seedDemoServers();
    expect(useMcpStore.getState().servers.find(s => s.id === DEMO_GITHUB_ID)).toBeDefined();
    expect(useMcpStore.getState().servers.find(s => s.id === DEMO_SLACK_ID)).toBeDefined();
  });

  it('re-seeding keeps demo tools enabled after the remove-then-add cycle', () => {
    seedDemoServers();
    seedDemoServers();
    const { enabledTools, connectionStates } = useMcpStore.getState();
    ALL_DEMO_TOOLS.forEach(n => expect(enabledTools).toContain(n));
    expect(connectionStates[DEMO_GITHUB_ID]).toBe('connected');
    expect(connectionStates[DEMO_SLACK_ID]).toBe('connected');
  });
});

describe('DemoMcpClient via executeMcpTool — real cross-module path', () => {
  beforeEach(() => {
    resetStore();
    jest.useFakeTimers();
    seedDemoServers();
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });

  // Drives the REAL executeMcpTool -> REAL registered DemoMcpClient. The 400ms
  // simulated latency is advanced with fake timers so tests stay fast.
  async function runTool(name: string, args: Record<string, unknown>) {
    const promise = executeMcpTool(name, args);
    await jest.advanceTimersByTimeAsync(400);
    return promise;
  }

  it('routes list_issues to the GitHub demo client and returns canned issues with the repo echoed', async () => {
    const { content, durationMs } = await runTool('list_issues', { owner: 'acme', repo: 'widgets' });
    const parsed = JSON.parse(content);
    expect(parsed.repo).toBe('acme/widgets');
    expect(parsed.issues).toHaveLength(3);
    expect(parsed.issues[0].number).toBe(42);
    expect(durationMs).toBeGreaterThanOrEqual(400);
  });

  it('list_issues falls back to org/repo defaults when args are missing (?? branch)', async () => {
    const { content } = await runTool('list_issues', {});
    expect(JSON.parse(content).repo).toBe('org/repo');
  });

  it('create_issue echoes the provided title and builds the url', async () => {
    const { content } = await runTool('create_issue', { owner: 'acme', repo: 'widgets', title: 'Bug X' });
    const parsed = JSON.parse(content);
    expect(parsed.title).toBe('Bug X');
    expect(parsed.url).toBe('https://github.com/acme/widgets/issues/55');
  });

  it('create_issue uses default title when none provided (?? branch)', async () => {
    const { content } = await runTool('create_issue', {});
    expect(JSON.parse(content).title).toBe('New issue');
  });

  it('search_code embeds the query in each fragment', async () => {
    const { content } = await runTool('search_code', { query: 'needle' });
    const parsed = JSON.parse(content);
    expect(parsed.total_count).toBe(3);
    parsed.items.forEach((it: { fragment: string }) => expect(it.fragment).toBe('// needle'));
  });

  it('search_code falls back to "match" when query missing (?? branch)', async () => {
    const { content } = await runTool('search_code', {});
    expect(JSON.parse(content).items[0].fragment).toBe('// match');
  });

  it('routes send_message to the Slack demo client and echoes channel + text', async () => {
    const { content } = await runTool('send_message', { channel: '#eng', text: 'hi' });
    const parsed = JSON.parse(content);
    expect(parsed.ok).toBe(true);
    expect(parsed.channel).toBe('#eng');
    expect(parsed.message.text).toBe('hi');
  });

  it('send_message falls back to #general / empty text when args missing (?? branches)', async () => {
    const { content } = await runTool('send_message', {});
    const parsed = JSON.parse(content);
    expect(parsed.channel).toBe('#general');
    expect(parsed.message.text).toBe('');
  });

  it('list_channels returns the canned channel list (ignores args)', async () => {
    const { content } = await runTool('list_channels', {});
    const parsed = JSON.parse(content);
    expect(parsed.channels.map((c: { name: string }) => c.name)).toEqual([
      'general', 'engineering', 'releases', 'random',
    ]);
  });

  it('an owned-but-unhandled tool name returns the "Unknown demo tool" error payload', async () => {
    // Register a tool owner that maps to a demo server but has no MOCK_RESPONSES entry,
    // exercising the DemoMcpClient handler-missing branch (not the executeMcpTool guard).
    useMcpStore.getState().setServerTools(DEMO_GITHUB_ID, [
      ...useMcpStore.getState().serverTools[DEMO_GITHUB_ID],
      { name: 'mystery_tool', description: 'x', inputSchema: { type: 'object' } },
    ]);
    const { content } = await runTool('mystery_tool', {});
    expect(JSON.parse(content)).toEqual({ error: 'Unknown demo tool: mystery_tool' });
  });
});
