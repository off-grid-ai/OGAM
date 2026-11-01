/**
 * McpToolExtension.execute must honor the never-throw ToolResult contract: a tool whose server is
 * down or disconnected returns { error } with the call id. It must NOT throw (which previously crashed
 * the whole tool loop and left the model with no signal). A success returns content + toolCallId.
 *
 * The extension, mcpStore, mcpService and McpClient run for real. Only the network is faked: the
 * user's Notion MCP server answers over XMLHttpRequest (harness/mcpHttpFake).
 */
import { McpToolExtension } from '@offgrid/pro/mcp/McpToolExtension';
import { useMcpStore } from '@offgrid/pro/mcp/mcpStore';
import { connectServer, disconnectServer } from '@offgrid/pro/mcp/mcpService';
import type { McpTool } from '@offgrid/pro/mcp/types';
import { installMcpHttpFake, type McpHttpFake } from '../../harness/mcpHttpFake';

const NOTION_URL = 'https://notion.example.test/mcp';
const notionSearch: McpTool = {
  name: 'notion_search',
  description: 'Search Notion pages.',
  inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
};

let mcp: McpHttpFake;

// The user's Notion server is added and connected: it lists notion_search, and discovery turns it on.
beforeEach(async () => {
  mcp = installMcpHttpFake({ [NOTION_URL]: { label: 'Notion', tools: [notionSearch] } });
  useMcpStore.getState().addServer({ id: 'notion', name: 'Notion', url: NOTION_URL });
  await connectServer('notion');
});

afterEach(() => {
  disconnectServer('notion');
  useMcpStore.getState().removeServer('notion');
  mcp.restore();
});

describe('McpToolExtension.execute', () => {
  it('returns content + toolCallId on success (never throws)', async () => {
    const r = await McpToolExtension.execute({ id: 'c1', name: 'notion_search', arguments: { query: 'x' } });
    expect(r.toolCallId).toBe('c1');
    expect(r.content).toBe('Notion ran notion_search');
    expect(r.error).toBeUndefined();
    expect(mcp.calls).toEqual([{ url: NOTION_URL, tool: 'notion_search' }]);
  });

  it('returns a typed error result (does NOT throw) when the server is not connected', async () => {
    disconnectServer('notion');
    const r = await McpToolExtension.execute({ id: 'c2', name: 'notion_search', arguments: {} });
    expect(r.toolCallId).toBe('c2');
    expect(r.content).toBe('');
    expect(r.error).toContain('not connected');
    expect(mcp.calls).toEqual([]);
  });
});
