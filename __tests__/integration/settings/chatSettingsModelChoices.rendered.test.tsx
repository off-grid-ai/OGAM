import { setupChatScreen } from '../../harness/chatHarness';

// Real navigation: the app's own NavigationContainer and routes (chatHarness navigation: 'real').
jest.unmock('@react-navigation/native');

describe('Chat Settings model choices', () => {
  it('keeps chat controls but leaves Image, STT, and TTS model choice to Models', async () => {
    const h = await setupChatScreen({ navigation: 'real', engine: 'llama', pro: true });
    h.render();

    h.rtl.fireEvent.press(await h.rtl.waitFor(() => h.view!.getByTestId('chat-settings-icon')));
    h.rtl.fireEvent.press(h.view!.getByText('IMAGE GENERATION'));
    expect(h.view!.queryByText('Image Model')).toBeNull();
    expect(h.view!.getByText('Auto-detect image requests')).toBeTruthy();

    h.rtl.fireEvent.press(h.view!.getByText('SPEECH TO TEXT'));
    expect(h.view!.queryByTestId('modal-stt-open-picker')).toBeNull();
    expect(h.view!.getByTestId('chat-transcription-language')).toBeTruthy();
    expect(h.view!.getByText('Voice turns')).toBeTruthy();

    h.rtl.fireEvent.press(h.view!.getByText('TEXT TO SPEECH'));
    expect(h.view!.queryByTestId('modal-voice-open-picker')).toBeNull();
    expect(h.view!.getByText('No voice models downloaded. Go to TTS Settings to download them.')).toBeTruthy();
  });
});
