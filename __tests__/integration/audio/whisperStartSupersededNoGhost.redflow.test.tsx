/** P0 #215 — releasing the mic during a cold Whisper load never creates a ghost recording. */
import {
  openChatWithJourneyModel,
  renderMainApp,
} from '../../harness/appJourney';

const WHISPER_PATH = '/docs/whisper-models/ggml-tiny.en.bin';
const WHISPER_STORAGE_KEY = 'local-llm-whisper-storage';
const TRANSCRIPT = 'the second recording works once';
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

describe('P0 full-app cold Whisper release recovery', () => {
  it('returns to an idle composer without ghost text, then records one clean take', async () => {
    const journey = await renderMainApp({
      boundary: { llama: true, whisper: true },
      beforeRender: async ({ boundary, asyncStorage }) => {
        // This is the durable device state after a completed Whisper download:
        // the model is selected on disk but is not resident after a cold launch.
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

    const input = await rtl.waitFor(() => view.getByTestId('chat-input'));
    expect(input.props.value).toBe('');
    expect(view.queryByTestId('recording-hint')).toBeNull();

    // Keep the uncontrollable native model load open, just as a cold ggml init
    // remains open for seconds on a device. The real PanResponder and app state
    // machine continue running above this boundary.
    boundary.whisper!.holdNextLoad();
    rtl.fireEvent(
      view.getByTestId('voice-record-button'),
      'responderGrant',
      RESPONDER_EVENT,
    );
    await rtl.waitFor(() =>
      expect(view.getByTestId('voice-loading')).toBeTruthy(),
    );

    // Release while the spinner is still visible, then allow the load to finish.
    // The release must supersede the parked start instead of resurrecting it.
    rtl.fireEvent(
      view.getByTestId('voice-record-button'),
      'responderRelease',
      RESPONDER_EVENT,
    );
    await rtl.act(async () => {
      boundary.whisper!.releaseLoad();
    });

    await rtl.waitFor(() => {
      expect(view.queryByTestId('voice-loading')).toBeNull();
      expect(view.getByTestId('voice-record-button')).toBeTruthy();
      expect(view.queryByTestId('recording-hint')).toBeNull();
      expect(view.getByTestId('chat-input').props.value).toBe('');
      expect(view.queryByTestId('user-message')).toBeNull();
    });

    // A late native final event from the cancelled attempt must not leak text.
    await rtl.act(async () => {
      boundary.whisper!.emitRealtime({
        text: 'ghost transcript',
        isCapturing: false,
      });
      await new Promise(resolve => setTimeout(resolve, 0));
    });
    expect(view.getByTestId('chat-input').props.value).toBe('');
    expect(view.queryByText('ghost transcript')).toBeNull();

    // The very next hold is a normal recording. Its one final transcript lands
    // in the composer for review; the cancelled take contributes nothing.
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
        text: TRANSCRIPT,
        isCapturing: true,
      });
    });
    await rtl.waitFor(() => expect(view.getByText(TRANSCRIPT)).toBeTruthy());

    // Stay held beyond the cancelled attempt's normal trailing-capture window.
    // A stale delayed stop from that first release must not terminate this take.
    await rtl.act(async () => {
      await new Promise(resolve => setTimeout(resolve, 2700));
    });
    expect(view.getByTestId('recording-hint')).toBeTruthy();
    expect(boundary.whisper!.realtimeActive()).toBe(true);

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
        text: TRANSCRIPT,
        isCapturing: false,
      });
    });
    await rtl.waitFor(
      () => expect(view.getByTestId('chat-input').props.value).toBe(TRANSCRIPT),
      { timeout: 4000 },
    );
    expect(view.queryByTestId('recording-hint')).toBeNull();
    expect(view.queryByTestId('user-message')).toBeNull();

    view.unmount();
  }, 30000);
});
