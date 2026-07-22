/** P1 #62 + P2 #91 — full-App Voice tool and residency journey. */
import { Switch } from 'react-native';
import {
  openChatWithJourneyModel,
  renderMainApp,
} from '../../harness/appJourney';
import { GB } from '../../harness/nativeBoundary';

const WHISPER_PATH = '/docs/whisper-models/ggml-tiny.en.bin';
const MODEL_PATH = '/docs/models/llama-3-journey-Q4_K_M.gguf';
const TRANSCRIPT = 'Use the calculator for 500 times 321';
const ANSWER = 'That is 160500.';

describe('P1 full-app Voice-mode calculator journey', () => {
  it('renders the spoken request, calculator result, and voiced answer', async () => {
    const { boundary, rtl, view } = await renderMainApp({
      boundary: {
        llama: true,
        whisper: true,
        ram: { platform: 'android', totalBytes: 16 * GB, availBytes: 14 * GB },
      },
      downloadedModels: [
        {
          id: 'test/llama-3-journey/llama-3-journey-Q4_K_M.gguf',
          name: 'Journey Model',
          author: 'test',
          fileName: 'llama-3-journey-Q4_K_M.gguf',
          filePath: MODEL_PATH,
          fileSize: 128 * 1024 * 1024,
          quantization: 'Q4_K_M',
          downloadedAt: '2026-01-01T00:00:00.000Z',
          engine: 'llama',
        },
      ],
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
    const toolsButton = await rtl.waitFor(() =>
      view.getByTestId('quick-tools'),
    );
    await rtl.waitFor(
      () => expect(rtl.within(toolsButton).queryByText('N/A')).toBeNull(),
      { timeout: 8000 },
    );
    rtl.fireEvent.press(toolsButton);
    const calculatorRow = await rtl.waitFor(() =>
      view.getByTestId('tool-picker-row-calculator'),
    );
    rtl.fireEvent(
      rtl.within(calculatorRow).UNSAFE_getByType(Switch),
      'valueChange',
      true,
    );
    rtl.fireEvent.press(view.getByTestId('tools-back-button'));
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
    boundary.llama!.scriptCompletions([
      {
        text: '<tool_call>{"name":"calculator","arguments":{"expression":"500*321"}}</tool_call>',
      },
      { text: ANSWER },
    ]);
    rtl.fireEvent.press(view.getByTestId('voice-record-button-audio'));
    await rtl.act(async () => {
      await new Promise(resolve => setTimeout(resolve, 50));
    });
    rtl.fireEvent.press(view.getByTestId('voice-record-button-audio'));

    await rtl.waitFor(
      () => {
        expect(view.getByTestId('tool-result-label-calculator')).toBeTruthy();
        expect(view.getAllByTestId(/^audio-bubble-/)).toHaveLength(2);
        expect(view.getAllByText('Show transcript')).toHaveLength(2);
      },
      { timeout: 8000 },
    );

    rtl.fireEvent.press(view.getByTestId('tool-result-label-calculator'));
    const transcriptToggles = view.getAllByText('Show transcript');
    rtl.fireEvent.press(transcriptToggles[0]);
    rtl.fireEvent.press(transcriptToggles[1]);
    await rtl.waitFor(() => {
      expect(view.getAllByText(TRANSCRIPT).length).toBeGreaterThan(0);
      expect(view.getAllByText(ANSWER).length).toBeGreaterThan(0);
      expect(view.getByText('500*321 = 160500')).toBeTruthy();
      expect(view.queryByTestId('voice-loading')).toBeNull();
    });
    // #91: the spoken turn leaves Voice as a reclaimable sidecar beside Text,
    // visible through the real in-memory management surface.
    rtl.fireEvent.press(view.getByTestId('model-selector'));
    await rtl.waitFor(() => {
      expect(view.getByTestId('models-row-text-ram')).toBeTruthy();
      expect(view.getByTestId('models-row-voice-ram')).toBeTruthy();
      expect(view.getByTestId('models-row-voice-ram')).toHaveTextContent(/GB/);
    });
    view.unmount();
  }, 30000);
});
