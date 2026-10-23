/**
 * A chat recording that ends by itself must hand the mic back.
 *
 * DEVICE GROUND TRUTH (2026-10-22, Android, release tip fd73fdfbb): tap the mic and say nothing. whisper.rn
 * ends the capture at its 30 s cap and sends the final event; the file fallback hears nothing. The voice
 * session stayed in "listening", so the button still said "Tap mic to stop", the next tap started nothing,
 * and the tap after that put the composer on "Transcribing..." for minutes, waiting for a final event from
 * a session that had already ended.
 *
 * Real chat, recording controller, voice session and Whisper service; only whisper.rn is faked.
 */
import { setupChatScreen } from '../../harness/chatHarness';

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: () => {}, goBack: () => {}, setOptions: () => {}, addListener: () => () => {} }),
  useRoute: () => require('../../harness/chatHarness').routeHolder,
  useFocusEffect: () => {},
  useIsFocused: () => true,
}));

describe('a chat recording that ends by itself', () => {
  it('returns the mic to idle, and the next tap records again', async () => {
    const h = await setupChatScreen({ engine: 'llama', platform: 'android', whisper: true });
    await h.setupWhisperModel('tiny.en');
    h.boundary.whisper!.setFileTranscript('');
    h.render();

    await h.tapMicOnce();
    await h.rtl.waitFor(() => {
      expect(h.boundary.whisper!.realtimeActive()).toBe(true);
      expect(h.view!.getByText('Tap mic to stop')).toBeTruthy();
    });

    // Nobody spoke: the native capture reaches its cap and ends without a tap.
    h.boundary.whisper!.emitRealtime({ isCapturing: false, noData: true, recordingTime: 30000 });

    await h.rtl.waitFor(() => {
      expect(h.view!.queryByText('Tap mic to stop')).toBeNull();
      expect(h.view!.queryByText(/Transcribing/)).toBeNull();
    }, { timeout: 4000 });

    await h.tapMicOnce();
    await h.rtl.waitFor(() => {
      expect(h.boundary.whisper!.realtimeActive()).toBe(true);
      expect(h.view!.getByText('Tap mic to stop')).toBeTruthy();
    }, { timeout: 4000 });

    await h.tapMicOnce();
    h.boundary.whisper!.emitRealtime({ text: 'second try works', isCapturing: false });
    await h.rtl.waitFor(() => {
      expect(h.view!.getByTestId('chat-input').props.value).toContain('second try works');
      expect(h.view!.queryByText(/Transcribing/)).toBeNull();
    }, { timeout: 4000 });
  }, 30000);
});
