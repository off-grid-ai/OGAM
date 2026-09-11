/**
 * Chat-mode speech is dictation on every text engine. The real gesture must put
 * the transcript in the composer and must not create an empty user turn.
 */
import {setupChatScreen, usingLiteRT} from '../../harness/chatHarness';

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({
    navigate: () => {},
    goBack: () => {},
    setOptions: () => {},
    addListener: () => () => {},
  }),
  useRoute: () => require('../../harness/chatHarness').routeHolder,
  useFocusEffect: () => {},
  useIsFocused: () => true,
}));

describe('LiteRT chat-mode dictation', () => {
  it('puts the transcript in the composer without leaving an empty user turn', async () => {
    const h = await setupChatScreen(usingLiteRT({
      whisper: true,
      audio: true,
      pro: true,
    }));
    await h.setupWhisperModel('tiny.en');
    h.render();
    h.boundary.whisper!.setFileTranscript('draw a dog');

    await h.tapMic();
    await h.rtl.waitFor(() => {
      expect(h.view!.getByTestId('recording-hint')).toBeTruthy();
    });
    await h.releaseMic();

    await h.rtl.waitFor(() => {
      expect(h.view!.getByTestId('chat-input').props.value ?? '').toContain(
        'draw a dog',
      );
    });
    expect(h.view!.queryAllByTestId('user-message')).toHaveLength(0);
  });
});
