import { setupChatScreen } from '../../harness/chatHarness';

// Real navigation: the app's own NavigationContainer and routes (chatHarness navigation: 'real').
jest.unmock('@react-navigation/native');

describe('opening a new chat with a selected local model', () => {
  it('waits for the first message before loading the model', async () => {
    const h = await setupChatScreen({ navigation: 'real', engine: 'llama', platform: 'ios', deferInitialLoad: true });
    h.render();

    await h.settle(500);
    expect(h.view!.queryByText('Start a Conversation')).not.toBeNull();
    expect(h.view!.queryByText('Loading Model')).toBeNull();
    expect(h.boundary.llama!.module.initLlama).not.toHaveBeenCalled();
    expect(h.view!.queryByText('Load Anyway')).toBeNull();

    await h.send('Hi', { text: 'Hello.' });
    expect(h.view!.queryByText('Loading Model')).toBeNull();
    expect(h.view!.queryByTestId('chat-input')).not.toBeNull();
    await h.rtl.waitFor(() => expect(h.view!.queryByText('Hello.')).not.toBeNull());
    expect(h.boundary.llama!.module.initLlama).toHaveBeenCalledTimes(1);
  });

});
