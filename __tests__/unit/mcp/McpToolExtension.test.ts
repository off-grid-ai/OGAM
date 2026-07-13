/**
 * McpToolExtension.execute must honor the never-throw ToolResult contract: a tool
 * whose server is down/disconnected (executeMcpTool throws) returns { error } with
 * the call id — it must NOT throw (which previously crashed the whole tool loop and
 * left the model with no signal). A success returns content + toolCallId.
 */
jest.mock('@offgrid/core/utils/logger', () => ({ __esModule: true, default: { log: jest.fn(), warn: jest.fn(), error: jest.fn() } }));
jest.mock('@offgrid/core/stores', () => ({ useRemoteServerStore: { getState: () => ({}) } }));
jest.mock('../../../pro/mcp/mcpStore', () => ({ useMcpStore: { getState: () => ({ toolOwners: {}, enabledTools: [], serverTools: {} }) } }));
jest.mock('../../../pro/mcp/schemaTrim', () => ({ trimToolForSmallModel: (t: any) => t }));

const mockExecuteMcpTool = jest.fn();
jest.mock('../../../pro/mcp/mcpService', () => ({
  getMcpToolsPrompt: () => '',
  parseMcpToolCallsFromText: () => ({ calls: [], cleanedText: '' }),
  executeMcpTool: (...a: any[]) => mockExecuteMcpTool(...a),
}));

import { McpToolExtension } from '../../../pro/mcp/McpToolExtension';

beforeEach(() => jest.clearAllMocks());

describe('McpToolExtension.execute', () => {
  it('returns content + toolCallId on success (never throws)', async () => {
    mockExecuteMcpTool.mockResolvedValue({ content: 'ok result', durationMs: 12 });
    const r = await McpToolExtension.execute({ id: 'c1', name: 'notion_search', arguments: {} });
    expect(r.toolCallId).toBe('c1');
    expect(r.content).toBe('ok result');
    expect(r.error).toBeUndefined();
  });

  it('returns a typed error result (does NOT throw) when the server call fails', async () => {
    mockExecuteMcpTool.mockRejectedValue(new Error('Server "notion" is not connected'));
    const r = await McpToolExtension.execute({ id: 'c2', name: 'notion_search', arguments: {} });
    expect(r.toolCallId).toBe('c2');
    expect(r.content).toBe('');
    expect(r.error).toContain('not connected');
  });
});
