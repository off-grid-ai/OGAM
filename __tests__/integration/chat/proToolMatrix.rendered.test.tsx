import {
  CHAT_PRO_TOOL_SCENARIOS,
  startChatScreen,
} from '../../harness/chatHarness';

describe.each(CHAT_PRO_TOOL_SCENARIOS)(
  'Mobile Pro tool journey on $label',
  scenario => {
    it('runs the enabled calendar tool and shows its visible result', async () => {
      const h = await startChatScreen(scenario);

      await h.send('Read my calendar.', {
        toolCalls: [
          {
            name: 'read_calendar_events',
            arguments: {
              start_date: '2026-09-10T00:00:00.000Z',
              end_date: '2026-09-11T00:00:00.000Z',
            },
          },
        ],
        text: 'I will read your calendar.',
        afterToolsText: 'There are no events in that period.',
      });

      await h.rtl.waitFor(() => {
        expect(h.assertions.isToolCallVisible('read_calendar_events')).toBe(
          true,
        );
        expect(h.assertions.isComposerEnabled()).toBe(true);
      });
      expect(
        await h.assertions.isToolCallClickable(
          'read_calendar_events',
          /No calendar events found/,
        ),
      ).toBe(true);
    });
  },
);
