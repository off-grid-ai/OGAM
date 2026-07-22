/** P1 #61 — a Voice-mode draw request follows the real Auto router into image generation. */
import {
  renderMainApp,
  seedDownloadedMnnImageModel,
} from '../../harness/appJourney';
import { GB } from '../../harness/nativeBoundary';

const WHISPER_PATH = '/docs/whisper-models/ggml-tiny.en.bin';
const TRANSCRIPT = 'Draw a red fox sleeping in the snow';

describe('P1 full-app Voice-mode image routing', () => {
  it('renders the spoken request and its generated image', async () => {
    const { boundary, rtl, view } = await renderMainApp({
      boundary: {
        whisper: true,
        ram: { platform: 'android', totalBytes: 16 * GB, availBytes: 14 * GB },
      },
      beforeRender: async ({ boundary: native, asyncStorage }) => {
        native.fs!.seedFile(WHISPER_PATH, 75 * 1024 * 1024);
        await seedDownloadedMnnImageModel(native, asyncStorage);
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
    rtl.fireEvent.press(view.getByTestId('models-summary'));
    await rtl.waitFor(() =>
      expect(view.getByTestId('models-row-image')).toBeTruthy(),
    );
    rtl.fireEvent.press(view.getByTestId('models-row-image'));
    await rtl.waitFor(() =>
      expect(view.getByText('Journey Image')).toBeTruthy(),
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
    rtl.fireEvent.press(
      await rtl.waitFor(() => view.getByTestId('quick-tts-mode')),
    );
    await rtl.waitFor(() =>
      expect(view.getByTestId('voice-record-button-audio')).toBeTruthy(),
    );

    boundary.whisper!.setFileTranscript(TRANSCRIPT);
    rtl.fireEvent.press(view.getByTestId('voice-record-button-audio'));
    await rtl.act(async () => {
      await new Promise(resolve => setTimeout(resolve, 50));
    });
    rtl.fireEvent.press(view.getByTestId('voice-record-button-audio'));

    await rtl.waitFor(
      () => {
        expect(view.getAllByTestId(/^audio-bubble-/)).toHaveLength(2);
        expect(view.getByTestId('generated-image-content')).toBeTruthy();
        expect(
          view.getByText(/Generated image for:.*red fox sleeping in the snow/i),
        ).toBeTruthy();
      },
      { timeout: 8000 },
    );
    const transcriptToggles = view.getAllByText('Show transcript');
    rtl.fireEvent.press(transcriptToggles[0]);
    await rtl.waitFor(() => {
      expect(view.getAllByText(TRANSCRIPT).length).toBeGreaterThan(0);
      expect(view.getByTestId('generated-image-content').props.source.uri).toBe(
        'file:///generated/img-1.png',
      );
      expect(view.queryByTestId('voice-loading')).toBeNull();
    });
    view.unmount();
  }, 30000);
});
