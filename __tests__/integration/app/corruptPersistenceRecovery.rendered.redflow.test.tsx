/** APP-P0-001 — corrupt app settings cannot trap startup or erase chat data. */
import { renderFreshApp } from '../../harness/appJourney';

describe('P0 corrupt persistence recovery', () => {
  it('reaches onboarding and preserves unrelated chats', async () => {
    const { rtl, view } = await renderFreshApp({
      beforeRender: async ({ asyncStorage }) => {
        await asyncStorage.setItem('local-llm-app-storage', '{broken-json');
        await asyncStorage.setItem(
          'local-llm-chat-storage',
          JSON.stringify({
            state: {
              conversations: [
                {
                  id: 'preserved-chat',
                  title: 'Preserved after recovery',
                  modelId: 'missing-model',
                  createdAt: '2026-07-17T00:00:00.000Z',
                  updatedAt: '2026-07-17T00:01:00.000Z',
                  messages: [
                    {
                      id: 'preserved-message',
                      role: 'user',
                      content: 'Keep this conversation safe',
                      timestamp: 1,
                    },
                  ],
                },
              ],
              activeConversationId: null,
            },
            version: 0,
          }),
        );
      },
    });

    expect(view.queryByTestId('app-loading')).toBeNull();
    rtl.fireEvent.press(
      await rtl.waitFor(() => view.getByTestId('onboarding-skip')),
    );
    rtl.fireEvent.press(
      await rtl.waitFor(() => view.getByTestId('model-download-skip')),
    );
    rtl.fireEvent.press(await rtl.waitFor(() => view.getByTestId('chats-tab')));
    await rtl.waitFor(() =>
      expect(view.getByText('Preserved after recovery')).toBeTruthy(),
    );
    rtl.fireEvent.press(view.getByTestId('conversation-item-0'));
    await rtl.waitFor(() =>
      expect(view.getByText('Keep this conversation safe')).toBeTruthy(),
    );
    view.unmount();
  });
});
