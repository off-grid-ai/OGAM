/** P1 #94 — a constrained Voice turn reclaims idle STT but keeps text resident. */
import {
  openChatWithJourneyModel,
  renderMainApp,
  sendChatMessage,
} from '../../harness/appJourney';
import { GB } from '../../harness/nativeBoundary';

const WHISPER_PATH = '/docs/whisper-models/ggml-tiny.en.bin';
const TRANSCRIPT = 'What is two plus two?';
const ANSWER = 'Two plus two is four.';

describe('P1 full-App idle-STT reclaim in Voice mode', () => {
  it('completes the spoken turn and removes only Speech from In Memory', async () => {
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

    await openChatWithJourneyModel(rtl, view);
    boundary.llama!.scriptCompletion({ text: 'The text model is ready.' });
    sendChatMessage(rtl, view, 'Warm up the text model');
    await waitFor(
      () => expect(view.getByText('The text model is ready.')).toBeTruthy(),
      { timeout: 8000 },
    );
    fireEvent.press(view.getByTestId('chat-back-button'));
    await waitFor(() => expect(view.getByTestId('home-screen')).toBeTruthy());

    fireEvent.press(view.getByTestId('models-tab'));
    await waitFor(() => expect(view.getByTestId('models-screen')).toBeTruthy());
    fireEvent.press(view.getByTestId('voice-models-tab'));
    fireEvent.press(await waitFor(() => view.getByText('Download voice')));
    await waitFor(() =>
      expect(view.getByTestId('voice-af_heart')).toBeTruthy(),
    );

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
    fireEvent.press(view.getByText('Done'));
    await waitFor(() =>
      expect(view.queryByTestId('models-row-speech')).toBeNull(),
    );

    fireEvent.press(view.getByTestId('new-chat-button'));
    await waitFor(() => expect(view.getByTestId('chat-screen')).toBeTruthy());
    fireEvent.press(view.getByTestId('quick-settings-button'));
    fireEvent.press(await waitFor(() => view.getByTestId('quick-tts-mode')));
    await waitFor(() =>
      expect(view.getByTestId('voice-record-button-audio')).toBeTruthy(),
    );

    boundary.whisper!.setFileTranscript(TRANSCRIPT);
    boundary.llama!.scriptCompletion({ text: ANSWER });
    fireEvent.press(view.getByTestId('voice-record-button-audio'));
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 50));
    });
    fireEvent.press(view.getByTestId('voice-record-button-audio'));

    await waitFor(
      () => {
        expect(view.getAllByTestId(/^audio-bubble-/)).toHaveLength(2);
        expect(view.getAllByText('Show transcript')).toHaveLength(2);
        expect(view.queryByTestId('voice-loading')).toBeNull();
      },
      { timeout: 8000 },
    );
    const transcriptToggles = view.getAllByText('Show transcript');
    fireEvent.press(transcriptToggles[0]);
    fireEvent.press(transcriptToggles[1]);
    await waitFor(() => {
      expect(view.getAllByText(TRANSCRIPT).length).toBeGreaterThan(0);
      expect(view.getAllByText(ANSWER).length).toBeGreaterThan(0);
    });

    fireEvent.press(view.getByTestId('model-selector'));
    await waitFor(() => {
      expect(view.getByTestId('models-row-text-ram')).toBeTruthy();
      expect(view.queryByTestId('models-row-speech-ram')).toBeNull();
      expect(view.getByTestId('models-row-text')).toHaveTextContent(
        /Journey Model/,
      );
    });

    view.unmount();
  }, 30000);
});
