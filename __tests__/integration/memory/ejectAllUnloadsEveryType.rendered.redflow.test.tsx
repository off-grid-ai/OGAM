/** P1 #105 — Eject All frees text, image, voice, and speech model memory. */
import {
  renderMainApp,
  seedDownloadedMnnImageModel,
  sendChatMessage,
} from '../../harness/appJourney';
import { GB } from '../../harness/nativeBoundary';

const WHISPER_PATH = '/docs/whisper-models/ggml-tiny.en.bin';

describe('P1 Eject All journey', () => {
  it('removes every resident model type through the rendered manager action', async () => {
    const { boundary, rtl, view } = await renderMainApp({
      boundary: {
        llama: true,
        whisper: true,
        ram: { platform: 'android', totalBytes: 16 * GB, availBytes: 14 * GB },
      },
      beforeRender: async ({ boundary: native, asyncStorage }) => {
        native.fs!.seedFile(WHISPER_PATH, 75 * 1024 * 1024);
        await seedDownloadedMnnImageModel(native, asyncStorage);
      },
    });
    const { act, fireEvent, waitFor } = rtl;

    // Download the real Pro voice model from the real Models tab. Downloading is
    // intentionally separate from residency; entering Voice mode below loads it.
    await act(async () => {
      fireEvent.press(view.getByTestId('models-tab'));
    });
    await waitFor(() => expect(view.getByTestId('models-screen')).toBeTruthy());
    await act(async () => {
      fireEvent.press(view.getByTestId('voice-models-tab'));
    });
    await waitFor(() => expect(view.getByText('Download voice')).toBeTruthy());
    await act(async () => {
      fireEvent.press(view.getByText('Download voice'));
    });
    await waitFor(() =>
      expect(view.getByTestId('voice-af_heart')).toBeTruthy(),
    );

    // Select and warm the text model through a genuine chat turn.
    await act(async () => {
      fireEvent.press(view.getByTestId('home-tab'));
    });
    await waitFor(() => expect(view.getByTestId('home-screen')).toBeTruthy());
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
    boundary.llama!.scriptCompletion({ text: 'Text is resident.' });
    sendChatMessage(rtl, view, 'warm the text model');
    await waitFor(() =>
      expect(view.getByText('Text is resident.')).toBeTruthy(),
    );

    // Select the downloaded speech model through Models; selection performs its
    // real on-demand Whisper load and registers the Speech resident.
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

    // Select Image from the Home manager, then generate once so the diffusion
    // engine is genuinely resident alongside Text and Speech on the roomy device.
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
      fireEvent.press(view.getByTestId('models-row-image'));
    });
    await waitFor(() => expect(view.getByText('Journey Image')).toBeTruthy());
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
    await act(async () => {
      fireEvent.press(view.getByTestId('quick-settings-button'));
    });
    await waitFor(() =>
      expect(view.getByTestId('quick-image-mode')).toBeTruthy(),
    );
    await act(async () => {
      fireEvent.press(view.getByTestId('quick-image-mode'));
    });
    const ReactNative =
      require('react-native') as typeof import('react-native');
    const quickSettings = view
      .UNSAFE_getAllByType(ReactNative.Modal)
      .find(modal => modal.props.visible);
    expect(quickSettings).toBeTruthy();
    await act(async () => {
      fireEvent(quickSettings!, 'requestClose');
    });
    sendChatMessage(rtl, view, 'a lighthouse at night');
    await waitFor(
      () => expect(view.getByTestId('generated-image')).toBeTruthy(),
      {
        timeout: 8000,
      },
    );

    // Enter Voice mode through the rendered quick-settings row. The downloaded
    // TTS engine initializes through the real Pro store and becomes resident.
    await act(async () => {
      fireEvent.press(view.getByTestId('quick-settings-button'));
    });
    await waitFor(() =>
      expect(view.getByTestId('quick-tts-mode')).toBeTruthy(),
    );
    await act(async () => {
      fireEvent.press(view.getByTestId('quick-tts-mode'));
    });
    await waitFor(() =>
      expect(view.getByTestId('voice-record-button-audio')).toBeTruthy(),
    );

    // Product-visible precondition: every modality row reports resident RAM.
    await act(async () => {
      fireEvent.press(view.getByTestId('model-selector'));
    });
    await waitFor(
      () => {
        for (const type of ['text', 'image', 'voice', 'speech']) {
          expect(view.getByTestId(`models-row-${type}-ram`)).toBeTruthy();
        }
      },
      { timeout: 10000 },
    );

    await act(async () => {
      fireEvent.press(view.getByText('Eject All Models'));
    });
    await waitFor(() =>
      expect(
        view.getByText('Unload all active models to free up memory?'),
      ).toBeTruthy(),
    );
    await act(async () => {
      fireEvent.press(view.getByText('Eject'));
    });
    await waitFor(
      () => expect(view.getByText('Unloaded 4 models')).toBeTruthy(),
      {
        timeout: 10000,
      },
    );
    await act(async () => {
      fireEvent.press(view.getByText('OK'));
    });

    // Reopen the same residency surface: selections remain, but every RAM chip
    // is gone. This is the user-visible meaning of a successful Eject All.
    await act(async () => {
      fireEvent.press(view.getByTestId('model-selector'));
    });
    await waitFor(() => {
      expect(view.getByTestId('models-row-text')).toHaveTextContent(
        /Journey Model/,
      );
      expect(view.getByTestId('models-row-image')).toHaveTextContent(
        /Journey Image/,
      );
      for (const type of ['text', 'image', 'voice', 'speech']) {
        expect(view.queryByTestId(`models-row-${type}-ram`)).toBeNull();
      }
    });
    view.unmount();
  }, 60000);
});
