import {
  CHAT_MCP_TOOL_SCENARIOS,
  startChatScreen,
} from '../../harness/chatHarness';
import {
  TEST_MCP_RESULT,
  TEST_MCP_TOOL,
} from '../../harness/mcpBoundary';

describe.each(CHAT_MCP_TOOL_SCENARIOS)(
  'Mobile MCP tool journey on $label',
  scenario => {
    it('runs the enabled MCP tool and shows its external result', async () => {
      const h = await startChatScreen(scenario);

      await h.send('Find my launch plan note.', {
        toolCalls: [
          {
            name: TEST_MCP_TOOL,
            arguments: { query: 'launch plan' },
          },
        ],
        text: 'I will search your notes.',
        afterToolsText: 'I found your launch plan note.',
      });

      await h.rtl.waitFor(() => {
        expect(h.assertions.isToolCallVisible(TEST_MCP_TOOL)).toBe(true);
      });
      expect(
        await h.assertions.isToolCallClickable(TEST_MCP_TOOL, TEST_MCP_RESULT),
      ).toBe(true);
    });
  },
);
