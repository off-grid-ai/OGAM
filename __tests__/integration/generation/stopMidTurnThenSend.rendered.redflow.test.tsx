/**
 * DEVICE 2026-07-13 (offgrid-debug.log 18:12–18:16 + IMG_0144/45/48) — stopping a response and then
 * sending again must WORK. On device it wedged the whole chat:
 *
 *   user stops a tool-turn mid-completion → llama can only honor the stop once prefill finishes →
 *   the interrupted (empty) result came back to the tool loop, which mistook it for a normal empty
 *   reply and fired its "retry once without tools" fallback — a FULL generation the user never asked
 *   for (74s CPU prefill). That zombie held the engine, so EVERY next send/resend failed with
 *   "LLM service busy" (rendered as a chat bubble, IMG_0148), and the zombie's empty output painted
 *   the wrong "No response / incompatible backend" card (IMG_0145).
 *
 * SPEC (the user's view): after tapping STOP, the turn is OVER. No answer appears for a stopped turn,
 * no error card, and the very next send streams a normal reply — never "LLM service busy".
 *
 * Journey (all real gestures on the real mounted ChatScreen + real generationService/tool loop/llm
 * service; fake ONLY the llama.rn native boundary): enable a tool via the UI (the turn must run the
 * TOOL loop — the zombie's home) → send → the native completion is IN FLIGHT with zero tokens
 * (holdBeforeStream = prefill in progress; a stop cannot land mid-prefill) → observe the STOP control
 * present (anti-false-green: the generating state really rendered) → press STOP (stopCompletion
 * resolves the completion `interrupted:true`, the device wire shape) → assert the turn ends quietly →
 * send again → the reply renders.
 *
 * RED on HEAD (pre-fix): the stopped turn's fallback re-generation renders an answer the user stopped
 * ("ZOMBIE…" text appears) or holds the engine so send #2 renders "LLM service busy" instead of the
 * reply. GREEN with the fix: no zombie output, no busy text, second reply renders.
 */
import { setupChatScreen } from '../../harness/chatHarness';

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: () => {}, goBack: () => {}, setOptions: () => {}, addListener: () => () => {} }),
  useRoute: () => require('../../harness/chatHarness').routeHolder,
  useFocusEffect: () => {}, useIsFocused: () => true,
}));

const ZOMBIE_TEXT = 'ZOMBIE answer that must never render after a stop';

describe('stop mid tool-turn, then send again (rendered) — device 2026-07-13 busy-wedge', () => {
  it('after STOP the turn ends quietly and the next send streams a reply — never "LLM service busy"', async () => {
    const h = await setupChatScreen({ engine: 'llama', platform: 'android' });
    h.enableToolViaUI('calculator'); // real toggle → the turn runs the REAL tool loop
    h.render();
    const { rtl } = h;
    const view = h.view!;

    // ---- Turn 1: send while the native completion holds in PREFILL (zero tokens streamed). ----
    await h.send('what is 2 + 2?', { text: ZOMBIE_TEXT, holdBeforeStream: true } as never);

    // Anti-false-green precondition: the generating STOP control is genuinely on screen.
    await rtl.waitFor(() => { expect(view.queryByTestId('stop-button')).not.toBeNull(); }, { timeout: 4000 });

    // Real gesture: the user taps STOP. The native fake resolves the completion interrupted:true
    // with nothing streamed — exactly what the device returned after its 9s prefill unwind.
    await rtl.act(async () => { rtl.fireEvent.press(view.getByTestId('stop-button')); });

    // The turn is OVER, quietly: input back to idle…
    await rtl.waitFor(() => { expect(view.queryByTestId('stop-button')).toBeNull(); }, { timeout: 4000 });
    await h.settle(50);
    // …no answer materializes for the stopped turn (RED: the no-tools fallback re-generation
    // rendered ZOMBIE_TEXT — an answer the user explicitly stopped)…
    expect(view.queryByText(new RegExp(ZOMBIE_TEXT))).toBeNull();
    // …and no wrong-diagnosis surfaces: not the busy error, not the empty-response card.
    expect(view.queryByText(/LLM service busy/i)).toBeNull();
    expect(view.queryByText(/No response/i)).toBeNull();

    // ---- Turn 2: the very next send must just work. ----
    await h.send('hello again', { text: 'Second turn works fine.' });
    // Terminal artifact the user perceives: the reply streams and renders (RED: "LLM service busy"
    // renders as the assistant bubble instead — IMG_0148 — because the zombie still holds the engine).
    await rtl.waitFor(() => { expect(view.queryByText(/Second turn works fine\./)).not.toBeNull(); }, { timeout: 6000 });
    expect(view.queryByText(/LLM service busy/i)).toBeNull();
    // The stopped turn's answer STILL must not exist anywhere in the transcript.
    expect(view.queryByText(new RegExp(ZOMBIE_TEXT))).toBeNull();
  });
});
