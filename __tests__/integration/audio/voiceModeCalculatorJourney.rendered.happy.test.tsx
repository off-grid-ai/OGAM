/**
 * T085 (checklist Area 12) — full voice-mode journey: record a calculator request → STT transcript → routes
 * to TEXT → the calculator tool runs → the answer renders (and is spoken). Device WORKS (commentary:221 —
 * "recorded a message in voice mode ... run calculations for 500*325").
 *
 * Real user behavior: enter voice mode (real gesture), enable the calculator on the real Tools screen, record
 * a voice note and release to send (real transcribeFile → onTranscript → send). The litert turn calls the
 * calculator, then answers. Assert the user sees the tool-result bubble AND the reply (an audio bubble,
 * spoken via TTS in voice mode).
 *
 * Falsify: drop the tool_call from the scripted turn → no tool-result bubble → red.
 */
import { setupChatScreen } from '../../harness/chatHarness';

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: () => {}, goBack: () => {}, setOptions: () => {}, addListener: () => () => {} }),
  useRoute: () => require('../../harness/chatHarness').routeHolder,
  useFocusEffect: () => {}, useIsFocused: () => true,
}));

describe('T085 (rendered) — voice-mode calculator journey (STT → tool → answer)', () => {
  it('records a calculator request, runs the tool, and renders the tool bubble + reply', async () => {
    const h = await setupChatScreen({ engine: 'litert', platform: 'android', whisper: true, pro: true });
    await h.setupWhisperModel();
    h.enableToolViaUI('calculator'); // real Tools-screen switch (before render, like the other tool tests)
    h.render();
    await h.enterVoiceMode();

    // The voice turn: transcript + the litert turn (a calculator tool_call, then the answer), scripted through
    // voiceSend so it lands right before the send.
    await h.voiceSend('use the calculator for 500 times 321', {
      toolCalls: [{ name: 'calculator', arguments: { expression: '500*321' } }],
      content: 'That is 160500.',
    });

    // The calculator ran (its result bubble renders)...
    await h.rtl.waitFor(() => { expect(h.view!.queryByTestId('tool-result-label-calculator')).not.toBeNull(); }, { timeout: 6000 });
    // ...and the reply reaches the user as an audio bubble (voice mode speaks it), carrying the answer.
    await h.rtl.waitFor(() => {
      const msgs = h.useChatStore.getState().getActiveConversation?.()?.messages ?? [];
      // The LAST assistant message is the final answer (a tool turn also has an earlier tool-call assistant msg).
      const reply = [...msgs].reverse().find((m: { role: string }) => m.role === 'assistant');
      expect(reply?.content).toMatch(/160500/);
      expect(h.view!.queryByTestId(`audio-bubble-${(reply as { id: string }).id}`)).not.toBeNull();
    }, { timeout: 6000 });
  });
});
