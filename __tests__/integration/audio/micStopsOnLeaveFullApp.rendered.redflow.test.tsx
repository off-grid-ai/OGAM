/** P1 #57 — leaving Chat must stop an in-flight mic session without committing stale speech. */
import {
  openChatWithJourneyModel,
  renderMainApp,
  sendChatMessage,
} from '../../harness/appJourney';

const WHISPER_PATH = '/docs/whisper-models/ggml-tiny.en.bin';

const responderEvent = {
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

describe('P1 full-app microphone cleanup on navigation', () => {
  it('returns to an idle composer and ignores a late transcript after leaving Chat', async () => {
    const { boundary, rtl, view } = await renderMainApp({
      boundary: { llama: true, whisper: true },
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

    boundary.llama!.scriptCompletion({ text: 'Ready to listen.' });
    sendChatMessage(rtl, view, 'Keep this conversation');
    await rtl.waitFor(() =>
      expect(view.getByText('Ready to listen.')).toBeTruthy(),
    );

    const mic = await rtl.waitFor(() =>
      view.getByTestId('voice-record-button'),
    );
    rtl.fireEvent(mic, 'responderGrant', responderEvent);
    await rtl.waitFor(() =>
      expect(boundary.whisper!.realtimeActive()).toBe(true),
    );
    await rtl.act(async () => {
      boundary.whisper!.emitRealtime({
        text: 'ghost words should disappear',
        isCapturing: true,
      });
    });
    await rtl.waitFor(() => {
      expect(view.getByText('ghost words should disappear')).toBeTruthy();
      expect(view.getByText('Slide to cancel')).toBeTruthy();
    });

    rtl.fireEvent.press(view.getByTestId('chat-back-button'));
    await rtl.waitFor(() =>
      expect(view.getByTestId('home-screen')).toBeTruthy(),
    );
    await rtl.waitFor(() =>
      expect(boundary.whisper!.realtimeActive()).toBe(false),
    );
    await rtl.act(async () => {
      boundary.whisper!.emitRealtime({
        text: 'ghost words should disappear',
        isCapturing: false,
      });
      await new Promise(resolve => setTimeout(resolve, 0));
    });

    rtl.fireEvent.press(view.getByTestId('chats-tab'));
    const conversation = await rtl.waitFor(() =>
      view.getByTestId('conversation-item-0'),
    );
    rtl.fireEvent.press(conversation);
    await rtl.waitFor(() =>
      expect(view.getByTestId('chat-screen')).toBeTruthy(),
    );

    await rtl.waitFor(() => {
      expect(view.getByText('Ready to listen.')).toBeTruthy();
      expect(view.getByTestId('voice-record-button')).toBeTruthy();
      expect(view.getByTestId('chat-input').props.value).toBe('');
      expect(view.queryByText('Slide to cancel')).toBeNull();
      expect(view.queryByText('ghost words should disappear')).toBeNull();
      expect(view.queryByTestId('voice-loading')).toBeNull();
    });
    view.unmount();
  }, 30000);
});
