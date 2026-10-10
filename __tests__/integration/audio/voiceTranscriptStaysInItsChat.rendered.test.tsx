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
    expect(h.view!.queryAllByText(/book the meeting room for friday/)).toHaveLength(0);
    expect(h.useChatStore.getState().conversations).toHaveLength(chatsBefore);
    expect(turnsSent()).toBe(turnsBefore);
  });
});
