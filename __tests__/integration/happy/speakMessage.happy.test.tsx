/**
 * HAPPY-PATH (UI, BEHAVIORAL) — speak an assistant reply aloud. OGAM spec: with TTS enabled, opening a reply's
 * action menu and tapping "Speak" sends THAT message's text to the audio engine; and you can never "speak"
 * your own (user) message. Tested through BOTH menu-open paths (long-press AND 3-dots).
 *
 * Real ChatScreen + real ChatMessage/ActionMenuSheet + real handleSpeak wiring (buildMessageData →
 * callHook('audio.speak', displayContent, id)). The Pro TTS engine plugs into core through the audio.* hook
 * seam — faked AT that seam (a capturing handler), the same way MCP plugs in via registerToolExtension in
 * tools.happy. This guards core's contract: the Speak gesture dispatches the right message's content, and the
 * affordance obeys the canSpeak gate. (The engine's synthesis/playback itself is covered by the pro/audio
 * suites.)
 */
import { setupChatScreen } from '../../harness/chatHarness';

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: () => {}, goBack: () => {}, setOptions: () => {}, addListener: () => () => {} }),
  useRoute: () => require('../../harness/chatHarness').routeHolder,
  useFocusEffect: () => {},
  useIsFocused: () => true,
}));

// Register the audio.* hook seam the way the Pro audio module does — AFTER the harness's resetModules, so the
// app and the test share the same hook registry instance. canSpeak=true enables the affordance; speak captures.
function installTtsSeam(): { spoken: Array<{ text: string; id: string }> } {
  const spoken: Array<{ text: string; id: string }> = [];
  /* eslint-disable @typescript-eslint/no-var-requires */
  const { registerHook, HOOKS } = require('../../../src/bootstrap/hookRegistry');
  /* eslint-enable @typescript-eslint/no-var-requires */
  registerHook(HOOKS.audioCanSpeak, () => true);
  registerHook(HOOKS.audioSpeak, (text: string, id: string) => { spoken.push({ text, id }); });
  return { spoken };
}

describe.each(['longpress', 'dots'] as const)('happy — speak an assistant reply (via %s)', (via) => {
  it('dispatches the reply text to the audio engine when Speak is tapped', async () => {
    const h = await setupChatScreen({ engine: 'litert' });
    const seam = installTtsSeam();
    h.render();
    await h.send('capital of France?', { content: 'The capital of France is Paris.' });
    await h.rtl.waitFor(() => { expect(h.view!.queryByText(/The capital of France is Paris\./)).not.toBeNull(); });

    // Open the reply's action menu and tap Speak.
    await h.openActionMenu('assistant', via);
    h.rtl.fireEvent.press(await h.rtl.waitFor(() => h.view!.getByTestId('action-speak')));

    // The engine was asked to speak THIS reply's text (with its message id).
    await h.rtl.waitFor(() => { expect(seam.spoken.length).toBe(1); });
    expect(seam.spoken[0].text).toContain('The capital of France is Paris.');
    expect(seam.spoken[0].id).toBeTruthy();
  });

  it('offers no Speak affordance on the user\'s own message', async () => {
    const h = await setupChatScreen({ engine: 'litert' });
    installTtsSeam();
    h.render();
    await h.send('hello there', { content: 'Hi!' });
    await h.rtl.waitFor(() => { expect(h.view!.queryByText(/Hi!/)).not.toBeNull(); });

    // Open the USER message's action menu — Speak must not be offered (you don't speak your own input).
    await h.openActionMenu('user', via);
    // The menu is open (Copy is present) but Speak is not.
    await h.rtl.waitFor(() => { expect(h.view!.queryByTestId('action-copy')).not.toBeNull(); });
    expect(h.view!.queryByTestId('action-speak')).toBeNull();
  });
});
