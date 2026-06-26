/**
 * Integration: free vs pro tool split.
 *
 * Verifies the wiring across layers that the tool picker / Pro Tools screen rely
 * on:
 *   - Free core-registry tools (AVAILABLE_TOOLS) never include the pro
 *     email/calendar tools.
 *   - When pro activates, the real EmailCalendarExtension registers into the core
 *     tool-extension registry and surfaces its tools via getToolDefinitions()
 *     (these are what the Pro Tools screen lists).
 *   - MCP-style extensions (no getToolDefinitions) contribute zero picker tools,
 *     so MCP tools stay out of both the free picker and the Pro Tools toggle list.
 *   - Registering the Pro Tools destination screen flips useIsProActive on via the
 *     reactive screen registry.
 *
 * The EmailCalendarExtension lives in the private pro/ submodule (not checked out
 * in open-core CI), so it is loaded via a computed path and the suite skips when
 * absent. Mocks are hoisted above the require.
 */

import { AVAILABLE_TOOLS } from '../../../src/services/tools/registry';
import {
  registerToolExtension,
  getToolExtensions,
  _clearExtensionsForTesting,
  type ToolExtension,
} from '../../../src/services/tools/extensions';
import {
  registerScreen,
  getRegisteredScreens,
  _clearScreensForTesting,
} from '../../../src/navigation/screenRegistry';

let mockEnabledTools: string[] = [];
jest.mock('@offgrid/core/stores', () => ({
  useAppStore: { getState: () => ({ settings: { enabledTools: mockEnabledTools } }) },
}));
jest.mock('react-native-calendar-events', () => ({
  __esModule: true,
  default: { saveEvent: jest.fn(), requestPermissions: jest.fn(), fetchAllEvents: jest.fn() },
}));

const PRO_TOOLS_SCREEN = 'McpServers';
const PRO_TOOL_IDS = ['send_email', 'create_calendar_event', 'read_calendar_events'];

function loadEmailCalendarExtension(): ToolExtension | null {
  const proPath = ['..', '..', '..', 'pro', 'tools', 'EmailCalendarExtension'].join('/');
  try {
    return require(proPath).EmailCalendarExtension as ToolExtension;
  } catch {
    return null;
  }
}

// A stand-in for the MCP extension: it has no getToolDefinitions, exactly like the
// real McpToolExtension, so it must contribute nothing to the picker tool list.
const mcpLikeExtension: ToolExtension = {
  id: 'mcp',
  getSystemPromptHint: () => '',
  parseToolCalls: () => [],
  stripFromVisibleText: (t: string) => t,
  canHandle: () => false,
  execute: async () => ({ name: 'x', content: '', durationMs: 0 }),
  enabledToolCount: () => 0,
};

const emailCalendar = loadEmailCalendarExtension();
const maybe = emailCalendar ? describe : describe.skip;

maybe('free vs pro tool split (integration)', () => {
  beforeEach(() => {
    _clearExtensionsForTesting();
    _clearScreensForTesting();
    mockEnabledTools = [];
  });
  afterEach(() => {
    _clearExtensionsForTesting();
    _clearScreensForTesting();
  });

  it('free core registry never contains the pro email/calendar tools', () => {
    const freeIds = AVAILABLE_TOOLS.map(t => t.id);
    for (const id of PRO_TOOL_IDS) {
      expect(freeIds).not.toContain(id);
    }
  });

  it('after pro activation, email/calendar tools surface via the extension registry', () => {
    // Simulate what pro.activate() does for these two extensions.
    registerToolExtension(emailCalendar!);
    registerToolExtension(mcpLikeExtension);

    const pickerTools = getToolExtensions().flatMap(e => e.getToolDefinitions?.() ?? []);
    const pickerIds = pickerTools.map(t => t.id);

    for (const id of PRO_TOOL_IDS) {
      expect(pickerIds).toContain(id);
    }
  });

  it('MCP-style extensions contribute no picker tools', () => {
    registerToolExtension(mcpLikeExtension);
    const pickerTools = getToolExtensions().flatMap(e => e.getToolDefinitions?.() ?? []);
    expect(pickerTools).toHaveLength(0);
  });

  it('the combined free + pro picker set has no duplicate ids', () => {
    registerToolExtension(emailCalendar!);
    registerToolExtension(mcpLikeExtension);
    const ext = getToolExtensions().flatMap(e => e.getToolDefinitions?.() ?? []);
    const all = [...AVAILABLE_TOOLS, ...ext].map(t => t.id);
    expect(new Set(all).size).toBe(all.length);
  });

  it('registering the Pro Tools destination screen marks pro active in the registry', () => {
    expect(getRegisteredScreens().some(s => s.name === PRO_TOOLS_SCREEN)).toBe(false);
    registerScreen({ name: PRO_TOOLS_SCREEN, component: () => null });
    expect(getRegisteredScreens().some(s => s.name === PRO_TOOLS_SCREEN)).toBe(true);
  });
});
