/** P1 #51/#52 - first-record microphone permission and denied-permission recovery. */
import {
  openChatWithJourneyModel,
  renderMainApp,
} from '../../harness/appJourney';

const WHISPER_PATH = '/docs/whisper-models/ggml-tiny.en.bin';
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

async function selectWhisperAndOpenChat(
  journey: Awaited<ReturnType<typeof renderMainApp>>,
): Promise<void> {
  const { rtl, view } = journey;
  rtl.fireEvent.press(view.getByTestId('models-tab'));
  await rtl.waitFor(() =>
    expect(view.getByTestId('models-screen')).toBeTruthy(),
  );
  rtl.fireEvent.press(view.getByTestId('transcription-models-tab'));
  const whisper = await rtl.waitFor(() =>
    view.getByTestId('transcription-model-card-0'),
  );
  expect(view.queryByTestId('transcription-model-card-0-download')).toBeNull();
  rtl.fireEvent.press(whisper);

  rtl.fireEvent.press(view.getByTestId('home-tab'));
  await rtl.waitFor(() => expect(view.getByTestId('home-screen')).toBeTruthy());
  await openChatWithJourneyModel(rtl, view);
}

describe('P1 full-App microphone permission journey', () => {
  it('requests permission on the first hold and records after the OS grants it', async () => {
    const journey = await renderMainApp({
      boundary: { llama: true, whisper: true },
      beforeRender: ({ boundary }) => {
        boundary.fs!.seedFile(WHISPER_PATH, 75 * 1024 * 1024);
      },
    });
    const { rtl, view } = journey;
    await selectWhisperAndOpenChat(journey);

    rtl.fireEvent(
      view.getByTestId('voice-record-button'),
      'responderGrant',
      RESPONDER_EVENT,
    );

    await rtl.waitFor(() => {
      expect(view.getByText('Slide to cancel')).toBeTruthy();
    });

    await rtl.act(async () => {
      view.unmount();
      await new Promise(resolve => setTimeout(resolve, 0));
    });
  }, 30000);

  it('explains denial, keeps Chat usable, and records after permission is enabled', async () => {
    const journey = await renderMainApp({
      boundary: { llama: true, whisper: true },
      beforeRender: ({ boundary }) => {
        boundary.fs!.seedFile(WHISPER_PATH, 75 * 1024 * 1024);
        const { PermissionsAndroid } = require('react-native');
        PermissionsAndroid.request.mockResolvedValue(
          PermissionsAndroid.RESULTS.DENIED,
        );
      },
    });
    const { rtl, view } = journey;
    await selectWhisperAndOpenChat(journey);

    const ReactNative = require('react-native');
    const openSettings = jest
      .spyOn(ReactNative.Linking, 'openSettings')
      .mockResolvedValue(undefined);
    rtl.fireEvent(
      view.getByTestId('voice-record-button'),
      'responderGrant',
      RESPONDER_EVENT,
    );

    await rtl.waitFor(() => {
      expect(view.getByText('Microphone Access Needed')).toBeTruthy();
      expect(
        view.getByText('Allow microphone access in Settings, then try again.'),
      ).toBeTruthy();
      expect(view.queryByText('Slide to cancel')).toBeNull();
    });

    rtl.fireEvent.press(view.getByText('Open Settings'));
    rtl.fireEvent.changeText(
      view.getByTestId('chat-input'),
      'Chat still works',
    );
    expect(view.getByTestId('chat-input').props.value).toBe('Chat still works');

    ReactNative.PermissionsAndroid.request.mockResolvedValue(
      ReactNative.PermissionsAndroid.RESULTS.GRANTED,
    );
    rtl.fireEvent.changeText(view.getByTestId('chat-input'), '');
    rtl.fireEvent(
      view.getByTestId('voice-record-button'),
      'responderGrant',
      RESPONDER_EVENT,
    );
    await rtl.waitFor(() => {
      expect(view.getByText('Slide to cancel')).toBeTruthy();
    });

    await rtl.act(async () => {
      view.unmount();
      await new Promise(resolve => setTimeout(resolve, 0));
    });
    openSettings.mockRestore();
  }, 30000);
});
