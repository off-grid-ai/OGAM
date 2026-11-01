import { setupChatScreen } from '../../harness/chatHarness';

// Real navigation: the app's own NavigationContainer and routes (chatHarness navigation: 'real').
jest.unmock('@react-navigation/native');

describe('Mobile assistant response edit journey', () => {
  it('edits a response in place without resending the request', async () => {
    const h = await setupChatScreen({ navigation: 'real', engine: 'llama', platform: 'ios' });
    const view = h.render();

    await h.send('Give me a short greeting.', {
      text: 'Hello from the original response.',
    });
    await h.rtl.waitFor(() => {
      expect(view.getByText('Hello from the original response.')).toBeVisible();
    });

    await h.openActionMenu('user', 'dots');
    expect(view.queryByTestId('action-select-text')).toBeNull();
    h.rtl.fireEvent.press(view.getByTestId('action-edit'));
    await h.rtl.waitFor(() => expect(view.getByText('SAVE & RESEND')).toBeVisible());
    h.rtl.fireEvent.press(view.getByText('CANCEL'));

    await h.openActionMenu('assistant', 'dots');
    expect(view.queryByTestId('action-select-text')).toBeNull();
    h.rtl.fireEvent.press(view.getByTestId('action-edit'));
    await h.rtl.waitFor(() => expect(view.getByText('SAVE')).toBeVisible());
    const editInput = await h.rtl.waitFor(() =>
      view.getByPlaceholderText('Enter message...'),
    );
    expect(view.queryByText('SAVE & RESEND')).toBeNull();

    h.rtl.fireEvent.changeText(editInput, 'Hello from the edited response.');
    h.rtl.fireEvent.press(view.getByText('SAVE'));

    await h.rtl.waitFor(() => {
      expect(view.getAllByText('Give me a short greeting.').length).toBeGreaterThan(0);
      expect(view.getByText('Hello from the edited response.')).toBeVisible();
      expect(view.queryByText('Hello from the original response.')).toBeNull();
      expect(view.getByTestId('chat-input')).toBeEnabled();
    });
    expect(view.queryByText('Generation Error')).toBeNull();
    expect(view.queryByText('Edit Error')).toBeNull();
  });
});
