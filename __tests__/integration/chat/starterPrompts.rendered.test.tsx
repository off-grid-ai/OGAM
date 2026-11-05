import { setupChatScreen } from '../../harness/chatHarness';
import { STARTER_PROMPTS } from '../../../src/screens/ChatScreen/ChatScreenComponents';

// Real navigation: the app's own NavigationContainer and routes (chatHarness navigation: 'real').
jest.unmock('@react-navigation/native');

describe('a new chat offers starter prompts', () => {
  it('shows them on an empty chat; one tap sends it and the answer appears', async () => {
    const h = await setupChatScreen({ navigation: 'real', engine: 'llama', platform: 'ios' });
    h.render();
    const view = h.view!;

    const starter = await h.rtl.waitFor(() => view.getByRole('button', { name: STARTER_PROMPTS[0] }));
    h.boundary.llama!.scriptCompletion({ text: 'Try a cabin by the lake.' });

    h.rtl.fireEvent.press(starter);

    await h.rtl.waitFor(() => expect(view.queryByText('Try a cabin by the lake.')).not.toBeNull(), { timeout: 8000 });
    expect(view.queryByTestId('chat-starters')).toBeNull();
  });
});
