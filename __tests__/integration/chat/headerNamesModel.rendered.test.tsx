import { setupChatScreen } from '../../harness/chatHarness';

// Real navigation: the app's own NavigationContainer and routes (chatHarness navigation: 'real').
jest.unmock('@react-navigation/native');

describe('the chat header', () => {
  it('names the model that answers, before and after the first message', async () => {
    // Device, 2026-11-05: the header read "Models ▾", so a chat answered by the wrong model looked fine.
    const h = await setupChatScreen({ navigation: 'real', engine: 'llama', platform: 'ios', modelName: 'Gemma 4 E4B', deferInitialLoad: true });
    h.render();
    await h.settle(300);

    expect(h.view!.getByTestId('model-loaded-indicator')).toHaveTextContent('Gemma 4 E4B');

    await h.send('Hi', { text: 'Hello.' });
    await h.rtl.waitFor(() => expect(h.view!.queryByText('Hello.')).not.toBeNull());
    expect(h.view!.getByTestId('model-loaded-indicator')).toHaveTextContent('Gemma 4 E4B');
  });

  it('still opens the models manager when tapped', async () => {
    const h = await setupChatScreen({ navigation: 'real', engine: 'llama', platform: 'ios', modelName: 'Gemma 4 E4B', deferInitialLoad: true });
    h.render();
    await h.settle(300);

    h.rtl.fireEvent.press(h.view!.getByTestId('model-selector'));

    await h.rtl.waitFor(() => expect(h.view!.queryByTestId('models-row-text')).not.toBeNull());
  });
});

describe('the Stop control while a reply streams', () => {
  it('is a labelled button, and pressing it ends the reply', async () => {
    const h = await setupChatScreen({ navigation: 'real', engine: 'llama', platform: 'ios' });
    h.render();
    const view = h.view!;

    h.boundary.llama!.scriptCompletion({ text: 'A long reply.', holdBeforeStream: true });
    await h.tapSend('tell me a story');
    const stop = await h.rtl.waitFor(() => view.getByRole('button', { name: 'Stop reply' }), { timeout: 4000 });

    h.rtl.fireEvent.press(stop);

    await h.rtl.waitFor(() => expect(view.queryByRole('button', { name: 'Stop reply' })).toBeNull(), { timeout: 4000 });
  });
});
