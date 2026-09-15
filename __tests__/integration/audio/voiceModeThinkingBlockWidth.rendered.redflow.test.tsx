/**
 * T086 (checklist Area 12) — voice mode keeps completed reasoning in the turn's single Work parent.
 *
 * The rendered journey verifies one completed Work control, the hidden-by-default reasoning, and the
 * final voice note. It does not inspect component state or style internals.
 */
import { setupChatScreen } from '../../harness/chatHarness';

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: () => {}, goBack: () => {}, setOptions: () => {}, addListener: () => () => {} }),
  useRoute: () => require('../../harness/chatHarness').routeHolder,
  useFocusEffect: () => {}, useIsFocused: () => true,
}));

describe('T086 (rendered) — voice-mode reasoning belongs to one completed Work parent', () => {
  it('opens one Work parent to show reasoning beside the final voice note', async () => {
    const h = await setupChatScreen({ engine: 'litert', platform: 'android', whisper: true, pro: true });
    await h.setupWhisperModel();
    h.render();
    await h.enterVoiceMode();

    // Voice-send a request whose reply THINKS: the litert turn emits reasoning + the answer, so the
    // completed assistant message carries reasoningContent → AudioModeThinkingBlock renders.
    await h.voiceSend('explain briefly why the sky is blue', {
      reasoning: 'The user is asking about Rayleigh scattering. Shorter wavelengths scatter more.',
      content: 'Sunlight scatters off air molecules, and blue scatters most, so the sky looks blue.',
    });

    // Pre-condition: BOTH the thinking block AND the voice-note bubble must actually be on screen (so a
    // false green can't hide behind an absent node). Wait for the reply's audio bubble, then the block.
    const audioBubble = await h.rtl.waitFor(() => {
      const msgs = h.useChatStore.getState().getActiveConversation?.()?.messages ?? [];
      const reply = [...msgs].reverse().find((m: { role: string }) => m.role === 'assistant');
      const node = reply ? h.view!.queryByTestId(`audio-bubble-${(reply as { id: string }).id}`) : null;
      expect(node).not.toBeNull();
      return node!;
    }, { timeout: 8000 });
    await h.rtl.waitFor(() => {
      expect(h.view!.getByTestId('assistant-work-toggle').props.accessibilityLabel).toBe('Work done');
    });
    h.rtl.fireEvent.press(h.view!.getByLabelText('Work done'));
    const thinkingBlock = await h.rtl.waitFor(() => {
      const node = h.view!.queryByTestId('thinking-block');
      expect(node).not.toBeNull();
      return node!;
    }, { timeout: 8000 });
    expect(thinkingBlock).toBeTruthy();
    expect(audioBubble).toBeTruthy();
    expect(h.view!.getAllByLabelText('Work done')).toHaveLength(1);
  });
});
