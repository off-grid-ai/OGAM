/**
 * Opening the chat must not ask for the microphone. With the permission never asked (Undetermined),
 * the chat and the voice-mode reply UI show the normal mic and no OS prompt. The prompt appears only
 * when the person taps the mic; once they allow it, recording starts.
 *
 * Mounts the real chat, composer, mic button, recorder, Whisper service and audio session owner.
 * The OS permission is the boundary and is a recording stub here:
 * - Android: PermissionsAndroid.request(RECORD_AUDIO) is the prompt.
 * - iOS: the first activation of a record (playAndRecord) AVAudioSession while the permission is
 *   Undetermined is the prompt.
 * The stub answers as the person tapping "Allow" and records each prompt it shows.
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

type Harness = Awaited<ReturnType<typeof setupChatScreen>>;

/**
 * Install the OS permission prompt as a recording stub over the harness boundary. Each prompt the OS
 * would show is recorded, and the person allows access: the permission becomes Granted.
 */
function installPermissionPromptStub(h: Harness, platform: 'ios' | 'android') {
  const prompts: string[] = [];
  let permission: 'Undetermined' | 'Granted' = 'Undetermined';
  const allow = () => {
    permission = 'Granted';
    h.boundary.setMicPermission('Granted');
  };
  h.boundary.setMicPermission('Undetermined');

  const RN = require('react-native');
  if (platform === 'android') {
    RN.PermissionsAndroid.request = (name: string) => {
      // Android shows the dialog only while the permission is not yet granted; a request after
      // "Allow" returns GRANTED with no dialog.
      if (permission === 'Undetermined') {
        prompts.push(`android:${name}`);
        allow();
      }
      return Promise.resolve(RN.PermissionsAndroid.RESULTS?.GRANTED ?? 'granted');
    };
  } else {
    const { AudioManager } = require('react-native-audio-api');
    let category: string | undefined;
    AudioManager.setAudioSessionOptions = (options: { iosCategory?: string }) => {
      category = options?.iosCategory;
    };
    AudioManager.setAudioSessionActivity = (active: boolean) => {
      // iOS asks for the mic the first time a record session activates while the answer is unknown.
      if (active && category === 'playAndRecord' && permission === 'Undetermined') {
        prompts.push('ios:record-session');
        allow();
      }
      return Promise.resolve(true);
    };
  }
  return { prompts };
}

describe.each(['ios', 'android'] as const)(
  'microphone permission is not asked until the mic is tapped (%s)',
  platform => {
    it('opens the chat with the normal mic and no prompt; one tap prompts, then records', async () => {
      const h = await setupChatScreen({ engine: 'llama', platform, whisper: true });
      await h.setupWhisperModel('tiny.en');
      const stub = installPermissionPromptStub(h, platform);
      h.render();
      const view = h.view!;

      // BEFORE: the chat is open, the mic looks normal, and nothing asked for the microphone.
      await h.rtl.waitFor(() => view.getByTestId('voice-record-button'));
      await h.settle(300);
      expect(view.queryByTestId('voice-record-button-mic-denied')).toBeNull();
      expect(view.queryByText('Microphone Access Is Off')).toBeNull();
      expect(view.queryByText('Tap mic to stop')).toBeNull();
      expect(stub.prompts).toEqual([]);

      // The person taps the mic: now the OS asks, they allow, and recording starts.
      await h.tapMicOnce();
      await h.rtl.waitFor(() => {
        expect(view.getByText('Tap mic to stop')).toBeTruthy();
      });
      expect(stub.prompts).toHaveLength(1);
      expect(view.queryByTestId('voice-record-button-mic-denied')).toBeNull();
    }, 30000);

    it('enters voice mode with the normal mic and no prompt; one tap prompts, then records', async () => {
      const h = await setupChatScreen({ engine: 'llama', platform, whisper: true, pro: true });
      await h.setupWhisperModel('tiny.en');
      const stub = installPermissionPromptStub(h, platform);
      h.render();
      const view = h.view!;

      await h.rtl.waitFor(() => view.getByTestId('voice-record-button'));
      await h.enterVoiceMode();
      await h.settle(300);

      // BEFORE: the voice-mode mic is the normal, idle mic, and nothing asked for the microphone.
      const idleMic = view.getByTestId('voice-record-button-audio');
      expect(idleMic.findAll(n => n.props.name === 'square')).toHaveLength(0);
      expect(view.queryByTestId('voice-record-button-mic-denied')).toBeNull();
      expect(stub.prompts).toEqual([]);

      // The person taps the mic: the OS asks once, they allow, and the mic turns into the stop square.
      h.rtl.fireEvent.press(idleMic);
      await h.rtl.waitFor(() => {
        const mic = view.getByTestId('voice-record-button-audio');
        expect(mic.findAll(n => n.props.name === 'square').length).toBeGreaterThan(0);
      });
      expect(stub.prompts).toHaveLength(1);
      expect(view.queryByTestId('voice-record-button-mic-denied')).toBeNull();
    }, 30000);
  },
);
