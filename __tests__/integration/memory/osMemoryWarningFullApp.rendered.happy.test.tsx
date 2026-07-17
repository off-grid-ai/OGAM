/** P1 #96 — an OS memory warning evicts idle sidecars, never active text. */
import {
  openChatWithJourneyModel,
  renderMainApp,
  sendChatMessage,
} from '../../harness/appJourney';
import { GB } from '../../harness/nativeBoundary';

const WHISPER_PATH = '/docs/whisper-models/ggml-tiny.en.bin';

describe('P1 full-App OS memory-warning reclaim journey', () => {
  it('visibly removes idle Speech while retained Text answers another turn', async () => {
    const { boundary, rtl, view } = await renderMainApp({
      boundary: {
        llama: true,
        whisper: true,
        ram: { platform: 'android', totalBytes: 16 * GB, availBytes: 14 * GB },
      },
      beforeRender: ({ boundary: native }) => {
        native.fs!.seedFile(WHISPER_PATH, 75 * 1024 * 1024);
      },
    });
    const { act, fireEvent, waitFor } = rtl;

    await openChatWithJourneyModel(rtl, view);
    boundary.llama!.scriptCompletion({ text: 'The text model is resident.' });
    sendChatMessage(rtl, view, 'Load the text model');
    await waitFor(
      () => expect(view.getByText('The text model is resident.')).toBeTruthy(),
      { timeout: 8000 },
    );
    fireEvent.press(view.getByTestId('chat-back-button'));
    await waitFor(() => expect(view.getByTestId('home-screen')).toBeTruthy());

    fireEvent.press(view.getByTestId('models-tab'));
    await waitFor(() => expect(view.getByTestId('models-screen')).toBeTruthy());
    fireEvent.press(view.getByTestId('transcription-models-tab'));
    await waitFor(() => {
      expect(view.getByTestId('transcription-model-card-0')).toBeTruthy();
      expect(
        view.queryByTestId('transcription-model-card-0-download'),
      ).toBeNull();
    });
    fireEvent.press(view.getByTestId('transcription-model-card-0'));

    fireEvent.press(view.getByTestId('home-tab'));
    await waitFor(() => expect(view.getByTestId('home-screen')).toBeTruthy());
    fireEvent.press(view.getByTestId('models-summary'));
    await waitFor(() => {
      expect(view.getByTestId('models-row-text-ram')).toBeTruthy();
      expect(view.getByTestId('models-row-speech-ram')).toBeTruthy();
      expect(view.getByTestId('models-row-text')).toHaveTextContent(
        /Journey Model/,
      );
      expect(view.getByTestId('models-row-speech')).toHaveTextContent(/Tiny/);
    });

    await act(async () => {
      boundary.emitMemoryWarning();
    });
    await waitFor(
      () => {
        expect(view.getByTestId('models-row-text-ram')).toBeTruthy();
        expect(view.queryByTestId('models-row-speech-ram')).toBeNull();
        expect(view.getByTestId('models-row-speech')).toHaveTextContent(/Tiny/);
      },
      { timeout: 4000 },
    );

    fireEvent.press(view.getByText('Done'));
    await waitFor(() => expect(view.getByTestId('home-screen')).toBeTruthy());
    fireEvent.press(view.getByTestId('new-chat-button'));
    await waitFor(() => expect(view.getByTestId('chat-screen')).toBeTruthy());

    boundary.llama!.scriptCompletion({
      text: 'The retained text model still answers.',
    });
    sendChatMessage(rtl, view, 'Are you still available?');
    await waitFor(
      () =>
        expect(
          view.getByText('The retained text model still answers.'),
        ).toBeTruthy(),
      { timeout: 8000 },
    );

    fireEvent.press(view.getByTestId('model-selector'));
    await waitFor(() => {
      expect(view.getByTestId('models-row-text-ram')).toBeTruthy();
      expect(view.queryByTestId('models-row-speech-ram')).toBeNull();
    });

    view.unmount();
  }, 30000);
});
