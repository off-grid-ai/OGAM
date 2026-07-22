/** P1 #219 — a speak-time memory refusal is visible and recovers through Load Anyway. */
import {
  openChatWithJourneyModel,
  renderMainApp,
  sendChatMessage,
} from '../../harness/appJourney';
import { GB, MB } from '../../harness/nativeBoundary';

const PROMPT = 'Give me a short sentence to speak.';
const REPLY = 'A recoverable voice answer.';

type StreamOptions = {
  text: string;
  onNext: (chunk: Float32Array) => Promise<void>;
  onEnd?: () => Promise<void>;
};

describe('P1 full-App TTS memory-pressure recovery', () => {
  it('surfaces Load Anyway at the survival floor, then speaks after device memory recovers', async () => {
    const spoken: string[] = [];
    const { boundary, rtl, view } = await renderMainApp({
      boundary: {
        llama: true,
        ram: {
          platform: 'ios',
          totalBytes: 12 * GB,
          availBytes: 8 * GB,
        },
      },
      beforeRender: () => {
        const { useTextToSpeech } = require('react-native-executorch') as {
          useTextToSpeech: jest.Mock;
        };
        useTextToSpeech.mockReturnValue({
          isReady: true,
          downloadProgress: 1,
          error: null,
          stream: jest.fn(async (options: StreamOptions) => {
            spoken.push(options.text);
            await options.onNext(new Float32Array(8));
            await options.onEnd?.();
          }),
          streamStop: jest.fn(),
        });
      },
    });

    // Install the real Kokoro feature through the same Models journey as a user.
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

    rtl.fireEvent.press(view.getByTestId('home-tab'));
    await openChatWithJourneyModel(rtl, view);
    boundary.llama!.scriptCompletion({ text: REPLY });
    sendChatMessage(rtl, view, PROMPT);
    await rtl.waitFor(() => {
      expect(view.getAllByTestId('assistant-message')).toHaveLength(1);
      expect(view.getByText(REPLY)).toBeTruthy();
    });

    // Turn on the real voice mode once so the downloaded runtime enters residency
    // accounting, then free the answered text + voice models through the UI. This
    // leaves the voice model installed but cold for the next Speak gesture.
    rtl.fireEvent.press(view.getByTestId('quick-settings-button'));
    rtl.fireEvent.press(
      await rtl.waitFor(() => view.getByTestId('quick-tts-mode')),
    );
    await rtl.waitFor(() =>
      expect(view.queryByTestId('quick-tts-mode')).toBeNull(),
    );
    rtl.fireEvent.press(view.getByTestId('model-selector'));
    await rtl.waitFor(() =>
      expect(view.getByTestId('models-row-voice-ram')).toBeTruthy(),
    );
    rtl.fireEvent.press(
      await rtl.waitFor(() => view.getByText('Eject All Models')),
    );
    await rtl.waitFor(() =>
      expect(
        view.getByText('Unload all active models to free up memory?'),
      ).toBeTruthy(),
    );
    rtl.fireEvent.press(view.getByText('Eject'));
    await rtl.waitFor(
      () => expect(view.getByText(/Unloaded [1-9]\d* models?/)).toBeTruthy(),
      { timeout: 20000 },
    );
    rtl.fireEvent.press(view.getByText('OK'));
    spoken.length = 0;

    // Device boundary: pressure arrives after the local reply. With no resident
    // model left to reclaim, the survival floor must refuse the voice load.
    boundary.setRam({
      platform: 'ios',
      totalBytes: 12 * GB,
      availBytes: 200 * MB,
    });

    const assistantAudio = view.getAllByTestId(/^audio-bubble-/).at(-1)!;
    rtl.fireEvent.press(rtl.within(assistantAudio).getByLabelText('Play'));

    await rtl.waitFor(() => {
      expect(view.getByTestId('model-failure-tts')).toBeTruthy();
      expect(view.getByText('Voice: Not Enough Memory')).toBeTruthy();
      expect(view.getByTestId('model-failure-load-anyway-tts')).toBeTruthy();
      expect(
        rtl.within(assistantAudio).getByText('Show transcript'),
      ).toBeTruthy();
    });
    expect(spoken).toHaveLength(0);

    // Closing other apps is an external recovery action. The explicit retry then
    // dismisses the card and reaches visible TTS playback without a relaunch.
    boundary.setRam({
      platform: 'ios',
      totalBytes: 12 * GB,
      availBytes: 4 * GB,
    });
    rtl.fireEvent.press(view.getByTestId('model-failure-load-anyway-tts'));
    await rtl.waitFor(
      () => {
        expect(view.queryByTestId('model-failure-tts')).toBeNull();
        expect(spoken).toEqual([REPLY]);
        expect(
          rtl.within(assistantAudio).getByText('Show transcript'),
        ).toBeTruthy();
      },
      { timeout: 8000 },
    );
    expect(view.getAllByTestId(/^audio-bubble-/).at(-1)).toBe(assistantAudio);

    view.unmount();
  }, 30000);
});
