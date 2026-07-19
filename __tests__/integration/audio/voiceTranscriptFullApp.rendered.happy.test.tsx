/** P1 #59 + P2 #110 — Voice artifacts survive a model-delete attempt during playback. */
import {
  openChatWithJourneyModel,
  renderMainApp,
} from '../../harness/appJourney';
import { GB } from '../../harness/nativeBoundary';

const WHISPER_PATH = '/docs/whisper-models/ggml-tiny.en.bin';
const TRANSCRIPT = 'What is the capital of France?';
const ANSWER = 'Paris is the capital of France.';

describe('P1 full-app Voice-mode transcript journey', () => {
  it('renders the recognized user transcript and the assistant reply', async () => {
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

    rtl.fireEvent.press(view.getByTestId('transcription-models-tab'));
    await rtl.waitFor(() => {
      expect(view.getByTestId('transcription-model-card-0')).toBeTruthy();
      expect(
        view.queryByTestId('transcription-model-card-0-download'),
      ).toBeNull();
    });
    rtl.fireEvent.press(view.getByTestId('transcription-model-card-0'));

    rtl.fireEvent.press(view.getByTestId('home-tab'));
    await rtl.waitFor(() =>
      expect(view.getByTestId('home-screen')).toBeTruthy(),
    );
    await openChatWithJourneyModel(rtl, view);

    rtl.fireEvent.press(view.getByTestId('quick-settings-button'));
    rtl.fireEvent.press(
      await rtl.waitFor(() => view.getByTestId('quick-tts-mode')),
    );
    await rtl.waitFor(() =>
      expect(view.getByTestId('voice-record-button-audio')).toBeTruthy(),
    );

    boundary.whisper!.setFileTranscript(TRANSCRIPT);
    boundary.llama!.scriptCompletion({ text: ANSWER });
    rtl.fireEvent.press(view.getByTestId('voice-record-button-audio'));
    await rtl.act(async () => {
      await new Promise(resolve => setTimeout(resolve, 50));
    });
    rtl.fireEvent.press(view.getByTestId('voice-record-button-audio'));

    await rtl.waitFor(
      () => {
        expect(view.getAllByTestId(/^audio-bubble-/)).toHaveLength(2);
        expect(view.getAllByText('Show transcript')).toHaveLength(2);
      },
      { timeout: 8000 },
    );

    const transcriptToggles = view.getAllByText('Show transcript');
    rtl.fireEvent.press(transcriptToggles[0]);
    rtl.fireEvent.press(transcriptToggles[1]);
    await rtl.waitFor(() => {
      expect(view.getAllByText(TRANSCRIPT).length).toBeGreaterThan(0);
      expect(view.getAllByText(ANSWER).length).toBeGreaterThan(0);
      expect(view.queryByTestId('voice-loading')).toBeNull();
    });

    // #110: play the recorded native file, then attempt to delete the Voice
    // model from Download Manager while the unified playback owner is active.
    // The deletion is refused and the same conversation still exposes Stop.
    rtl.fireEvent.press(view.getAllByLabelText('Play')[0]);
    await rtl.waitFor(() =>
      expect(view.getByTestId('tts-stop-button')).toBeTruthy(),
    );
    rtl.fireEvent.press(view.getByTestId('model-selector'));
    rtl.fireEvent.press(
      await rtl.waitFor(() => view.getByTestId('models-row-voice')),
    );
    await rtl.waitFor(() =>
      expect(view.getByText(/Remove voice model/)).toBeTruthy(),
    );
    rtl.fireEvent.press(view.getByText(/Remove voice model/));
    await rtl.waitFor(() =>
      expect(view.getByText('Remove Voice Model')).toBeTruthy(),
    );
    rtl.fireEvent.press(view.getByText('Remove'));
    await rtl.waitFor(() => {
      expect(view.getByTestId('tts-stop-button')).toBeTruthy();
      expect(
        view.getByText('Stop voice playback before deleting the model.'),
      ).toBeTruthy();
      expect(view.getByTestId('voice-af_heart')).toBeTruthy();
    });
    view.unmount();
  }, 45000);
});
