/**
 * T034 / DEV-B15 (RED) — a completion that hits the max-predict cap (stopped_eos=false at n_predict) must
 * show a "cut off / continue" indication, not truncate silently mid-sentence.
 *
 * Device (B15): a turn hit predicted=1024, stopped_eos=false → the reply was cut off mid-sentence with NO
 * indication; raising max-tokens let it finish (stopped_eos=true). Confirmed wholly-missing in code: llm.ts
 * generateResponse (line 324-332) reads the completion result only for `context_full`; stopped_eos /
 * stopped_limit / truncated are IGNORED, the Message type has no truncation field, and ChatMessage renders
 * no cutoff/continue affordance (grep: zero hits). So a truncated turn is indistinguishable from a finished
 * one to the user.
 *
 * Real gestures: mount ChatScreen (llama — the engine B15 used), send a normal turn (precondition: no cutoff
 * indicator), then send a turn whose completion is TRUNCATED. The truncation is device-shaped, EMERGENT from
 * the boundary: the llama fake's completionMeta emits stopped_eos=false / stopped_limit=1 / tokens_predicted
 * at the cap — exactly what llama.rn returns at n_predict — so the fix (read stopped_eos → render a cutoff
 * affordance) greens it while a normal turn stays clean (falsifiable both ways). No hand-asserted cutoff.
 *
 * RED on HEAD: the cutoff indicator is absent after the truncated turn (silent truncation). FIX-mode target:
 * surface stopped_eos on the message and render a `message-cutoff-indicator` (a "cut off — continue" control)
 * in the assistant bubble.
 */
import { setupChatScreen } from '../../harness/chatHarness';

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: () => {}, goBack: () => {}, setOptions: () => {}, addListener: () => () => {} }),
  useRoute: () => require('../../harness/chatHarness').routeHolder,
  useFocusEffect: () => {}, useIsFocused: () => true,
}));

describe('T034 (rendered) — max-predict cutoff must not be silent (DEV-B15)', () => {
  it('shows a cut-off/continue indication when a completion hits the n_predict cap without EOS', async () => {
    const h = await setupChatScreen({ engine: 'llama', platform: 'android' });
    h.render();

    // A normal (EOS-stopped) turn renders no cutoff indicator — the precondition that makes the assertion
    // below a real transition (the indicator must appear ONLY for a truncated turn, never always-on).
    await h.send('say hi', { text: 'Hi there, all done.' });
    await h.rtl.waitFor(() => { expect(h.view!.queryByText(/Hi there, all done\./)).not.toBeNull(); });
    expect(h.view!.queryByTestId('message-cutoff-indicator')).toBeNull();

    // A TRUNCATED turn: the completion hit the n_predict cap (stopped_eos=false, stopped_limit=1) and was cut
    // off mid-sentence — the exact B15 device shape, emitted at the boundary.
    await h.send('write a long story', {
      text: 'Once upon a time there was a small village by the sea and',
      completionMeta: { stopped_eos: false, stopped_limit: 1, tokens_predicted: 1024 },
    });
    await h.rtl.waitFor(() => { expect(h.view!.queryByText(/small village by the sea and/)).not.toBeNull(); });

    // SPEC: the user must see that the reply was cut off (a continue/cut-off affordance). RED on HEAD: the app
    // ignores stopped_eos and renders no such surface — the truncation is silent (B15).
    await h.rtl.waitFor(() => { expect(h.view!.queryByTestId('message-cutoff-indicator')).not.toBeNull(); }, { timeout: 3000 });
  });
});
