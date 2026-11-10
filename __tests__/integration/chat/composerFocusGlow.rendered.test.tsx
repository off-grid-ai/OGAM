import { setupChatScreen } from '../../harness/chatHarness';

jest.unmock('@react-navigation/native');

describe('the composer while you type', () => {
  it('is marked focused while the field has focus, and not after', async () => {
    const h = await setupChatScreen({ navigation: 'real', engine: 'llama', platform: 'ios' });
    h.render();
    const view = h.view!;
    const pill = () => view.getByTestId('composer-pill');
    await h.rtl.waitFor(() => expect(pill().props.accessibilityState).toEqual({ selected: false }));

    h.rtl.fireEvent(view.getByTestId('chat-input'), 'focus');
    expect(pill().props.accessibilityState).toEqual({ selected: true });

    h.rtl.fireEvent(view.getByTestId('chat-input'), 'blur');
    expect(pill().props.accessibilityState).toEqual({ selected: false });
  });
});
