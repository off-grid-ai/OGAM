/** P1 #89 — Text and Whisper remain visibly resident through typed and dictated turns. */
import {
  openChatWithJourneyModel,
  renderMainApp,
  sendChatMessage,
} from '../../harness/appJourney';
import { GB } from '../../harness/nativeBoundary';

const WHISPER_PATH = '/docs/whisper-models/ggml-tiny.en.bin';
const DICTATION = 'What is the capital of France?';

const holdGesture = () => ({
  nativeEvent: {
    touches: [],
    changedTouches: [],
    identifier: 1,
    pageX: 0,
    pageY: 0,
    timestamp: 0,
  },
  touchHistory: {
    touchBank: [],
    numberActiveTouches: 0,
    indexOfSingleActiveTouch: -1,
    mostRecentTimeStamp: 0,
  },
});

describe('P1 full-app Text and Whisper co-residency', () => {
  it('keeps both RAM indicators through typed and dictated text turns', async () => {
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

    boundary.llama!.scriptCompletion({ text: 'The text model is ready.' });
    sendChatMessage(rtl, view, 'Warm up the text model');
    await rtl.waitFor(
      () => expect(view.getByText('The text model is ready.')).toBeTruthy(),
      { timeout: 8000 },
    );

    rtl.fireEvent.press(view.getByTestId('model-selector'));
    await rtl.waitFor(() => {
      expect(view.getByTestId('models-row-text-ram')).toBeTruthy();
      expect(view.getByTestId('models-row-speech-ram')).toBeTruthy();
      expect(view.getByTestId('models-row-text')).toHaveTextContent(
        /Journey Model/,
      );
      expect(view.getByTestId('models-row-speech')).toHaveTextContent(/Tiny/);
      expect(
        rtl.within(view.getByTestId('models-row-text-ram')).getByText(/GB/),
      ).toBeTruthy();
      expect(
        rtl.within(view.getByTestId('models-row-speech-ram')).getByText(/GB/),
      ).toBeTruthy();
    });
    rtl.fireEvent.press(view.getByText('Done'));
    await rtl.waitFor(() =>
      expect(view.queryByTestId('models-row-text')).toBeNull(),
    );

    const mic = await rtl.waitFor(() =>
      view.getByTestId('voice-record-button'),
    );
    rtl.fireEvent(mic, 'responderGrant', holdGesture());
    await rtl.waitFor(() =>
      expect(boundary.whisper!.realtimeActive()).toBe(true),
    );
    rtl.fireEvent(
      await rtl.waitFor(() => view.getByTestId('voice-record-button')),
      'responderRelease',
      holdGesture(),
    );
    await rtl.waitFor(
      () => expect(boundary.whisper!.realtimeActive()).toBe(false),
      { timeout: 5000 },
    );
    await rtl.act(async () => {
      boundary.whisper!.emitRealtime({ text: DICTATION, isCapturing: false });
      await new Promise(resolve => setTimeout(resolve, 800));
    });
    await rtl.waitFor(
      () => expect(view.getByTestId('chat-input').props.value).toBe(DICTATION),
      { timeout: 8000 },
    );

    boundary.llama!.scriptCompletion({
      text: 'Paris is the capital of France.',
    });
    rtl.fireEvent.press(view.getByTestId('send-button'));
    await rtl.waitFor(
      () => {
        expect(view.getByText(DICTATION)).toBeTruthy();
        expect(view.getByText('Paris is the capital of France.')).toBeTruthy();
        expect(view.getByTestId('chat-input').props.value).toBe('');
      },
      { timeout: 8000 },
    );

    rtl.fireEvent.press(view.getByTestId('model-selector'));
    await rtl.waitFor(() => {
      expect(view.getByTestId('models-row-text-ram')).toBeTruthy();
      expect(view.getByTestId('models-row-speech-ram')).toBeTruthy();
    });
    rtl.fireEvent.press(view.getByText('Done'));
    await rtl.waitFor(() =>
      expect(view.queryByTestId('models-row-text')).toBeNull(),
    );
    await rtl.act(async () => {
      await new Promise(resolve => setTimeout(resolve, 50));
    });
    view.unmount();
  }, 30000);
});
