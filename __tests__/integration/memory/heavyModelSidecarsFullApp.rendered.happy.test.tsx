/** P1 #90 - Speech and Voice sidecars co-reside with a heavy text model. */
import type { DownloadedModel } from '../../../src/types';
import {
  openChatWithJourneyModel,
  renderMainApp,
  sendChatMessage,
} from '../../harness/appJourney';
import { GB } from '../../harness/nativeBoundary';

const WHISPER_PATH = '/docs/whisper-models/ggml-tiny.en.bin';

const heavyTextModel: DownloadedModel = {
  id: 'test/heavy-journey/heavy-journey-Q4_K_M.gguf',
  name: 'Journey Model',
  author: 'test',
  filePath: '/docs/models/heavy-journey-Q4_K_M.gguf',
  fileName: 'heavy-journey-Q4_K_M.gguf',
  fileSize: 4 * GB,
  quantization: 'Q4_K_M',
  downloadedAt: '2026-07-17T00:00:00.000Z',
  engine: 'llama',
};

describe('P1 heavy-model sidecar co-residency', () => {
  it('keeps Text, Speech, and Voice in RAM through a complete voice turn', async () => {
    const { boundary, rtl, view } = await renderMainApp({
      boundary: {
        llama: true,
        whisper: true,
        ram: { platform: 'android', totalBytes: 16 * GB, availBytes: 14 * GB },
      },
      downloadedModels: [heavyTextModel],
      beforeRender: ({ boundary: native }) => {
        native.fs!.seedFile(WHISPER_PATH, 75 * 1024 * 1024);
      },
    });

    // Download the Voice sidecar through its real Models surface.
    rtl.fireEvent.press(view.getByTestId('models-tab'));
    await rtl.waitFor(() =>
      expect(view.getByTestId('models-screen')).toBeTruthy(),
    );
    rtl.fireEvent.press(view.getByTestId('voice-models-tab'));
    rtl.fireEvent.press(
      await rtl.waitFor(() => view.getByText('Download voice')),
    );
    await rtl.waitFor(() =>
      expect(view.getByTestId('voice-af_heart')).toBeTruthy(),
    );

    // Select and warm the 4 GB text model with a real chat turn.
    rtl.fireEvent.press(view.getByTestId('home-tab'));
    await rtl.waitFor(() =>
      expect(view.getByTestId('home-screen')).toBeTruthy(),
    );
    await openChatWithJourneyModel(rtl, view);
    boundary.llama!.scriptCompletion({ text: 'The heavy model is ready.' });
    sendChatMessage(rtl, view, 'Warm up the heavy model');
    await rtl.waitFor(
      () => expect(view.getByText('The heavy model is ready.')).toBeTruthy(),
      { timeout: 8000 },
    );

    // Select the downloaded Speech sidecar through the real Models screen.
    rtl.fireEvent.press(view.getByTestId('chat-back-button'));
    await rtl.waitFor(() =>
      expect(view.getByTestId('home-screen')).toBeTruthy(),
    );
    rtl.fireEvent.press(view.getByTestId('models-tab'));
    await rtl.waitFor(() =>
      expect(view.getByTestId('models-screen')).toBeTruthy(),
    );
    rtl.fireEvent.press(view.getByTestId('transcription-models-tab'));
    await rtl.waitFor(() => {
      expect(view.getByTestId('transcription-model-card-0')).toBeTruthy();
      expect(
        view.queryByTestId('transcription-model-card-0-download'),
      ).toBeNull();
    });
    rtl.fireEvent.press(view.getByTestId('transcription-model-card-0'));

    // Return to chat and enter Voice mode, which loads the downloaded TTS sidecar.
    rtl.fireEvent.press(view.getByTestId('home-tab'));
    await rtl.waitFor(() =>
      expect(view.getByTestId('home-screen')).toBeTruthy(),
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

    // One voice turn exercises Speech -> heavy Text -> Voice before residency is inspected.
    boundary.whisper!.setFileTranscript('Can all three models stay loaded?');
    boundary.llama!.scriptCompletion({ text: 'All three are still ready.' });
    rtl.fireEvent.press(view.getByTestId('voice-record-button-audio'));
    await rtl.act(async () => {
      await new Promise(resolve => setTimeout(resolve, 50));
    });
    rtl.fireEvent.press(view.getByTestId('voice-record-button-audio'));
    await rtl.waitFor(
      () => {
        expect(
          view.getAllByTestId(/^audio-bubble-/).length,
        ).toBeGreaterThanOrEqual(2);
      },
      { timeout: 10000 },
    );
    const transcriptToggles = view.getAllByText('Show transcript');
    rtl.fireEvent.press(transcriptToggles[transcriptToggles.length - 1]);
    await rtl.waitFor(() =>
      expect(
        view.getAllByText('All three are still ready.').length,
      ).toBeGreaterThan(0),
    );

    rtl.fireEvent.press(view.getByTestId('model-selector'));
    await rtl.waitFor(
      () => {
        for (const type of ['text', 'speech', 'voice']) {
          const ram = view.getByTestId(`models-row-${type}-ram`);
          expect(rtl.within(ram).getByText(/GB/)).toBeTruthy();
        }
        expect(view.getByTestId('models-row-text')).toHaveTextContent(
          /Journey Model/,
        );
        expect(view.getByTestId('models-row-speech')).toHaveTextContent(/Tiny/);
      },
      { timeout: 10000 },
    );

    view.unmount();
  }, 60000);
});
