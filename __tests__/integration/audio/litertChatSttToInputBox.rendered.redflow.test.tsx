/**
 * DEVICE 2026-07-14 (rendered UI) — chat-mode STT must be identical on every engine: transcribe and drop the
 * text into the INPUT BOX for review/edit/send. A direct-audio (LiteRT) model diverged — chat-mode hold-to-talk
 * dispatched a voice-note ATTACHMENT instead of filling the composer (unlike a non-audio llama model). This
 * mounts the REAL ChatScreen, records via the REAL hold-to-talk gesture on an audio-capable LiteRT model, and
 * asserts the transcript lands in the composer — not sent as a message.
 *
 * FULL ChatScreen mount, REAL useVoiceInput + audioRecorderService + whisperService + stores; only device
 * leaves faked (recorder/whisper/fs). engine 'litert' + audio:true → supportsDirectAudio() true → chat-mode
 * takes the direct-audio branch (Voice.ts), which now transcribes the file and calls onTranscript → the
 * composer, exactly like llama's hold-to-talk.
 *
 * RED before the fix: the direct-audio branch called onAudioAttachment (a dispatched voice note) → the input
 * stayed EMPTY and a message was sent. GREEN: the transcript is in the input, nothing sent.
 */
import { setupChatScreen } from '../../harness/chatHarness';

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: () => {}, goBack: () => {}, setOptions: () => {}, addListener: () => () => {} }),
  useRoute: () => require('../../harness/chatHarness').routeHolder,
  useFocusEffect: () => {}, useIsFocused: () => true,
}));

describe('LiteRT chat-mode STT lands in the input box (like llama), not a voice note — device 2026-07-14', () => {
  it('recording a voice note in chat mode puts the transcript in the composer and sends nothing', async () => {
    const h = await setupChatScreen({ engine: 'litert', platform: 'android', whisper: true, audio: true });
    await h.setupWhisperModel('tiny.en'); // downloaded + selected + resident via the real select gesture
    h.render();
    const view = h.view!;

    // The recording transcribes to this text (the file-transcribe path the direct-audio branch uses).
    h.boundary.whisper!.setFileTranscript('draw a dog');

    // Precondition (anti-false-green): the composer is empty and no assistant turn exists.
    const inputBefore = await h.rtl.waitFor(() => view.getByTestId('chat-input'));
    expect(inputBefore.props.value ?? '').toBe('');

    // REAL hold-to-talk: grant (start direct recording) → release (stop → transcribe the file).
    await h.tapMic();
    await h.rtl.waitFor(() => { expect(view.getByTestId('voice-record-button')).toBeTruthy(); });
    await h.releaseMic();
    await h.settle(400);

    // THE FIX — the transcript is in the INPUT BOX (dictation), same as llama.
    // RED before: the direct-audio branch dispatched a voice-note attachment → input stayed empty.
    await h.rtl.waitFor(() => { expect(view.getByTestId('chat-input').props.value ?? '').toContain('draw a dog'); }, { timeout: 4000 });

    // And nothing was sent: no assistant/user message bubble carries the transcript as a dispatched turn
    // (the message stays a draft in the composer for the user to send).
    expect(view.queryByTestId('stop-button')).toBeNull();
  });
});
