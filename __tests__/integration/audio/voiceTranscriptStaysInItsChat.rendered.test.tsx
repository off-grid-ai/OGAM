/**
 * A voice note recorded in one chat must never land in another. In voice mode the recording is
 * transcribed after the mic stops, which takes seconds on device. If the person opens a different
 * chat while that runs, the transcript belongs to the chat it was spoken in: nothing may be sent
 * or attached in the chat that happens to be open when it finishes.
 *
 * Real ChatScreen in voice mode on the real record button, real chat switch on the same mounted
 * screen (new route params, as navigating from the chat list does). Fakes only at the device
 * boundary: whisper.rn (its file transcription held open), the LiteRT engine and the recorder.
 */
import { setupChatScreen } from '../../harness/chatHarness';

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: () => {}, goBack: () => {}, setOptions: () => {}, addListener: () => () => {} }),
  useRoute: () => require('../../harness/chatHarness').routeHolder,
  useFocusEffect: () => {}, useIsFocused: () => true,
}));

type Harness = Awaited<ReturnType<typeof setupChatScreen>>;

/**
 * What the person can read of the voice turns on screen. A voice note renders as an audio bubble whose
 * words show only after tapping its "Show transcript" toggle, so open every toggle, then read.
 */
async function openTranscripts(h: Harness): Promise<void> {
  for (const toggle of h.view!.queryAllByText('Show transcript')) {
    h.rtl.fireEvent.press(toggle);
  }
  await h.rtl.waitFor(() => { expect(h.view!.queryAllByText('Show transcript')).toHaveLength(0); });
}

const audioBubbles = (h: Harness) => h.view!.queryAllByTestId(/^audio-bubble-/);

describe('a voice transcript stays in the chat it was spoken in', () => {
  it('sends nothing into the chat opened while the recording was being transcribed', async () => {
    const h = await setupChatScreen({ engine: 'litert', platform: 'android', whisper: true, pro: true });
    await h.setupWhisperModel();
    h.render();

    // Chat A exists because the person wrote in it; they have it open from the chat list.
    await h.send('hello from the first chat', { content: 'First chat reply.' });
    await h.rtl.waitFor(() => { expect(h.view!.queryAllByText(/First chat reply\./).length).toBeGreaterThan(0); });
    const chatA = h.conversationId!;
    await h.openConversation(chatA);
    await h.enterVoiceMode();
    const chatsBefore = h.useChatStore.getState().conversations.length;
    const turnsSent = () => {
      const calls = h.boundary.litert.calls;
      return calls.sendMessage.length + calls.sendMessageWithMedia.length + calls.sendMessageWithImages.length;
    };
    const turnsBefore = turnsSent();

    // The person records a note in A. Its transcription is still running when they open a new chat.
    h.boundary.whisper!.holdNextTranscription();
    await h.voiceSend('book the meeting room for friday');
    await h.rtl.waitFor(() => { expect(h.view!.getByTestId('voice-record-button-audio')).toBeTruthy(); });
    await h.openConversation();
    expect(h.view!.queryAllByText(/First chat reply\./)).toHaveLength(0);

    // The transcription finishes while the new chat is open.
    await h.rtl.act(async () => { h.boundary.whisper!.releaseTranscription(); });
    await h.rtl.act(async () => { await h.settle(300); });

    // Nothing from A was sent or attached here: no message, no new chat, no turn for the engine.
    // (A voice note would render as an audio bubble, so look for one, not only for its words.)
    expect(audioBubbles(h)).toHaveLength(0);
    expect(h.view!.queryAllByTestId('user-message')).toHaveLength(0);
    expect(h.view!.queryAllByText(/book the meeting room for friday/)).toHaveLength(0);
    expect(h.useChatStore.getState().conversations).toHaveLength(chatsBefore);
    expect(turnsSent()).toBe(turnsBefore);
  });
  it('sends the note in the chat it was spoken in when that chat is still open', async () => {
    const h = await setupChatScreen({ engine: 'litert', platform: 'android', whisper: true, pro: true });
    await h.setupWhisperModel();
    h.render();

    await h.send('hello from the first chat', { content: 'First chat reply.' });
    await h.rtl.waitFor(() => { expect(h.view!.queryAllByText(/First chat reply\./).length).toBeGreaterThan(0); });
    const chatA = h.conversationId!;
    await h.openConversation(chatA);
    await h.enterVoiceMode();

    // The person records a note in A and stays there while it is transcribed.
    h.boundary.whisper!.holdNextTranscription();
    await h.voiceSend('book the meeting room for friday', { content: 'Booked for Friday.' });
    await h.rtl.waitFor(() => { expect(h.view!.getByTestId('voice-record-button-audio')).toBeTruthy(); });

    // Before: still transcribing, so nothing from the note is in A yet.
    const bubblesBefore = audioBubbles(h).length;
    await openTranscripts(h);
    expect(h.view!.queryAllByText(/book the meeting room for friday/)).toHaveLength(0);

    await h.rtl.act(async () => { h.boundary.whisper!.releaseTranscription(); });

    // The note is sent in A and answered there: two new voice bubbles, the note's reading its words.
    await h.rtl.waitFor(() => { expect(audioBubbles(h).length).toBe(bubblesBefore + 2); }, { timeout: 6000 });
    await openTranscripts(h);
    expect(h.view!.getByText(/book the meeting room for friday/)).toBeTruthy();
    expect(h.view!.getByText(/Booked for Friday\./)).toBeTruthy();
    expect(h.conversationId).toBe(chatA);
  });

  it('sends the note in its own chat when the person returns to it before transcription finishes', async () => {
    const h = await setupChatScreen({ engine: 'litert', platform: 'android', whisper: true, pro: true });
    await h.setupWhisperModel();
    h.render();

    await h.send('hello from the first chat', { content: 'First chat reply.' });
    await h.rtl.waitFor(() => { expect(h.view!.queryAllByText(/First chat reply\./).length).toBeGreaterThan(0); });
    const chatA = h.conversationId!;
    await h.openConversation(chatA);
    await h.enterVoiceMode();
    const chatsBefore = h.useChatStore.getState().conversations.length;

    // The person records a note in A, glances at a new chat while it is transcribed, and comes back.
    h.boundary.whisper!.holdNextTranscription();
    await h.voiceSend('book the meeting room for friday', { content: 'Booked for Friday.' });
    await h.rtl.waitFor(() => { expect(h.view!.getByTestId('voice-record-button-audio')).toBeTruthy(); });
    await h.openConversation();
    expect(h.view!.queryAllByText(/First chat reply\./)).toHaveLength(0);
    await h.openConversation(chatA);
    await h.rtl.waitFor(() => { expect(h.view!.getByText(/First chat reply\./)).toBeTruthy(); });
    const bubblesBefore = audioBubbles(h).length;
    await openTranscripts(h);
    expect(h.view!.queryAllByText(/book the meeting room for friday/)).toHaveLength(0);

    await h.rtl.act(async () => { h.boundary.whisper!.releaseTranscription(); });

    // The note lands in A, the chat it was spoken in; no other chat was created for it.
    await h.rtl.waitFor(() => { expect(audioBubbles(h).length).toBe(bubblesBefore + 2); }, { timeout: 6000 });
    await openTranscripts(h);
    expect(h.view!.getByText(/book the meeting room for friday/)).toBeTruthy();
    expect(h.view!.getByText(/Booked for Friday\./)).toBeTruthy();
    expect(h.conversationId).toBe(chatA);
    expect(h.useChatStore.getState().conversations).toHaveLength(chatsBefore);
  });
  // Chat mode: hold-to-talk dictates into the composer instead of sending. On an audio-capable LiteRT
  // model the hold records a file that whisper transcribes after release (the direct-audio path).
  describe('chat-mode hold-to-talk', () => {
    async function chatModeInChatA() {
      const h = await setupChatScreen({ engine: 'litert', platform: 'android', whisper: true, audio: true });
      await h.setupWhisperModel('tiny.en');
      h.render();
      await h.send('hello from the first chat', { content: 'First chat reply.' });
      await h.rtl.waitFor(() => { expect(h.view!.queryAllByText(/First chat reply\./).length).toBeGreaterThan(0); });
      const chatA = h.conversationId!;
      await h.openConversation(chatA);
      return { h, chatA };
    }
    /** The composer's text; while the mic is busy (recording, transcribing) the input is not shown. */
    const composer = (h: Harness): string | null => {
      const input = h.view!.queryByTestId('chat-input');
      return input ? ((input.props.value ?? '') as string) : null;
    };

    it('puts the dictation in the composer of the chat it was spoken in', async () => {
      const { h, chatA } = await chatModeInChatA();
      h.boundary.whisper!.setFileTranscript('book the meeting room for friday');
      h.boundary.whisper!.holdNextTranscription();
      const userMessagesBefore = h.view!.queryAllByTestId('user-message').length;

      await h.tapMic();
      await h.releaseMic();
      await h.settle(100);

      // Before: still transcribing, nothing has reached the composer.
      expect(composer(h) ?? '').not.toContain('book the meeting room');

      await h.rtl.act(async () => { h.boundary.whisper!.releaseTranscription(); });

      // The words land in A's composer as a draft; nothing is sent.
      await h.rtl.waitFor(() => { expect(composer(h)).toContain('book the meeting room for friday'); }, { timeout: 4000 });
      expect(h.conversationId).toBe(chatA);
      expect(h.view!.queryAllByTestId('user-message')).toHaveLength(userMessagesBefore);
    });

    it('does not put the dictation in the chat opened while it was being transcribed', async () => {
      const { h } = await chatModeInChatA();
      h.boundary.whisper!.setFileTranscript('book the meeting room for friday');
      h.boundary.whisper!.holdNextTranscription();

      // The person dictates in A, releases, and opens a new chat while whisper is still working.
      await h.tapMic();
      await h.releaseMic();
      await h.settle(100);
      await h.openConversation();
      expect(h.view!.queryAllByText(/First chat reply\./)).toHaveLength(0);
      expect(composer(h) ?? '').not.toContain('book the meeting room');

      await h.rtl.act(async () => { h.boundary.whisper!.releaseTranscription(); });
      await h.rtl.act(async () => { await h.settle(300); });

      // B's composer stays empty and nothing was sent here.
      await h.rtl.waitFor(() => { expect(composer(h)).toBe(''); });
      expect(h.view!.queryAllByTestId('user-message')).toHaveLength(0);
    });
  });
});
