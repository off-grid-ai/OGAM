import {
  registerToolExtension,
  getToolExtensions,
  _clearExtensionsForTesting,
  ToolExtension,
} from '../../../../src/services/tools/extensions';

const makeExt = (id: string, toolCount = 0): ToolExtension => ({
  id,
  getSystemPromptHint: () => `[hint:${id}]`,
  parseToolCalls: () => [],
  stripFromVisibleText: (text: string) => text,
  canHandle: () => false,
  execute: () => Promise.resolve({ name: id, content: '', durationMs: 0 }),
  enabledToolCount: () => toolCount,
});

describe('tool extension registry', () => {
  beforeEach(() => {
    _clearExtensionsForTesting();
  });

  it('returns empty array when no extensions registered', () => {
    expect(getToolExtensions()).toEqual([]);
  });

  it('registers a single extension', () => {
    const ext = makeExt('mcp');
    registerToolExtension(ext);
    expect(getToolExtensions()).toHaveLength(1);
    expect(getToolExtensions()[0].id).toBe('mcp');
  });

  it('ignores duplicate registrations by id', () => {
    const ext1 = makeExt('mcp');
    const ext2 = makeExt('mcp');
    registerToolExtension(ext1);
    registerToolExtension(ext2);
    expect(getToolExtensions()).toHaveLength(1);
    expect(getToolExtensions()[0]).toBe(ext1);
  });

  it('allows multiple extensions with different ids', () => {
    registerToolExtension(makeExt('mcp'));
    registerToolExtension(makeExt('calendar'));
    expect(getToolExtensions()).toHaveLength(2);
  });

  it('returns extension with correct interface', () => {
    registerToolExtension(makeExt('mcp', 3));
    const [ext] = getToolExtensions();
    expect(ext.getSystemPromptHint()).toBe('[hint:mcp]');
    expect(ext.enabledToolCount()).toBe(3);
    expect(ext.parseToolCalls('anything')).toEqual([]);
    expect(ext.stripFromVisibleText('hello')).toBe('hello');
    expect(ext.canHandle('any_tool')).toBe(false);
  });
});
