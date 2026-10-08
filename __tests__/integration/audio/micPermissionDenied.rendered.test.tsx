/**
 * The chat mic must not look usable when the microphone permission is denied. It shows the
 * unavailable mic, explains why on tap, opens Settings, and becomes a normal mic again when the
 * person allows access and comes back. Mounts the real chat, composer, mic button and Whisper
 * service; only the OS permission, Settings hand-off and AppState are faked, at the native leaf.
 */
import { setupChatScreen } from '../../harness/chatHarness';

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

describe.each(['ios', 'android'] as const)('chat mic with the microphone denied (%s)', platform => {
  it('shows the mic as unavailable, opens Settings, and recovers once access is allowed', async () => {
    const h = await setupChatScreen({ engine: 'llama', platform, whisper: true });
    await h.setupWhisperModel('tiny.en');
    h.boundary.setMicPermission('Denied');
    h.render();
    const view = h.view!;

    const deniedMic = await h.rtl.waitFor(() =>
      view.getByTestId('voice-record-button-mic-denied'),
    );
    expect(view.queryByTestId('voice-record-button')).toBeNull();

    h.rtl.fireEvent.press(deniedMic);
    await h.rtl.waitFor(() => {
      expect(view.getByText('Microphone Access Is Off')).toBeTruthy();
    });
    h.rtl.fireEvent.press(view.getByText('Open Settings'));
    expect(h.boundary.settingsOpenedCount()).toBe(1);

    // The person allows the mic in Settings. Nothing changes until they come back to the app.
    h.boundary.setMicPermission('Granted');
    await h.rtl.act(async () => {
      h.boundary.emitAppStateChange('background');
    });
    expect(view.getByTestId('voice-record-button-mic-denied')).toBeTruthy();
    await h.rtl.act(async () => {
      h.boundary.emitAppStateChange('active');
    });
    await h.rtl.waitFor(() => {
      expect(view.getByTestId('voice-record-button')).toBeTruthy();
      expect(view.queryByTestId('voice-record-button-mic-denied')).toBeNull();
    });
  }, 30000);
});

describe('chat mic after an Android "Don\'t ask again" denial', () => {
  it('turns into the unavailable mic as soon as the request is refused', async () => {
    // Android reads a permanent denial back as Undetermined, so the mic starts out normal.
    const h = await setupChatScreen({ engine: 'llama', platform: 'android', whisper: true });
    await h.setupWhisperModel('tiny.en');
    h.boundary.setMicPermission('Undetermined');
    h.render();
    const view = h.view!;
    await h.rtl.waitFor(() => view.getByTestId('voice-record-button'));

    await h.tapMicOnce();

    await h.rtl.waitFor(() => {
      expect(view.getByTestId('voice-record-button-mic-denied')).toBeTruthy();
    });
    expect(h.boundary.whisper!.realtimeActive()).toBe(false);
  }, 30000);
});

describe('chat mic when the permission cannot be read', () => {
  it('stays a normal mic rather than claiming access is off', async () => {
    const h = await setupChatScreen({ engine: 'llama', platform: 'ios', whisper: true });
    await h.setupWhisperModel('tiny.en');
    h.boundary.setMicPermission('Unreadable');
    h.render();
    const view = h.view!;

    await h.rtl.waitFor(() => view.getByTestId('voice-record-button'));
    expect(view.queryByTestId('voice-record-button-mic-denied')).toBeNull();
  }, 30000);
});
