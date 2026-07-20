/** P1 #213/#214 — slide-cancel leaves no text and the next hold records exactly once. */
import {
  openChatWithJourneyModel,
  renderMainApp,
} from '../../harness/appJourney';

const WHISPER_PATH = '/docs/whisper-models/ggml-tiny.en.bin';
const WHISPER_STORAGE_KEY = 'local-llm-whisper-storage';
const CANCELLED_TEXT = 'this take must disappear';
const KEPT_TEXT = 'keep only this second take';
const RESPONDER_EVENT = {
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
};
const CANCEL_MOVE_EVENT = {
  ...RESPONDER_EVENT,
  touchHistory: {
    touchBank: [
      {
        touchActive: true,
        startPageX: 0,
        startPageY: 0,
        startTimeStamp: 0,
        currentPageX: -100,
        currentPageY: 0,
        currentTimeStamp: 1,
        previousPageX: 0,
        previousPageY: 0,
        previousTimeStamp: 0,
      },
    ],
    numberActiveTouches: 1,
    indexOfSingleActiveTouch: 0,
    mostRecentTimeStamp: 1,
  },
};

describe('P1 full-App slide-to-cancel dictation journey', () => {
  it('cancels one held take, then keeps exactly one clean transcript from the next hold', async () => {
    const journey = await renderMainApp({
      boundary: { llama: true, whisper: true },
      beforeRender: async ({ boundary, asyncStorage }) => {
        boundary.fs!.seedFile(WHISPER_PATH, 75 * 1024 * 1024);
        await asyncStorage.setItem(
          WHISPER_STORAGE_KEY,
          JSON.stringify({
            state: { downloadedModelId: 'tiny.en' },
            version: 0,
          }),
        );
      },
    });
    const { boundary, rtl, view } = journey;
    await openChatWithJourneyModel(rtl, view);

    const mic = view.getByTestId('voice-record-button');
    rtl.fireEvent(mic, 'responderGrant', RESPONDER_EVENT);
    await rtl.waitFor(() => {
      expect(view.getByTestId('recording-hint')).toBeTruthy();
      expect(view.getAllByText('Slide to cancel')).toHaveLength(1);
    });
    await rtl.act(async () => {
      boundary.whisper!.emitRealtime({
        text: CANCELLED_TEXT,
        isCapturing: true,
      });
    });
    await rtl.waitFor(() =>
      expect(view.getByText(CANCELLED_TEXT)).toBeTruthy(),
    );

    rtl.fireEvent(
      view.getByTestId('voice-record-button'),
      'responderMove',
      CANCEL_MOVE_EVENT,
    );
    rtl.fireEvent(
      view.getByTestId('voice-record-button'),
      'responderRelease',
      RESPONDER_EVENT,
    );
    await rtl.waitFor(
      () => {
        expect(boundary.whisper!.realtimeActive()).toBe(false);
        expect(view.queryByTestId('recording-hint')).toBeNull();
        expect(view.getByTestId('chat-input').props.value).toBe('');
        expect(view.queryByText(CANCELLED_TEXT)).toBeNull();
      },
      { timeout: 4000 },
    );

    // A native final event can race the cancellation. It must not resurrect the take.
    await rtl.act(async () => {
      boundary.whisper!.emitRealtime({
        text: CANCELLED_TEXT,
        isCapturing: false,
      });
      await new Promise(resolve => setTimeout(resolve, 0));
    });
    expect(view.getByTestId('chat-input').props.value).toBe('');

    rtl.fireEvent(
      view.getByTestId('voice-record-button'),
      'responderGrant',
      RESPONDER_EVENT,
    );
    await rtl.waitFor(() =>
      expect(view.getByTestId('recording-hint')).toBeTruthy(),
    );
    await rtl.act(async () => {
      boundary.whisper!.emitRealtime({
        text: KEPT_TEXT,
        isCapturing: true,
      });
    });
    rtl.fireEvent(
      view.getByTestId('voice-record-button'),
      'responderRelease',
      RESPONDER_EVENT,
    );
    await rtl.waitFor(
      () => expect(boundary.whisper!.realtimeActive()).toBe(false),
      { timeout: 4000 },
    );
    await rtl.act(async () => {
      boundary.whisper!.emitRealtime({
        text: KEPT_TEXT,
        isCapturing: false,
      });
    });

    await rtl.waitFor(() => {
      expect(view.getByTestId('chat-input').props.value).toBe(KEPT_TEXT);
      expect(view.queryByText(CANCELLED_TEXT)).toBeNull();
      expect(view.queryByTestId('recording-hint')).toBeNull();
    });
    expect(view.queryByTestId('user-message')).toBeNull();

    view.unmount();
  }, 30000);
});
