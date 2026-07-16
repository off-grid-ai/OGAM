/**
 * T056 / DEV-B13 — a LLAMA (GGUF) generation that fails mid-stream must show the user an error AND clear
 * the loading state. On device it does NEITHER: the vision decode fails, no error is surfaced, and the
 * spinner spins forever.
 *
 * Device (part9 wire capture): a vision send on a bigger GGUF model streams, then the native runtime dies:
 *   [LLM-NATIVE] error: llama_decode: failed to decode, ret = -1
 *   [GenerationService] Generation error: Failed to evaluate chunks
 *   [ChatGen] Generation failed: Failed to evaluate chunks   →   [GEN-SM] session end reason=error
 * ...yet the UI showed no error and kept spinning. The wire log shows the SAME `llama_decode: failed to
 * decode` repeating ~26-31s apart (14:17:35 → 14:18:01 → 14:18:32): the tool loop's generateWithRetry
 * treats a FATAL decode failure as retryable and retries it 4× with escalating backoff, so the spinner
 * spins for the better part of two minutes with zero feedback. User (this session): "the vision thing
 * failed and I didn't get a fucking error."
 *
 * IMPORTANT: this is the LLAMA path (a `*.gguf` model). The litert error path DOES clear + surface the
 * error immediately (verified, see litertCpuInvokeError) — the bug is specific to the llama engine's turn
 * being run through the retrying tool loop, so this test pins engine:'llama'.
 *
 * ANTI-FALSE-GREEN (the T056 lesson): "the spinner is absent after the error" is trivially true if the
 * spinner never rendered. So we OBSERVE the stop-button (the generating/spinner control) PRESENT while the
 * turn is in flight FIRST — holding the stream open via pauseAfter — THEN drive the fatal decode failure,
 * THEN assert it cleared. The clear is a real observed transition, not a no-op.
 *
 * RED on HEAD (B13): after the fatal decode failure the stop-button stays (retry loop keeps the turn
 * "generating") and no error is surfaced. Falsify: a normal scripted turn renders an answer + no spinner.
 */
import { setupChatScreen } from '../../harness/chatHarness';

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: () => {}, goBack: () => {}, setOptions: () => {}, addListener: () => () => {} }),
  useRoute: () => require('../../harness/chatHarness').routeHolder,
  useFocusEffect: () => {}, useIsFocused: () => true,
}));

describe('T056 (rendered) — a failed LLAMA generation shows an error + clears the spinner (DEV-B13)', () => {
  it('surfaces the error and returns the input to idle after a llama generation fails mid-stream', async () => {
    const h = await setupChatScreen({ engine: 'llama', platform: 'android' });
    h.render();

    // The native llama runtime streams a couple of tokens (spinner up + streaming), HOLDS at "Loo",
    // then — on release — dies with the device-shaped fatal decode failure. Modeling the mid-stream
    // failure lets us observe the generating control PRESENT before the error (anti-false-green).
    h.boundary.llama!.scriptCompletion({ text: 'Looking at the image', pauseAfter: 'Loo', throwAfter: 'Failed to evaluate chunks' });
    await h.tapSend('describe this image');

    // The send happened (proves the errored generation actually ran, not a no-op).
    await h.rtl.waitFor(() => { expect(h.view!.queryAllByText('describe this image').length).toBeGreaterThan(0); }, { timeout: 4000 });

    // ANTI-FALSE-GREEN: the generating/spinner control is truly ON SCREEN while the turn is in flight.
    // Without this observed-present step, the later "stop-button is gone" assertion would pass vacuously.
    await h.rtl.waitFor(() => { expect(h.view!.queryByTestId('stop-button')).not.toBeNull(); }, { timeout: 4000 });

    // Release the held stream → the runtime throws the fatal decode failure (llama_decode ret=-1).
    h.boundary.llama!.releaseStream();

    // SPEC: the user is told the generation failed. RED (B13): no error is shown — the retry loop swallows
    // the fatal error into ~2 min of silent retries. (Alert title 'Generation Error' + the inline detail.)
    await h.rtl.waitFor(() => {
      expect(h.view!.queryAllByText(/Failed to evaluate chunks|Generation Error/i).length).toBeGreaterThan(0);
    }, { timeout: 6000 });

    // SPEC: the loading state cleared — input usable again. RED (B13): the STOP control spins forever.
    expect(h.view!.queryByTestId('stop-button')).toBeNull();
  });
});
