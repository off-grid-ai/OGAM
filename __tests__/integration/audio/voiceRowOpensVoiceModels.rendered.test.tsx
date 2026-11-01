/**
 * The Voice row in the chat's quick settings, before any voice is ready.
 *
 * SPEC (user's view): with no voice downloaded, tapping Voice cannot turn voice on. It closes the quick
 * settings and opens Models on the Voice tab, where I get a voice. The chat stays in text mode.
 *
 * Real app, real navigation, real TTS store; fakes sit at the device boundary only.
 */
import { setupChatScreen } from '../../harness/chatHarness';

// Real navigation: the app's own NavigationContainer and routes (chatHarness navigation: 'real').
jest.unmock('@react-navigation/native');

describe('Voice row with no voice ready', () => {
  it('opens Models on the Voice tab and leaves the chat in text mode', async () => {
    const h = await setupChatScreen({ navigation: 'real', engine: 'llama', pro: true });
    const view = h.render();
    const { useTTSStore } = require('@offgrid/pro/audio/ttsStore');
    expect(useTTSStore.getState().isReady).toBe(false);

    h.rtl.fireEvent.press(await h.rtl.waitFor(() => view.getByTestId('quick-settings-button')));
    h.rtl.fireEvent.press(await h.rtl.waitFor(() => view.getByTestId('quick-tts-mode')));

    await h.rtl.waitFor(() => expect(h.currentRoute()).toBe('ModelsTab'));
    expect(view.queryByTestId('quick-tts-mode')).toBeNull();
    // Models opened on the Voice tab: its voices are listed.
    expect(view.getByText('Kokoro TTS')).toBeTruthy();
    expect(useTTSStore.getState().settings.interfaceMode).toBe('chat');
  });
});
