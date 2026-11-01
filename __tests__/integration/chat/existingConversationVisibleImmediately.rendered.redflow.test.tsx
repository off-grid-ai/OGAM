import { setupChatScreen } from '../../harness/chatHarness';

// Real navigation: the app's own NavigationContainer and routes (chatHarness navigation: 'real').
jest.unmock('@react-navigation/native');

describe('opening an existing Mobile chat', () => {
  it('shows stored messages before the list completes its first measurement', async () => {
    const h = await setupChatScreen({ navigation: 'real', engine: 'llama', platform: 'ios' });
    h.render();
    await h.send('Show this chat again', { text: 'The stored reply is ready.' });
    await h.rtl.waitFor(() => {
      expect(h.view!.getByText('The stored reply is ready.')).toBeVisible();
    });

    expect(h.conversationId).not.toBeNull();
    // Leave the chat, as the person does, and find it on the Chats tab.
    h.rtl.fireEvent.press(h.view!.getByLabelText('Back'));
    await h.rtl.waitFor(() => expect(h.view!.queryByTestId('chat-screen')).toBeNull());
    const list = await h.openChatList();
    const row = await h.rtl.waitFor(() => list.getByText('Show this chat again'));
    // Hold layout work until after the assertion. This proves that stored content
    // is visible on the first render and does not depend on a deferred frame.
    const deferredFrames: Array<(time: number) => void> = [];
    const originalRequestAnimationFrame = (globalThis as any).requestAnimationFrame;
    (globalThis as any).requestAnimationFrame = (callback: (time: number) => void) => {
      deferredFrames.push(callback);
      return deferredFrames.length;
    };

    try {
      h.rtl.fireEvent.press(row);
      const reopened = h.render();
      await h.rtl.waitFor(() => {
        expect(reopened.getByText('The stored reply is ready.')).toBeVisible();
      });
      expect(reopened.getByTestId('chat-message-list')).toBeVisible();
    } finally {
      (globalThis as any).requestAnimationFrame = originalRequestAnimationFrame;
      await h.rtl.act(async () => {
        deferredFrames.forEach(callback => callback(Date.now()));
      });
    }
  });
});
