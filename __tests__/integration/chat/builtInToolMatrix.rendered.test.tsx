import {
  CHAT_BUILT_IN_TOOL_SCENARIOS,
  startChatScreen,
} from '../../harness/chatHarness';

describe.each(CHAT_BUILT_IN_TOOL_SCENARIOS)(
  'Mobile built-in tool journey on $label',
  scenario => {
    it('runs the calculator and shows its visible result', async () => {
      const h = await startChatScreen(scenario);

      await h.send('What is 2 + 2?', {
        toolCalls: [
          { name: 'calculator', arguments: { expression: '2+2' } },
        ],
        text: 'I will calculate that.',
        afterToolsText: 'The answer is 4.',
      });

      await h.rtl.waitFor(() => {
        expect(h.assertions.isToolCallVisible('calculator')).toBe(true);
        expect(h.assertions.isToolResultVisible('2+2 = 4')).toBe(true);
      });
    });
  },
);
