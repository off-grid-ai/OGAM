import { renderMainApp } from '../../harness/appJourney';
import { GB } from '../../harness/nativeBoundary';

describe('P1 #109 deleting TTS clears stale residency', () => {
  it('removes the voice resident and leaves a subsequent text load healthy', async () => {
    const { rtl, view } = await renderMainApp({
      boundary: {
        llama: true,
        ram: { platform: 'android', totalBytes: 16 * GB, availBytes: 14 * GB },
      },
    });

    rtl.fireEvent.press(view.getByTestId('models-tab'));
    await rtl.waitFor(() =>
      expect(view.getByTestId('models-screen')).toBeTruthy(),
    );
    rtl.fireEvent.press(view.getByTestId('voice-models-tab'));
    await rtl.waitFor(() =>
      expect(view.getByText('Download voice')).toBeTruthy(),
    );
    rtl.fireEvent.press(view.getByText('Download voice'));
    await rtl.waitFor(() =>
      expect(view.getByTestId('voice-af_heart')).toBeTruthy(),
    );

    rtl.fireEvent.press(view.getByTestId('home-tab'));
    await rtl.waitFor(() =>
      expect(view.getByTestId('home-screen')).toBeTruthy(),
    );
    rtl.fireEvent.press(view.getByTestId('browse-models-button'));
    await rtl.waitFor(() =>
      expect(view.getByText('Journey Model')).toBeTruthy(),
    );
    rtl.fireEvent.press(view.getByTestId('model-item'));
    await rtl.waitFor(() =>
      expect(view.getByTestId('new-chat-button')).toBeTruthy(),
    );
    rtl.fireEvent.press(view.getByTestId('new-chat-button'));
    await rtl.waitFor(() =>
      expect(view.getByTestId('chat-screen')).toBeTruthy(),
    );
    rtl.fireEvent.press(view.getByTestId('quick-settings-button'));
    await rtl.waitFor(() =>
      expect(view.getByTestId('quick-tts-mode')).toBeTruthy(),
    );
    rtl.fireEvent.press(view.getByTestId('quick-tts-mode'));
    await rtl.waitFor(() =>
      expect(view.getByTestId('voice-record-button-unavailable')).toBeTruthy(),
    );

    rtl.fireEvent.press(view.getByTestId('model-selector'));
    await rtl.waitFor(
      () => expect(view.getByTestId('models-row-voice-ram')).toBeTruthy(),
      { timeout: 10000 },
    );
    rtl.fireEvent.press(view.getByText('Done'));

    rtl.fireEvent.press(view.getByTestId('chat-back-button'));
    rtl.fireEvent.press(view.getByTestId('models-tab'));
    await rtl.waitFor(() =>
      expect(view.getByTestId('models-screen')).toBeTruthy(),
    );
    rtl.fireEvent.press(view.getByTestId('downloads-icon'));
    const voiceCard = await rtl.waitFor(() =>
      view.getByTestId('completed-download-kokoro'),
    );
    rtl.fireEvent.press(
      rtl.within(voiceCard).getByTestId('delete-model-button'),
    );
    await rtl.waitFor(() =>
      expect(view.getByText('Delete Voice Model')).toBeTruthy(),
    );
    rtl.fireEvent.press(view.getByText('Delete'));
    await rtl.waitFor(
      () => expect(view.queryByTestId('completed-download-kokoro')).toBeNull(),
      { timeout: 8000 },
    );

    rtl.fireEvent.press(view.getByTestId('back-button'));
    rtl.fireEvent.press(view.getByTestId('home-tab'));
    rtl.fireEvent.press(view.getByTestId('new-chat-button'));
    await rtl.waitFor(() =>
      expect(view.getByTestId('model-selector')).toBeTruthy(),
    );
    rtl.fireEvent.press(view.getByTestId('model-selector'));
    await rtl.waitFor(() => {
      expect(view.queryByTestId('models-row-voice-ram')).toBeNull();
      expect(view.getByTestId('models-row-text')).toBeTruthy();
    });
    rtl.fireEvent.press(view.getByTestId('models-row-text'));
    const textRowId =
      'text-model-row-test/journey-model/journey-model-Q4_K_M.gguf';
    await rtl.waitFor(() => expect(view.getByTestId(textRowId)).toBeTruthy());
    rtl.fireEvent.press(view.getByTestId(textRowId));
    await rtl.waitFor(() =>
      expect(view.getByTestId('model-selector')).toBeTruthy(),
    );
    rtl.fireEvent.press(view.getByTestId('model-selector'));
    await rtl.waitFor(
      () => expect(view.getByTestId('models-row-text-ram')).toBeTruthy(),
      { timeout: 10000 },
    );
    expect(view.queryByTestId('models-row-voice-ram')).toBeNull();
  }, 45000);
});
