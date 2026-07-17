/** P1 #63 — Stop in Voice mode ends native generation without losing or extending shown output. */
import {
  openChatWithJourneyModel,
  renderMainApp,
} from '../../harness/appJourney';
import { GB } from '../../harness/nativeBoundary';

const WHISPER_PATH = '/docs/whisper-models/ggml-tiny.en.bin';
const TRANSCRIPT = 'Tell me a long story about the moon';
const PARTIAL = 'The moon rose over the quiet village';
const GHOST_CONTINUATION = ', and the story continued after Stop.';

describe('P1 full-app Voice-mode Stop journey', () => {
  it('keeps the shown partial and returns Voice controls to idle', async () => {
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
    boundary.llama!.scriptCompletion({
      text: `${PARTIAL}${GHOST_CONTINUATION}`,
      pauseAfter: PARTIAL,
    });
    rtl.fireEvent.press(view.getByTestId('voice-record-button-audio'));
    await rtl.act(async () => {
      await new Promise(resolve => setTimeout(resolve, 50));
    });
    rtl.fireEvent.press(view.getByTestId('voice-record-button-audio'));

    try {
      await rtl.waitFor(
        () => {
          expect(view.getByTestId('audio-bubble-streaming')).toBeTruthy();
          expect(view.getByText('Streaming voice response')).toBeTruthy();
          expect(view.getByTestId('stop-button')).toBeTruthy();
          expect(view.queryByTestId('voice-record-button-audio')).toBeNull();
        },
        { timeout: 8000 },
      );
      rtl.fireEvent.press(view.getByTestId('stop-button'));
    } finally {
      boundary.llama!.releaseStream();
    }

    await rtl.waitFor(
      () => {
        expect(view.queryByTestId('stop-button')).toBeNull();
        expect(view.getByTestId('voice-record-button-audio')).toBeTruthy();
        expect(view.queryByTestId('voice-loading')).toBeNull();
        expect(view.getAllByTestId(/^audio-bubble-/)).toHaveLength(2);
        expect(view.getAllByText('Show transcript')).toHaveLength(2);
      },
      { timeout: 8000 },
    );
    rtl.fireEvent.press(view.getAllByText('Show transcript')[1]);
    await rtl.waitFor(() =>
      expect(view.getAllByText(PARTIAL).length).toBeGreaterThan(0),
    );
    await rtl.act(async () => {
      await new Promise(resolve => setTimeout(resolve, 150));
    });
    expect(view.getAllByText(PARTIAL).length).toBeGreaterThan(0);
    expect(view.queryByText(new RegExp(GHOST_CONTINUATION))).toBeNull();
    expect(view.queryByTestId('stop-button')).toBeNull();
    view.unmount();
  }, 30000);
});
