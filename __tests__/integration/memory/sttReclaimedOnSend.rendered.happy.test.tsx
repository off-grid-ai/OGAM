/** P0 #93 — a typed text turn reclaims idle STT on a memory-tight device. */
import { renderMainApp, sendChatMessage } from '../../harness/appJourney';
import { GB } from '../../harness/nativeBoundary';

const WHISPER_PATH = '/docs/whisper-models/ggml-tiny.en.bin';

describe('P0 idle-STT reclaim journey', () => {
  it('renders the reply and removes only Speech from In Memory on a 6 GB device', async () => {
    const { boundary, rtl, view } = await renderMainApp({
      boundary: {
        llama: true,
        whisper: true,
        ram: { platform: 'android', totalBytes: 6 * GB, availBytes: 5 * GB },
      },
      beforeRender: ({ boundary: native }) => {
        native.fs!.seedFile(WHISPER_PATH, 75 * 1024 * 1024);
      },
    });
    const { act, fireEvent, waitFor } = rtl;

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
    boundary.llama!.scriptCompletion({ text: 'Text model is ready.' });
    sendChatMessage(rtl, view, 'warm up the text model');
    await waitFor(() =>
      expect(view.getByText('Text model is ready.')).toBeTruthy(),
    );
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
    });
    await act(async () => {
      fireEvent.press(view.getByText('Done'));
    });

    await act(async () => {
      fireEvent.press(view.getByTestId('new-chat-button'));
    });
    await waitFor(() => expect(view.getByTestId('chat-screen')).toBeTruthy());
    boundary.llama!.scriptCompletion({ text: 'It is 4.' });
    sendChatMessage(rtl, view, 'what is 2 plus 2');
    await waitFor(() => expect(view.getByText('It is 4.')).toBeTruthy(), {
      timeout: 6000,
    });

    await act(async () => {
      fireEvent.press(view.getByTestId('model-selector'));
    });
    await waitFor(() => {
      expect(view.getByTestId('models-row-text-ram')).toBeTruthy();
      expect(view.queryByTestId('models-row-speech-ram')).toBeNull();
    });
    view.unmount();
  }, 30000);
});
