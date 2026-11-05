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

  it('hides them when only an image model is selected: a text starter would draw a picture', async () => {
    const h = await setupChatScreen({ navigation: 'real', engine: 'llama', platform: 'ios' });
    h.render();
    const view = h.view!;
    await h.rtl.waitFor(() => view.getByRole('button', { name: STARTER_PROMPTS[0] }));

    // Activating an image model is a quick-settings gesture that is fragile in jest; set it directly.
    await h.placeImageModel();
    const { useAppStore } = require('../../../src/stores');
    await h.rtl.act(() => useAppStore.setState({ activeImageModelId: 'sd' }));
    const { activeModelService } = require('../../../src/services/activeModelService');
    await h.rtl.act(() => activeModelService.unloadTextModel(false));

    await h.rtl.waitFor(() => expect(view.getByPlaceholderText('Describe an image...')).toBeTruthy());
    expect(view.queryByTestId('chat-starters')).toBeNull();
  });
});
