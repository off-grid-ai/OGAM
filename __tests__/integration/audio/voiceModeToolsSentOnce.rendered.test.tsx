/**
 * In voice mode, a spoken reply to a turn that sent tools shows "Tools sent in request" exactly once.
 * The person enabled a tool, so the request carried it; the reply under it is a plain spoken answer
 * (no tool was called). The row belongs to that turn once, not once in the audio bubble and again in
 * the footer below it.
 *
 * Real ChatScreen with Pro active. The calculator is switched on in the real Tools screen, voice mode
 * is entered through the real quick-settings control, and the turn is a real voice note (record, stop,
 * whisper transcribes, the transcript is sent). Fakes only at the device boundary: the LiteRT engine,
 * whisper.rn, the executorch TTS runtime (jest.setup) and the recorder.
 */
import { setupChatScreen } from '../../harness/chatHarness';

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: () => {}, goBack: () => {}, setOptions: () => {}, addListener: () => () => {} }),
  useRoute: () => require('../../harness/chatHarness').routeHolder,
  useFocusEffect: () => {}, useIsFocused: () => true,
}));

describe('voice mode: tools sent in request', () => {
  it('shows the row once under a plain spoken reply to a turn that sent tools', async () => {
    const h = await setupChatScreen({ engine: 'litert', platform: 'android', whisper: true, pro: true });
    await h.setupWhisperModel();
    h.enableToolViaUI('calculator');
    h.render();
    await h.enterVoiceMode();
    const view = h.view!;

    // Before: no turn yet, so no tools row.
    expect(view.queryAllByText(/Tools sent in request/)).toHaveLength(0);

    await h.voiceSend('say hello to me', { content: 'Hello there, nice to hear you.' });

    // The reply arrives as an audio bubble, and the turn's tools row shows once.
    await h.rtl.waitFor(() => {
      const msgs = h.useChatStore.getState().getActiveConversation?.()?.messages ?? [];
      const reply = [...msgs].reverse().find((m: { role: string }) => m.role === 'assistant') as { id: string; content: string } | undefined;
      expect(reply?.content).toMatch(/Hello there/);
      expect(view.queryByTestId(`audio-bubble-${reply!.id}`)).not.toBeNull();
    }, { timeout: 6000 });
    await h.rtl.waitFor(() => expect(view.queryByTestId('stop-button')).toBeNull(), { timeout: 6000 });
    await h.rtl.waitFor(() => expect(view.queryAllByText(/Tools sent in request/).length).toBeGreaterThan(0));
    await h.rtl.act(async () => { await h.settle(200); });

    expect(view.getAllByText(/Tools sent in request \(\d+\)/)).toHaveLength(1);
    expect(view.getAllByTestId('tools-sent-collapsible')).toHaveLength(1);

    // It is this turn's row: opening it names the calculator the person enabled.
    h.rtl.fireEvent.press(view.getByText(/Tools sent in request/));
    await h.rtl.waitFor(() => expect(view.getByText(/calculator/)).toBeTruthy());
  });
});
