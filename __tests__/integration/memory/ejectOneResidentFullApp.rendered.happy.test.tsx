/** P1 #106 — eject one resident without unloading unrelated model memory. */
import { renderMainApp, sendChatMessage } from '../../harness/appJourney';
import { GB } from '../../harness/nativeBoundary';

const WHISPER_PATH = '/docs/whisper-models/ggml-tiny.en.bin';

describe('P1 single-resident eject journey', () => {
  it('ejects Speech while Text stays resident and both selections remain', async () => {
    const { boundary, rtl, view } = await renderMainApp({
      boundary: {
        llama: true,
        whisper: true,
        ram: { platform: 'android', totalBytes: 12 * GB, availBytes: 10 * GB },
      },
      beforeRender: ({ boundary: native }) => {
        native.fs!.seedFile(WHISPER_PATH, 75 * 1024 * 1024);
      },
    });
    const { act, fireEvent, waitFor } = rtl;

    // A real text turn performs the lazy load and registers Text as resident.
    await act(async () => {
      fireEvent.press(view.getByTestId('browse-models-button'));
    });
    await waitFor(() => expect(view.getByText('Journey Model')).toBeTruthy());
    await act(async () => {
      fireEvent.press(view.getByTestId('model-item'));
    });
    await waitFor(() =>
      expect(view.getByTestId('new-chat-button')).toBeTruthy(),
    );
    await act(async () => {
      fireEvent.press(view.getByTestId('new-chat-button'));
    });
    await waitFor(() => expect(view.getByTestId('chat-screen')).toBeTruthy());
    boundary.llama!.scriptCompletion({ text: 'Text remains available.' });
    sendChatMessage(rtl, view, 'warm the text model');
    await waitFor(() =>
      expect(view.getByText('Text remains available.')).toBeTruthy(),
    );

    // Selecting the downloaded Whisper model through its real screen loads and
    // registers Speech without replacing Text on this roomy device.
    await act(async () => {
      fireEvent.press(view.getByTestId('chat-back-button'));
    });
    await waitFor(() => expect(view.getByTestId('home-screen')).toBeTruthy());
    await act(async () => {
      fireEvent.press(view.getByTestId('models-tab'));
    });
    await waitFor(() => expect(view.getByTestId('models-screen')).toBeTruthy());
    await act(async () => {
      fireEvent.press(view.getByTestId('transcription-models-tab'));
    });
    await waitFor(() => {
      expect(view.getByTestId('transcription-model-card-0')).toBeTruthy();
      expect(
        view.queryByTestId('transcription-model-card-0-download'),
      ).toBeNull();
    });
    await act(async () => {
      fireEvent.press(view.getByTestId('transcription-model-card-0'));
    });

    await act(async () => {
      fireEvent.press(view.getByTestId('home-tab'));
    });
    await waitFor(() => expect(view.getByTestId('home-screen')).toBeTruthy());
    await act(async () => {
      fireEvent.press(view.getByTestId('models-summary'));
    });
    await waitFor(() => {
      expect(view.getByTestId('models-row-text-ram')).toBeTruthy();
      expect(view.getByTestId('models-row-speech-ram')).toBeTruthy();
      expect(view.getByTestId('models-row-text')).toHaveTextContent(
        /Journey Model/,
      );
      expect(view.getByTestId('models-row-speech')).toHaveTextContent(/Tiny/);
    });

    // User ejects only Speech from the In Memory surface.
    await act(async () => {
      fireEvent.press(view.getByTestId('models-row-speech-eject'));
    });
    await waitFor(() => {
      expect(view.queryByTestId('models-row-speech-ram')).toBeNull();
      expect(view.queryByTestId('models-row-speech-eject')).toBeNull();
      expect(view.getByTestId('models-row-text-ram')).toBeTruthy();
      expect(view.getByTestId('models-row-text-eject')).toBeTruthy();
      expect(view.getByTestId('models-row-text')).toHaveTextContent(
        /Journey Model/,
      );
      expect(view.getByTestId('models-row-speech')).toHaveTextContent(/Tiny/);
    });

    view.unmount();
  }, 30000);
});
