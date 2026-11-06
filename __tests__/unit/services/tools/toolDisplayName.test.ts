import { toolDisplayName } from '../../../../src/services/tools/toolDisplayName';
import { AVAILABLE_TOOLS } from '../../../../src/services/tools/registry';
import {
  registerToolExtension,
  _clearExtensionsForTesting,
  type ToolExtension,
} from '../../../../src/services/tools/extensions';
import type { ToolDefinition } from '../../../../src/services/tools/types';

const extensionWith = (definitions?: Partial<ToolDefinition>[]): ToolExtension => ({
  id: `ext-${definitions?.length ?? 'none'}`,
  getSystemPromptHint: () => '',
  ...(definitions ? { getToolDefinitions: () => definitions as ToolDefinition[] } : {}),
  parseToolCalls: () => [],
  stripFromVisibleText: (text: string) => text,
  canHandle: () => false,
  execute: () => Promise.resolve({ name: '', content: '', durationMs: 0 }),
  enabledToolCount: () => 0,
});

describe('toolDisplayName', () => {
  afterEach(() => _clearExtensionsForTesting());

  it('uses the registry name for a built-in tool', () => {
    const calculator = AVAILABLE_TOOLS.find(tool => tool.id === 'calculator')!;
    expect(toolDisplayName('calculator')).toBe(calculator.displayName);
  });

  it("uses an extension's name for a tool the registry does not have", () => {
    registerToolExtension(extensionWith());
    registerToolExtension(extensionWith([{ id: 'send_email', displayName: 'Send an email' }]));
    expect(toolDisplayName('send_email')).toBe('Send an email');
  });

  it('makes the id readable when nothing names the tool', () => {
    registerToolExtension(extensionWith([{ id: 'nameless_tool' }]));
    expect(toolDisplayName('nameless_tool')).toBe('Nameless tool');
    expect(toolDisplayName('search_docs')).toBe('Search docs');
    expect(toolDisplayName('fetch-page')).toBe('Fetch page');
    expect(toolDisplayName('readCalendar')).toBe('Read calendar');
  });

  it('returns the id unchanged when it has no words', () => {
    expect(toolDisplayName('')).toBe('');
    expect(toolDisplayName('__')).toBe('__');
  });
});
