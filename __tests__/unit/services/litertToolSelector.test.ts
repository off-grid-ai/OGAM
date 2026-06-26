const mockGenerateToolSelection = jest.fn();
jest.mock('../../../src/services/litert', () => ({
  liteRTService: { generateToolSelection: (...a: unknown[]) => mockGenerateToolSelection(...a) },
}));

import { selectRelevantTools } from '../../../src/services/litertToolSelector';

const tools = [
  { function: { name: 'notion-search', description: 'Search Notion.\nsecond line ignored' } },
  { function: { name: 'web_search', description: 'Search the web' } },
  { function: { name: 'calculator', description: undefined } },
];

describe('selectRelevantTools', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns the single tool named in the reply', async () => {
    mockGenerateToolSelection.mockResolvedValueOnce('notion-search');
    expect(await selectRelevantTools('find my notes', tools)).toEqual(['notion-search']);
  });

  it('matches multiple names regardless of formatting/casing', async () => {
    mockGenerateToolSelection.mockResolvedValueOnce('Use: WEB_SEARCH, calculator.');
    expect(await selectRelevantTools('weather then add', tools)).toEqual(['web_search', 'calculator']);
  });

  it('returns [] (no tool needed) when the reply is "none"', async () => {
    mockGenerateToolSelection.mockResolvedValueOnce('none');
    expect(await selectRelevantTools('hello', tools)).toEqual([]);
  });

  it('returns null (fall back to all) when the reply names no tool and is not "none"', async () => {
    mockGenerateToolSelection.mockResolvedValueOnce('I think you should use the thing');
    expect(await selectRelevantTools('do something', tools)).toBeNull();
  });

  it('returns null for empty tools or blank query without calling the model', async () => {
    expect(await selectRelevantTools('hi', [])).toBeNull();
    expect(await selectRelevantTools('   ', tools)).toBeNull();
    expect(mockGenerateToolSelection).not.toHaveBeenCalled();
  });

  it('sends a name:description catalog and truncates long descriptions', async () => {
    mockGenerateToolSelection.mockResolvedValueOnce('none');
    const longTool = [{ function: { name: 'big', description: 'x'.repeat(300) } }];
    await selectRelevantTools('q', longTool);
    const prompt = mockGenerateToolSelection.mock.calls[0][1] as string;
    expect(prompt).toContain('big:');
    expect(prompt).not.toContain('x'.repeat(150)); // first line capped at 100 chars
  });
});
