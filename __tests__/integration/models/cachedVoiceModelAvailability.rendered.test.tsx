import { launchVoiceApp } from '../../harness/proHarness';

jest.unmock('@react-navigation/native');

describe('cached voice model availability', () => {
  it('enters Voice mode after the completed device cache repairs missing install metadata', async () => {
    const app = await launchVoiceApp({ cachedVoice: true });
    try {
      await app.voicePanel();
      expect(await app.view.findByTestId('voice-model-kokoro-delete')).toBeTruthy();
      await app.chat();
      app.rtl.fireEvent.press(app.view.getByTestId('chat-mode-toggle'));
      expect(await app.view.findByLabelText('Switch to Text mode')).toBeTruthy();
      expect(app.view.queryByText('No voice model')).toBeNull();
    } finally {
      await app.close();
    }
  });
});
