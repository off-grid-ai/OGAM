/**
 * A chat mic supports both paths from the same control: one short tap keeps the
 * recording open, and the next short tap stops it. This mounts the real chat,
 * recorder controller, Whisper service, and composer. Only native device leaves
 * are faked by the shared harness.
 */
import { setupChatScreen } from '../../harness/chatHarness';

// Real navigation: the app's own NavigationContainer and routes (chatHarness navigation: 'real').
jest.unmock('@react-navigation/native');

describe('chat mic tap-to-record', () => {
  it('keeps recording after one tap and stops on the next tap', async () => {
    const h = await setupChatScreen({ navigation: 'real',
      engine: 'llama',
      platform: 'android',
      whisper: true,
    });
    await h.setupWhisperModel('tiny.en');
    h.render();

    await h.tapMicOnce();
    await h.rtl.waitFor(() => {
      expect(h.boundary.whisper!.realtimeActive()).toBe(true);
      expect(h.view!.getByText('Tap mic to stop')).toBeTruthy();
    });

    await h.tapMicOnce();
    await h.rtl.waitFor(
      () => {
        expect(h.boundary.whisper!.realtimeActive()).toBe(false);
        expect(h.view!.queryByText('Tap mic to stop')).toBeNull();
      },
      { timeout: 4000 },
    );

    h.boundary.whisper!.emitRealtime({
      text: 'tap recording works',
      isCapturing: false,
    });
    await h.rtl.waitFor(() => {
      expect(h.view!.getByTestId('chat-input').props.value).toContain(
        'tap recording works',
      );
    });
  }, 30000);
});
