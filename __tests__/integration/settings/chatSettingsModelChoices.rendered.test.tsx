import { setupChatScreen } from '../../harness/chatHarness';

// Real navigation: the app's own NavigationContainer and routes (chatHarness navigation: 'real').
jest.unmock('@react-navigation/native');

/**
 * The chat's settings sheet holds no model choice and no copy of the settings: its "Model settings" row
 * opens the one Model settings screen. There, the Image tab keeps the chat's image controls without an
 * image model choice, and the Voice tab keeps the transcription language, voice turns and the Pro
 * text-to-speech section, whose voice models are chosen in TTS Settings, not here.
 */
describe('Chat Settings model choices', () => {
  it('keeps chat controls but leaves Image, STT, and TTS model choice to Models', async () => {
    const h = await setupChatScreen({ navigation: 'real', engine: 'llama', pro: true });
    h.render();

    h.rtl.fireEvent.press(await h.rtl.waitFor(() => h.view!.getByTestId('chat-settings-icon')));
    const openModelSettings = await h.rtl.waitFor(() => h.view!.getByTestId('chat-settings-open-model-settings'));
    // The sheet itself offers no model choice and no copied settings.
    expect(h.view!.queryByText('Image Model')).toBeNull();
    expect(h.view!.queryByTestId('modal-stt-open-picker')).toBeNull();
    expect(h.view!.queryByTestId('modal-voice-open-picker')).toBeNull();
    expect(h.view!.queryByText('Notice when you want a picture')).toBeNull();

    h.rtl.fireEvent.press(openModelSettings);
    await h.rtl.waitFor(() => expect(h.currentRoute()).toBe('ModelSettings'));

    h.rtl.fireEvent.press(h.view!.getByTestId('model-settings-tab-image'));
    expect(h.view!.queryByText('Image Model')).toBeNull();
    expect(h.view!.getByText('Notice when you want a picture')).toBeTruthy();

    h.rtl.fireEvent.press(h.view!.getByTestId('model-settings-tab-voice'));
    expect(h.view!.getByTestId('settings-transcription-language')).toBeTruthy();
    expect(h.view!.getByText('Voice turns')).toBeTruthy();
    expect(h.view!.queryByTestId('modal-voice-open-picker')).toBeNull();
    expect(h.view!.getByText('No voice models downloaded. Go to TTS Settings to download them.')).toBeTruthy();
  });
});
